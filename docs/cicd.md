# CI/CD

GitHub Actions runs the checks and drives Vercel. Vercel's own Git
auto-deploy is off (`git.deploymentEnabled: false` in `vercel.json`), so
nothing ships unless CI passes.

```
PR ──► CI ──► Vercel preview ──► smoke test ──► preview URL commented on the PR
main ─► CI ──► approval (production environment) ──► Vercel production ──► smoke test
```

| File | What |
|---|---|
| `.github/workflows/pipeline.yml` | Entry point for PRs, pushes to `main` and manual runs |
| `.github/workflows/ci.yml` | Reusable CI: frontend typecheck, tests, build; backend pytest; gitleaks, `npm audit`, `pip-audit` |
| `.github/scripts/smoke.sh` | Post-deploy checks: `/api/health`, `/api/auth/session` (401), `/`, and the SPA fallback |
| `.github/dependabot.yml` | Weekly npm, pip and Actions updates |
| `vercel.json` | One Vercel project, two [Services](https://vercel.com/docs/services) (beta): `console` (Vite, `frontend/`) and `api` (FastAPI, `backend/app/main.py`) |
| `.vercelignore` | Keeps `.env`, `secrets/`, virtualenvs and tests out of the upload |

## How the deployment fits together

Both services are on one domain. Vercel sends `/api/*` to the FastAPI app,
which sees the original path, so the routes are the same as in local dev.
Everything else goes to the static console, and unknown paths fall back to
`index.html`. The session cookie and the backend's CSRF origin check
therefore work the same way as with the Vite proxy locally.

On Vercel, the backend reads Vercel's system variables (see
`backend/app/settings.py`):

- **Allowed origins:** a deployment always accepts writes from its own hostnames: `VERCEL_URL`, `VERCEL_BRANCH_URL` and `VERCEL_PROJECT_PRODUCTION_URL`. That's what makes preview URLs work, since they aren't known in advance. Other `*.vercel.app` origins are still refused.
- **`APP_URL`** defaults to the production URL in production, and to the branch URL or deployment URL on previews.
- **`COOKIE_SECURE`** defaults to `true`.

Anything you set explicitly overrides these defaults.

## One-time setup

### 1. Vercel

1. Use a **Pro** team. The Hobby plan is for non-commercial use only.
2. Create the project from the repository root, either with `npx vercel@60.1.3 link` locally or by importing the repo in the dashboard. Leave the root directory as the repo root, because `vercel.json` defines the services.
3. **Settings → Environment Variables.** Set these for **Production** and for **Preview**. Use the **preview Firebase project** for Preview, so PR previews never touch real users or send real emails.

   | Key | Notes |
   |---|---|
   | `FIREBASE_CREDENTIALS_JSON` | The whole service-account key JSON. Mark it Sensitive |
   | `FIREBASE_WEB_API_KEY` | That Firebase project's Web API key |
   | `FIRESTORE_DATABASE` | `(default)` unless the project uses another ID |
   | `RESEND_API_KEY`, `EMAIL_FROM` | `EMAIL_FROM` must be on a domain verified in Resend |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional on Preview. Leave both empty to switch Google sign-in off |
   | `APP_URL`, `ALLOWED_ORIGINS` | **Production:** set both to the production URL, for example `https://aica-console.vercel.app`, so email links stay stable. **Preview:** leave unset |

4. Make sure **Settings → Environment Variables → "Automatically expose System Environment Variables"** is on. It's the default.
5. **Deployment Protection:** if previews are protected (the default), go to **Settings → Deployment Protection → Protection Bypass for Automation**, create a secret, and save it in GitHub as `VERCEL_AUTOMATION_BYPASS_SECRET` (below). The smoke test sends it in a header.
6. Create a token under **Account Settings → Tokens**, scoped to the team.

### 2. GitHub (`bitNtech/aica_software`)

**Settings → Secrets and variables → Actions**

| Kind | Name | Value |
|---|---|---|
| Secret | `VERCEL_TOKEN` | The token from step 1.6 |
| Secret | `VERCEL_AUTOMATION_BYPASS_SECRET` | Optional. Needed only if Deployment Protection is on |
| Variable | `VERCEL_ORG_ID` | `orgId` from `.vercel/project.json` after `vercel link` |
| Variable | `VERCEL_PROJECT_ID` | `projectId` from the same file |

Deploy jobs **skip** until `VERCEL_PROJECT_ID` is set, so CI works on its own before Vercel is configured.

**Settings → Environments**

- `production`: add **required reviewers**, which is the manual approval gate, and limit deployment branches to `main`.
- `preview`: no rules needed.

**Settings → Branches → `main`:** require pull requests, and require these status checks: `ci / Frontend (types, tests, build)`, `ci / Backend (pytest)` and `ci / Security (secrets, dependency audit)`.

### 3. Firebase and Google, per environment

- Paste `backend/firestore.rules` into each Firebase project, and seed master admins in each with `app.scripts.seed_master`.
- **Google sign-in** needs each redirect URI registered on the OAuth client: `<APP_URL>/api/auth/google/callback`. Production has one stable URL. Preview URLs change with every deployment and Google doesn't allow wildcards, so Google sign-in works on previews only if you put them behind one fixed domain and set it as the Preview `APP_URL`. Email and password sign-in works everywhere.

## Day to day

- **Open a PR:** CI runs. If it passes, a preview deploys, gets smoke-tested, and the URL is posted on the PR. Fork and Dependabot PRs stop after CI because they get no secrets.
- **Merge to `main`:** CI runs, then the production job waits for approval, deploys, and gets smoke-tested.
- **Rollback:** in the Vercel dashboard, open **Deployments**, pick the previous production deployment and click **Instant Rollback**, or run `npx vercel@60.1.3 rollback <deployment-url> --token=…`. The frontend and API roll back together because they're one deployment.
- **Run CI by hand:** Actions → CI → Run workflow.

### Running the checks locally

```bash
cd frontend && npm ci && npm run typecheck && npm test && npm run build
cd backend && .venv/bin/python -m pytest
.github/scripts/smoke.sh https://<deployment-url>
```

## Known limitations

- **Services are in beta on Vercel.** If a CLI or platform change breaks the build, pin `VERCEL_CLI` in `pipeline.yml` to the last working version.
- **Rate limiting is in-process** (`app/ratelimit.py`), so it doesn't hold across serverless instances. The per-email login lockout is in Firestore and still works. A shared limiter, such as Redis or Upstash, needs its own plan.
- **Cold starts:** each new instance initialises firebase-admin and checks that the Firestore database exists.
- **Actions are pinned to version tags, not commit hashes.** Dependabot keeps them current. The gitleaks binary is pinned by version and SHA-256.
