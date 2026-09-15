# Claude Code Skills Setup For Amboras

This repository includes project skills under `.claude/skills/`.

Claude Code loads project skills from:

```text
.claude/skills/<skill-name>/SKILL.md
```

Start Claude Code from the repository root, then run:

```text
/skills
```

You should see these Amboras skills:

- `/amboras-milestone-operator`
- `/amboras-impeccable-ui`
- `/amboras-design-taste`
- `/kowalski-design`
- `/security-red-team`
- `/tenant-isolation-review`
- `/mission-gate-review`
- `/durable-agent-review`
- `/bulgarian-commerce-copy`

## Paste-In Project Instruction

Use this in Claude Code or Claude Project context:

```text
Use the Amboras project skills in .claude/skills when relevant.

For milestone execution, use /amboras-milestone-operator.
For frontend work, preserve the current Amboras design direction and use /amboras-impeccable-ui, /amboras-design-taste, and /kowalski-design.
For security or tenancy review, use /security-red-team and /tenant-isolation-review.
For M2 AI generation work, use /durable-agent-review.
For acceptance before merge/tag, use /mission-gate-review.
For Bulgarian merchant/storefront copy, use /bulgarian-commerce-copy.

Do not replace Amboras' current visual direction with generic SaaS or generic ecommerce styling.
Do not start a future milestone unless explicitly approved.
```

## Recommended Use By Milestone

- M2 durable generation: `/amboras-milestone-operator`, `/durable-agent-review`, `/tenant-isolation-review`, `/security-red-team`, `/mission-gate-review`.
- M3 contextual designer: `/amboras-impeccable-ui`, `/amboras-design-taste`, `/kowalski-design`, `/bulgarian-commerce-copy`, `/security-red-team`.
- M4 catalogue/publishing: `/tenant-isolation-review`, `/bulgarian-commerce-copy`, `/security-red-team`, `/mission-gate-review`.

## Notes

These skills are intentionally small. They encode Amboras-specific judgment and milestone discipline without turning every Claude Code session into a giant prompt.
