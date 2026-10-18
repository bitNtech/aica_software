# Project Handoff

## Status
- Latest (2026-10-18, uncommitted, branch `feat/premium-redesign`): warm charcoal/champagne/orange identity replacing the blue palette (see that entry). Earlier, committed: mobile/tablet pass on top of the homepage rebuild; homepage rebuilt as AICA's own spatial product page, plus a page-by-page console pass, on top of the seven-blue glass system. See the homepage entry. Not committed or pushed.
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

## Warm identity: charcoal, champagne, burnt orange (2026-10-18, branch `feat/premium-redesign`, uncommitted)
Approved 2026-10-18: replace the all-blue look with charcoal #17191F / #22242C, champagne #F2E8D8, warm white #FAF8F4, burnt orange #E58A4E (actions only), lavender #A99BCB (depth, AICA's voice), sage #78958A (positive/live), secondary text #B8B6B1. Console: warm-white light theme + charcoal dark (device setting). Homepage: dark and warm-white sections alternate. Orb image warm-graded with a CSS filter (file untouched).
- **Contrast (checked):** champagne/charcoal 14.5:1, #B8B6B1/charcoal 8.7:1, orange/charcoal and charcoal-on-orange 6.8:1, lavender 6.9:1, sage 5.3:1. On warm white accents darken: orange text #A64F1C 5.2:1, lavender #6B5C93 5.5:1, sage #3F5E52 6.8:1. Buttons always use the bright #E58A4E fill (charcoal text) — never the darkened text orange.
- **Tokens:** `styles/tokens.css` and `landing/index.css` rewritten. Old names kept and remapped (`--sky` = accent orange, `--ice` = champagne, `--navy` = charcoal, `--aqua` = lavender, `--teal` = sage). New: `--charcoal`, `--champagne`, `--warm-white`, `--burnt`, `--lavender`, `--sage`, `--stone`, `--grain` (inline SVG noise). Content cards are solid charcoal (`--card`); glass only for floating layers.
- **Homepage:** story order now hero → problem → film → what it does → languages → use cases → how it works → demo → end (App.tsx, nav links follow). `.paper` = warm-white editorial section with re-tokened colours (film, languages, steps). Hero headline "Every call answered, in [தமிழ்/English/Tanglish]" with the rotating word; facts strip; key/fill lighting. Heading highlights champagne→lavender (lavender on paper); orange reserved for CTAs, the hero word, timers.
- **Console:** every hard-coded blue remapped; charts sage/lavender/orange (distinct hues); heatmap orange; light-mode selected tab is a charcoal pill; `theme-color` #17191F.
- **Verified:** `tsc -b`, `npm run build` (incl. prerender), `vitest run` 269/269. Screenshots: homepage sections 1440 + 390, console home/agents/workspace/team/calls dark + light, sign-in, ops.
- **Not verified:** real devices/Safari, live backend.

