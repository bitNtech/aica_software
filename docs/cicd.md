# CI/CD

GitHub Actions runs the checks and drives Vercel. The frontend and the
backend are **two Vercel projects on two hosts**, configured entirely by
environment variables. Vercel's own Git auto-deploy is off
(`git.deploymentEnabled: false` in each `vercel.json`), so nothing ships
unless CI passes.

```
PR ──► CI ──► backend preview ─┐
          └─► frontend preview ┴─► smoke tests ──► preview URLs commented on the PR
main ─► CI ──► approval ──► backend production ──► approval ──► frontend production (each smoke-tested)
```

| File | What |
|---|---|
| `.github/workflows/pipeline.yml` | Entry point for PRs, pushes to `main` and manual runs |
| `.github/workflows/deploy.yml` | Reusable: deploy one target (`frontend` or `backend`) to its Vercel project, optionally point a fixed preview domain at it, smoke-test it |
| `.github/workflows/ci.yml` | Reusable CI: frontend typecheck, tests, build; backend pytest; gitleaks, `npm audit`, `pip-audit` |
| `.github/scripts/smoke.sh` | `smoke.sh backend <url>`: `/api/health`, `/api/auth/session` (401). `smoke.sh frontend <url>`: the landing page at `/` and its media, `/login`, the console fallback |
| `.github/dependabot.yml` | Weekly npm, pip and Actions updates |
| `frontend/vercel.json`, `frontend/.vercelignore` | The static frontend: landing page and console, cache headers, console fallback |
| `backend/vercel.json`, `backend/.vercelignore` | The FastAPI app (`app/main.py`). Keeps `.env`, `secrets/`, virtualenvs and tests out of the upload |

## How the deployment fits together

Example hosts (use your own; they must **share a site**, i.e. sit under the same registrable domain):

| | Production | Preview |
|---|---|---|
| Frontend | `https://aica.bitntech.in` | `https://preview.aica.bitntech.in` |
| Backend | `https://api.aica.bitntech.in` | `https://api-preview.aica.bitntech.in` |

- **Frontend** (`frontend/`): one static build with two pages. `index.html` is the prerendered landing page at `/`; `app.html` is the console's shell, and any path that isn't a real file falls back to it. Hashed files in `/static/*` are immutable; the landing page's fixed-name media in `/assets/*` is cached for a day. It calls the backend at `VITE_API_URL`, with the session cookie (`credentials: 'include'`).
- **Backend** (`backend/`): the API under `/api/*`. It allows CORS with credentials, and writes, only from `ALLOWED_ORIGINS` (exact origins, no wildcard). The session cookie is HttpOnly, `Secure` and `SameSite=Lax`, set on the API's host.
- **Why the hosts must share a site:** browsers send a `SameSite=Lax` cookie on the frontend's `fetch` to the API only when both hosts share a site. `*.vercel.app` is a public suffix, so two `vercel.app` hosts are different sites and sign-in would fail. Use custom domains for both projects.
- **Google sign-in** is a top-level navigation to `<API_URL>/api/auth/google/start`. Google returns to `<API_URL>/api/auth/google/callback`, the API sets the session cookie on its own host, and sends the browser to `<APP_URL>/login`.
- **Locally** nothing changes: leave `VITE_API_URL` empty, and `npm run dev` proxies `/api` to the API on `:8000`, all same-origin.

### Environment variables

**Frontend project** (build time: Vite inlines `VITE_*` into the bundle, so nothing secret goes here; see `frontend/.env.example`):

| Key | Production | Preview |
|---|---|---|
| `VITE_API_URL` | `https://api.aica.bitntech.in` | `https://api-preview.aica.bitntech.in` |

**Backend project** (runtime; see `backend/README.md`). Use the **preview Firebase project** for Preview, so PR previews never touch real users or send real emails.

| Key | Notes |
|---|---|
| `APP_URL` | **Required.** The frontend's public URL: `https://aica.bitntech.in` (Production), `https://preview.aica.bitntech.in` (Preview). Email links and the post-Google redirect use it. The API refuses to start on Vercel without it |
| `ALLOWED_ORIGINS` | Optional. Defaults to `APP_URL`'s origin. Comma-separated if more than one frontend origin may call the API |
| `API_URL` | Optional. The API's public URL, used for the Google redirect URI. Defaults to this deployment's own Vercel URL; set it to the custom domain (`https://api.aica.bitntech.in`) so the redirect URI is stable |
| `COOKIE_SECURE` | Defaults to `true` on Vercel |
| `COOKIE_SAMESITE` | Leave as `lax`. `none` exists for hosts on unrelated domains, needs `COOKIE_SECURE=true`, and is dropped by browsers that block third-party cookies |
| `FIREBASE_CREDENTIALS_JSON` | The whole service-account key JSON. Mark it Sensitive |
| `FIREBASE_WEB_API_KEY` | That Firebase project's Web API key |
| `FIRESTORE_DATABASE` | `(default)` unless the project uses another ID |
| `RESEND_API_KEY`, `EMAIL_FROM` | `EMAIL_FROM` must be on a domain verified in Resend |
| `DEMO_REQUEST_TO` | Who receives the landing page's demo requests, comma-separated. Defaults to `support@bitntech.in`. On Preview, point it at a test inbox |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional on Preview. Leave both empty to switch Google sign-in off |

Anything you set explicitly overrides the defaults. A change to a frontend variable needs a redeploy, because it's built in.

## One-time setup

### 1. Vercel

