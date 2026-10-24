"""Report rollups (Phase 4): counters per agent per India-time day, updated in
the same transaction as the call they count (`record_call`), so a report
reads a few small documents instead of every call.

Each rollup holds, per hour of that day, calls / answered by the agent /
dropped / total duration, plus counts by language, intent and drop-off
step, and the quality inputs the pipeline sends (analysis and timings).
Medians come from fixed log-scale histograms, so they are approximate
(within one bucket, about 13%). "The period before" is cut at the same
hour of day, not the same minute.

Outcomes: resolved and booked count as answered by the agent; dropped as
the caller hung up; everything else (handed over, callback, emergency) as
handed to the team. The frontend's ReportDay and totals use the same split.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
BY_AGENT = ("resolved", "booked")
DROP_OFF = ("dropped", "handed_over")
METRICS = ("firstWordMs", "replyP50Ms", "replyP95Ms", "speechMs", "languageMs", "voiceMs")
SENTIMENTS = ("positive", "neutral", "negative")
# Histogram buckets for timings in ms: geometric from 20 ms to 60 s.
LOW, HIGH, BUCKETS = 20.0, 60000.0, 64
_RATIO = (HIGH / LOW) ** (1 / BUCKETS)
MAX_KEYS = 200  # distinct intents / steps / languages kept per rollup; the rest are "Other"


@dataclass
class RollupDoc:
    id: str  # "{agentId}_{yyyy-mm-dd}"
    agentId: str
    agentName: str
    day: str
    hours: list[dict] = field(default_factory=lambda: [{"calls": 0, "byAgent": 0, "dropped": 0, "durationSum": 0} for _ in range(24)])
    languages: dict = field(default_factory=dict)
    intents: dict = field(default_factory=dict)  # label → {calls, byAgent}
    dropOff: dict = field(default_factory=dict)  # step → calls
    analysed: int = 0  # calls with an analysis
    success: int = 0
    sentiment: dict = field(default_factory=dict)
    timed: int = 0  # calls with timings
    interruptions: int = 0
    metrics: dict = field(default_factory=dict)  # metric → bucket counts


def ist(at: datetime) -> datetime:
    return at.astimezone(IST)


def rollup_id(agent_id: str, day: str) -> str:
    return f"{agent_id}_{day}"


def bucket(ms: float) -> int:
    if ms <= LOW:
        return 0
    return min(BUCKETS - 1, int(math.log(ms / LOW) / math.log(_RATIO)))


def bucket_value(i: int) -> int:
    """A bucket's geometric middle, in ms."""
    return int(round(LOW * _RATIO ** (i + 0.5)))


def _key(d: dict, k: str) -> str:
    k = (k or "").strip()[:120] or "Unknown"
    return k if k in d or len(d) < MAX_KEYS else "Other"


def add_call(r: RollupDoc, call) -> None:
    """Counts one call (an app.data.store.CallDoc) into its rollup."""
    h = r.hours[ist(call.startedAt).hour]
    by_agent = call.outcome in BY_AGENT
    h["calls"] += 1
    h["byAgent"] += int(by_agent)
    h["dropped"] += int(call.outcome == "dropped")
    h["durationSum"] += int(call.durationSec)
    r.agentName = call.agentName or r.agentName
    # The frontend's Language | "mixed": anything else counts as mixed.
    lang = call.language if call.language in ("tamil", "english", "tanglish") else "mixed"
    r.languages[lang] = r.languages.get(lang, 0) + 1
    intent = _key(r.intents, call.intent)
    i = r.intents.setdefault(intent, {"calls": 0, "byAgent": 0})
    i["calls"] += 1
    i["byAgent"] += int(by_agent)
    if call.outcome in DROP_OFF:
        step = _key(r.dropOff, call.path[-1] if call.path else call.intent)
        r.dropOff[step] = r.dropOff.get(step, 0) + 1
    a = call.analysis or {}
    if isinstance(a.get("success"), bool):
        r.analysed += 1
        r.success += int(a["success"])
        if a.get("sentiment") in SENTIMENTS:
            r.sentiment[a["sentiment"]] = r.sentiment.get(a["sentiment"], 0) + 1
    m = call.metrics or {}
    if all(isinstance(m.get(k), (int, float)) for k in METRICS):
        r.timed += 1
        r.interruptions += int(m.get("interruptions") or 0)
        for k in METRICS:
            counts = r.metrics.setdefault(k, [0] * BUCKETS)
            counts[bucket(float(m[k]))] += 1


