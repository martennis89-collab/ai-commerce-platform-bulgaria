# M2 — Durable parallel initial generation — STATE

## Status
**ACCEPTED, MERGED AND TAGGED (2026-09-15).** PR #3 was merged into `main` as merge commit `ea0a8f1`, and the annotated tag `m2-accepted` is pushed and verified to peel to that commit. M3 has not started.

## Progress (2026-09-14, local only, not pushed)
- **Commits.**
  - `861ea5b`: foundations, audited AI tools, worker, merchant API.
  - `80b6543`: deterministic suites, fixes, `docs/AI_EXECUTION.md`, ADR-020.
- **Verified.**
  - Unit: 141/141, including 18 AI contract tests.
  - M2 integration at `80b6543`: 14/14 (M2-T01…T10, T12…T14), including a real `medusa exec` worker SIGKILLed mid-run (M2-T02b).
  - Backend and test typecheck: clean.
- **Review round 1** (tenant-isolation-review, security-red-team, durable-agent-review). No cross-tenant finding.
  - **Fixed after `80b6543` and re-tested** (M2 integration 14/14):
    - (Medium, durability) A follow-up prompt left `processing` by a crashed worker blocked the run forever, and re-routing could duplicate tasks. Stuck prompts are now reclaimable after one lease period; tasks already created are recovered instead of duplicated. New T04 case.
    - (Low) Permission and ownership errors raised mid-run were retried; they are now non-retryable.
  - **Residual risks.**
    - The price guard accepts any amount the merchant literally wrote, not per product. Drafts still need merchant confirmation.
    - Uploaded photos are public by unguessable URL before products are published.
    - No per-merchant cap on concurrent SSE connections (M11 rate limits).
- **Plan deviations.**
  - Tool names settled as `brand.apply`, which covers the planned `brand.propose` and `brand.apply_theme`, and `storefront.update_home`, which replaces `storefront.update_config`.
  - The `storefront.deployment.queued` subscriber stays, but only as an immediate trigger into the leased durable lane.
- **Full regression (2026-09-14):**
  - Unit: 141/141.
  - Integration: 75/75 (M0, M1, M2).
  - Baseline: 6/6.
  - E2E: 5/5, including M2-T11 with a real `next build`.
  - Per-test evidence is in TESTS.json.
- **M2-T15 live Anthropic smoke: PASS** (2026-09-14, 1/1, 24.5 s).
  - Real `claude-sonnet-5` / `claude-haiku-4-5` calls went through the audited tools: 5 model calls, about 6.8k tokens.
  - Output: 3 drafts with merchant-stated prices only (14, 16, none), no stock, schema v2 Bulgarian home page.
  - **Copy follow-ups (not safety, not changed, so the smoke evidence stays valid):**
    - Product descriptions repeat prices.
    - The about text repeats the merchant's "price not yet set" note.
    - The applied theme equals the platform default. Record `theme_source` in the smoke output next time.
  - **Credential hygiene.** The user pasted the key into a terminal command, so it is in terminal scrollback and on 2 PowerShell history lines. It is not in any tracked file. Advised the user to revoke and rotate it.
