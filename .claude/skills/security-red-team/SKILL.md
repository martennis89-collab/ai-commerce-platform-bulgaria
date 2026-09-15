---
name: security-red-team
description: Use for independent adversarial review of Amboras code, pull requests, milestone branches, auth flows, tenancy, webhooks, deployments, AI jobs, media, and data boundaries.
---

# Security Red-Team

Use this skill when reviewing security-sensitive Amboras work. Assume the implementation is wrong until evidence proves otherwise.

## Scope

Prioritize material vulnerabilities over style:

- Cross-tenant access.
- Merchant/admin/storefront boundary failures.
- Authentication and authorization bypasses.
- ID guessing, query expansion, relation leakage, and response-shape leaks.
- Draft, unpublished, or internal data becoming visible.
- Webhook spoofing, replay, and confused-deputy flows.
- Deployment or preview path traversal.
- Media and uploaded-file isolation.
- AI prompt injection, unsafe tool calls, and direct model writes.
- Job retry/idempotency/cancellation failures that cross data boundaries.

## Method

- Read the canonical docs and relevant decision records first.
- Inspect implementation and tests independently.
- Do not assume existing tests are sufficient.
- Try to build an exploit path before proposing broad refactors.
- Prefer the smallest safe remediation that preserves the locked architecture.
- Add or request reproducible adversarial tests for every material finding.

## Findings Format

Lead with findings, ordered by severity:

- Severity.
- Affected path/file/route.
- Attack description.
- Evidence or reproduction.
- Likely root cause.
- Whether it invalidates the milestone acceptance claim.
- Smallest safe remediation.

If there are no material findings, say that clearly and list remaining residual risks.
