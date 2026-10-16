# AICA console: pages and access

The page map and who can use each page. AICA agents are **built by
bitNtech**: the master admin creates each agent for a hospital from Ops
(builder, flow, tools, voice pipeline, call-analysis fields). The hospital's
admins keep the everyday settings up to date (greeting, voice, knowledge,
handover rules, hours, success criteria), publish them, watch analytics and
manage their team; for anything structural they **send a request** to
bitNtech. The front desk runs the agents day to day from the **Bot desk** and
handles the calls agents pass to people.

Status: **agreed page list, not yet built**, except where marked *Built*.
*Built (demo)* means the page is built in the frontend on sample data
(`console/demoClient.ts`), labelled "Demo data", with no backend yet.
Hiding a page or button is not access control: the backend must check the
same permissions on every request.

## Roles

| Role | Where | In one line |
|---|---|---|
| **Master admin** | bitNtech, `/ops` | Everything across every organisation; the only one who creates agents and changes their structure (`/ops/orgs/:slug/agents…`) |
| **bitNtech staff** | bitNtech, `/ops` | Reviews sign-ups and supports organisations; reads agents, changes nothing |
| **Owner** | One organisation, `/o/:slug` | Admin, plus billing and other owners |
| **Admin** | One organisation | Changes everyday agent settings and publishes them, asks bitNtech for changes, manages the team and its permissions |
| **Supervisor** | One organisation | Tests agents, reviews calls and reports, takes over live calls |
| **Front desk** | One organisation | Runs the Bot desk, takes handed-over calls, callbacks and appointments |
| **Viewer** | One organisation | Reads agents, calls and reports; changes nothing |

bitNtech accounts never belong to an organisation. They work on an
organisation's agents from Ops (logged as bitNtech in its activity), or a
master admin **acts as** one of its users (audited, 30 minutes).

### Permissions per person

Each role is a **default set of permissions** (`console/access.ts`,
`PERMISSIONS`). An owner or admin can change one person's set on the Team page
(Permissions), within what the role may hold: viewers only ever look; the team,
settings and secrets stay with owners and admins; billing is owners only and
not a permission. Nobody changes their own; only owners change an owner's. A
new role resets to its defaults. Page access below is worked out from
permissions, so the tables show each role **with its defaults**.

| Group | Permissions |
|---|---|
| Agents and setup | See agents · Change everyday settings · Publish and pause · Test · Ask bitNtech for changes · Manage knowledge · Upload past calls · Change phone lines · Replace system secrets |
| Front desk | Switch lines to staff · Post notices · Take calls · Assign callbacks · Manage appointments |
| Calls and reports | See every call · See callers' details · Play recordings · See reports · Export |
| Organisation | Manage the team · Organisation settings · See activity |

## 1. Public and account pages (everyone)

| Page | Route | Notes |
|---|---|---|
| Landing page | `/` | *Built* |
| Sign in, sign up, verify email, reset password | `/login`, `/signup`, `/verify/:token`, `/reset`, `/reset/:token` | *Built* |
| Accept invitation | `/invite/:token` | *Built* |
| Status pages | `/pending`, `/suspended`, `/signed-out`, `/session-expired`, `/403` | *Built* |
| Choose organisation | `/choose` | *Built*. For people in more than one organisation |
| My account | `/account` | Name, password, devices signed in (sign out others), notification settings. Every signed-in user. *Built (demo)*: password is a reset email (real API); the rest needs the account API |

## 2. bitNtech Ops (`/ops`)

| Page | Route | What it's for | Master admin | Staff |
|---|---|---|:-:|:-:|
| Overview | `/ops` | Every organisation; suspend, restore, act as owner | E | R (no suspend, no act as) |
| Sign-up requests | `/ops/requests` | Approve or decline new organisations | E | E |
| People | `/ops/people` | Roles, disable, sign out everywhere, invites, act as a client user | E | – |
| Audit log | `/ops/audit` | Everything that happened, with reasons | R | – |
| Change requests | `/ops/changes` | Every organisation's open requests, most urgent first | E | R |
| Organisation agents | `/ops/orgs/:slug/agents`, `/new`, `/drafts/:id/:step`, `/:agentId/:tab` | Build agents (the builder) and change any part of them; also Tools and integrations, Call uploads and Requests for that organisation. *Built (demo)* | E | R |
| Organisation detail | `/ops/orgs/:slug` | Profile, members, status history, agents and their versions, usage, upload jobs | E | R |
| Template library | `/ops/templates` | Starting agents by industry and use case (hospital → appointments, report status, enquiries) used in builder step 1 | E | R |
| Usage | `/ops/usage` | Calls, minutes and processing per organisation, over time | R | R |
| Platform settings | `/ops/platform` | Default models and providers, voice catalogue, limits per plan | E | – |
| Service status | `/ops/status` | Health of the speech, voice and LLM services and the processing queue, recent failures | R | R |

