# Scope Level 2 — LOCKED System Shape

Level 2 answers **how the system is shaped**. It records the high-level architecture agreed before the exact Level 3 specification. Where Level 3 is more specific, Level 3 is authoritative.

## Shape

```text
Merchant input (text / voice / images)
              ↓
       AI orchestrator
              ↓
 validated tools + risk controls
              ↓
       StoreEnvironment
       ↙       ↓        ↘
 Business   Commerce   Storefront
 profile     engine     projects
              ↓
 Payments · Shipping · Email · Domains · Media · Analytics
              ↓
          live storefront
```

The AI is the natural-language operator; deterministic services and persistent data remain the system of record.

## Major choices

- Use a mature commerce foundation (Medusa v2 was the agreed candidate) rather than building commerce primitives from scratch.
- Keep one backend codebase and one PostgreSQL environment initially, with custom platform modules alongside commerce modules. Server and worker are deployment modes; an external queue is not assumed until evidence requires one.
- Model each merchant store as a trusted `StoreEnvironment` boundary. Tenant context is established by the server from authenticated/session/hostname information, never by an arbitrary model or browser field.
- Provide each merchant an independent `StorefrontProject` backed by a shared, versioned storefront core. Level 3 defines the exact repository, deployment, schema, and source-editing progression.
- Start with structured storefront configuration and deterministic rendering; preserve a path to controlled source editing, build, screenshot, verification, preview, and publish later.
- Use durable asynchronous generation and event-driven integrations so refreshes, worker restarts, partial failures, retries, and follow-up prompts do not lose work.
- Treat payments, shipping, email, domains, media, analytics, consent, and platform billing as integration boundaries rather than entangling them with the AI layer.
- Keep shopper→merchant payments separate from merchant→platform billing.
- Make mobile merchant operation, draft/live separation, versioning/rollback, auditability, and analytics non-blocking commerce concerns from the beginning.

## High-level data domains

Organization, StoreEnvironment, BusinessProfile, Shopper, commerce entities, StorefrontProject/Theme/Deployment, Domain, Integration, AIAction, Generation, LaunchReadiness, and first-party analytics. Exact fields, APIs, tool contracts, and state machines belong to Level 3.

## Security and reliability principles

- Sales-channel visibility is not tenant authorization.
- Every operation is tenant-scoped and validated server-side.
- The model never directly writes persistent state.
- AI work is observable, resumable, retryable, and granular.
- Commerce remains available when analytics, email, imagery, or a carrier has a recoverable failure.
- No AI-generated change goes directly live without deterministic validation and appropriate preview/approval.

## Deferral rule

Level 2 does not settle exact provider versions, final Medusa tenancy mechanics, repository/deployment vendors, regulatory/payment details, domain registrar ownership, email vendor, billing plans, or the timing of controlled source editing. Those are either resolved by Level 3/M0 evidence or remain open in `DECISIONS.md`.
