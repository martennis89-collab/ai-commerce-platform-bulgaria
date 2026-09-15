# Decisions and Open Items

## Approved decisions

| ID | Decision |
|---|---|
| ADR-001 | Initial market is Bulgaria; `BG`, `bg-BG`, EUR; physical products only. |
| ADR-002 | AI is an operator through typed validated tools; it is never the system of record. |
| ADR-003 | `StoreEnvironment` is server-established tenant context; browser/model tenant selection is forbidden. |
| ADR-004 | Sales channels are not an authorization boundary; isolation is independently enforced and adversarially tested. |
| ADR-005 | One PostgreSQL environment initially; Medusa v2 plus custom modules in one backend codebase; worker is a deployment mode. |
| ADR-006 | Each merchant gets an independent `StorefrontProject` using a shared versioned storefront core. |
| ADR-007 | Storefront editing starts schema-first with deterministic rendering, versioning, preview/live separation, and a path to controlled source editing. |
| ADR-008 | Durable `AgentRun`/`AgentTask`/`PromptQueue` execution is required; task failures are granular. |
| ADR-009 | COD must work before card onboarding; Stripe Connect is preferred first card provider, not a permanent lock. |
| ADR-010 | Econt is first courier boundary; integration must support locations, validation, quotes, shipments, labels, tracking, and recoverable failures. |
| ADR-011 | Transactional email and analytics are event-driven/idempotent; neither can unwind or block commerce. |
| ADR-012 | Merchant payment flows and platform SaaS billing are separate money/data concepts. |
| ADR-013 | Product facts inferred by AI remain suggestions/drafts until merchant confirmation. |
| ADR-014 | M0 tenancy proof is a hard gate before serious platform development. |
| ADR-015 | M0 accepted (2026-09-14, `m0-accepted`): shared Medusa v2 is the commerce foundation under the isolation architecture and binding constraints in `docs/MEDUSA_TENANCY_DECISION.md` §5. |
| ADR-016 | `storefront-core` uses Next.js (App Router) with the Medusa JS SDK (user-approved for M1). |
| ADR-017 | StorefrontProject deployments go through a provider abstraction. The first adapter is local and credential-free, serving per-deployment build artifacts on `*.preview.localhost`. The real hosting provider remains open and requires its own ADR (user-approved for M1). |
| ADR-018 | Platform hostnames: live `<handle>.<platform-domain>`, preview `<handle>.preview.<platform-domain>`. The domain is a placeholder until the domain decision (user-approved for M1). |
| ADR-019 | `platform/` is an npm-workspaces monorepo (`apps/*`, `packages/*`) with no additional build orchestrator yet (user-approved for M1). |
| ADR-020 | M2 durable generation (user-approved D1–D8, B1): Anthropic behind a swappable provider with env-configured model ids (defaults `claude-sonnet-5` generation, `claude-haiku-4-5` extraction); Postgres-backed `AgentRun`/`AgentTask`/`PromptQueue` with lease-and-fencing workers in the same backend (scheduled job or `medusa exec` worker), no Redis/external queue; every model effect is an audited, idempotent AI tool call; product drafts are Medusa draft products with provenance; merchant-uploaded photos only; storefront-schema v2 with a fixed Bulgarian home page; conservative env-configured limits. Deterministic fake model in CI; a real-provider smoke is required before acceptance. See `docs/AI_EXECUTION.md`. |
| ADR-021 | The Amboras merchant admin is `platform/apps/admin`, a Next.js App Router app (React 19). It calls the `/merchant` API with the merchant's bearer token held only in memory: no cookies, no web storage, no credentialed CORS. The backend allows CORS only from configured `MERCHANT_CORS` origins. Admin pages refuse framing; only the same-origin draft frame may be framed, and only by the admin (user-approved M3-D2/D3). |
| ADR-022 | M3 contextual designer (user-approved D1, D4–D13, D16). `DESIGN.md` is the approved design contract for the admin UI and the storefront design space. storefront-schema v3 has one home page, a six-type section library with at most two variants per section, and owned media ids only. Storefront configuration is versioned by append-only `StorefrontRevision` rows (optimistic parent check, idempotent action key); undo/restore append and cancel in-flight designer turns. Fast edits render the authenticated caller's own draft in the admin with the shared `StorefrontPage` renderer; promotion creates a real per-project preview build; nothing goes live. Selections are re-resolved server-side against the caller's current draft. Designer turns are `designer_edit` AgentRuns through the M2 tool gate with risk-0 designer tools and risk-1 preview promotion. Screenshots use Playwright Chromium over the store's own artifact with network access limited to its own media. A monotonic deployment sequence, an exact artifact path and per-store rate limits for edits, turns, preview deploys and screenshots are part of M3. The live designer smoke remains required before acceptance unless the user waives it. |

## Explicitly open / not locked

- Exact provider/model versions and pricing.
- Real hosting/repository provider for merchant storefront projects. The provider abstraction and local adapter are decided (ADR-017); the production provider is not.
- Exact card provider integration details and regulatory review.
- Domain registrar/DNS ownership model and apex-domain handling.
- Production email vendor and sender-domain policy.
- Final plan names/pricing for M10.
- Full tax/legal wording and launch compliance review.
- Whether/when controlled source editing moves beyond schema/theme components.

Open items must not be presented to Claude as settled facts.