Overview, Sign-up requests, People and Audit log are *Built*. Organisation detail, Template library, Usage, Platform settings and Service status are *Built (demo)*.

## 3. Organisation console (`/o/:slug`)

### 3.1 Agent setup

| Page | Route | What it's for | Owner | Admin | Supervisor | Front desk | Viewer |
|---|---|---|:-:|:-:|:-:|:-:|:-:|
| Agents | `/o/:slug/agents` | Every agent; drafts show as "being set up by bitNtech"; "Ask for a new agent". *Built (demo)* | E | E | R | – | R |
| Requests to bitNtech | `/o/:slug/requests` | New agents, flow changes, integrations, numbers; a thread with bitNtech; withdraw. *Built (demo)* | E | E | R | – | R |
| Agent workspace | `/o/:slug/agents/:agentId` | Everyday settings in tabs (below); structural tabs read-only with "Ask for a change". *Built (demo)* | E | E | R + test | – | R |
| Call uploads | `/o/:slug/uploads` | Upload past calls for bitNtech to build from. *Built (demo)* | E | E | R | – | – |
| Knowledge library | `/o/:slug/knowledge` | Documents, web pages, FAQs and tables the agents answer from. *Built (demo)* | E | E | R | – | R |
| Tools and integrations | `/o/:slug/integrations` | Set up by bitNtech; the hospital reads them and replaces its own secrets. *Built (demo)* | E (secrets) | E (secrets) | R | – | – |
| Phone numbers | `/o/:slug/numbers` | Which agent answers, hours, after hours; ask for a number (a request). *Built (demo)* | E | E | R | – | – |

The builder at `/o/:slug/agents/new` and drafts only explain that bitNtech builds agents.

#### Builder steps (`/ops/orgs/:slug/agents/new`, master admin)

| Step | What it covers |
|---|---|
| 0. Source calls | Pick or upload past calls, confirm consent, wait for processing, check transcripts and speakers |
| 1. Type and sub-type | Industry and use case; picks a starting template |
| 2. Bot behaviour | Persona, tone, languages and switching between Tamil, English and Tanglish, greeting, closing, voice, rules it must follow; **voice pipeline** (models, turn-taking, interruptions, noise, keypad, fillers) |
| 3. Conversation flow | The extracted tree of intents, steps and branches, each with its confidence and the calls it came from; edit, merge, reorder |
| 4. Attributes | Details to collect (name, phone, patient ID, date, doctor): type, validation, required, how to confirm, personal data or not |
| 5. Global flows | Behaviour anywhere in a call: hand to a person, emergency script, repeat, out of scope, silence, end call |
| 6. Additional context | **Knowledge** (which sources, retrieval settings, answer only from knowledge) and **Tools** (which tools, confirm before acting) |
| 7. Review and confirm | Summary, warnings (unreachable branches, missing attributes, unused tools), a test, then save as draft or publish |

#### Agent workspace tabs (`/o/:slug/agents/:agentId/...`)

Master admin (from Ops): every tab editable, plus delete. Staff: read, and test.