- **Pushed** `mission/m2-durable-generation`; draft PR #3 into `main` opened (user-approved).
- **Gate round 1 (at `0b42bc8`): REJECTED.** The independent review returned CHANGES REQUIRED. It found no cross-tenant problem, no draft visibility, and no bypass of the tool gate. All findings are fixed on the branch; re-test results are below or in TESTS.json.
  - **M1 (pause/resume in flight).** Pause is no longer cached between checkpoints. A task whose run was resumed before it stopped is re-queued without spending an attempt. The sweep re-queues stranded paused tasks. Test: M2-T04b.
  - **M2 (follow-up processed twice).** Prompts now have a lease: `lease_token`, `lease_expires_at` and a heartbeat. Writes are fenced by the token. A unique index on `ai_task(prompt_id, task_key)` blocks duplicate tasks. Test: M2-T04c.
  - **M3 (stale run status).** `recomputeRun` is serialised per run with a Postgres advisory lock. `sweepExpired` recomputes every active run on each tick. Test: M2-T02c.
  - **M4 (catalogue follow-ups did nothing).** `catalogue` was removed from the follow-up targets. Product, price, stock and publishing requests route to `unsupported`, and the prompt is rejected with `unsupported_request`. A brand follow-up also rebuilds the storefront. Test: M2-T04.
  - **M5 (duplicate drafts after lease loss).** `ai_generation.idempotency_key` is a unique column, and generation lookup uses it.
  - **L1.** Added the ARCHITECTURE.md M2 section.
  - **L2 (active-run limit).**
    - Starting a run takes a per-store advisory lock.
    - Retry and follow-up cannot reactivate a finished run while another run is active.
    - Enqueueing a prompt takes a per-run lock. Test: M2-T13 concurrent start.
  - **L3.** Resume extends the deadline. Paused runs are excluded from the deadline sweep.
  - **L4.** Anthropic 4xx responses raise `ModelRequestError`, which is not retried. Routing calls now record their token usage.
  - **L5.** The price guard requires a EUR marker (€, евро, EUR) or a typed `price_eur` fact. "900 г" and "18 лв" do not count.
  - **L6.** Image pairing provenance records `position_inference`.
  - **L7.** The storefront-schema regexes use `\u00XX` escapes; the file has no raw control bytes.
  - **L8.** A `StorefrontConfigError` inside a tool is a non-retryable `ToolRejectedError`.
  - **L10.**
    - M2-T14 runs a real stale `runLeasedDeployment` holder.
    - M2-T07 adds another store's task id on the caller's own run.
    - The vacuous secret assertion in M2-T08 was removed.
    - The M2-T14 wording in TESTS.json was corrected.
  - **L11.** Retry resets `tool_calls`.
  - **Carried as notes, not fixed.**
    - L9: the subscriber still triggers leased builds in the requesting process, and there is no deployment heartbeat.
    - L10: M2-T11 renders fake-model output, not a real-model palette.
    - Refused or truncated outputs do not record their tokens.
  - **Migration.** `src/modules/ai/migrations/Migration20260914223307.ts`.
  - **Also fixed during re-test.** Run summaries return tasks in a stable order (brand, catalogue, images, storefront, offers). A batch insert gives all tasks the same `created_at`, which made the order random.
  - **Re-tested after the fixes (2026-09-15):**
    - Typecheck: 0 errors.
    - Unit: 147/147.
    - Integration: 78/78, including M2 17/17.
    - Baseline: 6/6.
    - E2E: 5/5.
    - The M2-T15 live smoke is from before these fixes. Initial-generation prompts are unchanged; routing and the price guard are stricter.
- **Independent review round 2 (at `9771c72`): ACCEPT WITH NOTES.**
  - **Round 1 findings.** M1–M5 fixed. L1, L3, L5–L8, L10 and L11 fixed. L2 partially fixed. L4 mostly fixed. The three new tests (M2-T02c, T04b, T04c) would fail on the old code.
  - **Follow-up fixes after round 2.** Re-tested on 2026-09-15:
    - Typecheck: 0 errors.
    - Unit: 147/147.
    - Integration: 78/78 (M2 17/17).
    - Baseline: 6/6.
    - E2E: 5/5.
    - **N1 (Medium, pool starvation).** `recomputeRun` does its advisory lock and all reads and writes on the lock's own transaction connection, with no second pool connection. `AI_WORKER_CONCURRENCY` is capped at 4, below the knex default pool of 10.
    - **N2.** The sweep recomputes only runs idle for more than 5 seconds, at most 50 per tick.
    - **N3.** The prompt lease token is re-checked right before tasks are inserted. Prompt summaries expose `unsupported` when part of a request was not applied.
    - **N5.** The migration backfills `ai_generation.idempotency_key` from `payload`.
    - **L4.** Anthropic 408 and 409 stay retryable.
  - **Documented, not changed.**
    - N4: a paused run stays active, never expires, and each resume restarts the deadline, bounded by the model budget.
    - L2 remainder: `assertNoOtherActiveRun` is not under the start lock, and resume does not check it.
    - A cheap live smoke re-run before tagging is advisable.
- **mission-gate-review: ACCEPTED** at `a36e239`: mission branch only, scope inside M2, no locked document changed, PR draft into `main` with a matching head, and the full regression plus the live smoke recorded.
- **Merged and tagged (2026-09-15, on user instruction).** PR #3 merged into `main` as `ea0a8f1`; annotated tag `m2-accepted` pushed, peeling to the merge commit locally and on the remote.
- **M3 has not started.**

## User-approved decisions
- **D1.** Anthropic, behind a swappable provider layer.
  - Model IDs are configurable through env vars.
  - Verify exact current API model names from Anthropic's model docs before implementing.
  - Intent: a Sonnet-tier model for generation, a Haiku-tier model for cheap extraction.
- **D2.** Merchant-uploaded photos only. No AI-generated images in M2.
- **D3.** Postgres-backed `AgentRun` / `AgentTask` / `PromptQueue` tables plus a worker in the same backend. No Redis or external queue.
- **D4.** Existing-store flow only. The operator creates the store; the merchant logs in and starts generation.
- **D5.** API plus a live status stream. No merchant admin UI page unless tests need one.
- **D6.** Product drafts are Medusa draft products, tenant-owned, with provenance. Drafts must never appear on the storefront.
- **D7.** Generate Bulgarian theme/settings plus a fixed home page: hero, product grid, about.
- **D8.** Conservative, configurable limits for tokens, runtime, tool calls, and runs per store.
- **B1.** Build and fully test with a deterministic fake model. A real Anthropic smoke test is required before M2 is accepted. Implementation is not blocked on the key being present today.

