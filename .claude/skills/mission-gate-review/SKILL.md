---
name: mission-gate-review
description: Use before accepting or merging an Amboras milestone branch. Verifies scope, locked docs, tests, docs, PR state, tags, and that the next milestone has not been started.
---

# Mission Gate Review

Use this before marking any Amboras milestone accepted or ready to merge.

## Gate Conditions

Verify:

- The branch is the intended mission branch and is not `main`.
- The work matches the approved mission scope.
- No future milestone was implemented early.
- Locked documents and `DECISIONS.md` were followed.
- Any conflict with locked docs was reported rather than silently reconciled.
- Tests cover the acceptance criteria and meaningful adversarial cases.
- Typecheck/build/test commands were run and results are documented.
- Docs and mission state files are updated.
- The PR targets `main`, has the expected head commit, and remains draft until review passes.
- Acceptance is based on observed evidence, not the implementer's summary.

## Review Output

Return one of:

- `ACCEPTED`: ready to mark PR ready, merge, and tag.
- `REJECTED`: material issue invalidates acceptance.
- `BLOCKED`: missing credentials, environment, or decision prevents proof.

Include the exact commit SHA reviewed and the verification commands/results.

Do not start the next milestone.
