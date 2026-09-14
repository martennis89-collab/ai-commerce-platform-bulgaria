# AI execution (M2)

Durable, parallel initial generation for an existing StoreEnvironment. Decisions D1–D8 and B1 are recorded in `.claude/mission-state/m2-durable-generation/STATE.md` and ADR-020 in `DECISIONS.md`.

## Shape

```
merchant ──POST /merchant/ai/runs──▶ AgentRun (queued) + 5 AgentTasks
                                        │
            Postgres lease claims (FOR UPDATE SKIP LOCKED, fencing token)
                                        │
   worker lanes ─▶ task code ─▶ model (strict schema) ─▶ audited AI tool ─▶ Medusa / storefront
                                        │
merchant ◀──GET /merchant/ai/runs/:id/events (SSE)── run/task status, step, progress
```

- **No model authority.** A model only returns JSON validated against strict zod schemas (`src/ai/schemas.ts`). Deterministic task code (`src/ai/tasks.ts`) turns validated output into tool calls. The model never names a tool, a store, or an id that is used without server checks.
- **Tenant from the server only.** The worker rebuilds the `ExecutionContext` from the run's requesting merchant (`buildMerchantExecutionContext`) and refuses to run if it does not match the run's StoreEnvironment.

## Tasks

| Task | Depends on | Model calls | Tools |
|---|---|---|---|
| `brand` | — | `brand.generate` (Sonnet tier) | `business_profile.upsert`, `brand.apply` |
| `catalogue` | — | `facts.extract` (Haiku tier), `catalogue.draft_copy` | `catalogue.create_product_draft` × n |
| `images` | catalogue | — | `media.attach_product_image` × n |
| `storefront` | brand | `storefront.home_copy` | `storefront.update_home`, `storefront.request_preview_deployment` |
| `offers` | catalogue | `offers.suggest` | `offers.propose` (suggestions only) |

`brand` and `catalogue` run in parallel; dependants start when their dependency completes, and wait (`waiting`) if it failed. A failed task never rolls back completed siblings.

## Durability

- **Claim**: one atomic `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)` sets `running`, a new `lease_token`, `lease_expires_at` and `attempt + 1`. Only tasks whose dependencies are `completed`, whose run is not paused, cancelled or past its deadline, and with attempts left are claimable.
- **Heartbeat** every `lease/3`; each heartbeat also reports cancel/pause/deadline, which the task observes at its next checkpoint (before every step, model call and tool call).
- **Fencing**: progress, tool-call budget, completion and failure writes all require `lease_token = <mine>`. A worker whose lease expired and was re-claimed cannot write anything, including tool calls (`LeaseLostError`).
- **Crash recovery**: an expired `running` lease is claimable by any worker; `sweepExpired` fails tasks that exhausted their attempts and runs past their deadline.
- **Idempotency**: every tool call has a stable key `<run>:<task>:<call>`. `ai_action.idempotency_key` is unique; a `succeeded` action replays its stored result instead of running again. Handlers are also idempotent against partial crashes (generation lookup by key, deterministic product handle `ai-<generation id>`, deployment `request_key`).
- **Retry**: transient model errors and unknown errors retry with a short backoff up to `max_attempts`; invalid model output, policy rejections and limits fail immediately. `POST …/tasks/:task_id/retry` re-queues a failed task with a fresh attempt budget.
- **Follow-up prompts** (`ai_prompt_queue`) are processed strictly by `sequence`, and only when no task of the run is queued or running. Each is routed (Haiku tier) to target tasks, which supersede the previous task of that key.
- **Cancel / pause / resume**: cancel marks queued tasks cancelled and stops running ones at the next checkpoint; pause stops at the next checkpoint without consuming an attempt; resume re-queues paused tasks.

### Worker hosting (D3)

- `src/jobs/amboras-worker.ts`: Medusa scheduled job (every 2 s, no overlap) in `shared`/`worker` mode; disable with `AI_WORKER_AUTOSTART=false`.
- `npm run ai:worker` (`medusa exec ./src/scripts/ai-worker.ts`): dedicated worker process. Any number of copies may run; leases make it safe.
- Storefront preview deployments use the same lease/fencing pattern (`src/storefront/deployments.ts`). The `storefront.deployment.queued` subscriber is only a fast trigger into the same leased path; `drainDeployments` recovers crashed builds.

## Tool gate (`src/ai/tools.ts`)

Every call, in order: tenant selector scan on raw args → strict input schema → automatic risk ≤ `AI_MAX_AUTO_RISK` (≤ 1) → merchant permission → per-task tool-call budget (lease-fenced) → `ai_action` row (tool, risk, input hash, actor with user/provider/model/run/task) → handler → `succeeded`/`failed` with result or error.

Merchant-trust rules enforced in handlers:

