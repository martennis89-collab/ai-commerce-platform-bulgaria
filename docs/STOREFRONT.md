# Storefront Projects

Status: implemented in M1 (`mission/m1-storefront-project`), hardened after the independent M1 review.
Normative sources: `SCOPE_LEVEL_3_LOCKED.md` §2–§4, ADR-006, ADR-007, ADR-016, ADR-017, ADR-018, ADR-019. Tenancy rules are in `docs/TENANCY.md`.

## 1. Model

| Entity | Where | Key fields | Rules |
|---|---|---|---|
| `StoreEnvironment` | `tenancy` module (M0) | `handle`, live `hostname`, `status` | The tenant trust boundary. |
| `StorefrontProject` | `storefront` module | `store_environment_id` (unique), `handle` (unique), `core_version`, `deployment_provider`, `repository_ref`, `publishable_api_key_id`, `preview_hostname` / `live_hostname` (unique), `config` (draft), `active_theme`, `status` | Exactly one project per environment. It is pinned to a `storefront-core` version. |
| `Deployment` | `storefront` module | `project`, `store_environment_id`, `target` (`preview`/`live`), `status`, `provider`, `core_version`, `hostname`, `manifest` snapshot, `artifact_ref`, `url`, `error` | Status runs `queued → building → ready | failed | superseded`. Only the **newest** ready deployment of a project and target stays ready, even when an older deployment finishes later. |

## 2. Creation flow

`platform-create-store-environment` (`src/workflows/storefront/create-store-environment.ts`) is a trusted workflow. The operator reaches it via `POST /admin/platform/store-environments`; M2 generation will reach it too. Every step that creates a record compensates, so a failure at any position leaves nothing behind. That includes losing a uniqueness race against a concurrent request.

1. **Validate.** The handle is 3–40 characters (`[a-z0-9-]`, no `--`, not reserved), and the name is 1–80 characters. Both the handle and the derived live and preview hostnames must be unused by any environment or project. The owner user must exist.
2. **Organization.** Created in its own step.
3. **StoreEnvironment.** Live hostname `<handle>.<platform-domain>`. The database unique indexes on handle and hostname are the authority under concurrency.
4. **Commerce bindings.** Create the sales channel and the publishable key, and link them. Create the stock location and link it to the channel. The publishable-key step revokes, then deletes, on rollback: Medusa's own step cannot delete an unrevoked key.
5. **Ownership.** Claim the sales channel, key and stock location for the environment (M0 registry).
6. **Project.** Create the `StorefrontProject` with the default validated config, the pinned core version and both hostnames.
7. **Membership.** Add the owner membership when an owner is given. The unique index on user is the authority.
8. **First deployment.** Queue a preview deployment and emit `storefront.deployment.queued`.

## 3. Deployment manifest

The manifest is built server-side by `buildDeploymentManifest`, and is the **only** input a build receives. Its fields:
- `manifest_version`, `deployment_id`, `project_id`, `store_handle`, `target`, `hostname`
- `core_version`, `backend_url`, `publishable_key`, `config`

It fails closed unless every one of these holds:
- deployment, project and environment agree;
- the environment is active and the project is active;
- the deployment hostname equals the project's hostname for its target;
- the project's publishable key resolves, through the M0 storefront resolver, to **this** environment, with all its sales channels owned by it;
- the config passes the strict `storefront-schema`, which rejects unknown keys, so tenant selectors cannot be injected;
- the pinned `core_version` is available.

A manifest therefore carries exactly one publishable key, and it belongs to the project's environment. The validated manifest is snapshotted on the `Deployment` row. The key is a public storefront identifier, not a secret.

## 4. Providers (ADR-017)

| Provider | Behaviour |
|---|---|
| `dry-run` | Validates and records the manifest. No build. Used by the fast integration suite. |
| `local` | Materialises `builds/<deployment_id>/`: the core template, the single manifest, and a junction to `storefront-core`'s own dependencies. It then runs `next build` as a static export into `out/`. |

The local build child process receives an **allow-list** of OS variables plus `NODE_ENV`, `NEXT_TELEMETRY_DISABLED` and `STOREFRONT_TURBOPACK_ROOT`. Database URLs, JWT and cookie secrets and all other backend configuration are never passed.

The production hosting provider is still open. Any real provider must implement `StorefrontDeployProvider` and preserve the manifest contract.

Selection is by `STOREFRONT_DEPLOY_PROVIDER` (`local` by default), recorded per project and per deployment. Related settings:
- `STOREFRONT_DEPLOY_ROOT`, `STOREFRONT_BACKEND_URL`, `PLATFORM_BASE_DOMAIN` (default `localhost`);
- `PREVIEW_GATEWAY_PORT` (default `8787`) and `PREVIEW_GATEWAY_HOST` (default `127.0.0.1`).

## 5. Preview URLs and the gateway

