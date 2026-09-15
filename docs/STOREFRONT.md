# Storefront Projects

Status: implemented in M1 (`mission/m1-storefront-project`), hardened after the independent M1 review. M2 made deployment execution durable. M3 adds versioned revisions, the contextual designer, preview promotion and screenshots.
Normative sources: `SCOPE_LEVEL_3_LOCKED.md` §2–§4, ADR-006, ADR-007, ADR-016 to ADR-019, ADR-021, ADR-022 and `DESIGN.md` (M3 design space). Tenancy rules are in `docs/TENANCY.md`.

## 1. Model

| Entity | Where | Key fields | Rules |
|---|---|---|---|
| `StoreEnvironment` | `tenancy` module (M0) | `handle`, live `hostname`, `status` | The tenant trust boundary. |
| `StorefrontProject` | `storefront` module | `store_environment_id` (unique), `handle` (unique), `core_version`, `deployment_provider`, `repository_ref`, `publishable_api_key_id`, `preview_hostname` / `live_hostname` (unique), `config` (mirror of the head revision), `head_revision_id`, `preview_revision_id`, `revision_sequence`, `deployment_sequence`, `status` | Exactly one project per environment. It is pinned to a `storefront-core` version. |
| `StorefrontRevision` (M3) | `storefront` module | `project`, `store_environment_id`, `sequence` (unique per project), `parent_revision_id`, `state` (`draft` / `preview` / `published` / `superseded`), `config`, `author_type` (`system` / `merchant` / `ai`), `author_user_id`, `action_key` (unique), `designer_message_id`, `restored_from_revision_id`, `summary` | Append-only: a revision's config never changes. The newest ready preview deployment's revision is in `preview`. `published` is reserved for live publishing, which M3 does not do. |
| `Deployment` | `storefront` module | `project`, `store_environment_id`, `target` (`preview`/`live`), `status`, `provider`, `core_version`, `hostname`, `manifest` snapshot, `artifact_ref`, `url`, `error`, `sequence`, `revision_id`, `requested_by` | Status runs `queued → building → ready | failed | superseded`. Only the **newest** ready deployment of a project and target stays ready, decided by the monotonic `sequence`, even when an older deployment finishes later. |
| `StorefrontScreenshot` (M3) | `storefront` module | `store_environment_id`, `project_id`, `deployment_id`, `revision_id`, `viewport` (`mobile` 375×812 / `desktop` 1440×900), `file_id`, `url` | A PNG of one ready preview artifact, stored as a tenant-owned media file. |

## 2. Creation flow

`platform-create-store-environment` (`src/workflows/storefront/create-store-environment.ts`) is a trusted workflow. The operator reaches it via `POST /admin/platform/store-environments`. Every step that creates a record compensates, so a failure at any position leaves nothing behind. That includes losing a uniqueness race against a concurrent request.

1. **Validate.** The handle is 3–40 characters (`[a-z0-9-]`, no `--`, not reserved), and the name is 1–80 characters. Both the handle and the derived live and preview hostnames must be unused by any environment or project. The owner user must exist.
2. **Organization.** Created in its own step.
3. **StoreEnvironment.** Live hostname `<handle>.<platform-domain>`. The database unique indexes on handle and hostname are the authority under concurrency.
4. **Commerce bindings.** Create the sales channel and the publishable key, and link them. Create the stock location and link it to the channel. The publishable-key step revokes, then deletes, on rollback: Medusa's own step cannot delete an unrevoked key.
5. **Ownership.** Claim the sales channel, key and stock location for the environment (M0 registry).
6. **Project.** Create the `StorefrontProject` with the default validated config, the pinned core version and both hostnames.
7. **Membership.** Add the owner membership when an owner is given. The unique index on user is the authority.
8. **First deployment.** Queue preview deployment sequence 1 and emit `storefront.deployment.queued`.

Revision 1 (author `system`) is created on first use from the project's config, for new and pre-M3 projects alike.

## 3. Revisions (M3)

`src/storefront/revisions.ts` is the only writer:

- **`commitDraftRevision`** validates the config with `storefront-schema`, then under the project row lock:
  - appends a revision with sequence `n + 1`;
  - moves `head_revision_id`;
  - mirrors the config onto the project.
- **Optimistic concurrency.** The caller names the parent it edited. If the head has moved, the commit fails with `RevisionConflictError` (HTTP 409) and nothing is written.
- **Idempotency.** A commit with an `action_key` that already created a revision returns that revision. A replayed AI tool call never adds a second one.
- **Undo and restore** are ordinary commits whose config copies an earlier revision (`restored_from_revision_id`). History is never rewritten.
- **A restore always wins against an in-flight designer turn (D8).** Restore and undo cancel the store's designer turns inside their own commit, while holding the project row lock. A designer AI commit re-checks cancellation and its task lease under the same lock, immediately before inserting. Whichever takes the lock first:
  - the AI edit is refused because its run is already cancelled; or
  - it landed first, and the restore supersedes AI revisions of the turns it cancels instead of failing with 409.
- **A restore that loses to anything else is still a 409.** Examples are a merchant edit or a turn that already completed; that case cancels nothing.

## 4. Deployment manifest

The manifest is built server-side by `buildDeploymentManifest`, and is the **only** input a build receives. Its fields (manifest v2):
- `manifest_version`, `deployment_id`, `project_id`, `store_handle`, `target`, `hostname`
- `core_version`, `backend_url`, `publishable_key`
- `revision_id`, `media`, `config`

The config comes from the deployment's revision, or the head for pre-M3 deployments. `media` maps every media id the config references to its URL, resolved on the server.

It fails closed unless every one of these holds:
- deployment, project, revision and environment agree;
- the environment is active and the project is active;
- the deployment hostname equals the project's hostname for its target;
- the project's publishable key resolves, through the M0 storefront resolver, to **this** environment, with all its sales channels owned by it;
- every referenced photo is a `MediaAsset` whose `media_file` is owned by the same environment;
- the config passes the strict `storefront-schema`, which rejects unknown keys, so tenant selectors cannot be injected;
- the `media` map lists only ids the config references;
- the pinned `core_version` is available.

A manifest therefore carries exactly one publishable key, and it belongs to the project's environment. The validated manifest is snapshotted on the `Deployment` row. The key is a public storefront identifier, not a secret.

## 5. Providers (ADR-017)

| Provider | Behaviour |
|---|---|
| `dry-run` | Validates and records the manifest. No build. Used by the fast integration suites. |
| `local` | Materialises `builds/<deployment_id>/`: the core template, the single manifest, and a junction to `storefront-core`'s own dependencies. It then runs `next build` as a static export into `out/`. |

The local build child process receives an **allow-list** of OS variables plus `NODE_ENV`, `NEXT_TELEMETRY_DISABLED` and `STOREFRONT_TURBOPACK_ROOT`. Database URLs, JWT and cookie secrets and all other backend configuration are never passed.

The production hosting provider is still open. Any real provider must implement `StorefrontDeployProvider` and preserve the manifest contract.

Selection is by `STOREFRONT_DEPLOY_PROVIDER` (`local` by default), recorded per project and per deployment. Related settings:
- `STOREFRONT_DEPLOY_ROOT`, `STOREFRONT_BACKEND_URL`, `PLATFORM_BASE_DOMAIN` (default `localhost`);
- `PREVIEW_GATEWAY_PORT` (default `8787`) and `PREVIEW_GATEWAY_HOST` (default `127.0.0.1`).

## 6. Preview URLs and the gateway

- **Hostnames (ADR-018).** Preview is `<handle>.preview.<platform-domain>`, live is `<handle>.<platform-domain>`. They are always distinct because handles contain no dots, and `preview` is a reserved handle.
- **Route resolution.** `resolvePreviewRoute(container, host)` requires all of:
  - an exact normalised `preview_hostname` match;
  - an active project in an active environment;
  - the project's publishable key not revoked;
  - the newest ready preview deployment by `sequence`, with matching hostname and environment.

  It resolves from the database on every request, so suspension, key revocation or a new deployment takes effect immediately.
