# AICA console — frontend

React 19 + TypeScript + Vite, styled with plain CSS on shared design tokens. The stack and design language match `aica_web` (aica.bitntech.in), and through it bitntech.in: near-black, cream, plum and orange; Archivo, DM Sans and DM Mono; pill buttons; mono kicker labels. AICA blue appears only where AICA itself is shown, in its voice line.

```
npm install
npm run api         # the FastAPI backend on :8000 (see ../backend/README.md)
npm run dev         # http://localhost:5173 → /login, against the backend (Vite proxies /api)
npm run dev:demo    # the same pages against the in-browser mock, no backend needed
npm test            # vitest + Testing Library
npm run typecheck
npm run build
```

`.npmrc` sets `legacy-peer-deps`. Without it, the system npm 9 on this machine crashes while resolving peers (`Cannot read properties of null (reading 'edgesOut')`). Because peers aren't auto-installed, `@testing-library/dom` is listed explicitly.

## Auth clients

Every page talks to the `AuthClient` interface in `src/auth/types.ts`. `src/main.tsx` picks the implementation:

- **`httpClient.ts`** is the default. It calls only the AICA backend under `/api`. The session is the backend's HttpOnly cookie, so no token is ever held in JavaScript. "Continue with Google" is a plain link to `/api/auth/google/start`, and the whole OAuth exchange happens server-side.
- **`mockClient.ts`**, used with `npm run dev:demo` and in tests. Everything below describes it.

## Demo mode (mock client)

`createMockAuthClient()` The mock runs entirely in the browser and sends no requests. Its demo "database" lives in this browser's localStorage, so a full flow survives a reload. The session is a user id in sessionStorage, or in localStorage when "Keep me signed in" is ticked. Every page shows a **Demo mode** badge. The login page's demo panel has a **reset demo data** link.

Password for every demo account: `aica-demo-2026`.

| Account | What it shows |
|---|---|
| `master@example.com` | **Master admin** (bitNtech). Goes to `/ops`, approves or declines sign-ups, suspends or restores organisations |
| `ops@example.com` | **bitNtech staff**. Goes to `/ops`, can review sign-ups, can't suspend |
| `frontdesk@example.com` | One active hospital, goes straight in |
| `admin@example.com` | Two active hospitals, lands on `/choose` |
| `pending@example.com` | Sign-up in review → `/pending` |
| `anitha@example.com` | Signed up but email not verified → sent to verify. Its approval is locked in Ops |
| `suspended@example.com` | Organisation suspended by bitNtech → `/suspended` |
| `locked@example.com` / `offline@example.com` | Locked account / network error |
| 5 wrong passwords | Sign-in paused for 15 minutes, with a countdown |
| `/invite/demo` · `/invite/staff` · `/invite/expired` · `/invite/used` | Team invite, bitNtech staff invite, and the failure states |

**Full loop:** `/signup` → open the demo verification link → sign in (in review) → sign out → sign in as `master@example.com` → Sign-up requests → Approve → sign out → sign in as the new owner → in.

To go live: implement `AuthClient` against the real API and pass it to `<AuthProvider>` in `main.tsx`. Then remove the demo-accounts block in `LoginPage.tsx`; it only renders when `client.isDemo` is true. The client-side checks give faster feedback and nothing more. The server must enforce every rule itself:
- password policy, lockout and token expiry
- the email-verified gate
- role checks on every ops call; the UI hiding a button is not access control

## Accounts and roles

| Level | Who | Lands on | Can |
|---|---|---|---|
| Master admin | bitNtech, seeded, never self-registered | `/ops` | Everything, including suspending or restoring organisations |
| bitNtech staff | Invited by a master admin | `/ops` | Review sign-ups; can't suspend |
| Owner / Admin / Supervisor / Front desk / Viewer | Client staff | `/o/:slug` | Per organisation |

An organisation is `pending_review` → `active` | `declined`, and an active one can become `suspended` (master admin only). `homeFor()` in `src/auth/AuthProvider.tsx` decides where each person lands.

## Routes

| Route | Page |
|---|---|
| `/login` | Sign in for everyone. bitNtech accounts go to `/ops`, clients to their organisation |
| `/signup` | A business signs up, in two steps: owner account, then business. It ends in review |
| `/signup/verify`, `/verify/:token` | "Check your email", and the emailed confirmation link |
| `/reset`, `/reset/:token` | Request a reset link; choose a new password |
| `/invite/:token` | Accept a team or bitNtech staff invitation |
| `/choose` | Pick an organisation (only with more than one active) |
| `/pending` | Sign-up in review, or declined with the reason |
| `/suspended` | Organisation paused by bitNtech, with the reason |
| `/signed-out`, `/session-expired` | After signing out; after 30 minutes idle (returns you to the page after signing in) |
| `/o/:slug` | Placeholder landing until the portal exists |
| `/ops`, `/ops/requests` | bitNtech: every organisation (worst first); the sign-up review queue |
| `/403`, `*` | System states |

MFA is out of scope by decision.

## Layout

```
src/styles/tokens.css        brand + surface tokens (light/dark); .stage = always-dark surface
src/styles/base.css          reset, focus ring, .label, .display, .btn pills, .link
src/styles/components.css    field, checkbox, alert, chip, strength meter, voice line, chooser…
src/components/ui/           Button, TextField/PasswordField/Checkbox, ChoiceGroup, Stepper, ReasonForm, Alert, PulseLine…
src/components/auth/         AuthLayout (stage + paper frame), FullScreenStatus, useCountdown
src/components/ops/          OpsLayout (night bar, orange hairline, paper canvas)
src/auth/                    types + AuthClient contract, mock client, provider, guards, validation
src/pages/                   one file per route (ops/ for bitNtech); SystemPage holds 404/403/crash + ErrorBoundary
src/test/                    validation unit tests; full flows through the router (auth, signup + ops)
```

New screens should use the same tokens and the classes in `base.css` and `components.css`, not new colours or one-off buttons.
