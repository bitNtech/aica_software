# Project Handoff

## Status
- Phase: Auth backend (FastAPI + Firebase) built and connected to the console frontend. **Not yet run against the real Firebase project:** it's waiting on `backend/.env`, the service-account key and the Google OAuth client (see "Needed from the user").
- Implementation approval:
  - 2026-10-11, sign-in pages
  - 2026-10-11, sign-up and master admin pages
  - 2026-10-12, CI/CD: own GitHub repo for `aica_software` (workflows in `.github/workflows/`), deploy to Vercel for every environment (PR previews and production), separate Firebase project for previews, `*.vercel.app` for now, manual approval before production, Dependabot
  - 2026-10-11, the backend: FastAPI, email/password and Google, Firestore `(default)` database (asia-south1; the user first said `aica`, but no database has that ID), Resend, master admins support@ and admin@bitntech.in, local env, default session lengths
- Last verified: 2026-10-11.
  - Backend: `pytest` 22/22 against in-memory fakes; startup fails fast with a clear message when the key is missing.
  - Frontend: `npm test` 48/48, `tsc` clean, `npm run build` passes.
  - Screenshots: API-mode login with the Google button, the Google-cancelled message, and the backend-down state.

## CI/CD (2026-10-12)
- **Done:**
  - `.github/workflows/ci.yml` runs frontend typecheck, tests and build; backend pytest on Python 3.14 (`backend/.python-version`); gitleaks, `npm audit --omit=dev` and `pip-audit`.
  - `.github/dependabot.yml` covers npm, pip and actions.
  - The root `.gitignore` is a safety net.
  - The backend accepts `FIREBASE_CREDENTIALS_JSON`, which overrides the file path (`app/services.py: firebase_certificate`, `tests/test_settings.py`).
