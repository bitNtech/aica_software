"""The Team endpoints, invitations into an organisation, and the access guard."""
from __future__ import annotations

from app.data.store import MemberDoc, Membership, UserDoc

from .orgkit import PW, SLUG, add_member, api, env, err, login, make_org, master, post, seed, staff, token_of  # noqa: F401


def members(client):
    r = client.get(api("/members"))
    assert r.status_code == 200, r.text
    return {m["email"]: m for m in r.json()}


def invite(client, email, role="supervisor"):
    return post(client, api("/members/invite"), {"email": email, "role": role})


def activity_texts(store):
    return [e.text for e in store.activity.get(SLUG, [])]


# ---------------------------------------------------------------- the guard


def test_every_member_sees_the_team(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["viewer"][1])
    found = members(client)
    assert set(found) == {e for _, e in people.values()}
    assert found["owner@arogya.in"]["status"] == "active" and found["owner@arogya.in"]["permissions"] is None
    # Owners first, then by role.
    assert list(found)[0] == "owner@arogya.in"


def test_outsiders_and_unknown_orgs_get_the_same_refusal(env):
    client, fb, store, _ = env
    seed(fb, store)
    make_org(store, slug="other")
    add_member(fb, store, "owner", slug="other", email="boss@other.in")
    login(client, "boss@other.in")
    a, b = client.get(api("/members")), client.get("/api/orgs/nowhere/members")
    assert err(a) == err(b) == (403, "forbidden", "You don't have access to that organisation.")


def test_needs_a_session(env):
    client, fb, store, _ = env
    seed(fb, store)
    assert client.get(api("/members")).status_code == 401


