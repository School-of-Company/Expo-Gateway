# Refactor Safely

## When to Use

When improving code structure without changing behavior.

## Principle

Tests are the evidence of behavior preservation. One change at a time.

## Steps

1. Clarify the goal — remove duplication? separate concerns? simplify?
2. Establish baseline:
   ```bash
   npm test 2>&1 | tail -10
   npm run test:e2e 2>&1 | tail -10
   ```
3. Apply one structural change.
4. Validate:
   ```bash
   npx tsc -p tsconfig.build.json --noEmit
   npm test
   npm run test:e2e
   ```
   - Pass → proceed to next change.
   - Fail → analyze and revert before continuing:
     ```bash
     git diff          # inspect what changed
     git checkout -- <file>   # revert if needed
     ```
5. Inspect scope:
   ```bash
   git diff
   ```
   Confirm no behavior changes are mixed in.
6. Commit the structural change alone before moving to the next.

## Commit Rule

```bash
git commit -m "$(cat <<'EOF'
refactor: 한글 설명
EOF
)"
```

Never mix behavior changes and refactoring in one commit.

## Rules

- No new features during a refactor.
- If there are no tests covering the code being refactored, write them first.
- If a refactor requires touching more than 3 unrelated files, reconsider scope.
- Do not introduce a shared abstraction (e.g. a generic provider interface) as part of a refactor unless a second real use case already exists.
- Watch for accidental circular imports when moving a token/constant between files — this repo
  has already hit one (a module and its service importing a DI token from each other). Prefer
  moving a shared token to its own file over having two consumer files import it from one another.
