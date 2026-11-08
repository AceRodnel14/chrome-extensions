# Smoke test

Run this after changing the extension, after a Chrome update, or whenever Instagram, X, YouTube, Reddit, RedNote, Naver Blog or Naver Entertain looks different. It takes
about 10 minutes. Each check says what to do and what should happen; see [context.md](context.md) for how each part works.

## Automated run (optional)

[`tools/smoke/smoke.py`](tools/smoke/smoke.py) runs the download checks for you in the WSL test Chrome (Linux,
profile `~/.mediadownloader-chrome-profile`; it starts that Chrome if it isn't running and loads the extension).
The pages it visits are listed in [`tools/smoke/cases.toml`](tools/smoke/cases.toml), whose header explains each field.
It holds public pages only; for a specific post or user, add a case with `interactive = true`.

```bash
uv run tools/smoke/smoke.py                      # all cases (run from media-downloader/)
uv run tools/smoke/smoke.py --only youtube       # one site or case id (repeatable or comma-separated)
uv run tools/smoke/smoke.py --interactive        # pause before every case: open the page yourself, press Enter
```

Cases marked `interactive = true` (stories, highlights and other specific posts) always wait: the script names the page
to open, you open it in the test Chrome and press Enter. The script reloads the extension when it starts, so open or
reload the page at its prompt: a tab opened before the run fails with "Extension context invalidated". A plain run, or `--only instagram` / `--only reddit`, therefore stops at them;
`--only youtube-posts,reddit-pics,x-nasa-post,x-nasa-tile,instagram-nasa-tile` runs only the unattended ones.

For each case it opens the page, clicks the download button, reads the toast and checks the new files in
`~/Downloads/<site>/`. It also runs the site's `tools/diagnose*.js` health check where a case says `diagnose = true`.
Downloaded files are kept; the log lists them. Each run writes `tools/smoke/logs/<date-time>/` (git-ignored):

- `run.log`: everything that happened, in order, for reading.
- `results.jsonl`: one JSON line per case, health-check row and console line; give this file to an AI to troubleshoot.
- Screenshots of failed cases.

It exits with 0 when everything passed, 1 when a case or health check failed, and 2 on a setup problem (Chrome or the
extension could not be started or loaded, or a bad case in `cases.toml`). The manual checklist below still covers what the
script can't: settings, stories/highlights, and checking that files open.

## Before you start

- [ ] Load the extension (`chrome://extensions` → Load unpacked) and **reload** it after any code change.
- [ ] download-organizer (and the old IMDownloader) are **disabled**. Otherwise downloads land in the wrong folder
      with the wrong name, or you get two sets of buttons.
- [ ] Logged in to Instagram, X and RedNote in this browser (YouTube posts and Reddit work logged out too).
- [ ] Settings at their defaults: filename pattern `username_--website--_createdDate`, Save location empty,
      "Also sort all other downloads" on, file size Original, Instagram, X (Twitter), YouTube (posts), Reddit, RedNote, Naver Blog and Naver Entertain enabled, Prefer description YYMMDD date off, Diagnose mode off
      (exiftool on or off as you use it; its checks are in their own section).
- [ ] Run the health checks first, pasting each into the console (F12): [`tools/diagnose.js`](tools/diagnose.js) on an
      Instagram profile with posts and highlights, [`tools/diagnose-x.js`](tools/diagnose-x.js) on an X profile with
      photo posts, [`tools/diagnose-youtube.js`](tools/diagnose-youtube.js) on a YouTube channel's Posts tab,
      [`tools/diagnose-reddit.js`](tools/diagnose-reddit.js) on a subreddit, [`tools/diagnose-rednote.js`](tools/diagnose-rednote.js)
      on a RedNote profile, [`tools/diagnose-naver-blog.js`](tools/diagnose-naver-blog.js) on a Naver blog post (desktop and
      mobile), [`tools/diagnose-naver-entertain.js`](tools/diagnose-naver-entertain.js) on a Naver Entertain article (and
      again on the photo viewer). Every row
      should be PASS (or SKIP/INFO with a reason); the last console line lists any failed rows. A FAIL already tells you which part to look at.
- [ ] Reload any Instagram, X, YouTube, Reddit, RedNote, Naver Blog and Naver Entertain tab that was open before the extension was (re)loaded.
- [ ] Open the page console (F12) and filter on `mediadownloader` to spot errors.

For every download below, check **three things**: the toast goes from "Downloading N files…" to a green "Saved N of N files …" (amber
means every file saved but some dates could not be set; red means files are missing), the file really is in the
site's folder (`Downloads\instagram.com\`, `Downloads\x.com\`, `Downloads\youtube.com\`, `Downloads\reddit.com\`, `Downloads\rednote.com\`, `Downloads\blog.naver.com\`, `Downloads\entertain.naver.com\`), and it opens (image shows /
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
| Y3 | Any of these | Compare the filename's date with the post's "x days ago" | The exact publish time in your time zone with its offset, e.g. `+0800` (open the post: same day) |
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
| R1 | Gallery post **in a feed** (home or a subreddit, not the post page) | Click the circle-arrow at the right end of the action row | One file per item, `_0` …, full size (e.g. 4096×3072), in gallery order; the post does **not** open |
| R2 | Image post (`i.redd.it`) | Click the button | One file, the uploaded size and type |
| R3 | Video post (`v.redd.it`) | Click the button | One `.mp4` **with sound**, the highest resolution offered |
| R4 | GIF post on r/gifs (`i.redd.it/….gif`) | Click the button | One animated `.gif` |
| R5 | GIF converted to video (`gif @ v.redd.it`) | Click the button | One silent `.mp4` (its date may fail in exiftool: "sidx box", see context.md) |
| R6 | Crosspost of a video or a gallery | Click the button | The original post's files, named after the subreddit it was **shared to** (where you clicked), with the original post's date |
| R7 | Link to another site (YouTube, imgur …) | Look at the action row | No download button |
| R7b | RedGifs post in a feed (`link @ redgifs.com`) | Click the button | One `.mp4` (full size, with sound if the clip has it), named after the subreddit with the Reddit post's date; the post does **not** open |
| R8 | A post's own page (`/r/<sub>/comments/<id>/…`) | Click the button | Same as R1–R6 |
| R9 | Ad in the feed | Look at it | No button |
| R10 | File size Small, then a video and a gallery | Click the buttons | Video at the lowest resolution; gallery images still full size (Reddit images are always original) |

## RedNote: buttons and downloads

Logged in. Files go to `Downloads\rednote.com\`, named `<rednote ID>_--rednote--_<date>…`. Health check:
[`tools/diagnose-rednote.js`](tools/diagnose-rednote.js). Keep it to a few clicks: many lookups in a short time make
RedNote ask for a security check.

| # | Where | Do | Expect |
|---|---|---|---|
| N1 | A profile's grid, a photo post | Click the button on the tile | Every photo, `_0` …, original size (e.g. 2316 px tall), right extension, no watermark; the post does **not** open |
| N2 | Same grid, a video post | Click the button on the tile | One `.mp4`, no watermark |
| N3 | Open a post (it shows as `/discovery/item/…`) | Click the button | Same files as from its tile |
| N4 | The profile picture | Click the badge | `<rednote ID>_--rednote--_profile.jpg`, full size (e.g. 1170×1170) |
| N5 | Go to another profile **without reloading**, download a post | Click | Named after the **second** profile's rednote ID |
| N6 | A live photo post (if you find one) | Click | Each photo followed by its clip (`.mp4`) |
| N7 | Prefer description YYMMDD date on | Download a post | Same file name as with it off |
| N8 | Logged out | Look at a profile | RedNote's login overlay; nothing wrong is saved |

## Naver Blog: buttons and downloads

No login needed for public posts. Files go to `Downloads\blog.naver.com\`, named
`<blogId>_--naver--_<local date with offset>_<n>.jpg`, where `<n>` is the picture's 0-based position in the post (always present).
The post's own date is shown in Korean time (UTC+9), the file name in your time zone. Health check:
[`tools/diagnose-naver-blog.js`](tools/diagnose-naver-blog.js). One click saves one picture; the unit tests are
`node --test media-downloader/tools/tests/naver-blog.test.js`.

| # | Where | Do | Expect |
|---|---|---|---|
| NB1 | A desktop post (`blog.naver.com/<blogId>/<logNo>`) | Look at the pictures | A button on every JPG/PNG picture inside the post frame; none in the page's outer frame or on the blog's post list |
| NB2 | Same post | Click the button on the 4th picture | One file, `<blogId>_--naver--_<date>_3.jpg`; Naver's image viewer does **not** open; the toast says "Saved …" |
| NB3 | Same post | Compare the date in the name with the date under the title | Same moment: the title shows KST, the name your zone (14:00 KST = 13:00 in GMT+8, `+0800`) |
| NB4 | Same post | Open the file | Full size (up to 3840 px wide), not a thumbnail; a picture uploaded wider than 3840 px is scaled down |
| NB5 | A post with a single picture | Click its button | Name ends with `_0` |
| NB6 | A mobile post (`m.blog.naver.com/<blogId>/<logNo>`) | Click a button | Same name pattern and the same date as on desktop; same bytes as the desktop file for that picture |
| NB7 | A picture lazily loaded as you scroll | Scroll down | Buttons appear on the later pictures too |
| NB8 | Post with GIF pictures, stickers or link-preview cards (if you find one) | Look | No button on them |
| NB9 | Prefer description YYMMDD date on | Download a picture | Same file name as with it off |
| NB10 | Settings → Naver Blog off | Look at an open post | Buttons disappear; back on and they return |

## Naver Entertain: buttons and downloads

No login needed. Use the mobile site `m.entertain.naver.com` (the desktop host redirects there). Files go to
`Downloads\entertain.naver.com\`, named `<press name>_--naver--_<local date with offset>_<n>.jpg`: the press name is Korean without
spaces; `<n>` is the picture's 0-based position in the article (always present), in the viewer the picture's file number.
The article shows its time in Korean time (UTC+9), the file name in your time zone. Health check:
[`tools/diagnose-naver-entertain.js`](tools/diagnose-naver-entertain.js). One click saves one picture; the unit tests are
`node --test media-downloader/tools/tests/naver-entertain.test.js media-downloader/tools/tests/naver-shared.test.js`.

| # | Where | Do | Expect |
|---|---|---|---|
| NE1 | A news article (`m.entertain.naver.com/home/article/<oid>/<aid>`) with several pictures | Look at the article | A button on every JPG/PNG picture of the article body; none on the thumbnails of the related lists |
| NE2 | Same article | Click the button on the 2nd picture | One file, `<press>_--naver--_<date>_1.jpg`; the toast says "Saved …" |
| NE3 | Same article | Compare the date in the name with the 입력 line under the title | Same moment: the page shows KST, the name your zone (오후 3:44 = 15:44 KST = 14:44 in GMT+8; 오전 12:xx is 00:xx KST, the previous day in GMT+8). The 수정 time is never used |
| NE4 | Same article | Open the file | Full size, not a 647 px thumbnail |
| NE5 | A photo article (`/photo/article/<oid>/<aid>`) | Click its button | Name ends with `_0`; same press name and date rules |
| NE6 | The photo viewer (`/entertain?…#main/<imgId>`) | Look at the page | One button on the picture, not one per slide |
| NE7 | Same viewer | Click the button, press the right arrow to the next picture, click again | Two files, each for the picture that was on screen at the click: `<press>_--naver--_<date>_<file number>.jpg`; the date matches the footer (minute precision, seconds 00) |
| NE8 | Same viewer | Compare the name's press and date with the footer line `<press> \| YYYY.MM.DD. 오전\|오후 H:MM` | Press name without spaces, date as in NE3 |
| NE9 | An article that is reached by clicking a link on another article | Look at it once loaded | Buttons appear without reloading |
| NE10 | Prefer description YYMMDD date on | Download a picture | Same file name as with it off |
| NE11 | Settings → Naver Entertain off | Look at an open article | Buttons disappear; back on and they return |

## Settings

| # | Do | Expect |
|---|---|---|
| 16 | Change the filename pattern to `website-username-createdDate`, Save, then download a post **without reloading** Instagram | File named `instagram-<user>-<date>.jpg`; the "Example:" preview updated as you typed |
| 17 | Set file size to Small, Save, download an image | A small image (about 150–320 px) |
| 18 | Set Save location to `Media\Social`, Save, download a post | File in `Downloads\Media\Social\instagram.com\`; folders created automatically |
| 19 | Type `C:\Users\you\Pictures` as Save location and click Save | Red message about Chrome's Downloads folder; "Not saved"; the previous value is still in effect |
| 20 | Turn Instagram off under Enabled websites, Save | All buttons disappear from open Instagram tabs immediately; turn it back on and they return. Same for X (Twitter), YouTube (posts), Reddit and RedNote |
| 21 | Turn on Diagnose mode, Save, download anything | Console (filter `mediadownloader`) shows `[mediadownloader:diagnose]` lines for each step; turn it off again |
| 21a | Tick **Prefer description YYMMDD date**, Save, reload Settings, then reload the extension | Still ticked after both (settings survive updates) |
| 21b | With it on, download an Instagram post or reel whose caption has one `YYMMDD` (e.g. `261024 …`) | `createdDate` = that date at 08:00 UTC in your zone (`T160000+0800` in GMT+8); every carousel file the same |
| 21c | With it on, download a Reddit post whose title has one `YYMMDD`, and an X post whose text has one | Same: the title's / post text's date at 08:00 UTC in your zone (`T160000+0800` in GMT+8) |
| 21d | With it on, download a post with no `YYMMDD` (or two of them), and a YouTube post | The real publish time, as with the setting off (YouTube never uses the option) |
| 21e | With exiftool on, check a file from 21b | DateTimeOriginal = that date at 08:00 UTC in your zone (`YYYY:MM:DD 16:00:00` in GMT+8, `OffsetTime*` `+08:00`), the same time as the filename |
| 22 | Put every setting back to the defaults above | |

## exiftool (only if you use it)

Prerequisite: helper installed (`native/install.bat` or `native/install.sh`), Chrome restarted.

| # | Do | Expect |
|---|---|---|
| E1 | Settings → exiftool folder: type a wrong folder, click Test | Red "folder does not exist" / "No exiftool found in …" |
| E2 | Enter the right folder, click Test | "exiftool 13.xx found (…)" |
| E3 | Tick "Write the post date…", Save; download a carousel with a video | Toast "Downloading N files… The dates are set when they are done." then green "Saved N of N files. Dates set on N." |
| E4 | Check a downloaded photo and the video: `exiftool -G1 -a -time:all <file>` (or Windows: right-click → Properties → Details → "Date taken" / "Media created") | Photo: dates = the filename's `createdDate` (same local time), `OffsetTime*` = your offset. Video: QuickTime, Track and Media Create/Modify dates = the same moment as the filename, stored in UTC, none `0000:00:00`. Both: File Modification Date = the same moment |
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
something"**, **"When Reddit changes something"**, **"When RedNote changes something"** **"When Naver changes something"** (Naver Blog) or **"When Naver Entertain changes something"**. In short:

1. Read the error toast: it names the call that failed.
2. Run the site's health check: paste [`tools/diagnose.js`](tools/diagnose.js) (Instagram profile),
   [`tools/diagnose-x.js`](tools/diagnose-x.js) (X profile) or [`tools/diagnose-youtube.js`](tools/diagnose-youtube.js)
   (YouTube channel's Posts tab), [`tools/diagnose-reddit.js`](tools/diagnose-reddit.js) (subreddit) or
   [`tools/diagnose-rednote.js`](tools/diagnose-rednote.js) (RedNote profile) or
   [`tools/diagnose-naver-blog.js`](tools/diagnose-naver-blog.js) (Naver blog post) or
   [`tools/diagnose-naver-entertain.js`](tools/diagnose-naver-entertain.js) (Naver Entertain article or viewer) into the console.
3. Turn on **Diagnose mode** in Settings, reload the site, retry the failing button and read the console
   (filter `mediadownloader`). A renumbered query is often fixed automatically at this point.

Quick checks that need no tools:

- **No buttons anywhere**: the extension is not running in that tab. Reload the tab; check Enabled websites; check
  `chrome://extensions` for errors.
- **"rate limiting"**: wait a few minutes. **"log in"**: log in again.
- **Toast says Saved but the file is in the wrong folder or has a CDN name** (`123456_789_n.jpg`): another
  download extension (download-organizer) is still enabled.

Turn Diagnose mode off again when done.
