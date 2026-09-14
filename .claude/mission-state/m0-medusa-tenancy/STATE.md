# M0 — Medusa Tenant Isolation Proof — STATE

## Objective
Prove (or disprove) that shared Medusa v2 (2.21.0) + custom tenancy modules can enforce StoreEnvironment
isolation per SCOPE_LEVEL_3 §1/§9, ADR-003/004/014. Binary decision in docs/MEDUSA_TENANCY_DECISION.md.

## Current approach
- `platform/apps/backend`: standalone Medusa 2.21.0 app (admin UI disabled), local Docker Postgres
  container `m0-medusa-postgres` on localhost:55432 (postgres/postgres, disposable).
- `src/modules/tenancy`: Organization, StoreEnvironment, ResourceOwnership (DB unique single-owner),
  StoreEnvironmentMember, PlatformOperator, Shopper (unique env+email).
- `src/tenancy/context.ts`: TenantScope (mint-guarded), trusted resolvers (publishable-key binding,
  merchant membership, owned-resource derivation), ExecutionContext.
- `src/tenancy/storefront-policy.ts`: deny-by-default /store route policy + product list filter + response backstop.
- `src/tenancy/merchant-guard.ts` + `src/api/merchant/*`: tenant-scoped merchant API; /admin operator-only;
  /auth/customer disabled.
- `src/workflows/hooks/tenancy-isolation.ts`: cart workflow hooks (context-free invariants, order/shopper ownership).
- `src/tenancy/tools.ts`: typed tool boundary (no tenant args possible).
- Tests: unit (src/tenancy/__tests__), protected integration (integration-tests/http), vanilla baseline
  (integration-tests/baseline with baseline-app cwd). Scripts: test:unit, test:integration:http, test:baseline, test:m0.

## Completed
- Canonical context read; no LOCKED conflict. ARCHITECTURE.md referenced by mission does not exist (will create minimal).
- Implementation of all layers above; tsc clean; unit 34/34.
- Baseline run 1 recorded (baseline-observations.json).
- Protected suite run 1: 30/35; 5 failures all direct Jest-imported workflow `.run()` calls (hook-less module
  instance). Rewritten to call via workflow engine by id.

## Discoveries (evidence in baseline-observations.json)
- Store API: cart/order ids are bearer secrets, not bound to publishable key (NB06, NB07, NB13).
- Cart can be moved to another sales channel via POST /store/carts/:id (NB08).
- Promotion codes are global and applicable across stores (NB09); code uniqueness is global (NB14).
- Foreign variant add blocked only incidentally by inventory-location check; succeeds when manage_inventory=false (NB03/NB04).
- Guest customer is one global row per email across stores (NB11); admin API has no tenant concept (NB12).
- Region countries are globally unique -> regions must be platform-shared (NB15).
- /store/products only filters by sales channel when >1 sales channel exists in the DB.
- Core caching feature flag default false; RBAC module is resource:operation only (not row-level).
- completeCartWorkflow `orderCreated` hook exists at runtime but is @ignore in typings.
- Hooks registered by the app do not apply to workflow objects imported separately in Jest.

## Remaining
- Rerun protected + baseline suites; fix; checkpoint commit.
- TESTS.json, docs/TENANCY.md, docs/MEDUSA_TENANCY_DECISION.md, minimal ARCHITECTURE.md note.

## Blocker
none

## Next action
Run `npm run test:integration:http` then `npm run test:baseline`.
