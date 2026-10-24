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
| Home | `/o/:slug` | Depends on what the person does. People who take calls get *Your shift*: callers waiting for a person (emergencies first, then longest wait), their next callbacks (theirs or not yet given to anyone, overdue first), today's appointments to check, and today's notices and doctor changes (if they can open the Bot desk), each linking to the page that acts. People who see reports get the dashboard: headline figures with trends, quality, how calls ended, calls each day, what callers want against the average, agents, when people call, where calls left the agent, languages, and *What changed* (computed findings, each linking to its evidence); someone with both gets a one-line shift above it. Everyone else who can see any of it gets the *Needs a person* cards; the full shift leaves them out, since it already says the same. *Built (demo)* | R | R | R | R | R |
| Bot desk | `/o/:slug/desk` | One working screen. **Lines** across the top: each line's agent, who is answering (with a countdown when it is your team), calls now, and, with *See reports*, today's calls and the share handed over; send a line, or every line, to staff (for an hour, a time today, the day or until switched back, with a reason) and back, with partial failures named and Undo (*Switch lines to staff*). **Flagged answers** to triage: Open, Fixed and Dismissed with counts, search and agent filter, who flagged it and when, the part of the call it came from (with a link to the call, for those who can open calls), mark fixed with what changed, dismiss, reopen, each with Undo; *Add to FAQ* (copies the question and answer, opens Knowledge: needs *Manage knowledge*) and *Ask bitNtech* (opens a request for that agent: needs *Ask bitNtech for changes*). **Notices** showing now and scheduled, from ready-made templates or your own words, with a start and end, one agent or every agent, a preview of how callers hear it, a warning when much the same notice is already showing, change or end early with Undo (*Post notices*). **Doctor changes**: a fortnight of doctors by day (away, late or moved, each an icon and a word, arrow keys between cells, Enter adds or changes a day) with the booked appointments each change affects and a link to Appointments, which does not open on that day (needs *Manage appointments* or *See every call*). **Desk activity**: the desk's own entries from the activity log, with a link to all activity (needs *See activity*). Each part is left out, without an error, when the person can't read what it needs. *Built (demo)* | E | E | E | E | – |
| Live calls | `/o/:slug/live` | One queue of everything on the phones, with the open call beside it (a drawer on a phone). Order: emergencies; callers waiting for a person, longest first (this is what used to be the Handoff queue, with the agent's summary, why they want a person and the details collected); calls that sound upset; other calls in progress; then, folded away, what was taken, missed or ended in the last 15 minutes. Each call has its live transcript, notes to the agent and, for people who take calls, take the call, guide the agent (a note only it hears), hand to a colleague (warm or straight through) and turn a caller who hung up into a callback; listening isn't available yet. Search, filter by agent or line, needs-a-person-only; opt-in sound and desktop alerts per person. Names and collected details need *See callers' details*. *Built (demo)* | E | E | E | E | R |
| Callbacks | `/o/:slug/callbacks` | Missed calls and callback requests, as one queue with the open callback beside it (a drawer on a phone). Grouped by urgency: overdue, due within the hour, later today, another day; then, folded away, done or couldn't reach. Each row has the caller (or *Caller not named*), the full number, the reason, how late or soon, who has it, tries so far, and a marker when the same number has other open callbacks. Search by name, number or reason; filter by who has it, tries and status; sort by urgency or by when it was asked. The detail has the number as a phone link, the caller's other callbacks and past calls (matched on the last five digits, the part call history shows), the call it came from with the start of the conversation, and what has happened. *Log the call* (reached them, which closes it, or no answer, which counts a try; three tries move it to *Couldn't reach*), with an optional note and Undo where it can be undone; *Next callback* (N) opens the next open one that is yours or nobody's. It warns about a removed assignee, a caller who may have rung back, the last try, and a due time outside opening hours (for those who can read the hours). Owner, admin and supervisor (*Assign callbacks*) see every callback, give them to anyone and tick several to give at once; front desk see their own and ones nobody has, and take, ring and give back those. *Built (demo, and the live API)* | E | E | E | O | – |
| Appointments | `/o/:slug/appointments` | Bookings made on calls, to confirm or correct. Three views of the same days with one set of filters (doctor, department, status, who booked, search, only with a problem): **Day by doctor** (the default: a column for each doctor, rows by time through the organisation's opening hours, a line for now on today, a doctor who is away or late shaded and labelled from the Bot desk, closed days shaded with the reason, overlapping bookings side by side and flagged; a list for each doctor on a phone), **Week** (Monday to Sunday, counts for each day, doctor initials) and **List** (a sortable table). A summary of booked against capacity for each doctor, and a *Needs a check* panel in every view (the agent's flags, and problems: double booking, outside hours, closed day, doctor away or late, past and never confirmed, the same patient twice in a day, a doctor missing from the knowledge library). A booking opens in a drawer with its call, the patient's other appointments and, with *Manage appointments*, Confirm, Change (free times suggested, clashes warned about), Cancel (asks first) and Call, each with Undo where the API allows. Phone numbers need *Manage appointments*, names *See callers' details*; the day sheet CSV needs *Export*. Opening hours need *Organisation settings* and doctor changes the Bot desk: without them the page assumes 8 am to 8 pm and skips those checks. *Built (demo)* | E | E | E | E | R |
| Call history | `/o/:slug/calls` | Every call as a sortable table (when, caller, agent, what they wanted, outcome, length, language, how the caller sounded, success, who took it; arrow keys or J and K to move, Enter to open) with the open call previewed beside it (a drawer on a phone): summary, how it ended, details collected, the path, the start of the conversation, the notes count and a link to the whole call. The filters and the open call are in the address (`?days=&q=&outcome=&agent=&lang=&sentiment=&success=&call=`), so Home links, Back and shared links land where they should. Period, agent, outcome and search go to the server; language, sentiment and success are applied to the calls loaded and say so (sentiment and success are only known for calls opened in the view). Summary line (calls, share answered by the agents, share handed over), filter chips and Clear all, *Show more*, *Refresh*, and the call list as CSV with *Export*. **Detected flow patterns** sit above the table: each opens drawn against the agent's designed flow (which steps are in it, which are new), with the calls behind it and what the caller said; ask bitNtech to build it as detected, or *Edit as a diagram* first (add, rename, remove and reorder steps, add a branch, add a note) and send the hospital's version. Callers' names and personal details need *See callers' details*. Front desk see only the calls they handled and no patterns. Shortcuts: / search, J and K, Enter, O (whole call), Esc (close). *Built (demo, and the live API for the call list)* | R | R | R | O | R |
| Call detail | `/o/:slug/calls/:callId` | The conversation as the main column, with a search (matches highlighted, count, next and previous; hidden personal details can't be found), beside the call's path drawn on the agent's designed flow (the steps it took numbered, where it left flagged: handed over or hung up); picking a step jumps to about where it happened in the conversation (steps are placed along the conversation by order, so it is approximate). Without permission to see the agent, or without a published flow, the call's own steps are listed instead. Also: summary, after-call analysis (success, sentiment, fields), details collected, tools used on a timeline, response times, knowledge used, recording (those who may), notes and flag a wrong answer. One column on a phone. Shortcuts: / search, F the path diagram. *Built (demo, and the live API for the call)* | R + notes | R + notes | R + notes | O + notes | R |
| Reports | `/o/:slug/reports` | Volume, share handled by the agent, handoffs, quality (success, sentiment, reply times and where the wait goes, interruptions), by agent, peak hours, languages, top intents, drop-off; CSV export. *Built (demo)* | R + export | R + export | R + export | – | R |

> **The Handoff queue is part of Live calls.** `/o/:slug/handoffs` redirects to `/o/:slug/live`, and there is no separate sidebar entry. Anyone who may see calls (*Take calls* or *See every call*) can open Live calls and watch; the take, guide, hand-over and callback buttons need *Take calls* and are not shown to anyone else. The backend's `GET /api/orgs/{slug}/handoffs` needs *See every call* or *Take calls*, so everyone watching sees who has asked for a person; taking one or making it a callback still needs *Take calls*.

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
