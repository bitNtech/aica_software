"""Organisation settings and the organisation's activity log."""
from __future__ import annotations

from datetime import timedelta

import pytest

from app.data.store import ActivityDoc, now

from .orgkit import SLUG, api, env, err, login, post, seed  # noqa: F401

WEEK = [{"open": True, "from": "09:00", "to": "17:00"}] * 5 + [{"open": True, "from": "09:00", "to": "13:00"}, {"open": False, "from": "09:00", "to": "18:00"}]


def body(**over):
    b = {"name": "Arogya Hospital", "city": "Coimbatore", "languages": ["tamil", "english"], "hours": WEEK, "closed": [{"date": "2027-01-14", "label": "Pongal"}]}
    b.update(over)
    return b


def test_defaults_before_anything_is_set(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["admin"][1])
    s = client.get(api("/settings")).json()
    assert s["name"] == "Arogya" and s["languages"] == ["tamil"] and s["closed"] == [] and s["updatedBy"] == ""
    assert [h["open"] for h in s["hours"]] == [True] * 6 + [False]
    assert s["hours"][0] == {"open": True, "from": "09:00", "to": "18:00"}


def test_saving_settings(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["admin"][1])
    r = post(client, api("/settings"), body(closed=[{"date": "2027-08-15", "label": "Independence Day"}, {"date": "2027-01-14", "label": " Pongal "}]))
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["name"] == "Arogya Hospital" and s["updatedBy"] == "Admin" and s["hours"] == WEEK
    assert [c["date"] for c in s["closed"]] == ["2027-01-14", "2027-08-15"] and s["closed"][0]["label"] == "Pongal"
    texts = [e.text for e in store.activity[SLUG]]
    assert texts == [
        "Renamed the organisation to Arogya Hospital",
        "Changed the languages to Tamil, English",
        "Changed the business hours",
        "Added the closed day Pongal",
        "Added the closed day Independence Day",
    ]
    # The new name is what sessions and Ops see.
    assert client.get("/api/auth/session").json()["user"]["memberships"][0]["orgName"] == "Arogya Hospital"
    assert store.get_org(SLUG).status == "active"
    # Saving the same thing again changes nothing.
    again = post(client, api("/settings"), body(closed=s["closed"]))
    assert again.json()["updatedAt"] == s["updatedAt"] and len(store.activity[SLUG]) == len(texts)
    # Removing and renaming closed days.
    post(client, api("/settings"), body(closed=[{"date": "2027-01-14", "label": "Thai Pongal"}]))
    assert [e.text for e in store.activity[SLUG]][-2:] == ["Removed the closed day Independence Day", "Renamed the closed day Pongal to Thai Pongal"]


