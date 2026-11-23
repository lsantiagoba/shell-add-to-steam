# Shell Add to Steam

A GNOME Shell extension that adds an "Add to Steam" option, with the Steam logo, to the right-click menu of applications in the Dash and App Grid. The application is added to your Steam library as a non-Steam game, so you can launch it from Big Picture, use Steam Input with it or play it with the Steam overlay.

## Features

- **One click:** Right-click any application and choose **Add to Steam**. The item sits below the launch options ("New Window", "Launch Using … Graphics Card") and above "Pin to Dash".
- **Works with any app:** The command line, working directory and icon are taken from the application's `.desktop` file, so native packages, Flatpak, Snap and AppImage launchers all work.
- **AppImages and Windows programs:** In Files (Nautilus), right-click an `.AppImage` or `.exe` and choose **Scripts > Add to Steam**. AppImages are made executable if needed; Windows programs are set to run with Proton (the Steam Play default if you chose one, otherwise Proton Experimental). Several files can be added at once. The script can be turned off in the extension's settings.
- **Native and Flatpak Steam:** Detects Steam in `~/.local/share/Steam`, `~/.steam` or the `com.valvesoftware.Steam` Flatpak. With the Flatpak client, apps are started on the host through `flatpak-spawn --host`.
- **Safe edits:** Writes to the `shortcuts.vdf` of the account that signed in last (and to Steam's `config.vdf` for Proton) and keeps the previous files as `.bak`. Apps that are already in the library are not added twice.
- **Steam restart:** Steam overwrites `shortcuts.vdf` and `config.vdf` when it exits, so a running client is closed, the app is added, and Steam is opened again. A confirmation dialog is shown first; it can be turned off in the extension's settings.
- **Steam icon:** The menu item uses the icon of your installed Steam client, falling back to the bundled logo.
- **Localized UI:** Uses standard gettext catalogs and follows the system language automatically.

With the Flatpak Steam client, Windows programs must be in a folder the Flatpak can read (for example your home folder, if you granted it access).

The item is hidden when Steam is not installed, for Steam itself, and for Steam games (launchers that run `steam://rungameid/`).

## Supported GNOME Shell Versions

- GNOME 45
- GNOME 46
- GNOME 47
- GNOME 48
- GNOME 49
- GNOME 50

## Installation

### From Source

1. Clone this repository to your local machine:
   ```bash
   git clone https://github.com/lsantiagoba/shell-add-to-steam.git
   cd shell-add-to-steam
   ```

2. Optionally, place the Steam logo at `assets/steamLogo.png`. It is a Valve trademark and is not distributed with the source code; it is only used when the installed Steam client has no icon.

3. Run the provided installation script:
   ```bash
   # Debian/Ubuntu: sudo apt install gettext
   ./install.sh
   ```

4. Restart GNOME Shell:
   - **X11:** Press `Alt` + `F2`, type `r`, and press `Enter`.
   - **Wayland:** Log out and log back in.

5. Enable the extension:
   You can enable it using the "Extensions" app, "Extension Manager", or via the command line:
   ```bash
   gnome-extensions enable shell-add-to-steam@lsantiagoba
   ```

## Packaging

`./pack-extension.sh` creates `shell-add-to-steam@lsantiagoba.zip` for extensions.gnome.org. It requires `assets/steamLogo.png`, which is bundled in the package.

## Uninstallation

To remove the extension from your system, simply navigate to the cloned repository folder and run the provided uninstall script:

```bash
./uninstall.sh
```

This also removes the Files script. Applications already added to Steam stay in your library; remove them from Steam itself.

## License

This project is free software, released under the GNU General Public License v3.0 or later. See [LICENSE](LICENSE).

Steam and the Steam logo are trademarks of Valve Corporation. This project is not affiliated with or endorsed by Valve.
