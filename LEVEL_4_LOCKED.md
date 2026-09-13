# Level 4 — LOCKED Development Programme

Level 4 locks sequence, gates, and scope discipline. It does not pre-decide every implementation detail that a milestone is explicitly intended to discover.

## Execution rules

- One milestone at a time; never build future milestones opportunistically.
- Each mission states context, objective, in-scope, out-of-scope, constraints, tests, acceptance criteria, documentation, and stop condition.
- A milestone passes only on binary acceptance criteria, automated tests, and a recorded checkpoint/tag.
- Update architecture, tenancy, tool, storefront, event, integration, and decision documentation in the same mission when affected.
- M0 decides whether the shared Medusa path is viable; until it passes, later production work is provisional.

## Milestones

| Milestone | Outcome / gate |
|---|---|
| M0 | Adversarial multi-tenant isolation proof; pass or stop. |
| M1 | `StoreEnvironment` plus independent `StorefrontProject`, preview URL, and shell. |
| M2 | Durable parallel initial generation: brand, product drafts, storefront, images, offer suggestions, live task status. |
| M3 | Contextual AI store designer: element selection, persistent chat, schema/theme edits, preview, screenshots, undo. |
| M4 | Real catalogue: products, variants, price, stock, images, collections, AI catalogue tools. |
| M5 | Real commerce: persistent cart, guest checkout, COD, order, inventory decrement, merchant order view. |
| M6 | Operations: transactional email, shopper layer, statuses, consent, legal/profile surfaces, analytics, launch readiness. |
| M7 | Econt: locations, address, quotes, shipment, labels, tracking, recoverable outages. |
| M8 | Card payments: preferred provider onboarding, sessions, webhooks, success/failure, refund foundation. |
| M9 | Custom domains: DNS/hostname validation, SSL state, preview/live separation. |
| M10 | Platform billing: plan, subscription, usage, entitlement; separate from shopper→merchant money. |
| M11 | Alpha hardening with 10–20 outside sellers: mobile use, retries, idempotency, worker/build recovery, rate limits, observability, security and tenant attacks. |

## Required mission template

```text
PROJECT CONTEXT
CURRENT MILESTONE
OBJECTIVE
IN SCOPE
OUT OF SCOPE
ARCHITECTURAL CONSTRAINTS
AMBORAS REFERENCE
IMPLEMENTATION REQUIREMENTS
TESTS
ACCEPTANCE CRITERIA
DOCUMENTATION
STOP CONDITION
```
