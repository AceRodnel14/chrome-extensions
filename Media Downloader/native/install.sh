#!/usr/bin/env bash
# Registers the exiftool helper with Chrome, Chromium and Brave on Linux (tested on Debian-based systems) and macOS.
#
#   ./install.sh                         register for Google Chrome, Chromium and Brave (default profiles)
#   ./install.sh --profile-dir DIR       register for a Chrome started with --user-data-dir=DIR
#   ./install.sh --uninstall [...]       remove the registration again
#
# Needs python3 (Debian/Ubuntu: sudo apt install python3). Run it again if you move this folder.
set -euo pipefail

HOST_NAME="com.mediadownloader.exiftool"
EXTENSION_ID="cedeopcefllcjmmkopihgkkngehmfmmk" # fixed by the "key" in manifest.json
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$HERE/mediadownloader_exiftool.py"

uninstall=false
targets=()
while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) uninstall=true ;;
    --profile-dir) targets+=("$2/NativeMessagingHosts"); shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ ${#targets[@]} -eq 0 ]; then
  if [ "$(uname)" = "Darwin" ]; then
    targets=("$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
             "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
             "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts")
  else
    targets=("$HOME/.config/google-chrome/NativeMessagingHosts"
             "$HOME/.config/chromium/NativeMessagingHosts"
             "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts")
  fi
fi

if $uninstall; then
  for dir in "${targets[@]}"; do
    rm -f "$dir/$HOST_NAME.json" && echo "Removed $dir/$HOST_NAME.json"
  done
  exit 0
fi

command -v python3 >/dev/null || { echo "python3 is not installed (Debian/Ubuntu: sudo apt install python3)" >&2; exit 1; }
chmod +x "$HELPER"

for dir in "${targets[@]}"; do
  mkdir -p "$dir"
  cat > "$dir/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "mediadownloader exiftool helper: writes the post date into downloaded photos and videos",
  "path": "$HELPER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
  echo "Registered $HOST_NAME in $dir"
done
echo "Done. Restart the browser if it was open, then use Settings → Test in mediadownloader."
