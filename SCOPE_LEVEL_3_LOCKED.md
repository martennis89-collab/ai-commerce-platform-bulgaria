# Scope Level 3 — LOCKED Build Specification

This document is normative. It defines the architecture; it does not claim every part is already implemented.

## 1. Core invariants

1. The LLM never directly manipulates persistent commerce state, databases, Medusa, payments, shipping, or infrastructure.
2. All AI operations use typed, validated tools and workflows with permissions, risk levels, idempotency behaviour, and audit records.
3. The server establishes `ExecutionContext { user, organization, store_environment, permissions, current_page, selected_entity }`. The model and browser cannot choose `store_environment_id`.
4. Sales-channel visibility is not tenant authorization. Every read and write is tenant-scoped and tested adversarially.
5. Commerce state is deterministic and authoritative outside the model.

## 2. Platform shape

Initial monorepo:

```text
platform/
  apps/admin
  apps/storefront
  apps/backend
  packages/ai
  packages/contracts
  packages/storefront-core
  packages/storefront-schema
  packages/integrations
  packages/ui
  packages/observability
```

`apps/storefront` is the local development, reference, and template harness for `packages/storefront-core` and `packages/storefront-schema`. It is not a shared multi-tenant storefront runtime and must not become one. Each merchant's live storefront is an independently provisioned `StorefrontProject`, built and deployed on its own path from the shared versioned core, as defined in §4.

One PostgreSQL environment initially. Medusa v2 plus custom platform modules run in one backend codebase; server and worker are deployment modes. Do not lock an external queue prematurely.

## 3. Core entities

`Organization`, `StoreEnvironment`, `BusinessProfile`, tenant-scoped `Shopper`, `StorefrontProject`, `Theme`, `Deployment`, `Domain`, `Integration`, `AIAction`, `Generation`, `LaunchReadiness`, and first-party analytics events. Commerce primitives remain commerce-engine-owned where practical.

`StoreEnvironment` binds organization, commerce identifiers, locale/currency, domain, and status. `StorefrontProject` binds one merchant environment to a template/version, repository/deployment references, preview/live URLs, active theme, and status.

## 4. Storefront

Each merchant has an independent `StorefrontProject` using a shared versioned `storefront-core`. Initial AI edits validated configuration: theme tokens, pages, sections, copy, assets, and layout variants. The renderer is deterministic. Later stages may add controlled custom components and source editing with compile, lint, screenshots, visual checks, preview, approval, and deployment.

Every revision is versioned with draft/preview/published/superseded states. Preview and live are separate. Stable element IDs and a preview bridge (`postMessage` or equivalent) provide selected-element context to AI.

## 5. Durable AI execution

Use durable `AgentRun`, `AgentTask`, and `PromptQueue` records. Runs survive refreshes, worker restarts, and deploys; support queued/running/waiting/paused/completed/failed/cancelled states; show current step and progress; allow retry and follow-up prompts. Brand, catalogue, storefront, image, and offer work may run independently. One failed task must not erase successful work.

## 6. Initial AI surface and risk

Start with a bounded tool surface for business/brand, products/media, collections, storefront/theme, offers, orders, customers, analytics, publish, and rollback. Tool inputs never contain tenant selection.

Risk 0: reads and reversible presentation changes. Risk 1: ordinary catalogue/stock changes with visible notification. Risk 2: material price/promotion/publish changes with review. Risk 3: refunds, deletion, bulk messaging, payment, and domain changes with explicit confirmation.

## 7. Commerce and integrations

First commerce slice: product, variant, inventory, cart, guest checkout, delivery details, shipping abstraction, COD, order, merchant order view, and inventory decrement. Cart persistence is tenant/environment keyed. Initial customer currency is EUR; locale is Bulgarian.

Econt is the first shipping integration boundary: locations, address validation, quote, shipment, label, tracking, and cancellation where supported. Provider failure must be recoverable. Card payments use a provider abstraction; Stripe Connect is the preferred first card provider, not an irreversible lock. Merchant payment flows and platform SaaS billing are separate concepts.

Transactional email is event-driven and idempotent. Email/analytics failures retry and never unwind an order; analytics never blocks commerce. Domains start with an instant platform subdomain; custom domains require explicit DNS/hostname validation and state tracking.

## 8. Legal, consent, mobile, and data boundaries

Include merchant legal profile and merchant-reviewed policy templates. Keep tax scope deliberately narrow: merchant-entered prices are final consumer prices for the Bulgarian MVP; cross-border VAT/OSS and multi-country tax are deferred. Include consent-aware analytics. Mobile admin is a product requirement for AI chat, orders, products, stock, uploads, preview, and basic analytics. Product metadata remains extensible JSON.

## 9. M0 gate

Before serious product development, prove two-store isolation across catalogue, cart, order, shopper, inventory, AI tools, hostname resolution, caching, media, and deployment. Same email must work independently in both stores. Direct foreign IDs and cache leakage must fail. If shared Medusa cannot meet the gate cleanly, revisit the commerce foundation rather than weakening isolation.
