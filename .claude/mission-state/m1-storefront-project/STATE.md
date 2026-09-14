# M1 — StoreEnvironment + StorefrontProject shell — STATE

## Status
**APPROVED, IMPLEMENTING** on `mission/m1-storefront-project`. The branch was created from `main` @ `000e72a` (the M0 merge, tagged `m0-accepted`).
- Model: `claude-opus-5`, high.
- Brief and decisions were approved by the user on 2026-09-14.

## Approved decisions
- **D1 (ADR-017).** Deployments go through a provider abstraction. The first adapter is local and credential-free, serving per-deployment build artifacts on `*.preview.localhost`. The production provider stays open.
- **D2 (ADR-016).** `storefront-core` uses Next.js (App Router) with the Medusa JS SDK. Versions at start: next 16.3.5, react 19.3.0, @medusajs/js-sdk 2.21.0.
- **D3 (ADR-018).** Live hostname `<handle>.<platform-domain>`, preview hostname `<handle>.preview.<platform-domain>`. The domain is a placeholder (`PLATFORM_BASE_DOMAIN`, default `localhost`).
- **D4 (ADR-019).** npm workspaces at `platform/` (`apps/*`, `packages/*`), with no build orchestrator.

## Objective
A trusted server flow that:
- creates a `StoreEnvironment` with its Medusa bindings (sales channel, publishable key, stock location, all ownership-claimed);
- creates an independent `StorefrontProject` pinned to a versioned `storefront-core`;
- deploys a preview through the provider abstraction;
- serves a preview URL that renders only that environment's shell.

## Implementation plan (phases, each with a checkpoint commit)
1. **Workspace conversion.** `platform/package.json` workspaces and a single install. Gate: the M0 suites stay green.
2. **Packages.**
   - `packages/storefront-schema`: strict zod config (store name, `bg-BG`, `eur`, theme preset).
   - `packages/storefront-core`: version, strict deployment-manifest validation, materialisation helper, and a Next.js JSX template (static export, build-time Store API fetch using the manifest's single publishable key).
   - `apps/storefront`: single-manifest local harness only.
3. **Backend.**
   - `src/modules/storefront`: `StorefrontProject` (unique environment, handle, preview and live hostnames; pinned core version; publishable key id; draft config) and `Deployment` (preview/live target, status lifecycle, manifest snapshot, artifact, error).
   - Workflow `platform-create-store-environment`, with compensation.
   - Request-preview-deployment flow, a subscriber that executes deployments, and a manifest builder that fails closed on key/environment mismatch.
   - Providers: `dry-run` (records the manifest) and `local` (next build with an allow-listed child environment and no backend secrets).
   - Preview routes table derived from the database, and a host-routed static preview gateway (exact normalised host, path-traversal safe).
   - Routes: operator `POST /admin/platform/store-environments` and `.../:id/preview-deployments`; merchant `GET /merchant/storefront` and `POST /merchant/storefront/preview-deployments` (strict empty body); tool `storefront.request_preview_deployment`.
4. **Tests.**
   - Unit: handle/hostname rules, schema, manifest, child environment, gateway.
   - Integration (dry-run): creation, atomic compensation, adversarial redeploy/tamper, hostnames, suspension.
   - E2E (local provider, real Next builds, gateway): Maria and Petya previews render only their own content.
   - The M0 regression gate.
5. **Docs and review.**
   - `docs/STOREFRONT.md` (new).
   - `docs/TENANCY.md` §12 items moved to proven.
   - `ARCHITECTURE.md` M1 notes.
   - `TESTS.json`.
   - Independent review recommended before merge.

## Completed
- M1 branch, brief, and decisions (commit `94d35bb`); ADR-015 to ADR-019 added to DECISIONS.md.
- **Phase 1.** `platform/` npm workspaces with `install-strategy=nested`:
  - backend keeps React 18.3.1 and Medusa 2.21;
  - `storefront-core` has Next 16.3.5 and React 19.3.0;
  - root `node_modules` holds only the `@platform/*` links.
- **Phase 2.** Built `storefront-schema` and `storefront-core` (manifest, materialisation, JSX template), plus the harness.
- **Phase 3.**
  - `storefront` module and migration.
  - Creation workflow, deployment service, subscriber, manifest builder.
  - `dry-run` and `local` providers, preview gateway.
  - Operator and merchant routes, permissions, tool.
  - Backend typecheck clean.
- **Phase 4 (written, not yet run):**
  - Unit: `src/storefront/__tests__` (3 files).
  - Integration: `integration-tests/http/m1-storefront-project.spec.ts`.
  - E2E: `integration-tests/e2e/m1-preview-e2e.spec.ts`.
- **M0 regression gate after workspace conversion:** running.

## Discoveries
- **Publishable-key rollback.** Medusa's `createApiKeysStep` compensates with `deleteApiKeys`, but the API key module refuses to delete unrevoked keys. A rolled-back publishable key therefore survives. The creation workflow uses its own step that revokes, then deletes (found by M1-T01b).
- **Nested install layout.** `install-strategy=nested` gives each workspace its own dependency tree. Root `node_modules` holds only the `@platform/*` links, which both the backend and `storefront-core` resolve by walking up.
- **Gate results.** After the workspace conversion: M0 unit 53/53, integration 43/43, baseline 6/6. M1 unit 63/63.
- `@medusajs/ui` and `@medusajs/dashboard` require React 18.3, and `@medusajs/medusa` has a peer dependency on react-dom ^18.3.1. Next 16 needs React 19, so workspace hoisting must be controlled.

## Remaining
Phases 1–5.

## Blocker
None.

## Next action
Phase 1: workspace conversion.
