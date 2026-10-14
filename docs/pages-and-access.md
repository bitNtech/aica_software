# AICA console: pages and access

The page map and who can use each page. AICA is an **agent builder**: an
organisation uploads its past calls, AICA extracts the conversation flows,
the team refines the agent in a 7-step builder, tests it, and publishes it to
a phone number. The operations pages handle the live calls the agent passes
to staff.

Status: **agreed page list, not yet built**, except where marked *Built*.
*Built (demo)* means the page is built in the frontend on sample data
(`console/demoClient.ts`), labelled "Demo data", with no backend yet.
Hiding a page or button is not access control: the backend must check the
same permissions on every request.

## Roles

| Role | Where | In one line |
|---|---|---|
| **Master admin** | bitNtech, `/ops` | Everything across every organisation, including people, the audit log and acting as a client user |
| **bitNtech staff** | bitNtech, `/ops` | Reviews sign-ups and supports organisations; changes nothing that's master-admin only |
| **Owner** | One organisation, `/o/:slug` | Full control of the organisation, including billing and who can sign in |
| **Admin** | One organisation | Builds and publishes agents, manages the team; no billing |
| **Supervisor** | One organisation | Tests agents and reviews calls, takes over live calls; can't change or publish an agent |
| **Front desk** | One organisation | Handles live calls the agent hands over, and callbacks |
| **Viewer** | One organisation | Reads agents, calls and reports; changes nothing |

bitNtech accounts never belong to an organisation. To see an organisation's
console, a master admin **acts as** one of its users (audited, 30 minutes).

**Key:** **E** edit and act · **R** read only · **O** own items only (calls they handled, callbacks assigned to them) · **–** no access

---

## 1. Public and account pages (everyone)

| Page | Route | Notes |
|---|---|---|
| Landing page | `/` | *Built* |
| Sign in, sign up, verify email, reset password | `/login`, `/signup`, `/verify/:token`, `/reset`, `/reset/:token` | *Built* |
| Accept invitation | `/invite/:token` | *Built* |
| Status pages | `/pending`, `/suspended`, `/signed-out`, `/session-expired`, `/403` | *Built* |
| Choose organisation | `/choose` | *Built*. For people in more than one organisation |
| My account | `/account` | Name, password, devices signed in (sign out others), notification settings. Every signed-in user |

## 2. bitNtech Ops (`/ops`)

| Page | Route | What it's for | Master admin | Staff |
|---|---|---|:-:|:-:|
| Overview | `/ops` | Every organisation; suspend, restore, act as owner | E | R (no suspend, no act as) |
| Sign-up requests | `/ops/requests` | Approve or decline new organisations | E | E |
| People | `/ops/people` | Roles, disable, sign out everywhere, invites, act as a client user | E | – |
| Audit log | `/ops/audit` | Everything that happened, with reasons | R | – |
| Organisation detail | `/ops/orgs/:slug` | Profile, members, status history, agents and their versions, usage, upload jobs | E | R |
| Template library | `/ops/templates` | Starting agents by industry and use case (hospital → appointments, report status, enquiries) used in builder step 1 | E | R |
| Usage | `/ops/usage` | Calls, minutes and processing per organisation, over time | R | R |
| Platform settings | `/ops/platform` | Default models and providers, voice catalogue, limits per plan | E | – |
| Service status | `/ops/status` | Health of the speech, voice and LLM services and the processing queue, recent failures | R | R |

Overview, Sign-up requests, People and Audit log are *Built*.

## 3. Organisation console (`/o/:slug`)

### 3.1 Build

| Page | Route | What it's for | Owner | Admin | Supervisor | Front desk | Viewer |
|---|---|---|:-:|:-:|:-:|:-:|:-:|
| Agents | `/o/:slug/agents` | Every agent: status (draft, live, paused), number, last published. *Built (demo)* | E | E | R | – | R |
| New agent (builder) | `/o/:slug/agents/new` | The 7-step wizard, below. *Built (demo)* | E | E | – | – | – |
| Agent workspace | `/o/:slug/agents/:agentId` | Editing after the first version, in tabs (below). *Built (demo)* | E | E | R + test | – | R |
| Call uploads | `/o/:slug/uploads` | Upload past calls, processing status, transcripts, redaction. *Built (demo)* | E | E | R | – | – |
| Knowledge library | `/o/:slug/knowledge` | Documents, web pages, FAQs and tables (doctor schedules, prices) the agents answer from. *Built (demo)* | E | E | R | – | R |
| Tools and integrations | `/o/:slug/integrations` | Built-in tools and custom HTTP tools; credentials referenced by name, never shown. *Built (demo)* | E | E | R | – | – |
| Phone numbers | `/o/:slug/numbers` | Numbers, which agent answers, working hours, transfer destinations. *Built (demo)* | E | E | R | – | – |

#### Builder steps (`/o/:slug/agents/new`)

