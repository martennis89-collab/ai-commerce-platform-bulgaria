# M0 — Medusa Tenant Isolation Proof — STATE

## Objective
Prove (or disprove) that shared Medusa v2 (2.21.0) plus custom tenancy modules can enforce StoreEnvironment isolation per SCOPE_LEVEL_3 §1/§9 and ADR-003/004/014. The outcome is a binary decision in docs/MEDUSA_TENANCY_DECISION.md.

## Result
**M0: PASS. Medusa decision ACCEPTED**, conditional on the binding constraints in the decision doc §5. Awaiting independent M0 review. M1 has not been started.

## Implementation approach (final)
- **Backend.** `platform/apps/backend` is a standalone Medusa 2.21.0 app with the admin UI disabled. It uses a local Docker Postgres container, `m0-medusa-postgres`, on localhost:55432 (postgres/postgres, disposable).
- **Tenancy module** (`src/modules/tenancy`):
  - Organization and StoreEnvironment.
  - ResourceOwnership, with a DB-unique single owner per resource.
  - StoreEnvironmentMember and PlatformOperator.
  - Shopper, unique per environment and email.
- **Scope and context** (`src/tenancy/context.ts`): a mint-guarded TenantScope and trusted resolvers (publishable-key binding, merchant membership, owned-resource derivation), plus ExecutionContext.
- **Storefront policy** (`src/tenancy/storefront-policy.ts`): a deny-by-default /store policy table (19 routes), a product list filter, and a response backstop.
- **Merchant boundary** (`src/tenancy/merchant-guard.ts` and `merchant-commerce.ts`, routes in `src/api/merchant/*`): /admin is operator-only and /auth/customer is disabled.
- **Workflow hooks** (`src/workflows/hooks/tenancy-isolation.ts`): 10 cart workflow hook handlers.
- **Tool boundary** (`src/tenancy/tools.ts`): typed tools with no possible tenant argument.

## Completed
- Canonical context read; no LOCKED conflict. ARCHITECTURE.md did not exist, so a minimal one was created with M0 clarifications only.
- Implementation, migrations, fixtures (Maria Candles / Petya Jewellery, shared shopper test@example.com).
- Final verified run (2026-09-14):
  - tsc: clean.
  - Unit: 53/53.
  - Protected integration: 40/40 after independent red-team fix and Opus re-review hardening.
  - Vanilla baseline: 6/6.
- Documentation: docs/TENANCY.md, docs/MEDUSA_TENANCY_DECISION.md, ARCHITECTURE.md, TESTS.json, baseline-observations.json.
- Commit 9755c22 holds the code and tests; a docs commit follows it.

## Significant discoveries
Evidence is in baseline-observations.json.
- **Carts and orders.** Cart and order ids are bearer secrets and are not bound to the publishable key (NB06, NB07, NB13). A cart can be moved onto another sales channel (NB08).
- **Promotions.** Promo codes are global and apply across stores (NB09), and code uniqueness is global (NB14).
- **Foreign variants.** Adding a foreign variant is blocked only incidentally, by inventory location, and succeeds when manage_inventory=false (NB03, NB04).
- **Customers and admin.** There is one global guest customer per email (NB11), and the admin API has no tenant concept (NB12).
- **Red-team customer exposure.** Independent review found Medusa Store cart/order responses could expose the global customer id/relation through defaults or field expansion. The first fix stripped only top-level fields on routes with a backstop; Opus re-review probes (RT03) found DELETE line-item still leaked via `parent.cart.customer`. The storefront guard now strips customer/customer_id at any depth on every guarded route (toJSON-safe) and rejects any field path with a customer segment.
- **Regions.** A country can belong to only one region, so regions must be platform-shared (NB15).
- **Framework behaviour.**
  - The product list only filters by sales channel when more than one channel exists.
  - Core caching is off by default.
  - RBAC is resource:operation only, not row-level.
  - The `orderCreated` hook works at runtime but is @ignore in the typings.
  - Workflows imported into Jest modules run without the app's hooks, so tests use the workflow engine by id.

## Remaining work
None for M0. Next is an independent M0 review, which is the user's decision.

## Blocker
None.

## Next intended action
Stop. Do not begin M1.