def test_a_closed_days_times_are_normalised(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    hours = WEEK[:6] + [{"open": False, "from": "", "to": ""}]
    assert post(client, api("/settings"), body(hours=hours)).json()["hours"][6] == {"open": False, "from": "09:00", "to": "18:00"}


@pytest.mark.parametrize("over, message", [
    ({"name": "A"}, "Give the organisation a name of 3 to 120 characters."),
    ({"name": "x" * 121}, "Give the organisation a name of 3 to 120 characters."),
    ({"city": " "}, "Give the city, e.g. Coimbatore."),
    ({"languages": []}, "Choose at least one language callers use."),
    ({"hours": WEEK[:6]}, "Give hours for each day of the week."),
    ({"hours": [{"open": True, "from": "18:00", "to": "09:00"}] + WEEK[1:]}, "Each open day needs an opening time before its closing time."),
    ({"hours": [{"open": True, "from": "9am", "to": "17:00"}] + WEEK[1:]}, "Each open day needs an opening time before its closing time."),
    ({"closed": [{"date": "2027-02-30", "label": "Nope"}]}, "Each closed day needs a real date."),
    ({"closed": [{"date": "14-01-2027", "label": "Nope"}]}, "Each closed day needs a real date."),
    ({"closed": [{"date": "2027-01-14", "label": ""}]}, "Name each closed day in up to 40 characters, e.g. Pongal."),
    ({"closed": [{"date": "2027-01-14", "label": "x" * 41}]}, "Name each closed day in up to 40 characters, e.g. Pongal."),
    ({"closed": [{"date": "2027-01-14", "label": "A"}, {"date": "2027-01-14", "label": "B"}]}, "A date is listed twice."),
    ({"closed": [{"date": f"2027-03-{d:02d}", "label": "x"} for d in range(1, 32)] + [{"date": f"2027-05-{d:02d}", "label": "x"} for d in range(1, 31)]}, "List up to 60 closed days."),
])
def test_settings_are_checked_and_nothing_is_saved(env, over, message):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    assert err(post(client, api("/settings"), body(**over))) == (422, "invalid_input", message)
    assert store.get_org(SLUG).name == "Arogya" and SLUG not in store.activity


def test_settings_shape_is_checked(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    assert err(post(client, api("/settings"), body(languages=["klingon"])))[0] == 422
    assert err(post(client, api("/settings"), {"name": "Arogya"}))[0] == 422


def test_settings_need_the_permission(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["supervisor"][1])
    assert err(client.get(api("/settings")))[2] == "You don't have permission to see the organisation's settings."
    assert err(post(client, api("/settings"), body()))[0] == 403


# ---------------------------------------------------------------- activity


def _entries(store, n, **kw):
    t = now()
    for i in range(n):
        store.add_activity(SLUG, ActivityDoc(at=t + timedelta(seconds=i), actor="Owner", actorKind="member", area=kw.get("area", "team"), text=f"entry {i}", actorId=kw.get("actor_id"), ownerOnly=kw.get("owner_only", False)))


def test_activity_pages_newest_first_without_skipping_ties(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    t = now()
    # Thirty entries, many at the same instant.
    for i in range(30):
        store.activity.setdefault(SLUG, []).append(ActivityDoc(at=t + timedelta(seconds=i // 10), actor="Owner", actorKind="member", area="team", text=f"e{i}", id=f"id{i:02d}"))
    login(client, people["admin"][1])
    seen, before = [], None
    while True:
        q = f"?limit=7{f'&before={before}' if before else ''}"
        page = client.get(api(f"/activity{q}")).json()
        seen += [e["text"] for e in page["entries"]]
        before = page["nextBefore"]
        if not before:
            break
    assert len(seen) == 30 and len(set(seen)) == 30
    assert seen[0] in {f"e{i}" for i in range(20, 30)}


def test_activity_filters(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    _entries(store, 3, area="team", actor_id=people["admin"][0])
    _entries(store, 2, area="settings")
    login(client, people["owner"][1])
    assert len(client.get(api("/activity?area=settings")).json()["entries"]) == 2
    assert len(client.get(api(f"/activity?actorId={people['admin'][0]}")).json()["entries"]) == 3
    assert len(client.get(api(f"/activity?area=settings&actorId={people['admin'][0]}")).json()["entries"]) == 0
    assert client.get(api("/activity?area=nonsense")).status_code == 422
    # An unknown cursor is an empty page, not an error.
    assert client.get(api("/activity?before=nope")).json() == {"entries": [], "nextBefore": None}


def test_billing_activity_is_for_owners(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    _entries(store, 1, area="billing", owner_only=True)
    _entries(store, 1, area="team")
    login(client, people["owner"][1])
    assert len(client.get(api("/activity")).json()["entries"]) == 2
    login(client, people["admin"][1])
    assert [e["area"] for e in client.get(api("/activity")).json()["entries"]] == ["team"]


def test_activity_needs_the_permission(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["supervisor"][1])
    assert err(client.get(api("/activity")))[2] == "You don't have permission to read the organisation's activity."


def test_activity_shape(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    post(client, api(f"/members/{people['viewer'][0]}/role"), {"role": "supervisor"})
    e = client.get(api("/activity")).json()["entries"][0]
    assert set(e) == {"id", "at", "actor", "actorKind", "actorId", "area", "text", "detail"}
    assert e["actor"] == "Owner" and e["actorKind"] == "member" and e["actorId"] == people["owner"][0] and e["detail"] is None