| Step | What it covers |
|---|---|
| 0. Source calls | Pick or upload past calls, confirm consent, wait for processing, check transcripts and speakers |
| 1. Type and sub-type | Industry and use case; picks a starting template |
| 2. Bot behaviour | Persona, tone, languages and switching between Tamil, English and Tanglish, greeting, closing, voice, rules it must follow |
| 3. Conversation flow | The extracted tree of intents, steps and branches, each with its confidence and the calls it came from; edit, merge, reorder |
| 4. Attributes | Details to collect (name, phone, patient ID, date, doctor): type, validation, required, how to confirm, personal data or not |
| 5. Global flows | Behaviour anywhere in a call: hand to a person, emergency script, repeat, out of scope, silence, end call |
| 6. Additional context | **Knowledge** (which sources, retrieval settings, answer only from knowledge) and **Tools** (which tools, confirm before acting) |
| 7. Review and confirm | Summary, warnings (unreachable branches, missing attributes, unused tools), a test, then save as draft or publish |

#### Agent workspace tabs (`/o/:slug/agents/:agentId/...`)

| Tab | Route | Owner | Admin | Supervisor | Viewer |
|---|---|:-:|:-:|:-:|:-:|
| Flow (steps 3 to 5) | `/flow` | E | E | R | R |
| Behaviour and voice (step 2, pronunciations, speech hints, interruption, silence) | `/behaviour` | E | E | R | R |
| Knowledge | `/knowledge` | E | E | R | R |
| Tools | `/tools` | E | E | R | – |
| Handoff and guardrails (when to hand over, where, topics to refuse, recording notice, maximum call length) | `/rules` | E | E | R | R |
| Test (test call in the browser, text simulator showing the node, tool calls and sources) | `/test` | E | E | E | – |
| Versions (drafts, diff, publish, roll back) | `/versions` | E | E | R | R |
| Agent settings (rename, pause, delete) | `/settings` | E | E | – | – |

### 3.2 Operate

| Page | Route | What it's for | Owner | Admin | Supervisor | Front desk | Viewer |
|---|---|---|:-:|:-:|:-:|:-:|:-:|
| Home | `/o/:slug` | Today at a glance; front desk sees the handoff queue first. *Built (demo)* | R | R | R | R | R |
| Live calls | `/o/:slug/live` | Calls in progress, live transcript, intent; listen or take over. *Built (demo)* | E | E | E | E | – |
| Handoff queue | `/o/:slug/handoffs` | Calls the agent passed to a person, waiting now, with the agent's summary. *Built (demo)* | E | E | E | E | – |
| Callbacks | `/o/:slug/callbacks` | Missed calls and callback requests: assign, mark done or not reachable. *Built (demo)* | E | E | E | O | – |
| Appointments | `/o/:slug/appointments` | Bookings and reschedules made on calls, to confirm or correct. *Built (demo)* | E | E | E | E | R |
| Call history | `/o/:slug/calls` | Search and filter every call. *Built (demo)* | R | R | R | O | R |
| Call detail | `/o/:slug/calls/:callId` | Transcript, path through the flow, tool calls, attributes collected, outcome, notes. *Built (demo)* | R + notes | R + notes | R + notes | O + notes | R |
| Reports | `/o/:slug/reports` | Volume, share handled by the agent, handoffs, peak hours, languages, top intents, drop-off by node; CSV export. *Built (demo)* | R + export | R + export | R + export | – | R |

### 3.3 Manage

| Page | Route | What it's for | Owner | Admin | Supervisor | Front desk | Viewer |
|---|---|---|:-:|:-:|:-:|:-:|:-:|
| Team | `/o/:slug/team` | Invite, change roles, remove; nobody changes their own role | E | E (not owners) | – | – | – |
| Organisation activity | `/o/:slug/activity` | This organisation's audit log | R | R | – | – | – |
| Organisation settings | `/o/:slug/settings` | Name, city, languages, business hours | E | E | – | – | – |
| Billing and plan | `/o/:slug/billing` | Plan, usage, invoices, payment method | E | – | – | – | – |

## 4. Actions that need a specific role

| Action | Who |
|---|---|
| Publish, roll back or pause an agent | Owner, Admin |
| Delete an agent, a knowledge source or an upload | Owner, Admin |
| Add or change tool credentials | Owner, Admin |
| Take over a live call | Owner, Admin, Supervisor, Front desk |
| Play call recordings | Owner, Admin, Supervisor; Front desk for calls they handled. *Assumed: confirm* |
| Export calls or reports | Owner, Admin, Supervisor |
| Invite an admin | Owner, Admin |
| Invite or remove an owner, transfer ownership | Owner |
| Billing | Owner |
| Suspend or restore an organisation | Master admin |
| Act as a client user | Master admin |

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
4. **Contracts from the voice pipeline:** the extracted flow tree's schema, the upload and processing API, the published agent format, where tools run and knowledge is indexed, and the LiveKit token endpoint.
