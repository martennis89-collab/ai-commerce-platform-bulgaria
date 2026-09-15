# Amboras Design

Status: **DRAFT for user approval (M3 decision D16).** No UI implementation starts until this document is approved. After approval, it is the design contract for:

- **the Amboras merchant admin**, starting with the M3 designer in `apps/admin`;
- **the merchant storefront design space**: what a merchant or the AI may change in a storefront through `storefront-schema` v3.

This document is not a LOCKED document. It changes through an explicit, approved update, recorded in `DECISIONS.md` when the change is material. When it conflicts with `SCOPE_LEVEL_1–3_LOCKED.md` or `LEVEL_4_LOCKED.md`, the locked documents win.

---

## 1. Direction

**The merchant's store is the canvas. Amboras is the quiet, precise frame around it.**

Every admin screen puts the merchant's own storefront, products or orders at the centre. The Amboras frame is calm and dense enough for daily work. It never competes with the merchant's colours, photos or words. This is the single strong idea; everything below serves it.

Amboras should feel:

- premium but practical, trustworthy with a real shop;
- Bulgarian and local through language and merchant usefulness, never through folklore motifs or decoration;
- quick to read for a tired owner on a phone at the end of the day;
- distinct from a generic SaaS dashboard, a Shopify clone, or an AI landing page.

Litmus test for any screen:

1. Can the merchant tell in two seconds what they are looking at and what to do next?
2. Is the merchant's content more prominent than Amboras chrome?
3. Would removing a decorative element lose information? If not, remove it.

## 2. Admin foundations

### 2.1 Colour tokens

Colours are CSS custom properties. Components use tokens, never raw hex values. The ratios below were computed with the WCAG 2.x formula on 2026-09-15.

| Token | Value | Use |
|---|---|---|
| `--amb-canvas` | `#f6f5f1` | App background behind panels. |
| `--amb-surface` | `#ffffff` | Panels, rails, inputs, sheets. |
| `--amb-sunken` | `#efeee9` | Wells: message bubbles from Amboras, code of an element path, disabled fields. |
| `--amb-ink` | `#17191c` | Primary text and icons. |
| `--amb-muted` | `#545a63` | Secondary text, metadata, timestamps. |
| `--amb-subtle` | `#6b7078` | Tertiary text on `--amb-surface` only (placeholders, counters). |
| `--amb-line` | `#e1e0da` | Decorative dividers only, never the only boundary of a control. |
| `--amb-line-strong` | `#858880` | Input borders, control outlines, meaningful separators. |
| `--amb-accent` | `#24594a` | The one brand colour: primary action, focus, links, active state, AI activity. |
| `--amb-accent-hover` | `#1c4a3d` | Hover and pressed state of accent surfaces. |
| `--amb-accent-ink` | `#ffffff` | Text and icons on accent surfaces. |
| `--amb-accent-soft` | `#e4eee9` | Selected list row, current revision, selected-element chip. |
| `--amb-success` | `#1f7a4d` | "Ready", "Applied". |
| `--amb-warning` | `#8a5a00` | "Needs attention", rate limits. |
| `--amb-warning-soft` | `#fbf1dc` | Warning banner background. |
| `--amb-danger` | `#b3261e` | Failures, destructive confirmation. |
| `--amb-danger-soft` | `#fbe9e7` | Error banner background. |
| `--amb-info` | `#245b9e` | Neutral system notices (rare). |

Verified contrast:

| Pair | Ratio | Requirement |
|---|---|---|
| ink on canvas / surface / sunken | 16.15 / 17.61 / 15.16 | ≥ 7 |
| muted on canvas / surface / sunken | 6.37 / 6.95 / 5.99 | ≥ 4.5 |
| subtle on surface | 4.98 | ≥ 4.5 |
| accent-ink on accent / accent-hover | 8.07 / 10.02 | ≥ 4.5 |
| accent on surface / canvas / accent-soft | 8.07 / 7.40 / 6.80 | ≥ 4.5 |
| ink on accent-soft | 14.85 | ≥ 7 |
| success / warning / danger / info on surface | 5.32 / 5.93 / 6.54 / 6.85 | ≥ 4.5 |
| warning on warning-soft, danger on danger-soft | 5.28 / 5.58 | ≥ 4.5 |
| line-strong on surface / canvas / sunken | 3.60 / 3.30 / 3.10 | ≥ 3 (UI boundaries) |

