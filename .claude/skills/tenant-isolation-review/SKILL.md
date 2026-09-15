---
name: tenant-isolation-review
description: Use for Amboras tenancy-specific review involving StoreEnvironment scoping, Medusa shared backend behavior, merchant ownership, storefront responses, generated artifacts, deployments, jobs, and draft visibility.
---

# Tenant Isolation Review

Use this when reviewing anything that touches Amboras multi-tenancy.

## Core Boundary

StoreEnvironment is the tenant boundary. The server must establish tenant context. Clients, model prompts, storefront URLs, publishable keys, headers, and IDs are not trusted tenant authority by themselves.

Medusa internals may be shared, but Amboras must not expose Medusa-global identities or relations as merchant/customer concepts.

## Review Checklist

Check whether the change can leak or mutate data across StoreEnvironments through:

- Store API route parameters.
- Admin or merchant route parameters.
- Query parameters such as `fields`, `expand`, filters, search, sort, or pagination.
- Medusa relation loading and default response serialization.
- Publishable keys, sales channels, carts, orders, regions, promotions, customers, and products.
- Draft catalogue state.
- Storefront preview/live deployments.
- Generated files, build artifacts, logs, and job outputs.
- Background workers and retry logic.
- Webhooks or async callbacks.

## Test Expectations

Good tests include:

- Same-email guest/customer behavior across stores.
- Foreign cart/order/product/promotion access.
- Query expansion attempts.
- Path normalization attempts.
- Merchant viewing another merchant's resources.
- Drafts invisible to storefront.
- Job/deployment outputs scoped to one StoreEnvironment.

If the change affects a new surface, add an adversarial test for that surface before accepting it.
