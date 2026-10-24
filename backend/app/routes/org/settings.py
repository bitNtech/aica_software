"""/api/orgs/{slug}/settings — name, city, languages, business hours and
closed days. Owners and admins (`settings.manage`).

Name, city and languages stay on the organisation document, where sessions
and Ops already read them; hours and closed days sit beside them. A save
writes only these fields, so it can't undo a status change made meanwhile.
Each value is checked here and the message says what to fix; the page
checks the same rules first.
"""
from __future__ import annotations

import re
from datetime import date

from fastapi import APIRouter, Depends

from ...access.orgs import OrgContext, org_permission
from ...auth.accounts import iso
from ...core.errors import bad_input
from ...core.ratelimit import limit_caller
from ...data.store import OrgDoc, Tx, now
from ...models import ClosedDayOut, DayHoursOut, OrgSettingsIn, OrgSettingsOut

router = APIRouter(prefix="/api/orgs/{slug}/settings", tags=["org"])

LANGUAGE_LABEL = {"tamil": "Tamil", "english": "English", "tanglish": "Tanglish"}
# Until an organisation sets its own: Monday to Saturday, 9 to 6.
DEFAULT_HOURS = [{"open": True, "from": "09:00", "to": "18:00"} for _ in range(6)] + [{"open": False, "from": "09:00", "to": "18:00"}]
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
NAME_MIN, NAME_MAX = 3, 120  # as at sign-up
CITY_MIN, CITY_MAX = 2, 80
MAX_CLOSED = 60


def settings_out(org: OrgDoc) -> OrgSettingsOut:
    return OrgSettingsOut(
        name=org.name,
        city=org.city,
        languages=org.languages,
        hours=[DayHoursOut(open=bool(h["open"]), from_=h["from"], to=h["to"]) for h in (org.hours or DEFAULT_HOURS)],
        closed=[ClosedDayOut(date=c["date"], label=c["label"]) for c in sorted(org.closed, key=lambda c: c["date"])],
        updated_at=iso(org.settingsUpdatedAt or org.createdAt),
        updated_by=org.settingsUpdatedBy or "",
    )


def _checked(body: OrgSettingsIn) -> dict:
    """The new values, or a 422 saying what's wrong. Nothing is saved
    unless everything passes."""
    name, city = body.name.strip(), body.city.strip()
    if not NAME_MIN <= len(name) <= NAME_MAX:
        raise bad_input(f"Give the organisation a name of {NAME_MIN} to {NAME_MAX} characters.")
    if not CITY_MIN <= len(city) <= CITY_MAX:
        raise bad_input("Give the city, e.g. Coimbatore.")
    languages = list(dict.fromkeys(body.languages))
    if not languages:
        raise bad_input("Choose at least one language callers use.")
    if len(body.hours) != 7:
        raise bad_input("Give hours for each day of the week.")
    for h in body.hours:
        if h.open and (not TIME.match(h.from_) or not TIME.match(h.to) or h.from_ >= h.to):
            raise bad_input("Each open day needs an opening time before its closing time.")
    closed = []
    for c in body.closed:
        try:
            real = re.fullmatch(r"\d{4}-\d{2}-\d{2}", c.date) is not None and date.fromisoformat(c.date).isoformat() == c.date
        except ValueError:
            real = False
        if not real:
            raise bad_input("Each closed day needs a real date.")
        label = c.label.strip()
        if not label or len(label) > 40:
            raise bad_input("Name each closed day in up to 40 characters, e.g. Pongal.")
        closed.append({"date": c.date, "label": label})
    if len({c["date"] for c in closed}) != len(closed):
        raise bad_input("A date is listed twice.")
    if len(closed) > MAX_CLOSED:
        raise bad_input(f"List up to {MAX_CLOSED} closed days.")
    return {
        "name": name,
        "city": city,
        "languages": languages,
        # A closed day's times aren't shown; keep them well-formed.
        "hours": [
            {"open": h.open, "from": h.from_, "to": h.to} if h.open or (TIME.match(h.from_) and TIME.match(h.to)) else {"open": False, "from": "09:00", "to": "18:00"}
            for h in body.hours
        ],
        "closed": sorted(closed, key=lambda c: c["date"]),
    }


def _changes(was: OrgDoc, new: dict) -> list[str]:
    said = []
    if new["name"] != was.name:
        said.append(f"Renamed the organisation to {new['name']}")
    if new["city"] != was.city:
        said.append(f"Changed the city to {new['city']}")
    if sorted(new["languages"]) != sorted(was.languages):
        said.append(f"Changed the languages to {', '.join(LANGUAGE_LABEL[x] for x in new['languages'])}")
    if new["hours"] != (was.hours or DEFAULT_HOURS):
        said.append("Changed the business hours")
    old = {c["date"]: c for c in was.closed}
    now_dates = {c["date"] for c in new["closed"]}
    said += [f"Added the closed day {c['label']}" for c in new["closed"] if c["date"] not in old]
    said += [f"Removed the closed day {c['label']}" for d, c in sorted(old.items()) if d not in now_dates]
    said += [f"Renamed the closed day {old[c['date']]['label']} to {c['label']}" for c in new["closed"] if c["date"] in old and old[c["date"]]["label"] != c["label"]]
    return said


@router.get("", response_model=OrgSettingsOut, response_model_by_alias=True)
def get_settings(ctx: OrgContext = Depends(org_permission("settings.manage", what="see the organisation's settings"))):
    return settings_out(ctx.org)


@router.post("", response_model=OrgSettingsOut, response_model_by_alias=True, dependencies=[Depends(limit_caller("org-settings", 30))])
def update_settings(body: OrgSettingsIn, ctx: OrgContext = Depends(org_permission("settings.manage", what="change the organisation's settings"))):
    new = _checked(body)
    by = ctx.actor()[0]

    def run(tx: Tx) -> OrgDoc:
        org = tx.get_org(ctx.slug)
        if not org:
            raise bad_input("That organisation doesn't exist any more.")
        said = _changes(org, new)
        if not said:
            return org
        fields = {**new, "settingsUpdatedAt": now(), "settingsUpdatedBy": by}
        tx.update_org(ctx.slug, fields)
        for text in said:
            ctx.log(tx, "settings", text)
        for k, v in fields.items():
            setattr(org, k, v)
        return org

    org = ctx.svc.store.transact(run)
    ctx.audit_acting("org_settings_changed")
    return settings_out(org)
