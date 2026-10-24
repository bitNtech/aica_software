"""Who may do what inside an organisation. The table is permissions.json,
shared with frontend/src/console/access.ts (a test on each side fails when
they drift). The console only hides what isn't allowed; these checks are
the ones that count.

A role gives a default set of permissions; an owner or admin can change it
per person, within what the role may hold (`grantable`). bitNtech accounts
aren't members: the master admin may do everything, staff only look.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

_TABLE = json.loads((Path(__file__).with_name("permissions.json")).read_text(encoding="utf-8"))

ROLES: tuple[str, ...] = tuple(_TABLE["roles"])
# In the table's order, which is also the frontend's.
ALL_PERMISSIONS: tuple[str, ...] = tuple(_TABLE["permissions"])
_DEFAULTS = {p: frozenset(v["defaults"]) for p, v in _TABLE["permissions"].items()}
_GRANTABLE = {p: frozenset(v["grantable"]) for p, v in _TABLE["permissions"].items()}
PLATFORM_STAFF: tuple[str, ...] = tuple(_TABLE["platformStaff"])

ROLE_LABEL = {"owner": "Owner", "admin": "Admin", "supervisor": "Supervisor", "front_desk": "Front desk", "viewer": "Viewer"}


def default_permissions(role: str) -> list[str]:
    return [p for p in ALL_PERMISSIONS if role in _DEFAULTS[p]]


def can_grant(role: str, permission: str) -> bool:
    return role in _GRANTABLE.get(permission, frozenset())


def permissions_for(role: str, custom: list[str] | None = None) -> list[str]:
    """A custom set, trimmed to what the role may hold. None: the defaults."""
    if custom is None:
        return default_permissions(role)
    chosen = set(custom)
    return [p for p in ALL_PERMISSIONS if p in chosen and can_grant(role, p)]


def stored_permissions(role: str, custom: list[str] | None) -> list[str] | None:
    """What to keep on a member: None when it equals the role's defaults."""
    if custom is None:
        return None
    trimmed = permissions_for(role, custom)
    return None if set(trimmed) == set(default_permissions(role)) else trimmed


@dataclass(frozen=True)
class Access:
    """What the caller may do in one organisation. `role` is "owner" for
    bitNtech, as in the frontend's platformAccess, so owner-only rules
    follow the permissions they hold."""

    role: str
    perms: frozenset[str]
    platform: str | None = None

    def has(self, permission: str) -> bool:
        return permission in self.perms

    @property
    def is_owner(self) -> bool:
        return self.role == "owner"


def member_access(role: str, custom: list[str] | None) -> Access:
    return Access(role=role, perms=frozenset(permissions_for(role, custom)))


def platform_access(platform_role: str) -> Access:
    perms = ALL_PERMISSIONS if platform_role == "master_admin" else PLATFORM_STAFF
    return Access(role="owner", perms=frozenset(perms), platform=platform_role)


def can_manage_owners(a: Access) -> bool:
    """console/access.ts 'team.manageOwners'."""
    return a.is_owner and a.has("team.manage")


def beyond_own(a: Access, granted: list[str] | set[str]) -> set[str]:
    """Permissions in `granted` that the caller doesn't hold. Only owners
    (and the master admin) may hand out what they don't have themselves."""
    if a.is_owner and (a.platform is None or a.platform == "master_admin"):
        return set()
    return set(granted) - a.perms