- **Serving.** `createPreviewGateway` is a static file server over per-deployment artifact directories:
  - it allows only `GET`/`HEAD`;
  - the artifact must be **exactly** `builds/<deployment_id>/out`, compared on real paths, so neither a stored `artifact_ref`, a junction or an alias can point at another deployment or outside the deploy root (review N-c, closed in M3);
  - symlinks or junctions inside an artifact are never followed out of it, and encoded traversal is blocked;
  - every response sends `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`;
  - missing paths fall back to the artifact's own `404.html`.

  It contains no storefront code, so it is deployment infrastructure (like a CDN), **not** a multi-tenant storefront runtime.
- **Live hostnames** are not served. M3 promotes drafts to preview only; live publishing with readiness checks comes in a later milestone.

### Running the local preview gateway
```bash
cd platform && npm run build:packages
cd apps/backend
npm run dev                 # backend; STOREFRONT_DEPLOY_PROVIDER=local (default)
npm run preview:gateway     # serves ready previews on http://<handle>.preview.localhost:8787/
```
`preview:gateway` runs `src/scripts/preview-gateway.ts` through `medusa exec`, which calls `startPreviewGateway`. Preview URLs stored on deployments use the same `PREVIEW_GATEWAY_PORT`. Browsers resolve `*.localhost` to the loopback address.

## 7. storefront-core and storefront-schema

- **`@platform/storefront-schema` (schema v3 since M3, `DESIGN.md` §4).** A strict zod config with `schema_version: 3`, store (name, `bg-BG`, `eur`), theme tokens and one home page. It is the base for schema-first editing (ADR-007).
  - **Theme.** `preset`, `typography` (`editorial` | `modern`), `corner` (`soft` | `square`) and six hex colours (`paper`, `ink`, `muted`, `accent`, `accent_ink`, `line`). Contrast is validated: ink/paper ≥ 7, muted/paper ≥ 4.5, accent_ink/accent ≥ 4.5, accent/paper ≥ 3.
  - **Home.** 2–8 sections from a fixed library, each with at most two variants:

    | Section | Variants |
    |---|---|
    | `hero` | `text`, `image` |
    | `highlights` | `list`, `columns` |
    | `product_grid` | `grid`, `compact` |
    | `image_banner` | `full`, `contained` |
    | `about` | `text`, `image` |
    | `faq` | `list`, `details` |

    `hero` is first and unique, and there is exactly one `product_grid`. All text is length-bounded plain text. Photos are owned media ids (`{ media_id }`), never URLs.
  - **Element ids.** `section:<id>`, `section:<id>/<field>` and `section:<id>/items/<n>/<field>` are derived from schema paths, never from merchant text. `resolveElement(config, id)` returns the section, field, Bulgarian label and current value, or `null` for malformed, unknown, stale or out-of-range ids.
  - **Upgrades.** `parseStorefrontConfig` upgrades v1 and v2 configs to v3.
- **`@platform/storefront-core`** is versioned: `0.1.0` in M1, `0.2.0` in M2, `0.3.0` in M3. It provides:
  - the manifest contract (`validateDeploymentManifest`, manifest v2) and `materializeBuild`;
  - **`StorefrontPage`**, one shared renderer (`template/components/StorefrontPage.jsx`) used both by every static build and by the admin's authenticated draft preview. It renders the section library with `data-amb-element` attributes and CSS scoped under `.amb-storefront`, and is themed only through validated tokens;
  - the Next.js App Router template (ADR-016). It reads the published catalogue at build time through `@medusajs/js-sdk` with the manifest's publishable key, and exposes `platform-deployment`, `platform-revision` and `storefront-core-version` meta tags;
  - **the preview bridge protocol** (`src/bridge.ts`). `readFrameMessage` and `readParentMessage` accept only messages from the exact expected origin and window, with strict payload shapes and schema element ids.
