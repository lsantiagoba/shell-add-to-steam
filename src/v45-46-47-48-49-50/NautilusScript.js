import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Files (Nautilus) lists the executables in this folder under
// right-click > Scripts, named after the file.
const SCRIPTS_DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'nautilus', 'scripts']);
// Identifies our launcher, whose file name depends on the language.
const MARKER = '# shell-add-to-steam';

const decoder = new TextDecoder();

function findScripts() {
    const directory = Gio.File.new_for_path(SCRIPTS_DIR);
    if (!directory.query_exists(null))
        return [];

    const scripts = [];
    const enumerator = directory.enumerate_children('standard::name,standard::type',
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    for (let info; (info = enumerator.next_file(null));) {
        if (info.get_file_type() !== Gio.FileType.REGULAR)
            continue;
        const file = directory.get_child(info.get_name());
        try {
            const [, contents] = file.load_contents(null);
            if (decoder.decode(contents).includes(MARKER))
                scripts.push(file);
        } catch (e) {
            logError(e, `Failed to read Nautilus script ${info.get_name()}`);
        }
    }
    return scripts;
}

export function isInstalled() {
    return findScripts().length > 0;
}

// Installs the "Add to Steam" entry, replacing a previous one so that the
// name follows the current language and the path the current extension.
export function install(extensionPath, name) {
    uninstall();
    GLib.mkdir_with_parents(SCRIPTS_DIR, 0o755);

    const program = GLib.build_filenamev([extensionPath, 'AddFilesToSteam.js']);
    const contents = `#!/bin/sh\n${MARKER}\nexec gjs -m ${GLib.shell_quote(program)} "$@"\n`;
    const file = Gio.File.new_for_path(GLib.build_filenamev([SCRIPTS_DIR, name]));
    file.replace_contents(new TextEncoder().encode(contents), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    file.set_attribute_uint32('unix::mode', 0o755, Gio.FileQueryInfoFlags.NONE, null);
}

export function uninstall() {
    for (const file of findScripts())
        file.delete(null);
}
