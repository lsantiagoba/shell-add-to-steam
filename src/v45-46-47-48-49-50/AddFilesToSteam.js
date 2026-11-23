// Run by the "Add to Steam" Nautilus script (see NautilusScript.js) with the
// selected files. It adds AppImages and Windows programs (.exe) to Steam.
// This runs in its own gjs process, outside GNOME Shell.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gettext from 'gettext';
import System from 'system';

import { SteamLibrary } from './SteamLibrary.js';
import { SteamShortcut } from './SteamShortcut.js';

const extensionDir = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const metadata = JSON.parse(new TextDecoder().decode(
    GLib.file_get_contents(GLib.build_filenamev([extensionDir, 'metadata.json']))[1]));

Gettext.bindtextdomain(metadata['gettext-domain'],
    GLib.build_filenamev([extensionDir, 'locale']));
const _ = text => Gettext.dgettext(metadata['gettext-domain'], text);
// String.prototype.format is only added inside GNOME Shell.
const format = (text, ...args) => text.replace(/%s/g, () => args.shift());

const TITLE = _('Shell Add to Steam');
// The ELF header of AppImages carries this magic at offset 8.
const APPIMAGE_MAGIC = [0x41, 0x49]; // "AI"

function settings() {
    const source = Gio.SettingsSchemaSource.new_from_directory(
        GLib.build_filenamev([extensionDir, 'schemas']),
        Gio.SettingsSchemaSource.get_default(), false);
    return new Gio.Settings({
        settings_schema: source.lookup(metadata['settings-schema'], true),
    });
}

async function run(argv) {
    try {
        await Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDERR_SILENCE).wait_async(null);
    } catch (e) {
        logError(e, `Failed to run ${argv[0]}`);
    }
}

function notify(body, error = false) {
    if (GLib.find_program_in_path('notify-send')) {
        const icon = SteamLibrary.findLauncher(SteamLibrary.find())?.get_icon()?.to_string();
        return run(['notify-send', '--app-name', TITLE,
            ...icon ? ['--icon', icon] : [], TITLE, body]);
    }
    return run(['zenity', error ? '--error' : '--info', `--title=${TITLE}`,
        `--text=${GLib.markup_escape_text(body, -1)}`]);
}

const fail = body => notify(body, true);

async function confirm(title, text, okLabel) {
    if (!GLib.find_program_in_path('zenity'))
        return true;
    const proc = Gio.Subprocess.new(['zenity', '--question', `--title=${title}`,
        `--text=${GLib.markup_escape_text(text, -1)}`, `--ok-label=${okLabel}`, `--cancel-label=${_('Cancel')}`],
    Gio.SubprocessFlags.STDERR_SILENCE);
    await proc.wait_async(null);
    return proc.get_successful();
}

// The files Nautilus passed, as absolute paths.
function selectedFiles() {
    const paths = GLib.getenv('NAUTILUS_SCRIPT_SELECTED_FILE_PATHS');
    if (paths)
        return paths.split('\n').filter(Boolean);
    return ARGV.map(arg => Gio.File.new_for_commandline_arg(arg).get_path()).filter(Boolean);
}

function isAppImage(path) {
    if (/\.appimage$/i.test(path))
        return true;
    try {
        const stream = Gio.File.new_for_path(path).read(null);
        const header = stream.read_bytes(10, null).toArray();
        stream.close(null);
        return header[8] === APPIMAGE_MAGIC[0] && header[9] === APPIMAGE_MAGIC[1];
    } catch {
        return false;
    }
}

// AppImages are often downloaded without the executable bit.
function makeExecutable(path) {
    const file = Gio.File.new_for_path(path);
    const mode = file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
        .get_attribute_uint32('unix::mode');
    if ((mode & 0o100) === 0)
        file.set_attribute_uint32('unix::mode', mode | 0o111, Gio.FileQueryInfoFlags.NONE, null);
}

function shortcutForFile(path, installation) {
    const basename = GLib.path_get_basename(path);
    const startDir = GLib.path_get_dirname(path);
    if (/\.exe$/i.test(path)) {
        return SteamShortcut.forCommand({
            name: basename.replace(/\.exe$/i, ''),
            argv: [path],
            startDir,
            installation,
            useProton: true,
        });
    }
    if (isAppImage(path)) {
        makeExecutable(path);
        return SteamShortcut.forCommand({
            name: basename.replace(/\.appimage$/i, ''),
            argv: [path],
            startDir,
            installation,
        });
    }
    return null;
}

async function main() {
    const installation = SteamLibrary.find();
    if (!installation) {
        await fail(_('Steam was not found.'));
        return;
    }

    const shortcuts = [];
    for (const path of selectedFiles()) {
        try {
            const shortcut = shortcutForFile(path, installation);
            if (shortcut)
                shortcuts.push(shortcut);
        } catch (e) {
            await fail(format(_('Could not add %s to Steam: %s'),
                GLib.path_get_basename(path), e.message));
        }
    }
    if (shortcuts.length === 0) {
        await fail(_('Only AppImages and Windows programs (.exe) can be added to Steam.'));
        return;
    }

    const library = new SteamLibrary();
    const names = shortcuts.map(shortcut => shortcut.name).join(', ');
    try {
        const userDirectory = await library.userDirectory(installation);
        if (!userDirectory) {
            await fail(_('No Steam account was found. Sign in to Steam first.'));
            return;
        }

        const root = await library.readShortcuts(userDirectory);
        const missing = shortcuts.filter(shortcut => !shortcut.isIn(root));
        if (missing.length === 0) {
            await notify(format(_('%s is already in your Steam library.'), names));
            return;
        }

        const missingNames = missing.map(shortcut => shortcut.name).join(', ');
        if (await library.isRunning() && settings().get_boolean('confirm-restart') &&
            !await confirm(_('Restart Steam?'),
                format(_('Steam is running. It will be closed to add %s to your library and opened again afterwards.'), missingNames),
                _('Restart Steam')))
            return;

        const added = await library.addWithRestart(installation, userDirectory, missing);
        if (!added) {
            await fail(_('Steam did not close in time. Close it and try again.'));
            return;
        }

        const namesOf = list => list.map(shortcut => shortcut.name).join(', ');
        const windowsPrograms = added.filter(shortcut => shortcut.useProton);
        const nativePrograms = added.filter(shortcut => !shortcut.useProton);
        if (windowsPrograms.length > 0) {
            await notify(format(_('%s was added to Steam and will run with Proton.'),
                namesOf(windowsPrograms)));
        }
        if (nativePrograms.length > 0)
            await notify(format(_('%s was added to Steam.'), namesOf(nativePrograms)));
    } catch (e) {
        logError(e, 'Failed to add files to Steam');
        await fail(format(_('Could not add %s to Steam: %s'), names, e.message));
    } finally {
        library.destroy();
    }
}

await main();
System.exit(0);
