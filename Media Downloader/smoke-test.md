# Smoke test

Run this after changing the extension, after a Chrome update, or whenever Instagram, X, YouTube or Reddit looks different. It takes
about 10 minutes. Each check says what to do and what should happen; see [context.md](context.md) for how each part works.

## Before you start

- [ ] Load the extension (`chrome://extensions` → Load unpacked) and **reload** it after any code change.
- [ ] download-organizer (and the old IMDownloader) are **disabled**. Otherwise downloads land in the wrong folder
      with the wrong name, or you get two sets of buttons.
- [ ] Logged in to Instagram and X in this browser (YouTube posts and Reddit work logged out too).
- [ ] Settings at their defaults: filename pattern `username_--website--_createdDate`, Save location empty,
      "Also sort all other downloads" on, file size Original, Instagram, X (Twitter), YouTube (posts) and Reddit enabled, Diagnose mode off
      (exiftool on or off as you use it; its checks are in their own section).
- [ ] Run the health checks first, pasting each into the console (F12): [`tools/diagnose.js`](tools/diagnose.js) on an
      Instagram profile with posts and highlights, [`tools/diagnose-x.js`](tools/diagnose-x.js) on an X profile with
      photo posts, [`tools/diagnose-youtube.js`](tools/diagnose-youtube.js) on a YouTube channel's Posts tab,
      [`tools/diagnose-reddit.js`](tools/diagnose-reddit.js) on a subreddit. Every row
      should be PASS (or SKIP/INFO with a reason). A FAIL already tells you which part to look at.
- [ ] Reload any Instagram, X, YouTube and Reddit tab that was open before the extension was (re)loaded.
- [ ] Open the page console (F12) and filter on `mediadownloader` to spot errors.

