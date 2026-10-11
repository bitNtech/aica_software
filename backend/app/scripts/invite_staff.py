"""Invite a bitNtech staff member (until the Ops staff page exists). From backend/:

    .venv/bin/python -m app.scripts.invite_staff someone@bitntech.in --by "Support"

Emails an invitation link; the person sets their name and password on /invite/:token.
"""
from __future__ import annotations

import argparse
import sys

from ..routes.invites import issue_invite
from ..services import build_services
from ..settings import get_settings


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("email")
    p.add_argument("--by", default="BitNTech")
    a = p.parse_args()
    svc = build_services(get_settings())
    if svc.admin.get_user_by_email(a.email.lower()):
        print(f"{a.email} already has an account.")
        return 1
    issue_invite(svc, email=a.email, role="staff", org_name="BitNTech", invited_by=a.by)
    svc.store.audit("cli", "staff_invited", a.email.lower())
    print(f"Invitation emailed to {a.email}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
