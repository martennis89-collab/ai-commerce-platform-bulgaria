# M3 — Contextual AI store designer — STATE

## Status
**IMPLEMENTED, TESTS PASS, DRAFT PR (2026-09-15).** M3-T01–T15 and T17 pass. M3-T16 (live designer smoke) is pending until the Anthropic key is rotated or the user waives it. Do not merge, tag or start M4. The user approved `DESIGN.md` and started implementation. `DESIGN.md` is canonical for M3 UI and schema choices. Model `claude-opus-5`, reasoning `high`.

## Implementation plan (phases, checkpoint-committed on this branch)
1. **Schema and renderer.**
   - `storefront-schema` v3:
     - one home page with 2–8 sections from `hero | highlights | product_grid | image_banner | about | faq`, each with ≤ 2 variants;
     - `hero` first, exactly one `product_grid`;
     - owned media referenced by `media_id` only;
     - v1 and v2 configs upgrade.
   - Element-id grammar (`section:<id>[/<field>|/items/<n>/<field>]`) and `resolveElement()` with Bulgarian labels.
   - `storefront-core` 0.3.0:
     - a shared `StorefrontPage` renderer with `data-amb-element` attributes;
     - CSS scoped under `.amb-storefront`;
     - manifest v2 carrying `revision_id` and a server-resolved owned `media` map;
     - the preview bridge protocol with exact origin/source checks.
2. **Revisions and deployment debt.**
   - `StorefrontRevision`: immutable, per-project monotonic sequence, `draft|preview|published|superseded`.
   - Project `head_revision_id` / `preview_revision_id`; `commitDraftRevision` with optimistic parent check, idempotent by action key.
   - Deployment `sequence` + `revision_id`; the newest ready deployment is chosen by sequence.
   - Gateway requires the artifact to equal `builds/<deployment_id>/out` and sends `frame-ancestors 'none'`.
   - Rate limits: edits, designer turns, preview deploys, screenshots.
3. **Designer.**
   - `DesignerSession`/`DesignerMessage` (ai module); a `designer_edit` run kind with a `designer` task through the M2 lease and tool gate.
   - Typed risk-0 tools: theme tokens, section copy, reorder, variant, add/remove, attach photo.
   - Risk-1 `storefront.promote_preview`.
   - Server selection re-resolution (D6).
   - Append-only undo/restore that cancels in-flight designer turns (D8).
   - Merchant API with an SSE stream and CORS for the admin origin.
   - D10 wording fix.
4. **Screenshots.** Playwright Chromium renders the ready preview artifact. Requests are routed only to the artifact and the store's own media, with no other network. PNG stored as tenant-owned media.
5. **`apps/admin`.** Next.js App Router, bearer token in memory. Designer screen per `DESIGN.md`, plus a same-origin draft frame rendering `StorefrontPage`.
6. **Tests.** Unit, integration `m3-designer.spec.ts`, e2e (promotion build, screenshot, UI at 375/1440 with Playwright), opt-in live designer smoke. Full M0–M2 regression.
7. **Wrap-up.** Docs (STOREFRONT, AI_EXECUTION, TENANCY §12, ARCHITECTURE, DECISIONS ADR-021), then reviews (tenant isolation, security red-team, durable agent), push, draft PR.

## Progress log
- **Phase 0.** Playwright `^1.63.0` added to `@platform/backend` devDependencies (D7). Chrome Headless Shell 153.0.8010.12 downloaded; headless screenshot smoke passed. No stop condition.
- **Phases 1–5 implemented; checkpoint commit `521c7cc`:**
  - storefront-schema v3 and storefront-core 0.3.0: shared renderer, manifest v2, bridge;
  - revisions, deployment sequence, gateway hardening and rate limits;
  - designer sessions, turns, tools, undo/restore, promotion, Playwright screenshots, merchant API with SSE and CORS;
  - `apps/admin` (next build passes).
  - Migrations: storefront `Migration20260915112327`, ai `Migration20260915112158`.
