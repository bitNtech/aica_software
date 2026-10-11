# Claude Code Project Configuration

## Files
- `../CLAUDE.md`: primary repository-wide rules and mandatory approval gate.
- `settings.json`: starts Claude Code in plan mode and denies reading common secret-file patterns.
- `rules/`: focused rules for approval, frontend work, and external voice services.
- `skills/`: reusable task workflows Claude can invoke when relevant.
- `../handoff.md`: current project status, decisions, blockers, and next step.

## Recommended use
1. Copy this bundle into the root of the target repository.
2. Start Claude Code in that repository.
3. Ask for read-only reconnaissance and a proposed implementation plan.
4. Review the files and trade-offs Claude proposes.
5. Explicitly say `proceed` to authorize the latest plan.

## Important
These instructions guide Claude Code but are not a security sandbox. Review tool permissions and commands, especially in automated or unattended sessions. The settings deny common secret-file reads, but filenames and secret patterns vary; do not rely on this as the only secret-protection mechanism.
