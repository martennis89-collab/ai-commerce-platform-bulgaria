---
name: amboras-milestone-operator
description: "Use when running Amboras milestone missions in Claude Code: M0, M1, M2, reviews, PRs, tags, mission state, and canonical project governance."
---

# Amboras Milestone Operator

Use this when executing or reviewing Amboras milestone work.

## Operating Discipline

- Read `PROJECT_INSTRUCTIONS.md`, locked docs it references, `DECISIONS.md`, and the relevant mission state before changing code.
- Work on the approved mission branch, not directly on `main`.
- Keep implementation scope inside the approved milestone.
- Do not start the next milestone without explicit approval.
- Treat a real `FAIL`, `REJECTED`, or `BLOCKED` result as useful evidence.
- Preserve existing user or agent work; do not reset or revert unrelated changes.

## Evidence Standard

Completion requires:

- Tests and typecheck/build run with recorded results.
- New tests for new security, tenancy, durability, or UI surfaces.
- Mission state updated.
- Decision docs updated when architecture or acceptance claims change.
- Commit SHA recorded in the result.

## PR/Acceptance Flow

Recommended flow:

1. Implement on mission branch.
2. Commit locally.
3. Push mission branch.
4. Open draft PR into `main`.
5. Run independent review.
6. Fix material issues.
7. Run final gate review.
8. Mark PR ready only after acceptance.
9. Merge into `main`.
10. Tag accepted milestone.

Never treat the implementer's summary as enough. Verify from repository state.