- **Environment note.** Docker Desktop had stopped mid-mission (ECONNREFUSED on 55432). It was restarted, `m0-medusa-postgres` was started, and migrations were regenerated.
- **Results so far:**
  - Unit: 218/218.
  - M3 integration (`m3-designer.spec.ts`): 12/12.
  - Backend and test typecheck: clean.
  - The M3-T07 first failure was a test race with the in-process deployment subscriber, fixed in the test.
- **D10.** The "product drafts are merchant-edited (M3)" wording now says M4 in `docs/AI_EXECUTION.md` and `src/ai/schemas.ts`.
- **Docs:**
  - STOREFRONT.md rewritten for M3;
  - AI_EXECUTION.md designer turns section;
  - TENANCY.md §12 M3 invariants;
  - ARCHITECTURE.md M3 section;
  - DECISIONS ADR-021 (admin stack) and ADR-022 (M3 designer);
  - DESIGN.md marked approved.
- **After checkpoint (uncommitted):**
  - **Durable-agent fix.** A retried designer turn reuses the plan its first attempt stored on the assistant message (`result.plan`). A fresh plan could otherwise skip or misapply a change, because tool calls replay by operation index. The terminal settle replaces `result` with `{changes}`, and the merchant API exposes only `changes`. Covered in M3-T03.
  - **M3 e2e: first diagnosis.** Every preview build failed with "Missing required pricing context … region_id". The spec lacked `createSharedRegion`, which M1 and M2 e2e already use; test fixture only.
  - **M3 e2e: second diagnosis.** Admin sign-in was blocked by CORS on `/auth/user/emailpass`. `medusaIntegrationTestRunner` loads `medusa-config` before it applies `env`, so the spec now sets `AUTH_CORS`/`MERCHANT_CORS` at module scope.
  - **Local dev CORS.** The same gap affected local development: the `authCors` default did not include the admin dev origin. `medusa-config.ts` now defaults to `http://localhost:9000,http://localhost:7001`, and STOREFRONT.md documents that `AUTH_CORS` must list the admin origin.
  - **Sign-in diagnostics.** A failing sign-in in the e2e now records console errors, failed requests, the page text and a screenshot.
  - **Live smoke spec.** Added the opt-in M3-T16 spec `integration-tests/live/m3-designer-smoke.spec.ts`. It skips without a key and has not been run.
  - **Latest results:** unit 218/218; M3 integration 12/12; typecheck clean.
- **Inline reviews (in progress).**
  - **Durable agent.** Plan reuse on retry fixed (above). Terminal settle is idempotent; cancel stops queued tasks and running turns at their checkpoint.
  - **Tenant isolation.** Every raw SQL statement in the new designer, turn, rate-limit, SSE and revision code is scoped by `store_environment_id` or by a server-resolved, environment-scoped id.
    - Defence in depth added: the session and message UPDATEs in `sendMessage` now also filter by `store_environment_id`.
    - `commitDraftRevision`'s action-key replay returns 404 for a foreign match.
    - `ensureHeadRevision` reads the head id from the locked, scoped project row.
  - **UI (visual evidence check, amboras-impeccable-ui).** Desktop at 1440px is correct. Real defects were found at 375px and fixed:
    - The Магазин/Разговор tablist took the whole `1fr` grid row and pushed the store frame off-screen. Phones now use rows `56px auto minmax(0, 1fr)`, with the canvas and rail in row 3.
    - The composer rendered in both the rail and the bottom sheet with the same `id`, so the sheet textarea had no accessible name. It is now `renderComposer(placement)` with unique ids.
    - The e2e focus assertion now tabs to an admin control before checking the ring. One Tab could land on the iframe.
    - At 375px the conversation view still laid out the hidden store frame. `.canvas` sets `display`, which overrode the `hidden` attribute, and the grid added an implicit column: the frame shrank to about 50px and the top bar shifted.
      - Fixed with an admin-wide `.amb-admin [hidden] { display: none !important }`. Only the two mobile views use `hidden`.
      - On phones, the canvas and rail also span `grid-column: 1 / -1`.
      - The e2e now asserts that the canvas is hidden and the rail is at x=0 with a 375px width. The old document scroll-width check missed this because the overflow sat inside the fixed-height shell.
  - **Final visual check (M3 e2e 4/4, commit `a6e4dd9`).**
    - Correct: mobile store, sheet and conversation views at 375px; desktop draft, thread, history drawer and promotion status at 1440px.
    - The "Отвори прегледа" link used the browser's default blue; it is now styled with the accent token.
    - The screenshot thumbnail appears broken in e2e only. Medusa's local file provider defaults file URLs to `http://localhost:9000/static`, while the test backend runs on a random port. The stored PNG itself is verified (size, ownership), and on a backend at port 9000 the image loads.
  - **Test isolation.** M3-T08 asserted a headline set by the desktop test, but the runner restores the database before each test. It now asserts that screenshots leave the draft unchanged: same head revision and headline before and after.
  - **Security (preview bridge).** Both directions of the admin bridge check the exact admin origin and exact source window: `Designer` accepts only the iframe's `contentWindow`, and `DraftFrame` only `window.parent`. Every `postMessage` targets `window.location.origin` and never `"*"`. Selections are still re-resolved by the server (D6), so a forged frame message cannot select another store's element.
