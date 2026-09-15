---
name: amboras-impeccable-ui
description: Use for Amboras frontend UI work, visual polish, responsive behavior, accessibility, typography, color, layout, merchant admin screens, storefront screens, and generated storefront presentation. Do not use for backend-only tasks.
---

# Amboras Impeccable UI

Use this skill when designing, changing, reviewing, or polishing any Amboras user interface.

## Product Feel

Amboras should feel like a serious Bulgarian commerce platform with taste: calm, trustworthy, modern, and merchant-friendly. It should not feel like a generic SaaS template, a default ecommerce theme, or an AI-generated landing page.

Preserve the current Amboras visual direction unless the user explicitly asks to redesign it.

## Working Rules

- Read the existing UI code, tokens, components, and screenshots before introducing new visual patterns.
- Prefer coherent product UI over marketing decoration.
- Make the first screen useful. For apps and tools, do not replace the working experience with a hero page.
- Keep controls familiar: icon buttons for tools, toggles for binary options, tabs for views, menus for choices, inputs/sliders for numeric values.
- Use cards only for repeated items, compact panels, modals, or genuinely framed tools. Avoid nested cards.
- Keep card radii restrained. Use 8px by default unless the existing design system clearly says otherwise.
- Ensure all text fits on mobile and desktop. No clipping, overlap, or hero-scale text inside compact panels.
- Verify contrast: body text should meet at least 4.5:1, large text at least 3:1.
- Use stable dimensions for boards, grids, toolbars, counters, tiles, and repeated UI elements so labels and loading states do not resize the layout.
- Support reduced motion for every animation.

## Avoid

- Generic SaaS dashboards with oversized metric cards and decorative gradients.
- Gradient text.
- Glassmorphism as a default style.
- Decorative blobs, bokeh, or random background grids.
- Repeated icon-card sections.
- Tiny uppercase eyebrows above every section.
- Over-rounded cards, sections, or inputs.
- Placeholder-gray text that is too faint to read.
- In-app explanatory copy that describes the UI instead of helping the user act.

## Verification

Before calling UI work complete:

- Run the relevant tests or build command.
- Check the UI in at least desktop and mobile widths when a browser surface exists.
- Inspect screenshots or the running app for spacing, hierarchy, contrast, overflow, and loading/error states.
- Mention any UI surfaces that were not visually verified.
