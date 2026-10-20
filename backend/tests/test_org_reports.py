"""Phase 4: report rollups, the report, and the call list CSV."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.reports import BUCKETS, RollupDoc, add_call, bucket, bucket_value, build_report, calls_this_week, rebuild, record_call
from app.store import CallDoc, now

from .orgkit import SLUG, api, env, err, login, seed  # noqa: F401

IST = timezone(timedelta(hours=5, minutes=30))
AT = datetime(2026, 10, 20, 10, 30, tzinfo=IST)  # a Tuesday, 10:30 in India


def call(cid, at, outcome="resolved", agent="ag_1", intent="Book OPD visit", lang="tamil", dur=60, path=(), analysis=None, metrics=None):
    return CallDoc(
        id=cid, agentId=agent, agentName=f"Agent {agent}", line="+91 422 400 1000", callerPhone="9840212345", startedAt=at,
        durationSec=dur, language=lang, intent=intent, outcome=outcome, path=list(path), analysis=analysis or {}, metrics=metrics or {},
    )


def rollups_of(*calls):
    out = {}
    for c in calls:
        day = c.startedAt.astimezone(IST).date().isoformat()
        r = out.setdefault((c.agentId, day), RollupDoc(id=f"{c.agentId}_{day}", agentId=c.agentId, agentName=c.agentName, day=day))
        add_call(r, c)
    return list(out.values())


def test_counts_split_like_the_frontend():
    rs = rollups_of(
        call("a", AT - timedelta(hours=1), "resolved"),
        call("b", AT - timedelta(hours=1), "booked"),
        call("c", AT - timedelta(hours=2), "dropped", path=["Greet", "Ask date"]),
        call("d", AT - timedelta(hours=2), "handed_over", dur=180),
        call("e", AT - timedelta(hours=3), "emergency"),
        call("f", AT - timedelta(days=1, hours=1), "callback"),
    )
    r = build_report(rs, 7, AT)
    assert r["totals"] == {"calls": 6, "byAgent": 2, "handedOver": 3, "dropped": 1, "avgDurationSec": 80}
    today = r["byDay"][-1]
    assert today == {"date": "2026-10-20", "resolved": 2, "handedOver": 2, "dropped": 1}
    assert len(r["byDay"]) == 7 and r["byDay"][0]["date"] == "2026-10-14"
    assert r["byHour"][9] == 3 and sum(r["byHour"]) == 6  # two today, one yesterday
    assert r["byDayHour"][1][9] == 2  # Tuesday
    assert r["dropOff"] == [{"step": "Ask date", "calls": 1}, {"step": "Book OPD visit", "calls": 1}]
    assert r["intents"][0] == {"label": "Book OPD visit", "calls": 6, "byAgent": 2}
    assert r["languages"] == [{"language": "tamil", "calls": 6}]


def test_the_period_before_stops_at_the_same_hour():
    rs = rollups_of(
        call("today", AT - timedelta(minutes=10)),
        call("yesterday_early", AT - timedelta(days=1, hours=2)),
        call("yesterday_late", AT - timedelta(days=1) + timedelta(hours=5)),  # 15:30 yesterday
        call("old", AT - timedelta(days=3)),
    )
    r = build_report(rs, 1, AT)
    assert r["totals"]["calls"] == 1
    assert r["previous"]["calls"] == 1  # yesterday by this time, not all of yesterday


def test_quality_is_none_until_the_pipeline_sends_it():
    r = build_report(rollups_of(call("a", AT)), 7, AT)
    q = r["quality"]
    assert q["success"] is None and q["sentiment"] is None and q["replyP50Ms"] is None and q["interruptionsPerCall"] is None
    assert r["agents"][0]["success"] is None and r["agents"][0]["replyP50Ms"] is None


def test_quality_from_analysis_and_timings():
    m = lambda ms: {"firstWordMs": 900, "replyP50Ms": ms, "replyP95Ms": 2400, "speechMs": 250, "languageMs": 500, "voiceMs": 220, "interruptions": 2}  # noqa: E731
    rs = rollups_of(
        call("a", AT, analysis={"success": True, "sentiment": "positive"}, metrics=m(800)),
        call("b", AT, analysis={"success": False, "sentiment": "negative"}, metrics=m(1000)),
        call("c", AT, analysis={"success": True, "sentiment": "neutral"}, metrics=m(1200)),
    )
    q = build_report(rs, 7, AT)["quality"]
    assert q["success"] == 2 and q["sentiment"] == {"positive": 1, "neutral": 1, "negative": 1}
    assert abs(q["replyP50Ms"] - 1000) / 1000 < 0.15  # within a bucket
    assert q["interruptionsPerCall"] == 2.0


def test_histogram_buckets_round_trip_within_a_bucket():
    for ms in (50, 300, 1000, 2500, 9000):
        assert abs(bucket_value(bucket(ms)) - ms) / ms < 0.15
    assert bucket(10) == 0 and bucket(10**7) == BUCKETS - 1


def test_record_call_counts_once_and_rebuild_agrees(env):
    client, fb, store, _ = env
    seed(fb, store)
    from .orgkit import make_services  # noqa: F401

    svc = client.app.state.services
    c = call("x1", now() - timedelta(minutes=5))
    assert record_call(svc, SLUG, c) is True
    assert record_call(svc, SLUG, c) is False  # a retried delivery
    (r,) = store.all_records(SLUG, "rollup")
    assert sum(h["calls"] for h in r.hours) == 1
    store.records[(SLUG, "rollup")].clear()
    assert rebuild(svc, SLUG) == 1
    assert sum(h["calls"] for h in store.all_records(SLUG, "rollup")[0].hours) == 1
    assert store.get_record(SLUG, "call", "x1").searchTokens


def test_calls_this_week():
    rs = rollups_of(call("a", AT), call("b", AT - timedelta(days=6)), call("c", AT - timedelta(days=8)), call("d", AT, agent="ag_2"))
    assert calls_this_week(rs, AT) == {"ag_1": 2, "ag_2": 1}


def test_report_route(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    svc = client.app.state.services
    record_call(svc, SLUG, call("x1", now() - timedelta(minutes=5)))
    record_call(svc, SLUG, call("x2", now() - timedelta(minutes=5), agent="ag_2"))
    login(client, people["viewer"][1])
    r = client.get(api("/reports?days=7")).json()
    assert r["totals"]["calls"] == 2 and r["days"] == 7
    assert client.get(api("/reports?days=7&agentId=ag_2")).json()["totals"]["calls"] == 1
    assert client.get(api("/reports?days=3")).status_code == 422
    login(client, people["front_desk"][1])
    assert err(client.get(api("/reports")))[2] == "You don't have permission to see reports."


def test_call_list_csv(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    svc = client.app.state.services
    c = call("x1", now() - timedelta(minutes=5), intent="=HYPERLINK(\"http://evil\")")
    c.callerName = "Lakshmi K"
    record_call(svc, SLUG, c)
    login(client, people["supervisor"][1])
    r = client.get(api("/reports/calls.csv?days=7"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert 'attachment; filename="aica-calls-7d.csv"' == r.headers["content-disposition"]
    body = r.content.decode("utf-8-sig")
    assert "+91 ••••• 12345" in body and "9840212345" not in body and "Lakshmi K" in body
    assert "'=HYPERLINK" in body  # never runs as a formula
    # Granted export without calls.personal: no names.
    login(client, people["owner"][1])
    from .orgkit import post

    post(client, api(f"/members/{people['viewer'][0]}/permissions"), {"permissions": ["reports.view", "reports.export", "calls.viewAll"]})
    login(client, people["viewer"][1])
    assert "Lakshmi" not in client.get(api("/reports/calls.csv")).content.decode("utf-8-sig")


def test_review_follow_ups_for_reports(env):
    client, fb, store, _ = env
    seed(fb, store)
    svc = client.app.state.services
    # Unknown languages count as mixed, the frontend's word for it.
    r = build_report(rollups_of(call("a", AT, lang="hindi")), 7, AT)
    assert r["languages"] == [{"language": "mixed", "calls": 1}] and r["quality"]["analysed"] == 0
    # Rebuilding drops rollups for days whose calls are gone.
    from app.reports import RollupDoc as R

    store.save_record(SLUG, "rollup", R(id="ag_x_2026-10-01", agentId="ag_x", agentName="Old", day=(now() - timedelta(days=5)).date().isoformat()))
    rebuild(svc, SLUG)
    assert store.all_records(SLUG, "rollup") == []
