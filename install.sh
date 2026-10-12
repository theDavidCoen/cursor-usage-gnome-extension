#!/usr/bin/env bash
# Install Cursor Usage GNOME Shell extension (user scope).
set -euo pipefail

UUID="cursor-usage@theDavidCoen.github.io"
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

echo "Installing ${UUID}"

rm -rf "${DEST}"
mkdir -p "${DEST}/icons"

cp "${SRC}/extension.js" "${SRC}/api.js" "${SRC}/metadata.json" "${SRC}/stylesheet.css" "${DEST}/"
cp "${SRC}/icons/panel-icon.svg" "${DEST}/icons/"

echo "Files copied to: ${DEST}"

if ! command -v gnome-extensions >/dev/null 2>&1; then
  echo "Install gnome-extensions (package gnome-shell) to enable from CLI."
  exit 0
fi

if gnome-extensions list 2>/dev/null | grep -Fxq "${UUID}"; then
  gnome-extensions disable "${UUID}" 2>/dev/null || true
  gnome-extensions enable "${UUID}" 2>/dev/null || true
  echo ""
  gnome-extensions info "${UUID}" 2>/dev/null || true
  state="$(gnome-extensions info "${UUID}" 2>/dev/null | sed -n 's/.*Stato: *//p; s/.*State: *//p' | head -1 | tr -d ' ')"
  if [[ "${state}" == *ERROR* ]]; then
    echo ""
    echo "GNOME Shell may still be using cached extension code."
    echo "Run:  ./reload-extension.sh"
    echo "If that fails: log out and back in, then:  gnome-extensions enable ${UUID}"
  else
    echo ""
    echo "Extension is active in this session."
  fi
else
  echo ""
  echo "Install completed, but GNOME Shell has not loaded the extension yet."
  echo "Next steps:"
  echo "  1. Log out and log back in (recommended on Wayland)"
  echo "  2. Then run:  gnome-extensions enable ${UUID}"
  echo "     Or open:    Extension Manager → Cursor Usage → ON"
fi
