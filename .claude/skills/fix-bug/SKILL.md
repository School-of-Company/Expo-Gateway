# Fix Bug

## Steps

1. **Reproduce** — Confirm the bug with `npm test`, `npm run test:e2e`, or direct execution.
2. **Trace** — Error message → stack trace → source file.
3. **Understand** — Read the code. Do not guess.
4. **Minimal fix** — Fix only the root cause. Do not touch unrelated code.
5. **Regression test** — Add a test that catches the same bug.
6. **Validate** — Full `npm test && npm run test:e2e` pass, `npx tsc -p tsconfig.build.json --noEmit` clean, `npm run lint` clean.
7. **Report** — Root cause, fix, before/after behavior difference.

## Notes

- Minimize the diff with `git diff`.
- Do not declare completion without a test.
- Two real gotchas already hit once in this repo — check these first if the bug smells related:
  - A provider/module pair importing each other's exports (circular require) can make `@Inject()` capture `undefined` for a token instead of throwing — Nest's error message ("can't resolve dependencies... argument at index [N] appears to be undefined at runtime") is the tell.
  - A newly-added dependency that ships pure ESM (`"type": "module"`, no CJS build) breaks at `require()` time under this project's CommonJS build — check `npm view <pkg> type` before adding or upgrading a dependency.