- **Full regression, run 1 (after commit `9d704a3`).** Passing: typecheck, unit 218/218, integration M0 and M3, e2e 9/9 (M1, M2, M3), baseline 6/6. Six M1/M2 integration tests failed on behaviour that M3 changed by approval. Each test was updated and its invariant kept:
  - **M2-T01:** expected `core_version` 0.2.0; now 0.3.0 (storefront-core bump).
  - **M1-T04:** exact manifest keys; manifest v2 adds `media` (asserted `{}`) and `revision_id` (null or a srev id). The foreign-key and foreign-id scans are unchanged.
  - **M1-N3 and M2-T14:** rows were created without a `sequence`, so they ranked below the sequenced initial deployment (D11 `sequence DESC NULLS LAST`). The tests now allocate sequences the way `requestPreviewDeployment` does. The older-never-replaces-newer and stale-lease invariants are unchanged.
  - **M1-R1:** the gateway now serves only `builds/<deployment_id>/out` (D11), and dry-run records `dry-run/<id>`. The test places its artifact at the exact path.
  - **M1-T03c config injection (security):** builds now read the head revision's config, and `project.config` is only its mirror. The test tampers both after the head exists, and the deployment still fails closed with a config error, no artifact and no manifest.
  - **Migration `Migration20260915112327`:** now backfills legacy deployment sequences per project in creation order and sets `project.deployment_sequence` to the maximum. Note: a local development database that already applied the earlier version of this unmerged migration does not rerun it.
  - The baseline run rewrote `baseline-observations.json` with new generated ids only; it was restored with git.
