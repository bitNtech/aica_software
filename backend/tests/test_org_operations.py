"""Phase 3: the call log, call records and notes, callbacks, appointments
and the handoff queue."""
from __future__ import annotations

from datetime import timedelta

import pytest

from app.domain.redact import search_tokens
from app.routes.org.calls import since_days
from app.data.store import CallbackDoc, CallDoc, now

from .orgkit import SLUG, api, env, err, login, post, seed, seed_ops  # noqa: F401


def setup(env, role="owner"):
    client, fb, store, mailer = env
    people = seed(fb, store)
    seed_ops(store, people)
    login(client, people[role][1])
    return client, fb, store, people


def add_call(store, cid, *, handled_by_id=None, days_ago=0, agent="ag_1", outcome="resolved", phone="9840299999", intent="Ask timings", name=None):
    store.save_record(SLUG, "call", CallDoc(
        id=cid, agentId=agent, agentName="Main reception", line="+91 422 400 1000", callerPhone=phone,
        startedAt=now() - timedelta(days=days_ago, minutes=5), durationSec=60, language="english", intent=intent, outcome=outcome,
        callerName=name, handledById=handled_by_id, searchTokens=search_tokens(phone, intent, "Main reception", name),
    ))


# ---------------------------------------------------------------- call log


def test_front_desk_see_only_the_calls_they_handled(env):
    client, fb, store, people = setup(env, "front_desk")
    add_call(store, "call_2", handled_by_id=people["supervisor"][0])
    add_call(store, "call_3")
    page = client.get(api("/calls")).json()
    assert [c["id"] for c in page["calls"]] == ["call_1"] and page["total"] == 1
    assert client.get(api("/calls/call_1")).status_code == 200
    assert err(client.get(api("/calls/call_2")))[2] == "You can open the calls you handled."


def test_numbers_are_masked_and_names_need_personal(env):
    client, fb, store, people = setup(env, "viewer")
    c = client.get(api("/calls")).json()["calls"][0]
    assert c["callerPhone"] == "+91 ••••• 43210" and c["callerName"] is None
    rec = client.get(api("/calls/call_1")).json()
    assert rec["summary"] == "A caller wants an OPD visit on Friday."
    assert rec["transcript"][0]["text"] == "I am [name], my number is [phone]"
    assert {d["label"]: d["value"] for d in rec["details"]} == {"Patient name": "", "Department": "OPD"}
    assert rec["analysis"]["fields"] == [{"label": "Patient name", "value": ""}]
    # Someone with calls.personal sees it all, except the full number.
    login(client, people["supervisor"][1])
    rec = client.get(api("/calls/call_1")).json()
    assert rec["callerName"] == "Lakshmi K" and "Lakshmi K" in rec["summary"] and "{{name:Lakshmi K}}" in rec["transcript"][0]["text"]
    assert rec["callerPhone"] == "+91 ••••• 43210"


def test_call_log_filters_and_search(env):
    client, fb, store, people = setup(env, "supervisor")
    add_call(store, "old", days_ago=10)
    add_call(store, "other_agent", agent="ag_2", outcome="booked")
    add_call(store, "named", name="Priya S", phone="9840255555")
    ids = lambda q: {c["id"] for c in client.get(api(f"/calls{q}")).json()["calls"]}  # noqa: E731
    assert "old" not in ids("?days=7") and "old" in ids("?days=30")
    assert ids("?agentId=ag_2") == {"other_agent"}
    assert ids("?outcome=booked") == {"other_agent"}
    assert ids("?q=43210") == {"call_1"} and ids("?q=432") == {"call_1"}
    assert ids("?q=opd") == {"call_1"}
    assert ids("?q=priya") == {"named"}
    page = client.get(api("/calls?limit=2")).json()
    assert len(page["calls"]) == 2 and page["total"] == 3  # the 10-day-old call is outside 7 days
    assert client.get(api("/calls?days=5")).status_code == 422
    # Without calls.personal, names aren't searchable.
    login(client, people["viewer"][1])
    assert ids("?q=priya") == set()


def test_today_starts_at_ist_midnight():
    from datetime import datetime, timezone

    at = datetime(2026, 10, 19, 20, 0, tzinfo=timezone.utc)  # 01:30 IST on the 20th
    assert since_days(1, at) == datetime(2026, 10, 19, 18, 30, tzinfo=timezone.utc)
    assert since_days(7, at) == datetime(2026, 10, 13, 18, 30, tzinfo=timezone.utc)