Colour rules:

- Accent is the only brand colour. Status colours appear only when they carry a status.
- Never signal state by colour alone. Pair it with text or an icon.
- The merchant's storefront colours never leak into Amboras chrome, and Amboras accent never leaks into the storefront preview.
- No gradients, gradient text, glass, blur, blobs, bokeh or decorative background grids.

### 2.2 Typography

No web font downloads. System stacks keep the admin fast on Bulgarian mobile networks and render Cyrillic well.

- Sans (all admin text): `system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif`.
- Mono (element paths, revision ids, only where exact text matters): `ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace`.
- Numbers in counters, prices and timestamps use `font-variant-numeric: tabular-nums`.

| Role | Size / line-height | Weight |
|---|---|---|
| Screen title | 1.375rem / 1.3 | 600 |
| Section title | 1.125rem / 1.35 | 600 |
| Body, inputs, buttons | 1rem / 1.5 | 400 (buttons 600) |
| Secondary | 0.875rem / 1.45 | 400 |
| Caption, metadata | 0.8125rem / 1.4 | 400 |

Rules:

- Inputs are at least 16px, so iOS does not zoom on focus.
- No text below 13px. No all-caps labels, and no tiny uppercase eyebrows above sections.
- Hero-scale type never appears inside the admin. Large editorial type belongs to the storefront.
- Bulgarian words are long: design for 30% longer strings than English, allow wrapping, never truncate a primary action label.

### 2.3 Spacing, size, radius, elevation

- **Spacing:** a 4px base, using only these steps: 4, 8, 12, 16, 24, 32, 48.
- **Touch targets:** at least 44 × 44px on touch layouts, with 8px minimum between adjacent targets.
- **Radius:**
  - `--amb-radius`: 8px for panels, inputs, buttons and message bubbles.
  - `--amb-radius-sm`: 6px for chips and badges.
  - Full circles only for avatars and status dots. Never over-round sections.
- **Borders before shadows.** One shadow token only, `--amb-shadow-float: 0 8px 24px rgb(23 25 28 / 0.12)`, for layers that float above content (menus, popovers, the mobile sheet).
- **Stable dimensions.** Toolbars, the conversation rail, the revision list, counters and the preview frame keep fixed sizes, so loading states and longer Bulgarian labels never shift the layout.

### 2.4 Motion

- **Purpose.** Motion only explains change: a new message arriving, a revision applied, a sheet opening.
- **Durations.** 120–200ms, ease-out, no bounces or parallax.
- **Reduced motion.** `prefers-reduced-motion: reduce` removes every non-essential animation. Progress remains visible as text and static indicators.
- **Activity animation.** Only an in-progress AI turn or build animates, with one quiet pulse on its status dot. Nothing loops once work has finished.

### 2.5 Icons and controls

- **Icons.** One outline icon set, 20px in 24px boxes, with `currentColor`. An icon never replaces a text label for a primary action.
- **Familiar controls:**
  - icon buttons for tools;
  - segmented control for Desktop/Mobile preview;
  - menus for choices;
  - text buttons for actions.
- **Cards** only for genuinely framed items: a revision entry, a screenshot, a confirmation. Never nest cards, and never lay out a screen as a grid of identical icon cards.
- **Focus.** A visible 2px `--amb-accent` outline with a 2px offset on every interactive element. Never remove the focus outline.

## 3. The designer screen (M3)

### 3.1 Composition

