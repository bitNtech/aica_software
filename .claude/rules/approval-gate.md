# Approval Gate

- Default to read-only reconnaissance and planning.
- Before implementation, show a scoped plan and wait for explicit user approval.
- `proceed` applies only to the most recently presented plan.
- If the task, files, dependencies, data model, API contract, or risk profile changes materially, pause and seek approval again.
- Do not treat a request to "look into", "analyze", "figure out", "prepare a plan", or "what would you do" as permission to implement.
- Do not run installs, migrations, deploys, destructive commands, or external-service operations before approval.