| Tab | Route | Owner | Admin | Supervisor | Viewer |
|---|---|:-:|:-:|:-:|:-:|
| Flow (steps 3 to 5): bitNtech's | `/flow` | R + ask | R + ask | R | R |
| Behaviour and voice (step 2, pronunciations, speech hints, interruption on/off, silence) | `/behaviour` | E | E | R | R |
| Voice pipeline (models, turn detection, endpointing, interruption thresholds, backchannel, fillers, noise, ambience, keypad, temperature): bitNtech's | `/pipeline` | R | R | R | – |
| Knowledge | `/knowledge` | E | E | R | R |
| Tools: bitNtech's | `/tools` | R + ask | R + ask | R | – |
| Handoff and guardrails | `/rules` | E | E | R | R |
| After each call (success criteria, summary, sentiment; fields are bitNtech's) | `/analysis` | E | E | R | R |
| Test (test scenarios, text simulator; test call not available yet) | `/test` | E | E | E | – |
| Versions (diff, publish, roll back) | `/versions` | E | E | R | R |
| Agent settings (rename, number, pause; delete is bitNtech's) | `/settings` | E | E | – | – |

### 3.2 Operate

| Page | Route | What it's for | Owner | Admin | Supervisor | Front desk | Viewer |
|---|---|---|:-:|:-:|:-:|:-:|:-:|
| Home | `/o/:slug` | Today at a glance; front desk sees the handoff queue first. *Built (demo)* | R | R | R | R | R |
| Bot desk | `/o/:slug/desk` | Each line's agent; send a line to staff for a while and back; today's notices; doctor away/late/moved; flagged answers (admins mark fixed). *Built (demo)* | E | E | E | E | – |
| Live calls | `/o/:slug/live` | Calls in progress, live transcript, intent; guide the agent (a note only it hears), hand to a colleague (warm or straight through), take over; listening not available yet. *Built (demo)* | E | E | E | E | – |
| Handoff queue | `/o/:slug/handoffs` | Calls the agent passed to a person, waiting now, with the agent's summary. *Built (demo)* | E | E | E | E | – |
| Callbacks | `/o/:slug/callbacks` | Missed calls and callback requests: assign, mark done or not reachable. *Built (demo)* | E | E | E | O | – |
| Appointments | `/o/:slug/appointments` | Bookings and reschedules made on calls, to confirm or correct. *Built (demo)* | E | E | E | E | R |
| Call history | `/o/:slug/calls` | Search and filter every call. *Built (demo)* | R | R | R | O | R |
| Call detail | `/o/:slug/calls/:callId` | Transcript with reply times, path, tool calls, details, outcome; after-call analysis (success, sentiment, fields); response times; notes; flag a wrong answer. *Built (demo)* | R + notes | R + notes | R + notes | O + notes | R |
| Reports | `/o/:slug/reports` | Volume, share handled by the agent, handoffs, quality (success, sentiment, reply times and where the wait goes, interruptions), by agent, peak hours, languages, top intents, drop-off; CSV export. *Built (demo)* | R + export | R + export | R + export | – | R |

### 3.3 Manage

| Page | Route | What it's for | Owner | Admin | Supervisor | Front desk | Viewer |
|---|---|---|:-:|:-:|:-:|:-:|:-:|
| Team | `/o/:slug/team` | Invite, change roles and per-person permissions, remove; nobody changes their own. *Built (demo)* | E | E (not owners) | – | – | – |
| Organisation activity | `/o/:slug/activity` | This organisation's audit log. *Built (demo)* | R | R | – | – | – |
| Organisation settings | `/o/:slug/settings` | Name, city, languages, business hours. *Built (demo)* | E | E | – | – | – |
| Billing and plan | `/o/:slug/billing` | Plan, usage, invoices, payment method. *Built (demo)* | E | – | – | – | – |

## 4. Actions that need a specific role (defaults)

| Action | Who |
|---|---|
| Create, delete or restructure an agent (flow, details collected, tools, voice pipeline, analysis fields) | Master admin |
| Ask bitNtech for a change | Owner, Admin |
| Change everyday settings; publish, roll back or pause | Owner, Admin |
| Delete a knowledge source or an upload | Owner, Admin |
| Replace system secrets | Owner, Admin |
| Switch a line to staff, post notices, doctor changes | Owner, Admin, Supervisor, Front desk |
| Take over, guide or hand on a live call | Owner, Admin, Supervisor, Front desk |
| Resolve a flagged answer | Owner, Admin |
| Play call recordings | Owner, Admin, Supervisor; others for calls they handled |
| Export calls or reports | Owner, Admin, Supervisor |
| Invite people, change roles and permissions | Owner, Admin |
| Invite or remove an owner, change an owner's permissions | Owner |
| Billing | Owner |
| Suspend or restore an organisation; act as a client user | Master admin |

## 5. Shared behaviour on every page

- A sidebar showing only the pages the role can open, and an organisation switcher for people in more than one.
- The orange "Acting as" banner on every page while a master admin acts as someone (*Built*).
- Loading, empty, error, offline and success states; full keyboard use; reduced motion respected.
- Front desk pages work on a tablet at the counter: large targets, keyboard shortcuts to take over, a sound when a call is handed over.
- Anything shown before the real APIs exist runs on clearly labelled demo data.

## 6. Open decisions

1. **Call recordings:** who may play them back (assumed in section 4).
2. **Appointments:** booked into an existing hospital system, or kept in AICA? This decides whether Appointments is a page or a section of call detail.
3. **Branches:** whether an organisation can have several branches with separate queues, numbers and reports.
4. **Contracts from the voice pipeline:** also how notices, doctor changes and whispers reach a live agent, live monitoring (LiveKit room join for listening), per-turn timings, post-call analysis output, and how pipeline settings map onto the servers.
5. **Per-person permissions in the session:** the backend must send each membership's effective permissions and enforce them on every request, including the structural lock on agent saves.
6. **Earlier:** the extracted flow tree's schema, the upload and processing API, the published agent format, where tools run and knowledge is indexed, and the LiveKit token endpoint.
