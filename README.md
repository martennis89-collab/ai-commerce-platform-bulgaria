# AI Commerce Platform — Claude Project Context Pack

Canonical context for an AI-first ecommerce platform for small Bulgarian merchants selling physical products.

## Read order

1. `PROJECT_INSTRUCTIONS.md`
2. `PRODUCT_VISION.md`
3. `AMBORAS_BENCHMARK.md`
4. `SCOPE_LEVEL_1_LOCKED.md` — what we are building
5. `SCOPE_LEVEL_2_LOCKED.md` — how the system is shaped
6. `SCOPE_LEVEL_3_LOCKED.md` — exact technical specification
7. `LEVEL_4_LOCKED.md` — how we execute it
8. `AUTONOMOUS_MISSION_PROTOCOL_LOCKED.md`
9. `MODEL_ROUTING.md`
10. `DECISIONS.md`
11. `ROADMAP.md`

## Authority

`PROJECT_INSTRUCTIONS.md` is the canonical constitution and governs how Claude works; the Claude Project-level Instructions must match it verbatim or contain only a pointer to it. Level 1 defines product scope, Level 2 defines system shape, Level 3 defines exact technical architecture, and Level 4 defines execution.

Authority between levels runs on two axes. For product intent and scope, Level 1 > Level 2 > Level 3 > Level 4; a later level must never silently change what product we are building, and Level 4 controls execution and staging only. For implementation specificity, Level 3 > Level 2 > Level 1; Level 3 may refine how earlier intent is implemented. `PROJECT_INSTRUCTIONS.md` holds the authoritative statement of this rule.

The LOCKED set is `SCOPE_LEVEL_1_LOCKED.md`, `SCOPE_LEVEL_2_LOCKED.md`, `SCOPE_LEVEL_3_LOCKED.md`, `LEVEL_4_LOCKED.md`, and `AUTONOMOUS_MISSION_PROTOCOL_LOCKED.md`. `AUTONOMOUS_MISSION_PROTOCOL_LOCKED.md` governs agent behaviour. `DECISIONS.md` records approved decisions and open items. `ROADMAP.md` sequences delivery. Repository code describes current reality and never overrides normative documents.

If a conflict cannot be resolved cleanly on the two axes above, or two documents at the same level conflict, stop and surface it; do not reconcile it silently.

## Audit artefacts

`VALIDATION_REPORT.md` is a non-normative, point-in-time audit record. It is not a source of truth, holds no precedence rank, and is superseded by any later validation report.

## Current product boundary

- Initial market: Bulgaria (`BG`), Bulgarian locale (`bg-BG`), EUR.
- Initial customer: small merchant selling physical products.
- Initial commerce: guest checkout, COD first, card-provider abstraction, Econt first courier integration.
- Initial storefront editing: validated structured configuration inside an independent `StorefrontProject`; controlled source editing is a later capability.
- First gate: M0 must prove tenant isolation before serious platform development.

## Open items

Open items are listed in `DECISIONS.md`; they are not hidden assumptions.