For every download below, check **three things**: the toast goes from "Downloading N files…" to a green "Saved N of N files …" (amber
means every file saved but some dates could not be set; red means files are missing), the file really is in the
site's folder (`Downloads\instagram.com\`, `Downloads\x.com\`, `Downloads\youtube.com\`, `Downloads\reddit.com\`), and it opens (image shows /
video plays).

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
| 9 | Profile picture (someone else's profile with a photo) | Click the badge on the bottom-right of the avatar | `<user>_--instagram--_profile.jpg` in Instagram's HD size, usually **1080×1080** (some accounts only have 1000×1000; never the 150 px thumbnail); the story viewer does **not** open |
| 10 | Profile picture after in-app navigation | From the home feed click a post author's name (no page reload), then click the badge | The new person's picture in HD (not the previous profile's, not the 150 px thumbnail) |
| 11 | Your own profile without a photo | Look at the avatar | No badge ("Add a profile photo" is not a picture) |
| 12 | Story | Open a story from the tray, go to the 2nd or 3rd slide, pause, click the top-right button | Exactly one file, the slide on screen; its `createdDate` matches the story's age |
| 13 | Highlight | Open a highlight from a profile, go to a later slide, pause, click | Exactly one file, the slide on screen (`_<index>` matches the slide position, starting at 0) |
| 14 | Story/highlight fallback | Only if 12/13 save the whole set: that means slide detection failed | The whole set is saved instead of a wrong slide; report it |
| 15 | Right after any download | Click the same button again | A second copy with ` (1)` added; nothing is overwritten |

## X (Twitter): buttons and downloads

Logged in to X in this browser. Files go to `Downloads\x.com\`, named `<handle>_--x--_<date>…`. The X health check is
[`tools/diagnose-x.js`](tools/diagnose-x.js) (paste on an X profile).

| # | Where | Do | Expect |
|---|---|---|---|
| X1 | Profile or home timeline, post with several photos | Click the circle-arrow after Share | One file per photo, `_0` … `_3`, full size (`name=orig`, e.g. 1536×2048) |
| X2 | Post with a video (Media tab → Videos lists them) | Click the button | One `.mp4`, 1920×1080 when the video has it, plays with sound |
| X3 | Post with a GIF | Click the button | One `.mp4` that loops the GIF |
| X4 | Post without media that quotes a post with media | Click the outer post's button | The quoted post's files, named after the **quoted** account and date |
| X5 | Repost ("<name> reposted") with media | Click the button | The original post's files, named after the original author |
| X6 | Post page (`/<user>/status/<id>`) | Click the main post's button | Same as X1/X2 |
| X7 | Photo viewer: click a photo, go to the 2nd one with → | Click the button in the bottom bar | Exactly one file, `_1` (the photo on screen) |
| X8 | Media tab → Photos (`?filter=photo`) | Hover a tile, click the button bottom-right | All files of that post; the viewer does **not** open |
| X9 | Profile picture | Click the badge on the avatar | `<handle>_--x--_profile.jpg`, 400×400; the photo viewer does not open |
| X10 | Banner | Click the badge on the banner | `<handle>_--x--_banner.jpg`, 1500×500 |
| X11 | After in-app navigation to another profile (click a name, no reload) | Click the avatar badge | The new person's picture |
| X12 | Text-only post | Click the button | Red "This post has no photos or videos." |

## YouTube posts: buttons and downloads

Files go to `Downloads\youtube.com\`, named `<handle>_--youtube--_<date>…`. The health check is
[`tools/diagnose-youtube.js`](tools/diagnose-youtube.js) (paste on a channel's Posts tab). @MrBeast/posts has every post type.

| # | Where | Do | Expect |
|---|---|---|---|
| Y1 | Channel → Posts tab, post with several images | Click the circle-arrow after Comments | One file per image, `_0` …, the full upload (e.g. 3072×4096), **not** the square crop shown |
| Y2 | Post with one image | Click the button | One file, no `_0`; a PNG upload is saved as `.png` |
| Y3 | Any of these | Compare the filename's date with the post's "x days ago" | The exact publish time in UTC (open the post: same day) |
| Y4 | Text post, text-only poll, post sharing a video | Look at the toolbar | No download button |
| Y5 | A post's own page (click its time, `/post/<id>`) | Click the button | Same as Y1/Y2 |
| Y6 | Channel avatar | Click the badge on the avatar | `<handle>_--youtube--_profile.jpg` at full size (e.g. 2152×2152) |
| Y7 | Channel banner | Click the badge on the banner | `<handle>_--youtube--_banner.<ext>` at full size (e.g. 2560×1440) |
| Y8 | Another channel without reloading (search, click it, open Posts) | Click the avatar badge | The new channel's picture |
| Y9 | A channel's Home tab with a "Posts" shelf (e.g. https://www.youtube.com/@Yujinators/featured), and Videos tab | Look at the posts, avatar and banner | **No** download buttons anywhere |
| Y10 | Same Home tab | Click a post in the shelf | Its `/post/<id>` page opens with the download button; a multi-image post saves **all** its images (the shelf only shows the first) |
| Y11 | From Y10, press Back, then click the Posts tab | Look at the page | Home tab: no buttons again; Posts tab: buttons on posts, avatar and banner |

## Reddit: buttons and downloads

Files go to `Downloads\reddit.com\`, named `<subreddit>_--reddit--_<date>…` (e.g. `Gaeul_IVE_--reddit--_…`). Health check:
[`tools/diagnose-reddit.js`](tools/diagnose-reddit.js). Good test pages: a K-pop member subreddit (galleries, videos,
crossposts) and r/gifs/new (uploaded GIFs).

| # | Where | Do | Expect |
|---|---|---|---|
| R1 | Gallery post | Click the circle-arrow at the right end of the action row | One file per item, `_0` …, full size (e.g. 4096×3072), in gallery order; the post does **not** open |
| R2 | Image post (`i.redd.it`) | Click the button | One file, the uploaded size and type |
| R3 | Video post (`v.redd.it`) | Click the button | One `.mp4` **with sound**, the highest resolution offered |
| R4 | GIF post on r/gifs (`i.redd.it/….gif`) | Click the button | One animated `.gif` |
| R5 | GIF converted to video (`gif @ v.redd.it`) | Click the button | One silent `.mp4` (its date may fail in exiftool: "sidx box", see context.md) |
| R6 | Crosspost of a video or a gallery | Click the button | The original post's files, named after the subreddit it was **shared to** (where you clicked), with the original post's date |
| R7 | Crosspost of / link to another site (redgifs, YouTube, imgur …) | Look at the action row | No download button |
| R8 | A post's own page (`/r/<sub>/comments/<id>/…`) | Click the button | Same as R1–R6 |
| R9 | Ad in the feed | Look at it | No button |
| R10 | File size Small, then a video and a gallery | Click the buttons | Video at the lowest resolution; gallery images still full size (Reddit images are always original) |

## Settings

| # | Do | Expect |
|---|---|---|
| 16 | Change the filename pattern to `website-username-createdDate`, Save, then download a post **without reloading** Instagram | File named `instagram-<user>-<date>.jpg`; the "Example:" preview updated as you typed |
| 17 | Set file size to Small, Save, download an image | A small image (about 150–320 px) |
| 18 | Set Save location to `Media\Social`, Save, download a post | File in `Downloads\Media\Social\instagram.com\`; folders created automatically |
| 19 | Type `C:\Users\you\Pictures` as Save location and click Save | Red message about Chrome's Downloads folder; "Not saved"; the previous value is still in effect |
| 20 | Turn Instagram off under Enabled websites, Save | All buttons disappear from open Instagram tabs immediately; turn it back on and they return. Same for X (Twitter), YouTube (posts) and Reddit |
| 21 | Turn on Diagnose mode, Save, download anything | Console (filter `mediadownloader`) shows `[mediadownloader:diagnose]` lines for each step; turn it off again |
| 22 | Put every setting back to the defaults above | |

## exiftool (only if you use it)

Prerequisite: helper installed (`native/install.bat` or `native/install.sh`), Chrome restarted.

| # | Do | Expect |
|---|---|---|
| E1 | Settings → exiftool folder: type a wrong folder, click Test | Red "folder does not exist" / "No exiftool found in …" |
| E2 | Enter the right folder, click Test | "exiftool 13.xx found (…)" |
| E3 | Tick "Write the post date…", Save; download a carousel with a video | Toast "Downloading N files… The dates are set when they are done." then green "Saved N of N files. Dates set on N." |
| E4 | Check a downloaded photo and the video: `exiftool -DateTimeOriginal -CreateDate -ModifyDate <file>` (or Windows: right-click → Properties → Details → "Date taken" / "Media created") | All equal the `createdDate` in the filename (UTC clock time) |
| E5 | Download a story slide | "Saved … Date set."; date = the slide's own post time |
| E6 | Download a profile picture | Plain green "Saved …profile.jpg." with no date part (profile pictures have no post date) |
| E7 | Uninstall the helper (`install.bat uninstall` / `install.sh --uninstall`), restart Chrome, download | File saved; amber toast "Saved … Dates set on 0 of 1; not set: …: the exiftool helper is not installed …". Reinstall afterwards |
| E8 | A download that fails after starting (e.g. turn off Wi-Fi during a large video, or cancel it in Chrome's download bar) | Red "Only N−1 of N files saved. Failed: <file>: <reason>"; the numbers match what is in the folder |

## Other downloads (the download-organizer part)

| # | Do | Expect |
|---|---|---|
| 23 | Download any ordinary file from another site (e.g. a PDF or a GitHub release) | Saved in `Downloads\<domain>\` (e.g. `github.com`), `www.` removed, Chrome's own file name kept |
| 24 | With Save location `Media\Social`, repeat 23 | Saved in `Downloads\Media\Social\<domain>\` |
| 25 | Turn off "Also sort all other downloads", repeat 23 | Saved straight into `Downloads\`, untouched |

## When something fails

Follow context.md → **"When Instagram changes something"**, **"When X changes something"**, **"When YouTube changes
something"** or **"When Reddit changes something"**. In short:

1. Read the error toast: it names the call that failed.
2. Run the site's health check: paste [`tools/diagnose.js`](tools/diagnose.js) (Instagram profile),
   [`tools/diagnose-x.js`](tools/diagnose-x.js) (X profile) or [`tools/diagnose-youtube.js`](tools/diagnose-youtube.js)
   (YouTube channel's Posts tab) or [`tools/diagnose-reddit.js`](tools/diagnose-reddit.js) (subreddit) into the console.
3. Turn on **Diagnose mode** in Settings, reload the site, retry the failing button and read the console
   (filter `mediadownloader`). A renumbered query is often fixed automatically at this point.

Quick checks that need no tools:

- **No buttons anywhere**: the extension is not running in that tab. Reload the tab; check Enabled websites; check
  `chrome://extensions` for errors.
- **"rate limiting"**: wait a few minutes. **"log in"**: log in again.
- **Toast says Saved but the file is in the wrong folder or has a CDN name** (`123456_789_n.jpg`): another
  download extension (download-organizer) is still enabled.

Turn Diagnose mode off again when done.
