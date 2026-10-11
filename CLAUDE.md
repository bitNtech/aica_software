# Production Software Development Rules

## Mandatory approval gate
**Do not modify, create, delete, move, install, deploy, migrate, or execute project-changing code until the user explicitly approves the proposed implementation by saying `proceed` or an unambiguous equivalent.**

For every new task, first inspect the current repository read-only and then:
1. Summarize the request and the current state relevant to it.
2. Identify assumptions, unknowns, risks, dependencies, and affected files/components.
3. Propose an implementation plan in `handoff.md` (or present the proposed contents if approval is required before writing files).
4. List the exact files you expect to add/change/remove, and why.
5. Explain verification steps and any commands, package changes, migrations, or external services involved.
6. Stop and wait. Do not begin implementation until the user approves.

The word `proceed` approves only the latest clearly scoped plan. If scope changes materially, report the revised plan and wait again. Never interpret a request to inspect, analyze, suggest, or plan as implementation approval.

## Repository boundary
- Work only inside the current repository.
- Do not edit sibling repositories, parent directories, global configuration, shared servers, or external deployments.
- Never SSH to, modify, restart, or deploy to the separately hosted ASR, TTS, or LLM servers.
- Treat those services as external dependencies. Integrate through documented API/WebSocket contracts and configurable environment variables.
- Do not copy model weights, duplicate inference pipelines, or build replacement ASR/TTS/LLM implementations unless the user explicitly asks and approves a separate plan.
- Do not expose secrets. Never print `.env` values or commit credentials. Use `.env.example` with placeholders.
- Do not run destructive commands, database migrations, package installs, formatting across the whole repo, or network operations without approval in the plan.

## Workflow
- Start with repository reconnaissance: inspect `git status`, project structure, package manifests, existing docs, tests, and conventions. Read-only commands only before approval.
- Preserve existing architecture and coding style unless the approved plan explicitly changes them.
- Prefer small, reviewable changes. Avoid unrelated refactors and speculative abstractions.
- Before adding a dependency, explain why native/existing tools are insufficient and identify bundle-size, licensing, maintenance, and runtime implications.
- Do not fabricate endpoints, schemas, environment variables, or service behavior. Mark unknowns and ask for API contracts when needed.
- Use existing scripts and tests where possible. After implementation, report changed files, commands run, results, unresolved issues, and a handoff for the next task.
- Never claim a test, build, or deployment succeeded unless it was actually run and its output checked.

## Frontend priorities
Frontend work is expected to be common. Prioritize:
- responsive behavior and accessible interactions;
- clear loading, empty, error, disconnected, and success states;
- production-grade keyboard navigation, semantic HTML, and reduced-motion support;
- maintainable components and consistent design tokens;
- realistic performance, code-splitting where useful, and no unnecessary animation;
- polished but purposeful motion rather than decorative effects that harm usability.

## Design and animation libraries
Consider these only when they fit the approved task and the existing stack:
- **GSAP**: complex timelines, scroll-triggered sequences, or coordinated animation.
- **React Bits**: reusable React visual effects/components; check compatibility, license, dependencies, accessibility, and performance before adoption.
- **Lenis**: smooth-scroll behavior where it adds value; preserve native scroll expectations, keyboard access, reduced-motion preferences, and touch behavior.
- Also evaluate the existing UI stack and appropriate alternatives (CSS transitions/keyframes, Motion/Framer Motion, Radix UI, shadcn/ui, Lucide, and existing component libraries).
Do not install, copy, or integrate any library before approval. Do not add every library by default. Recommend the smallest suitable set and explain trade-offs.

## External voice pipeline
The ASR, TTS, and LLM pipeline runs on other servers and is out of scope for local implementation unless explicitly approved.
- Keep service base URLs and credentials in environment configuration.
- Build an adapter/client boundary so UI code does not hard-code provider details.
- Define request/response/event contracts before wiring live calls.
- Handle timeouts, retries only when safe, cancellation, disconnects, and partial/streaming results.
- Do not log raw audio, transcripts, prompts, tokens, or personally identifying data by default.
- Provide mock/demo mode only if requested or approved; clearly distinguish mock data from live service responses.

## Security and production readiness
- Validate inputs at trust boundaries; authorize server-side; do not rely on frontend checks for security.
- Avoid unsafe HTML rendering and command construction.
- Use least-privilege configuration and secure cookie/token handling appropriate to the current architecture.
- Add useful structured logs without secrets or sensitive payloads.
- Consider rate limits, resource cleanup, graceful shutdown, and observability where relevant.
- Do not weaken authentication, CORS, TLS, CSP, or other protections to make a demo work.

## Completion report
After approved work, include:
1. Summary of behavior delivered.
2. Files changed and why.
3. Tests/build/lint/type checks actually run and their results.
4. Configuration or migration steps required.
5. Known limitations, risks, and follow-up items.
6. Updated `handoff.md` with current status and next recommended action.