- **`apps/storefront`**: a local harness that runs `next dev` for exactly **one** manifest and refuses zero or several. It is not a runtime for merchant stores (Level 3 §2).
- **`apps/admin`** (M3, ADR-021): the Amboras merchant admin. See §8.
- **Monorepo (ADR-019).** npm workspaces with `install-strategy=nested`. The backend keeps Medusa's React 18 tree; `storefront-core` and `apps/admin` use Next 16 with React 19.

## 8. The contextual designer (M3)

- **Admin (`apps/admin`).** Next.js App Router. The merchant signs in with email and password; the bearer token is kept only in memory. The designer screen follows `DESIGN.md` §3.
- **Draft preview (M3-D1).** The admin renders the caller's own head revision with `StorefrontPage` inside a same-origin `/frame` page. Only the admin may frame `/frame`; every other admin page refuses framing. No request can ask for another store's draft, because the merchant API resolves the project from the server-built context.
- **Selection (M3-D6).**
  - Clicking or pressing Enter on a `data-amb-element` in the frame posts `{ type: "select", element_id }` to the parent over the checked bridge.
  - The parent sends the id to `POST /merchant/designer/selection`, which re-resolves it against the caller's current head. The chip shows the server's label.
  - When a message is sent, the server resolves the selection again and stores the result on the merchant message. The designer task re-resolves it against the head at execution time.
- **Turns.** `POST /merchant/designer/sessions/:id/messages` creates a merchant message, a queued assistant message and one `designer_edit` AgentRun. See `docs/AI_EXECUTION.md`.
- **Promotion (M3-D9).** `POST /merchant/designer/promote` requests a real per-project preview deployment of the head, or a named revision (risk 1). Nothing goes live.
- **Screenshots (M3-D7).** `POST /merchant/designer/screenshots` uses Playwright Chromium.
  - **Bounded capture.** A capture runs inside the request, so it is limited three ways:
    - a per-process browser cap (`STOREFRONT_SCREENSHOT_CONCURRENCY`, 1 or 2, default 1);
    - one capture per store across processes (a transaction advisory lock);
    - a deadline that closes the browser (`STOREFRONT_SCREENSHOT_TIMEOUT_MS`, default 60 s).
  - **Busy is 429.** A request that finds the cap or the store lock taken gets `429` with `reason: "busy"`, and is not queued. The slot and the lock are released after success, failure and timeout.
  - The page origin is the preview hostname, but every request for it is answered from `builds/<deployment_id>/out` on disk.
  - Only GETs for the store's own media (`/static/<store_environment_id>/…`) may reach the network; everything else is aborted.
  - Media and screenshot URLs come from Medusa's file provider. The local provider defaults to `http://localhost:9000/static`, so a deployment must configure the provider's URL to its public backend origin. Test backends on random ports therefore show broken thumbnails, while the stored files are still verified.

## 9. Merchant, operator and AI surfaces

| Surface | Route or tool | Rule |
|---|---|---|
| Operator | `POST /admin/platform/store-environments` | Strict body (`handle`, `name`, `organization_name?`, `owner_user_id?`); platform operators only (M0 `/admin` guard). |
| Operator | `POST /admin/platform/store-environments/:id/preview-deployments` | Redeploys that environment's preview. Full deployment errors are recorded on the `Deployment` row. |
| Merchant | `GET /merchant/storefront` | Returns the caller's own project and deployment summaries. A failed deployment shows only `"Deployment failed"`; build output, paths and backend URLs stay operator-side. |
| Merchant | `POST /merchant/storefront/preview-deployments` | The body must be `{}`. Project, environment, key and target are all server-derived; tenant selectors get 400. Rate limited (429). |
| Merchant (M3) | `GET /merchant/designer` | Head revision config, preview revision, revision summaries, owned media map, published products for draft rendering, preview deployments, screenshots, the active session. |
| Merchant (M3) | `POST /merchant/designer/selection`, `…/sessions`, `GET …/sessions/:id`, `GET …/sessions/:id/events` (SSE), `POST …/sessions/:id/messages` | Designer conversation. Foreign ids return 404. |
| Merchant (M3) | `POST /merchant/designer/undo`, `…/revisions/:id/restore`, `…/promote`, `…/screenshots` | Append-only undo/restore with `expected_head_revision_id`: 409 on a stale head, except for AI revisions of turns the restore cancels. Preview promotion. Screenshots (429 `busy` while a capture for the store or the process cap is taken). |
| Tool | `storefront.request_preview_deployment` (risk 1, `storefront:deploy`) | Takes no arguments. |
| AI tool (M2) | `storefront.update_home`, `brand.apply` | Commit revisions against the head. |
| AI tool (M3) | `theme.update_tokens`, `section.update_copy`, `section.reorder`, `section.set_variant`, `section.add`, `section.remove`, `section.attach_photo` (risk 0, `storefront:design`); `storefront.promote_preview` (risk 1, `storefront:deploy`) | One revision per call, idempotent by action key. Owned photos only. Rate limited. |

