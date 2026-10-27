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

## Layout

Every module has one home. New code goes in the package that matches what it does; `app/` itself holds only `main.py` and `models.py`.

```
backend/
  app/
    main.py          the FastAPI app (uvicorn app.main:app; Vercel's entry point)
    models.py        request and response bodies (camelCase on the wire)
    core/            config (settings from .env), errors, logs, ratelimit, services (the container on app.state)
    auth/            sessions (cookie + route guards), identity (Firebase Auth, Google), accounts, passwords
    access/          permissions.py + permissions.json (role table, shared with the frontend), orgs (the /api/orgs/{slug} guard)
    data/            store (Firestore), blobs (Cloud Storage), vault (encrypted system secrets)
    domain/          rules that aren't storage or HTTP: agentspec, catalogue(.json), rollups (report counters), usage, redact,
                     agentcompile (an agent setup as LLM and voice agents), voicecalls (the voice server's calls in our shapes)
    integrations/    outgoing calls to other services: mailer (Resend), toolhttp (SSRF-guarded tool tests),
                     orchestrator (the voice server's client), voicesync (agents' copies on the voice server)
    routes/          HTTP endpoints; routes/org/ is everything under /api/orgs/{slug}; hooks (signed events), ops_voice
    scripts/         one-off commands: python -m app.scripts.<name>
  firestore/         indexes.json and firestore.rules
  tests/             pytest; fakes.py and orgkit.py are the shared helpers
```

- Routes stay thin: they check input and permissions, then call `data/` and `domain/`.
- Imports inside `app/` are relative (`from ..data.store import …`); tests import `app.…`.
- A new route goes into `ROUTES` in `tests/test_permission_matrix.py`.
- Anything that doesn't fit a package: decide where it belongs before adding it, rather than leaving it loose in `app/`.

## Configuration (`backend/.env`, git-ignored)

| Key | What |
|---|---|
| `FIREBASE_CREDENTIALS` | Path to the service-account JSON, default `secrets/service-account.json` (git-ignored) |
| `FIREBASE_CREDENTIALS_JSON` | The service-account JSON itself, for hosts without a secrets file system (Vercel). Overrides `FIREBASE_CREDENTIALS` when set. Leave empty locally |
| `FIREBASE_WEB_API_KEY` | Project settings → General → Web API key. Server-side only |
| `FIRESTORE_DATABASE` | `(default)`, the project's only Firestore database (asia-south1) |
| `RESEND_API_KEY`, `EMAIL_FROM` | `EMAIL_FROM` must be on a domain verified in Resend. `onboarding@resend.dev` only delivers to the Resend account owner |
| `DEMO_REQUEST_TO` | Who receives the landing page's "Book a demo" requests, comma-separated. Default `support@bitntech.in` |
| `SECRETS_KEY` | 32 random bytes, base64, encrypting system secrets (`app/data/vault.py`). Make one with `python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"`. Without it, secrets can't be set. Keep a copy: losing it means re-entering every secret. `SECRETS_KEY_PREVIOUS` only while rotating |
| `STORAGE_BUCKET` | The private Cloud Storage bucket for recordings and knowledge files. Without it, uploads are refused with an explanation |
| `CHANGE_REQUESTS_TO` | Who at bitNtech is emailed about new requests and hospitals' replies, comma-separated. Default `support@bitntech.in` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The OAuth web client Firebase created for Google sign-in. Leave both empty to switch Google sign-in off: the button then returns to the login page with a "not set up yet" message |
| `APP_URL` | The frontend's public URL, for email links and the redirect after Google. `http://localhost:5173` locally. **Required on Vercel** |
| `API_URL` | This API's public URL when it has its own host, e.g. `https://api.aica.bitntech.in`; the Google redirect URI is built from it. Empty locally (same origin through the Vite proxy). On Vercel it defaults to the deployment's own URL |
| `ALLOWED_ORIGINS` | Frontend origins allowed to call the API with cookies (CORS) and to make writes, comma-separated. Defaults to `APP_URL`'s origin |
| `COOKIE_SECURE` | `true` behind HTTPS (required in production). Defaults to `true` on Vercel |
| `LOG_FORMAT` | `text` (default locally) or `json` (default on Vercel): one JSON object per line, with a request id, route template, status, duration, caller uid and organisation slug. Logs never hold emails, names, phone numbers, tokens or request bodies |
| `ORCH_BASE_URL`, `ORCH_API_KEY` | The voice orchestrator and a platform admin key for it ([`docs/orchestrator-contract.md`](../docs/orchestrator-contract.md)). Server-side only; the browser gets short-lived call tokens. Empty: publishing to the voice server, test calls and live calls are off |
| `ORCH_WEBHOOK_SECRET` | The orchestrator's `ORCH_WEBHOOKS__SECRET`, to verify call and handoff events at `/api/hooks/orchestrator`. Events also need a public https `API_URL`; without them, Call history pulls finished calls when it's opened |
| `ORCH_TIMEOUT_S` | Seconds per orchestrator request, default 15 |
| `COOKIE_SAMESITE` | `lax` (default). Works when the frontend and API share a site, e.g. `aica.bitntech.in` and `api.aica.bitntech.in`. `none` needs `COOKIE_SECURE=true` and breaks in browsers that block third-party cookies |

