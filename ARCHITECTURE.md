# Architecture — Repository Notes

This file records repository-level architecture clarifications. It does not restate or override the LOCKED documents. `SCOPE_LEVEL_3_LOCKED.md` is normative.

## Current repository reality (after M2)

```text
platform/                      npm workspaces, install-strategy=nested (ADR-019)
  apps/backend                 Medusa 2.21 + tenancy module (M0) + storefront module (M1) + ai module and durable worker (M2)
  apps/storefront              storefront-core harness: exactly one manifest; not a runtime
  packages/storefront-schema   strict storefront configuration schema
  packages/storefront-core     versioned core: manifest contract, build materialisation, Next.js template
```

The other Level 3 apps and packages (`apps/admin`, `packages/ai`, `packages/contracts`, `packages/integrations`, `packages/ui`, `packages/observability`) do not exist yet. They are introduced by their milestones.

## M0 clarifications (tenancy)

M0 accepted the shared Medusa foundation. See `docs/MEDUSA_TENANCY_DECISION.md` and `docs/TENANCY.md`. The result clarifies how Level 3 §1.3–1.4 are realised on Medusa:

- **`StoreEnvironment` ownership.** `StoreEnvironment` is implemented in a platform `tenancy` module. Commerce resources are bound to it through a DB-enforced single-owner registry. Unowned resources are inaccessible (fail closed).
- **Merchant and AI access.** Merchants and the future AI operator use tenant-scoped services that receive a server-built `ExecutionContext`. Medusa's native `/admin` API is restricted to platform operators.
- **Shopper storefront API.** The shopper-facing Medusa Store API is exposed through a deny-by-default tenant route policy. Cart workflows carry isolation hooks that hold below the HTTP layer.
- **Shared reference data.** Regions, tax regions and payment-provider registration are platform-shared BG/EUR reference data, because Medusa assigns a country to only one region.
- **Customers.** Medusa's guest customer is a platform-internal global record. Merchant-facing customer data is the tenant-scoped `Shopper`.

## M1 clarifications (storefront projects)

See `docs/STOREFRONT.md`. M1 realises Level 3 §2–§4 as follows:

- **Creation.** A `StorefrontProject` (one per environment) and its `Deployment` records live in a platform `storefront` module. Creation is a single compensating workflow: environment, owned sales channel, publishable key and stock location, project, owner membership, first preview deployment.
- **Build input.** Every build receives exactly one server-built, strictly validated **deployment manifest**. That manifest is where deployment isolation is enforced: its publishable key must resolve to the project's own environment.
- **Providers.** Deployments go through a provider abstraction (ADR-017). The M1 adapters are `dry-run` and `local`. The local adapter builds each deployment in its own directory, with an allow-listed child environment that carries no backend secrets.
- **Preview serving.** Preview hosts (`<handle>.preview.<platform-domain>`) resolve from the database on every request to one per-deployment static artifact. The local preview gateway serves files only; there is no shared multi-tenant storefront runtime.

## M2 clarifications (durable AI generation)

See `docs/AI_EXECUTION.md` and ADR-020. M2 realises Level 3 §1.2, §5 and §6 for initial generation. The Level 3 `packages/ai` does not exist yet; the AI layer lives in `apps/backend/src/ai` until a second consumer needs it.

- **Durable state.** Durable agent state is Postgres tables in a platform `ai` module: `ai_run`, `ai_task`, `ai_prompt_queue`, `ai_action`, `ai_generation`, `ai_business_profile` and `ai_media_asset`. Every row carries its `store_environment_id`.
- **Workers.** Workers run in the same backend: a Medusa scheduled job in `shared`/`worker` mode, or `medusa exec ./src/scripts/ai-worker.ts`. There is no Redis or external queue.
  - Tasks, follow-up prompts and storefront deployments are claimed through atomic Postgres leases with fencing tokens.
  - Only the current lease holder can write progress, tool calls or results. Expired leases are recovered by any worker.
- **Model boundary.** Models never act directly. A provider layer (a deterministic fake, or Anthropic structured outputs) returns strictly validated JSON. Deterministic task code turns it into audited AI tool calls. Each call passes the M0 tool boundary plus risk, budget, lease and idempotency checks, and records an `ai_action`.
- **Tenant context.** Workers rebuild the merchant `ExecutionContext` server-side for every task. Prompts and model output never select a tenant.
- **Generated artifacts.**
  - Product drafts are Medusa draft products claimed by the environment, with provenance.
  - Storefront changes are storefront-schema v2 config rendered by storefront-core 0.2.0 into preview deployments.
  - Offers are suggestions only.
