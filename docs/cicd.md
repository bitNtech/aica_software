# CI/CD

GitHub Actions runs the checks and drives Vercel. There is **one long-lived
branch, `main`, and one environment, production**. The frontend and the
backend are **two Vercel projects on two hosts**, configured entirely by
environment variables. Vercel's own Git auto-deploy is off
(`git.deploymentEnabled: false` in each `vercel.json`), so nothing ships
unless CI passes.

```
PR ──► CI: frontend · backend · security
         │  all three must pass before the PR can merge
         ▼
   approve and merge the PR  (merging is the approval)
         ▼
main ──► CI again ──► backend production ──► smoke test ──► frontend production ──► smoke test
           └─ any check fails → nothing deploys
```

Work happens on a short-lived branch, which GitHub deletes automatically when
its PR merges. Nobody pushes to `main` directly: the `main` ruleset requires
a PR, the three CI checks, and blocks force-pushes and deletion.

| File | What |
|---|---|
| `.github/workflows/pipeline.yml` | Entry point for PRs, pushes to `main` and manual runs |
| `.github/workflows/ci.yml` | Reusable CI: frontend typecheck, tests, build; backend pytest; gitleaks, `npm audit`, `pip-audit` |
| `.github/workflows/deploy.yml` | Reusable: deploy one target (`frontend` or `backend`) to production on its Vercel project, then smoke-test it |
| `.github/scripts/smoke.sh` | `smoke.sh backend <url>`: `/api/health`, `/api/auth/session` (401). `smoke.sh frontend <url>`: the landing page at `/` and its media, `/login`, the console fallback |
| `.github/dependabot.yml` | Weekly npm, pip and Actions update PRs, which go through the same checks |
| `frontend/vercel.json`, `frontend/.vercelignore` | The static frontend: landing page and console, cache headers, console fallback |
| `backend/vercel.json`, `backend/.vercelignore` | The FastAPI app (`app/main.py`). Keeps `.env`, `secrets/`, virtualenvs and tests out of the upload |

## How the deployment fits together

Example hosts (use your own; they must **share a site**, i.e. sit under the same registrable domain):

| | Production |
|---|---|
| Frontend | `https://aica.bitntech.in` |
| Backend | `https://api.aica.bitntech.in` |

- **Frontend** (`frontend/`): one static build with two pages. `index.html` is the prerendered landing page at `/`; `app.html` is the console's shell, and any path that isn't a real file falls back to it. Hashed files in `/static/*` are immutable; the landing page's fixed-name media in `/assets/*` is cached for a day. It calls the backend at `VITE_API_URL`, with the session cookie (`credentials: 'include'`).
- **Backend** (`backend/`): the API under `/api/*`. It allows CORS with credentials, and writes, only from `ALLOWED_ORIGINS` (exact origins, no wildcard). The session cookie is HttpOnly, `Secure` and `SameSite=Lax`, set on the API's host.
- **Why the hosts must share a site:** browsers send a `SameSite=Lax` cookie on the frontend's `fetch` to the API only when both hosts share a site. `*.vercel.app` is a public suffix, so two `vercel.app` hosts are different sites and sign-in would fail. Use custom domains for both projects.
- **Google sign-in** is a top-level navigation to `<API_URL>/api/auth/google/start`. Google returns to `<API_URL>/api/auth/google/callback`, the API sets the session cookie on its own host, and sends the browser to `<APP_URL>/login`.
- **Locally** nothing changes: leave `VITE_API_URL` empty, and `npm run dev` proxies `/api` to the API on `:8000`, all same-origin.

### Environment variables (Production)

