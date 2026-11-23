import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as TextVdf from './TextVdf.js';
import * as Vdf from './ShortcutsVdf.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
// replace_contents_bytes_async shares its finish function with replace_contents_async.
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'copy_async');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.File.prototype, 'make_directory_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.Subprocess.prototype, 'wait_async');

// SteamID64 values are the 32-bit account id (the userdata folder name)
// plus this offset.
const STEAM_ID64_BASE = 76561197960265728n;
const SHUTDOWN_TIMEOUT_SECONDS = 30;

// Used for Windows programs when Steam Play has no default tool configured.
const DEFAULT_COMPAT_TOOL = 'proton_experimental';
// Priority Steam itself writes for tools chosen in a game's properties.
const COMPAT_TOOL_PRIORITY = '250';
const COMPAT_TOOL_MAPPING = ['InstallConfigStore', 'Software', 'Valve', 'Steam', 'CompatToolMapping'];

const home = GLib.get_home_dir();

// Known Steam installations, most common first.
const INSTALLATIONS = [
    {
        flatpak: false,
        roots: [
            `${home}/.local/share/Steam`,
            `${home}/.steam/steam`,
            `${home}/.steam/root`,
        ],
        desktopId: 'steam.desktop',
        launchArgv: ['steam'],
        shutdownArgv: ['steam', '-shutdown'],
    },
    {
        flatpak: true,
        roots: [`${home}/.var/app/com.valvesoftware.Steam/.local/share/Steam`],
        desktopId: 'com.valvesoftware.Steam.desktop',
        launchArgv: ['flatpak', 'run', 'com.valvesoftware.Steam'],
        shutdownArgv: ['flatpak', 'run', 'com.valvesoftware.Steam', '-shutdown'],
    },
];

const exists = path => GLib.file_test(path, GLib.FileTest.IS_DIR);

async function readText(file) {
    const [contents] = await file.load_contents_async(null);
    return new TextDecoder().decode(contents);
}

// Locates Steam, its active account and edits that account's shortcuts.vdf.
// It only depends on GLib and Gio so that it also runs outside GNOME Shell.
export class SteamLibrary {
    constructor() {
        this._timeouts = new Set();
        this._cancellable = new Gio.Cancellable();
    }

    // The installation is looked up on every call so that installing or
    // removing Steam does not require reloading the extension.
    static find() {
        for (const installation of INSTALLATIONS) {
            const root = installation.roots.find(path => exists(`${path}/userdata`));
            if (root)
                return {...installation, root};
        }
        return null;
    }

    // Returns the Steam client's Gio.AppInfo, preferring the given installation.
    static findLauncher(installation = null) {
        const ids = [installation?.desktopId, ...INSTALLATIONS.map(i => i.desktopId)];
        const launchers = Gio.AppInfo.get_all();
        for (const id of ids) {
            const launcher = id && launchers.find(appInfo => appInfo.get_id() === id);
            if (launcher)
                return launcher;
        }
        return null;
    }

    static isSteamApp(app) {
        const id = app.get_id() ?? '';
        return INSTALLATIONS.some(installation => installation.desktopId === id);
    }

    destroy() {
        this._cancellable.cancel();
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
    }

    async isRunning() {
        try {
            const proc = Gio.Subprocess.new(['pgrep', '-x', 'steam'],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
            await proc.wait_async(this._cancellable);
            return proc.get_successful();
        } catch (e) {
            logError(e, 'Failed to check whether Steam is running');
            return false;
        }
    }

    async shutdown(installation) {
        Gio.Subprocess.new(installation.shutdownArgv, Gio.SubprocessFlags.NONE);
        for (let elapsed = 0; elapsed < SHUTDOWN_TIMEOUT_SECONDS; elapsed++) {
            await this._sleep(1);
            if (!await this.isRunning())
                return true;
        }
        return false;
    }

    launch(installation) {
        const launcher = SteamLibrary.findLauncher(installation);
        if (launcher)
            launcher.launch([], null);
        else
            Gio.Subprocess.new(installation.launchArgv, Gio.SubprocessFlags.NONE);
    }

    // Returns the userdata folder of the account that signed in last.
    async userDirectory(installation) {
        const userdata = `${installation.root}/userdata`;
        try {
            const users = await readText(
                Gio.File.new_for_path(`${installation.root}/config/loginusers.vdf`));
            for (const [, steamId, body] of users.matchAll(/"(\d{17})"\s*\{([^}]*)\}/g)) {
                if (!/"MostRecent"\s*"1"/i.test(body))
                    continue;
                const accountId = (BigInt(steamId) - STEAM_ID64_BASE).toString();
                if (exists(`${userdata}/${accountId}`))
                    return `${userdata}/${accountId}`;
            }
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                logError(e, 'Failed to read Steam login users');
        }

        // Without a most recent login, fall back to the newest account folder.
        const enumerator = await Gio.File.new_for_path(userdata).enumerate_children_async(
            'standard::name,standard::type,time::modified',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, this._cancellable);
        let newest = null;
        for (;;) {
            const infos = await enumerator.next_files_async(
                32, GLib.PRIORITY_DEFAULT, this._cancellable);
            if (infos.length === 0)
                break;
            for (const info of infos) {
                // "0" is the anonymous account Steam uses before signing in.
                if (info.get_file_type() !== Gio.FileType.DIRECTORY ||
                    !/^[1-9]\d*$/.test(info.get_name()))
                    continue;
                const modified = info.get_attribute_uint64('time::modified');
                if (!newest || modified > newest.modified)
                    newest = {name: info.get_name(), modified};
            }
        }
        return newest ? `${userdata}/${newest.name}` : null;
    }

