# Backend workflow: what to build, and how to connect it

**Status:** written 2026-10-19 from a read-only audit of `backend/` and `frontend/`. **Updated 2026-10-19: Foundations (§3) and Phase 1 (§4) are built and tested; see [Decisions](#decisions-made-while-building-foundations-and-phase-1) and [Follow-ups](#follow-ups-from-foundations-and-phase-1).** Phases 2–8 are still plans.
**Scope:** everything the backend still needs **except** the AI, LLM, voice-pipeline and agent-runtime work. That work is listed under [Out of scope](#out-of-scope-ai-llm-and-agent-work) so it isn't forgotten, but it isn't planned here.

Endpoint paths and collection names marked *proposed* don't exist yet. Agree on them before building.

---

## 1. Where things stand

### What works today

| Area | State |
|---|---|
| **Auth** | Live. Email/password through the Firebase Identity Toolkit, Google OAuth with PKCE, email verification, password reset, lockout after failed logins. |
| **Sessions** | Live. The `aica_session` cookie is HttpOnly and holds a Firebase session cookie, checked on every request. Lifetime is 8 hours, or 14 days with "remember me". |
| **Ops (bitNtech)** | Live. Signup review, org suspend/restore, staff invites, people management, act-as with an audit trail. |
| **Invites** | Live. Staff invitations, and organisation invitations from the Team page: revoked when resent or cancelled, accepted with a new account or, signed in, with an existing one (`POST /api/invites/{token}/join`). |
| **Organisations** | Live for Phase 1: `/api/orgs/{slug}/members…`, `/settings`, `/activity`, behind `org_member` / `org_permission`. |
| **Leads** | Live. `POST /api/leads/demo` emails the request and stores nothing. |
| **Storage** | Firestore through `firebase-admin`, behind a `Store` Protocol (`app/store.py`). Collections: `users`, `orgs`, `invites`, `login_attempts`, `audit`, `impersonations`. |
| **Security baseline** | A CSRF guard (same-origin check on writes), `no-store` and `nosniff` headers, CORS with exact origins, per-route rate limits shared across instances (Firestore), JSON request logs without personal data. |
| **Tests** | 198 pytest tests (3 skipped by design) on in-memory fakes, so no credentials are needed; 309 frontend tests. (This audit first said 82; there were 90 before Phase 1.) |
| **CI/CD** | GitHub Actions to Vercel. Pull requests run CI; `main` runs CI, deploys the backend, then the frontend, then a smoke test. |

### What doesn't exist

- **Org endpoints beyond Phase 1.** Agents, desk, calls, callbacks, appointments, reports, billing and requests still run on the in-browser demo client, `frontend/src/console/demoClient.ts`.
- **No HTTP `OpsClient`.** `createDemoOpsClient()` still serves the Ops pages that have no API.
- **No "My account" endpoints** (profile, devices, notification preferences). They are optional on `AuthClient`, and the UI shows them as unavailable.

Fixed by Foundations and Phase 1: org role and permissions are now checked server-side on every org route; org owners and admins invite their own team; the rate limiter is shared across instances; `createHttpConsoleClient()` exists and `VITE_CONSOLE_MODE=live` selects it.

---

## 2. How the frontend connects

The frontend already has the pattern. The work is to repeat it for console data.

```
Browser (React)
  └─ ConsoleProvider  ── client: ConsoleClient ──┐
                                                 ├─ demoClient.ts      (today, in-memory)
                                                 └─ httpConsoleClient  (to build)
                                                          │ fetch(VITE_API_URL + '/api' + path)
                                                          │ credentials: include | same-origin
                                                          ▼
FastAPI (backend/app)
  └─ routes/org/*.py ── org_member(slug, permission) ── Store ── Firestore
```

### What the HTTP client must follow

These come from `frontend/src/auth/httpClient.ts` and `frontend/src/lib/api.ts`.

- **Base URL:** `VITE_API_URL`. When it's empty, requests go to the same origin, and Vite proxies `/api` to `127.0.0.1:8000` in development.
- **Cookies only:** no tokens in JavaScript. Use `credentials: 'include'` cross-origin and `'same-origin'` otherwise.
- **Headers:** `Accept: application/json`, plus `Content-Type: application/json` when there is a body.
- **Errors:** the body is `{ "error": { "code", "message", "retryAfter"? } }`, mapped to `AuthError`. A 5xx with no JSON becomes `network`. Pages show `message` as-is, so it must be written for the end user.
- **Error codes already used:** `forbidden`, `invalid_input`, `network`, `rate_limited`, `unknown` and the auth codes. "Not found" is `invalid_input` with "That X doesn't exist any more…".

### Switching from demo to live

**Done:** `VITE_CONSOLE_MODE=live` (and not `VITE_AUTH_MODE=demo`) makes `main.tsx` use `createHttpConsoleClient()` (`frontend/src/console/httpConsoleClient.ts`). Anything else keeps every page on the demo client. Sections are built **one at a time**: the sections in `LIVE_SECTIONS` call the API, and every other method is handed to the demo client. Remove that fallback once every section is live.

The "Demo data" note is **per section**: `ConsoleClient.isLive(section)` says which sections are live, and a page passes its `section` to `ConsolePage`. Without this, one `isDemo` flag would either label real team data as sample data or show sample agents unlabelled. When a phase goes live, add its section to `ConsoleSection` and `LIVE_SECTIONS`, and tag its pages.

---

## 3. Foundations (do these first)

Every later phase depends on these.

- [x] **Org access dependency.** Write `org_member(slug)` and `org_permission(slug, perm)` FastAPI dependencies. *Done: `backend/app/orgs.py`; `org_permission(*perms, what=…)` is a factory, the slug comes from the path (pattern-checked). Non-members and unknown orgs get the same 403. Members of a non-active org get a 403 saying why. bitNtech see orgs in any status (404 for an unknown one, since they can list orgs anyway).* They should:
  - load the caller's membership for `slug` (`403 forbidden` if there is none);
  - refuse the org unless its status is `active`, and say why when it is `suspended` or `pending_review`;
  - work out effective permissions the same way the frontend does (`permissionsFor(role, custom)`, trimmed by the `grantable` lists);
  - give platform callers their `platformAccess` (master admin: every permission; staff: `agents.view`, `agents.test`, `calls.viewAll`, `reports.view`);
  - respect act-as, so the effective caller is the person being acted as and the audit records the real actor.
- [x] **One source of truth for permissions.** Port the role defaults, `grantable` lists and action rules from `frontend/src/console/access.ts` into `backend/app/access.py`. Add a test that loads both and fails when they drift, for example by exporting the frontend table as JSON in CI. *Done: the table is `backend/app/permissions.json` (deployed with the backend), loaded by `access.py`. `frontend/src/test/permissions-parity.test.ts` imports the same JSON and fails if `access.ts` differs, so CI's frontend job catches drift. Only the action rules Phase 1 needs are ported (`team.manageOwners`); port the rest with the phase that enforces them.*
- [x] **Store layer.** Add org-scoped methods to the `Store` Protocol and matching in-memory fakes in `tests/fakes.py`, so tests stay credential-free. *Done, plus a `Tx` transaction protocol (`store.transact(fn)`). The fake buffers writes until commit and refuses reads after writes, as Firestore does. Every multi-document change (member + `users` index + invite + activity) is one transaction.*
- [x] **Firestore layout:** subcollections under `orgs/{slug}/`. *Built for Phase 1: `members/{id}` (`id` is the uid once joined, `inv_…` while invited; an invitation becomes the uid's record on accept) and `activity/{auto}` (with `ownerOnly` for billing entries). **Changed:** settings live on the org document itself, not `settings/main`. Name, city and languages were already there and drive sessions and Ops, so a copy would drift. **Missing from the original plan:** accounts made before member records existed. `ensure_member` creates the record from `users/{uid}.memberships` the first time it's needed (and every Team route first calls `sync_members`, so the whole team is brought across, not just people who sign in), and `app/scripts/backfill_members.py` does them all at once. The rest of this table is for later phases.*

  | Collection | Holds |
  |---|---|
  | `members/{uid}` | role, permissions, status, invite fields (`users/{uid}.memberships` stays as the reverse index) |
  | ~~`settings/main`~~ | ~~`OrgSettings`~~: on the org document instead (see above) |
  | `billing/main` | plan, billing details |
  | `changeRequests/{id}` | with `replies` as an array or a subcollection |
  | `callbacks/{id}`, `appointments/{id}` | |
  | `calls/{id}` | `CallSummary` fields; a `notes` subcollection |
  | `numbers/{id}`, `tools/{id}`, `knowledge/{id}` | metadata only (see Phase 5) |
  | `activity/{id}` | org-visible audit; keep platform `audit` separate |

- [x] **Indexes** *(Phase 1's done: seven `activity` indexes for area / person / owner-only filters; later phases add theirs)*: add composite indexes in `firestore.indexes.json` for every list query (call log by `startedAt` and filters, callbacks by `status` and `dueBy`, appointments by `date`). Deploy them before the code that needs them; filtered audit queries already return 503 without theirs.
- [x] **CORS and methods.** CORS allows only GET and POST today. Either keep a **POST-only write convention** (`POST /…/update`, `/delete`), which matches the existing ops routes, or add PATCH and DELETE to the CORS config and to the `same_origin_writes` guard. Decide once and write it down. *Decided: **POST-only**. CORS and the origin guard are unchanged. Written down in `backend/README.md`.*
- [x] **Pagination convention.** Use cursor-based `?before=<cursor>&limit=`, like `/ops/audit`. Return `{ items, next }`. *Done for activity: `{ entries, nextBefore }`, the shape `ActivityPage` already had. The cursor is opaque (the last entry's id), and paging uses `start_after` that document, so entries with the same timestamp are never skipped. `/ops/audit` still pages by timestamp alone and can skip ties; see Follow-ups.*
- [x] **Shared rate limiter.** Move from in-process to a shared store (Firestore counters, Upstash Redis or similar) before org endpoints go live on several instances. *Done with Firestore: no new service or dependency. Counters are `ratelimits/{hash}` in one-minute fixed windows, using an atomic increment then a read, so concurrent hits can only over-count. Limits are per person on signed-in routes (per master admin while acting) and per IP otherwise (`X-Real-IP`, trusted only on Vercel). The limiter fails open, with a warning, if Firestore is unreachable. **Needs a TTL policy** on `ratelimits.expiresAt` (manual, see `backend/README.md`).*
- [x] **Structured logging.** Use JSON logs with a request id, route, caller uid, org slug and outcome. **Never** log call content, transcripts, phone numbers, credentials or cookie values. *Done: `app/logs.py` and `LOG_FORMAT` (`json` by default on Vercel). Each line logs the route **template**, never the raw path, because invite tokens travel in paths. Responses carry `X-Request-Id`. **Found while building:** httpx logged every outgoing URL at INFO, and the Identity Toolkit URLs carry the Firebase web API key (`?key=…`). httpx and httpcore are now held at WARNING. Tests check that no email, name, token or password reaches the logs.*
- [x] **Housekeeping:**
  - [x] align Python versions (`.python-version` says 3.14, the requirements say 3.12+). *`requirements.txt` now says 3.12+ (the code is syntax-checked on 3.12), with CI and local dev on 3.14. **Still unknown:** which version Vercel runs. Confirm it in the Vercel project settings.*
  - [x] fix the stale "until the Ops staff page exists" notes in `app/scripts/invite_staff.py` and `README.md`;
  - [ ] add `backend/.env.example` entries for any new variables. *One new optional variable, `LOG_FORMAT=` (`text` or `json`). This session's permissions block access to `.env*` files, so it still has to be added by hand.*

---

## 4. Build phases

Each phase is: backend routes and tests → HTTP client section in the frontend → switch that section from demo to live → manual check in the browser.

The methods are on `ConsoleClient` in `frontend/src/console/types.ts`. All paths below are *proposed*, under `/api/orgs/{slug}`.

### Phase 1: Team and org settings

These unlock real multi-user orgs.

| ConsoleClient method | Endpoint (proposed) | Permission |
|---|---|---|
| `listMembers` | `GET /members` | any member, and bitNtech (callbacks and live calls assign work to people) |
| `inviteMember` | `POST /members/invite` | `team.manage` (`team.manageOwners` to invite an owner) |
| `resendInvite` | `POST /members/{id}/resend` | `team.manage` |
| `changeRole` | `POST /members/{id}/role` | `team.manage` |
| `setPermissions` | `POST /members/{id}/permissions` | `team.manage`, trimmed to `grantable` |
| `removeMember` | `POST /members/{id}/remove` | `team.manage`; their open callbacks become unassigned |
| `getOrgSettings` / `updateOrgSettings` | `GET` / `POST /settings` | `settings.manage` to read and write (as the page already required) |
| `listActivity` | `GET /activity` | `activity.view` |

**Status: built.** All eight methods are live in `backend/app/routes/org/` and `frontend/src/console/httpConsoleClient.ts`, with tests for allowed role, denied role, wrong org, suspended org, act-as and invalid input, plus a permission matrix (`backend/tests/test_permission_matrix.py`).

- [x] Wire `issue_invite(org_slug=…)` so org invites flow through the existing `/api/invites/{token}/accept`. *Done, with what this plan missed:*
  - *An org invitation belongs to an **invited member record**, and accept uses that record's role and permissions, which can change while the invite waits.*
  - *Resending or cancelling **revokes the old link**.*
  - *Someone who **already has an account** (a doctor at two hospitals, an owner whose sign-up was declined) couldn't accept at all: accept always created a new user. `GET /api/invites/{token}` now says `hasAccount`, and `POST /api/invites/{token}/join` lets them sign in and join with the same email. The invite page handles this, including being signed in with the wrong address.*
  - *bitNtech accounts can't be invited or join.*
- [x] Never let anyone remove or demote the last owner (same idea as "last master admin"). *Done. Disabled owners don't count, and the check runs **in the same transaction** as the change, so two owners demoting each other at once can't both succeed.*
- [x] Write an activity entry for every change made from this table. *Done, in the same transaction as each change. Changes made while acting as someone show as "Name (bitNtech, as X)" and are also written to the platform `audit`.*
- [x] **Added: no handing out more than you have.** Someone who isn't an owner can only give permissions they hold, whether by invite, role change or per-permission edit. Without this, an admin with a trimmed set could grant, for example, `library.secrets`. *(The demo client doesn't enforce this; the server does.)*
- [x] **Added:** the session now returns each membership's custom `permissions`, so the nav and guards reflect per-person changes. `lastActiveAt` is set at sign-in and at most hourly on session restore. A disabled Firebase account shows as `disabled`.
- [x] **Settings rules aligned:** name 3–120 characters (as at sign-up, previously 2–80 on the page) and city 2–80. Page, demo and server use the same rules. Default hours, until an org sets its own: Monday to Saturday 09:00–18:00.
- [ ] *Deferred to Phase 3:* "their open callbacks become unassigned" on remove, role change to viewer, or losing `calls.take`. Callbacks don't exist on the server yet; the hooks are marked in `routes/org/team.py`.

### Phase 2: Requests to bitNtech

| Method | Endpoint (proposed) |
|---|---|
| `listChangeRequests` | `GET /requests` |
| `createChangeRequest` | `POST /requests` (`requests.create`) |
| `replyChangeRequest` | `POST /requests/{id}/reply` |
| `withdrawChangeRequest` | `POST /requests/{id}/withdraw` (creator or `requests.create`) |
| `updateChangeRequest` | `POST /requests/{id}/update` (**master admin only**) |
| `requestNumber` | creates a request of kind `number` |

- [ ] Add an Ops view across all orgs, for `OpsChangesPage` and `/ops/orgs/:slug/requests`.
- [ ] Send email through `app/mailer.py` (Resend) when a request is created or replied to.

### Phase 3: Operations data (callbacks, appointments, call log, notes)

This phase is CRUD over records. **Creating** call records needs the voice pipeline (see [Dependencies](#5-dependencies-on-the-pipeline-team)). Build the storage and read and update APIs now, and seed them from a script until the pipeline sends events.

| Method | Endpoint (proposed) | Permission |
|---|---|---|
| `listCallbacks` / `updateCallback` | `GET /callbacks`, `POST /callbacks/{id}` | `calls.take` / `callbacks.assign` |
| `listAppointments(from, to)` / `updateAppointment` | `GET /appointments?from&to`, `POST /appointments/{id}` | `appointments.manage` |
| `listCallLog(query)` | `GET /calls?days&agent&outcome&q&limit` | `calls.viewAll`; otherwise only calls the caller handled |
| `getCallRecord` | `GET /calls/{id}` | as above; strip personal fields without `calls.personal` |
| `addCallNote` | `POST /calls/{id}/notes` | any member who can see the call |
| `listHandoffs` / `takeHandoff` / `handoffToCallback` | `GET /handoffs`, `POST /handoffs/{id}/take`, `/to-callback` | `calls.take` |

- [ ] **Front desk sees only calls they handled.** Enforce this server-side, not in the UI.
- [ ] **Mask phone numbers and names** without `calls.personal`, matching the UI rules.
- [ ] **Recordings:** return signed, short-lived URLs only with `calls.recordings`. Never return a public bucket path.
- [ ] **Search:** Firestore can't do free-text search. Store a normalized search field (last digits of the number, intent) or add a search service later.

### Phase 4: Reports

| Method | Endpoint (proposed) |
|---|---|
| `getReport(query)` | `GET /reports?days&agent` (`reports.view`; export needs `reports.export`) |

- [ ] Keep rollups: per-day and per-hour counters, updated when a call record is written, so a report doesn't scan every call.
- [ ] Add an export as CSV, behind `reports.export`.
- [ ] Leave out AI quality metrics until the pipeline sends them; return them as `null` and let the UI handle that.

### Phase 5: Library (numbers, tools, credentials, knowledge metadata)

| Method | Endpoint (proposed) | Notes |
|---|---|---|
| `listNumbers` / `updateNumber` | `GET /numbers`, `POST /numbers/{id}` | `library.numbers`; telephony provisioning is manual or done by bitNtech for now |
| `listTools` / `saveTool` / `deleteTool` | `GET /tools`, `POST /tools`, `POST /tools/{id}/delete` | creating and structuring tools is **master admin only** |
| `testTool` | `POST /tools/{id}/test` | server-side HTTP call with a timeout, a size cap, **no redirects to private IP ranges** (SSRF guard) |
| `listCredentials` / `setCredential` / `deleteCredential` | `GET /credentials`, `POST /credentials`, `POST /credentials/{name}/delete` | `library.secrets`; **values are write-only** |
| `listKnowledge` / `updateKnowledge` / `deleteKnowledge` / `listPassages` | `GET` / `POST /knowledge…` | metadata and uploads only; indexing and search are AI work |

- [ ] **Credentials:** encrypt them at rest with a KMS or Secret Manager key, or store them only in Secret Manager and keep a reference in Firestore. Never return the value, never log it, and record every set and delete in the activity log.
- [ ] **Uploads:** use signed upload URLs to Cloud Storage, a size limit, a content-type allow-list and a virus scan if possible.
- [ ] Refuse `deleteKnowledge` while an agent uses the source.

### Phase 6: Agents (the CRUD side only)

| Method | Endpoint (proposed) | Notes |
|---|---|---|
| `listAgents` | `GET /agents` | published agents and drafts; `callsThisWeek` comes from the Phase 4 rollups |
| `getAgent` / `saveAgent` / `discardAgentChanges` | `GET /agents/{id}`, `POST /agents/{id}`, `/discard` | `saveAgent` must refuse changes to locked fields (flow, attributes, tools) unless the caller is master admin |
| `publishAgent` / `rollbackAgent` | `POST /agents/{id}/publish`, `/rollback` | `agents.publish`; versions are immutable documents |
| `updateAgent` | `POST /agents/{id}/settings` | name, number, live/paused |
| `deleteAgent` | `POST /agents/{id}/delete` | master admin only |
| `createDraft` / `getDraft` / `saveDraft` / `discardDraft` / `publishDraft` | `/drafts…` | `publishDraft` needs an **idempotency key** |
| `listScenarios` / `saveScenario` / `deleteScenario` | `/agents/{id}/scenarios…` | storage only; *running* them is AI work |
| `listAgentTypes` / `listVoices` | `GET /catalogue/agent-types`, `/voices` | static or seeded data |

- [ ] **Store the spec as a versioned JSON document.** Validate it with Pydantic models that mirror `AgentSpec`, but treat the `pipeline`, `speech`, `guardrails` and `analysis` blocks as opaque until the pipeline contract is fixed.
- [ ] **Optimistic concurrency:** use a `revision` field on drafts and agents. Return a conflict when it's stale, so autosave can't overwrite a newer save.

### Phase 7: Bot desk (the data side)

| Method | Endpoint (proposed) |
|---|---|
| `getDesk` | `GET /desk` |
| `saveNotice` / `removeNotice` | `POST /desk/notices`, `POST /desk/notices/{id}/remove` (`desk.notices`) |
| `saveDoctorChange` / `removeDoctorChange` | `POST /desk/doctor-changes…` |
| `flagAnswer` / `resolveFlag` | `POST /desk/flags`, `POST /desk/flags/{id}/resolve` |
| `setLineMode` | `POST /desk/lines/{numberId}/mode` (`desk.bot`) |

- [ ] Store and serve these now. *Delivering* notices and line-mode changes to the live agent is a pipeline contract (see the next section).

### Phase 8: Billing, My account, Ops extras

- [ ] **Billing:** `getBilling`, `changePlan`, `updateBillingDetails`. These are owner-only and can't be granted. Choose a payment provider (Razorpay or Stripe) and handle its webhooks with signature checks and idempotency.
- [ ] **My account:** `updateProfile`, `listDevices`, `signOutDevice`, `signOutOtherDevices`, `get/setNotificationPrefs` (keys are in `NotificationKey`). Devices need a sessions collection, because Firebase session cookies can't be listed.
- [ ] **Notification sending:** daily and weekly summaries and missed-handoff emails through a scheduled job (Vercel Cron or Cloud Scheduler), respecting `NotificationPrefs`.
- [ ] **Ops extras** (`frontend/src/ops/types.ts`): `getOrgDetail`, `retryJob`, `listTemplates`, `saveTemplate`, `setTemplatePublished`, `getUsage`, `get/updatePlatformSettings`, `getServiceStatus`. Then build `httpOpsClient` and retire `demoOpsClient`.

---

## 5. Dependencies on the pipeline team

The pipeline itself is out of scope, but the backend has to **receive** data from it. Agree on these contracts before Phase 3 can carry real data:

- [ ] **Call-ended event:** how a finished call reaches the backend (webhook or queue), with its auth (an HMAC signature or mTLS), payload (the `CallSummary` and `CallRecord` fields) and retry/idempotency key.
- [ ] **Live call state** for `listLiveCalls`, take-over and transfer: polling, WebSocket or SSE, and who owns the state.
- [ ] **Handoff created:** an event when the agent passes a call to a person.
- [ ] **Recordings:** where audio is stored, its retention, and how the backend signs URLs for it.
- [ ] **Desk to agent:** how notices, doctor changes and line mode reach the running agent.
- [ ] **Published spec to agent:** how the agent runtime fetches the published `AgentSpec` (pull by version, or push on publish).

For each, write down the protocol, endpoint, auth, payload, error handling, timeouts, ordering guarantees and network constraints, following `.claude/rules/external-services.md`. **Don't build against guessed payloads.**

---

## 6. Security and privacy checklist (every phase)

- [ ] Check authorization on **every** org route with `org_permission`. Never trust a role or permission sent by the browser. *(Phase 1: done; `test_every_org_route_is_in_the_matrix` fails if a new org route skips the matrix.)*
- [ ] Check that the org slug in the path matches a membership. Return `403`, not `404`, if you want to avoid leaking which orgs exist; pick one and use it everywhere. *(Decided: **403** for members and outsiders alike, in `orgs.py`.)*
- [ ] Validate all input with Pydantic models: limit string lengths, use enums for statuses, and validate phone numbers and dates.
- [ ] Rate-limit write endpoints and anything that sends email or calls out (tool test).
- [ ] Record every write that matters (role changes, permissions, credentials, publish, delete, settings) in `activity`; record platform actions and act-as in `audit`.
- [ ] Keep PII out of logs and error messages. Add a log-scrubbing test. *(Log-scrubbing test added: `test_request_logs_carry_ids_and_no_personal_data`.)*
- [ ] Define data retention and deletion for calls, recordings, notes and members who leave. Hospital data needs a written policy (DPDP Act compliance in India).
- [ ] Keep the existing CSRF guard, CORS allow-list, `COOKIE_SECURE`, and the SameSite rules in `docs/cicd.md`. Don't loosen them to make a local setup work.

---

## 7. Testing and verification

- [ ] **Unit and route tests** for every endpoint, on `tests/fakes.py`. For each route, test: allowed role, denied role, wrong org, suspended org, act-as, invalid input.
- [ ] **A permission matrix test** that runs every org route against every role and asserts allow or deny from `access.py`. *(Built for Phase 1 routes; add each new route to `ROUTES` in `backend/tests/test_permission_matrix.py`.)*
- [ ] **A Firestore emulator suite** (optional, in CI) for queries and indexes that the fakes can't model.
- [ ] **Frontend:** contract tests for `httpConsoleClient`, mocking `fetch`, so request paths and error mapping match the backend. *(Built for Phase 1: `frontend/src/test/httpConsoleClient.test.ts`.)*
- [ ] **Smoke test:** extend `.github/scripts/smoke.sh` with an authenticated org-route check once a test org exists.
- [ ] **Commands:** `cd backend && python -m pytest`, `cd frontend && npm run typecheck && npm run test`.

---

## 8. Deployment and configuration

- **New env vars** (placeholders only in `.env.example`): a storage bucket name, a KMS key or Secret Manager project, a shared rate-limit store URL, a payment provider key and webhook secret, a pipeline webhook secret, and a cron secret.
- **Indexes:** deploy Firestore indexes as a CI step or a documented manual step **before** the code that needs them.
- **Single region:** keep Vercel functions and Firestore in the same region (or close) for latency.
- **Cron:** scheduled jobs for summaries and rollup repair, protected by a secret header.
- Keep using the existing `pipeline.yml`. The frontend's `VITE_CONSOLE_MODE` (or equivalent) must be set per environment so production never falls back to demo data by accident.

---

## 9. Suggested order

1. ~~Foundations (§3): access dependency, permission parity test, store layer, conventions.~~ **Done.**
2. ~~Phase 1, Team and settings: the first real multi-user value.~~ **Done**, apart from the manual rollout steps in Follow-ups.
3. Phase 2, Requests to bitNtech: small, and it's already used by the detected-flow feature.
4. Phase 3, Operations data, seeded by a script, while the pipeline contracts (§5) are agreed in parallel.
5. Phase 4, Reports, on rollups.
6. Phase 5, Library, then Phase 6, Agents CRUD, then Phase 7, Desk.
7. Phase 8, Billing, My account and Ops extras.
8. Remove the demo fallback from production builds.

---

## Decisions made while building Foundations and Phase 1

| Question | Decision | Why |
|---|---|---|
| Write methods | POST-only | Matches the existing routes; CORS and the origin guard stay as they are |
| Unknown org vs no access | Same 403 for both | Doesn't reveal which organisations exist |
| Where settings live | On the org document | Name, city and languages were already there; one copy can't drift |
| Shared rate limiter | Firestore counters | No new service, account or dependency. Upstash would be faster, but needs provisioning |
| Limiter outage | Fail open, log a warning | A limiter outage shouldn't take the console down |
| Existing accounts invited | Sign in and join (`/join`) | Otherwise a person can only ever belong to one organisation |
| Granting permissions | Non-owners only give what they hold | Closes an escalation path the UI didn't guard |
| Admins changing admins | Allowed, as the UI does | Unchanged product behaviour; revisit if hospitals ask |
| Member list visibility | Every member sees name, email, role | Needed to assign callbacks; colleagues' work emails aren't secret |
| Act-as in activity | Shown as bitNtech, plus a platform audit entry | Hospitals see that bitNtech changed something; bitNtech knows who |
| Demo label | Per section (`isLive`) | Mixed demo/live pages must say which is which |
| Default hours | Mon–Sat 09:00–18:00, Sunday closed | Applies until an organisation saves its own |

## Follow-ups from Foundations and Phase 1

**Manual steps before turning `VITE_CONSOLE_MODE=live` on in an environment:**
1. Create the composite indexes in `backend/firestore.indexes.json` (the new `activity` ones). Until then, filtered activity answers 503.
2. Add a Firestore TTL policy on collection group `ratelimits`, field `expiresAt`.
3. Optional: `python -m app.scripts.backfill_members`, then `--apply`, so every existing member shows on the Team page at once. The API also does this lazily.
4. Add `LOG_FORMAT=` to `backend/.env.example` by hand (blocked in this session).
5. Set `VITE_CONSOLE_MODE=live` on the frontend's Vercel project, staging first. Then check sign-in, Team (invite, accept, role, permissions, remove), Settings and Activity in a browser against the real Firebase project. This hasn't been done yet; every check so far ran against the in-memory fakes.

**Found by the independent review and fixed:** older members who hadn't signed in were invisible on the Team page and couldn't be removed (now `sync_members`); `/join` could replace an older member's role (now refused); a lost reply after a committed accept could delete the new account (now kept). **Accepted as designed:** owners can hand out any permission, including ones another owner restricted on them.

**Known limitations:**
- In live mode the Callbacks and Live calls pages (still sample data) receive the **real** team list, so assigning a demo callback to a real person is refused. This lasts until Phase 3 moves callbacks to the server.
- Ops' suspend, restore and approve still overwrite the whole org document. A settings save made at the same instant could be undone by one of them. Settings themselves write only their own fields. Move the Ops writes to field updates when convenient.
- `/ops/audit` pages by timestamp alone, so entries with the same timestamp can be skipped. Use the activity cursor approach there too.
- `orgs/{slug}.ownerUid` still names the sign-up owner after ownership changes. Ops uses it for the owner's email.
- The demo client doesn't enforce the "only give what you hold" rule. Only demo mode is affected.
- Vercel's Python version is unconfirmed. The code is syntax-checked on 3.12; CI runs 3.14.

---

## Out of scope: AI, LLM and agent work

These `ConsoleClient` methods and features depend on the AI, LLM, voice or agent pipeline, and are **not** planned here:

- Call uploads and transcription: `addRecordings`, `getTranscript`, and `SourceCall` processing status.
- Flow extraction: `extractFlow` and attribute extraction.
- `listModels` and the `pipeline`, `speech`, `guardrails` and `analysis` blocks of `AgentSpec` (stored as opaque JSON above).
- Knowledge indexing and retrieval: `addKnowledge` and `refreshKnowledge` indexing, `searchKnowledge`.
- Test scenarios: `runScenarios`; the builder's test chat (`simulate.ts`, browser-only today).
- Live call control: `listLiveCalls` state, `takeOverCall`, `whisperToAgent`, warm `transferCall`.
- AI-generated content in records: call summaries, `analysis`, quality `metrics`, handoff summaries.
- Flow-pattern detection: `detectNewFlowPatterns`, `listNewFlowPatterns` (templated demo logic today).

The backend's job for these is limited to **storing and serving** what the pipeline produces, through the contracts in §5.
