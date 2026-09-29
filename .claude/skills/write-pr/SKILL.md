# Write PR

PRs target `develop` (the integration branch), not `main`. `main` only moves via a separate,
manual `develop` → `main` release PR — not something this skill drives.

## Steps

1. `git fetch origin develop` — update local tracking branch.
2. `git log origin/develop..HEAD --oneline` — list commits.
3. `git diff origin/develop...HEAD --stat` — changed file stats.
4. `git diff origin/develop...HEAD` — full diff.
5. Propose 3 Korean PR title candidates and ask the user to pick one.
6. Wait for the user to select a title.
7. Write the PR body to `/tmp/pr_body.md`, filling in `.github/PULL_REQUEST_TEMPLATE.md`'s sections, in Korean.
8. Run `gh pr create` with `--body-file /tmp/pr_body.md`.

## PR Title Format

- Korean only. No type prefix (`feat:`, `chore:`, etc.).
- Concise, present-tense description of what this PR does.
- Max 50 characters.

Example candidates:
```
1. Eureka 기반 동적 라우팅 및 JWT 검증 게이트웨이 구현
2. Config Server 부트스트랩 연동 및 rate limiting 추가
3. 프록시 에러 처리(503/502) 및 e2e 테스트 보강
```

## PR Body Format

Fill in `.github/PULL_REQUEST_TEMPLATE.md`'s sections, in Korean:

- **💡 배경 및 개요**: 문제상황, 배경
- **📃 작업내용**: 이 PR에서 한 작업
- **🙋‍♂️ 리뷰노트**: 고민했던 점, 의도, 리뷰어에게 집중을 요청할 부분
- **✅ PR 체크리스트**: 실제로 확인한 항목만 체크
- **🎸 기타**: 그 외 참고사항 (다른 레포에 필요한 후속 작업 등)

## Creating the PR

Write body to a temp file, then create the PR:

```bash
cat > /tmp/pr_body.md << 'BODY'
## 💡 배경 및 개요

...

Resolves: #{이슈번호}

## 📃 작업내용

...

## 🙋‍♂️ 리뷰노트

...

## ✅ PR 체크리스트

- [ ] 이 작업으로 인해 변경이 필요한 문서가 변경되었나요?
- [ ] 이 작업을 하고나서 공유해야할 팀원들에게 공유되었나요?
- [ ] 작업한 코드가 정상적으로 동작하나요? (`npm test`, `npm run test:e2e`)
- [ ] Merge 대상 브랜치가 올바른가요?
- [ ] PR과 관련 없는 작업이 있지는 않나요?

## 🎸 기타
BODY

gh pr create --title "<선택한 제목>" --body-file /tmp/pr_body.md --base develop --assignee @me
```

## Rules

- Do not include anything not in the diff.
- Only check items you have actually verified.
- Always propose 3 Korean title candidates and wait for user selection before creating the PR.
- Branch must be pushed before running `gh pr create`.
- Always pass `--base develop` explicitly — do not rely on the repo's default branch.
- Always use `--body-file` (never inline heredoc) to avoid hook parse errors.
