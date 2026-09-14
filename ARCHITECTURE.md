# Architecture — Repository Notes

This file records repository-level architecture clarifications. It does not restate or override the LOCKED documents. `SCOPE_LEVEL_3_LOCKED.md` is normative.

## Current repository reality (after M0)

```text
platform/
  apps/backend      Medusa 2.21 + platform tenancy module (M0 proof)
```

No other Level 3 apps or packages exist yet. They are introduced by their milestones.

## M0 clarifications (tenancy)

M0 accepted the shared Medusa foundation. See `docs/MEDUSA_TENANCY_DECISION.md` and `docs/TENANCY.md`. The result clarifies how Level 3 §1.3–1.4 are realised on Medusa:

- **`StoreEnvironment` ownership.** `StoreEnvironment` is implemented in a platform `tenancy` module. Commerce resources are bound to it through a DB-enforced single-owner registry. Unowned resources are inaccessible (fail closed).
- **Merchant and AI access.** Merchants and the future AI operator use tenant-scoped services that receive a server-built `ExecutionContext`. Medusa's native `/admin` API is restricted to platform operators.
- **Shopper storefront API.** The shopper-facing Medusa Store API is exposed through a deny-by-default tenant route policy. Cart workflows carry isolation hooks that hold below the HTTP layer.
- **Shared reference data.** Regions, tax regions and payment-provider registration are platform-shared BG/EUR reference data, because Medusa assigns a country to only one region.
- **Customers.** Medusa's guest customer is a platform-internal global record. Merchant-facing customer data is the tenant-scoped `Shopper`.
