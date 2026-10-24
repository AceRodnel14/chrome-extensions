# Smoke test

Run this after changing the extension, after a Chrome update, or whenever Instagram looks different. It takes
about 10 minutes. Each check says what to do and what should happen; see [context.md](context.md) for how each part works.

## Before you start

- [ ] Load the extension (`chrome://extensions` → Load unpacked) and **reload** it after any code change.
- [ ] download-organizer (and the old IMDownloader) are **disabled**. Otherwise downloads land in the wrong folder
      with the wrong name, or you get two sets of buttons.
- [ ] Logged in to Instagram in this browser.
- [ ] Settings at their defaults: filename pattern `username_--website--_createdDate`, Save location empty,
      "Also sort all other downloads" on, file size Original, Instagram enabled, Diagnose mode off
      (exiftool on or off as you use it; its checks are in their own section).
- [ ] Run the health check first: on an Instagram profile with posts and highlights, paste
      [`tools/diagnose.js`](tools/diagnose.js) into the console (F12). Every row should be PASS (or SKIP/INFO with a
      reason). A FAIL already tells you which part to look at.
- [ ] Reload any Instagram tab that was open before the extension was (re)loaded.
- [ ] Open the page console (F12) and filter on `mediadownloader` to spot errors.

For every download below, check **three things**: the green "Saved …" toast appears, the file really is in
`Downloads\instagram.com\`, and it opens (image shows / video plays).

## Instagram: buttons and downloads

| # | Where | Do | Expect |
|---|---|---|---|
| 1 | Home feed, single image post | Click the circle-arrow next to Like/Comment/Share | One `.jpg`, named `<owner>_--instagram--_<date>.jpg`, full resolution (usually 1080 px wide or more) |
| 2 | Home feed, video post | Click the button | One `.mp4` that plays, with sound |
| 3 | Home feed, carousel (several slides, mix of image + video if you can find one) | Click the button | One file per slide, `_0`, `_1`, …; videos are `.mp4` |
| 4 | Home feed, ad | Look at it | No button is fine (ads have no permalink) |
| 5 | Post page (`/p/<code>/`, open a post in its own tab) | Click the button | Same as 1–3 |
| 6 | Reels viewer (`/reels/`) | Click the button above Save; scroll to the next reel; click again | Each time the file belongs to the reel on screen (check the username in the filename) |
| 7 | Profile → Posts grid | Hover a tile, click the button bottom-right | Files saved; the post does **not** open |
| 8 | Profile → Reels tab | Hover a tile, click the button | `.mp4` saved; the reel does not open. (This was broken in IMDownloader.) |
| 9 | Profile picture (someone else's profile with a photo) | Click the badge on the bottom-right of the avatar | `<user>_--instagram--_profile.jpg` at **1080×1080**; the story viewer does **not** open |
| 10 | Profile picture after in-app navigation | From the home feed click a post author's name (no page reload), then click the badge | The new person's picture, 1080×1080 (not the previous profile's, not the 150 px thumbnail) |
| 11 | Your own profile without a photo | Look at the avatar | No badge ("Add a profile photo" is not a picture) |
| 12 | Story | Open a story from the tray, go to the 2nd or 3rd slide, pause, click the top-right button | Exactly one file, the slide on screen; its `createdDate` matches the story's age |
| 13 | Highlight | Open a highlight from a profile, go to a later slide, pause, click | Exactly one file, the slide on screen (`_<index>` matches the slide position, starting at 0) |
| 14 | Story/highlight fallback | Only if 12/13 save the whole set: that means slide detection failed | The whole set is saved instead of a wrong slide; report it |
| 15 | Right after any download | Click the same button again | A second copy with ` (1)` added; nothing is overwritten |

## Settings

| # | Do | Expect |
|---|---|---|
| 16 | Change the filename pattern to `website-username-createdDate`, Save, then download a post **without reloading** Instagram | File named `instagram-<user>-<date>.jpg`; the "Example:" preview updated as you typed |
| 17 | Set file size to Small, Save, download an image | A small image (about 150–320 px) |
| 18 | Set Save location to `Media\Social`, Save, download a post | File in `Downloads\Media\Social\instagram.com\`; folders created automatically |
| 19 | Type `C:\Users\you\Pictures` as Save location and click Save | Red message about Chrome's Downloads folder; "Not saved"; the previous value is still in effect |
| 20 | Turn Instagram off under Enabled websites, Save | All buttons disappear from open Instagram tabs immediately; turn it back on and they return |
| 21 | Turn on Diagnose mode, Save, download anything | Console (filter `mediadownloader`) shows `[mediadownloader:diagnose]` lines for each step; turn it off again |
| 22 | Put every setting back to the defaults above | |

## exiftool (only if you use it)

Prerequisite: helper installed (`native/install.bat` or `native/install.sh`), Chrome restarted.

| # | Do | Expect |
|---|---|---|
| E1 | Settings → exiftool folder: type a wrong folder, click Test | Red "folder does not exist" / "No exiftool found in …" |
| E2 | Enter the right folder, click Test | "exiftool 13.xx found (…)" |
| E3 | Tick "Write the post date…", Save; download a carousel with a video | Toast "Saved N files. Setting dates…" then "Dates set on N files." |
| E4 | Check a downloaded photo and the video: `exiftool -DateTimeOriginal -CreateDate -ModifyDate <file>` (or Windows: right-click → Properties → Details → "Date taken" / "Media created") | All equal the `createdDate` in the filename (UTC clock time) |
| E5 | Download a story slide | "Dates set on 1 file."; date = the slide's own post time |
| E6 | Download a profile picture | No "Setting dates…" (profile pictures have no post date) |
| E7 | Uninstall the helper (`install.bat uninstall` / `install.sh --uninstall`), restart Chrome, download | File saved; toast "Saved, but setting the date failed: the exiftool helper is not installed …". Reinstall afterwards |

## Other downloads (the download-organizer part)

| # | Do | Expect |
|---|---|---|
| 23 | Download any ordinary file from another site (e.g. a PDF or a GitHub release) | Saved in `Downloads\<domain>\` (e.g. `github.com`), `www.` removed, Chrome's own file name kept |
| 24 | With Save location `Media\Social`, repeat 23 | Saved in `Downloads\Media\Social\<domain>\` |
| 25 | Turn off "Also sort all other downloads", repeat 23 | Saved straight into `Downloads\`, untouched |

## When something fails

Follow context.md → **"When Instagram changes something"**. In short:

1. Read the error toast: it names the call that failed.
2. Run the health check: paste [`tools/diagnose.js`](tools/diagnose.js) into the console on an Instagram profile.
3. Turn on **Diagnose mode** in Settings, reload Instagram, retry the failing button and read the console
   (filter `mediadownloader`). A renumbered query is often fixed automatically at this point.

Quick checks that need no tools:

- **No buttons anywhere**: the extension is not running in that tab. Reload the tab; check Enabled websites; check
  `chrome://extensions` for errors.
- **"rate limiting"**: wait a few minutes. **"log in"**: log in again.
- **Toast says Saved but the file is in the wrong folder or has a CDN name** (`123456_789_n.jpg`): another
  download extension (download-organizer) is still enabled.

Turn Diagnose mode off again when done.
