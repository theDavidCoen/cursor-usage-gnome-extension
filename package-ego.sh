#!/usr/bin/env bash
# Build extensions.gnome.org zip (files at archive root; no nested folder).
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
UUID="cursor-usage@theDavidCoen.github.io"
DIST="${SRC}/dist"
ZIP="${DIST}/${UUID}.shell-extension.zip"
STAGE="${DIST}/stage"

rm -rf "${STAGE}"
mkdir -p "${STAGE}/icons" "${DIST}"

cp "${SRC}/extension.js" "${SRC}/api.js" "${SRC}/metadata.json" "${SRC}/stylesheet.css" "${STAGE}/"
cp "${SRC}/icons/panel-icon.svg" "${STAGE}/icons/"

# Optional: include LICENSE for reviewers
cp "${SRC}/LICENSE" "${STAGE}/"

rm -f "${ZIP}"
python3 - <<PY
import zipfile
from pathlib import Path
stage = Path("${STAGE}")
zip_path = Path("${ZIP}")
with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for path in sorted(stage.rglob("*")):
        if path.is_file():
            zf.write(path, path.relative_to(stage).as_posix())
print("Created:", zip_path)
for info in zf.infolist() if False else zipfile.ZipFile(zip_path).infolist():
    print(f"  {info.file_size:8d}  {info.filename}")
PY
