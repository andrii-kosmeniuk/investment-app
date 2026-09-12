#!/usr/bin/env bash
set -euo pipefail

title="${1:-}"
if [[ -z "$title" ]]; then
  echo "usage: scripts/adr.sh \"short title\"" >&2
  exit 2
fi

root="$(git rev-parse --show-toplevel)"
directory="$root/docs/decisions"
mkdir -p "$directory"

last="$(find "$directory" -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]-*.md' \
  -printf '%f\n' | sort | tail -n 1 | cut -d- -f1)"
number="$(printf '%04d' "$((10#${last:-0000} + 1))")"
slug="$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//' | cut -c1-40)"
path="$directory/$number-$slug.md"

now="$(date '+%Y-%m-%d')"

cat > "$path" <<EOF
# $number — $title

**When:** $now

## Topic

- **Decision:**
- **Why:**
- **Consequences:**

EOF

printf -- '- [%s — %s](decisions/%s-%s.md)\n' \
  "$number" "$title" "$number" "$slug" >> "$root/docs/DECISIONS.md"

printf '%s\n' "$path"
