# Tenancy

Status: implemented and adversarially tested in M0 (`platform/apps/backend`, Medusa 2.21.0).
Normative source: `SCOPE_LEVEL_3_LOCKED.md` §1, §3, §9; ADR-003, ADR-004, ADR-014.
Decision record: `docs/MEDUSA_TENANCY_DECISION.md`.

## 1. Tenant model

| Concept | Implementation | Notes |
|---|---|---|
| `Organization` | `tenancy_organization` | Owner of one or more environments. |
| `StoreEnvironment` | `tenancy_store_environment` | **The trust boundary.** Handle, name, normalised platform hostname, status (`active`/`suspended`), currency (`eur`), locale (`bg-BG`). |
| Resource ownership | `tenancy_resource_ownership` | `(resource_type, resource_id)` is **unique in Postgres**: a commerce resource belongs to at most one environment. |
| Merchant membership | `tenancy_store_environment_member` | Medusa `user` → one environment (M0: exactly one; `owner`/`staff`). |
| Platform operator | `tenancy_platform_operator` | Explicit allow-list for Medusa's native `/admin` API. |
| `Shopper` | `tenancy_shopper` | Unique `(store_environment_id, email)`. The tenant-scoped relationship with a natural person. |

Commerce primitives stay Medusa-owned. The tenancy module never copies commerce data; it records who owns it.

## 2. StoreEnvironment trust boundary

Every tenant-sensitive operation runs against a `TenantScope` bound to exactly one environment.
A `TenantScope` can only be minted inside `src/tenancy/context.ts` by one of these trusted resolvers:

| Caller | Resolver | Trusted input |
|---|---|---|
| Storefront (shopper) | `resolveStorefrontScope` | Server-side ownership record of the publishable key. All of the key's sales channels must be owned by the same environment. The environment must be active. |
| Merchant | `buildMerchantExecutionContext` | Verified JWT actor id → membership → active environment. |
| Workflow internals | `deriveScopeFromOwnedResource` | Persisted owner of the resource being mutated (e.g. the cart). |
| Provisioning | `provisioningScope` | Trusted server code only (M1 environment creation, fixtures). Never wired to HTTP. |

These are **never** trusted to pick a tenant: browser input, request body, query string, headers, or model/tool arguments.
Requests or tool calls that even contain a tenant selector are rejected with 400 rather than ignored. Selectors are `store_environment_id`, `tenant_id`, `organization_id` and variants, found at any depth, bracketed, or sent as `x-store-environment-id`-style headers.
The merchant `ExecutionContext` follows Level 3 §1.3 and is frozen.

A publishable key is a public storefront identifier, not a secret. Knowing Store A's key only grants Store A's public storefront surface.

## 3. Medusa mappings

| Medusa resource | Ownership | Rule |
|---|---|---|
| Sales channel | owned | One per storefront. It is a merchandising tool, **not** an authorization boundary. |
| Publishable API key | owned | Binds the storefront to its environment. |
| Stock location | owned | Environment warehouse. |
| Shipping profile / shipping option | owned | Environment delivery config. |
| Product | owned | Variants are authorized through their product's owner. |
| Inventory item | owned | Inventory levels require both the item and the location to be owned. |
| Promotion | owned | Codes are validated against the environment. |
| Cart | owned | Claimed in `createCartWorkflow.cartCreated`, derived from the owned sales channel. |
| Order | owned | Claimed in `completeCartWorkflow.orderCreated` from the cart owner. |
| Payment collection | derived | Authorized through the `cart_payment_collection` link to an owned cart. |
| Line item | derived | Must belong to an owned cart. |
| Region, tax region, currency, payment providers | **platform-shared** | Medusa allows each country in only one region (baseline NB15), so the BG/EUR region is shared reference data. Merchants cannot mutate it. |
| Customer | **platform-internal** | Medusa keeps one global guest customer per email across all stores (NB11). It is never exposed to merchants; use `Shopper`. |
| Medusa `store` module entity | unused for tenancy | A single Medusa store exists; tenants are StoreEnvironments. |

Ownership is **fail-closed**: an unowned resource is invisible to, and unusable by, every tenant (T31).

## 4. Request and context resolution

