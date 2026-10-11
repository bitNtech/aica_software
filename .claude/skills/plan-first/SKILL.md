---
name: plan-first
description: Use for every task that could change repository files, architecture, dependencies, APIs, or behavior. Enforces plan-and-wait workflow.
---

# Plan First, Implement Later

1. Inspect the repository read-only. Do not change files during reconnaissance.
2. Restate the requested outcome and identify existing relevant implementation.
3. Identify unknowns and ask only blocking questions.
4. Create a proposal with:
   - objective and acceptance criteria;
   - architecture and data flow;
   - exact files to create/change/delete;
   - dependency choices and alternatives;
   - security, privacy, performance, and failure considerations;
   - tests and verification commands;
   - risks and rollback strategy when relevant.
5. Present the proposal to the user and explicitly ask them to say `proceed` if they want implementation.
6. Stop. Do not implement until approval arrives.
7. Approval is scoped to that proposal only. Re-plan if scope materially changes.

Planning itself must not cause implementation changes. If updating `handoff.md` would modify the repository before approval, present the proposed update in the response instead.