    async readShortcuts(userDirectory) {
        const file = Gio.File.new_for_path(`${userDirectory}/config/shortcuts.vdf`);
        try {
            const [contents] = await file.load_contents_async(this._cancellable);
            return Vdf.parse(contents);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                throw e;
            return Vdf.map([['shortcuts', Vdf.map()]]);
        }
    }

    // Adds the shortcuts that are not in the library yet and selects Proton
    // for the Windows programs among them. Steam must be closed, since it
    // overwrites both files when it exits. Returns the added shortcuts.
    async add(installation, userDirectory, shortcuts) {
        const root = await this.readShortcuts(userDirectory);
        const added = shortcuts.filter(shortcut => !shortcut.isIn(root));
        if (added.length === 0)
            return added;

        for (const shortcut of added)
            shortcut.addTo(root);
        await this._write(Gio.File.new_for_path(`${userDirectory}/config/shortcuts.vdf`),
            Vdf.serialize(root));

        const windowsPrograms = added.filter(shortcut => shortcut.useProton);
        if (windowsPrograms.length > 0)
            await this._mapCompatTool(installation, windowsPrograms);

        return added;
    }

    // Closes a running Steam client around add() and opens it again.
    // Returns the added shortcuts, or null when Steam did not close in time.
    async addWithRestart(installation, userDirectory, shortcuts) {
        const wasRunning = await this.isRunning();
        if (wasRunning && !await this.shutdown(installation))
            return null;

        try {
            return await this.add(installation, userDirectory, shortcuts);
        } finally {
            if (wasRunning)
                this.launch(installation);
        }
    }

    async _mapCompatTool(installation, shortcuts) {
        const file = Gio.File.new_for_path(`${installation.root}/config/config.vdf`);
        let config = [];
        try {
            config = TextVdf.parse(await readText(file));
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                throw e;
        }

        // Entry "0" holds the tool chosen for all titles in Steam Play settings.
        const mapping = TextVdf.ensureMap(config, COMPAT_TOOL_MAPPING);
        const tool = TextVdf.get(TextVdf.get(mapping, '0'), 'name') || DEFAULT_COMPAT_TOOL;
        for (const shortcut of shortcuts) {
            const id = String(shortcut.unsignedAppId);
            if (TextVdf.get(mapping, id))
                continue;
            mapping.push([id, [
                ['name', tool],
                ['config', ''],
                ['priority', COMPAT_TOOL_PRIORITY],
            ]]);
        }

        await this._write(file, new TextEncoder().encode(TextVdf.serialize(config)));
    }

    // Replaces file with contents, keeping the previous version as .bak so a
    // bad write can be recovered by hand.
    async _write(file, contents) {
        const directory = file.get_parent();
        try {
            await directory.make_directory_async(GLib.PRIORITY_DEFAULT, this._cancellable);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw e;
        }

        try {
            await file.copy_async(directory.get_child(`${file.get_basename()}.bak`),
                Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT,
                this._cancellable, null);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                throw e;
        }

        await file.replace_contents_bytes_async(new GLib.Bytes(contents),
            null, false, Gio.FileCreateFlags.NONE, this._cancellable);
    }

    _sleep(seconds) {
        return new Promise(resolve => {
            const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
                this._timeouts.delete(id);
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._timeouts.add(id);
        });
    }
}