`src/api/middlewares.ts` registers global (method-less) middlewares. Medusa sorts these before all route middlewares and handlers.

- `/store*` → `storefrontTenantGuard`:
  1. reject tenant selectors;
  2. resolve the scope from the publishable key;
  3. match a **deny-by-default** route policy (`STOREFRONT_ROUTE_POLICIES`);
  4. run the policy's ownership check;
  5. install a response backstop that 500s if a response contains a product, cart or order not owned by the scope.
- `GET /store/products` → `tenantProductListFilter` intersects Medusa's filters with owned product ids. It never widens them, and an empty set never becomes "no filter".
- `/merchant*` → `authenticate("user", ["bearer"])`, then `merchantExecutionContextMiddleware`. Merchant routes call `merchantCommerce(ctx)` and nothing else.
- `/admin*` → `adminOperatorOnly`: merchant users get 403.
- `/auth/customer*` → denied, because M0 is guest checkout only.

Route params in store policies must look like Medusa ids (`prod_01…`), so a static sibling route such as `/store/products/search` is never misclassified as `/store/products/:id`.

### Store routes enabled in M0
Regions (list/get), payment providers, products (list/get), carts (create/get/update), line items (add/update/delete), promotions (add/remove), shipping options for an owned cart, shipping methods, payment collections and sessions, cart completion, and order by id.

Every other core Store route returns 403. That includes product variants, collections, categories, tags, types, options, search, customers, customer orders, order transfers, returns, cart customer transfer, taxes, and shipping-option calculation. `storefront-policy.unit.spec.ts` enumerates Medusa's route files, so a Medusa upgrade that adds a route is denied until it is classified.

## 5. Shopper handling

- Checkout is guest-only. The same email is valid in any number of environments.
- When an order is created, the `orderCreated` hook upserts `Shopper(env, lower(email))` and stores Medusa's global customer id internally (`medusa_customer_id`). That id is never serialised to merchants.
- Merchant shopper views compute `order_count` and `lifetime_value` **only from orders owned by the environment**.
- Merchant read field lists (`PRODUCT_FIELDS`, `ORDER_FIELDS`) must not traverse `customer` or use wildcards (`merchant-fields.unit.spec.ts`).
- Medusa customer accounts (`/store/customers*`, `/auth/customer*`, cart customer transfer) are disabled because Medusa accounts are global across stores. Per-merchant accounts, if ever required, must be built on `Shopper`.

## 6. Cart validation

There are two independent layers.

1. **HTTP policy.** Cart ids, variant ids, sales channel ids, shipping option ids, promotion codes, payment collections and line items in the path, body or query must be owned by the storefront's environment. Foreign ids return 404, indistinguishable from missing ones.
2. **Workflow hooks** (`src/workflows/hooks/tenancy-isolation.ts`). These are context-free data invariants that hold for every caller, including future services, AI tools and subscribers:
   - `createCart.validate`: the sales channel is owned and the items belong to the same owner. `cartCreated` claims the cart.
   - `updateCart.validate`: the cart is owned, and its sales channel cannot move to another environment.
   - `addToCart.validate`: the variants are owned by the cart owner, and custom (variant-less) items are rejected.
   - `updateLineItemInCart`, `addShippingMethodToCart` and `updateCartPromotions`: the same owner rule applies.
   - `transferCartCustomer.validate`: always rejected.
   - `completeCart.validate` re-checks the sales channel, every item variant, shipping options and applied promotions before any order is created.

## 7. Order validation

- An order is owned when `completeCart.orderCreated` claims it for the cart owner. This step compensates, so a failed claim rolls back the order.
- Merchant order reads and mutations (`cancel`, `complete`) assert ownership before calling Medusa workflows.
- `GET /store/orders/:id` requires the order to be owned by the storefront. In native Medusa, any key can read any order by id (NB06).
- Orders created outside `completeCart` (operator draft orders, exchanges) are unowned, and therefore invisible to merchants, until a later milestone claims them explicitly.

## 8. Inventory validation