**Frontend project** (build time: Vite inlines `VITE_*` into the bundle, so nothing secret goes here; see `frontend/.env.example`):

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://api.aica.bitntech.in` |
| `VITE_CONSOLE_MODE` | `live` to serve organisation pages from the API where it exists; anything else keeps every page on sample data |
| `VITE_CONSOLE_LIVE` | With `live`: the sections served by the API, comma-separated. Default `team,settings,activity,requests`. Add `calls,callbacks,appointments,handoffs,reports` only where calls exist (staging with seeded data, or once the pipeline sends them), and `numbers,tools,knowledge,uploads,agents` once agents are built on the server |

**Backend project** (runtime; see `backend/README.md`):

| Key | Notes |
|---|---|
| `APP_URL` | **Required.** The frontend's public URL, `https://aica.bitntech.in`. Email links and the post-Google redirect use it. The API refuses to start on Vercel without it |
| `ALLOWED_ORIGINS` | Optional. Defaults to `APP_URL`'s origin. Comma-separated if more than one frontend origin may call the API |
| `API_URL` | Optional. The API's public URL, used for the Google redirect URI. Defaults to the project's production Vercel URL; set it to the custom domain (`https://api.aica.bitntech.in`) so the redirect URI is stable |
| `COOKIE_SECURE` | Defaults to `true` on Vercel |
| `COOKIE_SAMESITE` | Leave as `lax`. `none` exists for hosts on unrelated domains, needs `COOKIE_SECURE=true`, and is dropped by browsers that block third-party cookies |
| `FIREBASE_CREDENTIALS_JSON` | The whole service-account key JSON. Mark it Sensitive |
| `FIREBASE_WEB_API_KEY` | That Firebase project's Web API key |
| `FIRESTORE_DATABASE` | `(default)` unless the project uses another ID |
| `RESEND_API_KEY`, `EMAIL_FROM` | `EMAIL_FROM` must be on a domain verified in Resend |
| `DEMO_REQUEST_TO` | Who receives the landing page's demo requests, comma-separated. Defaults to `support@bitntech.in` |
| `CHANGE_REQUESTS_TO` | Who at bitNtech is emailed about requests from organisations, comma-separated. Defaults to `support@bitntech.in` |
| `LOG_FORMAT` | Defaults to `json` on Vercel |
| `SECRETS_KEY` | **Sensitive.** 32 random bytes, base64: encrypts organisations' system secrets. Keep a copy outside Vercel |
| `STORAGE_BUCKET` | The private bucket for uploads (see `backend/README.md`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Leave both empty to switch Google sign-in off |
| `ACT_AS_MINUTES` | Optional. How long a master admin's "act as" session lasts. Default 30 |

Anything you set explicitly overrides the defaults. A change to a frontend variable needs a redeploy, because it's built in.

## One-time setup

### 1. Vercel

1. Use a **Pro** team. The Hobby plan is for non-commercial use only.
2. Create **two projects** in the team, e.g. `aica-frontend` and `aica-api`. Run `npx vercel@60.1.3 link` in `frontend/` and again in `backend/`, or create them in the dashboard. **Leave each project's Root Directory empty:** CI uploads only that directory (`vercel deploy --cwd frontend|backend --prod`), so its own `vercel.json` applies. Framework presets: Vite for the frontend, FastAPI for the backend (both also set in `vercel.json`).
3. **Domains:** `aica.bitntech.in` on the frontend, `api.aica.bitntech.in` on the backend.
4. **Settings → Environment Variables** in each project, for **Production**, as in the tables above. Nothing is needed for Preview or Development.
5. Make sure **"Automatically expose System Environment Variables"** is on in the backend project. It's the default.
6. **Deployment Protection:** the smoke tests call the new deployment's own `*.vercel.app` URL, which Vercel protects by default. Create a **Protection Bypass for Automation** secret in each project, use the same value in both, and save it in GitHub as `VERCEL_AUTOMATION_BYPASS_SECRET`; the smoke tests send it. The production custom domains stay public.
7. Create a token under **Account Settings → Tokens**, scoped to the team.

### 2. GitHub (`bitNtech/aica_software`)

**Settings → Secrets and variables → Actions**

| Kind | Name | Value |
|---|---|---|
| Secret | `VERCEL_TOKEN` | The token from step 1.7 |
| Secret | `VERCEL_AUTOMATION_BYPASS_SECRET` | Needed while Deployment Protection is on |
| Variable | `VERCEL_ORG_ID` | `orgId` from `.vercel/project.json` after `vercel link` (the same in both) |
| Variable | `VERCEL_FRONTEND_PROJECT_ID` | `projectId` from `frontend/.vercel/project.json` |
| Variable | `VERCEL_BACKEND_PROJECT_ID` | `projectId` from `backend/.vercel/project.json` |

Deploy jobs **skip** until both project IDs are set, so CI works on its own before Vercel is configured.

**Settings → Environments → `Production`:** limit deployment branches to `main`. No required reviewers: merging the PR is the approval.

**Settings → Rules → the `main` ruleset:** require a pull request (0 approvals; whoever merges approves), require the status checks `ci / Frontend (types, tests, build)`, `ci / Backend (pytest)` and `ci / Security (secrets, dependency audit)`, and block deletion and force-pushes.

**Settings → General → Pull Requests:** turn on **Automatically delete head branches**, so `main` stays the only branch.

### 3. Firebase and Google

- Paste `backend/firestore.rules` into the Firebase project, create the indexes in `backend/firestore.indexes.json`, and seed master admins with `app.scripts.seed_master`.
- **Google sign-in** needs the redirect URI registered on the OAuth client: `https://api.aica.bitntech.in/api/auth/google/callback`. Set `API_URL` explicitly on the backend so this stays stable. Locally it's `http://localhost:5173/api/auth/google/callback`, through the Vite proxy.

## Day to day

- **Make a change:** branch from `main`, push, open a PR. CI runs on it. The PR can't merge until all three checks pass.
- **Ship it:** merge the PR. CI runs again on `main`; if it passes, the backend deploys to production and is smoke-tested, then the frontend. If CI or the backend's smoke test fails, the frontend isn't deployed. The branch is deleted automatically.
- **Rollback:** in each project's Vercel dashboard, open **Deployments**, pick the previous production deployment and click **Instant Rollback**, or run `npx vercel@60.1.3 rollback <deployment-url> --token=…`. The two projects roll back **independently**; roll the frontend back too if the API change it relied on is reverted. Then revert the commit on `main` through a PR, so the next deploy doesn't bring it back.
- **Re-run a deploy:** Actions → CI/CD → the run → Re-run failed jobs. Or Actions → CI/CD → Run workflow on `main`, which runs CI and deploys.

### Running the checks locally

```bash
cd frontend && npm ci && npm run typecheck && npm test && npm run build
cd backend && .venv/bin/python -m pytest
.github/scripts/smoke.sh backend https://<backend-deployment-url>
.github/scripts/smoke.sh frontend https://<frontend-deployment-url>
```

To try the split locally: run the API on `:8000` with `APP_URL=http://localhost:5173` and `API_URL=http://localhost:8000`, then build the frontend with `VITE_API_URL=http://localhost:8000` and serve it with `npx vite preview --host localhost --port 5173`. Use `localhost` for both, not `127.0.0.1` for one of them, so they share a site.

## Known limitations

- **No staging:** a PR is checked by CI only, never deployed, so the first time a change runs on Vercel is in production. Test locally (above) before merging anything that touches deployment, cookies or environment variables.
- **Rate limiting is in-process** (`app/ratelimit.py`), so it doesn't hold across serverless instances. The per-email login lockout is in Firestore and still works. A shared limiter, such as Redis or Upstash, needs its own plan.
- **Cold starts:** each new backend instance initialises firebase-admin and checks that the Firestore database exists.
- **Actions are pinned to version tags, not commit hashes.** Dependabot keeps them current. The gitleaks binary is pinned by version and SHA-256.
