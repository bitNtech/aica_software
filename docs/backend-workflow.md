# Backend workflow: what to build, and how to connect it

**Status:** written 2026-10-19 from a read-only audit of `backend/` and `frontend/`. **Updated 2026-10-20: Foundations (§3) and Phases 1–6 (§4) are built and tested; see the decisions and follow-ups sections near the end.** Phases 7–8 are still plans.
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
| **Organisations** | Live for Phases 1–3: members, settings, activity, requests to bitNtech, calls and notes, callbacks, appointments and handoffs under `/api/orgs/{slug}/…`, behind `org_member` / `org_permission`. Calls and handoffs have no way in from the pipeline yet (§5); a seed script fills staging. |
| **Leads** | Live. `POST /api/leads/demo` emails the request and stores nothing. |
| **Storage** | Firestore through `firebase-admin`, behind a `Store` Protocol (`app/data/store.py`). Collections: `users`, `orgs`, `invites`, `login_attempts`, `audit`, `impersonations`. |
| **Security baseline** | A CSRF guard (same-origin check on writes), `no-store` and `nosniff` headers, CORS with exact origins, per-route rate limits shared across instances (Firestore), JSON request logs without personal data. |
| **Tests** | 601 pytest tests (3 skipped by design) on in-memory fakes, so no credentials are needed; 328 frontend tests. (This audit first said 82; there were 90 before Phase 1.) |
| **CI/CD** | GitHub Actions to Vercel. Pull requests run CI; `main` runs CI, deploys the backend, then the frontend, then a smoke test. |

### What doesn't exist

- **Org endpoints beyond Phase 6.** The bot desk, live calls, billing and the AI features (§ Out of scope) still run on the in-browser demo client, `frontend/src/console/demoClient.ts`.
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

- [x] **Org access dependency.** Write `org_member(slug)` and `org_permission(slug, perm)` FastAPI dependencies. *Done: `backend/app/access/orgs.py`; `org_permission(*perms, what=…)` is a factory, the slug comes from the path (pattern-checked). Non-members and unknown orgs get the same 403. Members of a non-active org get a 403 saying why. bitNtech see orgs in any status (404 for an unknown one, since they can list orgs anyway).* They should:
  - load the caller's membership for `slug` (`403 forbidden` if there is none);
  - refuse the org unless its status is `active`, and say why when it is `suspended` or `pending_review`;
  - work out effective permissions the same way the frontend does (`permissionsFor(role, custom)`, trimmed by the `grantable` lists);
  - give platform callers their `platformAccess` (master admin: every permission; staff: `agents.view`, `agents.test`, `calls.viewAll`, `reports.view`);
  - respect act-as, so the effective caller is the person being acted as and the audit records the real actor.
- [x] **One source of truth for permissions.** Port the role defaults, `grantable` lists and action rules from `frontend/src/console/access.ts` into `backend/app/access/permissions.py`. Add a test that loads both and fails when they drift, for example by exporting the frontend table as JSON in CI. *Done: the table is `backend/app/access/permissions.json` (deployed with the backend), loaded by `access/permissions.py`. `frontend/src/test/permissions-parity.test.ts` imports the same JSON and fails if `access.ts` differs, so CI's frontend job catches drift. Only the action rules Phase 1 needs are ported (`team.manageOwners`); port the rest with the phase that enforces them.*
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