def _median(counts: list[int]) -> int | None:
    n = sum(counts)
    if not n:
        return None
    # The demo's median is sorted[floor(n / 2)].
    target, seen = n // 2, 0
    for i, c in enumerate(counts):
        seen += c
        if seen > target:
            return bucket_value(i)
    return bucket_value(len(counts) - 1)


def _merge(into: dict, d: dict) -> None:
    for k, v in d.items():
        into[k] = into.get(k, 0) + v


def window(days: int, at: datetime) -> tuple[date, date, date, int]:
    """(first day, today, first day of the period before, current IST hour)."""
    local = ist(at)
    today = local.date()
    start = today - timedelta(days=days - 1)
    return start, today, start - timedelta(days=days), local.hour


def build_report(rollups: list[RollupDoc], days: int, at: datetime) -> dict:
    """The frontend's Report (console/types.ts), from the rollups covering
    this period and the one before. Quality figures are None where no call
    in the period carried them."""
    start, today, prev_start, hour = window(days, at)
    cur_days = [(start + timedelta(days=i)).isoformat() for i in range(days)]
    prev_last = (start - timedelta(days=1)).isoformat()

    def totals(rows: list[tuple[RollupDoc, int]]) -> dict:
        calls = by_agent = dropped = dur = 0
        for r, upto in rows:
            for h in r.hours[: upto + 1]:
                calls += h["calls"]
                by_agent += h["byAgent"]
                dropped += h["dropped"]
                dur += h["durationSum"]
        return {"calls": calls, "byAgent": by_agent, "handedOver": calls - by_agent - dropped, "dropped": dropped, "avgDurationSec": round(dur / calls) if calls else 0}

    current = [r for r in rollups if start.isoformat() <= r.day <= today.isoformat()]
    previous = [r for r in rollups if prev_start.isoformat() <= r.day <= prev_last]
    # The period before stops at the same hour of its last day.
    prev_rows = [(r, hour if r.day == prev_last else 23) for r in previous]

    by_day = {d: {"date": d, "resolved": 0, "handedOver": 0, "dropped": 0} for d in cur_days}
    by_hour = [0] * 24
    by_day_hour = [[0] * 24 for _ in range(7)]
    languages: dict = {}
    intents: dict = {}
    drop_off: dict = {}
    sentiment: dict = {}
    metrics: dict = {k: [0] * BUCKETS for k in METRICS}
    analysed = success = timed = interruptions = 0
    agents: dict = {}
    for r in current:
        weekday = date.fromisoformat(r.day).weekday()  # Monday = 0
        day = by_day[r.day]
        a = agents.setdefault(r.agentId, {"agentId": r.agentId, "name": r.agentName, "calls": 0, "byAgent": 0, "analysed": 0, "success": 0, "reply": [0] * BUCKETS})
        for hh, h in enumerate(r.hours):
            by_hour[hh] += h["calls"]
            by_day_hour[weekday][hh] += h["calls"]
            day["resolved"] += h["byAgent"]
            day["dropped"] += h["dropped"]
            day["handedOver"] += h["calls"] - h["byAgent"] - h["dropped"]
            a["calls"] += h["calls"]
            a["byAgent"] += h["byAgent"]
        _merge(languages, r.languages)
        for label, v in r.intents.items():
            i = intents.setdefault(label, {"label": label, "calls": 0, "byAgent": 0})
            i["calls"] += v["calls"]
            i["byAgent"] += v["byAgent"]
        _merge(drop_off, r.dropOff)
        _merge(sentiment, r.sentiment)
        analysed += r.analysed
        success += r.success
        timed += r.timed
        interruptions += r.interruptions
        a["analysed"] += r.analysed
        a["success"] += r.success
        for k, counts in r.metrics.items():
            if k in metrics:
                metrics[k] = [x + y for x, y in zip(metrics[k], counts)]
        a["reply"] = [x + y for x, y in zip(a["reply"], r.metrics.get("replyP50Ms", [0] * BUCKETS))]

    timings = {k: (_median(v) if timed else None) for k, v in metrics.items()}
    return {
        "days": days,
        "totals": totals([(r, 23) for r in current]),
        "previous": totals(prev_rows),
        "byDay": list(by_day.values()),
        "byHour": by_hour,
        "byDayHour": by_day_hour,
        "languages": [{"language": k, "calls": v} for k, v in sorted(languages.items(), key=lambda kv: -kv[1])],
        "intents": sorted(intents.values(), key=lambda i: -i["calls"]),
        "dropOff": [{"step": k, "calls": v} for k, v in sorted(drop_off.items(), key=lambda kv: -kv[1])[:6]],
        "quality": {
            # How many calls carried an analysis: success and sentiment are out of this.
            "analysed": analysed,
            "success": success if analysed else None,
            "sentiment": {s: sentiment.get(s, 0) for s in SENTIMENTS} if analysed else None,
            **timings,
            "interruptionsPerCall": round(interruptions / timed, 1) if timed else None,
        },
        "agents": [
            {"agentId": a["agentId"], "name": a["name"], "calls": a["calls"], "byAgent": a["byAgent"], "success": a["success"] if a["analysed"] else None, "replyP50Ms": _median(a["reply"])}
            for a in sorted(agents.values(), key=lambda a: -a["calls"])
            if a["calls"] > 0
        ],
    }


