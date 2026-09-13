# Amboras Benchmark

Amboras is the primary product and UX benchmark, not an authority for unverified internals.

## Principles to reproduce

- One prompt starts meaningful store creation; avoid a configuration wizard.
- Useful output appears before lengthy setup.
- Independent work can proceed in parallel and fail granularly.
- AI performs real typed actions, not only advice.
- The assistant remains available throughout admin and storefront work.
- Current page and selected-element context make “change this” reliable.
- Live progress, plans, and activity states make work legible.
- Draft storefronts are isolated from live storefronts.
- Risky actions receive confirmation, validation, audit, and rollback.
- Storefront changes are verified before publication, including render and visual checks.
- Infrastructure complexity is absorbed by the platform.
- Storefront flexibility can progress from structured configuration to controlled source editing.

## Our deliberate adaptations

- Use a server-established tenant context; never trust a browser tenant header as authentication.
- Use a shared versioned storefront core with an independent project per merchant, avoiding uncontrolled repository sprawl.
- Start with validated schema/theme/section editing; source editing is later.
- Use Bulgarian-first commerce constraints: `BG`, `bg-BG`, `EUR`, guest checkout, COD first, Econt first.
- Treat generated product facts as drafts until merchant-confirmed.

## Evidence freshness

Current Amboras behaviour, repository structure, model names, and external provider capabilities can change. Re-check current primary evidence before making a decision that depends on them. Never convert an observation into a locked fact without an explicit decision record.
