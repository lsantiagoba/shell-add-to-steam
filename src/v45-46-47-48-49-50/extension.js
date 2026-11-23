import Gio from 'gi://Gio';
import { AppMenu } from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {
    Extension,
    InjectionManager,
    gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js';

import { shortcutForApp } from './AppShortcut.js';
import { RestartDialog } from './RestartDialog.js';
import { SteamLibrary } from './SteamLibrary.js';

export default class AddToSteamExtension extends Extension {
    enable() {
        const extension = this;
        this._settings = this.getSettings();
        this._library = new SteamLibrary();
        this._items = new Set();

        // Used when the installed Steam client has no icon of its own. The
        // logo is bundled with the package but missing in a source checkout.
        const logo = this.dir.get_child('assets').get_child('steamLogo.png');
        this._fallbackIcon = logo.query_exists(null)
            ? new Gio.FileIcon({file: logo})
            : new Gio.ThemedIcon({name: 'steam'});

        this._injectionManager = new InjectionManager();
        this._injectionManager.overrideMethod(AppMenu.prototype, 'open',
            originalMethod => function (animate) {
            // Update our item before the menu is shown so it never flickers.
            let steamItem = this._getMenuItems().find(item => item._isAddToSteamItem);

            if (!steamItem && this._app) {
                steamItem = new PopupMenu.PopupImageMenuItem(_('Add to Steam'), extension._icon());
                steamItem._isAddToSteamItem = true; // Mark it
                extension._items.add(steamItem);
                steamItem.connect('destroy', () => extension._items?.delete(steamItem));

                steamItem.connect('activate', () => {
                    const app = this._app;
                    this.close();
                    extension._addToSteam(app).catch(e =>
                        logError(e, 'Failed to add application to Steam'));
                });

                // Place it below the launch options ("New Window", "Launch
                // Using ... Graphics Card") and above "Pin to Dash".
                // Fall back to appending if the GPU item is missing.
                const gpuIndex = this._getMenuItems().indexOf(this._onGpuMenuItem);
                if (gpuIndex >= 0)
                    this.addMenuItem(steamItem, gpuIndex + 1);
                else
                    this.addMenuItem(steamItem);
            }

            if (steamItem) {
                // Keep an existing menu item in sync with the active locale.
                steamItem.label.set_text(_('Add to Steam'));
                steamItem.setIcon(extension._icon());
                steamItem.visible = extension._canAdd(this._app);
            }

            originalMethod.call(this, animate);
        });
    }

    // The icon of the installed Steam client, so the item matches its launcher.
    _icon() {
        return SteamLibrary.findLauncher(SteamLibrary.find())?.get_icon() ??
            this._fallbackIcon;
    }

    _canAdd(app) {
        if (!app || SteamLibrary.isSteamApp(app))
            return false;
        const installation = SteamLibrary.find();
        return Boolean(installation && shortcutForApp(app, installation));
    }

    async _addToSteam(app) {
        const library = this._library;
        const installation = SteamLibrary.find();
        const shortcut = installation && shortcutForApp(app, installation);
        if (!shortcut) {
            Main.notifyError(_('Shell Add to Steam'),
                _('%s cannot be added to Steam.').format(app.get_name()));
            return;
        }

        try {
            const userDirectory = await library.userDirectory(installation);
            if (!userDirectory) {
                Main.notifyError(_('Shell Add to Steam'),
                    _('No Steam account was found. Sign in to Steam first.'));
                return;
            }

            if (shortcut.isIn(await library.readShortcuts(userDirectory))) {
                Main.notify(_('Shell Add to Steam'),
                    _('%s is already in your Steam library.').format(shortcut.name));
                return;
            }

            const add = () => this._write(library, installation, userDirectory, shortcut)
                .catch(e => this._notifyFailure(shortcut, e));

            // The extension may have been disabled while Steam was inspected.
            if (library !== this._library)
                return;

            if (!await library.isRunning()) {
                await add();
                return;
            }

            if (library !== this._library)
                return;

            if (!this._settings.get_boolean('confirm-restart')) {
                await add();
                return;
            }

            this._dialog?.destroy();
            const dialog = new RestartDialog(app, add);
            dialog.connect('destroy', () => {
                if (this._dialog === dialog)
                    this._dialog = null;
            });
            this._dialog = dialog;
            dialog.open();
        } catch (e) {
            this._notifyFailure(shortcut, e);
        }
    }

    // Steam rewrites shortcuts.vdf when it exits, so it is closed first and
    // the file is read again afterwards.
    async _write(library, installation, userDirectory, shortcut) {
        if (!await library.addWithRestart(installation, userDirectory, [shortcut])) {
            Main.notifyError(_('Shell Add to Steam'),
                _('Steam did not close in time. Close it and try again.'));
            return;
        }

        Main.notify(_('Shell Add to Steam'),
            _('%s was added to Steam.').format(shortcut.name));
    }

    _notifyFailure(shortcut, error) {
        logError(error, 'Failed to add application to Steam');
        Main.notifyError(_('Shell Add to Steam'),
            _('Could not add %s to Steam: %s').format(shortcut.name, error.message));
    }

    disable() {
        this._dialog?.destroy();
        this._dialog = null;
        this._library?.destroy();
        this._library = null;
        this._settings = null;
        this._fallbackIcon = null;
        this._injectionManager?.clear();
        this._injectionManager = null;

        // Menus outlive the extension, so remove the items it added.
        for (const item of this._items ?? [])
            item.destroy();
        this._items = null;
    }
}
