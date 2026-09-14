# M0 Decision Record — Shared Medusa Tenancy

| | |
|---|---|
| Mission | `m0-medusa-tenancy` (Level 4, M0) |
| Branch | `mission/m0-medusa-tenancy` |
| Date | 2026-09-14 |
| Lead model | `claude-opus-5` (MODEL_ROUTING: tenancy/security → Opus, high) |
| Commerce engine | Medusa `2.21.0` (latest at evaluation), Node 24.14, PostgreSQL 16 |
| Status | Red-team finding (MEDIUM) remediated and re-reviewed by Opus; residual bypass found and closed; awaiting independent M0 review |

## Decision

**ACCEPTED**

The shared Medusa v2 foundation is viable under the isolation architecture documented in `docs/TENANCY.md`.

That architecture has five parts: a tenancy module with a DB-enforced single-owner registry; server-resolved `StoreEnvironment` scopes; a deny-by-default storefront policy; a tenant-scoped merchant service layer with Medusa's native admin API restricted to platform operators; and cart workflow hooks.

This acceptance is conditional on the binding constraints in §5. They are consequences of observed Medusa behaviour, not optional hardening.

## 1. Question

Can one shared Medusa backend host many merchants while meeting the locked requirements? Those requirements are: SCOPE_LEVEL_3 §1.3–1.4 and §9, ADR-003/004/014, and the seven mission invariants. Isolation must not depend on sales channels or client input, and it must not require unreasonable scattered code.

## 2. What native Medusa 2.21 actually does

Evidence: `integration-tests/baseline/medusa-native-behaviour.spec.ts`, run against vanilla Medusa with the identical two-merchant fixture. Raw results are in `.claude/mission-state/m0-medusa-tenancy/baseline-observations.json`.

| # | Attack or question (Store A = Maria Candles, Store B = Petya Jewellery) | Native result | Implication |
|---|---|---|---|
| NB01/02 | B product by id or in list via A's publishable key | 404 / hidden | Sales-channel filtering hides it. This is visibility, not authorization. Medusa only applies the filter when more than one sales channel exists. |
| NB03 | Add B's variant (managed inventory) to A's cart | 400, "sales channel not associated with any stock location" | Blocked only incidentally, by inventory-location wiring. |
| NB04 | Same, with `manage_inventory=false` | **200 — added** | No product/cart ownership check exists. |
| NB05 | Complete that mixed cart | 400, shipping-profile mismatch | Blocked only incidentally, not by ownership. |
| NB06 | A's key reads B's order by id | **200, including B's items** | Medusa treats the order id as a bearer secret; its route comment says so. |
| NB07/13 | A's key reads or mutates B's open cart | **200** | Carts are not bound to the publishable key. |
| NB08 | Move A's cart onto B's sales channel | **200, channel changed** | `POST /store/carts/:id` does not re-check the key and channel. |
| NB09 | Apply B's promo code to A's cart | **200, applied** | Promotions have no tenant concept. |
| NB10 | Attach B's shipping option to A's cart | 400, "invalid for cart" | Blocked incidentally by location wiring. |
| NB11 | Same email at both stores | **One global customer row** linked to both orders | Merchant-facing customer views would leak cross-store history. |
| NB12 | Any admin user lists orders | **200, both merchants** | The admin API has no tenant concept. The RBAC module is resource:operation only. |
| NB14 | Second merchant creates code `PETYA10` | Rejected, "already exists" | Promotion codes are a global namespace. |
| NB15 | Second region with country `bg` | Rejected, "already assigned to a region" | Regions cannot be per-merchant for the same country. |

Discrepancies with documentation-level assumptions:

- A publishable key's "scope" constrains catalogue visibility and new-cart channel assignment only. It does not bind existing carts or orders.
- Guest checkout reuses one customer per email globally.
- `completeCartWorkflow.orderCreated` exists and fires at runtime but is `@ignore` in the typings.
- Hooks registered by the app apply to workflows run through the engine or app code. A workflow object imported into a separate Jest module instance runs without them.
- The core `caching` feature flag is off by default.

**Conclusion:** native Medusa provides no tenant isolation. Every guarantee below comes from the platform layer, which is what M0 had to prove is clean.

## 3. Evidence that the isolation architecture holds

Automated results, 2026-09-14. Full mapping in `.claude/mission-state/m0-medusa-tenancy/TESTS.json`.

| Suite | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Unit (`src/tenancy/__tests__`) | **53/53** |
| Protected adversarial integration (`integration-tests/http/m0-tenant-isolation.spec.ts`) | **40/40** |
| Vanilla baseline characterization | 6/6 |

| Invariant | Proven by |
|---|---|
| 1. Merchant reads only its environment | T01, T03–T05, T17–T19, T21, T25, T31 |
| 2. Merchant mutates only its environment | T20–T23, T25 |
| 3. Shopper action on A cannot touch B, even with valid B ids | T07–T16, T18, T25, T33 |
| 4. Environment cannot be selected by client or tool | T26a–d, T27, T29, T33, unit selectors/tools |
| 5. Same email shops independently without leakage | T02, T24, unit merchant-fields |
| 5a. Medusa global customer relation stays platform-internal on Store API cart/order responses | RT01–RT04, unit customer-exposure |
| 6. Authorization independent of sales channels | T09, T12, T26c, **T28** (B's product deliberately linked into A's channel and location stays invisible and unpurchasable) |
| 7. Central, maintainable enforcement | Deny-by-default policy verified against Medusa's route files (unit), fail-closed ownership (T31), workflow hooks below HTTP (T09–T14), single merchant service and tool boundary (T27) |

