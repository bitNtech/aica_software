"""Create member records (orgs/{slug}/members/{uid}) for accounts made before
they existed, from users/{uid}.memberships. From backend/:

    .venv/bin/python -m app.scripts.backfill_members            # lists what it would do
    .venv/bin/python -m app.scripts.backfill_members --apply    # does it

Optional: the API creates a missing record the first time it's needed, so
nobody is locked out without this. Running it makes every member show on
the Team page at once. Safe to re-run; it never changes an existing record.
"""
from __future__ import annotations

import argparse
import sys

from ..accounts import ensure_member
from ..services import Services, build_services
from ..settings import get_settings


def backfill(svc: Services, apply: bool) -> list[tuple[str, str]]:
    """(org slug, uid) for each record missing, created when `apply`."""
    missing = []
    for user in svc.store.list_users():
        for m in user.memberships:
            if svc.store.get_org(m.orgSlug) and not svc.store.get_member(m.orgSlug, user.uid):
                missing.append((m.orgSlug, user.uid))
                if apply:
                    ensure_member(svc, m.orgSlug, user.uid)
    return missing


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true", help="create the records (default: only list them)")
    a = p.parse_args()
    missing = backfill(build_services(get_settings()), a.apply)
    for slug, uid in missing:
        print(f"{'created' if a.apply else 'missing'}: orgs/{slug}/members/{uid}")
    print(f"{len(missing)} {'created' if a.apply else 'to create; run again with --apply'}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
