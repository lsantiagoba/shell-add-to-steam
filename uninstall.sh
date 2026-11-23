#!/bin/bash

# Uninstallation script for Shell Add to Steam
set -e

EXTENSION_UUID="shell-add-to-steam@lsantiagoba"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

echo -e "\n\n\t~~~~~~~~~~~~~~~~~~ Shell Add to Steam ~~~~~~~~~~~~~~~~~~\n"
echo -e "\tRunning uninstallation script...\n"

# Check if extension is installed
if [ ! -d "$EXTENSION_DIR" ]; then
    echo -e "\t⚠️  Extension is not installed."
    echo -e "\n\t~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n"
    exit 0
fi

# Disable the extension
echo -e "\t1. Disabling extension..."
if command -v gnome-extensions &> /dev/null; then
    gnome-extensions disable $EXTENSION_UUID 2>/dev/null || echo -e "\t   (Extension was not enabled)"
else
    echo -e "\t   (Skipping - gnome-extensions command not found)"
fi

# Remove the Files (Nautilus) script, whose name depends on the language.
SCRIPTS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/nautilus/scripts"
grep -lx "# shell-add-to-steam" "$SCRIPTS_DIR"/* 2>/dev/null | while read -r script; do rm -f -- "$script"; done

# Remove files
echo -e "\t2. Removing extension files..."
if [ -d "$EXTENSION_DIR" ]; then
    rm -rf "$EXTENSION_DIR"
    echo -e "\t   Files removed successfully"
fi

echo -e "\n\t------------------------------------------------"
echo -e "\t| Shell Add to Steam uninstalled successfully  |"
echo -e "\t------------------------------------------------"
echo -e "\n\tPlease restart GNOME Shell:"
echo -e "\t  - On X11: Press Alt+F2, type 'r' and press Enter"
echo -e "\t  - On Wayland: Log out and log back in"
echo -e "\n\t~~~~~~~~~~~~~~~~~~ Thank You ~~~~~~~~~~~~~~~~~~\n"

exit 0
