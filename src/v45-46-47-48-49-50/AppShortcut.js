import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { SteamShortcut } from './SteamShortcut.js';

const ICON_SIZE = 256;

// Removes the desktop entry field codes (%f, %U, ...) that only make sense
// when files or URLs are passed to the launcher.
const stripFieldCodes = exec =>
    exec.replace(/%%|%[a-zA-Z]/g, code => code === '%%' ? '%' : '').trim();

// Resolves the absolute path of the app's icon, or '' when it has none.
function iconPath(appInfo) {
    const icon = appInfo.get_icon();
    if (icon instanceof Gio.FileIcon)
        return icon.get_file().get_path() ?? '';
    if (!icon)
        return '';

    try {
        const info = new St.IconTheme().lookup_by_gicon(icon, ICON_SIZE, 0);
        return info?.get_filename() ?? '';
    } catch (e) {
        logError(e, 'Failed to resolve application icon');
        return '';
    }
}

// Builds the Steam shortcut of an app from its desktop entry. Returns null
// for apps that cannot be added, such as Steam games or entries without a
// command line.
export function shortcutForApp(app, installation) {
    const appInfo = app.get_app_info();
    const exec = appInfo?.get_string('Exec');
    if (!exec || /steam:\/\/rungameid\//.test(exec))
        return null;

    let argv;
    try {
        [, argv] = GLib.shell_parse_argv(stripFieldCodes(exec));
    } catch (e) {
        logError(e, `Failed to parse Exec of ${app.get_id()}`);
        return null;
    }
    if (argv.length === 0)
        return null;

    return SteamShortcut.forCommand({
        name: app.get_name(),
        argv,
        startDir: appInfo.get_string('Path') || GLib.get_home_dir(),
        // Resolved only when adding: menus check every app on open.
        icon: () => iconPath(appInfo),
        installation,
    });
}
