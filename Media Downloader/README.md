# mediadownloader

A Chrome extension (Manifest V3) that adds download buttons to websites and saves the original-resolution
images and videos, plus a folder-per-website organizer for every other download.

Supported websites: **Instagram** (posts, carousels, reels, stories, highlights, profile pictures).

## Origin

mediadownloader is a fork of **IMDownloader 4.0.3** ("IMDownloader | Download story reels highlight image and
video", by Faruk Cepni), which stopped working when Instagram changed its site. It keeps the same idea (a download
button on each post, reel and story that fetches the original file through Instagram's own web API) but is
rewritten from scratch: the original's code was minified and unlicensed, and included analytics, a remote config
and a subscription check, none of which are carried over.

It also absorbs the separate **download-organizer** extension, which sorted downloads into a folder per website.
Do not run download-organizer alongside mediadownloader: both rename every download and Chrome only applies one.

## Installation

mediadownloader has two parts:

| Part | Needed? | What it is |
|---|---|---|
| The extension | Yes | This folder, loaded into Chrome (or Edge/Chromium) as an unpacked extension |
| The exiftool helper | Only for writing post dates into files | `native/mediadownloader_exiftool.py`, a small Python script Chrome starts when needed, plus exiftool itself |

The extension's ID is fixed by the `key` in `manifest.json`: it is **`cedeopcefllcjmmkopihgkkngehmfmmk`** on every
computer, and the helper only accepts that ID. Your settings belong to that ID, so they survive updates.

Before you start, **disable or remove** the old **IMDownloader** and **download-organizer** extensions: two sets of
download buttons, and two extensions renaming every download, would fight each other.

### Windows

#### 1. Put the extension folder somewhere permanent

Chrome loads the extension from this folder every time it starts, and the helper runs from it, so pick a place you
will not move or delete, for example `C:\Users\<you>\mediadownloader`.

- If the folder is inside WSL: open it in File Explorer under `\\wsl.localhost\<distro>\home\<user>\` and copy
  the whole folder to that place, or in WSL run `cp -r <folder> /mnt/c/Users/<you>/`.
- Do **not** load it straight from `\\wsl.localhost\…`: the extension fails to load whenever WSL is not running,
  and Windows' `cmd.exe` (which starts the helper) does not support network-style paths like that.

#### 2. Load the extension

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `mediadownloader` folder (the one that contains `manifest.json`).
4. Check that the card shows **ID `cedeopcefllcjmmkopihgkkngehmfmmk`**.
5. Optional: click the puzzle-piece icon in the toolbar and pin mediadownloader. Clicking its icon opens Settings.
6. Reload any Instagram tabs that were already open.

Chrome may show a "Disable developer mode extensions" message at startup; that is normal for unpacked extensions,
just close it.

That is all you need for downloading. Continue only if you want post dates written into the files.

#### 3. Optional: exiftool helper

**a. Python 3.7 or newer.** Open Command Prompt and run `py -0p`. It lists the Pythons installed; any 3.7+ works
(tested with 3.10, 3.12 and 3.14). The helper uses `py -3` (the newest Python 3) and falls back to `python`.
If neither command exists, install Python from <https://www.python.org/downloads/> and tick
**"Add python.exe to PATH"**.

**b. exiftool.** No Perl to install: the Windows download carries its own copy of Perl inside the
`exiftool_files` folder.
1. Download the **Windows 64-bit zip** from <https://exiftool.org>.
2. Unzip it to a folder of its own, for example `C:\Tools\exiftool`. It contains `exiftool(-k).exe` and an
   `exiftool_files` folder; keep both together.
3. Rename `exiftool(-k).exe` to **`exiftool.exe`**. (The `(-k)` version waits for a key press and would never
   finish; the helper refuses it and tells you to rename it.)

**c. Register the helper.** Double-click `native\install.bat` in the extension folder. It needs no administrator
rights: it writes `com.mediadownloader.exiftool.json` next to itself and registers it for your Windows user under
`HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts` (and the same for Edge). Run it again whenever you
move the extension folder.

**d. Restart Chrome completely**: close every window, and if Chrome keeps running in the background, right-click its
tray icon → Exit.

**e. Turn it on.** Open mediadownloader's Settings → **Photo and video dates (exiftool)**:
1. Enter the exiftool folder, e.g. `C:\Tools\exiftool`.
2. Click **Test**. It should say `exiftool 13.xx found (C:\Tools\exiftool\exiftool.exe)`.
3. Tick **Write the post date into downloaded photos and videos** and click **Save**.

Download any post: the message changes from "Saved … Setting dates…" to "Dates set on N files." In Explorer,
right-click a photo → Properties → Details → **Date taken** shows the post's date (in UTC, the same time as in the
filename).

### Linux (Debian, Ubuntu and other Debian-based)

#### 1. Load the extension

1. Put the `mediadownloader` folder somewhere permanent, e.g. `~/mediadownloader`.
2. In Chrome or Chromium go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose
   the folder.
3. Check the ID is **`cedeopcefllcjmmkopihgkkngehmfmmk`**, then reload any open Instagram tabs.

#### 2. Optional: exiftool helper

Python 3 and Perl are normally already installed. Perl comes with every Debian-based system (`/usr/bin/perl` is in
the essential `perl-base` package), so nothing extra is needed for exiftool. Only if `python3 --version` fails:

```bash
sudo apt install python3
```

exiftool, either of:

- the **Image-ExifTool** folder from <https://exiftool.org> (`Image-ExifTool-13.xx.tar.gz`), unpacked anywhere,
  e.g. `~/Image-ExifTool-13.59`. It works as is: ExifTool is a Perl program, and the helper runs its `exiftool`
  script with the system's `perl`. There is no separate Linux build without Perl.
- or Debian's package: `sudo apt install libimage-exiftool-perl` and use the folder `/usr/bin`.

Register the helper:

```bash
cd ~/mediadownloader
./native/install.sh
```

It writes `com.mediadownloader.exiftool.json` into `~/.config/google-chrome/NativeMessagingHosts/` and
`~/.config/chromium/NativeMessagingHosts/`. For a Chrome started with `--user-data-dir=DIR`, use
`./native/install.sh --profile-dir DIR`. Run it again if you move the folder.

Restart Chrome, then in Settings → **Photo and video dates (exiftool)** enter the exiftool folder (e.g.
`/home/<you>/Image-ExifTool-13.59`), click **Test**, tick the box and **Save**.

Chromium installed as a **snap** or **flatpak** runs sandboxed and cannot start the helper without extra setup; use
Google Chrome (`.deb` from google.com) or the Debian `chromium` package.

### Updating

1. Replace the files in the extension folder with the new ones (keep the same folder).
2. `chrome://extensions` → mediadownloader → click the **reload** arrow.
3. Reload open Instagram tabs. Settings are kept. Re-run the helper installer only if the folder moved.

### Removing

- Helper: `native\install.bat uninstall` (Windows) or `./native/install.sh --uninstall` (Linux).
- Extension: `chrome://extensions` → mediadownloader → **Remove**.

### Installation problems

| Symptom | Fix |
|---|---|
| ID on the extension card is not `cedeopcefllcjmmkopihgkkngehmfmmk` | You loaded a different folder or an old copy: remove it and load the folder whose `manifest.json` has a `"key"` |
| No download buttons on Instagram | Reload the Instagram tab; check Settings → Enabled websites; check `chrome://extensions` for errors |
| Test: "the exiftool helper is not installed …" | Run the installer, then fully restart Chrome (also from the tray on Windows) |
| Test: "No exiftool found in …" | The folder is wrong, or on Windows the file is still named `exiftool(-k).exe`: rename it to `exiftool.exe` |
| Test: "… it needs Perl and perl is not installed" | Very unusual (Perl is part of every Debian-based system): `sudo apt install perl-base`. On Windows, use the `exiftool.exe` download instead of the Perl `exiftool` script |
| install.bat: "Python 3 was not found" | Install Python (step 3a) and run `install.bat` again |
| Test: "the exiftool helper exited without an answer" | Python crashed before answering: in Command Prompt run `py -3 --version` (Linux: `python3 --version`) to check Python itself works |
| Dates are 8 hours "off" | Expected: the date is written in UTC without a time zone, like the time in the filename |

## When downloads stop working

Instagram changes its web app often. Follow [context.md → "When Instagram changes something"](context.md#when-instagram-changes-something):
read the error toast, run the `tools/diagnose.js` health check, and turn on Diagnose mode in Settings.

## Files

| Path | What it does |
|---|---|
| `manifest.json` | Permissions (`downloads`, `storage`, Instagram host access) and content scripts |
| `background.js` | Saves files with `chrome.downloads` and decides the folder of every download |
| `shared/settings.js` | Settings defaults, filename/folder building; shared by all parts |
| `options.html/.js/.css` | Settings page |
| `sites/instagram.js` | Instagram buttons, API calls and file selection |
| `sites/instagram-page.js` | Tiny helper running in Instagram's page context to read which post an element shows |
| `native/` | exiftool helper (`mediadownloader_exiftool.py`) and its installers; runs outside Chrome |
| `tools/diagnose.js` | Health check to paste into the console on Instagram when downloads stop working (not part of the extension's runtime) |

See [context.md](context.md) for how downloading works per site and [smoke-test.md](smoke-test.md) for the
checklist to confirm everything still works.