The frontend and this API are deployed separately. See [`docs/cicd.md`](../docs/cicd.md) for hosts and per-environment values. Explicit values always win.

## Firebase console setup

1. **Firestore → Rules:** paste [`firestore/firestore.rules`](firestore/firestore.rules), which denies all client access. Only this API, through the Admin SDK, uses the database.
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
| GET/POST | `/api/orgs/{slug}/requests` | read: `requests.create` or `agents.view` (and bitNtech); create: `requests.create`, members only |
| POST | `/api/orgs/{slug}/requests/number` | `library.numbers` or `requests.create`. Asks bitNtech for another number |
| POST | `/api/orgs/{slug}/requests/{id}/reply`, `/withdraw`, `/update` | reply: `requests.create` or the master admin; withdraw: who asked, or `team.manage`; update (status and reply): master admin only |
| GET | `/api/ops/change-requests` | bitNtech. Every organisation's open requests and those updated in 90 days |
| GET | `/api/orgs/{slug}/calls?days=&agentId=&outcome=&q=&limit=`, `/calls/{id}` | `calls.viewAll`, or `calls.take` for calls they handled. Numbers masked; names and personal details only with `calls.personal` |
| POST | `/api/orgs/{slug}/calls/{id}/notes` | anyone who can see the call, except viewers and bitNtech staff |
| GET/POST | `/api/orgs/{slug}/callbacks`, `/callbacks/{id}` | `calls.take` (own and unassigned) or `callbacks.assign` (all). Patch: `assignedTo`, `attempt`, `reopen`, `note` |
| GET/POST | `/api/orgs/{slug}/appointments?from=&to=`, `/appointments/{id}` | read: `appointments.manage` or `calls.viewAll`; change: `appointments.manage` |
| GET/POST | `/api/orgs/{slug}/handoffs`, `/handoffs/{id}/take`, `/to-callback` | Reading: `calls.viewAll` or `calls.take`. Taking and making a callback: `calls.take`. Taking one marks the call as handled by that person |
| GET | `/api/orgs/{slug}/reports?days=&agentId=` | `reports.view`. From the rollups (`app/domain/rollups.py`) |
| GET | `/api/orgs/{slug}/reports/calls.csv?days=&agentId=` | `reports.export`, with the call log's visibility rules |
| GET/POST | `/api/orgs/{slug}/numbers`, `/numbers/{id}`, `/numbers/{id}/delete` | read: `library.numbers` or non-viewers who see agents; change: `library.numbers`; add and remove: master admin |
| GET/POST | `/api/orgs/{slug}/tools`, `/tools/{id}/delete`, `/tools/{id}/test` | read as numbers; set up, delete, test: master admin. Tests are SSRF-guarded (`app/integrations/toolhttp.py`), 5 a minute |
| GET/POST | `/api/orgs/{slug}/credentials`, `/credentials/{name}/delete` | read names: as tools; set and delete: `library.secrets`. Values are encrypted and never returned |
| GET/POST | `/api/orgs/{slug}/knowledge`, `/{id}`, `/{id}/uploaded`, `/{id}/refresh`, `/{id}/delete`, `/{id}/passages`, `/search` | read: `library.knowledge` or `agents.view`; change: `library.knowledge` |
| GET/POST | `/api/orgs/{slug}/uploads`, `/{id}/uploaded`, `/{id}/delete`, `/{id}/transcript` | read: `library.uploads`, or `agents.view` with `calls.personal`; change: `library.uploads` |
| GET/POST | `/api/orgs/{slug}/agents`, `/agents/{id}`, `/publish`, `/discard`, `/rollback`, `/settings`, `/delete`, `/scenarios…` | see `routes/org/agents.py`: list for members; open with `agents.view`/`test`/`configure`; edit `agents.configure` (structure: master admin); publish `agents.publish`; delete master admin |
| GET/POST | `/api/orgs/{slug}/drafts`, `/drafts/{id}`, `/discard`, `/publish` | master admin only. Publishing is safe to retry |
| GET | `/api/catalogue/agent-types`, `/api/catalogue/voices` | anyone signed in |
| GET | `/api/catalogue/models`, `/api/catalogue/voices/live` | anyone signed in. The voice server's enabled models and its TTS voices |
| GET/POST | `/api/orgs/{slug}/agents/{id}/voice`, `/voice/sync` | see `routes/org/voice.py`: the agent's copies on the voice server (`agents.view`/`test`/`configure`); send the published version again (`agents.publish`) |
| POST | `/api/orgs/{slug}/agents/{id}/voice-token` (`{"target": "test" \| "live"}`), `/drafts/{id}/voice-token`, `/voice/calls/{id}/transcript` (GET) | `agents.test` (drafts: master admin). A ten-minute browser token for a test call; staff can't start one |
| POST | `/api/orgs/{slug}/agents/{id}/scenarios/run` | `agents.test`. Runs every scenario as text against the saved setup |
| POST | `/api/orgs/{slug}/voice/preview` | `agents.configure` or `agents.test`. A WAV sample in the agent's voice, 10 a minute |
| GET | `/api/orgs/{slug}/live-calls`, `/live-calls/{id}` | `calls.viewAll` or `calls.take`. Calls on the voice server now, with the transcript so far |
| POST | `/api/orgs/{slug}/live-calls/{id}/end`, `/interrupt`, `/say`, `/handoff`, `/release`, `/operator-token` | `calls.take`, not bitNtech staff |
| POST | `/api/orgs/{slug}/calls/sync` | `calls.viewAll`. Brings finished calls into Call history (once each) |
| POST | `/api/hooks/orchestrator` | the orchestrator, signed (HMAC). Call ended, handoff requested/accepted/released/timeout |
| GET | `/api/ops/voice/status`, `/voice/models`, `/voice/sessions`, `/api/ops/orgs/{slug}/voice` | bitNtech staff and master admin |
| GET/POST | `/api/ops/voice/config`, `/config/schema`, `/config/history`, `/config/replace`, `/config/reset`, `/presets`, `/presets/{name}/apply`, `/models`, `/models/{kind}/{id}/switch`, `/asr/{name}/load\|unload`, `/upstreams/{llm\|tts}/test`, `/reload/{component}`, `/admission`, `/sessions/{id}/end`, `/api/ops/orgs/{slug}/voice` (POST) | master admin only. Writes carry the version loaded (`conflict` when stale), support `dryRun`, and go to the audit log |
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

