#!/usr/bin/env bash
# Claude Code PostToolUse hook

INPUT=$(cat)

PARSED=$(printf '%s\n' "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    tool = d.get('tool_name', '')
    cmd = d.get('tool_input', {}).get('command', '')
    print(tool + '|||' + cmd)
except Exception:
    print('|||')
" 2>/dev/null || echo "|||")

TOOL_NAME="${PARSED%%|||*}"
COMMAND="${PARSED#*|||}"

if [ "$TOOL_NAME" = "Bash" ] && echo "$COMMAND" | grep -qE '^git push'; then
  >&2 echo "[hook] git push executed — confirm this was intentional."
fi

exit 0
