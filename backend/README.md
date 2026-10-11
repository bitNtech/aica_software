# AICA console — auth API

FastAPI service that does all authentication for the console. The browser
only ever calls this API under `/api`. The API talks to Firebase:

- **Firebase Auth** through the Admin SDK and the Auth REST API, for password sign-in, Google sign-in and email action codes
- **Firestore** (the project's `(default)` database, asia-south1) for profiles, organisations, invites and the audit trail
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

Invite bitNtech staff (until the Ops staff page exists): `.venv/bin/python -m app.scripts.invite_staff name@bitntech.in --by "Support"`.

Tests use in-memory fakes, with no network: `.venv/bin/python -m pytest`.

## Configuration (`backend/.env`, git-ignored)

| Key | What |
|---|---|
| `FIREBASE_CREDENTIALS` | Path to the service-account JSON, default `secrets/service-account.json` (git-ignored) |
| `FIREBASE_CREDENTIALS_JSON` | The service-account JSON itself, for hosts without a secrets file system (Vercel). Overrides `FIREBASE_CREDENTIALS` when set. Leave empty locally |
| `FIREBASE_WEB_API_KEY` | Project settings → General → Web API key. Server-side only |
| `FIRESTORE_DATABASE` | `(default)`, the project's only Firestore database (asia-south1) |
| `RESEND_API_KEY`, `EMAIL_FROM` | `EMAIL_FROM` must be on a domain verified in Resend. `onboarding@resend.dev` only delivers to the Resend account owner |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The OAuth web client Firebase created for Google sign-in. Leave both empty to switch Google sign-in off: the button then returns to the login page with a "not set up yet" message |
| `APP_URL`, `ALLOWED_ORIGINS` | `http://localhost:5173` locally |
| `COOKIE_SECURE` | `true` behind HTTPS (required in production) |

On Vercel, `APP_URL` defaults to the deployment's own URL, `COOKIE_SECURE` to `true`, and the deployment's own hostnames are always allowed origins. Explicit values win. See [`docs/cicd.md`](../docs/cicd.md).

## Firebase console setup

1. **Firestore → Rules:** paste [`firestore.rules`](firestore.rules), which denies all client access. Only this API, through the Admin SDK, uses the database.
2. **Authentication → Settings → User account linking:** keep "Link accounts that use the same email" (the default).
3. **Google sign-in:** any Google OAuth web client works. The backend verifies Google's ID token itself (signature, issuer, expiry, audience = `GOOGLE_CLIENT_ID`, verified email). It then signs the matching Firebase user in with a custom token, so Firebase's own Google provider settings aren't involved. On the client (Google Cloud console → APIs & Services → Credentials), add the authorised redirect URI `http://localhost:5173/api/auth/google/callback`. The app name Google shows comes from that project's OAuth consent screen (Branding).

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
| GET/POST | `/api/invites/{token}`, `/api/invites/{token}/accept` | anyone holding the link |
| GET | `/api/ops/orgs`, `/api/ops/signup-requests` | bitNtech staff and master admin |
| POST | `/api/ops/signup-requests/{slug}/approve`, `/decline` | bitNtech staff and master admin |
| POST | `/api/ops/orgs/{slug}/suspend`, `/restore`, `/api/ops/staff-invites` | master admin only |

Errors are always `{"error": {"code", "message", "retryAfter"?}}`, with codes matching the frontend's `AuthErrorCode`.

Protections:
- Writes whose `Origin` isn't in `ALLOWED_ORIGINS` get 403, as CSRF protection.
- Login pauses for 15 minutes after 5 failures per email; this is stored in Firestore.
- There's a per-IP limit on sign-up, reset and resend. It's in-process, so add a shared limiter before running more than one worker.
- Forgot-password and resend give the same answer whether or not the account exists.
- Invite tokens are stored hashed.
- Ops decisions are written to the `audit` collection.
