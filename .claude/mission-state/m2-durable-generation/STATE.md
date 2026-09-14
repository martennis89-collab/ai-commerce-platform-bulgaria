# M2 — Durable parallel initial generation — STATE

## Status
**BRIEF DRAFTED. Implementation NOT started.** Awaiting user approval of the brief and decisions D1–D8. Blockers B1–B3 are listed below.
- Branch: `mission/m2-durable-generation` from `main` @ `e9e7d5e` (M1 merge, tagged `m1-accepted`). Local only.
- **Recommended model:** `claude-opus-5`, reasoning `high` (MODEL_ROUTING). Reason: durable execution design, AI tool safety, tenancy and audit.

## Sources read
- `PROJECT_INSTRUCTIONS.md`, `SCOPE_LEVEL_1/2/3_LOCKED.md`, `LEVEL_4_LOCKED.md`, `AUTONOMOUS_MISSION_PROTOCOL_LOCKED.md`, `MODEL_ROUTING.md`, `AMBORAS_BENCHMARK.md`, `DECISIONS.md`.
- Current `main`: `docs/TENANCY.md`, `docs/STOREFRONT.md`, `ARCHITECTURE.md`, M0/M1 mission state.
- The locked docs are unchanged since the baseline commit; `DECISIONS.md` gained ADR-015 to ADR-019.
- Amboras behaviour was **not** re-checked against live evidence. The brief relies only on the principles already recorded in `AMBORAS_BENCHMARK.md`.

## Repository reality (gap)
- **Missing:** no `packages/ai` or `packages/contracts`, no `AgentRun`/`AgentTask`/`PromptQueue`/`AIAction`/`Generation`/`BusinessProfile`, no LLM client, no merchant UI (`apps/admin`).
- **Present:**
  - M0 typed tool boundary (`src/tenancy/tools.ts`, 7 tools, no audit or idempotency);
  - M1 `storefront-schema` v1 (store name, locale, currency, theme preset only);
  - M1 deployments executed by an in-process subscriber (non-durable; `docs/STOREFRONT.md` §8).
- **Environment:**
  - No LLM or image provider credentials.
  - No Redis. Medusa 2.21 ships only `workflow-engine-inmemory` (not durable across restarts) and `workflow-engine-redis`.
  - One Postgres, the local Docker test DB.

---

## Draft mission brief (Level 4 template)

### PROJECT CONTEXT
AI-first ecommerce platform for small Bulgarian merchants.
- **M0** accepted shared Medusa under the isolation architecture (`docs/MEDUSA_TENANCY_DECISION.md` §5).
- **M1** delivered StoreEnvironment creation, an independent StorefrontProject, the deployment manifest contract, and preview deployments (`docs/STOREFRONT.md`).
- **Product promise (Level 1):** *a merchant describes what they sell and receives a real store within minutes*. Useful output should appear quickly, and independent work should run in parallel with live progress.

### CURRENT MILESTONE
M2: durable parallel initial generation. Brand, product drafts, storefront, images and offer suggestions, with live task status (LEVEL_4_LOCKED).

### OBJECTIVE
An authenticated merchant starts initial generation for their StoreEnvironment with a short description (plus optional facts and images). The server creates a durable `AgentRun` with independent `AgentTask`s, which produce:
1. a brand (name, tagline, tone, palette/theme tokens);
2. product **drafts**;
3. a storefront configuration that is validated and deployed to preview;
4. image outputs;
5. offer **suggestions**.

Tasks run in parallel, show live status and progress, survive refreshes, worker restarts and deploys, and fail independently. All persistent changes go through typed, validated, audited tools. The model never writes state directly.

### IN SCOPE
- **Durable execution (Level 3 §5).**
  - Entities: `AgentRun`, `AgentTask`, `PromptQueue`.
  - States: queued/running/waiting/paused/completed/failed/cancelled.
  - Tracking: current step and progress.
  - Controls: retry of failed tasks; follow-up prompts queued during a run; cancel/pause.
  - Execution: a worker deployment mode with leases, heartbeats and crash recovery.
  - Replaces M1's in-process deployment execution for preview deploys.
- **AI operator core** (`packages/ai` + `packages/contracts`, minimal).
  - Model provider abstraction, plus a deterministic fake provider for tests.
  - Prompt and output schemas.
  - Tool-call validation.
  - `AIAction` audit: tool, risk, inputs hash/redacted inputs, result, idempotency key, actor, run/task, timestamps.
  - Idempotent tool execution.
- **Tool set** (typed, tenant-injected, risk-rated per Level 3 §6):
  - `business_profile.upsert` (risk 0/1)
  - `brand.propose` / `brand.apply_theme` (risk 0)
  - `catalogue.create_product_draft` (risk 1; draft only, ADR-013)
  - `media.attach_product_image` (risk 1; depends on D2)
  - `storefront.update_config` (risk 0; schema-validated)
  - `storefront.request_preview_deployment` (risk 1; exists from M1)
  - `offers.propose` (risk 0; suggestion record only, never applied)
