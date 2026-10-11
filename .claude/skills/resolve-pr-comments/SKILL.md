# Resolve PR Comments

## When to Use

When a GitHub PR has review comments and the task is to inspect each comment, judge validity, and apply only valid changes.

Do not use this skill for local self-review before creating a PR (use `review-local-diff` for that).

## Inputs

- PR number (optional — auto-detected from current branch if not provided)
- Current branch diff
- Referenced files and surrounding code

## Steps

1. Resolve PR number:
   - If a number was passed as an argument (e.g., `/resolve-pr-comments 3`), use it.
   - Otherwise, detect from the current branch:
     ```bash
     gh pr view --json number -q .number
     ```
   - If no PR is found, stop and ask the user.

2. Fetch PR comments:
   ```bash
   gh pr view <number> --comments
   gh api repos/{owner}/{repo}/pulls/<number>/comments
   gh api repos/{owner}/{repo}/issues/<number>/comments
   ```

3. For each comment, read the referenced file and surrounding code.

4. Classify each comment:

   | Class | Meaning |
   |-------|---------|
   | **Valid** | Real bug, convention violation, missing test, or design issue |
   | **Already Resolved** | Current code already addresses the comment |
   | **Needs Explanation** | Code is intentional, but the reason should be stated |
   | **Out of Scope** | Unrelated to this PR — handle separately |
   | **Invalid** | Based on a misunderstanding or incorrect assumption |

5. Apply only `Valid` comments. Keep changes minimal and directly tied to the comment.

6. Validate:
   ```bash
   npm test
   npm run test:e2e
   npx tsc -p tsconfig.build.json --noEmit
   ```

7. Commit and push — this is part of the skill, not a separate step:
   ```bash
   git add <changed files>
   git commit -m "fix: PR 리뷰 반영 - <요약>"
   git push origin <branch-name>
   ```

8. Reply to each comment on GitHub:

   ```bash
   HASH=$(git rev-parse --short HEAD)
   FULL=$(git rev-parse HEAD)
   REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
   ```

   - **Applied**: `Addressed in [${HASH}](https://github.com/${REPO}/commit/${FULL}).`
   - **Already Resolved**: `Already handled in the current code. (<evidence>)`
   - **Explained**: `This is intentional. <reason>`
   - **Declined / Out of Scope**: `Not applying this because <reason>.`

   Post each reply:
   ```bash
   gh api repos/{owner}/{repo}/pulls/<pr-number>/comments/<comment-id>/replies \
     --method POST \
     -f body="<reply>"
   ```

9. Summarize:

   ```
   ## PR Review Comment Resolution

   ### Applied
   - <comment>: <change>

   ### Already Resolved
   - <comment>: <evidence>

   ### Explained
   - <comment>: <reason>

   ### Declined / Out of Scope
   - <comment>: <reason>
   ```

## Rules

- Do not blindly apply every review comment.
- Always inspect the current code before changing it.
- Do not make unrelated refactors while resolving comments.
- Commit and push are part of this skill's workflow — do not wait for explicit commit request.
- If a valid comment requires changes too large for this PR, propose a follow-up issue instead of expanding scope.
- If the same review pattern recurs, update `.claude/rules/` or `.claude/skills/` to prevent it.