- **Verified locally:** pytest 32/32; typecheck, 48/48 tests and build pass; `npm audit` finds 0. Not run locally: pip-audit (no pipx here), gitleaks, actionlint (not installed). Nothing has run on GitHub yet.
- **Blocked on a decision: Vercel topology.** The approved plan had two Vercel projects, with the console rewriting `/api` to the API project. That's circular for previews: the API's `ALLOWED_ORIGINS` and `APP_URL` need the console's preview URL, and the console's rewrite needs the API's URL. The recommendation is **one Vercel project** serving the static build plus `api/index.py`. The backend would add Vercel's system URLs (`VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`) to the allowed origins. That gives one deployment, one rollback and no version skew.
- **Not built yet:** `deploy.yml`, `vercel.json`, the Vercel entrypoint, `.vercelignore`, `docs/cicd.md`.
- **To do:** add `FIREBASE_CREDENTIALS_JSON=` to `backend/.env.example` (Claude can't read that file).
- **Vercel notes:**
  - Commercial use needs Pro.
  - The in-process rate limiter doesn't work across serverless instances.
  - Google sign-in on previews needs a fixed preview domain.
  - Vercel may not run the ASGI lifespan. The post-deploy smoke test checks `/api/auth/session` returns 401, not just `/api/health`, so a missing services container is caught.

## Goal
Develop production-ready software in this repository. Most work is expected to involve frontend implementation and integration with externally hosted ASR, TTS, and LLM services.

## Hard boundaries
- Work only in the current repository.
- ASR, TTS, and LLM inference are hosted on other servers; do not recreate or modify those services.
- No implementation, file changes, dependency installs, migrations, or deployments until the user approves the presented plan with `proceed`.
- Do not expose secrets or read `.env` files. `.claude/settings.json` denies reading `.env*`, `*secret*` and `*credential*`.

## Confirmed decisions
- **Design language:** bitntech.in / aica.bitntech.in.
- **Auth architecture:** the browser calls only the AICA backend (`/api/*`); the backend talks to Firebase. The session is a Firebase session cookie in an HttpOnly, SameSite=Lax cookie, verified on every request with revocation checks. The frontend loads no Firebase SDK, and Analytics is dropped.
- **Password sign-in:** the backend calls the Firebase Auth REST API to check the password, then creates the session cookie.
- **Google:** a server-side OAuth code flow with PKCE and a state cookie. The backend verifies the Google ID token, finds or creates the Firebase user by verified email, then signs in with a Firebase custom token. An unverified password account with that email gets verified and its password replaced. A new Google user with no organisation lands on `/signup/business`.
- **Emails:** sent by Resend from the backend. Firebase action codes are extracted from Admin SDK links and sent as the console's own `/verify/:code` and `/reset/:code` links, so the Firebase action URL doesn't need configuring.
- **Roles:**
  - Master admin and staff are the custom claim `platform_role`, set only by the backend: the seed script or a staff invite.
  - Hospital roles and organisation status are in Firestore.
  - Master admins: support@bitntech.in and admin@bitntech.in, via `app/scripts/seed_master.py`.
- **Sign-up model:** email verification, then bitNtech approval. Declines and suspensions carry a reason. Every Ops decision is audited.
- No MFA, by decision.

## Repository reconnaissance
- `frontend/`: React 19, TypeScript 6, Vite 8, react-router 7. `npm run dev` uses the API (Vite proxies `/api` to :8000); `npm run dev:demo` uses the in-browser mock.
- `backend/`: FastAPI on Python 3.14 (venv at `backend/.venv`), firebase-admin 7.7, httpx, pydantic-settings. Run `uvicorn app.main:app --port 8000 --reload` or `npm run api` from `frontend/`.
- The git root is `/home/prem2005/Desktop/bitntech`, with no root `.gitignore`. `backend/.gitignore` covers `.env` and `secrets/`, and `frontend/.gitignore` covers `.env.*`. Verified with `git check-ignore`.

## External service contracts
| Service | Protocol / endpoint | Auth | Status |
|---|---|---|---|
| AICA auth API | `backend/README.md` (routes table); error shape `{"error": {code, message, retryAfter?}}` | `aica_session` cookie | Built, tested with fakes |
| Firebase Auth | Admin SDK and Identity Toolkit REST (`signInWithPassword`, `signInWithIdp`, `accounts:update`, `accounts:resetPassword`) | Service account; web API key server-side | Waiting on credentials |
| Firestore | Database `(default)`, asia-south1: `users`, `orgs`, `invites` (hashed), `login_attempts`, `audit` | Admin SDK; client rules deny all (`backend/firestore.rules`) | Waiting on credentials |
| Resend | `POST https://api.resend.com/emails` | API key | Waiting on `.env` and a verified sender |
| Google OAuth | Code flow with PKCE; redirect `http://localhost:5173/api/auth/google/callback` | Client ID and secret | Waiting on credentials |
| ASR / TTS / LLM | Pending | Pending | Unknown |

## Needed from the user
1. **Rotate both pasted secrets.** The service-account key (`c340b741…`) and the Resend key were pasted in chat.
2. Save the new key as `backend/secrets/service-account.json`.
3. Create `backend/.env` from `.env.example` with `FIREBASE_WEB_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. **Resend sender:** verify a domain such as bitntech.in in Resend and set `EMAIL_FROM`. `onboarding@resend.dev` only delivers to the Resend account owner's address.
5. **Google:** add the redirect URI above to the "Web client (auto created by Google Service)" OAuth client, and give the client ID and secret via `.env`.
6. Paste `backend/firestore.rules` into Firestore Database → Rules.
7. Run `.venv/bin/python -m app.scripts.seed_master support@bitntech.in admin@bitntech.in`.

## Gotchas found in setup
- The Firestore database ID is `(default)`, not `aica`.
- Google sign-in originally used Firebase `signInWithIdp`, which rejected the `aica-n8n` OAuth client (project 283945393781). Since 2026-10-11 the backend verifies Google's ID token itself, then signs in with a Firebase custom token, so any OAuth client works. That path was verified against the real project: custom token → session cookie with `platform_role`.
- If Google's key servers can't be reached, session checks return 503 `network` and don't sign the person out.

## Known limitations and follow-ups
- Logout clears this browser's cookie only. Password resets revoke every session; suspensions don't revoke, but the guards route suspended users to `/suspended`.
- The rate limit is in-process. Use a shared limiter or the proxy's before running more than one worker.
- Login lockout is per email, stored in Firestore.
- Production needs HTTPS, `COOKIE_SECURE=true`, a real `APP_URL` and `ALLOWED_ORIGINS`, and the production redirect URI added to the Google client.
- **Not built yet:**
  - the Ops staff-management UI (the API `POST /api/ops/staff-invites` and a CLI exist)
  - team invites from a client organisation
  - impersonation
  - the portal (`/o/:slug` is a placeholder)
- Terms and privacy pages don't exist yet; the sign-up checkbox names them without links.
- **Copy that assumes a policy:** the pages say reset links last an hour and verification links 3 days, which are Firebase's defaults, and invites last 7 days (`INVITE_DAYS`). If anyone changes the expiry in Firebase, change the copy too.

## Next step
0. CI/CD: the user picks the Vercel topology (above), then build `deploy.yml` and the Vercel config. Then the user creates the GitHub repo and the Vercel project(s), and sets the secrets.
1. The user completes "Needed from the user", then run both servers and do one real end-to-end pass: sign up, verify, approve as master admin, sign in, Google sign-in, reset.
2. Then plan the Ops staff page or the portal shell.