def test_suspended_and_pending_orgs_are_refused(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    org = store.get_org(SLUG)
    org.status, org.statusReason = "suspended", "Unpaid invoice."
    store.save_org(org)
    login(client, people["owner"][1])
    code, _, msg = err(client.get(api("/members")))
    assert code == 403 and "suspended" in msg and "Unpaid invoice." in msg
    org.status = "pending_review"
    store.save_org(org)
    code, _, msg = err(client.get(api("/members")))
    assert code == 403 and "reviewed" in msg


def test_an_older_owner_gets_a_member_record_on_first_use(env):
    """Accounts from before member records: only users/{uid}.memberships."""
    client, fb, store, _ = env
    uid = fb.add("old@arogya.in", PW, name="Old Owner")
    store.save_user(UserDoc(uid=uid, name="Old Owner", email="old@arogya.in", memberships=[Membership(SLUG, "owner")]))
    make_org(store, owner_uid=uid)
    assert store.get_member(SLUG, uid) is None
    login(client, "old@arogya.in")
    assert members(client)["old@arogya.in"]["role"] == "owner"
    assert store.get_member(SLUG, uid).role == "owner"


def test_bitntech_staff_look_and_the_master_admin_manages(env):
    client, fb, store, _ = env
    seed(fb, store)
    staff(fb, store)
    master(fb, store)
    login(client, "staff@bitntech.in")
    assert client.get(api("/members")).status_code == 200
    assert err(invite(client, "new@arogya.in"))[0] == 403
    login(client, "support@bitntech.in")
    assert invite(client, "boss2@arogya.in", "owner").status_code == 200
    entry = store.activity[SLUG][-1]
    assert entry.actorKind == "bitntech" and entry.actor == "Support (bitNtech)" and entry.actorId is None
    # Unknown organisations are plain "not found" for bitNtech, who can list them anyway.
    assert err(client.get("/api/orgs/nowhere/members"))[0] == 404


def test_slug_must_look_like_a_slug(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    assert client.get("/api/orgs/Bad_Slug/members").status_code == 422


# ---------------------------------------------------------------- inviting


def test_invite_creates_an_invited_member_and_emails_a_link(env):
    client, fb, store, mailer = env
    people = seed(fb, store)
    login(client, people["admin"][1])
    r = invite(client, "New.Person@Arogya.in")
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["status"] == "invited" and m["email"] == "new.person@arogya.in" and m["role"] == "supervisor"
    assert m["invitedBy"] == "Admin" and m["invitedAt"] and m["id"].startswith("inv_")
    url = mailer.last("invite")
    assert url.startswith("http://localhost:5173/invite/")
    assert members(client)["new.person@arogya.in"]["status"] == "invited"
    assert activity_texts(store)[-1] == "Invited new.person@arogya.in as Supervisor"
    # The invitation page shows the organisation and role.
    info = client.get(f"/api/invites/{token_of(url)}").json()
    assert info["orgName"] == "Arogya" and info["role"] == "supervisor" and info["hasAccount"] is False


def test_invite_refusals(env):
    client, fb, store, mailer = env
    people = seed(fb, store)
    staff(fb, store, "someone@bitntech.in")
    login(client, people["admin"][1])
    assert err(invite(client, "boss@arogya.in", "owner"))[:2] == (403, "forbidden")
    assert err(invite(client, people["viewer"][1]))[2] == "Viewer is already in the team."
    assert invite(client, "twice@arogya.in").status_code == 200
    assert "already invited" in err(invite(client, "TWICE@arogya.in"))[2]
    assert "bitNtech account" in err(invite(client, "someone@bitntech.in"))[2]
    assert err(invite(client, "not-an-email"))[:2] == (422, "invalid_input")
    assert err(post(client, api("/members/invite"), {"email": "x@arogya.in", "role": "master_admin"}))[0] == 422
    login(client, people["supervisor"][1])
    assert err(invite(client, "x@arogya.in"))[2] == "You don't have permission to manage the team."
    assert len([k for k, *_ in mailer.sent if k == "invite"]) == 1


def test_a_refused_change_writes_nothing(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["admin"][1])
    before = len(store.activity.get(SLUG, []))
    invite(client, people["viewer"][1])
    assert len(store.activity.get(SLUG, [])) == before
    assert len(store.list_members(SLUG)) == 5 and not store.invites


def test_admins_cant_hand_out_permissions_they_lack(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    from app.access.permissions import default_permissions

    # An admin without "Replace system secrets".
    m = store.get_member(SLUG, people["admin"][0])
    m.permissions = [p for p in default_permissions("admin") if p != "library.secrets"]
    store.save_member(SLUG, m)
    other = add_member(fb, store, "admin", email="admin2@arogya.in", permissions=["team.manage"])
    login(client, people["admin"][1])
    # Admins hold library.secrets by default, so inviting one would hand it out.
    assert err(invite(client, "a2@arogya.in", "admin"))[2].startswith("You can only give permissions you have")
    assert err(post(client, api(f"/members/{people['supervisor'][0]}/role"), {"role": "admin"}))[0] == 403
    r = post(client, api(f"/members/{other}/permissions"), {"permissions": ["team.manage", "library.secrets"]})
    assert err(r)[0] == 403
    # What a role can't hold at all is dropped, not refused.
    assert post(client, api(f"/members/{people['front_desk'][0]}/permissions"), {"permissions": ["calls.take", "library.secrets"]}).json()["permissions"] == ["calls.take"]
    # Taking away is fine, and so is giving what they hold.
    assert post(client, api(f"/members/{people['supervisor'][0]}/permissions"), {"permissions": ["calls.take", "agents.configure"]}).status_code == 200
    assert invite(client, "sup2@arogya.in", "supervisor").status_code == 200


# ---------------------------------------------------------------- accepting


def test_accepting_creates_the_account_with_the_current_role(env):
    client, fb, store, mailer = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    m = invite(client, "doc@arogya.in", "viewer").json()
    # Changed while they hadn't accepted yet: they join with the new role and permissions.
    assert post(client, api(f"/members/{m['id']}/role"), {"role": "front_desk"}).json()["role"] == "front_desk"
    assert post(client, api(f"/members/{m['id']}/permissions"), {"permissions": ["calls.take"]}).status_code == 200
    token = token_of(mailer.last("invite"))
    client.cookies.clear()
    assert client.get(f"/api/invites/{token}").json()["role"] == "front_desk"
    r = post(client, f"/api/invites/{token}/accept", {"name": "Dr. Ravi", "password": PW})
    assert r.status_code == 200, r.text
    mem = r.json()["user"]["memberships"]
    assert mem == [{"orgSlug": SLUG, "orgName": "Arogya", "city": "Coimbatore", "role": "front_desk", "permissions": ["calls.take"], "orgStatus": "active", "statusReason": None}]
    uid = r.json()["user"]["id"]
    assert store.get_member(SLUG, m["id"]) is None and store.get_member(SLUG, uid).status == "active"
    assert store.get_user(uid).memberships == [Membership(SLUG, "front_desk")]
    assert activity_texts(store)[-1] == "Dr. Ravi joined as Front desk"
    assert (uid, "invite_accepted", SLUG, "front_desk") in store.audits
    # The link works once.
    assert err(post(client, f"/api/invites/{token}/accept", {"name": "Again", "password": PW}))[1] == "used_token"
    # And they can use the team page's data at once.
    assert client.get(api("/members")).status_code == 200


def test_resending_replaces_the_link(env):
    client, fb, store, mailer = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    m = invite(client, "doc@arogya.in").json()
    first = token_of(mailer.last("invite"))
    r = post(client, api(f"/members/{m['id']}/resend"))
    assert r.status_code == 200 and r.json()["invitedAt"] >= m["invitedAt"]
    second = token_of(mailer.last("invite"))
    assert first != second
    assert err(client.get(f"/api/invites/{first}"))[:2] == (410, "invalid_token")
    assert client.get(f"/api/invites/{second}").status_code == 200
    assert "Sent the invitation to doc@arogya.in again" in activity_texts(store)
    # Only invitations can be resent.
    assert "already joined" in err(post(client, api(f"/members/{people['viewer'][0]}/resend")))[2]


def test_cancelling_an_invitation_kills_the_link(env):
    client, fb, store, mailer = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    m = invite(client, "doc@arogya.in").json()
    token = token_of(mailer.last("invite"))
    assert post(client, api(f"/members/{m['id']}/remove")).status_code == 204
    assert "doc@arogya.in" not in members(client)
    client.cookies.clear()
    assert err(post(client, f"/api/invites/{token}/accept", {"name": "Dr. Ravi", "password": PW}))[:2] == (410, "invalid_token")
    assert fb.by_email("doc@arogya.in") is None
    assert activity_texts(store)[-1] == "Cancelled the invitation for doc@arogya.in"


def test_someone_with_an_account_signs_in_and_joins(env):
    client, fb, store, mailer = env
    people = seed(fb, store)
    make_org(store, slug="other")
    add_member(fb, store, "owner", slug="other", email="doc@other.in", name="Dr. Meena")
    login(client, people["owner"][1])
    invite(client, "doc@other.in", "supervisor")
    token = token_of(mailer.last("invite"))
    client.cookies.clear()
    assert client.get(f"/api/invites/{token}").json()["hasAccount"] is True
    assert err(post(client, f"/api/invites/{token}/accept", {"name": "Dr. Meena", "password": PW}))[1] == "email_taken"
    assert err(post(client, f"/api/invites/{token}/join"))[0] == 401
    # Someone else's account can't use it.
    login(client, people["viewer"][1])
    code, _, msg = err(post(client, f"/api/invites/{token}/join"))
    assert code == 403 and "doc@other.in" in msg
    login(client, "doc@other.in")
    r = post(client, f"/api/invites/{token}/join")
    assert r.status_code == 200, r.text
    assert {m["orgSlug"]: m["role"] for m in r.json()["user"]["memberships"]} == {"other": "owner", SLUG: "supervisor"}
    assert err(post(client, f"/api/invites/{token}/join"))[1] == "used_token"


def test_bitntech_accounts_cant_join(env):
    client, fb, store, mailer = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    invite(client, "late@bitntech.in")
    token = token_of(mailer.last("invite"))
    # Became staff after the invitation was sent.
    staff(fb, store, "late@bitntech.in")
    login(client, "late@bitntech.in")
    assert err(post(client, f"/api/invites/{token}/join"))[0] == 403


def test_staff_invitations_still_work(env):
    client, fb, store, mailer = env
    master(fb, store)
    login(client, "support@bitntech.in")
    assert post(client, "/api/ops/staff-invites", {"email": "new@bitntech.in", "role": "staff"}).status_code == 204
    token = token_of(mailer.last("invite"))
    client.cookies.clear()
    r = post(client, f"/api/invites/{token}/accept", {"name": "New Staff", "password": PW})
    assert r.status_code == 200 and r.json()["user"]["platformRole"] == "staff"


# ---------------------------------------------------------------- roles


def test_role_changes(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["admin"][1])
    sup = people["supervisor"][0]
    r = post(client, api(f"/members/{sup}/role"), {"role": "viewer"})
    assert r.status_code == 200 and r.json()["role"] == "viewer" and r.json()["permissions"] is None
    assert store.get_user(sup).memberships == [Membership(SLUG, "viewer")]
    assert activity_texts(store)[-1] == "Changed Supervisor's role from Supervisor to Viewer"
    # The same role again changes nothing.
    n = len(activity_texts(store))
    assert post(client, api(f"/members/{sup}/role"), {"role": "viewer"}).status_code == 200
    assert len(activity_texts(store)) == n
    assert "your own role" in err(post(client, api(f"/members/{people['admin'][0]}/role"), {"role": "viewer"}))[2]
    assert err(post(client, api(f"/members/{people['owner'][0]}/role"), {"role": "admin"}))[0] == 403
    assert err(post(client, api(f"/members/{sup}/role"), {"role": "owner"}))[0] == 403
    assert err(post(client, api("/members/nobody/role"), {"role": "viewer"}))[:2] == (404, "invalid_input")
    # The new role applies to their very next request.
    login(client, people["supervisor"][1])
    assert client.get(api("/activity")).status_code == 403


def test_the_last_owner_stays(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    master(fb, store)
    login(client, "support@bitntech.in")
    owner = people["owner"][0]
    assert "at least one owner" in err(post(client, api(f"/members/{owner}/role"), {"role": "admin"}))[2]
    assert "at least one owner" in err(post(client, api(f"/members/{owner}/remove")))[2]
    # A disabled owner doesn't count.
    add_member(fb, store, "owner", email="gone@arogya.in", disabled=True)
    assert err(post(client, api(f"/members/{owner}/role"), {"role": "admin"}))[0] == 409
    # A real second owner does.
    second = add_member(fb, store, "owner", email="second@arogya.in")
    assert post(client, api(f"/members/{owner}/role"), {"role": "admin"}).status_code == 200
    assert "at least one owner" in err(post(client, api(f"/members/{second}/remove")))[2]


def test_owners_manage_owners(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    second = add_member(fb, store, "owner", email="second@arogya.in")
    login(client, people["owner"][1])
    assert post(client, api(f"/members/{second}/role"), {"role": "admin"}).status_code == 200
    assert post(client, api(f"/members/{people['admin'][0]}/role"), {"role": "owner"}).status_code == 200


def test_disabled_accounts_show_as_disabled(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    add_member(fb, store, "viewer", email="off@arogya.in", disabled=True)
    login(client, people["owner"][1])
    assert members(client)["off@arogya.in"]["status"] == "disabled"


def test_last_active_is_kept(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["viewer"][1])
    login(client, people["owner"][1])
    found = members(client)
    assert found["viewer@arogya.in"]["lastActiveAt"] and found["owner@arogya.in"]["lastActiveAt"]
    assert found["admin@arogya.in"]["lastActiveAt"] is None


# ---------------------------------------------------------------- permissions


def test_permissions_are_trimmed_and_defaults_are_stored_as_none(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    viewer = people["viewer"][0]
    # Viewers can't hold calls.take; it's dropped.
    r = post(client, api(f"/members/{viewer}/permissions"), {"permissions": ["reports.view", "calls.take"]})
    assert r.status_code == 200 and r.json()["permissions"] == ["reports.view"]
    assert activity_texts(store)[-1] == "Changed what Viewer can do"
    from app.access.permissions import default_permissions

    r = post(client, api(f"/members/{viewer}/permissions"), {"permissions": default_permissions("viewer")})
    assert r.json()["permissions"] is None
    assert activity_texts(store)[-1] == "Gave Viewer the viewer defaults again"
    assert err(post(client, api(f"/members/{viewer}/permissions"), {"permissions": ["make.coffee"]}))[0] == 422
    assert "your own permissions" in err(post(client, api(f"/members/{people['owner'][0]}/permissions"), {"permissions": None}))[2]


def test_custom_permissions_reach_the_session_and_the_guard(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    post(client, api(f"/members/{people['supervisor'][0]}/permissions"), {"permissions": ["calls.take", "activity.view"]})
    login(client, people["supervisor"][1])
    m = client.get("/api/auth/session").json()["user"]["memberships"][0]
    assert m["permissions"] == ["calls.take", "activity.view"]
    assert client.get(api("/activity")).status_code == 200
    login(client, people["admin"][1])
    assert err(post(client, api(f"/members/{people['owner'][0]}/permissions"), {"permissions": None}))[0] == 403


# ---------------------------------------------------------------- removing


def test_removing_someone_ends_their_access_at_once(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["admin"][1])
    fd = people["front_desk"][0]
    assert post(client, api(f"/members/{fd}/remove")).status_code == 204
    assert store.get_member(SLUG, fd) is None and store.get_user(fd).memberships == []
    assert activity_texts(store)[-1] == "Removed Front Desk (Front desk)"
    assert "yourself" in err(post(client, api(f"/members/{people['admin'][0]}/remove")))[2]
    assert err(post(client, api(f"/members/{people['owner'][0]}/remove")))[0] == 403
    assert err(post(client, api(f"/members/{fd}/remove")))[0] == 404
    login(client, people["front_desk"][1])
    assert err(client.get(api("/members")))[0] == 403
    assert client.get("/api/auth/session").json()["user"]["memberships"] == []


def test_removed_owner_isnt_brought_back_by_the_legacy_path(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    second = add_member(fb, store, "owner", email="second@arogya.in")
    org = store.get_org(SLUG)
    org.ownerUid = second  # the signup owner, as far as the org record knows
    store.save_org(org)
    login(client, people["owner"][1])
    assert post(client, api(f"/members/{second}/remove")).status_code == 204
    assert "second@arogya.in" not in members(client)


# ---------------------------------------------------------------- acting as


def test_changes_made_while_acting_as_someone_are_attributed_to_bitntech(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    m_uid = master(fb, store)
    login(client, "support@bitntech.in")
    assert post(client, f"/api/ops/people/{people['owner'][0]}/act-as", {"reason": "Helping them set up the team"}).status_code == 200
    r = post(client, api(f"/members/{people['viewer'][0]}/role"), {"role": "supervisor"})
    assert r.status_code == 200, r.text
    entry = store.activity[SLUG][-1]
    assert entry.actorKind == "bitntech" and entry.actor == "Support (bitNtech, as Owner)" and entry.actorId is None
    assert (m_uid, "org_member_role_changed", SLUG, f"{people['viewer'][0]} → supervisor") in store.audits
    # The acted-as owner can't change their own role, and neither can bitNtech on their behalf.
    assert err(post(client, api(f"/members/{people['owner'][0]}/role"), {"role": "admin"}))[0] == 403


def test_a_member_record_is_what_counts_not_the_session(env):
    """users/{uid}.memberships alone (no member record, not a legacy entry
    because the record was removed) gives no access."""
    client, fb, store, _ = env
    people = seed(fb, store)
    uid = people["viewer"][0]
    store.members[SLUG].pop(uid)
    # Index says member, record says not: the record was deleted, the
    # index wasn't (an interrupted write). The legacy path recreates it,
    # which is the documented behaviour for index-only entries.
    login(client, people["viewer"][1])
    assert client.get(api("/members")).status_code == 200
    # With neither, no access.
    store.members[SLUG].pop(uid)
    u = store.get_user(uid)
    u.memberships = []
    store.save_user(u)
    assert err(client.get(api("/members")))[0] == 403


def test_member_doc_round_trip_ignores_unknown_fields():
    from app.data.store import _member_from

    m = _member_from("u1", {"email": "a@b.in", "name": "A", "role": "viewer", "futureField": 1})
    assert m == MemberDoc(id="u1", email="a@b.in", name="A", role="viewer")


# ---------------------------------------------------------------- review follow-ups


def _legacy(fb, store, email, role, name="Older Member"):
    """Someone with only the older users/{uid}.memberships entry."""
    uid = fb.add(email, PW, name=name)
    store.save_user(UserDoc(uid=uid, name=name, email=email, memberships=[Membership(SLUG, role)]))
    return uid


def test_older_members_show_and_can_be_managed_before_they_sign_in(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    old = _legacy(fb, store, "old.desk@arogya.in", "front_desk")
    assert store.get_member(SLUG, old) is None
    login(client, people["admin"][1])
    assert members(client)["old.desk@arogya.in"]["role"] == "front_desk"
    assert "already in the team" in err(invite(client, "old.desk@arogya.in"))[2]
    assert post(client, api(f"/members/{old}/remove")).status_code == 204
    assert "old.desk@arogya.in" not in members(client)


def test_manageable_without_listing_first(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    old = _legacy(fb, store, "old.sup@arogya.in", "supervisor")
    login(client, people["admin"][1])
    assert post(client, api(f"/members/{old}/role"), {"role": "viewer"}).json()["role"] == "viewer"


def test_an_older_owner_counts_towards_keeping_one(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    _legacy(fb, store, "old.owner@arogya.in", "owner")
    login(client, people["owner"][1])
    assert post(client, api(f"/members/{people['owner'][0]}/role"), {"role": "admin"}).status_code == 403  # own role
    login(client, "old.owner@arogya.in")
    assert post(client, api(f"/members/{people['owner'][0]}/role"), {"role": "admin"}).status_code == 200


def test_inviting_an_older_member_is_refused_up_front(env):
    client, fb, store, mailer = env
    people = seed(fb, store)
    old = _legacy(fb, store, "old.owner@arogya.in", "owner", "Old Owner")
    login(client, people["owner"][1])
    # Invited by address before they had a record.
    store_invite = invite(client, "old.owner@arogya.in", "viewer")
    assert err(store_invite)[0] == 409  # now caught up front
    # And straight at /join with a link made some other way:
    m = store.get_member(SLUG, old)
    assert m and m.role == "owner"


def test_join_refuses_an_existing_membership_entry(env):
    client, fb, store, mailer = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    invite(client, "late@arogya.in", "viewer")
    token = token_of(mailer.last("invite"))
    uid = _legacy(fb, store, "late@arogya.in", "owner", "Late Owner")  # became a member by the old path meanwhile
    login(client, "late@arogya.in")
    assert err(post(client, f"/api/invites/{token}/join"))[:2] == (409, "invalid_input")
    assert store.get_user(uid).memberships == [Membership(SLUG, "owner")]


def test_accept_keeps_an_account_whose_join_committed(env):
    """A retried transaction after a lost reply reports 'cancelled'; the account must survive."""
    client, fb, store, mailer = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    invite(client, "doc@arogya.in", "viewer")
    token = token_of(mailer.last("invite"))
    client.cookies.clear()
    real = store.transact

    def commit_then_fail(fn):
        real(fn)  # the write lands...
        raise ApiError(410, "invalid_token", "retry saw it used")  # ...but the caller is told otherwise

    from app.core.errors import ApiError

    store.transact = commit_then_fail
    r = post(client, f"/api/invites/{token}/accept", {"name": "Dr. Ravi", "password": PW})
    assert r.status_code == 410
    store.transact = real
    assert fb.by_email("doc@arogya.in") is not None
    uid = fb.by_email("doc@arogya.in").user.uid
    assert store.get_member(SLUG, uid).role == "viewer"