def test_notes(env):
    client, fb, store, people = setup(env, "front_desk")
    r = post(client, api("/calls/call_1/notes"), {"text": " Called back, all sorted. "})
    assert r.status_code == 200 and r.json()["text"] == "Called back, all sorted." and r.json()["by"] == "Front Desk"
    assert client.get(api("/calls/call_1")).json()["notes"][0]["text"] == "Called back, all sorted."
    assert err(post(client, api("/calls/call_1/notes"), {"text": ""}))[2] == "Write the note first."
    assert err(post(client, api("/calls/call_1/notes"), {"text": "x" * 1001}))[2] == "Keep notes under 1,000 characters."
    assert err(post(client, api("/calls/nope/notes"), {"text": "Hello"}))[:2] == (404, "invalid_input")
    add_call(store, "call_2", handled_by_id=people["supervisor"][0])
    assert err(post(client, api("/calls/call_2/notes"), {"text": "Hello"}))[2] == "You can add notes to the calls you handled."
    login(client, people["viewer"][1])
    assert err(post(client, api("/calls/call_1/notes"), {"text": "Hello"}))[2] == "Viewers can read notes, not add them."


# ---------------------------------------------------------------- callbacks


def add_callback(store, cid, assigned=None, name=""):
    store.save_record(SLUG, "callback", CallbackDoc(id=cid, callerPhone="9840211112", reason="x", requestedAt=now(), dueBy=now() + timedelta(hours=1), assignedToId=assigned, assignedToName=name or None))


def test_front_desk_callbacks_are_their_own_and_unassigned(env):
    client, fb, store, people = setup(env, "front_desk")
    me, sup = people["front_desk"][0], people["supervisor"][0]
    add_callback(store, "cb_mine", me, "Front Desk")
    add_callback(store, "cb_theirs", sup, "Supervisor")
    assert {c["id"] for c in client.get(api("/callbacks")).json()} == {"cb_1", "cb_mine"}
    assert client.get(api("/callbacks")).json()[0]["callerPhone"].startswith("+91 98402")  # in full
    r = post(client, api("/callbacks/cb_1"), {"assignedTo": me})
    assert r.json()["assignedTo"] == {"id": me, "name": "Front Desk"}
    assert err(post(client, api("/callbacks/cb_mine"), {"assignedTo": sup}))[2] == "You can take callbacks for yourself, not assign them to others."
    assert err(post(client, api("/callbacks/cb_theirs"), {"note": "Hi"}))[2] == "This callback is Supervisor’s. Ask a supervisor to move it."


def test_callback_attempts_and_assignment(env):
    client, fb, store, people = setup(env, "supervisor")
    assert err(post(client, api("/callbacks/cb_1"), {"assignedTo": people["viewer"][0]}))[2] == "Viewer is a viewer and can’t make calls for the team."
    assert err(post(client, api("/callbacks/cb_1"), {"assignedTo": "gone"}))[:2] == (404, "invalid_input")
    assert err(post(client, api("/callbacks/cb_1"), {"note": " "}))[2] == "Write the note first."
    for i in range(2):
        assert post(client, api("/callbacks/cb_1"), {"attempt": "no_answer"}).json()["status"] == "open"
    r = post(client, api("/callbacks/cb_1"), {"attempt": "no_answer", "note": "Third try"}).json()
    assert r["status"] == "unreachable" and r["attempts"] == 3 and r["notes"][-1]["text"] == "Third try"
    assert post(client, api("/callbacks/cb_1"), {"reopen": True}).json()["status"] == "open"
    assert post(client, api("/callbacks/cb_1"), {"attempt": "reached"}).json()["status"] == "done"
    assert post(client, api("/callbacks/cb_1"), {"assignedTo": people["front_desk"][0]}).json()["assignedTo"]["id"] == people["front_desk"][0]
    assert post(client, api("/callbacks/cb_1"), {"assignedTo": None}).json()["assignedTo"] is None


@pytest.mark.parametrize("change", ["remove", "viewer", "lose calls.take"])
def test_callbacks_go_back_to_nobody_when_someone_cant_take_them(env, change):
    client, fb, store, people = setup(env, "owner")
    fd = people["front_desk"][0]
    add_callback(store, "cb_fd", fd, "Front Desk")
    if change == "remove":
        post(client, api(f"/members/{fd}/remove"))
    elif change == "viewer":
        post(client, api(f"/members/{fd}/role"), {"role": "viewer"})
    else:
        post(client, api(f"/members/{fd}/permissions"), {"permissions": ["desk.notices"]})
    assert store.get_record(SLUG, "callback", "cb_fd").assignedToId is None


