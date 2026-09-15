# M3 — Contextual AI store designer — STATE

## Status
**IMPLEMENTING (2026-09-15).** The user approved `DESIGN.md` and started implementation. `DESIGN.md` is canonical for M3 UI and schema choices. Model `claude-opus-5`, reasoning `high`.

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
- **Phase 0.** Playwright `^1.63.0` added to `@platform/backend` devDependencies (D7). Chromium download and launch smoke: see the next entry.

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
