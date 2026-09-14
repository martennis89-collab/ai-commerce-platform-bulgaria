# M1 — StoreEnvironment + StorefrontProject shell — STATE

## Status
**BRIEF DRAFTED. Implementation NOT started.** This awaits user approval of the brief and the open decisions below.

- Branch `mission/m1-storefront-project` was created from `main` @ `000e72a`: the M0 merge, tagged `m0-accepted`.
- `LEVEL_4_LOCKED.md` requires a mission brief per milestone.
- `DECISIONS.md` lists "Repository/deployment provider for merchant storefront projects" as open. Choosing a provider and using its credentials is a mandatory escalation (AUTONOMOUS_MISSION_PROTOCOL_LOCKED).

## Recommended model
`claude-opus-5`, reasoning `high` (MODEL_ROUTING). M1 is tenancy-adjacent infrastructure and deployment design.

---

## Draft mission brief (Level 4 template)

### PROJECT CONTEXT
AI-first ecommerce platform for small Bulgarian merchants. M0 accepted the shared Medusa foundation under the isolation architecture in `docs/TENANCY.md`. Its binding constraints are in `docs/MEDUSA_TENANCY_DECISION.md` §5.

### CURRENT MILESTONE
M1: `StoreEnvironment` plus independent `StorefrontProject`, preview URL, and shell (LEVEL_4_LOCKED).

### OBJECTIVE
A trusted server flow that:
- creates a merchant's `StoreEnvironment` together with its Medusa commerce bindings (reusing M0 provisioning);
- creates an independent `StorefrontProject` from a shared, versioned `storefront-core`;
- produces a working preview URL that renders that environment's storefront shell and nothing else.

### IN SCOPE
- `StoreEnvironment` creation and status lifecycle as a server workflow, with ownership claims and compensation. This productionises M0 `provisioning.ts`.
- `StorefrontProject` entity, per Level 3 §3: environment binding, template/version, repository and deployment references, preview/live URLs, active theme, status.
- `Deployment` record with states and a **deployment provider abstraction**. The first adapter depends on Decision D1.
- **Monorepo packages**, minimum only:
  - `packages/storefront-core`: a versioned renderer shell;
  - `packages/storefront-schema`: a minimal validated config (store name, locale `bg-BG`, EUR);
  - `apps/storefront`: the local harness only. It must **not** become a multi-tenant runtime (Level 3 §2).
- **Platform hostname and preview URL.**
  - Assign the platform subdomain and preview hostname.
  - Resolve via `resolveStoreEnvironmentByHostname`.
  - Keep preview and live separate.
- **Shell storefront per project**:
  - reads only its own environment's catalogue through its own publishable key;
  - Bulgarian locale and EUR;
  - mobile-first placeholder layout.

### OUT OF SCOPE
- AI generation (M2) and the contextual designer (M3).
- Real catalogue management (M4), cart and checkout (M5), and operations (M6).
- Econt (M7), payments (M8), custom domains (M9), billing (M10).
- Controlled source editing, and a production storefront design.

### ARCHITECTURAL CONSTRAINTS
- **Tenancy (Level 3 §1, ADR-003/004, M0 §5).** The tenant is server-established. No shared multi-tenant storefront runtime. Merchants never use Medusa `/admin`. The Store API stays deny-by-default.
- **Per-merchant project (ADR-006).** Each merchant gets an independent `StorefrontProject` built from a shared versioned core.
- **Rendering (ADR-007).** Schema-first, deterministic rendering, with draft/preview/live separation.
- **Future invariants to test** (`docs/TENANCY.md` §12):
  - a deployment or project is bound to exactly one environment;
  - build and deploy configuration carries only that environment's publishable key;
  - a preview URL resolves only its own environment;
  - look-alike and unverified hosts never resolve.

### AMBORAS REFERENCE
"Useful output appears quickly"; draft storefronts isolated from live storefronts. Re-check current Amboras evidence only if a decision depends on it.

### TESTS (to be finalised with the brief)
- Environment + project creation is atomic, with compensation on failure.
- Two environments (Maria, Petya): each preview renders only its own store name and products.
- Deployment A cannot be configured or rebuilt with environment B's key or data (adversarial).
- Build and deploy configuration contains exactly one publishable key, owned by the project's environment.
- Preview and live hostnames are distinct. Look-alike, unknown and suspended hosts do not resolve.
- `storefront-schema` validation rejects invalid config. `storefront-core` version pinning is recorded per project.
- The M0 suites still pass (regression gate).

### ACCEPTANCE CRITERIA (binary)
- A creation flow exists that produces a `StoreEnvironment`, a `StorefrontProject`, a `Deployment` and a reachable preview URL, per environment.
- The two-store adversarial deployment and hostname tests pass.
- There is no shared multi-tenant storefront runtime.
- The M0 suites pass unchanged.
- Docs are updated: architecture notes, tenancy §12 items moved from deferred to proven, and the M1 decision record.

### DOCUMENTATION
`ARCHITECTURE.md` (M1 notes), `docs/TENANCY.md`, `docs/STOREFRONT.md` (new), `DECISIONS.md` (only via an approved ADR for D1/D2), and mission state.

### STOP CONDITION
Stop when the acceptance criteria pass, or when a mandatory escalation or a root blocker persists after three materially different attempts.

---

## Decisions required before implementation
| # | Decision | Why it blocks | Recommendation |
|---|---|---|---|
| D1 | Deployment/repository provider for StorefrontProjects (open in DECISIONS.md) | Determines the adapter, credentials, and what "preview URL" means in M1 | Build the provider abstraction now. The first M1 adapter is **local and deterministic**: per-project build output served on `*.preview.localhost`, with no credentials. A real provider (e.g. Vercel/Cloudflare) comes later via ADR. |
| D2 | Storefront framework for `storefront-core` | Shapes the core package and build pipeline; not specified in Level 3 | Next.js (App Router) + Medusa JS SDK. |
| D3 | Platform base domain / hostname scheme | Preview/live URL format | `<handle>.preview.<platform-domain>` and `<handle>.<platform-domain>`, placeholder domain in M1. |
| D4 | Monorepo tooling | Introducing `platform/` workspaces around the existing backend | npm workspaces at `platform/`; no additional build orchestrator yet. |

## Completed
- M0 merged (`000e72a`) and tagged `m0-accepted`.
- M1 branch created; brief drafted.

## Remaining
- User approval of the brief and D1–D4, then implementation.

## Blocker
Awaiting user decisions D1–D4 and brief approval (mandatory escalation: open provider decision).

## Next intended action
None until approval.