- Merchant inventory reads and writes require **both** the inventory item and the stock location to be owned. Mixed pairs are rejected (T21).
- Cart inventory confirmation stays Medusa's. Tenant correctness of what enters the cart comes from the variant-ownership rules, not from sales-channel/location links. Native Medusa blocks foreign variants only incidentally, and not at all when `manage_inventory=false` (NB03/NB04).

## 9. Typed tool boundary (future AI)

`src/tenancy/tools.ts`:
- `defineTenantTool` refuses any input schema that declares a tenant-selecting field, and makes the schema strict.
- `executeTenantTool` rejects arguments containing tenant selectors before parsing, requires a server `ExecutionContext`, and checks the permission.
- Handlers use `merchantCommerce(ctx)`, so every id goes through ownership checks.

## 10. Rules for developers

1. **New merchant capability:** add a method to `merchantCommerce` (or another service taking `ExecutionContext`) that asserts ownership, then expose it through a route or tool. Never call Medusa's admin API on a merchant's behalf with caller-supplied tenant data.
2. **New commerce resource created for a merchant:** claim ownership in the same workflow (a step with compensation). Unclaimed resources stay invisible.
3. **Enabling a Store API route:** add a `STOREFRONT_ROUTE_POLICIES` entry with a `rule`, an ownership `check` for every id it accepts, and a `response` backstop if it returns tenant resources. Add an adversarial test using the other tenant's ids.
4. **New workflow that can move data between resources:** add a validate hook asserting a single owner.
5. **Invoking workflows:** application code does this normally. Tests must go through the workflow engine by id (`Modules.WORKFLOW_ENGINE.run`), because a workflow object imported into a Jest module is a separate, hook-less instance.
6. **Merchant read models:** never include `customer.*` or wildcards.

## 11. Known limitations

- **Owned-id lists.** List endpoints load owned ids and filter with `id IN (...)`. That is fine for small merchants, but should move to a join or the Index Module before large catalogues.
- **Upgrade-sensitive hooks.** `completeCart.orderCreated` is `@ignore` in Medusa's typings. T01/T02 fail loudly if it disappears, and orders fail closed (unowned).
- **Global promotion codes.** Promotion codes are globally unique in Medusa (NB14), so two merchants cannot both use `WELCOME10`, and code creation leaks existence. The catalogue/promotion milestone must namespace internal codes per environment (e.g. `maria:WELCOME10`) behind the tenant service.
- **Shared regions.** Per-merchant payment accounts (Stripe Connect) must be resolved from the environment server-side, not from region-provider configuration.
- **Operators cross all tenants.** Platform operators on `/admin` are outside the tenant boundary by design. Operator audit is future work.
- **One environment per user.** Multi-environment membership needs a server-side session binding with a membership check. It must never become a client `store_environment_id`.
- **Response backstop coverage.** It covers products, carts and orders only.

## 12. Invariants later milestones must test

- **M1 StorefrontProject / Deployment:** each project and deployment is bound to exactly one environment. Build/deploy credentials and env vars carry only that environment's publishable key. A preview URL resolves only its own environment. There is no shared multi-tenant storefront runtime. Test that deployment A cannot be configured or rebuilt with environment B's key or data.
- **Hostname / domains (M1, M9):** resolve with `resolveStoreEnvironmentByHostname` (exact normalised match, active only). A custom domain is bound only after DNS verification. Test that a look-alike host or an unverified domain never resolves, and that preview and live hosts are separate.
- **Caching:** M0 has no cache. Any cache of tenant-sensitive data must include the environment id in the key, and be tested by warming the cache as A and reading as B. Do not enable Medusa's `caching` feature flag without auditing `useCache` keys: `find-or-create-customer` caches by email alone.
- **Media:** uploaded files get tenant-prefixed keys and ownership records. Test that merchant A cannot list, overwrite or delete B's files, and cannot attach B's file ids to A's products.
- **AI runs (M2, M3):** `AgentRun`/`AIAction` are environment-owned. Tool inputs never contain tenant selection. Test replaying a run id from another environment.
- **Payments, shipping, email (M7, M8):** provider accounts, webhooks and idempotency keys resolve the environment from the owned order or cart, never from the webhook payload's claimed merchant.
- **Analytics (M6):** events are written with the server-resolved environment. Test that a client-sent environment in the event payload is rejected.
