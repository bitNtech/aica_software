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
| `DEMO_REQUEST_TO` | Who receives the landing page's "Book a demo" requests, comma-separated. Default `support@bitntech.in` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The OAuth web client Firebase created for Google sign-in. Leave both empty to switch Google sign-in off: the button then returns to the login page with a "not set up yet" message |
| `APP_URL` | The frontend's public URL, for email links and the redirect after Google. `http://localhost:5173` locally. **Required on Vercel** |
| `API_URL` | This API's public URL when it has its own host, e.g. `https://api.aica.bitntech.in`; the Google redirect URI is built from it. Empty locally (same origin through the Vite proxy). On Vercel it defaults to the deployment's own URL |
| `ALLOWED_ORIGINS` | Frontend origins allowed to call the API with cookies (CORS) and to make writes, comma-separated. Defaults to `APP_URL`'s origin |
| `COOKIE_SECURE` | `true` behind HTTPS (required in production). Defaults to `true` on Vercel |
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
| GET/POST | `/api/invites/{token}`, `/api/invites/{token}/accept` | anyone holding the link |
| POST | `/api/leads/demo` | anyone, from an allowed origin. The landing page's demo form: validated, emailed to `DEMO_REQUEST_TO` through Resend, not stored. 204 when sent, 503 when Resend fails, 5 per minute per IP. A filled-in `website` honeypot gets 204 and is dropped |
| GET | `/api/ops/orgs`, `/api/ops/signup-requests` | bitNtech staff and master admin |
| POST | `/api/ops/signup-requests/{slug}/approve`, `/decline` | bitNtech staff and master admin |
| POST | `/api/ops/orgs/{slug}/suspend`, `/restore`, `/api/ops/staff-invites` | master admin only |

Errors are always `{"error": {"code", "message", "retryAfter"?}}`, with codes matching the frontend's `AuthErrorCode`.

Protections:
- CORS allows only the exact origins in `ALLOWED_ORIGINS`, with credentials, `GET`/`POST` and the `Accept`/`Content-Type` headers.
- Writes whose `Origin` isn't in `ALLOWED_ORIGINS` get 403, as CSRF protection.
- Login pauses for 15 minutes after 5 failures per email; this is stored in Firestore.
- There's a per-IP limit on sign-up, reset and resend. It's in-process, so add a shared limiter before running more than one worker.
- Forgot-password and resend give the same answer whether or not the account exists.
- Invite tokens are stored hashed.
- Ops decisions are written to the `audit` collection.
