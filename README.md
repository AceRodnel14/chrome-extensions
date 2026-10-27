# chrome-extensions

Chrome extensions (Manifest V3) for personal use. They work in any Chromium-based browser: Google Chrome, Brave,
Microsoft Edge and Chromium, on Windows and Linux.

## Current list

| Extension | What it does | Details |
|---|---|---|
| [Media Downloader](media-downloader/) | Adds download buttons to Instagram (posts, carousels, reels, stories, highlights, profile pictures), X/Twitter (photos, videos and GIFs in posts, profile pictures, banners) YouTube posts (images on a channel's Posts tab and post pages, channel avatar and banner; not videos) and Reddit (images, galleries, GIFs and videos hosted on Reddit, and RedGifs clips linked from posts) and saves the original-resolution files. Also sorts every other download into a folder named after its website, and can write the post date into the files with exiftool. | [README](media-downloader/README.md) |
| [Download Organizer](download-organizer/) | Runs in the background and sorts downloaded files into folders based on their source websites. | [README](download-organizer/README.md) |
| [Passman](passman/) | Autofills logins from your self-hosted passman password manager. Reuses your passman web session (never your login password), shows a button in login fields on matching sites and a toolbar popup with the entries for the current tab. Contacts passman only when you act. Can export a backup from its options. Does not save new passwords. | [README](passman/README.md) |

**Media Downloader and Download Organizer: use one or the other, not both.** Media Downloader already includes Download Organizer's folder sorting. Both
extensions rename every download, and the browser only applies one extension's choice, so running them together
puts files in the wrong folders with the wrong names. Keep Download Organizer only if you want the folder sorting
without Media Downloader.

### Media Downloader

Replaces the earlier "MODIFIED IMDownloader" in this repository, which was removed when it stopped working.
Media Downloader is a fork of [IMDownloader](https://chromewebstore.google.com/detail/imdownloader-download-sto/fkilgeompmipodhkdmafejpfgnfbjmkk)
4.0.3 by Faruk Cepni, rewritten from scratch: Instagram had retired the endpoints IMDownloader used for stories and
highlights, and its download buttons no longer appeared in several places. The rewrite has no analytics, remote
configuration or subscription check. Since then it has added X (Twitter), YouTube posts and Reddit.

- Settings: filename pattern (`username`, `createdDate`, `website`), save location, file size, enabled websites,
  Diagnose mode.
- Optional exiftool helper (`native/`): writes the post date into photos and videos. Needs Python 3 and exiftool,
  plus a one-time `install.bat` (Windows) or `install.sh` (Linux).
- When a site changes something: [context.md](media-downloader/context.md) has a troubleshooting guide per site,
  [smoke-test.md](media-downloader/smoke-test.md) the checklist, and `tools/` a health check per site
  (`diagnose.js` for Instagram, `diagnose-x.js`, `diagnose-youtube.js`, `diagnose-reddit.js`).

Its extension ID is fixed (`cedeopcefllcjmmkopihgkkngehmfmmk`) on every computer and browser.

## Quick instructions

1. Go to `chrome://extensions/` (Brave: `brave://extensions/`, Edge: `edge://extensions/`).
2. Enable **Developer mode** (top right switch).
3. Click **Load unpacked**.
4. Choose the extension's folder (the one that contains `manifest.json`), e.g. `media-downloader` or `passman`.
5. Reload any tabs that were already open on the sites the extension works with.

Put the folder somewhere permanent first: the browser loads the extension from that folder every time it starts.
Unpacked extensions do not update themselves: after `git pull` (or replacing the files), click the extension's reload
arrow on the extensions page and reload the open tabs. Media Downloader's README has the steps for each case,
including a copied folder and moving to a new folder: [Updating an installed version](media-downloader/README.md#updating-an-installed-version).

Passman needs its server address set in its options and an active passman web session (sign in once in a tab); see its
[setup](passman/README.md#setup). Media Downloader's exiftool helper needs extra steps; see its
[installation guide](media-downloader/README.md#installation).

**Folders renamed:** `Media Downloader` is now `media-downloader`, `Download Organizer` is now `download-organizer`
and `Passman` is now `passman`. If your browser loaded one of the old folders, it reports it as missing after
`git pull`: remove it on the extensions page and **Load unpacked** the new folder. Removing an extension deletes its
settings, so note them first:

- Media Downloader keeps its fixed ID. Re-enter its settings and re-run its exiftool helper installer from the new
  folder; see [moving to a new folder](media-downloader/README.md#updating-an-installed-version).
- Passman gets a new ID (it has no fixed one). Set its server address in its options again and allow access when
  asked; your passman web session is unaffected.
- Download Organizer has no settings.

## License

[GNU General Public License v3.0](LICENSE).

---

_Developed with assistance from Claude (Claude Opus 5.5)._