## Mobile and tablet pass (2026-10-18, branch `feat/premium-redesign`, uncommitted)
- **Root cause of the "misaligned" phone view:** the landing page was 435px wide on a 390px phone (decorative glows past the edge). `overflow-x: hidden` on body doesn't stop phones widening the layout viewport, so the fixed nav stretched off-screen. Now `overflow-x: clip` on html and body (`landing/index.css`). Scan at 360/390/768: no element wider than the screen except clipped decoration.
- Landing: nav actions pinned right when the chapter links are hidden; footer brand row + two link columns side by side; showcase tightened on phones (smaller orb and wave, fixed talk height so it doesn't jump), floating layout kept on tablets (640–1039px, 620px wide, no tilt), stacked below 640px; capabilities column can't grow past the screen (`minmax(0, 1fr)`, `min-width: 0`); end card clips its rings.
- Console/ops on phones: tab bars, the ops nav and the ops organisation sub-nav are single rows that scroll sideways with an edge fade instead of wrapping into 3–4 rows; the shared `Tabs` now scrolls the selected tab into view (workspace tabs already did); ops bar is one compact floating row; Account bar is one compact row with the back link truncating.
- **Verified:** `tsc -b`, `npm run build`, `vitest run` 269/269 (quiet machine; with the dev server running alongside, 19 timing-sensitive tests time out and all pass when rerun). Screenshots: every homepage section at 360/390/768, console and ops routes at 390.

## Homepage rebuilt + console page pass (2026-10-18, branch `feat/premium-redesign`, uncommitted)
Approved 2026-10-18. Goal: AICA gets its own identity rather than bitntech.in's; every route consistent.
- **Removed bitntech.in patterns** from the landing page: corner small print, Archivo stretch-in headline, segmented progress strip + ground-sensing nav, mono "0N / Section" kickers, outlined (stroked) words, sweep-fill buttons, the pink bubble footer with "What if" lines and watermark, the fill-box steps list, the hover-sweep use-case index.
- **Landing base** (`landing/index.css`): seven-blue tokens, glass tokens, fixed atmosphere with drifting lights, pill section labels, gradient `em`, Sky Blue buttons. `.paper` is now just text colour: the whole page is one dark environment.
- **Nav** (`Nav.tsx/.css`): floating glass pill with chapter links (`#film #meet #languages #how #uses`, current one lit via IntersectionObserver), Sign in / Open console, Book a demo, reading-progress hairline. New ids added to Languages, Steps, UseCases sections.
- **Hero** (`Hero.tsx/.css`) + new **`Showcase.tsx/.css`**: split composition; right side is a floating console replaying one example call (ring → greeting → caller → booking → booked), waveform, "On this call" moments from `CAPABILITIES`, language chip, booked chip. Labelled "Illustration" on screen, `aria-hidden`, no live data; text comes from the page's existing content. Pointer tilt clamped, off for touch and reduced motion. Panels are flat layers (no preserve-3d) so backdrop blur works.
- **Sections**: Problem board, Capabilities beats, Languages (glass tab switch + conversation window), Steps (three floating nodes on a light rail; rail uses `--p`), Use cases (glass accordion panels), Demo (glass sheet, contact tiles; error text soft red), End card (one glass panel), **Footer rewritten** as AICA's own (same link data).
- **Console pass**: every route captured (org, ops, account, workspace tabs, builder, error states). Fixes: Account page floating glass bar + glass cards; Ops sidebar marker removed; ops organisation sub-nav is a floating glass pill; tab pills tightened so the 10 workspace tabs fit one row at 1440.
- **Verified:** `tsc -b` clean; `npm run build` passes (incl. prerender); `vitest run` 268/269 with the full suite while the dev server ran, the one failure being the known slow `builder-flow` test, which passes alone (`builder-flow` + `demo` 20/20). Screenshots of every homepage section at 1440 and 390, and of all console/ops routes at 1440.
- **Not verified:** real phone/Safari, live backend, screen reader pass.

## VisionOS glass redesign, seven-blue palette (2026-10-18, branch `feat/premium-redesign`, uncommitted)
Approved 2026-10-18 from two reference images (a dark floating multi-panel dashboard; a light frosted spatial UI) and a fixed palette: #001D39 #0A4174 #49769F #4E8EA2 #6EA2B3 #7BBDE8 #BDD8E9. Decisions: orange dropped (Sky Blue is the action/focus colour); light theme kept as pale ice glass; charts use palette blues and rely on their legends/labels/tables. Supersedes the hybrid entry below.
- **Tokens** (`styles/tokens.css`): dark is now the default, light under `prefers-color-scheme: light`. Glass tokens `--glass` (panel), `--glass-2` (nested), `--glass-3` (raised), `--glass-light` (selected), `--glass-edge(-hi)`, `--blur`, `--blur-lg`, `--atmos` (the background field), `--card-solid` (opaque, for sticky headers), `--r-panel`, `--gap-float`. Old names kept: `--orange*` = Sky Blue action colour, `--aica` = Sky Blue.
- **Base** (`styles/base.css`): fixed atmosphere on `body::before`, two drifting lights on `body::after` (38 s, stops under reduced motion); `.glass`, `.glass--2/3/light` utilities; `@supports not (backdrop-filter)` makes glass near-opaque; phones get lighter blur. `float-in` keyframes.
- **Shells**: console sidebar is a floating glass rail (pill nav, active item lit with a Sky Blue icon circle, nav fades at the bottom); page head is a glass header bar; phone top bar is a floating glass pill. Ops rail floats the same way (stays dark). Sign-in form sits on a glass sheet.
- **Components**: tabs are a pill bar with an Ice selected pill; dialogs are raised glass with a blurred backdrop; switches on are Sky Blue; sticky timetable cells and dialog heads use `--card-solid` so content doesn't show through.
- **Home**: "Needs a person" is one glass panel; Reports is a large glass container, its sections nested tiles, its numbers lighter tiles (uses `:has()`; older browsers just lose the container).
- **Landing**: every colour mapped onto the palette; semantic red/amber/green kept for missed/waiting/done calls.
- **Verified:** `tsc -b` clean; `npm run build` passes (incl. prerender); `vitest run` 269/269 pass; headless Chrome screenshots of Home, Calls, Agents, login, landing at 1440 dark/light and 390 dark.
- **Next:** review on a real phone and Safari (blur cost, `:has()`), then commit. The orb image on the landing page has a faint pink rim baked into the asset.

## Premium redesign, hybrid palette (superseded) — (2026-10-18, branch `feat/premium-redesign`, uncommitted)
Approved 2026-10-18: hybrid palette (midnight navy surfaces, AICA blue → cyan for atmosphere, bitNtech orange kept as the only action/focus colour), keep light + dark themes, no new dependencies.
- **Tokens** (`src/styles/tokens.css`): porcelain light paper (`--cream` #f4f6fb), midnight ink (`--plum`/`--midnight` #0b1633), navy dark theme, cooler `--ivory`/`--night`. New: `--cyan`, `--voice`, elevation `--hl` `--sh-1..3`, `--glow`, `--spring`, `--dur-1..3`. Radii tightened (card 16, field 12). Names `--cream`/`--plum` kept so nothing else had to change.
- **Primitives** (`base.css`, `components.css`): buttons lift on hover with an orange glow on primary; `rise-in`/`fade-in`/`pop-in` keyframes and `.enter`; dialogs animate in with a blurred backdrop; tabs indicator grows in; cards, rows, tables and the org mark get elevation; `.skeleton` added; voice line drifts blue → cyan.
- **Shells**: console sidebar (glow, raised active item, orange marker), page head separator + ambient glow + entrance (`.console__head` and siblings, `backwards` fill only so no lingering containing block); ops sidebar same treatment and now has `stage` (fixes navy-on-night text in light theme); auth stage grid + drifting orb.
- **Landing**: every warm colour mapped to its cool equivalent across `src/landing/**/*.css`; hero gets an engineering grid layer (`.hero__grid`, one span in `Hero.tsx`), cyan core in the glow, gradient headline, glassier call notification. Problem section's purple beat kept on purpose.
- **Pages**: 31 bordered card rules in page CSS got `--sh-1` (scripted; modifier rules like `.op-card--flag` still override). Report/Home stat tiles: Archivo numerals, stagger, top light, stretch alignment (were vertically centred at uneven heights).
- **Fix outside the redesign:** `scripts/prerender-landing.mjs` imported a Windows path; now a file URL, so `npm run build` works on Windows too. `theme-color` is #03060f.
- **Verified:** `tsc -b` clean; `npm run build` (incl. prerender) passes; headless Chrome screenshots of landing, login, Home, Agents, Calls at 1440 light/dark and 390 light. Test results: see the completion report in chat.
- **Not done / next:** route transitions via View Transitions skipped (CSS entrances cover it); no per-page markup restructuring; landing sections below the hero only retinted. Review on a real device, then commit.

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
