"""Server-side password policy — the same rules the frontend shows, enforced
here because the frontend's checks are only for feedback."""
from __future__ import annotations

import re

PASSWORD_MIN = 12
_COMMON = {
    "password1234", "password12345", "123456789012", "qwertyuiop12", "aica12345678",
    "letmein12345", "welcome12345", "hospital1234", "iloveyou1234", "admin1234567",
}
_KINDS = [re.compile(p) for p in (r"[a-z]", r"[A-Z]", r"\d", r"[^A-Za-z0-9]")]


def password_problem(password: str, email: str = "") -> str | None:
    if len(password) < PASSWORD_MIN:
        return f"Use at least {PASSWORD_MIN} characters."
    if len(password) > 128:
        return "Use at most 128 characters."
    if sum(1 for k in _KINDS if k.search(password)) < 2:
        return "Add a number or a symbol."
    local = email.split("@")[0].lower()
    if password.lower() in _COMMON or (len(local) >= 3 and local in password.lower()):
        return "Pick something that isn't your email or a common password."
    return None
