#!/usr/bin/env bash
# Install Cursor Usage GNOME Shell extension (user scope).
set -euo pipefail

UUID="cursor-usage@local"
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

echo "Installing ${UUID}"

rm -rf "${DEST}"
mkdir -p "${DEST}/bin" "${DEST}/icons"

cp "${SRC}/extension.js" "${SRC}/metadata.json" "${SRC}/stylesheet.css" "${DEST}/"
cp "${SRC}/bin/fetch-cursor-usage.py" "${DEST}/bin/"
cp "${SRC}/icons/"*.svg "${DEST}/icons/" 2>/dev/null || true
cp "${SRC}/icons/"*.png "${DEST}/icons/" 2>/dev/null || true
chmod +x "${DEST}/bin/fetch-cursor-usage.py"

echo "Files copied to: ${DEST}"
installed_version="$(grep -o '"version": *[0-9]*' "${DEST}/metadata.json" | grep -o '[0-9]*')"
echo "Installed extension version: ${installed_version}"

if ! command -v gnome-extensions >/dev/null 2>&1; then
  echo "Install gnome-extensions (package gnome-shell) to enable from CLI."
  exit 0
fi

if gnome-extensions list 2>/dev/null | grep -Fxq "${UUID}"; then
  gnome-extensions disable "${UUID}" 2>/dev/null || true
  gnome-extensions enable "${UUID}" 2>/dev/null || true
  echo ""
  gnome-extensions info "${UUID}" 2>/dev/null || true
  reported_version="$(gnome-extensions info "${UUID}" 2>/dev/null | sed -n 's/.*Versione: *//p; s/.*Version: *//p' | head -1 | tr -d ' ')"
  state="$(gnome-extensions info "${UUID}" 2>/dev/null | sed -n 's/.*Stato: *//p; s/.*State: *//p' | head -1 | tr -d ' ')"
  if [[ "${reported_version}" != "${installed_version}" ]] || [[ "${state}" == *ERROR* ]]; then
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