`app/access/orgs.py` guards every `/api/orgs/{slug}` route. The member record (`orgs/{slug}/members/{uid}`) decides, on every request; the browser's idea of a role is never used. The table of role defaults and who may hold each permission is [`app/access/permissions.json`](app/access/permissions.json), shared with `frontend/src/console/access.ts` (a test on each side fails if they drift).

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

`firestore/indexes.json` lists every composite index the API's queries need. Create them **before** deploying code that uses them, either with `firebase deploy --only firestore:indexes` from `backend/` (needs a `firebase.json` pointing at the file), or by hand in Firebase console → Firestore Database → Indexes → Composite:

- collection `audit`: `action` (or `actor`, or `target`) Ascending, then `at` Descending;
- collection `calls`: `agentId`, `outcome`, `handledById` (any combination, Ascending), optionally `searchTokens` (Array contains), then `startedAt` Descending — 15 indexes;
- collection `callbacks`: `status`, `assignedToId`;
- collection `rollups`: `agentId` Ascending, `day` Ascending;
- field overrides with **collection-group** scope on `changeRequests`: `status` and `updatedAt` (for `/api/ops/change-requests`);
- collection `activity` (scope: collection): each of `area`; `actorId`; `area`, `actorId`; `ownerOnly`; `ownerOnly`, `area`; `ownerOnly`, `actorId`; `ownerOnly`, `area`, `actorId` — all Ascending — then `at` Descending.

Until they exist, the unfiltered audit log and an owner's unfiltered activity work, and other queries answer 503 with an explanation.

### Sample operations data for staging

Until the voice pipeline writes calls: `.venv/bin/python -m app.scripts.seed_operations --org <slug>` says what it would write, and `--yes` writes it. It refuses organisations whose name or slug doesn't contain "test" or "demo" (unless `--force`), and marks every record `seeded: true`.

### Storage bucket for uploads

Create a bucket in asia-south1 (or use the Firebase project's default one): private, uniform bucket-level access, no public access. The browser uploads to it directly, so it needs a CORS rule:

```json
[{"origin": ["https://aica.bitntech.in"], "method": ["PUT"], "responseHeader": ["Content-Type", "x-goog-content-length-range"], "maxAgeSeconds": 3600}]
```

(`gcloud storage buckets update gs://<bucket> --cors-file=cors.json`, with each `APP_URL` origin listed.) The service account the API runs as signs the URLs and reads object sizes; it needs `roles/storage.objectAdmin` on the bucket.

### Report rollups

Reports read `rollups`, which `app.domain.rollups.record_call` keeps up to date as calls are written. To recount an organisation: `.venv/bin/python -m app.scripts.rebuild_rollups --org <slug>`.

### Firestore TTL for rate-limit counters

Firebase console → Firestore Database → TTL → create a policy on collection group `ratelimits`, field `expiresAt`. Without it, the counters (a few small documents a minute) are never deleted.