1. Use a **Pro** team. The Hobby plan is for non-commercial use only.
2. Create **two projects** in the team, e.g. `aica-frontend` and `aica-api`. Run `npx vercel@60.1.3 link` in `frontend/` and again in `backend/`, or create them in the dashboard. **Leave each project's Root Directory empty:** CI uploads only that directory (`vercel deploy --cwd frontend|backend`), so its own `vercel.json` applies. Framework presets: Vite for the frontend, FastAPI for the backend (both also set in `vercel.json`).
3. **Domains:** add the production domains (`aica.bitntech.in` to the frontend, `api.aica.bitntech.in` to the backend). For working previews, also add `preview.aica.bitntech.in` and `api-preview.aica.bitntech.in`, to the same projects, without assigning them to a branch. CI points them at the latest preview.
4. **Settings → Environment Variables** in each project, for **Production** and **Preview**, as in the tables above.
5. Make sure **"Automatically expose System Environment Variables"** is on in the backend project. It's the default.
6. **Deployment Protection:** if previews are protected (the default), create a **Protection Bypass for Automation** secret in each project. Use the same value in both and save it in GitHub as `VERCEL_AUTOMATION_BYPASS_SECRET`; the smoke tests send it. A browser can't send that header, so for previews to work end to end, the backend project's preview domain must be reachable. Either exclude it from protection, or turn protection off for the backend's previews. The frontend can stay protected.
7. Create a token under **Account Settings → Tokens**, scoped to the team.

### 2. GitHub (`bitNtech/aica_software`)

**Settings → Secrets and variables → Actions**

| Kind | Name | Value |
|---|---|---|
| Secret | `VERCEL_TOKEN` | The token from step 1.7 |
| Secret | `VERCEL_AUTOMATION_BYPASS_SECRET` | Optional. Needed only if Deployment Protection is on |
| Variable | `VERCEL_ORG_ID` | `orgId` from `.vercel/project.json` after `vercel link` (the same in both) |
| Variable | `VERCEL_FRONTEND_PROJECT_ID` | `projectId` from `frontend/.vercel/project.json` |
| Variable | `VERCEL_BACKEND_PROJECT_ID` | `projectId` from `backend/.vercel/project.json` |
| Variable | `PREVIEW_FRONTEND_DOMAIN`, `PREVIEW_API_DOMAIN` | Optional: `preview.aica.bitntech.in`, `api-preview.aica.bitntech.in`. Without them previews still deploy and pass their smoke tests, but sign-in won't work on them |

Deploy jobs **skip** until both project IDs are set, so CI works on its own before Vercel is configured.

**Settings → Environments**

- `production`: add **required reviewers**, which is the manual approval gate, and limit deployment branches to `main`. The backend deploys first and the frontend after it, and each asks for approval.
- `preview`: no rules needed.

**Settings → Branches → `main`:** require pull requests, and require these status checks: `ci / Frontend (types, tests, build)`, `ci / Backend (pytest)` and `ci / Security (secrets, dependency audit)`.

### 3. Firebase and Google, per environment

- Paste `backend/firestore.rules` into each Firebase project, and seed master admins in each with `app.scripts.seed_master`.
- **Google sign-in** needs each redirect URI registered on the OAuth client: `<API_URL>/api/auth/google/callback`, e.g. `https://api.aica.bitntech.in/api/auth/google/callback` and `https://api-preview.aica.bitntech.in/api/auth/google/callback`. Set `API_URL` explicitly on the backend so this stays stable. Locally it's `http://localhost:5173/api/auth/google/callback`, through the Vite proxy.

## Day to day

- **Open a PR:** CI runs. If it passes, the backend and frontend previews deploy in parallel, get smoke-tested, and the URLs are posted on the PR. With the preview domains set, the latest PR's previews are at `preview.aica.bitntech.in`; two PRs open at once share them, and the last to deploy wins. Fork and Dependabot PRs stop after CI because they get no secrets.
- **Merge to `main`:** CI runs. The backend production job waits for approval, deploys and is smoke-tested, then the frontend does the same.
- **Rollback:** in each project's Vercel dashboard, open **Deployments**, pick the previous production deployment and click **Instant Rollback**, or run `npx vercel@60.1.3 rollback <deployment-url> --token=…`. The two projects roll back **independently**; roll the frontend back too if the API change it relied on is reverted.
- **Run CI by hand:** Actions → CI → Run workflow.

### Running the checks locally

```bash
cd frontend && npm ci && npm run typecheck && npm test && npm run build
cd backend && .venv/bin/python -m pytest
.github/scripts/smoke.sh backend https://<backend-deployment-url>
.github/scripts/smoke.sh frontend https://<frontend-deployment-url>
```

To try the split locally: run the API on `:8000` with `APP_URL=http://localhost:5173` and `API_URL=http://localhost:8000`, then build the frontend with `VITE_API_URL=http://localhost:8000` and serve it with `npx vite preview --host localhost --port 5173`. Use `localhost` for both, not `127.0.0.1` for one of them, so they share a site.

## Known limitations

- **Two deployments can drift:** a frontend preview talks to whichever backend preview the fixed preview domain points at.
- **Rate limiting is in-process** (`app/ratelimit.py`), so it doesn't hold across serverless instances. The per-email login lockout is in Firestore and still works. A shared limiter, such as Redis or Upstash, needs its own plan.
- **Cold starts:** each new backend instance initialises firebase-admin and checks that the Firestore database exists.
- **Actions are pinned to version tags, not commit hashes.** Dependabot keeps them current. The gitleaks binary is pinned by version and SHA-256.
