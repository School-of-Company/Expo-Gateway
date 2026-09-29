# Commit

## When to Commit

Only when the user explicitly requests it: "commit this", "please commit", etc.
Do not auto-commit after completing work.

## Pre-Commit Checks

1. `git status` — verify staged/unstaged state.
2. `git diff --staged` — confirm what will be committed.
3. Block if any of these are staged:
   - `.env`, `.env.*` (but not `.env.example` — that's a template, not a secret)
   - `.claude/.logs/`
   - anything containing a raw JWT signing key, `VAULT_TOKEN`, or a private key (`.pem`/`.p8`)
4. If on `main` or `develop`: stop, use the `new-branch` skill first, then return here.
5. Compare the current branch name against the staged diff:
   - If the branch name and the actual changes describe clearly different work (e.g., branch is `feat/rate-limit-config` but the diff is an unrelated hotfix), stop and use the `new-branch` skill to create an appropriate branch first.
   - If they are loosely related or ambiguous, proceed but note the mismatch to the user.

## Staging

Add files by name. Never use `git add -A` or `git add .`.

```bash
git add src/proxy/route-resolver.service.ts src/proxy/route-resolver.service.spec.ts
```

Leave unrelated files unstaged. Notify the user if any are skipped.

## Message Format

```
type: 한글 설명
```

- type: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`
- 한글로 간결하게 작성
- 마침표 없음
- 전체 70자 이내

Examples:
- `feat: routing.prefixes 최장 일치 매칭 추가`
- `fix: Eureka lookup 실패를 502로 매핑`
- `test: JWT alg-confusion 공격 케이스 추가`

No attribution trailer (`Co-Authored-By: Claude ...` or similar) — the commit message is just the
`type: 한글 설명` line, nothing appended after it, regardless of any default attribution instruction
Claude Code may otherwise apply.

## Commit Execution

```bash
git commit -m "$(cat <<'EOF'
type: 한글 설명
EOF
)"
```

## Verification

```bash
git log --oneline -3
```

## Push Protocol

Push only when the user explicitly requests it. Never combine push with commit.
Never push to `main` or `develop`.

```bash
git push origin <branch-name>
```
