#!/usr/bin/env bash
set -euo pipefail

title="${1:-}"
if [[ -z "$title" ]]; then
  echo "usage: scripts/adr.sh \"Decision title\"" >&2
  exit 2
fi

root="$(git rev-parse --show-toplevel)"
directory="$root/docs/decisions"
mkdir -p "$directory"

last="$(find "$directory" -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]-*.md' \
  -printf '%f\n' | sort | tail -n 1 | cut -d- -f1)"
number="$(printf '%04d' "$((10#${last:-0000} + 1))")"
slug="$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')"
path="$directory/$number-$slug.md"

now="$(date '+%Y-%m-%d %H:%M %Z')"
# Self-heal: .trial-start is gitignored, so seed it (to the kickoff commit time
# when available, otherwise now) the first time an ADR is created on a machine.
if [[ ! -f "$root/.trial-start" ]]; then
  kickoff="$(git -C "$root" log --max-parents=0 --format=%ct HEAD 2>/dev/null | head -1)"
  printf '%s\n' "${kickoff:-$(date +%s)}" > "$root/.trial-start"
fi
started="$(cat "$root/.trial-start")"
elapsed="$(( $(date +%s) - started ))"
tplus="$(printf 'T+%d:%02d' "$((elapsed / 3600))" "$(((elapsed % 3600) / 60))")"

cat > "$path" <<EOF
# $number — $title

- **When:** $now ($tplus)
- **Status:** proposed
- **Context:**
- **Options:**
- **Decision:**
- **Why:**
- **Consequences:**
- **Asked Corgi?**
- **Touches:**
EOF

printf -- '- [%s — %s](decisions/%s-%s.md)\n' \
  "$number" "$title" "$number" "$slug" >> "$root/docs/DECISIONS.md"

printf '%s\n' "$path"
