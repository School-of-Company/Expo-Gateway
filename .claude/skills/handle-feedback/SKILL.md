# Handle Feedback

## Purpose

Handle feedback from users and teammates via chat, issues, or review notes.
This skill is for general feedback — not GitHub PR review comments (use `resolve-pr-comments` for those).

## Classification

For each feedback item, assign one of:

| Class | When to use |
|-------|-------------|
| **Apply** | Real bug, convention violation, missing test, or clear improvement |
| **Explain** | Code is correct and intentional, but the reason isn't obvious |
| **Decline** | Personal preference, out of scope, or technically incorrect feedback |

## Process

1. List all feedback items.
2. Verify the current code doesn't already address each concern.
3. Classify each item (Apply / Explain / Decline).
4. Apply changes for `Apply` items — minimal modifications only.
5. Validate:
   ```bash
   npm test
   npm run test:e2e
   npx tsc -p tsconfig.build.json --noEmit
   ```
6. Report results.

## Recurrence Protocol

If the same feedback appears twice or more across sessions, update the relevant rule or skill:

- Convention feedback → `.claude/rules/architecture.md`
- Security feedback → `.claude/rules/security.md`
- Workflow feedback → the relevant `.claude/skills/*.md`

## Output Format

```
Applied:
  - [feedback]: [file:line — what changed]

Explained:
  - [feedback]: [reason the current code is correct]

Declined:
  - [feedback]: [reason for declining]

Validation: jest N passed / test:e2e N passed / tsc clean
```

## Rules

- Do not blindly apply all feedback.
- Minimal changes only — do not refactor unrelated code.
- If a test breaks after applying feedback, report before proceeding.
- Declined items must include a reason.
