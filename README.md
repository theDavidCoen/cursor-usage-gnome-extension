# Cursor Usage — GNOME Shell extension

Shows your **Cursor** plan usage percentage in the GNOME **top bar**. Click for subscription type, billing cycle end, Usage / API progress, and spend details.

![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-49%20%7C%2050%20%7C%2051-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- Top bar: Cursor hexagon mark + total usage % (panel foreground color)
- Popup: plan name + status, Usage and API progress bars, cycle/spend details
- Refresh on open and every 5 minutes
- Uses the Cursor session already on your machine (no API key to paste)

## Requirements

- GNOME Shell **49**, **50**, or **51**
- Cursor IDE signed in on this machine
- `python3` (stdlib only; uses `sqlite3` + `urllib`)

## Install

```bash
git clone https://github.com/theDavidCoen/cursor-usage-gnome-extension.git
cd cursor-usage-gnome-extension
./install.sh
```

On Wayland, if the shell has not loaded the extension yet:

```bash
./reload-extension.sh
# or log out / log in, then:
gnome-extensions enable cursor-usage@local
```

UUID: `cursor-usage@local`

## How it works

1. `bin/fetch-cursor-usage.py` reads the IDE access token at **runtime** from Cursor’s local SQLite state DB (`~/.config/Cursor/User/globalStorage/state.vscdb`, key `cursorAuth/accessToken`).
2. It calls Cursor dashboard endpoints on `api2.cursor.sh` (`GetCurrentPeriodUsage`, `GetPlanInfo`, `auth/full_stripe_profile`).
3. The extension shows a compact summary in the panel; the helper **never prints or commits the token**.

These dashboard APIs are **undocumented** and may change without notice. This project is unofficial and not affiliated with Anysphere / Cursor.

## Privacy

- No credentials are embedded in the repository.
- No tokens are written to disk by this extension.
- Account email shown in the menu comes from Cursor’s local cache at runtime only.

## Development

```
extension.js              PanelMenu.Button + popup UI
bin/fetch-cursor-usage.py Runtime token + API helper
icons/                    Cursor brand mark (hexagon only)
install.sh                Install into ~/.local/share/gnome-shell/extensions/
reload-extension.sh       Reinstall + try to reload GNOME Shell
```

## License

[MIT](LICENSE)
