---
name: durable-agent-review
description: "Use for Amboras M2 durable generation review: AI run orchestration, job tables, worker restarts, typed tools, idempotency, retries, cancellation, audit logs, fake models, and prompt-injection boundaries."
---

# Durable Agent Review

Use this for M2 and later AI generation infrastructure.

## Non-Negotiables

- The model must not write directly to the database, filesystem, Medusa, deployment system, or network.
- All model effects must go through typed, validated, server-side tools.
- StoreEnvironment must be established by the server, not the prompt.
- Tool calls must be idempotent or guarded by idempotency keys.
- Every state-changing tool call needs audit metadata.
- Draft product facts must remain drafts until explicitly accepted later.
- Prices, stock, legal claims, and product facts must not be invented.

## Durability Checks

Verify:

- A generation run survives backend/worker restart.
- Parallel tasks can complete independently.
- Failed tasks do not poison successful tasks.
- Retry does not duplicate products, deployments, images, logs, or run state.
- Cancel/pause prevents future work and is respected by workers.
- Older deployment/job completion cannot overwrite newer accepted state.
- The deterministic fake model makes tests stable.
- Real provider smoke test is separated from deterministic CI when credentials are unavailable.

## Adversarial Checks

Test prompt injection attempts that ask the model or tool layer to:

- Change tenant/store IDs.
- Publish drafts.
- Set prices or stock without merchant data.
- Read another merchant's resources.
- Exfiltrate secrets, env vars, logs, or internal IDs.
- Skip validation or call tools directly.

Report gaps as material when they affect tenant isolation, durability, or merchant trust.