def calls_this_week(rollups: list[RollupDoc], at: datetime) -> dict[str, int]:
    """Calls per agent over the last 7 IST days including today, for the agents list."""
    start, today, _, _ = window(7, at)
    out: dict[str, int] = {}
    for r in rollups:
        if start.isoformat() <= r.day <= today.isoformat():
            out[r.agentId] = out.get(r.agentId, 0) + sum(h["calls"] for h in r.hours)
    return out


def record_call(svc, slug: str, call) -> bool:
    """Writes a finished call and counts it into its rollup, in one
    transaction. A call already recorded isn't counted twice (the pipeline
    may retry). Returns False when it was already there."""
    from .redact import search_tokens
    from ..data.store import Tx

    if not call.searchTokens:
        call.searchTokens = search_tokens(call.callerPhone, call.intent, call.agentName, call.callerName)
    rid = rollup_id(call.agentId, ist(call.startedAt).date().isoformat())

    def run(tx: Tx) -> bool:
        if tx.get_record(slug, "call", call.id):
            return False
        r = tx.get_record(slug, "rollup", rid) or RollupDoc(id=rid, agentId=call.agentId, agentName=call.agentName, day=rid.rsplit("_", 1)[1])
        add_call(r, call)
        tx.save_record(slug, "call", call)
        tx.save_record(slug, "rollup", r)
        return True

    return svc.store.transact(run)


def rebuild(svc, slug: str, since_days: int = 400) -> int:
    """Recounts every rollup from the calls themselves (repair). Returns the
    number of rollups written."""
    from ..data.store import CallFilter, now

    calls, _ = svc.store.list_calls(slug, CallFilter(since=now() - timedelta(days=since_days)), 1_000_000)
    rollups: dict[str, RollupDoc] = {}
    for c in calls:
        rid = rollup_id(c.agentId, ist(c.startedAt).date().isoformat())
        r = rollups.setdefault(rid, RollupDoc(id=rid, agentId=c.agentId, agentName=c.agentName, day=rid.rsplit("_", 1)[1]))
        add_call(r, c)
    for r in rollups.values():
        svc.store.save_record(slug, "rollup", r)
    # Days in the range that no longer have calls lose their rollup.
    first = ist(now() - timedelta(days=since_days)).date().isoformat()
    for old in svc.store.list_rollups(slug, first, "9999-12-31"):
        if old.id not in rollups:
            svc.store.delete_record(slug, "rollup", old.id)
    return len(rollups)
