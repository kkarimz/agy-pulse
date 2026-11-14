#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLIST_PATH="$HOME/Library/LaunchAgents/com.antigravity.pulse.plist"
DOMAIN="gui/$(id -u)"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "$DOMAIN/com.antigravity.pulse" >/dev/null 2>&1 || true
  rm -f "$PLIST_PATH"
  echo "Removed LaunchAgent: $PLIST_PATH"
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
node "$PROJECT_ROOT/src/server.mjs" --print-launchd "$@" > "$PLIST_PATH"

launchctl bootout "$DOMAIN/com.antigravity.pulse" >/dev/null 2>&1 || true
sleep 1
launchctl bootstrap "$DOMAIN" "$PLIST_PATH"

echo "Installed and started Antigravity Pulse LaunchAgent:"
echo "  Plist: $PLIST_PATH"
echo "  Logs:  $HOME/Library/Logs/agy-pulse.out.log"
echo "  Stop:  $0 --uninstall"
