# PROJECT_STATE

## Snapshot
- Date: 2026-05-24
- Current Phase: Architecture alignment before PlayScene split
- Branch: main
- Last Approved Scope: v2 architecture plan + Stage A creation of AGENT.md and PROJECT_STATE.md only

## What Exists Now
- Scenes:
  - `src/game/scenes/MenuScene.ts`
  - `src/game/scenes/PlayScene.ts`
  - `src/game/scenes/Scene.ts`
- Core Systems:
  - `src/game/systems/Physics.ts`
  - `src/game/systems/InputManager.ts`
- Entities:
  - `src/game/entities/Player.ts`
- Known Boundaries:
  - Play gameplay + world + HUD + collectibles + leaderboard UI are still concentrated in `PlayScene.ts`.
  - HUD currently lives inside PlayScene runtime flow (not split into dedicated HUD modules yet).
  - Leaderboard data path and query logic are in `src/game/services/leaderboard.ts`.
- Known Tech Debt (short):
  - `PlayScene.ts` is still very large (historically tracked around ~10,268 lines; current measured file length is 9,970 lines).
  - DragonBones tongue integration remnants still exist in PlayScene (`pixi-dragonbones-runtime` import and related setup/fallback logic).
  - `console.log` debug traces still exist in PlayScene and need cleanup policy during future hardening pass.
  - Firebase RTDB leaderboard ordered queries require `.indexOn` rules (`totalScore`, `maxHeightMeters`); repo has code-level guidance/fallback but no in-repo rules file enforcing it.

## Completed Milestones
- [2026-05-24] M1: Architecture v2 approved (flattened structure, no contracts layer, no per-file MD, AGENT governance accepted).
- [2026-05-24] M2: Refactor operating protocol approved (plan -> approval -> execution -> diff -> commit -> state update).

## Current In-Progress Milestone
- Goal: Initialize governance docs, then begin PlayScene extraction sequence without logic changes.
- Approved Scope:
  - Stage A: create `AGENT.md` and `PROJECT_STATE.md`.
  - Stage B merged into Stage C (no empty-folder commit).
  - Stage C starts module-by-module extraction from PlayScene.
- Files expected to change first:
  - `AGENT.md`
  - `PROJECT_STATE.md`
  - Then Play split targets under `src/scenes/play/...` as each system starts.
- First extraction target (approved order): `PlatformSystem`.
- Risks:
  - Hidden coupling inside PlayScene may force stop-and-report before extraction.
  - Refactor scope creep risk if dependencies are discovered late.

## Next Milestone (Proposed)
- Goal: PlatformSystem extraction plan (design-only, no code changes), then implementation after explicit approval.
- Why now: It is the first approved step in the user-defined split order.
- Dependencies:
  - AGENT.md and PROJECT_STATE.md must be committed first.
  - Clear function/field move map must be approved before edits.
- Definition of done:
  - Platform logic moved out of PlayScene into `world/PlatformSystem.ts`.
  - No intended gameplay behavior change.
  - Diff reviewed and approved.
  - Separate PROJECT_STATE update commit completed.

## Open Decisions
- Decision: Exact target path migration from current `src/game/scenes/PlayScene.ts` to approved future layout under `src/scenes/play/...`.
- Options:
  - Gradual migration while keeping compatibility imports.
  - Single cut-over after several systems extracted.
- Recommended: Gradual migration with strict per-system commits and state updates.
- Owner: User
- Due: Before first extraction implementation commit

## Handoff Notes For Next Agent
- Read first:
  - `AGENT.md`
  - `PROJECT_STATE.md`
  - `src/game/scenes/PlayScene.ts`
- Do not touch:
  - Gameplay logic during refactor-only tasks.
  - Unapproved modules outside current extraction scope.
- Safe extension points:
  - New system files created only for the currently approved extraction target.
  - Inline file-header comments for non-obvious module responsibilities.