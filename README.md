# Cursor Usage — GNOME Shell extension

Shows your **Cursor** IDE plan usage percentage in the GNOME **top bar**. Click for subscription type, billing cycle end, Usage / API progress, and spend details.

![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-49%20%7C%2050%20%7C%2051-blue)
![License](https://img.shields.io/badge/license-MIT-green)

**UUID:** `cursor-usage@theDavidCoen.github.io`

## Features

- Top bar: usage mark + total usage % (panel foreground color)
- Popup: plan name + status, Usage and API progress bars, cycle/spend details
- Refresh on open and every 5 minutes
- Uses the Cursor session already on your machine (no API key to paste)

## Requirements

- GNOME Shell **49**, **50**, or **51**
- Cursor IDE signed in on this machine
- `sqlite3` CLI (used read-only against Cursor’s local state DB)

## Install (local)

```bash
git clone https://github.com/theDavidCoen/cursor-usage-gnome-extension.git
cd cursor-usage-gnome-extension
./install.sh
```

On Wayland, if the shell has not loaded the extension yet:

```bash
./reload-extension.sh
# or log out / log in, then:
gnome-extensions enable cursor-usage@theDavidCoen.github.io
```

## How it works

1. At runtime, the extension reads the IDE access token from Cursor’s local SQLite state DB (`~/.config/Cursor/User/globalStorage/state.vscdb`, key `cursorAuth/accessToken`) via the `sqlite3` CLI.
2. It calls Cursor dashboard endpoints on `api2.cursor.sh` over HTTPS (`GetCurrentPeriodUsage`, `GetPlanInfo`, `auth/full_stripe_profile`).
3. The token is never printed, logged, or shipped in the package.

These dashboard APIs are **undocumented** and may change without notice. This project is unofficial and not affiliated with Anysphere / Cursor.

## Privacy

- No credentials are embedded in the repository or the EGO zip.
- No tokens are written to disk by this extension.
- Account email shown in the menu comes from Cursor’s local cache at runtime only.

## Packaging for extensions.gnome.org

```bash
./package-ego.sh
# → dist/cursor-usage@theDavidCoen.github.io.shell-extension.zip
```

The zip contains only runtime files (`extension.js`, `api.js`, `metadata.json`, `stylesheet.css`, `icons/panel-icon.svg`, `LICENSE`).

## Development layout

```
extension.js              PanelMenu.Button + popup UI
api.js                    Local token + HTTPS usage fetch (GJS)
icons/panel-icon.svg      Original panel mark (EGO-safe)
brand/                    Optional Cursor brand assets (not shipped to EGO)
bin/fetch-cursor-usage.py Optional CLI helper for debugging (not required at runtime)
install.sh                Install into ~/.local/share/gnome-shell/extensions/
package-ego.sh            Build EGO zip
```

## License

[MIT](LICENSE) (distributed under terms compatible with GNOME Shell’s GPL-2.0-or-later for derived works).
