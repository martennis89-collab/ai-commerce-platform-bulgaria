# Autonomous Mission Protocol — LOCKED

## Default operating mode

Given an approved mission, work continuously toward its acceptance criteria. Inspect the repository, make routine implementation decisions, edit files, run tests/type checks/lint/builds, repair ordinary failures, update documentation, and make safe local checkpoint commits without asking permission at every step.

Prefer large, self-contained missions over micro-prompts. Persist state before compaction or interruption. Use isolated parallel agents only for genuinely independent work with explicit ownership; never have overlapping agents modify the same subsystem.

## Branch discipline

Every implementation mission operates on its own mission branch or worktree. No autonomous engineering mission works directly on `main`. Safe checkpoint commits are created only on the mission branch or worktree. Parallel agents require separate, non-overlapping ownership of branches and file sets.

## Autonomy includes

- repository inspection and evidence gathering;
- routine design and implementation inside locked architecture;
- compatible ordinary development dependencies when clearly needed;
- tests, fixtures, migrations within mission scope, and ordinary failure repair;
- documentation updates and safe local commits on the mission branch or worktree;
- continuing through context compaction using persisted state.

## Mandatory escalation

Stop and request a decision for: changing a locked decision; materially different product behaviour not resolved by specifications; credentials, secrets, or external-account authentication; production deployment not expressly authorised; financial or legal commitments; destructive or hard-to-reverse external actions; irreversible production data mutation; force-push or destructive repository operations; replacing a major framework/dependency; or a root blocker after three materially different attempts.

## Stop-loss

After three materially different failed approaches to the same underlying problem, preserve state, record attempts/evidence/likely cause, and return `BLOCKED`. Never invent a workaround that violates a locked constraint merely to produce a passing result.

## Verification and handoff

Run the strongest relevant automated checks available. Record what passed, what remains, and any assumptions. Do not claim a milestone is complete without its acceptance gate. Do not silently continue into the next milestone.

## Safety boundary

Maximise freedom inside the development sandbox; minimise it outside. Routine local engineering is autonomous. Production, secrets, external financial/legal actions, and destructive operations remain controlled.
