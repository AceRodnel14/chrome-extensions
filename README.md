# chrome-extensions

Chrome extensions (Manifest V3) for personal use. They work in any Chromium-based browser: Google Chrome, Brave,
Microsoft Edge and Chromium, on Windows and Linux.

## Current list

| Extension | What it does | Details |
|---|---|---|
| [Media Downloader](Media%20Downloader/) | Adds download buttons to Instagram (posts, carousels, reels, stories, highlights, profile pictures), X/Twitter (photos, videos and GIFs in posts, profile pictures, banners) YouTube posts (images on a channel's Posts tab and post pages, channel avatar and banner; not videos) and Reddit (images, galleries, GIFs and videos hosted on Reddit) and saves the original-resolution files. Also sorts every other download into a folder named after its website, and can write the post date into the files with exiftool. | [README](Media%20Downloader/README.md) |
| [Download Organizer](Download%20Organizer/) | Runs in the background and sorts downloaded files into folders based on their source websites. | [README](Download%20Organizer/README.md) |

**Use one or the other, not both.** Media Downloader already includes Download Organizer's folder sorting. Both
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
- When a site changes something: [context.md](Media%20Downloader/context.md) has a troubleshooting guide per site,
  [smoke-test.md](Media%20Downloader/smoke-test.md) the checklist, and `tools/` a health check per site
  (`diagnose.js` for Instagram, `diagnose-x.js`, `diagnose-youtube.js`, `diagnose-reddit.js`).

Its extension ID is fixed (`cedeopcefllcjmmkopihgkkngehmfmmk`) on every computer and browser.

## Quick instructions

1. Go to `chrome://extensions/` (Brave: `brave://extensions/`, Edge: `edge://extensions/`).
2. Enable **Developer mode** (top right switch).
3. Click **Load unpacked**.
4. Choose the extension's folder (the one that contains `manifest.json`), e.g. `Media Downloader`.
5. Reload any tabs that were already open on the sites the extension works with.

Put the folder somewhere permanent first: the browser loads the extension from that folder every time it starts.
Unpacked extensions do not update themselves: after `git pull` (or replacing the files), click the extension's reload
arrow on the extensions page and reload the open tabs. Media Downloader's README has the steps for each case,
including a copied folder and moving to a new folder: [Updating an installed version](Media%20Downloader/README.md#updating-an-installed-version).

Media Downloader's exiftool helper needs extra steps; see its
[installation guide](Media%20Downloader/README.md#installation).

## License

[GNU General Public License v3.0](LICENSE).
