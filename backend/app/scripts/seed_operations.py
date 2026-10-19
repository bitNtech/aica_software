"""Sample operations data (calls, handoffs, callbacks, appointments) for a
staging or test organisation, until the voice pipeline writes real ones.
From backend/:

    .venv/bin/python -m app.scripts.seed_operations --org test-hospital --yes

Guards, because these records look real once written:
- the organisation must exist, and its name or slug must contain "test" or
  "demo", unless --force;
- nothing is written without --yes (without it, it says what it would do);
- every record is marked `seeded: true`, so it can be found and deleted.

Phone numbers are from the 98400 00xxx range and names are made up.
"""
from __future__ import annotations

import argparse
import random
import sys
from datetime import timedelta

from ..access import member_access
from ..redact import search_tokens
from ..services import Services, build_services
from ..settings import get_settings
from ..store import AppointmentDoc, CallbackDoc, CallDoc, HandoffDoc, new_id, now

NAMES = ["Lakshmi K", "Ravi S", "Meena R", "Arun P", "Priya N", "Karthik V", "Divya M", "Suresh T"]
INTENTS = [("Book OPD visit", "booked"), ("Ask OPD timings", "resolved"), ("Lab report status", "resolved"), ("Talk to a nurse", "handed_over"), ("Cancel appointment", "resolved"), ("Call back about bill", "callback"), ("Chest pain", "emergency"), ("Hung up", "dropped")]
DEPARTMENTS = [("Cardiology", "Dr. Arvind"), ("General medicine", "Dr. Meera"), ("Orthopaedics", "Dr. Kannan")]


def _phone(rng: random.Random) -> str:
    return f"98400{rng.randint(0, 99999):05d}"


def seed(svc: Services, slug: str, calls: int = 120, write: bool = False) -> dict[str, int]:
    rng = random.Random(slug)
    takers = [(m.id, m.name) for m in svc.store.list_members(slug) if m.status == "active" and member_access(m.role, m.permissions).has("calls.take")]
    t, counts = now(), {"calls": 0, "handoffs": 0, "callbacks": 0, "appointments": 0}

    def put(kind, rec, key):
        counts[key] += 1
        if write:
            svc.store.save_record(slug, kind, rec)

    for i in range(calls):
        intent, outcome = rng.choice(INTENTS)
        name = rng.choice(NAMES) if rng.random() < 0.7 else None
        phone = _phone(rng)
        handler = rng.choice(takers) if takers and outcome in ("handed_over", "emergency") else None
        started = t - timedelta(days=rng.uniform(0, 30))
        cid = new_id("call")
        put("call", CallDoc(
            id=cid, agentId="ag_seed", agentName="Main reception (sample)", line="+91 422 400 1000", callerPhone=phone, startedAt=started,
            durationSec=rng.randint(30, 420), language=rng.choice(["tamil", "english", "tanglish"]), intent=intent, outcome=outcome,
            callerName=name, handledBy=handler[1] if handler else None, handledById=handler[0] if handler else None,
            summary=f"{name or 'The caller'} asked: {intent.lower()}.",
            details=[{"label": "Patient name", "value": name, "personal": True}] if name else [],
            transcript=[{"speaker": "agent", "at": 0, "text": "Vanakkam, this is the hospital's assistant."}, {"speaker": "caller", "at": 3, "text": f"I'm {{{{name:{name}}}}}. {intent}." if name else f"{intent}."}],
            analysis={"sentiment": "neutral", "success": outcome in ("resolved", "booked"), "successReason": "Sample data", "fields": []},
            searchTokens=search_tokens(phone, intent, "Main reception (sample)", name), seeded=True,
        ), "calls")
        if outcome == "booked":
            dept, doctor = rng.choice(DEPARTMENTS)
            day = (t + timedelta(days=rng.randint(-2, 7))).date().isoformat()
            put("appointment", AppointmentDoc(
                id=new_id("apt"), patientName=name or "Sample patient", phone=phone, department=dept, doctor=doctor, date=day,
                time=f"{rng.randint(9, 16):02d}:{rng.choice(['00', '30'])}", status=rng.choice(["needs_check", "booked", "confirmed"]),
                bookedBy="agent", createdAt=started, agentName="Main reception (sample)", callId=cid, seeded=True,
            ), "appointments")
        if outcome == "callback":
            put("callback", CallbackDoc(id=new_id("cb"), callerName=name, callerPhone=phone, reason=f"Asked to be called back: {intent.lower()}", requestedAt=started, dueBy=started + timedelta(hours=4), callId=cid, seeded=True), "callbacks")
    for _ in range(3):
        name = rng.choice(NAMES)
        put("handoff", HandoffDoc(
            id=new_id("ho"), callId="", agentName="Main reception (sample)", line="+91 422 400 1000", callerPhone=_phone(rng),
            reason="Asked for a person", summary=f"{name} wants to talk to someone about a report.", language="tamil",
            waitingSince=t - timedelta(minutes=rng.randint(1, 8)), details=[{"label": "Patient name", "value": name, "personal": True}], seeded=True,
        ), "handoffs")
    return counts


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--org", required=True, help="the organisation's slug")
    p.add_argument("--calls", type=int, default=120)
    p.add_argument("--yes", action="store_true", help="write the records (default: only say what it would write)")
    p.add_argument("--force", action="store_true", help="allow an organisation whose name doesn't say test or demo")
    a = p.parse_args()
    svc = build_services(get_settings())
    org = svc.store.get_org(a.org)
    if not org:
        print(f"No organisation {a.org!r}.")
        return 1
    if not a.force and not any(w in f"{org.slug} {org.name}".lower() for w in ("test", "demo")):
        print(f"{org.name} doesn't look like a test organisation. Sample calls would look real there. Use --force if you're sure.")
        return 1
    counts = seed(svc, org.slug, max(1, min(a.calls, 2000)), write=a.yes)
    print(("Wrote" if a.yes else "Would write") + ": " + ", ".join(f"{n} {k}" for k, n in counts.items()) + ("." if a.yes else ". Run again with --yes."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