**Desktop, 1024px and wider:**

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ Store name · Чернова        [Desktop|Mobile]   История   Отмени   Обнови прегледа │  top bar, 56px
├──────────────────────────────────────────────┬────────────────────────────┤
│                                              │ Избрано: Заглавие ✕        │
│        Draft storefront canvas               │ ─────────────────────────  │
│   (the merchant's store, own colours,        │  Conversation              │
│    selectable elements)                      │  · merchant turns          │
│                                              │  · Amboras turns + activity│
│                                              │  · "Версия 7 · Отмени"     │
│                                              │ ─────────────────────────  │
│                                              │ [ Composer …        ] ➤   │
└──────────────────────────────────────────────┴────────────────────────────┘
                 flexible                          fixed rail, 400px
```

- **Canvas and rail.** The canvas takes all remaining width, on `--amb-canvas` with a 24px margin. The conversation rail is fixed at 400px on `--amb-surface` with a `--amb-line` left border.
- **Primary action.** "Обнови прегледа" (promote the draft to a real preview build) is the only accent-filled button on screen.
- **Undo.** "Отмени" is a text button beside it, always visible, and disabled when there is nothing to undo.
- **History.** "История" opens the revision list as a right-side drawer over the rail. It never navigates away from the canvas.

**Tablet, 768–1023px:** the canvas fills the screen. The conversation opens as a 400px overlay rail from the right, and a persistent "Разговор" button toggles it.

**Mobile, below 768px (designed at 375px first):**

- **Two views.** A segmented control switches between "Магазин" (canvas) and "Разговор" (conversation).
- **Selecting.** Tapping an element in "Магазин" opens a bottom sheet with the selected-element chip and the composer. Sending keeps the merchant on the canvas, with the activity line in the sheet.
- **Top bar.** Store name, draft status and a "…" menu holding История, Отмени and Обнови прегледа. When there are unpromoted changes, Обнови прегледа is also a sticky bottom action.
- **No horizontal scrolling** anywhere except inside the storefront preview at desktop simulation width.

### 3.2 Selecting an element

- **Hover** (pointer devices): 1px dashed ring plus the element's human label, e.g. "Заглавие".
- **Selected:** a double ring, 2px `#ffffff` outside 2px `--amb-ink`, plus a label tag. Its worst-case contrast is 4.2:1 against any merchant background, so the selection is visible on every theme without using Amboras accent inside the merchant's store.
- **Keyboard.** Tab moves between selectable elements in the canvas, Enter selects, and Escape clears the selection.
- **Selected-element chip.** It sits at the top of the composer, e.g. "Избрано: Заглавие ✕". Clearing it makes the next message apply to the whole store.
- **Selection is a hint, not authority.** The chip shows what the server resolved against the current draft. If the element no longer exists, the chip says so and clears itself.

### 3.3 Conversation and activity

- **Two voices.**
  - Merchant turns are right-aligned on `--amb-accent-soft`.
  - Amboras turns are left-aligned on `--amb-sunken`.
  - No avatars, no mascot, no "AI sparkle" iconography.
- **Activity is part of the thread, not a spinner overlay.** A running turn shows one line with a pulsing status dot and the current step, e.g. "Проверявам цветовете…". It is replaced by the result.
- **Every applied change leaves a result line in the thread:** what changed, plus the revision it created, e.g. "Промених заглавието · Версия 7 · Отмени". Undo lives next to the change it undoes.
- **Refusals and rejections are specific and actionable** (see §5.2), and never blame the merchant.
- **The composer** is multi-line and grows to 5 lines, then scrolls. Enter sends on desktop; Shift+Enter adds a newline. On mobile, the send button is the only way to send.
- **Persistence.** History survives refresh, and the thread resumes where it was, including a turn that is still running.

### 3.4 Revisions, undo and preview