def test_callbacks_stay_when_permissions_keep_calls_take(env):
    client, fb, store, people = setup(env, "owner")
    fd = people["front_desk"][0]
    add_callback(store, "cb_fd", fd, "Front Desk")
    post(client, api(f"/members/{fd}/permissions"), {"permissions": ["calls.take"]})
    assert store.get_record(SLUG, "callback", "cb_fd").assignedToId == fd


# ---------------------------------------------------------------- appointments


def test_appointments_show_details_by_permission(env):
    client, fb, store, people = setup(env, "front_desk")
    today = now().date().isoformat()
    a = client.get(api(f"/appointments?from={today}&to={today}")).json()[0]
    assert a["phone"] == "+91 98402 22222" and a["patientName"] == "Meena R" and a["checkReason"]
    login(client, people["viewer"][1])
    a = client.get(api(f"/appointments?from={today}&to={today}")).json()[0]
    assert a["phone"] == "+91 ••••• 22222" and a["patientName"] == "A patient"
    assert client.get(api("/appointments?from=2026-02-30&to=2026-03-01")).status_code == 422
    assert client.get(api("/appointments?from=2026-01-01&to=2026-06-01")).status_code == 422


def test_changing_appointments(env):
    client, fb, store, people = setup(env, "front_desk")
    url = api("/appointments/apt_1")
    assert err(post(client, url, {"date": "tomorrow"}))[2] == "Choose a date."
    assert err(post(client, url, {"date": "2027-02-30"}))[2] == "Choose a real date."
    assert err(post(client, url, {"time": "25:00"}))[2] == "Choose a time."
    assert err(post(client, url, {"doctor": " "}))[2] == "Choose a doctor."
    r = post(client, url, {"date": "2027-03-01", "time": "11:00", "doctor": "Dr. Meera", "note": "Bring reports", "status": "confirmed"}).json()
    assert (r["date"], r["time"], r["doctor"], r["note"], r["status"], r["checkReason"]) == ("2027-03-01", "11:00", "Dr. Meera", "Bring reports", "confirmed", None)
    assert post(client, url, {"note": ""}).json()["note"] is None
    post(client, url, {"status": "cancelled"})
    assert err(post(client, url, {"status": "confirmed"}))[2] == "This appointment was cancelled. Book it again first."
    assert post(client, url, {"status": "booked"}).json()["status"] == "booked"
    assert err(post(client, api("/appointments/nope"), {"status": "booked"}))[:2] == (404, "invalid_input")


# ---------------------------------------------------------------- handoffs


def test_taking_a_handoff_makes_the_call_theirs(env):
    client, fb, store, people = setup(env, "front_desk")
    c = store.get_record(SLUG, "call", "call_1")
    c.handledById, c.handledBy = None, None
    store.save_record(SLUG, "call", c)
    assert client.get(api("/calls")).json()["total"] == 0
    h = client.get(api("/handoffs")).json()[0]
    assert h["callerPhone"] == "+91 ••••• 43210" and h["details"][0]["value"] == "Lakshmi K"
    r = post(client, api("/handoffs/ho_1/take")).json()
    assert r["status"] == "taken" and r["takenBy"] == "Front Desk" and r["takenAt"]
    assert [x["id"] for x in client.get(api("/calls")).json()["calls"]] == ["call_1"]
    login(client, people["supervisor"][1])
    assert err(post(client, api("/handoffs/ho_1/take")))[2] == "Front Desk has already taken this call."
    assert err(post(client, api("/handoffs/ho_1/to-callback")))[2] == "Front Desk has already taken this call."


def test_a_missed_handoff_becomes_a_callback(env):
    client, fb, store, people = setup(env, "front_desk")
    cb = post(client, api("/handoffs/ho_1/to-callback")).json()
    assert cb["callerName"] == "Lakshmi K" and cb["callerPhone"] == "+91 98402 43210" and cb["callId"] == "call_1"
    assert cb["assignedTo"] == {"id": people["front_desk"][0], "name": "Front Desk"} and cb["status"] == "open"
    assert cb["reason"] == "Lakshmi K is asking about her scan report."
    assert err(post(client, api("/handoffs/ho_1/to-callback")))[2] == "This caller already has a callback. It’s on the Callbacks page."
    assert err(post(client, api("/handoffs/ho_1/take")))[2] == "The caller hung up. Make it a callback instead."
    assert err(post(client, api("/handoffs/nope/take")))[:2] == (404, "invalid_input")


