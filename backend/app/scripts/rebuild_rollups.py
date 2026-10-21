"""Recount an organisation's report rollups from its calls (repair). From backend/:

    .venv/bin/python -m app.scripts.rebuild_rollups --org <slug> [--days 400]

Safe to re-run: each rollup is rewritten from the calls it covers. Use it if
calls were written without app.reports.record_call, or after a fix to how
rollups count.
"""
from __future__ import annotations

import argparse
import sys

from ..reports import rebuild
from ..services import build_services
from ..settings import get_settings


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--org", required=True)
    p.add_argument("--days", type=int, default=400)
    a = p.parse_args()
    svc = build_services(get_settings())
    if not svc.store.get_org(a.org):
        print(f"No organisation {a.org!r}.")
        return 1
    print(f"Rewrote {rebuild(svc, a.org, max(1, a.days))} rollups.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