- **Revision list (История).** Newest first. Each row shows the version number, a one-line summary, the author ("Вие" or "Amboras"), a relative time, and state badges: "Чернова" (current draft), "В прегледа" (currently in preview).
- **Restoring.** "Върни тази версия" creates a new revision equal to the chosen one. History is never rewritten. If a designer turn is running, the confirmation says it will be stopped.
- **Undo** restores the parent of the current draft revision, through the same path.
- **Preview promotion states** are shown in the top bar, in place, with stable width: "Подготвяме прегледа…" → "Прегледът е обновен" (with "Отвори прегледа") or "Прегледът не се обнови".
- **Screenshots** belong to a promoted preview. They appear as a framed card with capture time and viewport ("Мобилен", "Настолен"). A screenshot is evidence of what was built, not decoration.
- **Nothing in M3 goes live.** The UI never uses the words "публикувай", "на живо" or "онлайн" for M3 actions.

### 3.5 States every surface must design

| State | Rule |
|---|---|
| Loading | Skeletons that match the final layout size. No full-screen spinners. |
| Empty | Help the merchant act (§5.2). No feature descriptions. |
| Running | Inline activity line with the current step. The rest of the screen stays usable. |
| Success | Result line plus revision and undo. No celebratory confetti or modal. |
| Validation rejection | Specific reason and a next step. The draft is unchanged, and the UI says so. |
| Conflict | Show the latest draft and say it changed. Never silently overwrite. |
| Rate limited | Say when to try again, in minutes. |
| Offline / reconnecting | A thin warning banner. Queued input stays in the composer and is never lost. |
| Failure | Say what is safe ("Черновата е запазена") and offer retry. Never show stack traces, ids or English error text. |

## 4. Merchant storefront design space (storefront-schema v3)

The AI and the merchant may change only what is listed here. The renderer is deterministic, and the schema rejects everything else.

### 4.1 Theme tokens (unchanged from v2)

- `typography`: `editorial` or `modern`.
- `corner`: `soft` or `square`.
- `colors`: `paper`, `ink`, `muted`, `accent`, `accent_ink`, `line`. Hex only, with the v2 contrast rules still enforced:
  - ink/paper ≥ 7;
  - muted/paper ≥ 4.5;
  - accent_ink/accent ≥ 4.5;
  - accent/paper ≥ 3.

Not allowed: fonts or font URLs, free CSS, `url()`, gradients, shadows, spacing values, or animation.

### 4.2 One home page, six section types

Page chrome (header with the store name, footer) is fixed and not a section. The page holds 2–8 sections. `hero` stays first, and `product_grid` appears exactly once.

| Section | Variants (max 2) | Merchant/AI-editable content |
|---|---|---|
| `hero` | `text` (headline block), `image` (headline beside an owned photo) | headline ≤ 60, subheadline ≤ 160, CTA label ≤ 28, optional owned photo |
| `highlights` | `list`, `columns` | title ≤ 40; 1–3 items, each a title ≤ 40 and a text ≤ 140 |
| `product_grid` | `grid`, `compact` | title ≤ 40, empty-state text ≤ 120 (products themselves are catalogue data, M4) |
| `image_banner` | `full`, `contained` | one owned photo, alt text ≤ 120, optional line ≤ 80 |
| `about` | `text`, `image` | title ≤ 40, body ≤ 800, optional owned photo |
| `faq` | `list`, `details` (native `<details>`, no scripts) | title ≤ 40; 1–6 items, each a question ≤ 120 and an answer ≤ 400 |

Content rules, which bind both merchant-facing suggestions and AI output:

- All text is plain text. No HTML, no Markdown rendering, no links except the fixed hero CTA to the product grid.
- Photos are the store's own uploaded media only, referenced by media id and never by URL.
- `highlights` and `faq` state only what the merchant has said. The AI may reword merchant facts, but never invent prices, discounts, delivery promises, stock, certifications, origins, ingredients or guarantees. Empty items are not rendered.
- Every section and editable field renders a stable `data-amb-element` attribute derived from its schema path, e.g. `section:hero-1/headline`. These ids never contain merchant text.

### 4.3 What the AI may and may not do in M3

