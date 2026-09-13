# Model Routing

Exact model names are intentionally maintained here, separately from the project constitution, because provider names and availability change.

## Approved routing

`last_verified: 2026-09-13`

| Work type | Model | Reasoning |
|---|---|---|
| Architecture, tenancy, security, risky design, payment/domain/infrastructure design, hard cross-cutting refactors, milestone audits | `claude-opus-5` | `high` |
| Well-specified implementation, UI, CRUD, wiring, routine tests, ordinary refactors, long autonomous implementation with low ambiguity | `claude-sonnet-5` | `high` |
| Optional independent red-team review or bounded parallel implementation | `gpt-5.3-codex` | `high` |

## Routing policy

- Model choice is based on risk and ambiguity, not task duration.
- One lead model per autonomous mission; do not switch repeatedly mid-mission.
- Review this table when a newer relevant model becomes available, or before a mission if there is reason to believe the table is stale. Update it through an explicit decision record and refresh `last_verified`.
- Codex is external and optional. Use it only when the environment genuinely exposes it, and never claim it was used otherwise.

## Mission record

Every mission brief must name the exact model from the approved routing table above, its reasoning level, and the reason for the route. If availability or model quality has changed, update the table through an explicit decision record before relying on the new route.

## Non-claims

Claude must not claim to have called Codex, a provider, or an external tool unless the current environment actually exposes and executed that capability.
