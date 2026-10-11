# New Branch

## When to Use

Before starting any new work. Always branch off `origin/develop`.
Never commit directly to `develop` or `main`.

`develop` is the integration branch — all feature/fix/chore work branches from and PRs back into
`develop`. `main` only moves via a separate `develop` → `main` release PR (not something this skill
creates).

## Inputs

- Branch type: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`
- Scope: short kebab-case description of the work (e.g. `vault-provider`, `path-validation`)

## Steps

1. Fetch latest develop:
   ```bash
   git fetch origin develop
   ```

2. Create and switch to branch:
   ```bash
   git checkout -b <type>/<scope> origin/develop
   ```

3. Push and set upstream:
   ```bash
   git push -u origin <type>/<scope>
   ```

## Branch Naming

| Type | When |
|------|------|
| `feat/<scope>` | New feature |
| `fix/<scope>` | Bug fix |
| `chore/<scope>` | Tooling, config, dependency |
| `refactor/<scope>` | Code restructure without behavior change |
| `test/<scope>` | Tests only |
| `docs/<scope>` | Documentation only |

## Rules

- Always branch from `origin/develop`, not local `develop`.
- Scope must be specific enough to identify the work (not `update` or `changes`).
- Do not reuse old branches for new work.
