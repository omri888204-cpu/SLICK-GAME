# AGENT.md

## Purpose
Single source of workflow rules for any AI agent working on this repo.

## Non-Negotiable Flow
1. Propose a short plan before any code change.
2. Wait for explicit user approval.
3. Implement only approved scope.
4. Report what changed and why.
5. Show diff summary before any commit.
6. Wait for commit approval.

## Hard Rules
- No logic changes during pure refactor.
- No hidden architectural changes.
- No adding dependencies without approval.
- No file creation outside approved plan.
- No drive-by fixes outside scope.

## Refactor Policy
A change is refactor-only if:
- Behavior is unchanged.
- Public interfaces are unchanged (or adapter provided and approved).
- Tests/manual scenarios still pass identically.

If behavior must change, stop and request re-approval.

## Diff and Commit Policy
Before commit, the agent must provide:
- Changed files list.
- For each file: purpose of change in 1-2 lines.
- Risk notes (if any).
- Explicit statement: "No unintended logic changes" or details if changed.

No commit without explicit user "approve commit".

### Push Policy (separate from commit)

A local commit does not authorize push.

After commit:
1. Agent reports commit completed and waits.
2. User runs the game and performs 30-60 seconds of visual smoke test.
3. User explicitly approves push.
4. Only then: `git push origin <branch>`.

If the smoke test fails:
- Run `git revert HEAD`.
- Report failure to user.
- Do NOT attempt fixes during refactor - this violates "No logic changes during pure refactor".
- Wait for user direction on next step.

PROJECT_STATE.md is updated only after a successful push, never after a local-only commit. A milestone that did not reach push is not considered complete.

## Documentation Update Policy

### Critical Change (requires doc update)
- Module boundaries changed.
- Allowed/forbidden dependencies changed.
- Public contracts/interfaces changed.
- Game flow/state machine changed.
- New persistent subsystem added (save, netcode, analytics, ads).
- Build/run/deploy process changed.

Required docs to update:
- PROJECT_STATE.md (always for critical milestones)
- AGENT.md only if process/governance changed

Completion rule:
- A critical milestone is not complete until the relevant commit(s) are successfully pushed.
- PROJECT_STATE.md must be updated only after successful push, never after a local-only commit.

### Routine Change (no doc update required)
- Internal bug fix inside existing boundary.
- Local rename/reformat/restructure without behavior change.
- Small UI text/visual tweak without flow change.
- Test-only updates that reflect existing behavior.

## Architecture Guardrails
- Systems do not update HUD directly.
- UI/HUD never owns gameplay truth.
- Avoid circular imports.
- Prefer composition over inheritance for gameplay behavior.

## Code Style Lock
- Max 500 lines per file. Beyond that, stop and request split approval.
- File naming: PascalCase for class files, camelCase for utility/function modules.
- Import order: external libraries first, internal core second, local modules last, with one blank line between groups.
- No magic numbers in gameplay logic. Any numeric value used 2+ times must move to PlayBalance.ts or GameConfig.ts.
- No TypeScript any unless accompanied by an inline comment explaining why.

## Cross-Agent Compatibility Conventions
- Keep changes small and scoped to one approved task.
- Preserve existing public behavior unless scope explicitly says otherwise.
- Add top-of-file responsibility comments only when module intent is non-obvious.
- Use explicit TODO format: `TODO(owner/date): next action`.
- Keep handoff notes concrete and reproducible.

## Handoff Format (end of task)
- What was planned
- What was implemented
- What was not implemented
- Risks/open questions
- Suggested next step
- Task is not complete without updating PROJECT_STATE.md at the end of every significant milestone.