- [x] **Indexes** *(Phase 1's done: seven `activity` indexes for area / person / owner-only filters; later phases add theirs)*: add composite indexes in `firestore/indexes.json` for every list query (call log by `startedAt` and filters, callbacks by `status` and `dueBy`, appointments by `date`). Deploy them before the code that needs them; filtered audit queries already return 503 without theirs.
- [x] **CORS and methods.** CORS allows only GET and POST today. Either keep a **POST-only write convention** (`POST /…/update`, `/delete`), which matches the existing ops routes, or add PATCH and DELETE to the CORS config and to the `same_origin_writes` guard. Decide once and write it down. *Decided: **POST-only**. CORS and the origin guard are unchanged. Written down in `backend/README.md`.*
- [x] **Pagination convention.** Use cursor-based `?before=<cursor>&limit=`, like `/ops/audit`. Return `{ items, next }`. *Done for activity: `{ entries, nextBefore }`, the shape `ActivityPage` already had. The cursor is opaque (the last entry's id), and paging uses `start_after` that document, so entries with the same timestamp are never skipped. `/ops/audit` still pages by timestamp alone and can skip ties; see Follow-ups.*
- [x] **Shared rate limiter.** Move from in-process to a shared store (Firestore counters, Upstash Redis or similar) before org endpoints go live on several instances. *Done with Firestore: no new service or dependency. Counters are `ratelimits/{hash}` in one-minute fixed windows, using an atomic increment then a read, so concurrent hits can only over-count. Limits are per person on signed-in routes (per master admin while acting) and per IP otherwise (`X-Real-IP`, trusted only on Vercel). The limiter fails open, with a warning, if Firestore is unreachable. **Needs a TTL policy** on `ratelimits.expiresAt` (manual, see `backend/README.md`).*
- [x] **Structured logging.** Use JSON logs with a request id, route, caller uid, org slug and outcome. **Never** log call content, transcripts, phone numbers, credentials or cookie values. *Done: `app/core/logs.py` and `LOG_FORMAT` (`json` by default on Vercel). Each line logs the route **template**, never the raw path, because invite tokens travel in paths. Responses carry `X-Request-Id`. **Found while building:** httpx logged every outgoing URL at INFO, and the Identity Toolkit URLs carry the Firebase web API key (`?key=…`). httpx and httpcore are now held at WARNING. Tests check that no email, name, token or password reaches the logs.*
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
| `withdrawChangeRequest` | `POST /requests/{id}/withdraw` (creator or ~~`requests.create`~~ **`team.manage`**, as the UI and demo already did) |
| `updateChangeRequest` | `POST /requests/{id}/update` (**master admin only**) |
| `requestNumber` | `POST /requests/number` (`library.numbers` or `requests.create`): a request of kind `number` |

**Status: built** (`backend/app/routes/org/requests.py`, `tests/test_org_requests.py`). Validation messages, rules and activity entries match the demo client. Reading needs `requests.create` or `agents.view`; bitNtech can always read. bitNtech never creates requests, and bitNtech staff who aren't the master admin read but don't reply.

- [x] Add an Ops view across all orgs, for `OpsChangesPage` and `/ops/orgs/:slug/requests`. *`GET /api/ops/change-requests` (bitNtech): open requests and any updated in 90 days, in one collection-group query. `OpsChangesPage` uses it (`listAllChangeRequests`) instead of one call per org. `/ops/orgs/:slug/requests` already uses the org route.*
- [x] Send email through `app/integrations/mailer.py` (Resend) when a request is created or replied to. *A new request or a hospital reply goes to `CHANGE_REQUESTS_TO` (default `support@bitntech.in`). A bitNtech reply or status change goes to the person who asked, if they're still in the team. Emails hold only the title and a link.*
- [x] **Agents aren't on the server yet** (Phase 6). The console sends the agent's name with `agentId`, and the server stores it for display without checking it.
- [x] A request from a detected call pattern could go over the 2,000-character limit. `frontend/src/console/flowRequest.ts` cuts the call list short (`… and N more`).

### Phase 3: Operations data (callbacks, appointments, call log, notes)

This phase is CRUD over records. **Creating** call records needs the voice pipeline (see [Dependencies](#5-dependencies-on-the-pipeline-team)). Build the storage and read and update APIs now, and seed them from a script until the pipeline sends events.

| Method | Endpoint (proposed) | Permission |
|---|---|---|
| `listCallbacks` / `updateCallback` | `GET /callbacks`, `POST /callbacks/{id}` | `calls.take` / `callbacks.assign` |
| `listAppointments(from, to)` / `updateAppointment` | `GET /appointments?from&to`, `POST /appointments/{id}` | `appointments.manage` |
| `listCallLog(query)` | `GET /calls?days&agent&outcome&q&limit` | `calls.viewAll`; otherwise only calls the caller handled |
| `getCallRecord` | `GET /calls/{id}` | as above; strip personal fields without `calls.personal` |
| `addCallNote` | `POST /calls/{id}/notes` | any member who can see the call |
| `listHandoffs` / `takeHandoff` / `handoffToCallback` | `GET /handoffs`, `POST /handoffs/{id}/take`, `/to-callback` | Read: `calls.viewAll` or `calls.take`; take and to-callback: `calls.take` |

**Status: built** for storage, reading and updating (`backend/app/routes/org/{calls,callbacks,appointments,handoffs}.py`, `tests/test_org_operations.py`). There is **no way in for the pipeline yet**: call records and handoffs come from `app/scripts/seed_operations.py` on staging until §5's contracts are agreed. Live calls (`listLiveCalls`, take over, whisper, transfer) stay on sample data.

- [x] **Front desk sees only calls they handled.** Enforce this server-side, not in the UI. *Matched by `handledById` (the demo matched by name). Taking a handoff marks its call as handled by that person.*
- [x] **Mask phone numbers and names** without `calls.personal`, matching the UI rules. *`app/domain/redact.py`. Callers' numbers on calls and handoffs are always masked (`+91 ••••• 43210`), as the console shows them. Without `calls.personal`, the server removes callers' names, personal details, personal values in transcripts and the summary, and analysis fields with a personal label. Callbacks carry the full number, because the person calling back needs it. Appointments show the phone only with `appointments.manage`, and the patient's name only with `calls.personal`.*
- [ ] **Recordings:** return signed, short-lived URLs only with `calls.recordings`. Never return a public bucket path. *Not built: no recording storage has been agreed (§5). The API returns `hasRecording` only.*
- [x] **Search:** Firestore can't do free-text search. Store a normalized search field (last digits of the number, intent) or add a search service later. *`searchTokens` on each call: 3–5 digit runs of the number's last five digits, intent and agent words, and name words (prefixed, matched only for people with `calls.personal`). A search of several words uses its longest word. Totals use Firestore's count query.*
- [x] **Phase 1's deferred hooks:** someone who is removed, made a viewer, or loses `calls.take` has their open callbacks unassigned in the same transaction.
- [x] **Rules settled where the demo was looser:**
  - listing appointments needs `appointments.manage` or `calls.viewAll`;
  - callbacks can only be given to someone who holds `calls.take`, not merely a non-viewer;
  - notes can't be added by viewers or by bitNtech staff.
- Operations changes don't write activity entries, as in the demo: they're day-to-day work, not configuration.

### Phase 4: Reports

| Method | Endpoint (proposed) |
|---|---|
| `getReport(query)` | `GET /reports?days&agent` (`reports.view`; export needs `reports.export`) |

**Status: built** (`backend/app/domain/rollups.py`, `routes/org/reports.py`, `tests/test_org_reports.py`).

- [x] Keep rollups: per-day and per-hour counters, updated when a call record is written, so a report doesn't scan every call. *`orgs/{slug}/rollups/{agentId}_{day}` (India time), with per-hour counts by outcome, durations, languages, intents, drop-off steps and quality inputs.*
  - *`record_call` writes a call and its rollup in one transaction, and counts a retried delivery once. The seed script uses it, and pipeline ingestion will too.*
  - *`app/scripts/rebuild_rollups.py` recounts them.*
  - *Medians come from log-scale histograms, accurate to within about 13%. "The period before" is cut at the same hour, not the same minute.*
- [x] Add an export as CSV, behind `reports.export`. *`GET /reports/calls.csv`: the call list, with the call log's own visibility rules (own calls without `calls.viewAll`). Numbers are masked, and names appear only with `calls.personal`. Cells are guarded against formula injection, and the file starts with a BOM so Excel reads Tamil names. Call history has a "Download call list" button. The report's own CSV is still built in the browser.*
- [x] Leave out AI quality metrics until the pipeline sends them; return them as `null` and let the UI handle that. *`ReportQuality` fields and per-agent success and reply time are now nullable. Home shows "Not measured yet". The unused `ReportsPage.tsx` was removed.*
- [x] `callsThisWeek` on the agents list comes from the rollups.

### Phase 5: Library (numbers, tools, credentials, knowledge metadata)

| Method | Endpoint (proposed) | Notes |
|---|---|---|
| `listNumbers` / `updateNumber` | `GET /numbers`, `POST /numbers/{id}` | `library.numbers`; telephony provisioning is manual or done by bitNtech for now |
| `listTools` / `saveTool` / `deleteTool` | `GET /tools`, `POST /tools`, `POST /tools/{id}/delete` | creating and structuring tools is **master admin only** |
| `testTool` | `POST /tools/{id}/test` | server-side HTTP call with a timeout, a size cap, **no redirects to private IP ranges** (SSRF guard) |
| `listCredentials` / `setCredential` / `deleteCredential` | `GET /credentials`, `POST /credentials`, `POST /credentials/{name}/delete` | `library.secrets`; **values are write-only** |
| `listKnowledge` / `updateKnowledge` / `deleteKnowledge` / `listPassages` | `GET` / `POST /knowledge…` | metadata and uploads only; indexing and search are AI work |

**Status: built** (`routes/org/{numbers,tools,knowledge,uploads}.py`, `app/data/vault.py`, `app/data/blobs.py`, `app/integrations/toolhttp.py`, `app/domain/usage.py`, `tests/test_org_library.py`). Rules and messages follow the demo client.

- [x] **Credentials:** encrypt them at rest with a KMS or Secret Manager key, or store them only in Secret Manager and keep a reference in Firestore. Never return the value, never log it, and record every set and delete in the activity log.
  - *Decided: AES-256-GCM with `SECRETS_KEY`, a 32-byte key in the server's environment, using the `cryptography` package that was already installed. KMS was the alternative.*
  - *Each ciphertext is bound to its organisation and name. A key id is stored with it, and `SECRETS_KEY_PREVIOUS` allows rotation.*
  - *Values are never returned or logged. If a system echoes the secret back, the tool test's reply summary blanks it.*
- [x] **Uploads:** use signed upload URLs to Cloud Storage, a size limit, a content-type allow-list and a virus scan if possible.
  - *The browser PUTs straight to a private bucket (`STORAGE_BUCKET`), with a 15-minute v4 signed URL bound to the exact size and type. Object paths are built from ids, never from file names.*
  - *Recordings are capped at 200 MB and documents at 50 MB, with an extension allow-list.*
  - *The server checks that the object arrived with the right size. An upload never finished shows as failed after an hour.*
  - ***No virus scan yet.***
- [x] Refuse `deleteKnowledge` while an agent uses the source. *The check covers every agent's working setup, all of its versions, and drafts. The same applies to tools; secrets are checked against the tools that use them.*
- [x] **Tool tests** (`app/integrations/toolhttp.py`):
  - *HTTPS only, and redirects are never followed.*
  - *Every address the host resolves to must be public. Private, loopback, link-local, carrier-grade NAT, multicast and reserved ranges are refused, which also blocks the cloud metadata service.*
  - *The request goes to the checked address, with TLS SNI and the Host header set to the name, so a second DNS answer can't redirect it.*
  - *The tool's own timeout applies, at most 64 KB of the reply is read, and there's a limit of 5 tests a minute.*
  - *The secret goes in `Authorization: Bearer`, or in the tool's `credentialHeader` (a new optional field, which the form doesn't set yet).*
  - *Only the master admin tests tools, as in the demo.*
- [x] **Numbers:**
  - *The master admin adds and removes lines (`POST /numbers`, `POST /numbers/{id}/delete`). Hospitals ask for one through a request.*
  - *An agent answers one line. The agent that loses a line is paused.*
- [x] **AI work is not faked:** new knowledge stays "being read" and uploads stay "queued"; passages and search return nothing; transcripts say they're still processing.

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

**Status: built** (`routes/org/agents.py`, `app/domain/agentspec.py`, `app/domain/catalogue.py`, `tests/test_org_agents.py`).

- [x] **Store the spec as a versioned JSON document.** Validate it with Pydantic models that mirror `AgentSpec`, but treat the `pipeline`, `speech`, `guardrails` and `analysis` blocks as opaque until the pipeline contract is fixed.
  - *Agents live in `agents/{id}` (the working setup). Each published version is its own document, `agentVersions/{agentId}_{n}`, and is never changed.*
  - *Every block is validated with generous limits, and the setup is capped at 256 KB. Unknown fields are kept. Only `pipeline` is stored as given, capped at 32 KB, because `speech`, `guardrails` and `analysis` are edited by hospitals.*
  - *A test validates every setup the demo client produces.*
  - *Locked fields use the demo client's exact list, which is wider than this doc said: type, sub-type, redaction, flow, details collected, global flows, pipeline, tools, confirm-before-acting and analysis fields.*
- [x] **Optimistic concurrency:** use a `revision` field on drafts and agents. Return a conflict when it's stale, so autosave can't overwrite a newer save.
  - *The server answers `409 conflict`. The HTTP client tracks revisions itself, so the pages are unchanged.*
  - *Autosave stops on a conflict and offers "Reload" instead of retrying forever.*
- [x] `publishDraft`'s idempotency key is the draft itself: once published it remembers its agent, and a retry returns that agent.
- [x] Agent types, voices, built-in tools and the default setups are in `backend/app/domain/catalogue.json`, generated from the frontend demo. `frontend/src/test/catalogue-parity.test.ts` fails if the two drift.
- [x] Deleting an agent frees its numbers and removes its versions and scenarios.
- [x] Reading a flow from calls (`extractFlow`) and running scenarios say "needs the AI pipeline" in live mode. The browser-only test chat still works.

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

> **2026-10-27: the voice orchestrator is connected** ([`orchestrator-contract.md`](orchestrator-contract.md)). Call-ended, handoff events, live call state, desk-to-call controls and published-spec-to-agent are now built against its documented, live-checked API. Recordings, notices and line mode to the running agent, and appointment requests are still open.

- [x] **Call-ended event:** *(orchestrator `call.ended` webhook, HMAC-signed, plus a pull from `GET /v1/voice/sessions?status=ended`; see orchestrator-contract.md)* how a finished call reaches the backend (webhook or queue), with its auth (an HMAC signature or mTLS), payload (the `CallSummary` and `CallRecord` fields) and retry/idempotency key.
- [x] **Live call state** *(polled from the orchestrator; listening in and taking over through its operator socket)* for `listLiveCalls`, take-over and transfer: polling, WebSocket or SSE, and who owns the state.
- [x] **Handoff created:** *(`handoff.*` webhooks and `GET /v1/handoffs`)* an event when the agent passes a call to a person.
- [ ] **Recordings:** where audio is stored, its retention, and how the backend signs URLs for it.
- [ ] **Desk to agent:** how notices, doctor changes and line mode reach the running agent.
- [x] **Published spec to agent:** *(pushed on publish: each version becomes an LLM agent and a voice agent; `app/integrations/voicesync.py`)* how the agent runtime fetches the published `AgentSpec` (pull by version, or push on publish).
- [ ] **Appointment requests (frontend built in demo, 2026-10-24):** the flow the Appointments page shows. This is a description only: nothing is built on the server or pipeline yet.
  1. *Request in:* when the agent books on a call, the pipeline sends a request event: patient, phone, doctor, department, date and time, type, the reason for the visit in the patient's words, the call id, and an optional `checkReason`. The backend stores it as an `Appointment` with `status: "pending"` and `source: "ai_call"`. Several requests may share one doctor and time.
  2. *Ranking:* when a time has more than one pending request, an LLM ranks them from what the agent gathered. It writes `rank: {position, of, level: urgent|high|normal|routine, reasons, rankedAt}` on each, and ranks again whenever the set changes. We need to agree which model, the prompt and inputs, a timeout, and what happens if ranking fails (suggested: order by when they asked, with `level: "normal"`).
  3. *Decision:* staff confirm or decline (`declined` with a `declineReason`). When one request is confirmed, the others for that time are offered another time (`rescheduled`) or declined. Undo must withdraw any update to the patient that hasn't gone yet.
  4. *Automatic confirmation:* if `BookingSettings.confirm` is `"auto"`, a scheduled job runs each day at `autoAt` (organisation's local time). For each future time it confirms the top-ranked request and handles the rest per `others`. It skips urgent or flagged requests when the settings say so, and returns an `AutoConfirmResult`. It also runs on demand via `runAutoConfirm`.
  5. *Telling the patient:* after a request is confirmed, declined or moved, the pipeline places an outbound callback in which the agent states the outcome, and/or sends a WhatsApp template, as the settings say. It reports the state of each one back as a `PatientUpdate` (`queued → in_progress → done | no_answer | failed` for calls, and `queued → sent → delivered → read | failed` for WhatsApp). An unanswered call is retried once after 30 minutes when `retryCallback` is on. `retryPatientUpdate` re-queues a failed update. Still needed: the WhatsApp Business provider, approved template text and its variables, the outbound-call trigger API, consent and opt-out rules, and quiet hours.
  6. *API (proposed):* `GET/POST /orgs/:slug/booking-settings` (`settings.manage` to change); `POST /orgs/:slug/appointments/auto-confirm`; `POST /orgs/:slug/appointments/:id/updates/:updateId/retry`; and `status: "declined"` plus `changeReason` on the existing appointment update. Types are in `frontend/src/console/types.ts` (`AppointmentRank`, `PatientUpdate`, `BookingSettings`, `AutoConfirmResult`).

For each, write down the protocol, endpoint, auth, payload, error handling, timeouts, ordering guarantees and network constraints, following `.claude/rules/external-services.md`. **Don't build against guessed payloads.**

---

## 6. Security and privacy checklist (every phase)

- [ ] Check authorization on **every** org route with `org_permission`. Never trust a role or permission sent by the browser. *(Phase 1: done; `test_every_org_route_is_in_the_matrix` fails if a new org route skips the matrix.)*
- [ ] Check that the org slug in the path matches a membership. Return `403`, not `404`, if you want to avoid leaking which orgs exist; pick one and use it everywhere. *(Decided: **403** for members and outsiders alike, in `access/orgs.py`.)*
- [ ] Validate all input with Pydantic models: limit string lengths, use enums for statuses, and validate phone numbers and dates.
- [ ] Rate-limit write endpoints and anything that sends email or calls out (tool test).
- [ ] Record every write that matters (role changes, permissions, credentials, publish, delete, settings) in `activity`; record platform actions and act-as in `audit`.
- [ ] Keep PII out of logs and error messages. Add a log-scrubbing test. *(Log-scrubbing test added: `test_request_logs_carry_ids_and_no_personal_data`.)*
- [ ] Define data retention and deletion for calls, recordings, notes and members who leave. Hospital data needs a written policy (DPDP Act compliance in India).
- [ ] Keep the existing CSRF guard, CORS allow-list, `COOKIE_SECURE`, and the SameSite rules in `docs/cicd.md`. Don't loosen them to make a local setup work.

---

## 7. Testing and verification

- [ ] **Unit and route tests** for every endpoint, on `tests/fakes.py`. For each route, test: allowed role, denied role, wrong org, suspended org, act-as, invalid input.
- [ ] **A permission matrix test** that runs every org route against every role and asserts allow or deny from `access/permissions.py`. *(Built for Phase 1 routes; add each new route to `ROUTES` in `backend/tests/test_permission_matrix.py`.)*
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
3. ~~Phase 2, Requests to bitNtech: small, and it's already used by the detected-flow feature.~~ **Done.**
4. ~~Phase 3, Operations data, seeded by a script, while the pipeline contracts (§5) are agreed in parallel.~~ **Done** for storage, reading and updating; pipeline ingestion waits on §5.
5. ~~Phase 4, Reports, on rollups.~~ **Done.**
6. ~~Phase 5, Library, then Phase 6, Agents CRUD~~ **Done**, then Phase 7, Desk.
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

## Decisions made while building Phases 2 and 3

| Question | Decision |
|---|---|
| Withdrawing a request | The person who asked, or `team.manage` (the doc said `requests.create`; the UI and demo said `team.manage`) |
| bitNtech staff and requests | Read only; only the master admin replies and moves them on |
| Long detected-pattern requests | Trim the call list on the frontend; the 2,000-character limit stays |
| Operations data in production | `VITE_CONSOLE_LIVE` lists live sections; the default is Team, Settings, Activity and Requests, so the operations pages stay on sample data until an environment opts in (they'd be empty without the pipeline) |
| Activity for operations changes | None, as in the demo |
| Seed data | Only for orgs whose name or slug says test or demo (or `--force`), only with `--yes`, every record marked `seeded: true` |

## Decisions made while building Phases 4–6

| Question | Decision |
|---|---|
| Secrets at rest | AES-256-GCM, key in `SECRETS_KEY` (Vercel, Sensitive); not KMS |
| How a tool sends its secret | `Authorization: Bearer <secret>`, or the tool's own header name |
| Who tests tools | The master admin, as in the demo |
| Files | Straight from the browser to a private bucket with signed URLs; no virus scan yet |
| Report medians | Histograms (about 13% accurate) instead of storing every value |
| Agents list | Visible to every member (other pages label and filter by agents); opening one needs `agents.view`, `agents.test` or `agents.configure` |
| Live sections | `reports`, `numbers`, `tools`, `knowledge`, `uploads` and `agents` are switched on per environment through `VITE_CONSOLE_LIVE`; off by default |

## Follow-ups from Phases 4–6

**Manual steps:**
1. Set `SECRETS_KEY` on the backend's Vercel project (Sensitive): `python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"`. Keep a copy somewhere safe. Losing it means re-entering every secret.
2. Create the storage bucket (asia-south1, private, uniform access), add a CORS rule for `PUT` from `APP_URL`, and set `STORAGE_BUCKET`.
3. Create the new composite index (`rollups`: `agentId`, `day`).
4. On staging, add `reports,numbers,tools,knowledge,uploads,agents` to `VITE_CONSOLE_LIVE`. Before that, add numbers and agents there: no agents exist on the server until bitNtech builds them in the live builder.
5. Write a retention policy for call recordings (DPDP) before uploading real ones.

**Found by the independent review and fixed:**
- A rename or pause could hide another tab's newer save from the conflict check.
- Publish, discard and rollback now carry the revision too, so nobody publishes something they didn't see.
- bitNtech staff could write test scenarios.
- Tool tests:
  - they now try IPv4 first and each checked address in turn;
  - they read the reply uncompressed against an overall deadline, so a compressed or trickled reply can't run past the cap or the timeout;
  - an invalid port or an unreadable secret is explained instead of failing.
- Recording storage paths no longer take extensions from file names.
- A failed knowledge upload is cleaned up.
- Every agent version is read, not the first 500 or 1,000.
- Success and sentiment rates use analysed calls as the denominator.
- Unknown languages count as "mixed".
- Rebuilding rollups removes stale ones.
- Removing a recording no longer shows a false conflict in an open builder.
- Changing the address of a tool that sends a secret is now spelled out in the activity log.

**Accepted:**
- The in-use checks for knowledge and tools run just before the delete's transaction, so a save in the same instant could leave an agent pointing at a deleted source. This is rare and harmless: the agent simply doesn't find it.
- The master admin is trusted with tool addresses, and moves are logged.

**Known limitations:**
- AI work isn't connected: indexing, passages, search, transcripts, reading a flow from calls, running scenarios, and quality figures (until the pipeline sends them).
- No virus scanning of uploads.
- The tool form has no field for a custom secret header yet (the API takes `credentialHeader`).
- The agent builder can't take a new agent past step 0 in live mode, because reading a flow from calls needs the pipeline. bitNtech can still build flows by hand in the later steps.
- Templates (agent types, voices) are fixed until Phase 8's Ops templates.

## Follow-ups from Phases 2 and 3

**Manual steps:**
1. Create the new composite indexes and the two collection-group field overrides in `backend/firestore/indexes.json` (calls, callbacks, changeRequests).
2. Optionally set `CHANGE_REQUESTS_TO` on the backend's Vercel project.
3. On staging: `python -m app.scripts.seed_operations --org <test-org> --yes`, then set `VITE_CONSOLE_LIVE=team,settings,activity,requests,calls,callbacks,appointments,handoffs` and check those pages in a browser. Not yet done against real Firestore.

**Found by the independent review and fixed:**
- The call-log count wasn't ordered like the list, so every filtered call log (including every front-desk user's) would have needed indexes that don't exist. It now counts the same ordered query, and a test checks the query shape.
- Callbacks showed callers' names to people without `calls.personal`.
- Tool-call summaries and analysis text weren't scrubbed.
- An assignee removed at the same moment could still be given a callback.
- Work done while acting as a member wasn't recorded as theirs.
- The Ops list included suspended organisations.

**Known limitations:**
- No pipeline ingestion: calls, handoffs and agent-booked appointments can't arrive until §5 is agreed. Recordings aren't served.
- A call-log search matches one word (the longest), not a phrase.
- Request emails go to a fixed list, not to each master admin's account.
- In live mode, demo pages that create requests (Agents, the agent workspace) send demo agent ids, stored as given until Phase 6.

## Follow-ups from Foundations and Phase 1

**Manual steps before turning `VITE_CONSOLE_MODE=live` on in an environment:**
1. Create the composite indexes in `backend/firestore/indexes.json` (the new `activity` ones). Until then, filtered activity answers 503.
2. Add a Firestore TTL policy on collection group `ratelimits`, field `expiresAt`.
3. Optional: `python -m app.scripts.backfill_members`, then `--apply`, so every existing member shows on the Team page at once. The API also does this lazily.
4. Add `LOG_FORMAT=` to `backend/.env.example` by hand (blocked in this session).
5. Set `VITE_CONSOLE_MODE=live` on the frontend's Vercel project, staging first. Then check sign-in, Team (invite, accept, role, permissions, remove), Settings and Activity in a browser against the real Firebase project. This hasn't been done yet; every check so far ran against the in-memory fakes.

**Found by the independent review and fixed:** older members who hadn't signed in were invisible on the Team page and couldn't be removed (now `sync_members`); `/join` could replace an older member's role (now refused); a lost reply after a committed accept could delete the new account (now kept). **Accepted as designed:** owners can hand out any permission, including ones another owner restricted on them.

**Known limitations:**
- ~~In live mode the Callbacks and Live calls pages (still sample data) receive the real team list.~~ Resolved once `callbacks` is in `VITE_CONSOLE_LIVE`: callbacks are on the server since Phase 3. Live calls (sample data) still get the real team for transfers.
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
