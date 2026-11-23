import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as NautilusScript from './NautilusScript.js';

export default class ShellAddToSteamPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup();
        page.add(group);

        const confirmRow = new Adw.SwitchRow({
            title: _('Confirm before restarting Steam'),
            subtitle: _('Ask before closing a running Steam client to add an app.'),
        });
        settings.bind('confirm-restart', confirmRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(confirmRow);

        // The script is a file in the user's Nautilus scripts folder rather
        // than a setting, so the switch reflects whether that file exists.
        const filesRow = new Adw.SwitchRow({
            title: _('Add to Steam in Files'),
            subtitle: _('Add AppImages and Windows programs (.exe) from right-click > Scripts in Files.'),
            active: NautilusScript.isInstalled(),
        });
        filesRow.connect('notify::active', () => {
            try {
                if (filesRow.active)
                    NautilusScript.install(this.path, _('Add to Steam'));
                else
                    NautilusScript.uninstall();
            } catch (e) {
                logError(e, 'Failed to update the Nautilus script');
                window.add_toast(new Adw.Toast({title: e.message}));
            }
        });
        group.add(filesRow);

        window.add(page);
    }
}
