# M1 — StoreEnvironment + StorefrontProject shell — STATE

## Status
**Implementation complete; acceptance criteria met by automated tests. Pending independent M1 review.**
- Branch: `mission/m1-storefront-project`, created from `main` @ `000e72a` (the M0 merge, tagged `m0-accepted`). Local only; not pushed.
- Model: `claude-opus-5`, high.

## Approved decisions
- **D1 (ADR-017).** Deployments go through a provider abstraction. The first adapter is local and credential-free; the production provider stays open.
- **D2 (ADR-016).** `storefront-core` uses Next.js (App Router) with the Medusa JS SDK: next 16.3.5, react 19.3.0, @medusajs/js-sdk 2.21.0.
- **D3 (ADR-018).** Live hostname `<handle>.<platform-domain>`, preview hostname `<handle>.preview.<platform-domain>`. The domain is a placeholder (`PLATFORM_BASE_DOMAIN`).
- **D4 (ADR-019).** npm workspaces at `platform/` with `install-strategy=nested`.

## Objective
A trusted server flow that:
- creates a `StoreEnvironment` with owned Medusa bindings;
- creates an independent, version-pinned `StorefrontProject`;
- deploys a preview through the provider abstraction;
- serves a preview URL that renders only that environment's shell.

## Acceptance criteria
| Criterion | Result |
|---|---|
| Creation flow produces environment, project, deployment and preview URL | Met (M1-T01a, E2E M1-T02) |
| Two-store adversarial deployment and hostname tests pass | Met (M1-T03a–d, M1-T04/e/u, M1-T05/e/f) |
| No shared multi-tenant storefront runtime | Met (M1-T07, gateway and harness unit tests) |
| M0 suites pass unchanged | Met (53/43/6) |
| Docs updated | Met: `docs/STOREFRONT.md` (new), `docs/TENANCY.md` §12, `ARCHITECTURE.md`, `DECISIONS.md` ADR-015 to ADR-019, `TESTS.json` |

## Final verified run (2026-09-14)
- Packages build: PASS. Typecheck: clean.
- Unit: 119/119 (53 M0 + 66 M1).
- Integration: 56/56 (43 M0 + 13 M1).
- E2E: 4/4 (real `next build` static exports served through the preview gateway).
- Baseline: 6/6.
- Total: 185 automated tests.

## Implementation
- **Packages.**
  - `packages/storefront-schema`: strict config.
  - `packages/storefront-core`: manifest contract, `materializeBuild`, Next.js JSX template.
  - `apps/storefront`: single-manifest harness.
- **Backend `storefront` module.** `StorefrontProject` and `Deployment`, with migration `Migration20260914071826`.
- **Creation workflow** `platform-create-store-environment`. Compensating; the publishable key is revoked, then deleted, on rollback.
- **Deployments.**
  - `src/storefront/manifest.ts`: fails closed on key/environment/hostname/config/core-version mismatch.
  - `src/storefront/deployments.ts` and `src/subscribers/storefront-deployment-queued.ts`.
  - `src/storefront/deploy/`: `dry-run`, `local` (allow-listed child environment), DB-resolved `gateway`.
- **Access surfaces.**
  - Operator routes under `/admin/platform/store-environments`.
  - Merchant routes `/merchant/storefront` and `/merchant/storefront/preview-deployments` (body must be `{}`).
  - `storefront:read` / `storefront:deploy` permissions and the `storefront.request_preview_deployment` tool.

## Discoveries
- **Publishable-key rollback.** Medusa's `createApiKeysStep` compensation calls `deleteApiKeys`, which refuses unrevoked keys, so rolled-back publishable keys survive. Fixed with a revoke-then-delete step (found by M1-T01b).
- **React version split.** Medusa backend packages require React 18.3 while Next 16 needs React 19. `install-strategy=nested` keeps the trees apart; root `node_modules` holds only the `@platform/*` links.
- **Static export.** Next 16 static export with build-time Store API reads through the M0 storefront guard works unchanged. The preview gateway resolves routes from the database per request, so suspension takes effect immediately.

## Known limitations
See `docs/STOREFRONT.md` §8:
- in-process deployment execution, with a non-atomic `queued → building` transition (durable runs arrive in M2);
- no artifact garbage collection;
- the catalogue is read at build time;
- minimal config.

## Remaining
- Independent M1 review (recommended, as for M0).
- Push the branch, open a PR, merge and tag: user decision.

## Blocker
None.

## Next intended action
Report M1 completion; do not start M2.