Every attack test uses real ids of the other tenant. HTTP-layer defences and workflow-layer defences are each tested independently. T10 inserts a foreign line item directly through the cart module, then shows completion is still refused.

## 4. Why this is clean rather than scattered

The enforcement surface is small and has one home:

| Piece | File | Size |
|---|---|---|
| Ownership registry and resolvers | `src/modules/tenancy/*`, `src/tenancy/context.ts` | one module, one scope class |
| Storefront policy | `src/tenancy/storefront-policy.ts` | one declarative table (19 routes) |
| Cart invariants | `src/workflows/hooks/tenancy-isolation.ts` | one file, 10 hook handlers |
| Merchant surface | `src/tenancy/merchant-commerce.ts` | one service; routes are 3–10-line adapters |
| Tool boundary | `src/tenancy/tools.ts` | one definer and one executor |

Structural properties that keep later milestones safe by default:

- **Fail closed everywhere.** Unowned resources are invisible, unclassified routes return 403, merchants cannot reach the native admin API, and a missing hook leaves orders unowned.
- **No tenant parameter exists.** Services and tools take an `ExecutionContext` and resource ids. A `TenantScope` cannot be constructed outside the resolvers.
- **Data-level single ownership** is enforced by a Postgres unique index, not by convention.
- **Upgrade tripwires.** A new Medusa Store route is denied until classified (unit test). A removed `orderCreated` hook fails T01/T02.
- **Global customer data is stripped at the Store API boundary.** Red-team tests RT01/RT02 proved Medusa can serialize its global customer relation through cart/order query fields and defaults; the first remediation stripped only top-level fields on routes with a response backstop. Opus re-review probe RT03 then showed `DELETE /store/carts/:id/line-items/:line_id` still returned the global customer inside `parent.cart`. The storefront guard now removes `customer`/`customer_id` at any depth on every guarded route (after `toJSON`, so totals survive) and rejects field paths naming a customer segment anywhere (RT04: 15 expansion variants, no leak). The pre-fix exposure contradicted §5.5; it is closed without changing the architecture, so the decision stays ACCEPTED.
- **No Medusa core changes**, no forks, no patches: only Medusa-sanctioned extension points (module, middlewares, workflow hooks).
- **Consistent with Level 3.** Level 3 already requires merchants and AI to act through typed, validated tools, so a tenant-scoped service layer is not extra work bolted onto Medusa. It is the layer the architecture mandates. Losing Medusa's admin API for merchants therefore costs nothing the architecture intended to use.

## 5. Binding constraints for later milestones

These follow from the evidence. Breaking any of them re-opens this decision.

1. **Merchants never use Medusa's `/admin` API.** All merchant and AI commerce operations go through tenant-scoped services taking an `ExecutionContext`.
2. **The Store API stays deny-by-default.** Enabling a route requires a policy entry with ownership checks and an adversarial test.
3. **Every tenant-owned resource is claimed in the workflow that creates it**, with compensation.
4. **Regions, tax regions and payment-provider registration are platform-shared.** Merchant-specific payment accounts are resolved from the environment.
5. **Medusa customers are platform-internal.** Merchant customer features use `Shopper`. Medusa customer accounts stay disabled unless re-designed on `Shopper`.
6. **Promotion codes must be namespaced per environment** before merchants can create codes (Medusa's code namespace is global).
7. **Workflow isolation hooks are part of the upgrade checklist.** Re-run the M0 suites on every Medusa upgrade.
8. **No tenant-sensitive cache** without environment-keyed cache keys and an A-warms/B-reads test. Keep Medusa's `caching` flag off until audited.

## 6. Decision criteria checklist

| # | Criterion | Result |
|---|---|---|
| 1 | Both stores operate normally | Yes (T01) |
| 2 | Same shopper purchases independently from both | Yes (T02) |
| 3 | All implemented cross-tenant attacks rejected | Yes (T03–T33) |
| 4 | Tenant context from trusted server execution | Yes (T26, T27, T29) |
| 5 | Sales channels not relied on for authorization | Yes (T28, T12, T26c) |
| 6 | Central and maintainable enforcement | Yes (§4, unit policy test, T31) |
| 7 | Automated tests prove the above | Yes (99 automated tests) |
| 8 | No LOCKED requirement weakened | Yes, none changed |
| 9 | No unreasonable ongoing hacks | Yes, §4; constraints in §5 are architectural rules, not per-feature patches |

## 7. Residual risks (accepted, tracked)

- Owned-id list filtering (`id IN (...)`) will need a join or the Index Module at larger catalogue sizes.
- Operators on `/admin` can act across tenants. This needs an audit trail before production.
- Future Medusa versions may change workflow shapes. This is mitigated by §5.7 and the tripwires.
- The response backstop covers products, carts and orders only. Extend it as routes are enabled.

## 8. Surfaces not yet testable

These surfaces do not exist in M0. They are not claimed as proven; their invariants are recorded in `docs/TENANCY.md` §12.

- Deployment / StorefrontProject isolation (M1)
- Custom domains (M9). The platform hostname resolver is proven (T29).
- Media uploads. Native upload is blocked for merchants (T32).
- Cache (no cache surface; T30)
- AI runs, payments, Econt, email, analytics
