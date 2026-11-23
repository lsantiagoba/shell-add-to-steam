import GLib from 'gi://GLib';

import * as Vdf from './ShortcutsVdf.js';

const CRC32_TABLE = Array.from({length: 256}, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(text) {
    let crc = 0xffffffff;
    for (const byte of new TextEncoder().encode(text))
        crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

const quote = value => `"${value}"`;

// Describes how Steam should launch a program.
export class SteamShortcut {
    // argv is the command line to run. Windows programs (useProton) are
    // started by Steam through Proton; anything else runs natively.
    static forCommand({name, argv, startDir, icon = '', installation, useProton = false}) {
        const program = useProton ? argv[0] : GLib.find_program_in_path(argv[0]) ?? argv[0];
        let args = argv.slice(1);
        let executable = program;

        // Flatpak Steam runs in a sandbox: ask the host to start native apps.
        if (installation.flatpak && !useProton) {
            executable = 'flatpak-spawn';
            args = ['--host', program, ...args];
        }

        return new SteamShortcut({
            name,
            executable,
            startDir,
            launchOptions: args.map(arg => GLib.shell_quote(arg)).join(' '),
            icon,
            useProton,
        });
    }

    // icon is a path, or a function returning one so that it is only
    // resolved when the shortcut is actually added.
    constructor({name, executable, startDir, launchOptions, icon, useProton}) {
        this.name = name;
        this.exe = quote(executable);
        this.startDir = quote(startDir);
        this.launchOptions = launchOptions;
        this.useProton = useProton;
        this._icon = icon;
    }

    // Steam derives the id of non-Steam games from the target and name.
    get appId() {
        return (crc32(this.exe + this.name) | 0x80000000) | 0;
    }

    // The id as Steam writes it in text files such as config.vdf.
    get unsignedAppId() {
        return this.appId >>> 0;
    }

    // Whether shortcuts (the root of shortcuts.vdf) already has this app.
    isIn(root) {
        const shortcuts = Vdf.get(root, 'shortcuts')?.value ?? [];
        return shortcuts.some(([, entry]) =>
            Vdf.get(entry, 'appid')?.value === this.appId ||
            (Vdf.get(entry, 'AppName')?.value === this.name &&
             Vdf.get(entry, 'Exe')?.value === this.exe));
    }

    addTo(root) {
        let shortcuts = Vdf.get(root, 'shortcuts');
        if (!shortcuts) {
            shortcuts = Vdf.map();
            root.value.push(['shortcuts', shortcuts]);
        }

        // Entries are keyed by their position: "0", "1", ...
        const keys = shortcuts.value
            .map(([key]) => Number.parseInt(key, 10))
            .filter(Number.isFinite);
        const nextKey = Math.max(-1, ...keys) + 1;

        shortcuts.value.push([String(nextKey), Vdf.map([
            ['appid', Vdf.int32(this.appId)],
            ['AppName', Vdf.string(this.name)],
            ['Exe', Vdf.string(this.exe)],
            ['StartDir', Vdf.string(this.startDir)],
            ['icon', Vdf.string(typeof this._icon === 'function' ? this._icon() : this._icon)],
            ['ShortcutPath', Vdf.string('')],
            ['LaunchOptions', Vdf.string(this.launchOptions)],
            ['IsHidden', Vdf.int32(0)],
            ['AllowDesktopConfig', Vdf.int32(1)],
            ['AllowOverlay', Vdf.int32(1)],
            ['OpenVR', Vdf.int32(0)],
            ['Devkit', Vdf.int32(0)],
            ['DevkitGameID', Vdf.string('')],
            ['DevkitOverrideAppID', Vdf.int32(0)],
            ['LastPlayTime', Vdf.int32(0)],
            ['FlatpakAppID', Vdf.string('')],
            ['tags', Vdf.map()],
        ])]);
    }
}