- **Entities (Level 3 §3), minimal:**
  - `BusinessProfile`;
  - `Generation` (the proposed artifact with provenance: merchant-confirmed fact vs AI inference vs recommendation);
  - `AgentRun`/`AgentTask`/`PromptQueue`/`AIAction`.
  - All are StoreEnvironment-owned.
- **Storefront.** `storefront-schema` v2 (brand/theme tokens; home page sections: hero, product grid, about; copy in `bg-BG`) and `storefront-core` 0.2.0 renderer support. Generated config is validated, then previewed.
- **Merchant API.** Start a generation; run/task status (polling and a server-sent stream); follow-up prompt; retry task; cancel/pause. All tenant-scoped via `ExecutionContext`.
- **Adversarial tests.** Tenancy of runs, tasks, actions and generations; prompt/tool injection; the draft-only guarantee; crash recovery.

### OUT OF SCOPE
- The contextual AI designer, element selection and persistent chat UX (M3).
- Real catalogue management: publishing, price management, collections (M4).
- Cart/checkout (M5); email/legal/analytics/launch readiness (M6); Econt (M7); payments (M8); custom domains (M9); billing (M10).
- Live storefront publish and controlled source editing.
- Voice input.
- Applying promotions: offers stay suggestions, and risk-2 publishing needs review later.

### ARCHITECTURAL CONSTRAINTS
- **Level 3 §1.** The LLM never directly manipulates persistent state. Typed validated tools carry permissions, risk levels, idempotency and audit. The server establishes `ExecutionContext`, and tool inputs never contain tenant selection. Commerce state stays deterministic.
- **Level 3 §2 and ADR-005.** One PostgreSQL environment. The worker is a deployment mode of the same backend. **Do not lock an external queue prematurely.**
- **Level 3 §5 and ADR-008.** Runs survive refreshes, worker restarts and deploys; task failures are granular.
- **ADR-013.** AI-inferred product facts stay drafts until the merchant confirms them. Prices and stock are never invented.
- **ADR-002, ADR-003, ADR-006, ADR-007.** AI acts as an operator, never the system of record. Tenant context is server-established. Storefront editing is schema-first with preview/live separation.
- **M0 §5.** No Medusa admin API for merchants or AI; resources are claimed with compensation; deny-by-default Store API; promotions environment-bound; customers platform-internal.
- **M1.** Deployments only through the manifest contract and provider abstraction.
- **`docs/TENANCY.md` §12 (AI runs).** Runs and actions are environment-owned. Test replaying a run id from another environment.

### AMBORAS REFERENCE
From `AMBORAS_BENCHMARK.md`: one prompt starts meaningful creation; useful output before lengthy setup; independent work in parallel with granular failure; real typed actions; live progress, plans and activity states; draft isolated from live; risky actions confirmed and audited. Not re-verified against current Amboras behaviour; re-check only if a decision depends on it.

### TESTS (to be finalised with the brief)
See `TESTS.json`. Deterministic suites use the fake model provider. An opt-in live smoke test runs only when provider credentials are supplied.

### ACCEPTANCE CRITERIA (binary)
1. One authenticated merchant request creates an `AgentRun` with parallel brand, catalogue-draft, storefront, image and offer tasks. Status, per-task state, current step and progress are visible through the API.
2. Killing and restarting the worker mid-run resumes the run. Completed tasks and completed tool calls are not repeated (idempotency proven).
3. An injected failure in one task leaves every other task's results intact, and retrying that task succeeds.
4. A follow-up prompt during a running run is queued and processed in order. Cancel and pause work.
5. Every persistent change is a validated tool call with an `AIAction` audit row. Invalid or extra-field model output is rejected without side effects.
6. Runs, tasks, actions, generations and profiles are StoreEnvironment-owned. Cross-environment run/task ids are rejected through the merchant API, status stream and tools. Prompt-injected tenant or foreign ids cannot select or touch another store.
7. AI-generated products are drafts, not visible through the Store API or on the storefront, with provenance recorded. No invented prices or stock.
8. The generated storefront config validates against schema v2, and a real preview deployment renders the generated brand and sections (E2E).
9. The M0 and M1 suites stay green.
10. Docs are updated: `docs/AI_EXECUTION.md` (new), `docs/TENANCY.md`, `docs/STOREFRONT.md`, `ARCHITECTURE.md`, and ADRs for the decisions taken.

### DOCUMENTATION
`docs/AI_EXECUTION.md` (new): runs, tasks, queue, worker, tools, risk, audit, idempotency. Plus `docs/TENANCY.md`, `docs/STOREFRONT.md`, `ARCHITECTURE.md`, `DECISIONS.md` (ADRs), and mission state.

