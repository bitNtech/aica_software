# Project Handoff

## Status
- Latest (2026-10-27, `feat/branching-flowchart-and-builder-requests`, **uncommitted**): the console is connected to the AICA voice orchestrator: agents are built and published to it, tested by browser calls, and live calls are run and joined from the console. bitNtech has an Ops page for the orchestrator. See "Voice orchestrator" below and `docs/orchestrator-contract.md`. Approved "proceed" on the Phases A–E plan. Verified: backend pytest 701 passed / 3 skipped; frontend `tsc -b` clean, vitest 898/898 (one run under load had one flaky failure; two reruns clean), `npm run build` ok; live checks against the test tenant `ten_7e28…` (below).
- Dev scripts (2026-10-27): `npm run dev` now sets `VITE_CONSOLE_MODE=live` and every live section in `VITE_CONSOLE_LIVE` (real sign-in, every page from the local API on :8000); `npm run dev:demo` sets `VITE_AUTH_MODE=demo` and `VITE_CONSOLE_MODE=demo`. Builds and Vercel are unchanged. Script values win over `.env.local`.
- Fix (2026-10-27): the Ops organisation page no longer fails for a real organisation. Its usage, team, jobs and history still come from sample data that only knows the demo organisations; when that's missing the page shows the rest (Manage links, Agents, Voice server link) with a note. `OpsOrgDetailPage.tsx`, plus an `opsClient` option on the test `renderApp`.
- Next recommended action: put `ORCH_API_KEY` and `ORCH_WEBHOOK_SECRET` in `backend/.env` and the backend's Vercel env, add `agents,live,calls,handoffs` to `VITE_CONSOLE_LIVE`, link a test organisation to `ten_7e28f7eeaaf97338038c4bb3` in Ops, publish an agent, and place a microphone test call in a real browser. Then rotate the two secrets shared in chat.
- Latest (2026-10-25, `main`, **uncommitted**): the conversation flow is drawn as a conditional branching flowchart, and branches can join back up (see "Flowchart and joins" below). Approved "proceed". Verified: `tsc -b` clean, vitest 881/881 (65 files), `npm run build` ok, headless screenshots reviewed (Flow tab diagram light and dark at 1440, outline, 390).
- Next recommended action: look at the diagram in a real browser (edit a branch, pick "Then carry on at"), then add `joinsAt` to the backend's flow schema when the builder contract is agreed.
- Latest (2026-10-25, `main`, **uncommitted**): branching conversation trees everywhere, agent requests built in the agent builder, agents shown as agents, and call uploads inside each agent's builder (see "Branching flows and builder requests" below). Approved "proceed" with these answers: frontend and demo first; as many settings as possible; related calls grouped, unrelated kept apart; the master admin keeps building and publishing to the organisation; existing flows converted. Verified: `tsc -b` clean, vitest 863/863 (64 files), `npm run build` ok, headless screenshots reviewed (Agents at 1440 and 390, Flow tab outline and diagram, builder flow step with groups, a change draft's calls and flow steps).
- Next recommended action: try it in a real browser (owner/admin asking, master admin publishing), then agree the backend contract for `startAgentChange`, `submitDraft`, draft ownership fields and flow grouping (`docs/backend-workflow.md` §5) before building it.
- Latest (2026-10-25, `main`, **uncommitted**): calendars now pile up the agent's requests for one time instead of merging them into one block (see "Appointment requests" → "Calendar piles"). Approved "proceed". Verified: `tsc -b` clean, vitest 846/846, `npm run build` ok, screenshots reviewed (Day and Week at 1440, the list view at 390).
- Latest (2026-10-24, `main`, **uncommitted**): appointment **requests** flow (see "Appointment requests" below). Approved "proceed" on the revised plan. Frontend and demo only. Verified: `tsc -b` clean, vitest 846/846 (62 files), `npm run build` ok, screenshots reviewed (1440 and 390).
- Next recommended action: agree the pipeline contract in `docs/backend-workflow.md` §5 "Appointment requests" (request event, LLM ranking, outbound callback, WhatsApp provider and templates), then plan the backend.
- Latest (2026-10-24, `main`, **uncommitted**): Appointments page reworked (see "Appointments rework" below). Approved "no backend, otherwise go with the best". Verified: `tsc -b` clean, vitest 835/835, `npm run build` ok, screenshots reviewed (1440 and 390).
- Latest (2026-10-24, `main`, **uncommitted**): seven organisation console pages (see "Organisation console pages" below). Approved "proceed" on the recommended defaults: owners act on their own (typing the organisation's name instead of a password check, because there's no re-authentication API); email-only alerts; Activity renamed Audit log; UI only. Verified: `tsc -b` clean, vitest 823/823, `npm run build` ok, screenshots reviewed.
- Latest (2026-10-24, `main`, **uncommitted**): the master admin's Ops app now covers every organisation (19 pages; see "Ops management pages" below). Approved "proceed" with these answers: personal data is the master admin's only; Deployments covers both agent versions and platform releases; Security covers both policies and access review; old addresses redirect; Billing has both provider payment methods and invoices; built directly, without subagents. Verified: `tsc -b` clean, vitest 813/813, `npm run build` ok, headless screenshots reviewed.
- Next recommended action: try the pages in a real browser, then plan the backend: one cross-organisation endpoint per Ops page, plus incidents, deployments, security policies and billing APIs.
- Latest (2026-10-24, `main`, **uncommitted**): the Ops overview (`/ops`) is rebuilt as a platform dashboard for master admin and staff. It's UI only; the backend comes later. See "Ops overview" below. Verified: `tsc -b` clean, vitest 796/796, `npm run build` ok, headless screenshots reviewed (1440 light and dark, 390).
- Next recommended action: look at `/ops` in a real browser, then agree definitions and plan the backend for `getOverview`/`getLiveOps` (contract in `frontend/src/ops/types.ts`).
- Previously (2026-10-24, `main`, **uncommitted**): the Operate pages are rebuilt around the people who use them (Phases 0–4 of the rebuild plan, each approved). See "Operate rebuild" below. Verified: `tsc -b` clean, vitest 786/786, `vite build` ok, backend pytest all passing, headless screenshots reviewed (1440 light/dark, 390).
- Next recommended action: try every Operate page in a real browser (keyboard-only too), then commit. Optional follow-ups are listed in "Operate rebuild".
- Previously (2026-10-23, `main`, **uncommitted**): backend reorganised into packages (`core/`, `auth/`, `access/`, `data/`, `domain/`, `integrations/`), with the Firestore files in `backend/firestore/`. Approved "proceed with safe and efficient option". Files moved and renamed; no logic changed. The layout and where new code goes are in `backend/README.md` → "Layout"; keep to it on every backend change.
  - Renames: `settings`→`core/config`, `access`→`access/permissions`, `secrets`→`data/vault` (no longer shadows Python's `secrets`), `reports`→`domain/rollups` (no clash with `routes/org/reports.py`). The `config.py` path to `backend/.env` is adjusted for the deeper folder.
  - Verified: pytest 601 passed, 3 skipped (same as before); all 56 modules import; frontend parity tests 28/28 and `tsc -b` clean. Path mentions are updated in code comments, `backend/README.md`, `docs/backend-workflow.md`, `docs/cicd.md` and the frontend parity tests; older handoff entries below keep their original paths.
  - Not verified: a Vercel preview deploy (its FastAPI detection uses `app/main.py`, which didn't move).
- Previously (2026-10-23, `main`, **uncommitted**): UI clean-up across every page (landing, sign-in, console, ops), approved "proceed" with Rubik as the one font. See "UI clean-up" below.
- Next recommended action: look over the pages in a real browser (light, dark and phone width), then commit. The Phase 1–6 next step below still stands.
- Previously (2026-10-20, `feat/detected-flow-patterns`): Phases 4 (reports), 5 (library: numbers, tools, secrets, knowledge and upload metadata) and 6 (agents, versions, drafts, scenarios) are built on top of Phases 1–3 (`b34db71`). **Not run against real Firebase, storage or the network yet.**
- Next recommended action: set `SECRETS_KEY` and `STORAGE_BUCKET`, create the indexes, try Phases 1–6 on staging, then agree the pipeline contracts (§5) before Phase 7 (bot desk).
- Latest (2026-10-19, `feat/detected-flow-patterns`, **uncommitted**): Phases 2 (requests to bitNtech) and 3 (calls, notes, callbacks, appointments, handoffs: storage, reading and updating) are built on top of the pushed Phase 1 commit `f9cc1fd`. The stray `not staged for commit:` file (a saved `less` help screen) is removed. **Not run against real Firebase yet.**
- Next recommended action: create the new indexes in `backend/firestore.indexes.json`, try Phases 1–3 on staging (seed with `app.scripts.seed_operations`), then agree the pipeline contracts in `docs/backend-workflow.md` §5 before Phase 4 (reports).
- Latest (2026-10-19, on branch `feat/detected-flow-patterns`, **uncommitted**): backend Foundations and Phase 1 from `docs/backend-workflow.md` are built: org access guard, shared permission table, transactional store layer, shared rate limiter, JSON logs, and the Team / Settings / Activity endpoints with revocable invites and a signed-in join path. The frontend has `httpConsoleClient` (`VITE_CONSOLE_MODE=live`), a per-section "Demo data" label and the invite page's existing-account path. **Not yet run against the real Firebase project.**
- Next recommended action: do the manual rollout steps in `docs/backend-workflow.md` → "Follow-ups from Foundations and Phase 1" (indexes, TTL policy, `.env.example` line), try it on staging, then plan Phase 2 (Requests to bitNtech).
- Latest: `main` was restored to exactly this commit's state (PR #25, `2101d6c`) on 2026-10-18, discarding PR #26 and PR #27 ("premium redesign" — warm charcoal/champagne palette, homepage rebuild, mobile pass) by explicit request, via a new commit whose tree matches `2101d6c` byte for byte (`git checkout 2101d6c -- .` + removing two files PR #27 added), not a reset or force-push. Those commits stay in `main`'s history; this just moves the tip's content back to what PR #25 shipped. If the premium redesign is wanted again, it needs to be re-applied — it isn't recoverable by simply moving the branch pointer forward again, since this restore is itself a new commit on top of it.
- Previously: pushed to `main` directly (merged with `origin/main`'s PR #23) on 2026-10-18, then fixed the 5 CI test failures the push exposed; see the 2026-10-18 entry. The 2026-10-17 report/heatmap work and the 2026-10-16 permissions rework are both committed and on `main` now.
- Phase: Auth backend (FastAPI + Firebase) built and connected to the console frontend. **Not yet run against the real Firebase project:** it's waiting on `backend/.env`, the service-account key and the Google OAuth client (see "Needed from the user").
- Implementation approval:
  - 2026-10-12, Option B, master admin powers: People page (roles, disable/enable, sign out everywhere, invites as staff or master admin), audit log viewer, acting as a client user (30 min, audited, client not emailed). Guards: no self-changes, at least one active master admin, client accounts can't hold bitNtech roles, staff can't see People or the audit log. Asking for the password again before risky actions was deferred.
  - 2026-10-12, master admin for admin@bitntech.in (Option A): `seed_master --no-email`, then promote the account. Option B (wider master-admin powers) is to be planned next.
  - 2026-10-11, sign-in pages
  - 2026-10-11, sign-up and master admin pages
  - 2026-10-12, CI/CD: own GitHub repo for `aica_software` (workflows in `.github/workflows/`), deploy to Vercel for every environment (PR previews and production), separate Firebase project for previews, `*.vercel.app` for now, manual approval before production, Dependabot
  - 2026-10-12, landing page at `/`: copy `aica_web` into `frontend/` (the user asked for it inside `frontend/`, not as a top-level folder), add sign-in/sign-up buttons and integrations
  - 2026-10-12, demo form via the backend: `POST /api/leads/demo` emails requests through Resend to `DEMO_REQUEST_TO` (default support@bitntech.in), no Firestore copy
  - 2026-10-12, separate hosting: frontend and backend as two Vercel projects on hosts that share a site (e.g. `aica.bitntech.in` and `api.aica.bitntech.in`), configured by env
  - 2026-10-11, the backend: FastAPI, email/password and Google, Firestore `(default)` database (asia-south1; the user first said `aica`, but no database has that ID), Resend, master admins support@ and admin@bitntech.in, local env, default session lengths
- Last verified: 2026-10-12 (CI/CD), 2026-10-11 (app).
  - Backend: `pytest` 22/22 against in-memory fakes; startup fails fast with a clear message when the key is missing.
  - Frontend: `npm test` 48/48, `tsc` clean, `npm run build` passes.
  - Screenshots: API-mode login with the Google button, the Google-cancelled message, and the backend-down state.





## Voice orchestrator (2026-10-27, approved "proceed"; backend and frontend)

**What it does**
- **Agents on the voice server.** Publishing (agent publish, rollback, draft publish) saves the version, then writes it as an LLM agent (through `/v1/llm/agents`) and a voice agent (`/v1/voice-agents`) for the organisation's tenant.
  - Each agent also has a test pair, built from its saved working setup, so testing never changes what callers hear. Drafts get a test pair too.
  - Renaming resyncs. Pausing disables the voice agent. Deleting removes the copies.
  - A failed sync shows on the agent (a banner, and the Settings → Voice server card, with Retry) and never undoes the publish.
- **The mapping** is in `docs/orchestrator-contract.md`. In short:
  - instructions are written from persona, rules, flow (branches and joins), details, global flows, guardrails, FAQ knowledge and pronunciations;
  - the voice is the agent's `voiceId` when the TTS server has it, else its active voice, with a warning;
  - the VAD, barge-in, fillers, idle, call length, handoff and prompts overrides follow the pipeline settings;
  - HTTP tools become LLM tools, with the secret header decrypted at sync;
  - settings it has nothing for are listed on the agent's Settings tab.
- **Using agents.**
  - The Test tab's "Test call in your browser" talks to the saved changes or the live version. It has mute, stop the agent, typed turns, latency figures, close-code messages, and "what the agent heard" afterwards.
  - Scenarios now run for real, as text through throwaway LLM sessions, checking "must say", handover and intent.
  - The builder's review step has a draft test call (master admin).
  - The behaviour editor plays a voice sample.
- **Live calls.**
  - The live calls page reads the voice server, polled every 4 s, and shows only this organisation's calls.
  - Staff listen in or take over in the browser (operator socket), say things the caller hears, stop the agent, give the call back, or end it.
  - "Guide the agent" becomes "Say something", because the voice server has no whisper.
  - "Take the call" asks for a person, then joins in takeover.
  - The handoff queue pulls from `/v1/handoffs`.
- **Call history.** Finished calls come in by signed webhook (`/api/hooks/orchestrator`), or by `POST /calls/sync`, which Call history runs on open.
  - Each call is written once, through `record_call`, so reports count it.
  - Test calls stay out.
  - Caller words (and agent words when `redact`) are marked personal.
- **Ops → Voice server (`/ops/voice`).**
  - Status (polled every 5 s), with reloads and maintenance mode.
  - A settings editor generated from the JSON Schema, with search, locked and secret fields, per-field and per-section reset, a dry run before every save, and version conflicts handled.
  - Model and voice switches showing `in_use`, and ASR load and unload.
  - Testing another LLM or TTS server, then switching to it.
  - Presets, checked first.
  - All live calls, with End, and the change history.
  - Ops → organisation → Voice server links the tenant.
- **Security.**
  - The platform key is in backend env only, and the tenant comes from the organisation record.
  - The browser gets 10-minute call tokens in the `bearer.` subprotocol.
  - Webhooks are HMAC-checked with 5 minutes of clock difference and read back before writing.
  - Ops writes are audited without values.
  - Staff can't start calls or change anything.

**Files**
- Backend, new: `integrations/orchestrator.py` (client, error mapping), `integrations/voicesync.py`, `domain/agentcompile.py`, `domain/voicecalls.py`, `routes/org/voice.py`, `routes/hooks.py`, `routes/ops_voice.py`, `tests/fakeorch.py` (an in-memory orchestrator), `tests/test_voice.py`.
- Backend, changed: `core/config.py` (`ORCH_*`), `core/services.py`, `data/store.py` (`OrgDoc.orchTenantId`, `AgentDoc.voice` / `voiceAgentId`, `DraftDoc.voice`, `ToolDoc.llm`), `main.py` (hooks are exempt from the Origin check), `routes/org/agents.py`, `routes/org/handoffs.py`, `.env.example`, `README.md`, and the permission matrix (new routes).
- Frontend, new: `console/voice/` (pcm, audio, sockets, callState, closeCodes, useVoiceCall), `components/voice/` (VoiceCallPanel, OperatorPanel, CallTranscript, VoicePreview, Voice.css), `ops/voiceAdmin.ts`, `pages/ops/OpsVoicePage.tsx`, `pages/ops/voice/` (SettingsEditor, panels, OrgVoiceLink, VoiceOps.css), `pages/console/agent/VoiceServerCard.tsx`, and tests `voice-call.test.ts` and `voice-settings.test.tsx`.
- Frontend, changed: `types.ts` (optional voice methods, the `live` section), `httpConsoleClient.ts`, the agent workspace (Test and Settings tabs, failed-sync banner), the builder (behaviour preview, review call), Live calls (detail, forms), Call history (sync on open), Ops (nav, route, org page), and two tests updated for live models and scenarios.

**Checked live** (test tenant, everything created was deleted)
- Creating a voice agent with our id; 409 on a repeat; 412 on a stale ETag.
- PATCH replaces whole sections (so `prompts: {}` is always sent); `null` is refused.
- The profile endpoint.
- Voice and operator tokens; `aica.voice.v1` and `aica.operator.v1` with `bearer.<token>`.
- `session.start` with our metadata, typed turns, barge-in events, REST `say` and `end`, and a 1000 close.
- Our live-call and call mappings on real sessions and events.
- Agent audio arriving at 48 kHz, about 1.3 s to first sound.
- LLM sessions with the client handover tool: it must carry the orchestrator's description, or the model never calls it.
- WAV preview; `/v1/models` and `/v1/tts/voices` without a tenant.

**Not run**
- README §8's model switch and server-wide setting change. The sandbox refused them, because they change the shared orchestrator for every tenant. The Ops page does both (unit-tested against the fake). Try them once yourself, or allow them.
- A microphone call in a real browser. The audio worklet and playback are unit-tested with stand-ins only.
- Webhook delivery from the real orchestrator: it needs a public https `API_URL`, `ORCH_WEBHOOK_SECRET`, and a republish so our voice agents carry `webhook_url`.
- The real backend with Firebase; the frontend `.env.example` (unreadable here). Add `agents,live,calls,handoffs` to `VITE_CONSOLE_LIVE` yourself.

**Limits and follow-ups**
- The TTS server has no named voices, so every agent speaks with its active voice until voices named after the catalogue (`kavya`…) are added there.
- Not on the voice server:
  - document and web knowledge (only FAQ reaches the agent);
  - SMS and WhatsApp tools;
  - keypad, ambience, per-agent noise removal, speaking rate;
  - a whisper only the agent hears;
  - reading a flow from uploaded recordings.
- Call outcomes are provisional (handed over, dropped, resolved) and intent is "Not analysed yet" until post-call analysis exists.
- Callers' phone numbers come from session metadata (`caller_phone` etc.), which SIP calls will need to set.
- Live calls are polled, not pushed: 4 s per organisation page, with one events read per call (at most 20).
- The two secrets were shared in this chat: rotate them.

## Flowchart and joins (2026-10-25, approved "proceed"; frontend and demo only)

The user asked for the flow to look like a "Conditional Branching Flowchart" (a survey-style reference: numbered cards 1, 1a, 2; Start chip; type chips; Edit and ×; teal condition labels on curved lines; "Otherwise" grey; branches joining into the next question; "Ends the survey"; dotted grid).

- **Data:** `FlowNode.joinsAt?: string` (`console/types.ts`): a node with no plain step of its own may carry on at a step in the same intent. The tree still owns each node once. Old flows are unchanged (optional field, nothing to migrate).
- **`console/flowGraph.ts`** (new): `indexFlow`, `canJoin`, `joinTarget`, `successors`, `joinOptions` (steps in the intent that don't lead back), `joinProblems` (missing, wrong kind, both a step and a join, circular), `numberFlow` (1, 1a, 1a.1, 2), `tidyJoins`.
- **Edits keep joins valid** (`builder/flowTree.ts`): delete ends joins at what goes; delete-alone moves them to the step that followed; adding a step after a joining node hands the join to the new step; `checkFlow` reports join problems and lets a branch with no steps of its own carry on where it joins. Counts: a join is a way on, not an end.
- **Followed everywhere:** simulator (`simulate.ts`), request outline (`flowRequest.ts`: "Then carries on at" / "Otherwise, carries on at"), call matching and pattern grafting (`compare.ts`), demo known paths (`demo/flowPatterns.ts`).
- **Layout** (`flow/layout.ts`, rewritten): rows by longest path (a card sits one row below the lowest card leading to it); long lines keep a gap open in each row they cross; order by barycentre with the outline order breaking ties; positions by least-squares packing (pool-adjacent-violators) with alternating down/up sweeps, so a join sits centred under its branches. Curved (cubic) lines from card foot to card head; labels sit above the target, below the source, in the first gap of a long line, or mid-curve. Cards are one width and top-aligned in a row. Edge kinds `next | branch | join`.
- **Cards** (`FlowSvg.tsx`, still SVG so the tree a11y and zoom are unchanged): number badge, Start chip on intents, kind chip with icon, coloured left edge, say text, "↳ Ends the call" / "↳ Carries on at 2", handles top and bottom (the fold toggle is the bottom handle), and when editable Edit and × on every card (mouse only, `aria-hidden`; the keyboard keeps F2, Delete and the focused-node edit bar). Arrowheads only on a call's highlighted path. Colours in `FlowCanvas.css` as `--flow-*` tokens with dark values.
- **Accessible names** keep "Step: label" first, then "when …", then "numbered 1a"; the description says where it carries on or that the call ends. On-path highlighting picks the line from the latest card on the path, so joins don't light up the wrong line.
- **Outline** (`FlowEditor.tsx`): number badges; "Then carries on at 2 · …" (a button that goes to that row); a fork whose node joins shows an extra "Otherwise → carries on at" way; the edit form has "Then carry on at" (or "If none of its branches applies, carry on at") with only valid steps; delete warns how many paths carry on at what goes.
- **Demo:** templates join where it's natural (the away-doctor branch rejoins at the first-visit question; "Takes the next day" joins at the one "Confirm the booking"; "No booking found" rejoins at "Offer new slots"). Store key bumped to `aica.demo.console.v11`.
- **Tests:** new `flow-joins.test.ts` (numbers, options, problems, counts, edits, simulator, outline, matching, layout in TB and LR); canvas tests for cards, on-card buttons and drawn joins; an outline test choosing a join; layout tests moved to cards (top-aligned, one width) and the edge check samples curves.
- **Limits:** a join can only go to a step in the same intent and never back up (no loops, so "ask again" loops aren't drawable); a long flow is tall (cards are bigger than the old boxes); steps can't be dragged; the backend schema doesn't know `joinsAt` yet.

## Appointment requests (2026-10-24, approved "proceed"; frontend and demo only)
- **Flow:** the agent books on a call → the request appears in Appointments (in-page alert and toast for new ones; sidebar and Home count "to review") → the LLM ranks requests that share a doctor and time → staff confirm or decline → the agent calls back and/or WhatsApp tells the patient. Settings allow automatic confirmation at a chosen time each day.
- **Types** (`console/types.ts`): the `declined` status, `AppointmentRank`, `PatientUpdate`, `BookingSettings`, `AutoConfirmResult`; `rank`, `updates`, `declineReason` and `confirmedBy` on `Appointment`; the `declined`/`notified` history kinds. There are four optional `ConsoleClient` methods (`get/updateBookingSettings`, `runAutoConfirm`, `retryPatientUpdate`). The http client rejects all four with "needs the AICA server to be updated first", and `toApiPatch` refuses `declined`.
- **Demo** (`console/demo/bookingRequests.ts`, new):
  - ranking: a keyword stand-in for the LLM, `refreshRanks`;
  - `queueUpdates`, `advanceUpdates`, `withdrawQueued`;
  - `runAuto`, `nextFreeTime`;
  - seeded shared times and declined requests, plus updates on settled agent bookings (one failed WhatsApp).

  `demoClient.ts` adds decline, queues updates on confirm, move and decline (agent bookings only), and makes Undo withdraw queued updates. It also adds a new request every 4 minutes, six at most.
- **UI** (`pages/console/operate/appointments/`):
  - `RequestsView.tsx`: groups, rank, Recommended, auto banner, Run now;
  - `ConfirmRequestDialog.tsx`, `DeclineDialog.tsx`, `RequestActions.tsx` (`useRequestActions`);
  - `PatientUpdates.tsx`, `BookingSettings.tsx`, `useNewRequests.ts`;
  - Detail: Priority, Patient told, Decline;
  - Day and Week show one block for a shared time ("3 requests").

  In `model.ts`:
  - only the agent's pending requests are contests (`isRequest`): they don't flag each other as double-booked, and a request for a time already given is flagged;
  - also `requestGroups`, `rivalsOf`, `collapseRequests`, `autoPreview`.
- **Elsewhere:** `useAttention` and Home count `awaitsReview`. Ops appointments adds Requests waiting, Times with several requests, Declined, and the rank line.
- **Mistake made and fixed:** I first wrote the new demo module over the existing tracked `console/demo/requests.ts` (bitNtech change requests). It was restored with `git checkout -- frontend/src/console/demo/requests.ts`; that file had no uncommitted changes. The new code lives in `bookingRequests.ts`.
- **Calendar piles (2026-10-25):**
  - Day and Week no longer merge requests into one block. The agent's requests for one time overlap as a pile: each card is offset 14px by rank, with the best-ranked in front. Each shows its rank number in the level's colour, in its bottom-right corner, and the top card says "Decide · N".
  - A pile takes a single lane in `layoutColumn`, so only bookings that truly clash sit side by side.
  - Hover or focus brings a card forward. The pulse is off under reduced motion, and there is an outline in forced colours.
  - The arrow keys go down a pile in rank order.
  - The phone agenda lists the pile in rank order, indented, with the same marks.
  - The screen-reader label says "ranked N of M requests for this time, waiting for a decision".
  - `pileOf` and `byStartRank` are in model.ts. `collapseRequests` was removed.
- **Limitations:**
  - There is no backend, LLM, outbound call or WhatsApp. The demo ranks by keywords, and updates move through their states on a timer.
  - The automatic run happens only via Run now; there's no scheduler.
  - Booking settings, ranking and updates show "not on the server yet" in live mode.

## Appointments rework (2026-10-24, approved; frontend only)

- **Model** (`console/types.ts`):
  - Statuses are `pending | confirmed | rescheduled | completed | no_show | cancelled`. "Needs a check" is now the agent's `checkReason` flag on a pending or rescheduled booking (`needsCheck()` in `console/appointmentRecords.ts`).
  - New fields: `source` (`ai_call | front_desk | manual`; `bookedBy` is kept in step), `type`, `visitReason`, `cancelReason`, `updatedAt`/`updatedBy` and `history[]`.
  - `AppointmentPatch` gains `changeReason` and `undo`. New `createAppointment`.
- **Live API compatibility:** `fromRecord` reads the API's `booked`/`needs_check` as pending. `toApiPatch` writes only status (pending/rescheduled → `booked`), date, time, doctor, department and note.
  - In live mode, Mark completed, Mark no-show and Add appointment say the server needs updating.
  - Reasons, type and history aren't stored by the API yet. **Backend follow-up:** the new statuses and fields, history, `POST …/appointments`, and a status migration.
- **Page:**
  - Calendars: Day by doctor, Week, Month (new). Lists: Today's appointments (new: upcoming, completed, missed or unmarked), All, Pending confirmation (new), Cancelled and rescheduled (new).
  - Filters now say "Booked through".
  - The detail shows the ID, type, reason, source, created and updated times, and the history timeline (`History.tsx`).
  - Actions: Add appointment (`CreateDialog.tsx`), Confirm, Reschedule (reason required; confirmed if the patient agreed, else rescheduled), Cancel (reason required), Mark completed and Mark no-show (after the time), Book it again, View call. Undo is one exact `undo` patch.
- **Problems:** only open bookings are checked. A past confirmed booking is "Not marked".
- **Demo:**
  - The seed now covers two weeks either side, with every status, source, type and reason, and its history.
  - The demo client enforces the order of statuses, required reasons and "after the time".
  - Demo data saved earlier is converted when read.
- **Other readers updated:** Home shift and Needs a person, sidebar attention, and Ops appointments (the KPIs now include Needs a check).
- **Tests:** `test/appointments-flow.test.tsx` (new); appointments page and logic, http client, home-shift and attention tests updated.
- **Pipeline:** agent bookings still can't reach the API until the §5 contract is agreed. The page already shows them automatically once they're stored.

## Organisation console pages (2026-10-24, approved "proceed"; UI only)

- `/o/:slug/analytics`: the report dashboard as its own page (Home keeps it); `/reports` redirects. Page key `reports`, shown in the Operate menu.
- `/o/:slug/owners` (`owners`): owners edit, admins read. Make someone an owner after typing the organisation's name; change another owner to admin.
  - It uses the existing Team API, so it works live. The rules stay the API's: nobody changes their own role, and there's always one owner. So stepping down means asking another owner.
- `/o/:slug/usage` (`usage`): owners and the master admin from Ops.
  - Minutes, live agents and lines against the plan; calls each day this period; a month-end forecast with the cost of extra minutes; the alert level.
  - It's built from `getBilling` (no backend yet), agents, numbers, the report and alert settings.
- `/o/:slug/notifications` (`notifications`): owners and admins. Per alert: on or off, roles, named people, thresholds, and quiet hours (emergencies always go). Email only.
  - New `getAlertSettings`/`updateAlertSettings` on `ConsoleClient`, in demo only. In live mode they fall back to the demo store, labelled "Demo data". **Backend needed.**
- `/o/:slug/audit` (the `activity` page key, renamed "Audit log"): `/activity` redirects, and so does `/ops/orgs/:slug/activity`.
  - Adds a period filter that loads older pages until the period is covered (30 days by default), and a CSV download of up to 2000 entries.
- `/o/:slug/profile` (`profile`): the account sections plus your role and permissions here.
  - `/account` redirects people in one active organisation here, and bitNtech staff to `/ops/profile`. The sidebar name links here.
- Billing: the invoice table no longer squeezes on a phone, and the "owners only" wording is right for both owners and the master admin.
- Docs: `docs/pages-and-access.md` §3.3 and the Analytics row are updated; `console-access` test table updated.
- Tests: `test/console-manage.test.tsx` (new); `account.test.tsx` and `manage-pages.test.tsx` updated for the move and rename.
- **Follow-ups:**
  - backend for alert settings and billing;
  - a re-authentication API if a password check is wanted for owner changes;
  - SMS or WhatsApp alerts need a provider.

## Ops management pages (2026-10-24, approved "proceed"; UI first)

- **Sidebar:** grouped into Organisations, Calls, Platform and Master admin. On a phone it's one row that scrolls sideways. The name link goes to `/ops/profile`.
- **Organisation pages:**
  - `/ops/orgs`: search, a status filter, sort, and calls, agents and attention flags per organisation.
  - `/ops/orgs/:slug` has "Manage" links to every page below.
  - The Ops organisation frame now also includes the console's calls, call detail, live, callbacks, appointments, knowledge, numbers, team, activity, settings and billing pages, as well as agents, integrations, uploads and requests. One list (`opsOrgPages` in `OpsOrgShell.tsx`) drives both the menu and the links.
  - Calls, live, callbacks, appointments and billing are the master admin's only (`OpsOrgPage masterOnly`).
  - Agent test and versions are the existing workspace tabs (`/agents/:agentId/test`, `/versions`).
- **Across organisations:** `/ops/calls`, `/ops/calls/live`, `/ops/handoffs`, `/ops/appointments`, `/ops/integrations`, `/ops/billing` and the access review on `/ops/security`.
  - They read each organisation through the existing console endpoints (`pages/ops/acrossOrgs.tsx`). One failing organisation is reported without hiding the others.
  - This asks once per organisation, which is fine for a few dozen. **Backend follow-up:** add endpoints that answer for every organisation in one request.
  - Staff see calls without callers' names or numbers ("Hidden") and can't open calls.
  - `/ops/calls/:callId?org=slug` redirects into the organisation frame.
- **New, demo-only:** `listDeployments`, `listIncidents`/`createIncident`/`updateIncident` and `get`/`updateSecurityPolicy` on `OpsDataClient`. The types in `ops/types.ts` are the proposed contract. Incidents and policy changes only last until the tab is closed.
- **Moved:** `/ops/usage` now redirects to `/ops/analytics` (overview analytics with a CSV download, plus the old usage report). `/ops/changes` redirects to `/ops/support` (same page, renamed). `/account` sends bitNtech staff to `/ops/profile`.
- **Access change:** the master admin can now open and change an organisation's billing.
  - `console/access.ts` billing rule; the demo client's `getBilling`/`changePlan`/`updateBillingDetails`; `console-access` test table updated.
  - **The backend has no billing endpoints yet.**
- **Tests:** `test/ops-manage.test.tsx` (new). `ops-pages.test.tsx` is updated for the analytics move.
- **Not verified:** a real browser by a person, a screen reader, any live backend for the new pages.
- **Known issues and follow-ups:**
  - The console billing page's invoice table squeezes on a phone. This also affects the console itself.
  - That page says "Only owners see this page", which is wrong when the master admin opens it from Ops.
  - Callbacks for staff follow the demo's "own or unassigned" rule.
  - Consider paging `/ops/calls`, which is capped at 200 per organisation and shows 500.

## Ops overview (2026-10-24, approved "proceed"; UI only)

- **Built:** `/ops` puts the page in this order:
  - a period filter (Today / 7 / 30 days) and a jump bar;
  - 8 KPI cards;
  - Needs you: sign-ups awaiting approval, organisations needing attention, critical alerts;
  - Live operations: calls in progress, callers waiting for a person, recent failures. These refresh every 15 s;
  - Analytics: call volume, successful vs failed, outcomes and handoff rate, reply time, usage by organisation, agent performance;
  - Organisations: recently registered, by status, busiest, then **the full list with every earlier action (act as owner, suspend, restore, review), unchanged**;
  - Agents: published, draft and inactive counts, errors or slow replies, recently updated;
  - Recent activity: one timeline you can filter. Admin actions show for the master admin only;
  - Platform health: ASR, LLM, TTS and telephony, plus active incidents.
- **Data:** organisation figures come from the real `listOrgs()`. Everything else comes from two new `OpsDataClient` methods, `getOverview(days)` and `getLiveOps()`, which are demo-only for now. Every panel that uses them shows a "Demo data" label.
  - The types in `frontend/src/ops/types.ts` are the proposed backend contract.
  - The demo builds on the same call log as `/ops/usage`, so totals match; a test checks this.
- **Definitions used (to confirm before the backend):**
  - success means a call was neither dropped nor a technical failure;
  - handoff rate is calls handed over, emergencies included;
  - agent "errors" means more than 5% of calls failed over the last 7 days (with at least 20 calls); "degraded" means its slowest replies are over twice its usual;
  - telephony latency is the time to connect a call.
  - Active calls and telephony have no real source anywhere yet.
- **Files:** `ops/types.ts`, `ops/demoOpsClient.ts` (also moved the status helpers into `serviceHealth`/`failuresBack` with no behaviour change), `pages/ops/OpsOverviewPage.tsx`, `pages/ops/overview/*` (new), `test/ops-overview.test.tsx` (new).
- **Not verified:** a real browser by a person, a screen reader, the live backend (no endpoints exist).
- **Follow-ups:**
  - plan the backend endpoints;
  - the demo duplicates the sample agents' version history across both sample hospitals, so the activity timeline repeats entries;
  - consider remembering the chosen period per viewer.

## Operate rebuild (2026-10-23 to 24, approved per phase)

An earlier same-day redesign of these pages was rejected and reverted (Phase 0); this rebuild replaced it. Built by Sonnet subagents from a reviewed plan; every phase checked with tsc, vitest, build and screenshots.
- **Phase 1, foundation** (`components/console/`): no 1360px cap; `SplitView` (resizable, Drawer under 1100px), `Drawer`, `Toolbar`, `DataTable`, `StatusPill`, `KpiCard`/`Sparkline`, `Timeline`, `WaitTimer`, `Skeleton`, `Toast` (Undo), `KeyboardHelp` (`?`), `UpdatedAgo`; sidebar count badges from one 15 s poll (`console/useAttention.tsx`) and the waiting count in the tab title. Dev-only gallery at `/o/:slug/dev/ui`.
- **Phase 2:** Live calls absorbs the Handoff queue (one queue: emergencies, waiting, upset, in progress, recent; summary, details, transcript, take/guide/hand over/callback; opt-in alerts). `/handoffs` redirects to `/live`; the `handoffs` page key is gone. Home is role-aware ("Your shift" for front desk; dashboard grid with every earlier report section, sparklines, funnel, topic gaps, agents table, "What changed").
  - **Backend change (approved):** `GET /api/orgs/{slug}/handoffs` now allows `calls.viewAll` or `calls.take` (take and to-callback still need `calls.take`), so everyone watching Live calls sees who is waiting. `tests/test_permission_matrix.py` updated.
- **Phase 3:** Callbacks (urgency queue + detail, caller history by last five digits, source call, timeline, log with Undo, `N` next, bulk give, edge-case flags) and Appointments (Day by doctor default, Week, List; needs-check panel; problems; drawer with booking call and other appointments; free-slot suggestions; capacity bars; day-sheet CSV).
- **Phase 4:** Bot desk (line board with figures and every-line actions, notices with templates/schedule/preview, 14-day doctor calendar with affected appointments, flag triage with call excerpt, desk activity), FlowCanvas v2 (`components/console/flow/`: shapes, edge labels, minimap, find, fold, path highlight, TB/LR, full screen; Outline/Diagram/Side by side in the Flow tab and builder), Call history (table + preview with `?call=`, client-side language/sentiment/success filters, patterns against the designed flow, edit-as-diagram request) and Call detail (path on the designed flow, step → transcript jump (approximate), transcript search, tools timeline).
- **Demo-only additions:** some sample callbacks and appointments are linked to sample calls on first read (`linkSamples` in `demoClient.ts`); `resolveFlag` accepts `status: 'open'` (reopen/Undo).
- **Not verified:** a real browser by a person, keyboard-only and screen-reader passes, real touch and Fullscreen API, the real backend for callbacks/appointments/calls with this UI.
- **Follow-ups (optional):** callback outcome kinds and rescheduling, appointment arrived/no-show and cancel reason, removing the backend `/handoffs` endpoints, live presence — each needs a backend plan. Desk activity matching relies on the demo's wording (`isDeskEntry` in `operate/desk/logic.ts`). Unused `.tt-*`, `.op-row--appt`, `.detected-flow__*` and `.op-report` rules remain in `Operate.css`. Call history shows several pattern banners stacked above the table.

## UI clean-up (2026-10-23, approved "proceed": every page, Rubik)

- **Built (CSS only, plus the font link and one decorative element):**
  - one family: Rubik (Google Fonts) for text and headings, replacing Archivo, DM Sans and DM Mono; the monospace font is now the system one (`ui-monospace`), and Noto Sans Tamil stays;
  - `styles/tokens.css` (and the same tokens in `landing/index.css`): a 7-step type scale `--fs-xs`…`--fs-3xl`, radii `--r-xs/sm/md/lg`, `--shadow`, `--shadow-lg`, and `--field-h` cut from 52px to 36px (44px on touch screens, where inputs also go back to 16px so iOS doesn't zoom);
  - every raw font size and radius in the app's CSS mapped onto those tokens. There were about 35 sizes and 25 radii;
  - the uppercase, letter-spaced mono labels (kickers, chips, table heads, `dt`s) are now plain small sans text; weights are 600 for headings and numbers and 500 for emphasis; heading letter-spacing is tamer;
  - compact, flat controls: 8px-radius buttons without the sweep or press-scale effects, a segmented filter in one bordered group, smaller switches, checkboxes and tabs, tighter card, row and dialog padding;
  - the console sidebar is 220px with 32px links, so "Billing and plan" no longer gets cut off at 900px tall; the page kicker is visually hidden (the sidebar already names the section), and page titles are 24px;
  - **bug fixed:** the Ops sidebar was dark (`--night`) while reading paper text colours, so the wordmark, active link, user name and Sign out were plum on black and nearly invisible. It now uses the same paper sidebar as the console, keeping the orange hairline;
  - **bug fixed:** the detected-flow chart used fixed light colours (white cards, indigo badges), which looked wrong in dark mode; it now uses theme tokens;
  - phone fixes: numbers in report tables no longer break mid-figure ("11 / 1"), and the period filter scrolls sideways instead of wrapping;
  - sign-in: the blue orb is removed (`AuthLayout.tsx` and its CSS), the stage is plain night, and the headings are smaller;
  - landing: smaller hero and section headlines, no Archivo width animation (the hero now fades up), outlined "ghost" words are now muted text, and the buttons are flat.
- **Verified:** `tsc -b` clean; vitest 328/328; `npm run build` ok. Headless Chrome screenshots of 33 pages in demo mode, before and after, light at 1280px, dark at 1280px and light at 390px, all reviewed.
- **Not verified:** a real browser by a person, Safari/iOS, Windows high-contrast mode. Below-the-fold landing sections are blank in headless screenshots before and after the change (scroll reveal), so they weren't checked visually.
- **Not done:** the 7 inline `style={{…}}` uses were left in place because they all carry runtime values (bar widths, chart tooltip position, CSS variables).

## Backend Phases 4–6 (2026-10-20, approved "proceed, do everything you can")

- **Built:** see `docs/backend-workflow.md`: the Phase 4–6 status notes, "Decisions made while building Phases 4–6" and "Follow-ups from Phases 4–6".
  - Choices: secrets are AES-GCM with `SECRETS_KEY`, and tools send their secret as `Authorization: Bearer` or in a header of their own.
- **Verified (against fakes and a mocked network only):**
  - backend pytest: 601 passed, 3 skipped;
  - frontend: `tsc -b` clean, vitest 328 passed, `npm run build` ok;
  - a uvicorn smoke run over HTTP: report, CSV, secret, a private-address tool test refused, a save conflict, publishing a draft;
  - server logs held no secret values, emails or names;
  - an independent review, whose findings are fixed with tests.
- **Not verified:** real Firestore (transactions, the new index, count queries), signed GCS uploads and their CORS, a real outbound tool call, a browser.
- **Manual steps:**
  1. set `SECRETS_KEY` (Sensitive; keep a copy);
  2. create the bucket with its CORS rule and set `STORAGE_BUCKET`;
  3. create the `rollups` index;
  4. add sections to `VITE_CONSOLE_LIVE` per environment;
  5. write a recording retention policy.

## Backend Phases 2 and 3 (2026-10-19, approved "proceed")

- **Built:** see `docs/backend-workflow.md`: the Phase 2 and 3 status notes, "Decisions made while building Phases 2 and 3" and "Follow-ups from Phases 2 and 3".
  - New backend: `app/routes/org/{requests,calls,callbacks,appointments,handoffs}.py`, `app/redact.py`, `app/scripts/seed_operations.py`, and `GET /api/ops/change-requests`.
  - New frontend: `VITE_CONSOLE_LIVE` sections, the Phase 2/3 HTTP methods, `console/flowRequest.ts`, and the Ops Changes page in one call.
- **Verified (against fakes only):**
  - backend pytest: 317 passed, 3 skipped;
  - frontend: `tsc -b` clean, vitest 314 passed, `npm run build` ok;
  - a uvicorn smoke run on fakes over HTTP;
  - an independent review, whose 6 findings are fixed and covered by tests.
- **Not verified:**
  - real Firestore: composite indexes, the collection-group query, `count()`, `array_contains_any`;
  - Resend;
  - a browser.
- **Manual steps:**
  1. create the indexes and field overrides;
  2. set `CHANGE_REQUESTS_TO` (optional);
  3. on staging, run `seed_operations --org <test-org> --yes` and set `VITE_CONSOLE_LIVE` to include the operations sections.

## Backend Foundations and Phase 1 (2026-10-19, approved "proceed", all defaults chosen by the user's delegation)

- **Built:** see `docs/backend-workflow.md` (items ticked, decisions table, follow-ups). New backend: `app/access.py`, `app/permissions.json`, `app/orgs.py`, `app/logs.py`, `app/routes/org/{team,settings,activity}.py`, `app/scripts/backfill_members.py`; changed `store.py`, `ratelimit.py`, `routes/invites.py`, `accounts.py`, `models.py`, `main.py`, `settings.py`, `sessions.py`, `identity.py`, `firestore.indexes.json`, README. New frontend: `console/httpConsoleClient.ts`, per-section `isLive`, `joinInvite`, invite page path, settings limits aligned.
- **Verified (against fakes only):** backend pytest 198 passed / 3 skipped (after fixing 3 findings from an independent review); frontend `tsc -b` clean, vitest 309 passed, `npm run build` ok; a local uvicorn run on fakes exercised CORS, CSRF, login, invite, accept, activity and settings over real HTTP, and its JSON logs held no emails, names, tokens or passwords.
- **Not verified:** anything against real Firebase/Firestore (transactions, `Increment`, `start_after`, `get_users`, index behaviour), Resend, a browser session, or Vercel's Python version.
- **Manual steps:** create the `activity` indexes; add a TTL policy on `ratelimits.expiresAt`; add `LOG_FORMAT=` to `backend/.env.example` (this session couldn't read `.env*`); optional backfill script; set `VITE_CONSOLE_MODE=live` per environment.
- **Known limitations:** Callbacks/Live-calls pages (demo data) get the real team list in live mode; Ops org writes overwrite the whole org doc; `/ops/audit` can skip same-timestamp entries; demo client doesn't enforce "only grant what you hold".

## Pushed to main; CI's 5 test failures were real, now fixed (2026-10-18)
- **What happened:** the user committed all uncommitted frontend work (2026-10-16 permissions rework + 2026-10-17 report/heatmap work) as one commit, "frontend layout". Asked to push to `main` and open a PR; this environment has no GitHub credentials (no stored HTTPS token, no `gh` CLI, no SSH key for GitHub), so the user ran `git push` themselves after I prepared the branch/merge locally. `main` and `origin/main` had diverged (`origin/main` had PR #23, timetable fullscreen mode, unrelated); merged clean (`origin/main`'s tree was actually already an ancestor of our commit — the merge was a content no-op) and the user pushed `main` directly, skipping a PR per their explicit instruction.
- **CI's frontend job failed** on exactly the 5 pre-existing `vitest` failures this handoff had been tracking since 2026-10-17 (previously undiagnosed, just confirmed as "not caused by that session's work"). Root-caused properly this time:
  - **`reports` is gone from `NAV`, and intentionally so.** `App.tsx`'s `/reports` route is `<Navigate to="../" replace />` — Reports was folded into `ConsoleHomePage.tsx` as an embedded section (part of the 2026-10-16 work, not something I did). `ReportsPage.tsx` the file still exists but is unreferenced. The failing tests (`console-access.test.ts`, `operate-pages.test.tsx`) predate that redesign and still asserted the old standalone-page shape (`navFor` contains `'reports'`, visiting `/o/:slug/reports` shows the full report UI with a "Download as CSV" button, a denial message for front desk). Fixed by updating the tests to the current, intentional design: `reports` still gates the embedded section via `pageAccess`/`can`, just isn't a nav destination; the `Reports` describe block in `operate-pages.test.tsx` now opens Home (not `/reports`) and checks the embedded section, plus a new test confirming the old path redirects there.
  - **A genuine new ambiguity from the merge, not a bug:** "Answered by the agents" now matches two elements on Home (the stat tile label and the day-chart's legend entry), because Reports' trend chart and Reports' stat tiles now share a page. Changed `getByText` to `getAllByText(...).length > 0`.
  - **A real race in the test, not the product:** `ConsoleHomePage`'s "Needs a person" cards (slow, depends on `useLiveData` polling 4 endpoints) and its "Reports" heading (fast, gated by a synchronous permission check, not data) resolve independently. The viewer test awaited only the Reports heading, then did a synchronous `getByRole` for the appointments link — flaky by construction, not a permissions bug (confirmed via a throwaway debug test: the link does appear, just ~tens of ms later). Fixed by awaiting the actually-needed element with `findByRole` instead of an unrelated one with `getByRole`.
- **Verified before pushing the fix:** `tsc -b` clean, `vitest` 269/269 (268 + one new redirect-coverage test), `npm run build` passes — the exact three steps CI's frontend job runs.
- **Files changed:** only `frontend/src/test/console-access.test.ts` and `frontend/src/test/operate-pages.test.tsx`. No app code changed to get tests passing — confirmed by diagnosis above that all three issues were stale/racy tests, not product bugs.
- **Next:** confirm the push landed and CI is green; consider deleting the now-fully-unused `ReportsPage.tsx` and its route in a follow-up, since nothing links to it anymore; also consider whether `feat/home-reports-visualization` (pushed earlier, now superseded by the direct `main` push) should be deleted on GitHub to avoid confusion.

## Report tiles and the weekday/hour heatmap (2026-10-17, now on main)
- **Approved (user, "proceed" ×2):** (1) make the report's stat tiles read as individual cards; (2) widen the chart boxes, and make the heatmap show weekday × hour with stronger colours.
- **Stat tiles:** `.stats`/`.stat` were defined twice — a connected flex bar in `styles/components.css` (the ops console) and individual grid cards in `operate/Operate.css` (the report). The global bar was winning, so the report's tiles ran together. Fixed by scoping the report's rules to `.op-report .stats` / `.op-report .stat` and resetting the container's inherited border/background. The ops console keeps the bar.
- **Heatmap:** was one row of 24 hours from `Report.byHour`. Now a weekday × hour grid from a new `Report.byDayHour` (`number[][]`, 7 rows of 24, row 0 = Monday). `HourHeatmap` takes the matrix plus the period's dates and renders only the weekdays the period covers, so "Today" is one row, not six empty ones. `byHour` stays — ReportsPage's hour ColumnChart still uses it.
- **Colour:** cells were `--plum` mixed toward `--bg-2`, which read as near-invisible on the dark surface. Now a sequential one-hue blue ramp interpolated `in oklab`, with its own dark-mode steps (light `#eef4fd`→`#1c5cab`, dark `#15233a`→`#86b6ef`). The hue matches `--series-1`, so the heatmap and the bars agree.
- **Width:** `.op-split` min column 20rem→28rem (pairs collapse to one full-width column sooner and are wider when split); report card padding 1.5rem→1.25rem horizontally.
- **Verified:** `tsc --noEmit` clean; `npm run build` passes. **Not verified in a browser** — no screenshots taken this session.
- **Pre-existing failures, not from this work:** `vitest` 263/268, the same 5 failing with these edits reverted at HEAD+working-tree. A clean worktree at HEAD passes 22/22 on the two affected files, so the breakage is in the uncommitted 2026-10-16 work: `console-access.test.ts` expects a front-desk member granted reports to get the nav item (`access.ts` is modified), and `operate-pages.test.tsx` looks for a "Today so far" heading that the working tree removed from `ConsoleHomePage.tsx`.
- **Risk:** `byDayHour` is a new **frontend-only** contract. The report has no backend endpoint yet (nothing in `backend/` produces `by_hour`); the demo client is the only producer. Whatever serves reports later must return it, or the heatmap renders empty.
- **Next:** check the heatmap and the tiles in the browser; decide whether ReportsPage should use the same weekday heatmap instead of its hour ColumnChart; then fix or update the 5 failing tests to match the new permissions model and the reworked home page.

### Hover layer and box arrangement on Home (same day)
- **Approved (user, "proceed"):** give every data element an informative hover, improve the visualisation, arrange the boxes properly.
- **Audit found:** `ColumnChart` already had a full hover layer (crosshair + tooltip). `BarList`, `StatTile`, `.op-table` rows had **none**, and the heatmap had only a native `title=` (delayed, unstyled, poor on a 168-cell grid).
- **BarList** (`components/charts/`): rows are hoverable and focusable (`tabIndex=0`), highlight on hover/focus, brighten their bar, and show a tooltip with `value of total · share%`. The share is also in an always-present `sr-only` span, so keyboard/SR users get it without the tooltip.
- **Heatmap:** native `title` replaced with a positioned tooltip (weekday, hour span, calls, share of period), the hovered cell ringed in `--ink`, a "Busiest: …" summary line above the grid, and a peak-per-hour figure in the legend.
- **StatTile / tables:** tiles lift on hover (`--line-strong` border + `--bg-2`); table rows highlight and bolden their row header.
- **Arrangement:** `.op-split` got `align-items: start`, so a short bar list beside a long table no longer stretches into a block of empty space.
- **Verified:** `tsc --noEmit` clean; `vitest` 263/268 — the same 5 pre-existing failures, no new ones. A temporary render test (since removed) confirmed 7 weekday rows Mon–Sun, 168 cells with 78 carrying heat, the summary and legend text, and 12 bar rows all focusable with the share read out.
- **Seen in a browser (2026-10-17, later):** Chromium installed user-local via `npx playwright install chromium` (no root needed — downloads to `~/.cache/ms-playwright`), symlinked to `/usr/bin/chromium-browser` (the user ran the one `sudo ln -sf` line themselves) so the project's Chrome-automation tool can find it. Confirmed working end to end.
- **Bug found by live geometry check, not eyeballing:** the floating tooltips on `BarList` and the heatmap overlapped a *neighbouring* row — not a hover-off-by-a-pixel issue, a real collision. Measured via `getBoundingClientRect()` in-browser: the bar-list tooltip's top (536.5) sat above the previous row's bottom (564.7); the heatmap tooltip (618–676) fully covered the next weekday row (616–642). Any tightly packed list (0.55rem bar-list gap, 4px heatmap row gap) will hit this with a tooltip sized to its content — there's no "above" or "below" placement that avoids colliding with *some* neighbour without JS-measured collision detection.
- **Fix:** replaced the floating tooltip in both with a fixed-height readout line above the rows/grid (`.barlist__readout`, `.heatmap__readout`), the same pattern the heatmap's "Busiest: …" line already used. Reserved height via `min-height` means nothing shifts when it fills in on hover, and because it's one shared line rather than per-row absolute positioning, it can never overlap a sibling row. Re-verified after the fix with the same geometry check: `tipStillExists: false`, readout text updates correctly (`"Working out the reply (language model): 450 of 916 · 49%"`, `"Monday, 9 am–10 am: 3 calls · 1% of the period"`).
- **Also verified live:** stat-tile hover (border + bg-2), `.op-table` row hover (bg-2, confirmed via computed style), `ColumnChart`'s existing crosshair tooltip (unaffected, still works). The "Needs a person" cards' gold vs. tan border is correctly data-driven (`is-urgent` → `--warn-ink`, calm → `--line`) — a 2nd screenshot showed different cards urgent than the 1st because `useLiveData` polls every 15s against real time in a live browser session (not the frozen clock the test suite uses); not a bug.
- **Verified again after the fix:** `tsc --noEmit` clean, `npm run build` passes, `vitest` 263/268 — same 5 pre-existing failures, nothing new.
- **Known gaps:** heatmap cells are not keyboard-focusable — 168 tab stops would be worse than the summary/readout lines + container `aria-label` they get instead; a per-row roving tabindex is the fix if keyboard parity is wanted. The browser-automation tool has a scroll-then-screenshot race in this environment (a JS `scrollIntoView` followed immediately by `screenshot` sometimes captures a stale/blank frame) — worked around with `fullpage` screenshots and `getBoundingClientRect()` checks instead of trusting every viewport screenshot.

## bitNtech builds agents; hospitals configure; front desk runs them (2026-10-16, now on main)
- **Approved (user, "proceed"):** keep the 5 hospital roles, but owners/admins can set **per-person permissions**; master admin creates agents; hospitals change only minimal settings and **request** flow/structural changes from bitNtech; front desk manages the bot; add LiveKit/Pipecat/Vapi/Retell-style features; frontend only, demo data; all 5 phases in one go. No subagents, no commits.
- **Access model** (`console/access.ts`, rewritten): `Permission` (auth/types) with defaults and a "grantable" ceiling per role; `Access = {role, perms, platform}`; pages, tabs and actions are worked out from permissions. `Membership.permissions?` carries a person's changed set (absent = defaults). `useOrg()` now returns `{user, org, access, base}` and reads `OrgScopeContext` when bitNtech works from Ops.
- **Ops:** `/ops/orgs/:slug/agents…` (builder, workspace), `/integrations`, `/uploads`, `/requests` render the console pages inside `OpsOrgShell` (master edits, staff read). `/ops/changes` lists every org's requests. Org detail lists agents live from the console client with "New agent" and open requests. Usage shows reply times per org. `OpsLayout` split into `OpsBar` + layout.
- **Hospital:** Agents has "Ask for a new agent" (drafts show "Being set up by bitNtech"); Requests page `/o/:slug/requests` (new request, thread, withdraw; master replies/changes status); workspace Flow/Tools/Voice pipeline read-only with "Ask for a change"; demo server refuses hospital saves that change flow, attributes, global flows, tools, pipeline or analysis fields. Tools page: tools are bitNtech's, hospital replaces secrets. Team page: Permissions dialog, "Custom permissions" chip.
- **Front desk:** Bot desk `/o/:slug/desk` (send a line to staff for 1h/2h/today/until switched back, which takes its agent off live calls; notices with an end; doctor away/late/moved; flagged answers, resolved by admins). Live calls: guide the agent (whisper), hand to a colleague (warm/straight). Call detail: flag a wrong answer.
- **Voice/AI features:** `PipelineSettings` (models from the platform catalogue via `listModels`, semantic/VAD turn detection, endpointing, interruption thresholds, resume after false interruption, backchannel, preemptive replies, fillers, noise cancellation, ambience, keypad, silence reprompts, temperature) in builder step 2 and a workspace tab; `AnalysisSettings` (summary, sentiment, success criteria, fields) tab; call records gain analysis + metrics + per-turn reply times; Reports gain Quality and By agent; test scenarios (Test tab; run against the saved setup with the text simulator).
- **Demo store** key `aica.demo.console.v9`. Seeds: `demo/agentConfig.ts`, `quality.ts`, `requests.ts`, `desk.ts`, `scenarios.ts`. Suresh B seeded with custom permissions.
- **Verified:** `tsc -b` clean; `vitest` 268/268 (27 files; new `agent-ops.test.tsx`, `agent-ops-logic.test.ts`, rewritten `console-access.test.ts`); `npm run build` passes. Headless Chrome on `dev:demo` at 1440 and 390: Bot desk, live calls, workspace flow (admin), Requests, Permissions dialog, Reports, Ops agents, Ops test tab: no horizontal overflow.
- **Limits:** demo data resets when another person signs in, so a request bitNtech answers isn't seen by a different demo user in the same tab, and Team permission changes don't reach the mock session (the real session must carry effective permissions). Pipeline/analysis/whisper/notice effects on live calls are UI and contract placeholders until the voice servers' API exists; "Listen in" and browser test calls stay "not available". Bundle now 645 KB (175 KB gz): code splitting is more urgent. Workspace has 10 tabs, so the tab row scrolls even on desktop; the Ops bar is crowded at ~1440 with "Change requests" added.
- **Next:** review in the browser, then commit when the user says so; route-level code splitting; backend contracts for permissions, requests and desk.

## Console pages on demo data (started 2026-10-13)
- **Approved plan:** build every console page in the frontend only, on sample data, phase by phase; each phase gets build, checks, screenshots, a review, fixes. From Phase 6: no subagents (the user's credits) and **no commits unless the user says so**. Nothing is pushed and no PR is opened until the user asks. Demo pages show in production, labelled "Demo data" (user chose "proceed b").
- **Assumptions in the plan:** recordings playable by supervisor and above (front desk only for their own calls); Appointments is an AICA page, not a hospital-system booking; one branch per organisation; the flow is an editable outline (no React Flow); the voice test call shows as not available yet; no new dependencies.
- **Where things are:** `frontend/src/console/` (types, access map, demo client and `demo/` seeds); pages in `frontend/src/pages/console/` (`AgentsPage`, `builder/`, `agent/`). Demo data is kept per browser tab in sessionStorage (`aica.demo.console.v8`) and cleared on sign-out.
- **Done (local commits on `feat/console-agents`):**
  - Console frame, Agents list (`8b044ee`, `a2b0ce1`).
  - Builder steps 0–2 (`a052d98`) and 3–7 with review fixes (`2acea1a`): source calls, type, behaviour, conversation-flow outline, details to collect, global flows, knowledge and tools, review with a simulated test chat, publish.
  - Phase 3 (`94d4b42`), agent workspace (`/o/:slug/agents/:agentId/:tab`): Flow, Behaviour and voice, Knowledge, Tools, Handoff and guardrails, Test, Versions, Settings, by role. Edits autosave as unpublished changes; publish with a note, discard, compare versions, roll back, rename, move number, pause, delete.
  - Phase 4, the library pages: Call uploads (upload, search, filter, transcripts, remove), Knowledge (try a question, add a document, table, web page or FAQ, see the sections read, edit, read again, delete; refused while an agent uses it), Tools and integrations (built-in switches, connect an HTTPS system with inputs, test it, write-only secrets), Phone numbers (agent per line, hours, out of hours, handovers; ask for another number).
  - Phase 4 (`0b7c369`).
  - Phase 5, the Operate pages: Home (what needs a person, today so far), Live calls (put through to me; listening not available), Handoff queue (take, or call back later), Callbacks (assign, log tries, three misses move it on), Appointments (confirm, change, cancel), Call history (search, filter, front desk see their own), Call detail (transcript, path, details, tools, notes; viewers don't see personal details), Reports (stat tiles, charts with tables, CSV). The sample call log is generated from the date, so it needs no storage; reports use calendar days in IST.
  - Phase 5 (`fd87bc9`).
  - Phase 6, the Manage pages (**uncommitted**, waiting for the user): Team (invite, send again, change role, remove or cancel; nobody changes or removes themselves; only owners touch owners; an owner always remains; a removed person's callbacks go back to nobody), Organisation activity (the org's audit log by day, filter by area and person, bitNtech sign-ins marked; billing entries for owners only; publish, rollback, pause, delete, knowledge, tools, secrets, team, settings and billing changes are logged), Organisation settings (name, city, languages, weekly business hours, closed days), Billing and plan (owners only: plan, this month's minutes, upgrade now or move down at renewal, invoice details with GST number, invoices; changing the card and invoice PDFs show as not available). New demo account `owner@example.com` (Lakshmi K, owner of Arogya); the mock auth store is `v: 3`.
- **Phase 6 limits:** plan prices and limits are placeholders. A removed member can still sign in to the demo (auth and console demo data are separate stores); the real backend must revoke their membership and sessions. Renaming the organisation shows in the sidebar only after signing in again, because the name comes from the session.
  - Phase 7 (**uncommitted**, waiting for the user):
    - Ops on sample data, labelled "Demo data": Organisation detail `/ops/orgs/:slug` (from the Overview's names: profile, last 30 days, team, agents and versions, processing jobs with retry, status history; suspend, restore and act as owner for the master admin, read-only for staff), Template library `/ops/templates` (add, change, hide or offer; new ones start hidden), Usage `/ops/usage` (7, 30, 90 days, chart and table per organisation), Platform settings `/ops/platform` (master admin only: default models by name, voice catalogue, plan prices and limits), Service status `/ops/status` (speech, voice and language services, queue, recent failures; checks every 15 s).
    - Data: `ops/types.ts` (`OpsDataClient`), `ops/demoOpsClient.ts`, `ops/OpsDataProvider.tsx`. Templates, voices and plans live in `console/demo/platform.ts`, shared with the console demo client, so hiding a template removes it from builder step 1, a switched-off voice leaves the voice list, and plan changes show in Billing.
    - My account `/account` (every signed-in person; linked from their name in the console and Ops): name, password by reset email, browsers signed in (sign out one or all others), emails by role, organisations. The account methods are optional on `AuthClient` and implemented only in the mock; with the real API the page says they aren't available yet. Nothing can be changed while a master admin acts as someone.
    - Fixed on the way: hidden button labels starting with a space ran together ("OfferHealth checks"); those buttons (and "Continue setup", "Log a call") now use `aria-label`. Hidden text in a scrolling table widened the page on phones; the tables are now positioned.
- **Phase 7 limits:** Ops demo data comes from the seeds, not from changes made in a console tab; the status history doesn't show a suspension made in the demo (the audit log does). Model names are placeholders: no service addresses or keys are in the browser. A draft whose template is later hidden must pick its use case again in step 1.
- **Follow-up:** the app bundle is now 544 KB (148 KB gzipped); split it by page (React.lazy routes).
- **Next:** every page in docs/pages-and-access.md now exists. Recommended: route-level code splitting, then the real APIs, page group by page group.
- **For the real backend (privacy):** transcripts must be redacted by the server according to role. In the demo the full transcript reaches the browser and redaction is only how it's shown (the switch is limited to owners and admins). Secret values must never be returned by any endpoint.
- **For the real backend:** flow extraction should be a job (start, poll or stream, cancel) with a draft revision so autosave can't overwrite it; publishing needs an idempotency key; the workspace's working copy needs a revision too, so two editors can't overwrite each other.

## Master admin: admin@bitntech.in (2026-10-12)
- **Done:**
  - The user created admin@bitntech.in (with a password) as bitNtech's organisation-wide master admin.
  - `seed_master` gained `--no-email`, which skips the "set your password" email for existing accounts. New accounts still get it.
  - The per-address logic is now `seed()`, so tests can call it.
  - Ran `seed_master --no-email admin@bitntech.in` against the real Firebase project. Output: `existing · master_admin claim set · no email sent`.
- **Verified:** pytest 65/65, including 4 new tests in `tests/test_seed_master.py`: promote without email and keep the password, email by default, new account always emailed, and the promoted account signs in with `platformRole: master_admin` and reaches `/api/ops/orgs`.
- **Not verified:**
  - Signing in as admin@bitntech.in in a browser. The user must sign out and back in, because the claim is fixed in the session cookie when it's created.
  - Whether support@bitntech.in was ever seeded.
- **Option B:** built. See "Master admin powers (Option B)".

## Master admin powers (Option B, 2026-10-12)
- **Backend** (`routes/ops.py`, master admin only):
  - `GET /api/ops/people`.
  - `POST /api/ops/people/{uid}/role|disable|enable|sign-out|act-as`.
  - `GET /api/ops/audit`: one filter at a time; actor and target take an email; pages by `before`.
  - `POST /api/ops/staff-invites` now takes `role`.
  - `POST /api/auth/act-as/end`.
  - Org summaries now include `ownerId`.
  - New setting `ACT_AS_MINUTES` (default 30).
- **Role changes and disables** revoke the person's sessions, because the role is fixed in the session cookie. Making or inviting a master admin emails every master admin (`Mailer.master_admin_added`).
- **Acting as a client:**
  - The `aica_act_as` HttpOnly cookie holds a random token; `impersonations/{sha256}` holds who, as whom, why and until when.
  - Every request checks the master admin's own session first, then the record, then the target. If any check fails, the request runs as the master admin.
  - While acting: Ops and `/api/auth/business` return 403. New sensitive routes should depend on `sessions.not_acting`.
  - Acting ends on end, on sign-out, on signing in again, or at expiry.
- **Frontend:**
  - `/ops/people` and `/ops/audit`; the People and Audit log tabs show only for master admins.
  - "Act as owner" on the Overview.
  - `ActingAsBanner` across every page while acting.
  - The mock client implements all of it, so `npm run dev:demo` works.
  - Gotcha: React Router applies navigation as a transition. `AuthProvider.actAs` and `endActing` take a `go` callback and swap the session inside the same `startTransition`. Without that, the guard briefly sees the new user on the old page and redirects to /403.
- **Verified:**
  - pytest 90/90 (25 new: people, act-as, audit).
  - Frontend 68/68 (13 new), `tsc` clean, `npm run build` passes.
  - Headless Chrome against a local API on the fakes, at 1440 and 390 wide: People, the role form, Audit, and the acting banner. Ops answered 403 while acting, and ending returned the master admin's session.
- **Not verified:**
  - Against the real Firebase project and Firestore, including the real `list_users` and the audit query with indexes.
  - A real master-admin alert email.
- **The user must:**
  - Create the 3 composite indexes in `backend/firestore.indexes.json` (see `backend/README.md`). Until then, a filtered audit query returns 503 with an explanation.
  - Optionally add `ACT_AS_MINUTES=30` to `backend/.env.example`. Claude can't edit that file.
- **Known limitations:**
  - `GET /people` lists every Firebase user on each load, which is fine for hundreds, not tens of thousands.
  - The audit cursor is a timestamp; entries with exactly the same timestamp could straddle pages.
  - `/o/:slug` is still a placeholder, so acting as a client shows little until the portal exists.
  - Signing out while acting signs the master admin out too.

## Demo requests through the backend (2026-10-12)
- **Backend:** `POST /api/leads/demo` (`app/routes/leads.py`) is public but behind the origin check, with 5 per minute per IP.
  - It validates `DemoRequestIn`, rejects unknown fields, and has a `website` honeypot.
  - It emails the request with `Mailer.demo_request` to `DEMO_REQUEST_TO`.
  - Responses: 204 when sent, 503 when Resend fails. Nothing is stored, and no names or phone numbers reach the logs.
- **Frontend:** the demo form always posts to `${VITE_API_URL}/api/leads/demo`. `VITE_DEMO_ENDPOINT` and the "open WhatsApp when there's no endpoint" path are gone. WhatsApp stays as the fallback in the error message.
- **Verified:**
  - pytest 61/61, including mailer tests against a mocked Resend: HTML escaping, single-line subject, several recipients.
  - Frontend 55/55 tests (5 new form tests), typecheck, build.
  - Headless Chrome against the local API: the form succeeds, and the mailer receives the fields including the UTM tags.
- **Not verified:** a real email through Resend.
- **The user must:**
  - Delete the `VITE_DEMO_ENDPOINT` lines from `frontend/.env.example`, and add `DEMO_REQUEST_TO=` to `backend/.env.example`. Both files are blocked to Claude.
  - Make sure `EMAIL_FROM` is on a verified Resend domain.
- **Known issues:** the in-process rate limit doesn't hold across serverless instances (add a CAPTCHA if spam appears). The thank-you line greets "Dr. Priya" as "Dr.." (existing behaviour).

## Separate frontend and backend hosting (2026-10-12)
- **Decision:** two Vercel projects. The hosts must share a site, e.g. `aica.bitntech.in` and `api.aica.bitntech.in`, so the `SameSite=Lax` cookie keeps working. Unrelated domains (which includes two `*.vercel.app` hosts) were rejected, because they'd need `SameSite=None`, which browsers that block third-party cookies drop.
- **Backend:**
  - New settings: `API_URL` (Google redirect URI; defaults to the deployment URL on Vercel) and `COOKIE_SAMESITE` (`lax`; `none` requires Secure).
  - `ALLOWED_ORIGINS` now defaults to `APP_URL`'s origin and also drives CORS: exact origins, credentials, GET/POST, Accept/Content-Type.
  - `APP_URL` is required on Vercel. The deployment's own hostnames are no longer trusted origins.
- **Frontend:** `VITE_API_URL` (`src/lib/api.ts`). Empty means same origin, as in local dev. Set, calls go cross-origin with `credentials: 'include'`, and the Google button points at the API host. The landing page's session check uses it too. Placeholders are in `frontend/.env.example`.
- **Deploy config:**
  - The root `vercel.json` and `.vercelignore` are replaced by `frontend/` and `backend/` copies.
  - `deploy.yml` deploys one target with `--cwd`. `pipeline.yml` runs both previews in parallel, plus optional fixed preview domains and a PR comment. Production goes backend first, then frontend, each with its own approval.
  - `smoke.sh` takes `frontend|backend`.
  - Repo variables: `VERCEL_FRONTEND_PROJECT_ID`, `VERCEL_BACKEND_PROJECT_ID`, and optionally `PREVIEW_FRONTEND_DOMAIN` and `PREVIEW_API_DOMAIN`. These replace `VERCEL_PROJECT_ID`. See `docs/cicd.md`.
- **Verified:**
  - pytest 45/45. Frontend typecheck, 50/50 tests, build. Both `vercel.json` files pass Vercel's schema, and the workflow YAML parses.
  - Smoke tests pass against a local API (in-memory fakes) on `:8000` and a `vite preview` frontend on `:5173` built with `VITE_API_URL`.
  - Headless Chrome, across the two origins: sign-in lands on `/o/arogya`. The cookie is HttpOnly, Lax, and on the API host only. The landing page shows "Open console", and `/login` redirects to the console.
- **Not verified:** a real Vercel deploy of either project, `vercel alias set` in CI, and the Google flow against real Google. `actionlint` isn't installed.
- **`backend/.env.example`:** Claude can't read it (settings deny). The user should add `API_URL=`, `COOKIE_SAMESITE=lax` and a note that `ALLOWED_ORIGINS` defaults to `APP_URL`.

## Landing page at `/` (2026-10-12)
- **What:** `/` shows the AICA landing page. Its source was copied from the sibling repo `../aica_web` (in `github.com/prem-ramamoorthy/bitntech`). **`frontend/src/landing/` is now the copy to edit.** The original will drift.
- **How:** one Vite build, two pages. `frontend/index.html` is the landing page, prerendered at build time (`scripts/prerender-landing.mjs`) and indexable. `frontend/app.html` is the console shell (`noindex`); every non-file path falls back to it, on Vercel (`frontend/vercel.json`) and in `vite`/`vite preview` (`vite.config.ts`). Each page gets its own CSS bundle and they share the React chunk. Hashed output moved from `/assets` to `/static`; `public/assets/` holds the landing page's media (about 23 MB) at fixed names.
- **Added to the page:** "Sign in" in the nav, plus "Create an account" and "Already with us? Sign in" on the end card. If `GET /api/auth/session` returns 200, these become "Open console" (→ `/login`, which redirects signed-in users home). New analytics event: `console_click`.
- **Demo form:** superseded. It now posts to the backend; see "Demo requests through the backend".
- **Verified:** typecheck, 48/48 tests, build with prerender, `vercel.json` against Vercel's schema; routing in `vite` and `vite preview` (`/` landing, `/login`, `/signup`, `/o/x`, `/ops/requests` console, media and `robots.txt`); screenshots of nav and end card at 1440 and 390 wide. **Not verified:** the signed-in "Open console" state (no backend running) and a real Vercel deploy.

## CI/CD (2026-10-12)
- **Repo:** `git@github.com:bitNtech/aica_software.git`, pushed with the `github-personal` SSH alias. `backend/.env.example` is **not committed** because Claude can't read it to confirm it holds only placeholders. The user should check it, add `FIREBASE_CREDENTIALS_JSON=`, and commit it.
- **Approved and built:** one Vercel project using Vercel Services (beta). `console` is `frontend/` (Vite) and `api` is `backend/` (FastAPI, `app/main.py` auto-detected); `/api/*` goes to the API and everything else to the console. GitHub Actions drives deploys; Vercel Git auto-deploy is off. See `docs/cicd.md` for the full setup.
  - `pipeline.yml`: PR → CI → preview + smoke test + PR comment. `main` → CI → `production` environment approval → prod + smoke test. Fork and Dependabot PRs stop after CI. *(Superseded by the two-project split above.)*
  - `ci.yml` is now reusable (`workflow_call` and manual runs). The gitleaks action was replaced with the gitleaks 8.30.1 CLI, pinned by SHA-256, because the action needs a paid license for org repos.
  - Backend on Vercel: `FIREBASE_CREDENTIALS_JSON`. The deployment's own Vercel hostnames are added to the allowed origins (no wildcard). `APP_URL` defaults to the deployment URL, and `COOKIE_SECURE` to true. Explicit env always wins.
- **Verified locally:**
  - pytest 37/37; frontend typecheck, 48/48 tests and build pass; `npm audit` finds 0.
  - gitleaks finds nothing in git history. The working-tree scan flags only the ignored `backend/.env` and `backend/secrets/`.
  - `vercel.json` validates against Vercel's published schema.
  - `smoke.sh` passes against the real app running on fakes, and fails as it should on an unreachable URL.
- **Not verified:** a real Vercel build or deploy, which needs the user's Vercel project, token and env vars. `actionlint` isn't installed.
- **First GitHub run:** frontend and backend passed. Security failed on the gitleaks license; fixed in the follow-up commit.
- **Open Dependabot PRs:** 11 (actions v7, gitleaks-action v3, which is now unused, react-router 8 major, and Python ranges). Review them; don't bulk-merge. react-router 8 is a major upgrade.

## Production-only CI/CD (2026-10-12)
- **Approved:** previews removed; `main` is the only long-lived branch; PR checks must pass to merge; merging the PR is the approval (0 required reviews); no environment approval after merge.
- **Flow:** PR → CI (frontend, backend, security). The `main` ruleset requires all three to merge. Merge → CI on `main` → backend production + smoke test → frontend production + smoke test. Any failure stops the deploy. See `docs/cicd.md`.
- **Code:**
  - `pipeline.yml`: CI only on PRs.
  - `deploy.yml`: production only (the `environment`/`alias` inputs and the preview-domain step are gone).
  - `smoke.sh`: the leading blank line is gone, so the shebang works.
  - `settings.py`: `VERCEL_ENV` and `VERCEL_BRANCH_URL` handling is gone; the API URL defaults to the production URL.
  - `docs/cicd.md`: rewritten for production only.
- **GitHub settings, done with `gh`:** see the completion report for this change.
- **Vercel, for the user:** delete the Preview environment variables in both projects. The preview Firebase project is no longer used.

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
- Landing page: the media sits in git, about 23 MB. `canonical`, OG URLs and the sitemap point to `https://aica.bitntech.in/`, so update them if the site launches on another host.
- Terms and privacy pages don't exist yet; the sign-up checkbox names them without links.
- **Copy that assumes a policy:** the pages say reset links last an hour and verification links 3 days, which are Firebase's defaults, and invites last 7 days (`INVITE_DAYS`). If anyone changes the expiry in Firebase, change the copy too.

## Next step
- **Now:**
  - Review and commit the Option B changes (not committed yet).
  - Create the Firestore indexes.
  - Sign in as admin@bitntech.in against the real backend and try People, Audit and acting as a client.
- **Then:** asking for the password again before promoting or acting (deferred), or the client portal.
0. Deployment: the user does the one-time setup in `docs/cicd.md`: two Vercel projects (frontend, backend) with custom domains that share a site, env vars per environment, the preview Firebase project, GitHub secrets, variables and environments, and branch protection. Register `<API_URL>/api/auth/google/callback` on the Google client, and add the new keys to `backend/.env.example`. Then open a test PR to see the first preview deploys.
1. The user completes "Needed from the user", then run both servers and do one real end-to-end pass: sign up, verify, approve as master admin, sign in, Google sign-in, reset.
2. Then plan the Ops staff page or the portal shell.

## Branching flows and builder requests (2026-10-25, approved "proceed"; frontend and demo only)
- **Flow model:** a `FlowNode`'s children are what can happen next. One child carries the call on; several make a fork, where each is a branch with a condition, except at most one plain step, last ("Otherwise"). Branches can fork again. `console/flowShape.ts` `normaliseFlow` turns the old shape (siblings in sequence, a branch forking off the step before it) into this one. It's idempotent and keeps ids. It runs in `layoutFlow`, `FlowCanvas`, `flowOutline` and the http client (`seen`/`seenDraft`). The demo store key is bumped to `v10`.
- **Editing** (`builder/flowTree.ts`):
  - `addNode`: a branch joins the fork before the plain step; a step goes in between, keeping what followed.
  - `removeOnly`/`canRemoveOnly`: delete a node alone, its followers moving up.
  - `moveNode`: branches only.
  - `mergeIntents`: the merged intent's plain path becomes a branch.
  - `checkFlow`: flags a fork with two plain steps.
  - `countForks`/`countPaths` live in `console/flowCounts.ts`.
- **Drawing:**
  - `layout.ts` fans the tree out: forks are centred, edges are elbows that turn below the row, and the plain way out is labelled "Otherwise". The `sequence` option is gone.
  - The outline (`FlowEditor`) reads a path top to bottom and indents only at forks ("2 ways on"). Add step / Add branch work on every row. Delete offers "only this, keep what follows".
  - Cancelling a fresh step that was put in between gives its followers back.
- **Everywhere else:**
  - Detected patterns are grafted onto the designed intent as a "New in these calls" branch (`compare.ts` `graftPattern`, `DetectedFlowChart`). The pattern editor starts from a chain.
  - `compareSteps` prefers the matching node below the last match, since labels repeat down branches.
  - The simulator walks the tree, picking the branch whose condition matches the caller.
  - `flowOutline` (`flowRequest.ts`) writes the tree for requests.
  - The demo's known paths end where only branches follow.
- **Demo extraction** (`demo/extraction.ts`):
  - The templates are branching trees: appointments, reports, and a new billing template.
  - `extractFlowGroups` groups calls by topic family: visits = booking + directions; reports; billing; and general for anything else. The group that fits the job is suggested first.
- **Builder for the organisation:** `agentBuilder` page access is now the master admin, or someone with `requests.create` who isn't bitNtech (owner and admin).
  - New `AgentDraft` fields:
    - `requestedBy`, `requestId`, `submittedAt`;
    - `baseAgentId`, `baseVersion` (changes to a published agent);
    - `flowGroups`, `flowGroupId`;
    - `speech`, `guardrails`, `analysis`.
  - New optional client methods `startAgentChange` and `submitDraft`, plus `ChangeRequest.draftId`.
  - The demo enforces:
    - the organisation edits only its own unsent drafts;
    - bitNtech's drafts are hidden from it;
    - a sent draft is locked until it's withdrawn or declined;
    - publishing marks the request done, with a reply.
  - Steps:
    - **Calls:** "Upload calls" and "From your call uploads". Calls are optional for changes.
    - **Behaviour:** adds pronunciations, words to listen for, interruptions and silence (`SpeechEditor`, shared with the Behaviour tab).
    - **Global:** adds handoff and guardrails (`GuardrailsEditor`, shared with the Rules tab).
    - **Flow:** the `FlowGroups` panel. For a new agent, choose a group (it asks first if you edited the flow). For changes, Add or "Use this version" per conversation.
    - **Review:** "After each call" (`AnalysisEditor`, shared with the Analysis tab). Changes to an agent also get "What changes" (`diffSpecs` against the live version).
    - **Finish:** the organisation gets "Send to bitNtech" (title, note, how soon); the master admin gets "Publish agent" or "Publish the changes".
  - A sent draft shows look-only (a disabled fieldset).
- **Agents page:** each agent is a card with an avatar (first letter of the persona, its status as a ring), next to a profile of the chosen one (`?agent=`):
  - who it speaks as and in what voice, its languages and greeting;
  - its version, calls this week and notes;
  - what it handles, and its flow tree, drawn when opened;
  - Open workspace, **Agent builder** (opens a change draft on the calls step) and Call history.

  Everything the old rows showed is kept. `AgentSummary` gains `persona`, `voiceName`, `greeting`, `intents`, `request` and `change`. The demo lab agent now speaks as Arun.
- **Requests:**
  - "New agent" in the request form points to the builder.
  - "Change to a flow" offers the builder for the chosen agent; describing it in words still works.
  - Cards for builder drafts say "Made in the agent builder", link to the draft, and put the full outline under "Everything that was sent".
  - The workspace's read-only Flow, Tools and Pipeline tabs offer "Change it in the agent builder".
- **Tests:** new `agent-requests-logic.test.ts` and `agent-requests.test.tsx`; the flow, layout, canvas, pattern, builder and access tests are updated to the new shape. `test/setup.ts` sets `asyncUtilTimeout` to 3s, because the full parallel run was timing out.
- **Limitations:**
  - No backend. Live mode rejects `startAgentChange`/`submitDraft` with a "needs the AICA server to be updated" message. The backend's draft model (`extra="allow"`) should keep the new fields, but that isn't tested.
  - Grouping is by demo topic labels, standing in for the LLM.
  - ~~A tree can't join back up~~: solved by joins (see "Flowchart and joins").
  - Moving steps along a path isn't supported (delete and add instead).