- **Hostnames (ADR-018).** Preview is `<handle>.preview.<platform-domain>`, live is `<handle>.<platform-domain>`. They are always distinct because handles contain no dots, and `preview` is a reserved handle.
- **Route resolution.** `resolvePreviewRoute(container, host)` requires all of:
  - an exact normalised `preview_hostname` match;
  - an active project in an active environment;
  - the project's publishable key not revoked;
  - the newest ready preview deployment, with matching hostname and environment.

  It resolves from the database on every request, so suspension, key revocation or a new deployment takes effect immediately.
- **Serving.** `createPreviewGateway` is a static file server over per-deployment artifact directories:
  - it allows only `GET`/`HEAD`;
  - containment is checked on **real paths**, so symlinks or junctions inside an artifact, or an artifact directory resolving outside the deploy root, are never served;
  - encoded traversal is blocked;
  - missing paths fall back to the artifact's own `404.html`.

  It contains no storefront code, so it is deployment infrastructure (like a CDN), **not** a multi-tenant storefront runtime.
- **Live hostnames** are not served in M1. Publishing to live comes in a later milestone.

### Running the local preview gateway
```bash
cd platform && npm run build:packages
cd apps/backend
npm run dev                 # backend; STOREFRONT_DEPLOY_PROVIDER=local (default)
npm run preview:gateway     # serves ready previews on http://<handle>.preview.localhost:8787/
```
`preview:gateway` runs `src/scripts/preview-gateway.ts` through `medusa exec`, which calls `startPreviewGateway`. Preview URLs stored on deployments use the same `PREVIEW_GATEWAY_PORT`. Browsers resolve `*.localhost` to the loopback address.

## 6. storefront-core and storefront-schema

- `@platform/storefront-schema`: a strict zod config (`schema_version`, store name, `bg-BG`, `eur`, theme preset). It is the base for schema-first editing (ADR-007).
- `@platform/storefront-core` (versioned; `0.1.0` in M1):
  - the manifest contract (`validateDeploymentManifest`) and `materializeBuild`;
  - a Next.js App Router JSX template (ADR-016). It renders a mobile-first `lang="bg"` shell with the store name and a catalogue read at build time through `@medusajs/js-sdk`, using the manifest's publishable key. It exposes `platform-deployment` and `storefront-core-version` meta tags.
- `apps/storefront`: a local harness that runs `next dev` for exactly **one** manifest and refuses zero or several. It is not a runtime for merchant stores (Level 3 §2).
- Monorepo (ADR-019): npm workspaces with `install-strategy=nested`. The backend keeps Medusa's React 18 tree, and `storefront-core` keeps Next 16 with React 19.

## 7. Merchant, operator and AI surfaces

| Surface | Route or tool | Rule |
|---|---|---|
| Operator | `POST /admin/platform/store-environments` | Strict body (`handle`, `name`, `organization_name?`, `owner_user_id?`); platform operators only (M0 `/admin` guard). |
| Operator | `POST /admin/platform/store-environments/:id/preview-deployments` | Redeploys that environment's preview. Full deployment errors are recorded on the `Deployment` row. |
| Merchant | `GET /merchant/storefront` | Returns the caller's own project and deployment summaries. A failed deployment shows only `"Deployment failed"`; build output, paths and backend URLs stay operator-side. |
| Merchant | `POST /merchant/storefront/preview-deployments` | The body must be `{}`. Project, environment, key and target are all server-derived; tenant selectors get 400. |
| Tool | `storefront.request_preview_deployment` (risk 1, `storefront:deploy`) | Takes no arguments. |

Permissions: `owner` has `storefront:read` and `storefront:deploy`; `staff` has `storefront:read`.

## 8. Known limitations

- **Deployment execution.** It runs from an in-process subscriber. The `queued → building` transition is not atomic, and a restart mid-build leaves a deployment in `building`. Durable, resumable execution arrives with M2 (`AgentRun`/`AgentTask`).
- **Build timing.** Local builds can run concurrently across projects. There is a 10-minute build timeout; logs go to `builds/<id>/build.log`.
- **Old artifacts.** Superseded artifacts are not garbage-collected yet.
- **Build-time catalogue.** The catalogue is read at build time, so catalogue changes need a redeploy until M4/M5 add dynamic reads.
- **Config coverage.** Only the store name, locale, currency and theme preset exist in config. Pages, sections and theme tokens arrive with M2/M3.
- **Harness environment.** The dev-only harness (`apps/storefront`) passes the developer's whole environment to `next dev`. Merchant builds always use the local provider's allow-list.
- **No rate limits.** Nothing limits how many redeploys a merchant can request yet (M11).
- **Millisecond ordering (review N-a).** "Newest ready deployment" uses Medusa ids, which are ULIDs and not monotonic within a single millisecond. Two redeploys of the same project in the same millisecond (the same tenant's own builds) may settle on either one. Order by `created_at` then id, or use a monotonic sequence, when durable runs land in M2.
- **Artifact path check (review N-c).** The gateway requires an artifact's real path to lie inside the deploy root, not to equal `builds/<deployment_id>/out`. `artifact_ref` is written only by the server; tighten this before any user-influenced artifact paths exist (M3 source editing).
- **Windows shutdown (review N-d).** Gateway shutdown on SIGINT/SIGTERM waits for keep-alive connections, and is untested on Windows.