### STOP CONDITION
Stop when the acceptance criteria pass, on a mandatory escalation (credentials, a locked-decision change, major framework replacement), or when a root blocker persists after three materially different attempts.

---

## Open decisions (need user input before coding)

| # | Decision | Why it matters | Options | Recommendation |
|---|---|---|---|---|
| D1 | Runtime LLM provider and model(s). DECISIONS.md lists "exact provider/model versions and pricing" as **open**. | Determines the SDK, structured-output/tool-calling approach, cost, and credentials. | (a) Anthropic Claude via `@anthropic-ai/sdk`; (b) another provider; (c) provider-agnostic with a fake provider only in M2. | (a) behind a provider abstraction. `claude-sonnet-5` for generation tasks, `claude-haiku-4-5` for cheap classification or extraction. Pricing and model routing recorded via ADR. Requires credentials (B1). |
| D2 | What "images" means in M2. | Level 1 says merchants provide images; LEVEL_4 M2 lists "images". AI image generation needs another provider; uploads need media storage and isolation (TENANCY §12). | (a) Merchant-uploaded photos only: tenant-prefixed storage, validation, derived sizes, attach to drafts; (b) AI-generated imagery via an image provider; (c) both. | (a) in M2, with (b) behind a later provider ADR. It avoids inventing product visuals, which is a product-truth risk. |
| D3 | Durable execution mechanism. | Level 3 §2 requires one Postgres, the worker as a deployment mode, and no premature external queue. Medusa's only durable workflow engine needs Redis. | (a) Postgres-backed `AgentRun`/`AgentTask` tables plus a worker with row leases (`SELECT … FOR UPDATE SKIP LOCKED`), heartbeats and recovery, calling Medusa workflows for commerce writes; (b) Medusa `workflow-engine-redis` (adds Redis); (c) an external job queue. | (a). It matches Level 3 without new infrastructure. (b) or (c) would need an ADR and infrastructure. |
| D4 | How M2 starts and who the merchant is. | M1 creation is operator-only. Level 1 wants a merchant prompt to begin store creation, but self-serve signup/onboarding is not assigned to a milestone. | (a) M2 starts generation for an **existing** environment (operator-provisioned, merchant logged in); (b) M2 adds self-serve signup that creates the environment and then generates. | (a) for M2. Record self-serve onboarding as an open item. (b) is a material product/scope addition and needs a decision. |
| D5 | Merchant-visible surface for "live task status". | Level 3 lists `apps/admin`, and mobile admin is a product requirement, but no admin app exists. | (a) API + server-sent events only, proven by tests; (b) API plus a minimal mobile-first run-status page in a new `apps/admin`. | (a) with a deliberately minimal (b) only if you want visible UX in M2. The admin shell otherwise lands with M3. |
| D6 | Where product drafts live. | ADR-013 (drafts until confirmation) and a single commerce source of truth. | (a) Medusa products with `status: draft`, claimed by the environment, with provenance in metadata; (b) `Generation` proposal records only, with Medusa products created at M4 confirmation. | (a) with provenance and no prices/stock unless merchant-provided. Must verify that draft products stay invisible through the M0 Store API policy (test). |
| D7 | Storefront generation depth. | Schema-first editing (ADR-007); M3 is the designer. | (a) schema v2: theme tokens + fixed home sections (hero, product grid, about), `bg-BG` copy; (b) multi-page/section library. | (a); broader page/section libraries in M3. |
| D8 | Cost and safety limits for runs. | Pricing is open; runaway spend or loops; Level 3 risk controls. | Per-run token/time budget, max tool calls per task, max concurrent runs per environment, retry caps. | Adopt conservative defaults via config, record them in `docs/AI_EXECUTION.md`, and revisit in M11. |

## Blockers (before or during coding)
- **B1 — Credentials (mandatory escalation).** No LLM provider credentials exist in the environment. M2 can be built and fully tested with a deterministic fake provider, but a real generation smoke test and quality check need an API key supplied by the user (never committed; local `.env` or secret store). Decide whether the M2 acceptance gate requires a live-provider smoke run (recommended: yes, opt-in test) or accepts fake-provider evidence only.
- **B2 — Image provider/media storage.** Only if D2 includes AI-generated images: that needs another provider decision and credentials. Uploads-only (D2a) is unblocked and uses Medusa's local file provider in development.
- **B3 — Durable engine infrastructure.** Only if D3 picks Redis or an external queue: that needs an ADR and local infrastructure. D3a is unblocked.
- **Housekeeping (not blocking).** M1 `STATE.md`/`TESTS.json` on `main` still say "awaiting merge". This can be corrected in the M2 branch's first commit if you want.

## Completed
- Brief and decision/blocker analysis drafted on `mission/m2-durable-generation`.

## Remaining
- User approval of the brief, D1–D8 and B1; then implementation.

## Next intended action
None until approval. Do not implement.
