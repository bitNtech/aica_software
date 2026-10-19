# AICA console — auth API

FastAPI service that does all authentication for the console. The browser
only ever calls this API under `/api`. The API talks to Firebase:

- **Firebase Auth** through the Admin SDK and the Auth REST API, for password sign-in, Google sign-in and email action codes
- **Firestore** (the project's `(default)` database, asia-south1) for profiles, organisations, their members, settings and activity, invites, rate-limit counters and the audit trail
- **Resend** for emails

The session is a Firebase **session cookie** in an HttpOnly, SameSite=Lax cookie (`aica_session`). It's verified on every request, including the check for revoked sessions. The browser never holds a Firebase or Google token.

## Run locally

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env              # then fill it in (see below)
mkdir -p secrets                  # put service-account.json here
.venv/bin/uvicorn app.main:app --port 8000 --reload
```

Then run the frontend with `npm run dev` in `../frontend` and open http://localhost:5173. Vite forwards `/api` to port 8000, so the cookie and the origin check both see the same origin. API docs are at http://localhost:5173/api/docs.

Master admins (once, after `.env` and the key are in place):

```bash
.venv/bin/python -m app.scripts.seed_master support@bitntech.in admin@bitntech.in
```

This creates each user if needed, marks the email verified, sets the `platform_role: master_admin` claim, writes the profile, and emails a "set your password" link. Master admins can also use Google on the same address. It's safe to re-run.

To promote an account that already has a password, skip the email: `.venv/bin/python -m app.scripts.seed_master --no-email admin@bitntech.in`. A new account still gets it. The person must sign out and back in for the role to apply.

Invite bitNtech staff from Ops → People. From the command line, for when nobody can sign in yet: `.venv/bin/python -m app.scripts.invite_staff name@bitntech.in --by "Support"`.

Tests use in-memory fakes, with no network: `.venv/bin/python -m pytest`.

## Configuration (`backend/.env`, git-ignored)

| Key | What |
|---|---|
| `FIREBASE_CREDENTIALS` | Path to the service-account JSON, default `secrets/service-account.json` (git-ignored) |
| `FIREBASE_CREDENTIALS_JSON` | The service-account JSON itself, for hosts without a secrets file system (Vercel). Overrides `FIREBASE_CREDENTIALS` when set. Leave empty locally |
| `FIREBASE_WEB_API_KEY` | Project settings → General → Web API key. Server-side only |
| `FIRESTORE_DATABASE` | `(default)`, the project's only Firestore database (asia-south1) |
| `RESEND_API_KEY`, `EMAIL_FROM` | `EMAIL_FROM` must be on a domain verified in Resend. `onboarding@resend.dev` only delivers to the Resend account owner |
| `DEMO_REQUEST_TO` | Who receives the landing page's "Book a demo" requests, comma-separated. Default `support@bitntech.in` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The OAuth web client Firebase created for Google sign-in. Leave both empty to switch Google sign-in off: the button then returns to the login page with a "not set up yet" message |
| `APP_URL` | The frontend's public URL, for email links and the redirect after Google. `http://localhost:5173` locally. **Required on Vercel** |
| `API_URL` | This API's public URL when it has its own host, e.g. `https://api.aica.bitntech.in`; the Google redirect URI is built from it. Empty locally (same origin through the Vite proxy). On Vercel it defaults to the deployment's own URL |
| `ALLOWED_ORIGINS` | Frontend origins allowed to call the API with cookies (CORS) and to make writes, comma-separated. Defaults to `APP_URL`'s origin |
| `COOKIE_SECURE` | `true` behind HTTPS (required in production). Defaults to `true` on Vercel |
| `LOG_FORMAT` | `text` (default locally) or `json` (default on Vercel): one JSON object per line, with a request id, route template, status, duration, caller uid and organisation slug. Logs never hold emails, names, phone numbers, tokens or request bodies |
| `COOKIE_SAMESITE` | `lax` (default). Works when the frontend and API share a site, e.g. `aica.bitntech.in` and `api.aica.bitntech.in`. `none` needs `COOKIE_SECURE=true` and breaks in browsers that block third-party cookies |

The frontend and this API are deployed separately. See [`docs/cicd.md`](../docs/cicd.md) for hosts and per-environment values. Explicit values always win.

## Firebase console setup

1. **Firestore → Rules:** paste [`firestore.rules`](firestore.rules), which denies all client access. Only this API, through the Admin SDK, uses the database.
2. **Authentication → Settings → User account linking:** keep "Link accounts that use the same email" (the default).
3. **Google sign-in:** any Google OAuth web client works. The backend verifies Google's ID token itself (signature, issuer, expiry, audience = `GOOGLE_CLIENT_ID`, verified email). It then signs the matching Firebase user in with a custom token, so Firebase's own Google provider settings aren't involved. On the client (Google Cloud console → APIs & Services → Credentials), add the authorised redirect URI `http://localhost:5173/api/auth/google/callback`, plus `<API_URL>/api/auth/google/callback` for each deployed environment. The app name Google shows comes from that project's OAuth consent screen (Branding).

## Routes

| Method | Path | Who |
|---|---|---|
| GET | `/api/auth/session` | anyone (401 when signed out) |
| POST | `/api/auth/login`, `/api/auth/logout` | anyone |
| POST | `/api/auth/signup` | anyone. Creates the user plus an organisation in review, and emails a verification link |
| POST | `/api/auth/verify-email`, `/api/auth/verify-email/resend` | anyone |
| POST | `/api/auth/password/forgot`, `/password/verify`, `/password/reset` | anyone. A reset revokes every session |
| POST | `/api/auth/business` | signed in with no organisation (Google sign-ups) |
| GET | `/api/auth/google/start`, `/api/auth/google/callback` | anyone. OAuth code flow with PKCE and a state cookie; the Google ID token is verified server-side, then a Firebase custom-token sign-in follows |
| GET/POST | `/api/invites/{token}`, `/api/invites/{token}/accept` | anyone holding the link. `GET` says `hasAccount` when the address already has an AICA account; `accept` creates a new account |
| POST | `/api/invites/{token}/join` | signed in with the invited address, not acting, not a bitNtech account. Joins the organisation with an existing account |
| GET | `/api/orgs/{slug}/members` | any member of the organisation, and bitNtech |
| POST | `/api/orgs/{slug}/members/invite` | `team.manage`. `{"email", "role"}`; only owners invite owners |
| POST | `/api/orgs/{slug}/members/{id}/resend`, `/role` (`{"role"}`), `/permissions` (`{"permissions": [...] \| null}`), `/remove` | `team.manage`. See "Organisations" below |
| GET/POST | `/api/orgs/{slug}/settings` | `settings.manage`. Name, city, languages, hours (7 days, Monday first), closed days |
| GET | `/api/orgs/{slug}/activity?area=&actorId=&before=&limit=` | `activity.view`. Newest first, 25 a page; `before` is the previous page's `nextBefore`. Billing entries for owners only |
| POST | `/api/leads/demo` | anyone, from an allowed origin. The landing page's demo form: validated, emailed to `DEMO_REQUEST_TO` through Resend, not stored. 204 when sent, 503 when Resend fails, 5 per minute per IP. A filled-in `website` honeypot gets 204 and is dropped |
| GET | `/api/ops/orgs`, `/api/ops/signup-requests` | bitNtech staff and master admin |
| POST | `/api/ops/signup-requests/{slug}/approve`, `/decline` | bitNtech staff and master admin |
| POST | `/api/ops/orgs/{slug}/suspend`, `/restore` | master admin only |
| POST | `/api/ops/staff-invites` | master admin only. `{"email", "role"}`, where role is `staff` (default) or `master_admin`. Inviting a master admin emails every master admin |
| GET | `/api/ops/people` | master admin only. Every account, bitNtech first |
| POST | `/api/ops/people/{uid}/role` | master admin only. `{"role": "master_admin" \| "staff" \| null, "reason"}`. Signs the person out everywhere so the change applies at once. A new master admin is announced to every master admin by email |
| POST | `/api/ops/people/{uid}/disable` (`{"reason"}`), `/enable`, `/sign-out` | master admin only |
| POST | `/api/ops/people/{uid}/act-as` | master admin only. `{"reason"}`. Acts as a client user for `ACT_AS_MINUTES` (30) |
| POST | `/api/auth/act-as/end` | the master admin acting. Returns their own session |
| GET | `/api/ops/audit?limit=&before=&action=\|actor=\|target=` | master admin only. Newest first; one filter at a time; actor and target take an email |

Errors are always `{"error": {"code", "message", "retryAfter"?}}`, with codes matching the frontend's `AuthErrorCode`.

Protections:
- CORS allows only the exact origins in `ALLOWED_ORIGINS`, with credentials, `GET`/`POST` and the `Accept`/`Content-Type` headers.
- Writes whose `Origin` isn't in `ALLOWED_ORIGINS` get 403, as CSRF protection.
- Login pauses for 15 minutes after 5 failures per email; this is stored in Firestore.
- Rate limits are shared by every instance: counters in the `ratelimits` collection, in one-minute windows, per IP for anonymous routes (`X-Real-IP` on Vercel) and per person for signed-in ones. If Firestore can't be reached the request is allowed and a warning logged. Set a TTL policy so old counters are deleted (see below).
- Forgot-password and resend give the same answer whether or not the account exists.
- Invite tokens are stored hashed. Resending or cancelling an organisation invitation revokes the old link.
- Ops decisions are written to the `audit` collection.
- People management: nobody can change, disable or sign out their own account from the app, and a change that would leave no active master admin is refused. Client accounts (with organisation memberships) can't be given a bitNtech role.

### Organisations

`app/orgs.py` guards every `/api/orgs/{slug}` route. The member record (`orgs/{slug}/members/{uid}`) decides, on every request; the browser's idea of a role is never used. The table of role defaults and who may hold each permission is [`app/permissions.json`](app/permissions.json), shared with `frontend/src/console/access.ts` (a test on each side fails if they drift).

- Non-members, and organisations that don't exist, get the same 403. Members of an organisation that isn't active get a 403 that says why.
- bitNtech: the master admin may do everything, staff only look. Acting as someone, the person acted as is the caller; the change shows as bitNtech's in the organisation's activity and goes to the platform audit log too.
- Team rules: nobody changes their own role or permissions or removes themselves; only owners invite, change or remove owners; at least one active owner always stays (checked in the same transaction as the change); someone who isn't an owner can only give permissions they hold.
- Every change is written to `orgs/{slug}/activity` in the same transaction.
- Accounts made before member records existed get theirs the first time it's needed. To create them all at once: `.venv/bin/python -m app.scripts.backfill_members` (lists), then `--apply`.

POST-only writes: changes are `POST …/role`, `…/remove` and so on, so CORS and the origin check stay `GET`/`POST` only. Keep to that for new routes.

### Acting as a client user

A master admin can act as a client user to see exactly what they see. It's audited and time-limited:
- It starts with a required reason. An `impersonations/{sha256(token)}` record holds who, as whom, why and until when; the browser holds the token in an HttpOnly `aica_act_as` cookie. The master admin's own session cookie is unchanged.
- Every request checks the master admin's own session first, then the record (live, not expired, theirs), then the target (exists, not disabled, still a client). If anything fails, the request runs as the master admin again.
- While acting: all `/api/ops/*` routes and `/api/auth/business` refuse with 403. New sensitive routes should depend on `not_acting`.
- It ends on `POST /api/auth/act-as/end`, on sign-out, on signing in again, or after `ACT_AS_MINUTES` (default 30, 5 to 120). Start and end go to the audit log. The client isn't emailed.
- bitNtech accounts can't be acted as, and staff can't act as anyone.

### Firestore indexes

`firestore.indexes.json` lists every composite index the API's queries need. Create them **before** deploying code that uses them, either with `firebase deploy --only firestore:indexes` from `backend/` (needs a `firebase.json` pointing at the file), or by hand in Firebase console → Firestore Database → Indexes → Composite:

- collection `audit`: `action` (or `actor`, or `target`) Ascending, then `at` Descending;
- collection `activity` (scope: collection): each of `area`; `actorId`; `area`, `actorId`; `ownerOnly`; `ownerOnly`, `area`; `ownerOnly`, `actorId`; `ownerOnly`, `area`, `actorId` — all Ascending — then `at` Descending.

Until they exist, the unfiltered audit log and an owner's unfiltered activity work, and other queries answer 503 with an explanation.

### Firestore TTL for rate-limit counters

Firebase console → Firestore Database → TTL → create a policy on collection group `ratelimits`, field `expiresAt`. Without it, the counters (a few small documents a minute) are never deleted.
