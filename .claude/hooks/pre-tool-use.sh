#!/usr/bin/env bash
# Claude Code PreToolUse hook — block dangerous commands

INPUT=$(cat)

if ! command -v python3 >/dev/null 2>&1; then
  >&2 echo "[hook] WARNING: python3 not found, skipping pre-tool-use checks."
  exit 0
fi

PARSED=$(printf '%s\n' "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    tool = d.get('tool_name', '')
    cmd = d.get('tool_input', {}).get('command', '')
    print(tool + '|||' + cmd)
except Exception:
    print('|||')
")

TOOL_NAME="${PARSED%%|||*}"
COMMAND="${PARSED#*|||}"

if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

# Block dangerous commands
if echo "$COMMAND" | grep -qE 'git\s+push\s+.*(--force|-f(\s|$))'; then
  echo "BLOCKED: 'git push --force' is not allowed."
  exit 2
fi
if echo "$COMMAND" | grep -qE 'git\s+reset\s+.*--hard'; then
  echo "BLOCKED: 'git reset --hard' is not allowed."
  exit 2
fi
if echo "$COMMAND" | grep -qE 'git\s+clean\s+.*-f'; then
  echo "BLOCKED: 'git clean -f' is not allowed."
  exit 2
fi
if echo "$COMMAND" | grep -qE 'rm\s+(-[a-zA-Z]*[rR][a-zA-Z]*\s|--recursive\s)'; then
  echo "BLOCKED: 'rm -r*' is not allowed."
  exit 2
fi
if echo "$COMMAND" | grep -qE 'docker\s+compose\s+down\s+.*-v'; then
  echo "BLOCKED: 'docker compose down -v' is not allowed."
  exit 2
fi
if echo "$COMMAND" | grep -qE 'docker\s+volume\s+(rm|prune)'; then
  echo "BLOCKED: 'docker volume rm/prune' is not allowed."
  exit 2
fi

# Block direct reading of .env files
if echo "$COMMAND" | grep -qE '(cat|head|tail|less|more|grep|awk|sed|cp|python[0-9.]?)\s+[^ ]*\.env([. ]|$)'; then
  echo "BLOCKED: Reading .env files directly is not allowed."
  exit 2
fi

# Block reading secrets or credential files
if echo "$COMMAND" | grep -qE '(cat|head|tail|less|more|open|grep|awk|sed)\s+[^ ]*(secrets/|VAULT_TOKEN|\.pem|\.p8)'; then
  echo "BLOCKED: Reading secrets or credential files is not allowed."
  exit 2
fi

# Block dangerous GitHub API mutation requests
if echo "$COMMAND" | grep -qE 'gh\s+api.*-X\s+(DELETE|PATCH|PUT)'; then
  echo "BLOCKED: GitHub API mutation requests (DELETE/PATCH/PUT) require explicit approval."
  exit 2
fi

exit 0