- Product drafts are Medusa `draft` products with `manage_inventory: false`, claimed by the StoreEnvironment, provenance in `metadata.ai` and an `ai_generation` row. Prices are set only when `priceStatedByMerchant` finds that exact amount in the merchant's own text; stock is never set. Store API routes only return published products.
- Images: only the store's own `MediaAsset` (ownership-checked `media_file`) onto the store's own AI draft.
- Theme: a palette that fails the storefront-schema v2 contrast rules is replaced by the validated platform colours (`theme_source: platform_default`).
- Offers are stored as suggestions only; no promotion is created.

## Merchant API (D5)

All routes require a merchant bearer token; other stores' ids return 404.

| Method | Route | Permission |
|---|---|---|
| POST | `/merchant/media` (JSON base64 photo) | `media:write` |
| GET | `/merchant/media` | `ai:read` |
| POST / GET | `/merchant/ai/runs` | `ai:generate` / `ai:read` |
| GET | `/merchant/ai/runs/:id` | `ai:read` |
| GET | `/merchant/ai/runs/:id/events` (SSE `run`, `end`) | `ai:read` |
| GET | `/merchant/ai/runs/:id/generations` | `ai:read` |
| POST | `/merchant/ai/runs/:id/prompts` | `ai:generate` |
| POST | `/merchant/ai/runs/:id/{cancel,pause,resume}` | `ai:generate` |
| POST | `/merchant/ai/runs/:id/tasks/:task_id/retry` | `ai:generate` |

Run summaries expose status, progress, steps, attempts and a stable `error_code` (`model_unavailable`, `model_output_rejected`, `policy_rejected`, `limit_reached`, `internal`); raw errors, lease data and tenant ids are never returned.

Photo uploads: JPEG/PNG/WebP only, size ≤ `AI_MAX_UPLOAD_BYTES`, file signature must match the declared type, stored under `<store_environment_id>/<uuid>.<ext>` (the original filename is never part of the key).

## Models (D1, B1)

| Variable | Default | Notes |
|---|---|---|
| `AI_MODEL_PROVIDER` | `fake` | `anthropic` enables the real provider (`ANTHROPIC_API_KEY`, never committed) |
| `AI_GENERATION_MODEL` | `claude-sonnet-5` | verified against Anthropic's models overview on 2026-09-14 |
| `AI_EXTRACTION_MODEL` | `claude-haiku-4-5` | retirement not sooner than 2026-10-15, keep configurable |
| `AI_MAX_OUTPUT_TOKENS` | `8000` | |

The Anthropic provider uses structured outputs (`messages.parse` + `zodOutputFormat`), re-validates the parsed output, treats `refusal` and `max_tokens` stops as rejected output, and maps rate-limit/5xx/connection errors to retryable errors. The fake provider is deterministic and used by every automated suite; `npm run test:ai:live` (M2-T15) is the opt-in real-provider smoke required before acceptance.

Prompts (`src/ai/prompts.ts`) require concise Bulgarian, forbid invented prices, stock, origins, claims and promises, and put merchant text in an escaped `<merchant_data>` block that is declared data, not instructions.

## Limits (D8)

| Variable | Default |
|---|---|
| `AI_MAX_ACTIVE_RUNS_PER_STORE` | 1 |
| `AI_MAX_RUNS_PER_STORE_PER_DAY` | 5 |
| `AI_MAX_RUN_DURATION_MS` | 900000 (15 min) |
| `AI_MAX_TOKENS_PER_RUN` | 200000 |
| `AI_MAX_MODEL_CALLS_PER_RUN` | 20 |
| `AI_MAX_TOOL_CALLS_PER_TASK` | 30 |
| `AI_MAX_TASK_ATTEMPTS` | 3 |
| `AI_MAX_PRODUCT_DRAFTS` | 12 |
| `AI_MAX_PROMPT_CHARS` | 4000 |
| `AI_MAX_FOLLOWUPS_PER_RUN` | 5 |
| `AI_MAX_MEDIA_PER_RUN` | 12 |
| `AI_MAX_UPLOAD_BYTES` | 5242880 |
| `AI_MAX_AUTO_RISK` | 1 |

Run-level limits are captured on the run when it starts. Worker tuning: `AI_WORKER_LEASE_MS` (60000), `AI_WORKER_HEARTBEAT_MS` (lease/3), `AI_WORKER_CONCURRENCY` (3), `AI_WORKER_DRAIN_BUDGET_MS` (55000).

## Data

`ai_run`, `ai_task`, `ai_prompt_queue`, `ai_action`, `ai_generation`, `ai_business_profile`, `ai_media_asset` — every row carries `store_environment_id`. Uploaded files are `media_file` resources in the tenancy ownership registry.

## Tests

`integration-tests/http/m2-durable-generation.spec.ts` (M2-T01…T10, T12…T14, including a real `medusa exec` worker killed mid-run), `integration-tests/e2e/m2-generation-e2e.spec.ts` (M2-T11), `src/ai/__tests__/ai-contracts.unit.spec.ts`, `integration-tests/live/m2-anthropic-smoke.spec.ts` (M2-T15, opt-in). `npm run test:m2` runs every deterministic suite.