# ---------------------------------------------------------------- review follow-ups


class _Q:
    """Records the shape of a Firestore query, for checking index needs."""

    def __init__(self, log, ops=()):
        self.log, self.ops = log, tuple(ops)

    def collection(self, *_):
        return self

    def document(self, *_):
        return self

    def where(self, filter):  # noqa: A002
        return _Q(self.log, self.ops + (("where", filter.field_path, filter.op_string),))

    def order_by(self, field, direction=None):
        return _Q(self.log, self.ops + (("order", field, direction),))

    def limit(self, n):
        return _Q(self.log, self.ops + (("limit", n),))

    def count(self):
        self.log.append(("count", self.ops))

        class _Agg:
            def get(_):
                return [[type("R", (), {"value": 0})()]]

        return _Agg()

    def stream(self):
        self.log.append(("stream", self.ops))
        return iter(())


def test_call_count_and_list_use_the_same_ordered_query():
    """Composite indexes are direction-specific: the count must be ordered
    like the list, or every filtered call log needs indexes that don't exist."""
    from app.data.store import CallFilter, FirestoreStore

    log = []
    FirestoreStore(_Q(log)).list_calls("arogya", CallFilter(since=now(), handled_by_id="u1", tokens=["432"]), 50)
    (_, counted), (_, listed) = log
    assert ("order", "startedAt", "DESCENDING") in counted
    assert listed[: len(counted)] == counted


def test_callbacks_hide_names_without_personal(env):
    client, fb, store, people = setup(env, "owner")
    fd = people["front_desk"][0]
    post(client, api(f"/members/{fd}/permissions"), {"permissions": ["calls.take", "desk.bot"]})  # no calls.personal
    login(client, people["front_desk"][1])
    h = client.get(api("/handoffs")).json()[0]
    assert h["details"][0]["value"] == "" and "Lakshmi" not in h["summary"]
    cb = post(client, api("/handoffs/ho_1/to-callback")).json()
    assert cb["callerName"] is None and "Lakshmi" not in cb["reason"] and cb["callerPhone"] == "+91 98402 43210"
    assert all(c["callerName"] is None for c in client.get(api("/callbacks")).json())


def test_other_pipeline_text_is_scrubbed_without_personal(env):
    client, fb, store, people = setup(env, "viewer")
    c = store.get_record(SLUG, "call", "call_1")
    c.toolCalls = [{"name": "book", "ok": True, "summary": "Booked Dr. Arvind for Lakshmi K", "at": 30}]
    c.analysis = {**c.analysis, "successReason": "Lakshmi K got a slot", "fields": [{"label": "Patient name", "value": "Lakshmi K"}, {"label": "Note", "value": "Call Lakshmi K back"}]}
    store.save_record(SLUG, "call", c)
    rec = client.get(api("/calls/call_1")).json()
    text = str(rec["toolCalls"]) + str(rec["analysis"])
    assert "Lakshmi" not in text and "Dr. Arvind" in text


def test_an_assignee_removed_meanwhile_isnt_given_the_callback(env):
    client, fb, store, people = setup(env, "supervisor")
    fd = people["front_desk"][0]
    real = store.transact

    def removed_first(fn):
        store.members[SLUG].pop(fd)  # a removal commits between the check and the write
        return real(fn)

    store.transact = removed_first
    r = post(client, api("/callbacks/cb_1"), {"assignedTo": fd})
    store.transact = real
    assert r.status_code == 422 and store.get_record(SLUG, "callback", "cb_1").assignedToId is None


def test_work_done_while_acting_belongs_to_the_member(env):
    client, fb, store, people = setup(env, "owner")
    from .orgkit import master

    master(fb, store)
    login(client, "support@bitntech.in")
    post(client, f"/api/ops/people/{people['front_desk'][0]}/act-as", {"reason": "Showing the handoff queue"})
    c = store.get_record(SLUG, "call", "call_1")
    c.handledById = None
    store.save_record(SLUG, "call", c)
    post(client, api("/handoffs/ho_1/take"))
    assert store.get_record(SLUG, "call", "call_1").handledById == people["front_desk"][0]
    assert store.get_record(SLUG, "handoff", "ho_1").takenBy.endswith("(bitNtech, as Front Desk)")
