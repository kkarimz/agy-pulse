#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js (>=20.0.0) is required. Install via: brew install node" >&2
  exit 1
fi

if ! command -v agy >/dev/null 2>&1 && [[ ! -x "$HOME/.gemini/antigravity-cli/bin/agy" ]]; then
  echo "Warning: agy CLI not found in PATH or ~/.gemini/antigravity-cli/bin/agy." >&2
  echo "Install or authenticate Antigravity CLI so live quotas can load." >&2
fi

exec node "$SCRIPT_DIR/src/server.mjs" "$@"