- **May (risk 0):** change theme tokens within §4.1; edit the section copy within §4.2 limits; reorder sections, keeping `hero` first; switch a section variant; add or remove sections within the limits; attach the store's own photos.
- **May (risk 1):** promote the current draft to a preview build.
- **May not:** touch products, prices, stock or collections; publish live; change the store name, locale or currency; introduce new section types; write code, CSS, HTML or scripts; use media from another store or the internet.

## 5. Language

### 5.1 Voice

Bulgarian first for every merchant-facing string (bg-BG). The voice is calm, concrete and useful.

- Address the merchant with polite "вие" in sentences. Buttons use short imperative verbs: "Изпрати", "Отмени", "Върни тази версия".
- Short sentences. Say what happened, then what the merchant can do.
- Never: hype ("премиум изживяване", "безпроблемно"), literal English structure, bureaucratic phrasing, English error text, or technical ids in copy.
- Amboras speaks as "Amboras" in the revision author field. In the thread it speaks in the first person, without a persona name.

### 5.2 Core strings (M3)

| Context | Bulgarian |
|---|---|
| Empty conversation | Посочете елемент от магазина и кажете какво да променим. |
| Composer placeholder | Например: направете заглавието по-кратко |
| Send | Изпрати |
| Selected chip | Избрано: {елемент} |
| Clear selection | Премахни избора |
| Selection no longer exists | Този елемент вече не е в черновата. Изберете отново. |
| Running (generic) | Работя по промяната… |
| Applied | Готово: {какво се промени}. Версия {n} |
| Undo | Отмени |
| Undo done | Върнах предишната версия. |
| History | История |
| Restore | Върни тази версия |
| Restore confirmation | Ще върнем версия {n}. Текущата промяна ще бъде спряна, но нищо няма да се изгуби. |
| Draft badge | Чернова |
| In preview badge | В прегледа |
| Promote | Обнови прегледа |
| Promote running | Подготвяме прегледа… |
| Promote done | Прегледът е обновен. |
| Promote failed | Прегледът не се обнови. Черновата е запазена — опитайте отново. |
| Open preview | Отвори прегледа |
| Screenshot | Снимка на прегледа |
| Contrast rejection | Тези цветове не се четат достатъчно добре. Опитайте по-тъмен текст или по-светъл фон. |
| Too long | Текстът е твърде дълъг за това място. Съкратете го малко. |
| Product/price request | Продуктите и цените не се променят оттук. Тук променяме външния вид и текстовете на магазина. |
| Conflict | Черновата беше променена междувременно. Показваме последната версия. |
| Rate limited | Направихте много промени за кратко. Опитайте отново след {m} мин. |
| Reconnecting | Връзката прекъсна. Свързваме се отново… |
| Generic failure | Нещо не се получи. Черновата е запазена. |

## 6. Verification checklist (M3-T15)

A UI change is complete only when every item is checked and recorded:

1. Rendered in a real browser at 375 × 812 and 1440 × 900. Screenshots recorded for the designer empty state, a running turn, an applied change and the revision drawer.
2. No text clipping, overlap or horizontal page scroll at either width. Bulgarian strings fit.
3. Tokens only: no raw hex or font values outside the token file, no gradients, glass or blur.
4. Every text and control pair meets §2.1 contrast. The selection ring is visible on a light, a dark and a saturated merchant theme.
5. Keyboard-only walkthrough: select an element, send, undo, open History, restore, promote. Focus is always visible.
6. With `prefers-reduced-motion: reduce`, nothing animates except state text changes.
7. All §3.5 states are reachable in tests and have designed copy from §5.2.
8. Screen reader labels exist for icon buttons, the canvas selection, the activity line (`aria-live="polite"`) and badges.
9. No English strings, technical ids or raw error messages visible to the merchant.
10. `/amboras-impeccable-ui`, `/amboras-design-taste` and `/kowalski-design` review notes recorded, with any unfixed item listed.
