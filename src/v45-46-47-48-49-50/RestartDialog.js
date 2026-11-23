import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// Asks the user to let the extension close and reopen a running Steam client,
// which would otherwise overwrite shortcuts.vdf when it exits.
export const RestartDialog = GObject.registerClass(
class RestartDialog extends ModalDialog.ModalDialog {
    _init(app, onConfirm) {
        super._init();

        const content = new Dialog.MessageDialogContent({
            title: _('Restart Steam?'),
            description: _('Steam is running. It will be closed to add %s to your library and opened again afterwards.')
                .format(app.get_name()),
        });
        this.contentLayout.add_child(content);

        this.addButton({
            label: _('Cancel'),
            action: () => this.close(),
            key: Clutter.KEY_Escape,
        });
        this.addButton({
            label: _('Restart Steam'),
            action: () => {
                this.close();
                onConfirm();
            },
        });
    }
});