- **Full regression, run 2 (after the test updates and migration backfill).** Integration: 4 suites, 90/90 (M0, M1, M2, M3). Together with run 1: typecheck clean, unit 218/218, e2e 9/9, baseline 6/6. The e2e and baseline runs came before the backfill was added. They migrate empty databases, where the backfill is a no-op.
- **Reviews done inline:** durable agent, tenant isolation, security (preview bridge), UI evidence. Findings and fixes are listed above.
- **Pushed and opened as a draft PR.** `mission/m3-contextual-designer` was pushed at `29ac65e`. Draft PR [#4](https://github.com/martennis89-collab/ai-commerce-platform-bulgaria/pull/4) targets `main`. No merge, no tag, no M4.
- **Remaining:**
  - Independent review of PR #4, then user acceptance.
  - Live smoke M3-T16: pending until the Anthropic key is rotated, unless the user waives it. It is the only open acceptance item.

## Previous status
**DESIGN.md DRAFTED, AWAITING USER APPROVAL (D16). No UI or product code yet.** Approved 2026-09-15.
- Branch: `mission/m3-contextual-designer`, created from `main` @ `a6a8768` (the skills docs commit, after `m2-accepted` and the `117110a` state closeout).
- Model: `claude-opus-5`, reasoning `high` (MODEL_ROUTING: architecture, tenancy, new UI trust boundary).
- The earlier untracked relay artifacts in this folder were moved to the Recycle Bin (D0). The relay never ran (its `Start-Process` failed), and no branch existed. The bypass-permissions relay is not used for M3.

## Required order (user instruction, 2026-09-15)
1. Clean the stale relay artifacts. **Done:** 27 files moved to the Recycle Bin.
2. Commit the skills setup as docs only. **Done:** `a6a8768` on `main`, pushed.
3. Create the M3 mission branch. **Done.**
4. Add `DESIGN.md` as the first M3 docs/design commit. **Done; awaiting approval.**
5. Implement M3, with UI only after `DESIGN.md` approval.
6. Open a draft PR only.
7. Do not merge, tag, or start M4.

**Stop for the user if:**
- a locked-document conflict appears;
- Playwright/Chromium setup fails;
- the live smoke is the only remaining blocker.

## User-approved decisions (2026-09-15)
- **D0.** Delete the stale relay artifacts and replace them with clean mission state. Do not use the bypass-permissions relay.
- **D1.** Fast edits use authenticated in-admin draft rendering. Promotion still creates a real per-project preview build.
- **D2.** Create `apps/admin` as the minimal merchant designer UI.
- **D3.** Next.js App Router, bearer token in memory, reusing `/merchant` auth. Record as an ADR.
- **D4.** Schema v3: one home page, 5–6 section types, up to two variants per section, owned media only.
- **D5.** New persistent `DesignerSession`/`DesignerMessage` records. Do not stretch the M2 PromptQueue into chat.
- **D6.** The server re-resolves preview selections against the caller's current draft.
- **D7.** Playwright is approved, including downloading headless Chromium for screenshots.
- **D8.** Undo is an append-only revision restore. A restore cancels in-flight designer turns for that project.
- **D9.** Promote draft to preview only. Nothing goes live.
- **D10.** Fix "product drafts are merchant-edited (M3)" to M4.
- **D11.** Include a monotonic deployment sequence, edit/redeploy/screenshot rate limits, and artifact path hardening.
- **D12.** Designer tools are risk 0. Promotion to preview is risk 1.
- **D13.** No live Anthropic smoke yet (the key is not rotated). Build deterministic fake-model coverage. The live smoke stays pending before final acceptance unless the user explicitly waives it.
- **D14.** Commit `.claude/skills/` and `docs/CLAUDE_SKILLS_SETUP.md` as a separate docs-only commit before M3 code. **Done.**
- **D15.** The product brand is Amboras. Fix non-locked docs that treat Amboras as external, without changing locked documents.
- **D16.** `DESIGN.md` is created and approved before UI implementation.

## D15 findings (reported to user)
Three documents describe Amboras as an external benchmark product:
- `SCOPE_LEVEL_1_LOCKED.md` heading "Amboras-like experience";
- `PROJECT_INSTRUCTIONS.md` "Amboras rule" ("re-check current Amboras behaviour or implementation … not unverified internals");
- `AMBORAS_BENCHMARK.md` ("not an authority for unverified internals", "current Amboras behaviour, repository structure").

Assessment:
- This is a naming inconsistency, not a product-scope conflict: the locked product intent is unchanged.
- Locked documents and the constitution are left unchanged.
- `AMBORAS_BENCHMARK.md` (non-locked) is reworded on the branch.
- **Open for the user:** if an external product named Amboras exists, sharing its name is a brand/legal question.

## Next intended action
Wait for the user's approval of `DESIGN.md`. Backend work (revisions, schema v3, designer sessions and tools, rate limits) may begin after approval together with the UI, unless the user says to start backend work earlier.
