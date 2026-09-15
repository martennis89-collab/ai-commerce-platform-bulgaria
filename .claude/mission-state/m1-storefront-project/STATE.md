# M1 — StoreEnvironment + StorefrontProject shell — STATE

## Status
**ACCEPTED, MERGED AND TAGGED (2026-09-14).** Accepted by independent review (round 2, at `6ac1f68`), then merged into `main` as merge commit `e9e7d5e` via PR #2 and tagged `m1-accepted`. M2 has since been merged as `ea0a8f1` and tagged `m2-accepted`; M3 has not started.
- Branch: `mission/m1-storefront-project`, created from `main` @ `000e72a` (the M0 merge, tagged `m0-accepted`). Pushed; draft PR #2 into `main`.
- Model: `claude-opus-5`, high.

## Independent review
- **Round 1, at `3cad636`: MATERIAL_ISSUE.** The reviewer reproduced 119/56/4/6, and isolation held under every attack.
  - **M1-R1 (material).** No runnable preview gateway existed outside tests, so preview URLs were dead.
  - **Minor.** N1 orphan Organization on rollback or race; N2 gateway followed junctions; N3 an older deployment finishing later replaced a newer one; N4 a revoked key did not stop the preview; N5 raw build errors were visible to merchants.
- **Fixes (`6ac1f68`).**
  - R1: `startPreviewGateway`, `src/scripts/preview-gateway.ts` and `npm run preview:gateway`.
  - N1: organization rollback step plus hostname uniqueness validation.
  - N2: real-path containment in the gateway.
  - N3: the newest ready deployment wins.
  - N4: a revoked key stops the preview.
  - N5: merchants see a generic error.
- **Round 2, at `6ac1f68`: ACCEPTED, no material issues.**
  - The reviewer reproduced 123/61/4/6.
  - It ran `npm run preview:gateway` for real: the gateway bound to `127.0.0.1:8787`, served each store's real build, returned 404 for foreign, live, look-alike and traversal requests, and applied suspension immediately.
  - Forced failures at all 7 creation steps left zero rows behind.
  - All round-1 findings are closed.
- **Tracked minor notes from round 2** (non-blocking; see `docs/STOREFRONT.md` §8):
  - N-a: "newest ready" is by id, and Medusa ULIDs are not monotonic within one millisecond.
  - N-b: concurrent execution of the same deployment is possible (the documented non-atomic transition; M2 durable runs).
  - N-c: the artifact path is checked to be inside the deploy root, not to equal `builds/<deployment_id>/out`.
  - N-d: SIGINT/SIGTERM shutdown of the gateway is untested on Windows.
  - N-e: with duplicate Host headers, the first wins (no gain for the requester).
  - N-f: `::$DATA` serves the same file (no leak).
- The final docs-only commit records this verdict. The reviewed code is unchanged.

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
| Creation flow produces environment, project, deployment and a working preview URL; creation is atomic | Met (M1-T01a/b/c, M1-N1, M1-R1, E2E M1-T02, real gateway run by reviewer) |
| Two-store adversarial deployment and hostname tests pass | Met (M1-T03a–d, M1-T04/e/u, M1-T05/e/f, M1-N3/N4) |
| No shared multi-tenant storefront runtime | Met (M1-T07, gateway, gateway-hardening and harness unit tests) |
| M0 suites pass unchanged | Met (53/43/6) |
| Docs updated | Met: `docs/STOREFRONT.md` (new), `docs/TENANCY.md` §12, `ARCHITECTURE.md`, `DECISIONS.md` ADR-015 to ADR-019, `TESTS.json` |

## Final verified run (2026-09-14, `6ac1f68`; reproduced by the reviewer)
- Packages build: PASS. Typecheck: clean.
- Unit: 123/123 (53 M0 + 70 M1).
- Integration: 61/61 (43 M0 + 18 M1).
- E2E: 4/4 (real `next build` static exports served through the preview gateway).
- Baseline: 6/6.
- Total: 194 automated tests.

## Implementation
- **Packages.**
  - `packages/storefront-schema`: strict config.
  - `packages/storefront-core`: manifest contract, `materializeBuild`, Next.js JSX template.
  - `apps/storefront`: single-manifest harness.
- **Backend `storefront` module.** `StorefrontProject` and `Deployment`, with migration `Migration20260914071826`.
- **Creation workflow** `platform-create-store-environment`. Every creating step compensates; the publishable key is revoked, then deleted, on rollback.
- **Deployments.**
  - `src/storefront/manifest.ts`: fails closed on key/environment/hostname/config/core-version mismatch.
  - `src/storefront/deployments.ts` (the newest ready deployment wins) and `src/subscribers/storefront-deployment-queued.ts`.
  - `src/storefront/deploy/`: `dry-run`, `local` (allow-listed child environment), `gateway` (DB-resolved routes, real-path containment, revoked-key and suspension checks, `startPreviewGateway`).
  - `src/scripts/preview-gateway.ts` (`npm run preview:gateway`).
- **Access surfaces.**
  - Operator routes under `/admin/platform/store-environments`.
  - Merchant routes `/merchant/storefront` (generic deployment errors) and `/merchant/storefront/preview-deployments` (body must be `{}`).
  - `storefront:read` / `storefront:deploy` permissions and the `storefront.request_preview_deployment` tool.

## Discoveries
- **Publishable-key rollback.** Medusa's `createApiKeysStep` compensation calls `deleteApiKeys`, which refuses unrevoked keys, so rolled-back publishable keys survive. Fixed with a revoke-then-delete step (found by M1-T01b).
- **React version split.** Medusa backend packages require React 18.3 while Next 16 needs React 19. `install-strategy=nested` keeps the trees apart; root `node_modules` holds only the `@platform/*` links.
- **Static export.** Next 16 static export with build-time Store API reads through the M0 storefront guard works unchanged.
- **ULID ordering.** Medusa ids (`ulid` 2.4.0) are not monotonic within one millisecond (review N-a).

## Known limitations
See `docs/STOREFRONT.md` §8:
- in-process, non-atomic deployment execution (M2 durable runs);
- no artifact garbage collection;
- the catalogue is read at build time;
- minimal config;
- the harness environment;
- no rate limits;
- review notes N-a, N-c and N-d.

## Remaining
- None. PR #2 was merged into `main` as `e9e7d5e` and tagged `m1-accepted`.

## Blocker
None.

## Next intended action
None: M1 is closed. M2 ran on `mission/m2-durable-generation` and is merged (`ea0a8f1`) and tagged `m2-accepted`. Do not start M3.