## Working rules (user instruction)
- **Project skills.** Use the Amboras skills in `.claude/skills` when relevant:
  - `/amboras-milestone-operator` for milestone execution;
  - `/durable-agent-review` for AI generation work;
  - `/security-red-team` and `/tenant-isolation-review` for security and tenancy review;
  - `/mission-gate-review` before merge or tag;
  - `/bulgarian-commerce-copy` for merchant and storefront copy;
  - `/amboras-impeccable-ui`, `/amboras-design-taste` and `/kowalski-design` for frontend work.
- **Visual direction.** Preserve the current Amboras direction. No generic SaaS or generic ecommerce styling.
- **Scope.** Do not start a future milestone unless explicitly approved.
- Branch: `mission/m2-durable-generation` from `main` @ `e9e7d5e` (M1 merge, tagged `m1-accepted`). Local only.
- **Recommended model:** `claude-opus-5`, reasoning `high` (MODEL_ROUTING). Reason: durable execution design, AI tool safety, tenancy and audit.

## Verified before implementation (2026-09-14)
- **Anthropic Models Overview** (`platform.claude.com/docs/en/about-claude/models/overview.md`):
  - Sonnet tier: `claude-sonnet-5`. $2/$10 per MTok, adaptive thinking, 1M context.
  - Haiku tier: `claude-haiku-4-5`, alias of `claude-haiku-4-5-20251001`. $1/$5 per MTok, extended thinking with no effort parameter, 200K context. **Retirement not sooner than 2026-10-15**, so keep the model ID configurable.
- **`@anthropic-ai/sdk`** is at 0.125.0. Structured outputs use `messages.parse` + `zodOutputFormat`.
- **Medusa Store API product routes** already filter `status: published`, so draft products are invisible natively, on top of M0 ownership.
- **Other Medusa facts:** `@medusajs/file-local` is installed, and `PG_CONNECTION` (knex) is available for lease SQL.

## Implementation plan (approved decisions applied)
- **A. Foundations.**
  - An `ai` module with `AgentRun`, `AgentTask` (lease owner/token/expiry, heartbeat, attempts, depends_on), `PromptQueue`, `AIAction` (unique idempotency key), `Generation` (provenance), `BusinessProfile` and `MediaAsset`.
  - Tenancy owned types gain `media_file`.
  - Deployment lease columns.
  - Model provider abstraction: a deterministic `fake` provider and `anthropic` (env `AI_GENERATION_MODEL`, default `claude-sonnet-5`; `AI_EXTRACTION_MODEL`, default `claude-haiku-4-5`).
  - Configurable limits (D8).
  - `storefront-schema` v2 (theme tokens + home hero / product grid / about) and `storefront-core` 0.2.0, using the Amboras frontend skills and `bulgarian-commerce-copy`.
- **B. Tools and media.**
  - An audited executor on top of the M0 typed tool boundary: selector scan, strict schema, permission, max auto-risk, and an `AIAction` row keyed by idempotency key; tools resolve existing resources by that key.
  - Tools: `business_profile.upsert`, `brand.propose`, `brand.apply_theme`, `catalogue.create_product_draft` (Medusa draft, claimed, provenance, prices only from merchant facts, never stock), `media.attach_product_image`, `storefront.update_config`, `storefront.request_preview_deployment`, `offers.propose`.
  - Merchant photo upload: validated type/size/magic bytes, tenant-prefixed key, owned `MediaAsset`.
- **C. Durable execution.**
  - A worker with Postgres lease claims (`FOR UPDATE SKIP LOCKED`), heartbeats and fencing tokens.
  - Task implementations: brand, catalogue, images, storefront, offers.
  - Run state recomputation, cancel/pause/resume, retry, and follow-up PromptQueue processing in sequence.
  - A durable deployment lane replaces the M1 in-process subscriber.
- **D. Merchant API.** Start generation, run status, SSE status stream, follow-up prompts, retry task, cancel/pause/resume, media upload. New permissions.
- **E. Tests.**
  - Unit.
  - Integration with the fake model: parallelism, failure isolation, retry, idempotency, cancel/pause, prompt injection, tenancy, drafts invisible, limits.
  - A durability suite that kills and restarts a real `medusa exec` worker process.
  - E2E preview rendering generated sections.
  - An opt-in live Anthropic smoke test.
  - M0/M1 regression.
- **F. Close-out.**
  - Docs: `docs/AI_EXECUTION.md`, TENANCY, STOREFRONT, ARCHITECTURE, and ADRs.
  - Reviews with `durable-agent-review`, `tenant-isolation-review` and `security-red-team`.
  - Commit, push, draft PR, independent review, `mission-gate-review`.

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
