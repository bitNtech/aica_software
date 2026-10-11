"""Transactional email through Resend's HTTP API. Sending is best-effort:
a failed send is logged (without the link) and never undoes the action that
triggered it — the person can always ask for the email again."""
from __future__ import annotations

import html
import logging

import httpx

log = logging.getLogger("aica.mail")

RESEND_URL = "https://api.resend.com/emails"


def _page(title: str, intro: str, button: str, url: str, outro: str) -> str:
    e = html.escape
    return f"""<!doctype html><html><body style="margin:0;background:#f5efe3;font-family:'DM Sans',Segoe UI,Arial,sans-serif;color:#57534e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fbf8f2;border:1px solid #e2d9c8;border-radius:20px" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 32px 0;font:800 22px Arial,sans-serif;letter-spacing:-1px;color:#220934">AICA<span style="color:#ff6e42">.</span></td></tr>
<tr><td style="padding:20px 32px 0;font:800 28px/1.1 Arial,sans-serif;letter-spacing:-1px;color:#220934">{e(title)}</td></tr>
<tr><td style="padding:14px 32px 0;font-size:16px;line-height:1.55">{e(intro)}</td></tr>
<tr><td style="padding:24px 32px"><a href="{e(url)}" style="display:inline-block;background:#ff6e42;color:#1d0c05;font-weight:700;font-size:16px;text-decoration:none;padding:14px 26px;border-radius:999px">{e(button)}</a></td></tr>
<tr><td style="padding:0 32px 28px;font-size:13px;line-height:1.5;color:#7a746d">{e(outro)}<br><br>If the button doesn't work, paste this into your browser:<br><span style="word-break:break-all;color:#220934">{e(url)}</span></td></tr>
</table>
<p style="font:500 11px monospace;letter-spacing:2px;text-transform:uppercase;color:#7a746d">AICA by BitNTech · support@bitntech.in</p>
</td></tr></table></body></html>"""


class Mailer:
    def __init__(self, api_key: str, sender: str, client: httpx.Client | None = None):
        self._key, self._from = api_key, sender
        self._http = client or httpx.Client(timeout=10.0)

    def send(self, to: str, subject: str, html_body: str, kind: str) -> bool:
        if not self._key:
            log.warning("RESEND_API_KEY not set; %s email not sent", kind)
            return False
        try:
            r = self._http.post(
                RESEND_URL,
                headers={"Authorization": f"Bearer {self._key}"},
                json={"from": self._from, "to": [to], "subject": subject, "html": html_body},
            )
        except httpx.HTTPError as e:
            log.error("resend unreachable sending %s email: %s", kind, type(e).__name__)
            return False
        if r.status_code >= 400:
            # Resend's message explains domain/sender problems; it never contains the link.
            msg = r.json().get("message", "") if r.content else ""
            log.error("resend rejected %s email (%s): %s", kind, r.status_code, msg)
            return False
        return True

    # ---- the emails ----

    def verify_email(self, to: str, name: str, url: str) -> bool:
        return self.send(
            to,
            "Confirm your email for AICA",
            _page(f"Confirm your email, {name.split(' ')[0]}.", "Open this link to confirm the address for your AICA account.", "Confirm email", url, "If you didn't sign up for AICA, ignore this email."),
            "verify",
        )

    def reset_password(self, to: str, url: str) -> bool:
        return self.send(
            to,
            "Reset your AICA password",
            _page("Reset your password.", "Someone asked to reset the password for this AICA account. The link works once.", "Choose a new password", url, "If it wasn't you, ignore this email — your password stays the same."),
            "reset",
        )

    def set_password(self, to: str, url: str) -> bool:
        return self.send(
            to,
            "Set your AICA master admin password",
            _page("Set your password.", "You're a master admin on AICA. Choose a password to sign in — or sign in with Google using this address.", "Set password", url, "If you weren't expecting this, tell support@bitntech.in."),
            "set-password",
        )

    def invite(self, to: str, org_name: str, invited_by: str, url: str) -> bool:
        return self.send(
            to,
            f"You're invited to {org_name} on AICA",
            _page(f"Join {org_name}.", f"{invited_by} invited you to AICA. The link shows what you'll be able to do before you accept.", "Open invitation", url, "If you weren't expecting this, you can ignore it — nothing happens until you accept."),
            "invite",
        )

    def signup_decided(self, to: str, org_name: str, approved: bool, reason: str, url: str) -> bool:
        if approved:
            return self.send(
                to,
                f"{org_name} is approved on AICA",
                _page("You're approved.", f"{org_name} is now active on AICA. Sign in to get started and invite your team.", "Sign in", url, "Questions? Reply to support@bitntech.in."),
                "approved",
            )
        return self.send(
            to,
            f"About your AICA request for {org_name}",
            _page("We couldn't approve this request.", f"Reason: {reason}", "See details", url, "If something has changed, write to support@bitntech.in and we'll look again."),
            "declined",
        )