- **Permissions.**
  - `owner` has `storefront:read`, `storefront:deploy` and `storefront:design`.
  - `staff` has `storefront:read`: staff can view the designer but cannot edit, promote or capture.
- **Browser access.** The merchant API allows CORS only from `MERCHANT_CORS` origins (default `http://localhost:7001`), and without credentials. The admin signs in through Medusa's `/auth/user/emailpass`, so its origin must also be listed in `AUTH_CORS` (the development default includes `http://localhost:7001`).

### Rate limits (M3-D11)

Hourly limits per store environment, counted from the audited rows themselves. Exceeding one returns HTTP 429 with `retry_after_seconds`.

| Variable | Default | Counts |
|---|---|---|
| `DESIGNER_MAX_EDITS_PER_HOUR` | 120 | merchant and AI revisions |
| `DESIGNER_MAX_TURNS_PER_HOUR` | 60 | merchant messages |
| `STOREFRONT_MAX_PREVIEW_DEPLOYS_PER_HOUR` | 20 | preview deployments |
| `STOREFRONT_MAX_SCREENSHOTS_PER_HOUR` | 20 | screenshots |

## 10. Known limitations

- **Deployment execution (durable since M2).**
  - `queued → building` is an atomic Postgres lease claim with a fencing token; only the lease holder can mark a deployment `ready` or `failed`.
  - A build whose worker dies stays `building` until its 15-minute lease expires. Then any worker (`drainDeployments`) re-claims it, up to 3 attempts.
  - The subscriber only triggers the same leased path immediately.
- **Build timing.** Local builds can run concurrently across projects. There is a 10-minute build timeout; logs go to `builds/<id>/build.log`.
- **Old artifacts.** Superseded artifacts, and screenshots of superseded previews, are not garbage-collected yet.
- **Build-time catalogue.** The catalogue is read at build time, so catalogue changes need a redeploy until M4/M5 add dynamic reads.
- **Config coverage.** One home page with the fixed section library. Additional pages and controlled source editing are later milestones.
- **Harness environment.** The dev-only harness (`apps/storefront`) passes the developer's whole environment to `next dev`. Merchant builds always use the local provider's allow-list.
- **Rate limits are soft under exact concurrency.** Two requests at the boundary can both pass. Every counted action is still bounded and audited, and screenshot captures are additionally capped and locked (§8).
- **Undo and restore share the edit limit** (`DESIGNER_MAX_EDITS_PER_HOUR`) with AI edits. A store at the limit cannot undo until the window reopens. This is a known review note, not yet changed.
- **Draft rendering uses published products only.** The in-admin draft shows the same catalogue the build would; product drafts are M4.
- **Screenshots need a local build.** A `dry-run` deployment has no artifact to capture.
- **Windows shutdown (review N-d).** Gateway shutdown on SIGINT/SIGTERM waits for keep-alive connections, and is untested on Windows.
- **Resolved in M3.**
  - Millisecond ordering (N-a): replaced by the monotonic deployment `sequence`.
  - Artifact path check (N-c): exact `builds/<deployment_id>/out`.
  - Missing redeploy rate limits: per-store limits added.
