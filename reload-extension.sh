#!/usr/bin/env bash
# Install extension files and try to reload GNOME Shell.
set -euo pipefail

UUID="cursor-usage@local"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

"${SCRIPT_DIR}/install.sh"

echo ""
echo "Trying to restart GNOME Shell…"

_restart_shell() {
  local code="$1"
  local out
  out="$(busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s "$code" 2>/dev/null || true)"
  [[ "$out" == *"true"* ]]
}

restarted=false
if _restart_shell 'global.reexec_self();'; then
  restarted=true
  echo "Shell restart via global.reexec_self() — wait ~5s for the desktop to return."
elif _restart_shell 'Meta.restart("Cursor Usage");'; then
  restarted=true
  echo "Shell restart via Meta.restart() — wait ~5s."
else
  echo "Automatic Shell restart is blocked on this session (Eval returned false)."
fi

echo ""
if [[ "$restarted" == true ]]; then
  sleep 5
  gnome-extensions enable "${UUID}" 2>/dev/null || true
else
  echo "Do this once (only reliable fix on Wayland):"
  echo "  1. Log out of your session completely, then log back in"
  echo "  2. Run:"
  echo "       gnome-extensions enable ${UUID}"
fi

echo ""
echo "Then verify:"
echo "  gnome-extensions info ${UUID}"
echo "Expect: Version/Versione: 5   State/Stato: ACTIVE"
