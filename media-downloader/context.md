# How mediadownloader gets files

This file explains, per website, where the download buttons come from, which APIs are called to find the
original files, and how the files are saved. Supported: Instagram, X (Twitter), YouTube posts, Reddit, RedNote, Naver Blog and Naver Entertain; add a section
per new site.

Last verified against the live sites: **2026-10-30** (Chrome 156): Instagram, X, YouTube posts and Reddit.

---

## Common to all websites

### Saving files

- The content script for a site works out the list of files (`{ url, filename }`) and sends it to the background
  worker: `chrome.runtime.sendMessage({ type: "download", site, files })`.
- `background.js` saves each one with `chrome.downloads.download({ url, filename: path, conflictAction: "uniquify" })`.
  That only says Chrome *accepted* the download; a file can still fail afterwards (404, network error). So each click
  is followed as one **batch** until every download is `complete` or `interrupted`, and only then does the page get its
  verdict (see "The download report" below). Until then the toast says "Downloading N files…".
- Why `chrome.downloads` and not a page-level `<a download>` click (what IMDownloader did): page-level downloads
  are rate-limited per site by Chrome's "this site wants to download multiple files" prompt and fail silently
  once blocked; `chrome.downloads` is not, and it reports real errors.
- The file's URL is the site's CDN URL directly; nothing is proxied or re-encoded.

### Paths

`<Save location>/<website folder>/<filename>`, all relative to Chrome's Downloads folder:

| Part | Where it comes from |
|---|---|
| Save location | Settings. Optional. Relative only: `chrome.downloads` rejects absolute paths, so `C:\…` is refused in Settings. `\` and `/` both work; `..`, unsafe characters and Windows reserved names (CON, NUL, …) are cleaned. |
| Website folder | For button downloads: the site's main host (`MDSettings.SITES[].hosts[0]`, e.g. `instagram.com`, `x.com`, `youtube.com`, `reddit.com`, `rednote.com`, `blog.naver.com`, `entertain.naver.com`). For every other download: the domain of the file's URL without `www.` (download-organizer's rule). |
| Filename | The filename pattern from Settings with `username`, `createdDate`, `website` filled in, plus `_<index>` for carousels and story sets. `createdDate` is the publish time, or the description date when that setting is on (see "Description date"). |

### Folders for all other downloads (download-organizer)

`background.js` listens to `chrome.downloads.onDeterminingFilename`, which Chrome fires for **every** download:

- Downloads started by mediadownloader itself (`item.byExtensionId === chrome.runtime.id`) get back exactly the
  path that was requested (Chrome would otherwise let this listener override it).
- Any other download, if "Also sort all other downloads" is on, goes to `<Save location>/<domain>/<Chrome's file name>`.
  `blob:` URLs use the page origin inside them (`blob:https://www.instagram.com/…` → `instagram.com`).
  `data:` URLs have no domain and no referrer, so they are left where Chrome puts them.
- Only one extension's `onDeterminingFilename` suggestion wins, so download-organizer must not run alongside.

### Post dates in files (exiftool helper)

Optional (Settings → "Photo and video dates (exiftool)"). Chrome extensions cannot start programs, so this uses
Chrome **native messaging**: `native/mediadownloader_exiftool.py`, registered under the name
`com.mediadownloader.exiftool` (the installers register it for Chrome, Brave, Edge and Chromium) for extension ID `cedeopcefllcjmmkopihgkkngehmfmmk` only (pinned by the `key` in
`manifest.json`; unpacked extensions otherwise get a different ID per folder).

1. The content script sends each file with `takenAt` (Unix seconds = publish time: Instagram `taken_at`, X `created_at`,
   YouTube's post page `publishDate`, Reddit `created_utc`, RedNote the note's `time`, Naver Blog and Naver Entertain the post's publish time).
2. `background.js` starts the downloads and records the click's download IDs as one batch in `chrome.storage.session`
   (survives the worker being stopped during long downloads). Every click gets a batch, with or without exiftool.
3. When every download of the batch is `complete` or `interrupted` (`chrome.downloads.onChanged`), the completed
   files that have a `takenAt` go to the helper in **one** message: `{action: "setDates", exiftoolDir, files: [{path, takenAt}]}`.
4. The helper finds exiftool in that folder (`exiftool.exe`, or the Perl `exiftool` script run with `perl`;
   `exiftool(-k).exe` is refused because it waits for a key press), writes an exiftool argument file with one
   block per file separated by `-execute`, and runs exiftool **once** for the batch. `-echo3`/`-echo4` markers split
   the output so each file gets its own result.
5. The result goes into the batch's report (below).

### Description date (optional)

Settings → **Prefer description YYMMDD date** (Instagram, Reddit and X only), off by default (`preferDescriptionDate` in `chrome.storage.sync`; like
every setting it survives updates and reloads, and only Remove/uninstall clears it). When on, each content script
passes the post's description to `MDSettings.postTime(realSeconds, text, settings)` (`shared/settings.js`):

| Site | Description |
|---|---|
| Instagram | the post's caption (`caption.text` of the post, not of each carousel slide) |
| Reddit | the post **title** (for a crosspost, the original post's title, where the files and date already come from) |
| X | the post text (`note_tweet` for long posts, else `full_text`; for a repost, the original post) |

Only these three sites call `postTime`. YouTube, RedNote, Naver Blog and Naver Entertain posts always keep the real publish time (for Naver the description date does not apply at all), and a site added later does not use the option unless the user decides it should.

`MDSettings.descriptionDate(text)` removes URLs (`https?://…`, including t.co links), then looks for six digits
`YYMMDD` with no letter or digit directly before or after (`#261107`, `[261107]`, `261107_x` count; `20261107`,
`IMG261107`, `lamhyj91` do not). A match counts only if it is a real date (month 01–12, a day that exists, leap
years). If there is **exactly one** match, that date at **08:00 UTC** becomes the post time: `takenAt` and
`createdDate` are both derived from it, so the filename and the exiftool dates agree, and every file of the post
gets it. No match, two different dates, or the same date written twice: the real publish time is kept. Stories
(no caption) and profile pictures are unchanged. Tests: `node --test media-downloader/tools/tests/*.test.js`.

### The download report

When a batch is finished, `background.js` sends the tab one `batchResult`:
`{ total, saved, savedFiles, failed: [{ filename, error }], dates: null | { total, set, notSet: [{ filename, error }] } }`.
`failed` holds downloads that did not start or were interrupted (Chrome's reason in words, e.g. "the site has no such
file (404)"); `dates` is `null` when exiftool is off or no file has a post date (profile pictures). `shared/report.js`
(`MDReport.summary`) turns it into the toast every site shows:

| Outcome | Colour | Example |
|---|---|---|
| Every file saved, every date set (or no dates needed) | green | `Saved 4 of 4 files. Dates set on 4.` / `Saved x.com/WE_NMIXX_--x--_profile.jpg.` |
| Every file saved, some dates not set (a format exiftool cannot write, helper missing) | amber | `Saved 1 of 1 … Dates set on 0 of 1; not set: <file>.mp4: Can't yet handle sidx box when writing` |
| A file missing | red | `Only 1 of 2 files saved. Failed: <file>.jpg: the site has no such file (404)` |

So the numbers always add up: files asked for = saved + failed, and dates set + not set = saved files with a post
date. Reddit adds "N gallery items could not be saved" for gallery items it skips before downloading.

Tags and value (since 0.3.0), per file in the argument file: `-m -overwrite_original -api QuickTimeUTC=1
-AllDates=STAMP -CreationTime=STAMP -ModifyDate=STAMP -OffsetTime*=OFF -TrackCreateDate=STAMP -TrackModifyDate=STAMP
-MediaCreateDate=STAMP -MediaModifyDate=STAMP -FileModifyDate=STAMP`. STAMP is the post instant (`takenAt`) in the
**computer's local time with its offset**, e.g. `2026:11:07 16:00:00+08:00` for 08:00 UTC in the Philippines; OFF is
that offset (`+08:00`), taken for the post's own date so daylight saving is right (`local_stamp` in the helper).
`-api QuickTimeUTC=1` is repeated in every block: exiftool resets options at each `-execute`, so on the command line it
would apply to the first file only. Since 0.3.1 the filename's `createdDate` shows the same local time and offset
(`MDSettings.formatDate`, e.g. `2026-11-07T160000+0800`). The extension (browser) and the helper (Python) each use their
own zone: on one PC they agree, but a WSL Chrome with a different `TZ` from the Windows Python would not.

- Photos (JPEG, HEIC, WebP, PNG): the EXIF/XMP dates show the local clock time, with `OffsetTime*` saying which zone.
- MP4/MOV: `QuickTimeUTC` makes exiftool convert STAMP to UTC for the movie, track and media dates (UTC by standard),
  so all of them hold the same instant; before 0.3.0 the per-track dates stayed `0000:00:00`, and
  `UserData:DateTimeOriginal` got the computer's offset appended to a UTC value (8 hours wrong for readers that use it).
- The file's own modification time ("Date modified") is the post instant too.
- exiftool writes what each format supports and silently skips the rest (`-m`; checked: JPEG, HEIC, WebP, PNG,
  MP4/MOV). `-m` also lets it write despite "[minor]" problems, such as the non-standard EXIF in some PNGs from
  YouTube posts ("IFD0 pointer references previous IFD0 directory"), which otherwise fail the file.
- **Immich** (checked against Immich v3.3.6 `server/src/services/metadata.service.ts`, by simulating its exiftool
  reads, not on a live server): it takes the first of SubSecDateTimeOriginal, SubSecCreateDate, DateTimeOriginal,
  CreationDate, CreateDate, MediaCreateDate, …; a date with an offset keeps it (timeline time and day grouping in
  that zone), a zoneless one counts as UTC, QuickTime dates are UTC, and the file time is only a fallback. So photos
  and videos land at the post instant, shown and grouped in the computer's zone. Re-check after major Immich updates.
- Profile pictures (no post date) and other downloads are not touched.
- Tests: `PYTHONDONTWRITEBYTECODE=1 uv run --with pytest pytest -p no:cacheprovider media-downloader/tools/tests/test_exiftool_helper.py`
  (set `EXIFTOOL_DIR` to an exiftool folder to also run the real-exiftool test, and `EXIFTOOL_TEST_MP4=<any small .mp4>`
  to include a video in it).

Settings → **Test** sends `{action: "version", exiftoolDir}` and shows the exiftool version or the helper's error
(including "helper not installed", which is Chrome's "Specified native messaging host not found").

### Enabled websites

`MDSettings.SITES` lists every supported site. A site's content script only adds buttons while its switch is on in
Settings; switching it off removes the buttons from open tabs immediately (via `chrome.storage.onChanged`). A site is
added to the list only once its content script exists. Naver Blog is listed as `naver-blog` and Naver Entertain as `naver-entertain` (not `naver`), because every
Naver site needs its own entry and folder; they share the filename token `naver`. The helpers the Naver sites share
(file extension, Korean time parser, press-name space removal) live in `shared/naver.js` (global `MDNaver`), loaded
before the site file; the pasted diagnose scripts keep marked copies.

---

## Instagram

Content scripts on `https://*.instagram.com/*`:

- `sites/instagram.js`: isolated world. Buttons, API calls, file selection.
- `sites/instagram-page.js`: runs in the page's own world (`"world": "MAIN"`), because only there can React props be
  read. The isolated script dispatches `md:resolve` on an element; the helper walks the element's React fiber
  (`__reactFiber$…` → `.return` …), finds the nearest props object with a media `code` (shortcode) or numeric `pk`,
  and writes it to the element's `data-md-media` attribute.

All requests are made from the content script on `www.instagram.com`, so they carry the user's logged-in cookies.
Nothing is sent anywhere except Instagram and its CDN.

### Request basics

| Item | Value | Notes |
|---|---|---|
| App ID header | `X-IG-App-ID: 936619743392459` | Instagram web app ID; required by `/api/v1/` |
| CSRF header | `X-CSRFToken: <csrftoken cookie>` | GraphQL only |
| LSD token | `X-FB-LSD` header and `lsd` form field | Scraped from the page's scripts: `"LSD",[],{"token":"…"}` |
| DTSG token | `fb_dtsg` form field | Scraped from the page's scripts: `"DTSGInitialData",[],{"token":"…"}`. Required since 2026-10-30: without it (or on the old `/graphql/query` endpoint) the user search returns an HTML page instead of data. |
| Credentials | `credentials: "include"` | Uses the browser's Instagram session |

GraphQL calls are `POST /api/graphql` (the endpoint Instagram's own web app uses; until 2026-10-30 this was
`/graphql/query`) with form fields `doc_id`, `variables` (JSON), `lsd`, `fb_dtsg`, `server_timestamps=true`.
The `doc_id`s are Instagram's persisted query IDs. **They are the part most likely to break.** `DOC` in
`sites/instagram.js` keeps each one with its operation name; Instagram's scripts define them as
`__d("<Name>_instagramRelayOperation",[],(function(a,b,c,d,e,f){e.exports="<doc_id>"}),null);`, which is how
Diagnose mode and `tools/diagnose.js` find the current value. See "When Instagram changes something" below.

### Endpoints used

| What | Call | Returns |
|---|---|---|
| Post, reel, carousel | `GET /api/v1/media/{mediaId}/info/` | `items[0]` with `image_versions2.candidates`, `video_versions`, `carousel_media`, `taken_at`, `user.username` |
| Story and highlight items | GraphQL `doc_id 29299425373007309` (was 39400183649572570 until 2026-10-30) (`PolarisStoriesV3HighlightsPageQuery`), variables `{ reel_ids: [id], initial_reel_id: id, first: 1, __relay_internal__pv__PolarisCommunityNoteStoriesLabelEnabledrelayprovider: true }` where `id` is a user ID (stories) or `"highlight:<id>"` | `data.xdt_api__v1__feed__reels_media__connection.edges[0].node` with `items[]` and `user` |
| Profile (HD profile picture) | GraphQL `doc_id 40158838120366999` (was 28717443601247930 until 2026-10-27) (`PolarisProfilePageContentQuery`), variables `{ id, enable_integrity_filters: true, …7 relay provider flags }` | `data.user.hd_profile_pic_url_info.url` (usually 1080×1080; 1000×1000 for some accounts, e.g. nmixx_official). Fails with "execution error" unless every flag in `PROFILE_FLAGS` is sent. |
| Username → user ID | GraphQL `doc_id 27634848489527274` (`PolarisSearchBoxNonProfiledRefetchableQuery`), variables `{ hasQuery: true, query: username }` | `data.xdt_api__v1__fbsearch__non_profiled_serp.users[]`; exact username match only. Cached per page. (IMDownloader's older `26347858941511777` still answered on 2026-10-24 but is no longer in Instagram's scripts.) |

Shortcode → media ID: base64 with alphabet `A–Z a–z 0–9 - _`, read as a big integer (`mediaIdFromCode`). Private
posts' shortcodes carry a 28-character suffix that is dropped first.

### Picking the file

- Each media item has either `video_versions` (video) or `image_versions2.candidates` (image). A carousel has
  `carousel_media[]`, one file per slide, numbered `_0`, `_1`, ….
- File size setting: **Original** = largest candidate (sorted by `width` when present), **Small** = smallest,
  **Medium** = about a quarter of the way down the list. Highlight `video_versions` have no `width`, so the first is used.
- Extension from the CDN URL path (`.jpg`, `.mp4`, `.webp`, `.heic`), else `mp4`/`jpg` by type.
- `username` = the media owner (for collab posts that can differ from the profile being viewed); `createdDate` =
  `taken_at` in local time with its offset (`2026-10-24T192727+0800` in GMT+8); profile pictures use `profile`.

### Where the buttons go and how each finds its media

| Button | Placement (found without Instagram's generated class names) | What it downloads |
|---|---|---|
| Feed post, post page | Action bar = nearest ancestor of the Like icon (`svg[aria-label="Like"]`) that also holds Save; button appended to the Like/Comment/Share group | Shortcode from React props of the Like icon, else the post's permalink in the `<article>`, else the URL |
| Reels viewer (`/reels/`) | Same action bar, vertical layout: inserted above Save | Shortcode from React props (`media.code`). The URL often stays `/reels/` and the DOM has no link to the reel, so React is the only source. |
| Grid tile (profile Posts/Reels/Tagged, explore) | Any `a[href*="/p/"]` / `a[href*="/reel/"]` at least 100×100 px; bottom-right, shown on hover | Shortcode from the tile's link. Reels-tab tiles draw the thumbnail as a CSS background, so no `<img>` is required. |
| Story / highlight | Fixed, top-right under the viewer's close button, while the URL is `/stories/…` | See below |
| Profile picture | Badge on the bottom-right of the avatar (`img[alt="<username>'s profile picture"]`) | HD URL from the page's embedded JSON if present, else the profile GraphQL query (user ID from the page's `profilePage_<id>`, verified against the username, else looked up by search), else the on-page 150 px thumbnail |

**Which story slide is showing.** The viewer pre-renders neighbouring stories, so the page has several media
elements and timestamps. Matching order:

1. Story ID in the URL (`/stories/<user>/<storyId>/`) when present.
2. The `<time datetime>` inside the same card as the largest visible image/video; its value equals the item's
   `taken_at`.
3. `pk` from React props of that timestamp or of the media element.
4. The shown image's CDN file name against each item's `image_versions2` file names.
5. If nothing matches, the whole story/highlight set is saved rather than a wrong slide.

### Endpoints that no longer work (do not use)

Checked 2026-10-24; these were what IMDownloader relied on:

| Endpoint | Now returns |
|---|---|
| `GET /api/v1/feed/reels_media/?reel_ids=…` (stories and highlights) | 500 "something went wrong" |
| `GET /api/v1/feed/user/{id}/story/` | 200, but an HTML page instead of JSON |
| `GET /api/v1/feed/user/{id}/` (profile posts) | HTML page instead of JSON |
| `GET /api/v1/users/web_profile_info/?username=…` | Works, but rate-limited quickly (429) |

### Diagnose mode

Off by default; switch it on in Settings only while investigating. While off, downloads do no extra work; error
messages still name the call that failed (e.g. "Profile query failed: …"), which costs nothing.

While on:

- Every step is logged in the page console with the prefix `[mediadownloader:diagnose]`: the button and target,
  each request (operation, doc_id, variables, whether the LSD/fb_dtsg/CSRF tokens were found), each response, which method
  found the post code or story slide, the files to save and `chrome.downloads`' results.
- Error toasts include the technical detail in `[…]`: request, doc_id, HTTP status, Instagram's error text.
- When a GraphQL query fails (anything except "log in" and "rate limited"), the current doc_id for that operation
  name is looked up in the Instagram scripts the page already loaded. If it differs, the query is retried once; if
  that works the new id is saved to `chrome.storage.local` → `learnedDocIds` and used from then on, even with
  Diagnose mode off. Settings lists remembered ids and can forget them (back to the built-in ones).

### Rate limits

Instagram starts answering 429 after many API calls in a short time. mediadownloader only calls the API when a
button is clicked, caches username → user ID, and uses data already embedded in the page when it can.

### When Instagram changes something

Instagram changes its web app often. When downloads stop working, go through this in order; most problems are
found by step 2.

**1. Run the smoke test's failing case** ([smoke-test.md](smoke-test.md)) to see which button or page type is broken,
and read the toast: it names the call that failed (`Post lookup`, `Stories/highlights query`, `Profile query`,
`User search`, `Finding the post`, `Saving`).

**2. Run the health check.** Open a profile with posts and highlights, press F12 → Console, paste
[`tools/diagnose.js`](tools/diagnose.js), press Enter. It tests every call mediadownloader depends on and prints a
PASS/FAIL table. (Chrome may ask you to type "allow pasting" the first time.) The first rows show the page, the
Chrome version and whether mediadownloader is active in the tab; the last line of the console lists the failed rows.
A check that cannot run on the page says SKIP; a hung request says "timed out after 10 s" and does not stop the rest.

| FAIL row | Meaning | Fix |
|---|---|---|
| Logged in / CSRF token | Session expired | Log in again |
| LSD token / DTSG token | Instagram moved or renamed the token in the page | Find the new token: View source, search for `LSD` / `DTSGInitialData`; update the regex in `gqlRequest` (sites/instagram.js) and in diagnose.js |
| `doc_id …` says CHANGED | Instagram renumbered a query | Step 3a |
| Post lookup | `/api/v1/media/{id}/info/` changed or was retired | Step 3b; capture what Instagram's own post page calls now |
| File download from CDN | CDN blocks the request | Check the HTTP status; rare |
| User search / Profile query / Story / Highlight with "Instagram error" or "execution error" | Query id or its variables changed | Step 3a, then 3b if the id did not change |
| … with "no xdt_api__… / data keys […]" | The response shape changed | Step 3b; update the path that reads the result |
| … with "not JSON (a web page?)" | Endpoint retired | Step 3b |
| Profile picture element | The avatar's `alt` text changed | Update `injectProfilePicture` (sites/instagram.js) |
| mediadownloader buttons: none | Placement rules no longer match | Step 4 |
| HTTP 429 | Rate limited | Wait a few minutes, run again |

**3a. A query id changed.** Turn on **Diagnose mode** in Settings, reload the Instagram tab and click the
failing button again. If the new id is in the page's scripts, mediadownloader finds it, retries, and remembers it
(Settings → Diagnose mode lists it). To make it permanent, copy the new id into `DOC` in `sites/instagram.js` and
`BUILT_IN` in `tools/diagnose.js`, then click "Forget remembered ids".
If Diagnose mode logs "no newer doc_id found", the operation was renamed or the page that loads it has not been
opened yet: open the page where Instagram itself shows that content (a story, a profile), then try again, or go to 3b.

**3b. Capture what Instagram itself does now** (for changed variables, renamed operations or retired endpoints):

1. Open DevTools → **Network**, tick "Preserve log", filter on `graphql` (or `api/v1`).
2. Do the action in Instagram itself (open the story, the profile, the post) and look for the request that
   carries the media: click requests and use the **Response** tab's search for `video_versions` or
   `image_versions2` (profile picture: `hd_profile_pic_url_info`).
3. In its **Payload**: `fb_api_req_friendly_name` is the operation name, `doc_id` the id, `variables` the JSON to
   send. Copy all three, including every `__relay_internal__pv__…` flag: missing flags cause "execution error".
4. Update `DOC` (name + id), the variables in the matching function (`getReel`, `getProfile`, `userIdByUsername`,
   `getPost`) and, if the response path changed, the line that reads it. Mirror the change in `tools/diagnose.js`.
5. Check the data is embedded in the page instead (search the page source for `xdt_api__` or
   `hd_profile_pic_url_info`); Instagram sometimes renders it into the HTML and makes no request at all.

**4. Buttons missing or on the wrong media.** Inspect the element where the button should be and compare with
the "Where the buttons go" table. Prefer stable hooks (`aria-label`, `alt`, `href` patterns, `<time datetime>`,
React props through `instagram-page.js`) over Instagram's generated class names, which change with every release.
With Diagnose mode on, the console shows which source found the post code or story slide.

**5. Re-run the health check and the smoke test**, then update the "Last verified" date at the top of this file
and the endpoint tables if anything changed.

---

## X (formerly Twitter)

Content scripts on `https://*.x.com/*` and `https://*.twitter.com/*` (twitter.com redirects to x.com):

- `sites/x.js`: isolated world. Buttons, file selection, the API fallback.
- `sites/x-page.js`: runs in the page's own world (`"world": "MAIN"`). The isolated script dispatches `md:resolve` on
  an element, optionally with `data-md-want="<post id>"`; the helper looks the post up and writes its media to the
  element's `data-md-media` attribute as `{ source, id, createdAt, username, media: [{ type, url, variants }], quoted }`.

Unlike Instagram, X already has every post on screen in the page, so **downloads normally make no API call at all**.

### Where the post data comes from

In this order (Diagnose mode logs which one answered):

| Source | How it is found | Notes |
|---|---|---|
| Redux store | Walk down the React tree from `#react-root` to the `<Provider>` whose props have `store.getState`; `getState().entities.tweets.entities[<id>]` | Posts are normalized: `user`, `retweeted_status`, `quoted_status` are ids, resolved through `entities.users.entities` / `entities.tweets.entities`. Used whenever the post id is known (grid tiles, photo viewer, any post with a timestamp link). |
| React props | Walk up from the clicked element (`__reactFiber$…` → `.return`) to the first `memoizedProps.tweet` with an `id_str` | Same fields, but `user` etc. are full objects. Used when no id was found. |
| GraphQL `TweetResultByRestId` | `GET /i/api/graphql/<queryId>/TweetResultByRestId?variables=…&features=…` | Only when the post is not in the page. See "Request basics". |

Fields used (store / props, and the same under `legacy` in GraphQL): `extended_entities.media[]` with `type`
(`photo`, `video`, `animated_gif`), `media_url_https` and `video_info.variants[]`; `created_at`; the owner's
`screen_name`. A **repost** is replaced by the post it reposts (`retweeted_status`), so the original author and date
are used (not yet seen live: no repost was on screen on 2026-10-24; quotes were). A post **without media that quotes one with media** saves the quoted post's files (named after the quoted
post's author and date).

### Request basics (fallback only)

| Item | Value | Notes |
|---|---|---|
| Authorization | `Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D…` | X's public web-app token, the same for everyone |
| CSRF header | `x-csrf-token: <ct0 cookie>` | |
| Other headers | `x-twitter-auth-type: OAuth2Session`, `x-twitter-active-user: yes` | `x-client-transaction-id` is **not** needed for this query (checked 2026-10-24) |
| Variables | `{ tweetId, withCommunity: false, includePromotedContent: false, withVoice: false }` | |
| Features | Every name in the query's `featureSwitches`, all `false` | X rejects the call if one is missing; the values do not matter for media |
| Response | `data.tweetResult.result` (a `Tweet`, or `TweetWithVisibilityResults` with `.tweet`) → `legacy.extended_entities.media`, `legacy.created_at`, `core.user_results.result.core.screen_name` | Reposts: `legacy.retweeted_status_result.result`; quotes: `quoted_status_result.result` |

X's `main.<hash>.js` (`abs.twimg.com/responsive-web/client-web/`) defines each query as
`{queryId:"…",operationName:"TweetResultByRestId",operationType:"query",metadata:{featureSwitches:[…],fieldToggles:[…]}}`,
which is how Diagnose mode and `tools/diagnose-x.js` find the current id and feature list. The built-in values are
`DOC` and `TWEET_FEATURES` in `sites/x.js`.

### Picking the file

- **Photos**: `media_url_https` is `https://pbs.twimg.com/media/<key>.<ext>`; the file saved is
  `…/media/<key>?format=<ext>&name=<size>` with size `orig` (Original), `medium` (≤1200 px) or `small` (≤680 px).
  `orig` is the uploaded file (checked: 1536×2048, the same as `large` and `4096x4096` for that photo).
- **Videos and GIFs**: the `video/mp4` variants of `video_info.variants`, sorted by `bitrate`. Original = highest
  (up to 1920×1080), Small = lowest, Medium = the middle one. The `.m3u8` variant is ignored. The `<video>` element
  on the page plays a `blob:` stream, so its URL is of no use.
- **Profile picture**: the avatar `<img>` URL without its size suffix (`…_200x200.jpg` → `….jpg`), which is the
  400×400 original; X keeps nothing larger.
- **Banner**: the banner `<img>` URL without its size path (`…/600x200` → `…`), which is the 1500×500 original.
- `username` = the post owner's handle (`WE_NMIXX`); `createdDate` = `created_at` as ISO without colons; profile
  pictures use `profile` and banners `banner`; `website` = `x`. Several files in one post get `_0`, `_1`, ….
- `takenAt` (for exiftool) = `created_at` in Unix seconds.

### Where the buttons go and how each finds its post

| Button | Placement | What it downloads |
|---|---|---|
| Post (timelines, post page, search, …) | Every `[role="group"]` that holds `[data-testid="reply"]` and `[data-testid="like"]`/`"unlike"`, appended after Share; icon colour copied from the Reply icon | All photos/videos of the post. Id from the link around the post's `<time>` (a quoted post has none, so the outer post is used); on a post page the main post (`article[tabindex="-1"]`) falls back to the URL; then React props |
| Photo/video viewer (`/<user>/status/<id>/photo/<n>`) | Same action bar inside the `[role="dialog"]`, no `<article>` | Only the photo or video on screen (`n` from the URL, which changes as you page through). The viewer's side panel has a second, hidden copy |
| Media tab → Photos grid (`/<user>/media?filter=photo`) | Tiles: `a[href*="/status/<id>/photo/1"]` (or `/video/1`) at least 100×100 px and not inside an `<article>`; bottom-right, shown on hover | All files of that post (the tile's link gives the id). The Media tab's default "Videos" view lists normal posts, which get post buttons |
| Profile picture | Badge on `a[href="/<user>/photo"]` that holds a `profile_images` `<img>` | 400×400 original |
| Banner | Badge on `a[href="/<user>/header_photo"]` that holds a `profile_banners` `<img>` | 1500×500 original |

X lazy-loads images, so in a background tab the profile and banner badges appear when the tab is shown.

### Diagnose mode on X

Same switch as Instagram. While on, the console shows which source found the post (store, React props, X's API),
the API request and response, and the files saved. When the fallback query fails (anything except log in / rate
limit), the current `queryId` **and feature list** are read from `main.js` and the call is retried once; a new id is
remembered in `learnedDocIds` (Settings lists it next to Instagram's). Since downloads rarely reach the API, a
changed queryId usually goes unnoticed until the health check reports it.

### When X changes something

**1. Read the toast** and run the X rows of [smoke-test.md](smoke-test.md).

**2. Run the health check**: on an X profile with photo posts, F12 → Console, paste
[`tools/diagnose-x.js`](tools/diagnose-x.js).

| FAIL row | Meaning | Fix |
|---|---|---|
| Logged in / CSRF token | Session expired | Log in again |
| Redux store | X moved the store or stopped using Redux | Find where post data lives now (React DevTools on a post); update `findStore` in `sites/x-page.js`. React props still work meanwhile. |
| Posts with media in the store / Post owner | Store shape changed | Inspect `__store.getState().entities`; update `serialize` in `x-page.js` |
| Post React props | The `tweet` prop was renamed | Inspect the fibers above an `<article>`; update `tweetFromFiber` |
| Post element / Action bar | `data-testid`s changed | Update `injectActionBars` (sites/x.js) |
| queryId … (detail starts "CHANGED:") | X renumbered the query | Copy the new id into `DOC` in `sites/x.js` and `BUILT_IN` in `tools/diagnose-x.js`; if the feature list changed, copy it into `TWEET_FEATURES` (diagnose-x.js always uses the current one) |
| X main script | X replaced its web app (the logged-out pages already use a different "x-web" build) | Re-check everything in this section against the new app |
| Post lookup (API) | Variables, headers or response changed | Capture what X itself does: DevTools → Network, filter `TweetResultByRestId` or `TweetDetail`, open a post |
| Photo from CDN | `name=orig` no longer accepted | Check which `name=` values work on a `pbs.twimg.com/media/` URL |
| Profile picture / Banner element | Link or image URL changed | Update `injectProfileImages` |
| mediadownloader buttons: none | Placement rules no longer match | Inspect where the button should be; prefer `data-testid`, `role`, `href` patterns over generated class names |

**3. Re-run the health check and the smoke test**, then update "Last verified" at the top of this file.

---

## YouTube (posts only)

Only on the **posts pages**: a channel's Posts tab (`/@handle/posts`, also `/channel/<id>/posts` and the old
`/community`) and a post's own page (`/post/<id>`), with the channel avatar and banner on the Posts tab. Everywhere
else (a channel's Home tab with its posts shelf, Videos, the home feed, watch pages) there are no buttons: clicking a
post in a shelf opens its `/post/<id>` page, which has one. YouTube navigates without reloading, so the buttons are
removed again when you leave the posts pages. Videos and Shorts are never touched. Content scripts on `https://www.youtube.com/*`:

- `sites/youtube.js`: isolated world. Buttons, file selection, the publish-date lookup.
- `sites/youtube-page.js`: runs in the page's own world (`"world": "MAIN"`), because YouTube's Polymer elements keep
  their data in a `data` property only visible there. The isolated script dispatches `md:resolve` inside a post; the
  helper takes the nearest `ytd-backstage-post-renderer` / `ytd-post-renderer` / `ytd-shared-post-renderer`, reads its
  `data` and writes `{ postId, handle, name, images: [<base url>], attachment }` to `data-md-media`.

### Where the data comes from

| What | Where | Notes |
|---|---|---|
| Images | `data.backstageAttachment`: `backstageImageRenderer.image.thumbnails[]` (one image), `postMultiImageRenderer.images[].backstageImageRenderer…` (several), `pollRenderer.choices[].image.thumbnails[]` (poll with image choices) | The feed only references square 640 px crops (`…=s640-c-fcrop64=…`). Everything after `=` is size/crop options; the URL without them is the full, uncropped upload. |
| Author | `data.authorEndpoint.browseEndpoint.canonicalBaseUrl` = `/@handle` → `username`; falls back to the display name (`authorText`) | |
| Reshared post | `data.originalPost.backstagePostRenderer` | The original post is saved (not yet seen live) |
| **Full image list** | The same post page's `ytInitialData`: the renderer whose `postId` matches → `backstageAttachment` | Posts shown in shelves (a channel's Home tab) only carry their **first** image (`backstageImageRenderer` instead of `postMultiImageRenderer`: 1 of 4 images on @Yujinators, 2026-10-25), so the post page's list is used when it has at least as many |
| **Publish time** | `GET /post/<postId>` (the post's own page, ~860 KB, about 1 s) → `"publishDate":"2026-10-24T02:00:00.189741-07:00"` in `ytInitialData.microformat.microformatDataRenderer`, same value as `datePublished` in the page's JSON-LD | The feed only has relative text ("7 hours ago", "1 month ago"), which is useless for a filename. Cached per page. |

`createdDate` = the publish time in local time with its offset (`2026-10-24T170000+0800` in GMT+8); `takenAt` for exiftool = the same in Unix seconds.

### Picking the file

| Size setting | URL suffix | Result (checked 2026-10-24) |
|---|---|---|
| Original | `=d` | The uploaded file itself, served as an attachment (3072×4096 JPEG; a PNG upload stays PNG) |
| Medium | `=s1280` | Longer side 1280 px, not cropped |
| Small | `=s640` | Longer side 640 px, not cropped |

The extension comes from a `HEAD` request on the chosen URL (`content-type`); yt3 answers youtube.com with
`Access-Control-Allow-Origin`, so the content script may read it. If that fails, `.jpg` is assumed. `=s0` gives the
same pixels as `=d` but re-encoded.

Channel avatar (`yt-page-header-renderer yt-avatar-shape img`, `=s160-…`) and banner (`yt-image-banner-view-model img`,
`=w1060-fcrop64…`), both inside the visible `ytd-tabbed-page-header`, are saved the same way: the avatar original
was 2152×2152, the banner 2560×1440 PNG. `createdDate` is `profile` / `banner`.

### Where the buttons go

| Button | Placement | What it downloads |
|---|---|---|
| Post | `ytd-comment-action-buttons-renderer #toolbar` (Like, Dislike, Share, Comments), appended after Comments; only on posts that contain `ytd-backstage-image-renderer` or a poll with images | Every image of the post, `_0`, `_1`, … for several |
| Channel avatar / banner | Badge on the image's parent | The original upload |

Buttons only appear while the address is a posts page (`onPostsPage` in `youtube.js`). Text posts, text-only polls
and posts that share a video get no button (checked on @MrBeast: 30 image posts with
buttons, 10 others without). YouTube keeps pages visited earlier in the DOM, hidden, so the channel header is the
`ytd-tabbed-page-header` with a non-zero width.

### When YouTube changes something

Run [`tools/diagnose-youtube.js`](tools/diagnose-youtube.js) on a channel's Posts tab (F12 → Console → paste). Its `POST`, `POST_IMAGES` and `onPostsPage` are copies of `sites/youtube.js`; keep them in sync.

| FAIL row | Meaning | Fix |
|---|---|---|
| Post elements / Post data | Elements renamed, or the data moved off `.data` | Inspect a post in the Elements panel; update `POST` and the `data` lookup in both `youtube.js` and `youtube-page.js` |
| Attachment types / Image URL | Attachment renderers renamed | Update `imagesOf` in `youtube-page.js` |
| Original image (=d) | yt3 stopped accepting `=d` or sending CORS | Try `=s0`; if CORS is gone, the type check falls back to `.jpg` (wrong for PNGs) |
| Post date lookup | `/post/<id>` no longer carries `publishDate` / `datePublished` | Search the post page source for the date (`2026-` …) and update `publishDate` in `youtube.js` |
| Post toolbar | Toolbar moved | Update `injectPosts` |
| mediadownloader buttons: none | Placement rules no longer match | Inspect where the button should go |

---

## Reddit

Content script on `https://www.reddit.com/*` (the current Reddit, built from `shreddit-*` elements; old.reddit.com is
not supported): `sites/reddit.js`. It needs no page-world helper: everything it needs is in DOM attributes and
Reddit's own JSON on the same origin.

**Only media Reddit hosts itself** is downloaded: `i.redd.it` (images, GIFs, gallery items) and `v.redd.it`
(videos, converted GIFs), plus **RedGifs clips** linked from posts (see "RedGifs" below). Link posts to any other site
(YouTube, imgur, …) get no button.

### Which posts get a button

Every `shreddit-post` carries `post-type`, `domain`, `id` (`t3_…`), `author` and `created-timestamp` attributes. A
button is added when `post-type` is `image`, `gallery`, `video`, `gif` or `crosspost` **and** `domain` is `i.redd.it`,
`v.redd.it` or `reddit.com` (galleries). Crossposts report their original's domain. Ads are `shreddit-ad-post`
elements and get nothing.

| post-type @ domain (seen 2026-10-24) | What it is |
|---|---|
| `image @ i.redd.it` | One image |
| `gallery @ reddit.com` | Several images (and sometimes GIFs) |
| `video @ v.redd.it` | Video |
| `gif @ i.redd.it` | An uploaded `.gif` |
| `gif @ v.redd.it` | A GIF Reddit converted to a silent video |
| `crosspost @ v.redd.it` / `@ reddit.com` | Crosspost of a Reddit-hosted video / gallery |
| `link @ redgifs.com` / `crosspost @ redgifs.com` | A RedGifs clip: button, see "RedGifs" below |
| `link @ …` other sites | Media on another site: **no button** |

### Placement

The action row (votes, comments, repost, share) is in the post's open shadow root and filled through named slots.
The button is appended to the `shreddit-post` with `slot="action-row-whitespace"`, the free slot at the end of the
row (the `share-button` slot must not be used: its fallback content *is* the Share button).

In feeds, a transparent link to the post (`<a slot="full-post-link" class="absolute inset-0">`) covers the whole
card, so the button needs `position: relative; z-index: 1` to sit above it; otherwise a real click opens the post
(a scripted `.click()` on the button still works, so test with the mouse).

### Where the files come from

On click, `GET /comments/<bare id>.json?raw_json=1&limit=1` (same-origin, with cookies) returns `[postListing, commentsListing]`;
the post is `[0].data.children[0].data`. (`/by_id/t3_<id>.json` and `/api/info.json?id=t3_<id>` return 403 HTML since
2026-10, observed on Chrome 156.) For a crosspost the original is
`crosspost_parent_list[0]` and is used for the files and date.

| Post | Files |
|---|---|
| Gallery | `gallery_data.items[]` (the order) → `media_metadata[media_id]`: `e: "Image"` → `https://i.redd.it/<media_id>.<subtype of m>`; `e: "AnimatedImage"` → `https://i.redd.it/<media_id>.gif`. **The extension must be the uploaded one**: `image/jpg` → `.jpg`, `image/jpeg` → `.jpeg`; the other one is a 404. Other items (videos in galleries) are skipped and the toast says how many. |
| Image / GIF | `url_overridden_by_dest` on `i.redd.it` (the uploaded file; a `.gif` stays an animated GIF) |
| Video / converted GIF | The player's `packaged-media-json` attribute (`shreddit-player`): `playbackMp4s.permutations[].source` = `{ url, bitrateBps, dimensions }` on `packaged-media.redd.it`, **with sound**. If the player is not on screen, the post's own page (`permalink`) is fetched and the attribute read from its HTML. |

Why not `secure_media.reddit_video.fallback_url`: those `CMAF_<n>.mp4` files have **no audio track** (checked: video
track only), because Reddit streams sound separately. They are used only when the video has no sound anyway
(`has_audio: false` or `is_gif: true`) and no packaged mp4 exists.

Sizes: **images and GIFs are always the uploaded file**. Reddit's smaller previews (`preview.redd.it?width=…`) are
cropped (`crop=smart`) and their format depends on what the browser accepts, so they are not used. For videos,
Original = highest bitrate (e.g. 720×1280 or 1082p), Small = lowest, Medium = the middle one.

`username` = the **subreddit** of the clicked post (`subreddit`, e.g. `Gaeul_IVE`), not the poster; for a crosspost
that is the subreddit it was shared to, not the original's; `createdDate` = `created_utc` in local time with its offset; `website` = `reddit`.

### RedGifs

A post's `url_overridden_by_dest` (`https://www.redgifs.com/watch/<id>`; also `/ifr/<id>` and `i.redgifs.com/i/<id>`)
names the clip. RedGifs' API answers only redgifs.com pages (CORS `access-control-allow-origin: https://www.redgifs.com`),
so `sites/reddit.js` sends `{ type: "redgifs", id }` to `background.js`, which has host permission for
`api.redgifs.com`:

1. `GET https://api.redgifs.com/v2/auth/temporary` → `{ token }` (no login; valid about a day; kept in memory and
   fetched again after a 401).
2. `GET https://api.redgifs.com/v2/gifs/<id>` with `Authorization: Bearer <token>` → `gif.urls`: `hd` (full size, with
   sound when `hasAudio`), `sd` (`-mobile.mp4`), `silent`, `thumbnail`, `poster`. 404/410 = removed clip.

RedGifs keeps **no GIF files**, only mp4, so the file is the `.mp4`. Original = `hd`, Medium and Small = `sd`. The
files on `media.redgifs.com` download without cookies or a referer. Name and date come from the **Reddit post**
(subreddit, `created_utc`), like every other Reddit download, not from RedGifs' `createDate`/`userName`.

If RedGifs changes: the error toast says "RedGifs lookup failed: …"; check the two calls above with curl (they work
from anywhere) and update `redgifsFetch` (background.js) or `redgifsFile` (sites/reddit.js).

### exiftool on Reddit files

Some packaged mp4s are fragmented (`sidx` box); exiftool cannot write those yet ("Can't yet handle sidx box when
writing"), so the toast is amber ("Dates set on 0 of 1; not set: …") while the video itself is fine. Seen on a converted GIF. Other
Reddit mp4s needed `-m` ("[minor] Terminator found in Meta…"), which the helper now passes.

### When Reddit changes something

Run [`tools/diagnose-reddit.js`](tools/diagnose-reddit.js) on a subreddit (F12 → Console → paste). Its `HOSTED`, `MEDIA_TYPES`, `isRedgifs` and `SLOT` are copies of `sites/reddit.js`;
keep them in sync. The RedGifs clip lookup runs in the background worker, so the script only checks that RedGifs posts
have a button; test the lookup by clicking one.

| FAIL row | Meaning | Fix |
|---|---|---|
| Post elements / Post attributes | `shreddit-post` or its attributes renamed | Inspect a post; update `injectPosts` (`post-type`, `domain`, `id`) |
| Action row slot | Slot renamed | List the slots in `post.shadowRoot`; pick a free one at the end of the row; update `SLOT` |
| Post lookup | `/comments/<id>.json` changed or blocked (`/by_id` and `/api/info` already return 403) | No other JSON endpoint known; next fallback is the post page's HTML / `shreddit-post` attributes; update `getPost` |
| Gallery data / Original image | `gallery_data` / `media_metadata` changed | Update the gallery branch of `mediaOf` |
| Video packaged mp4s | Player attribute renamed | Inspect the `<shreddit-player>`; look for mp4 URLs with audio (`packaged-media.redd.it`); update `packagedMp4s` |
| No buttons on links to other sites | The `domain` filter let an external post through | Update `HOSTED` |

---

## RedNote

Content script on `https://www.rednote.com/*`: `sites/rednote.js` (isolated world only). Scope, as the user asked:
**profile pages only** (`/user/profile/<uid>`), no feed. RedNote shows a user's notes only when **logged in** (logged out,
a "Log in to view this user's notes" overlay covers the grid). Researched 2026-11-07; details in agentic-config
`research/rednote-media-downloader.md`.

### Where the buttons go

| Button | Where | Note ID and token |
|---|---|---|
| `tile` | Each `section.note-item` in the profile grid | `a.cover[href]` = `/user/profile/<uid>/<noteId>?xsec_token=…`, read at click time (the token can expire) |
| `note` | The opened note (URL `/discovery/item/<noteId>?xsec_token=…`) | From `location` |
| `profile` | The profile header's avatar | — |

A note opened on its own (`/explore/<id>` outside a profile) gets no button: the page has no rednote ID to name it by.

### The rednote ID (filename `username`)

RedNote is a single-page app: after moving from one profile to another without reloading, the inline
`window.__INITIAL_STATE__` still describes the **first** profile. So the ID comes from the DOM `.user-redId`
("rednote ID: …"); the inline state's `user.userPageData.basicInfo.redId` is the fallback, used only when the state is
for this profile. `basicInfo` itself has no user id, so the check is that a note card in the state
(`user.notes[*][i].noteCard.user.userId`) has the uid from the URL (`basicInfoFor` in `sites/rednote.js`). `user.userInfo` is the **viewer's own** account and is never read. No match → "Profile lookup failed: no
RedNote ID on this page"; the hex id and the display name are never used instead.

### One lookup per click

Each click makes **one** same-origin request, with the user's cookies and no request signing:
`/explore/<noteId>?xsec_token=<token>&xsec_source=pc_user`. Its HTML holds `window.__INITIAL_STATE__` (JavaScript, not
JSON: `new Set([…])` and bare `undefined` are rewritten before `JSON.parse`; nothing is evaluated or inserted into the
page) with the note at `note.noteDetailMap[<noteId>].note`. Nothing is fetched in advance and nothing is retried.

**Security check (captcha).** RedNote redirects to `/website-login/captcha` after many lookups in a short time (seen
after about 100 in a few minutes during research). The extension then shows "Note lookup failed: RedNote asks for a
security check. Open the note in this tab, complete it, then try again." The signed `webapi.rednote.com` feed API
(`x-s`, `x-t` headers) is deliberately not used.

### Picking the file

| Note | File(s) |
|---|---|
| Photos | Per `imageList[i]`: `https://ci.xiaohongshu.com/<fileId>` = the **original** (e.g. 2316×3088 JPEG, no watermark). The page's own URLs (`urlDefault`, `infoList` `WB_DFT`) are signed, smaller WebPs and are only the fallback |
| Video | The first non-empty `video.media.stream[<codec>]` (the keys `EF4`…`EF7` are obfuscated, so none is named) `[0].masterUrl` (h264 `.mp4`, no watermark), else `backupUrls[0]`; the cover image is skipped |
| Live photo | `imageList[i].livePhoto` with a `stream`: the photo, then its clip (`.mp4`), numbered one after the other. Not yet seen on a real note |
| Profile picture | `basicInfo.images` (or the avatar `src`) without its query string: `sns-avatar-qc.rednotecdn.com/avatar/<id>`, the original (e.g. 1170×1170) |

`background.js` requests the first byte of each original photo (`rednoteProbe`, a ranged GET `Range: bytes=0-0`, host
permission `ci.xiaohongshu.com`): the Content-Type gives the extension (JPEG, HEIC, PNG, WebP); any answer other than
200/206 means the fallback URL is used. The CDN
files need no cookies or referer, so `chrome.downloads` saves them directly. The File size setting does not apply:
always the original.

`username` = rednote ID; `createdDate` = the note's `time` (ms) in local time with its offset; `takenAt` = the same in seconds; `website` =
`rednote`; folder `rednote.com`. Profile pictures use `profile`. The description-date option does not apply.

### When RedNote changes something

Run [`tools/diagnose-rednote.js`](tools/diagnose-rednote.js) on a RedNote profile while logged in (F12 → Console →
paste). It makes at most one note lookup. Its constants are copies of `sites/rednote.js`; keep them in sync.

| Symptom | Likely cause | Fix |
|---|---|---|
| No buttons on tiles | `section.note-item` / `a.cover` renamed | Inspect a tile; update the selectors |
| "Profile lookup failed: no RedNote ID …" | `.user-redId` or `user.userPageData.basicInfo` changed | Inspect the profile header / the inline state |
| "Note lookup failed: … security check" | Captcha | Open the note, complete the check, retry later; never loop |
| "Note lookup failed" otherwise | `/explore` page or `noteDetailMap` changed | Check the state in the fetched HTML; update the parser |
| Video not found | `video.media.stream` changed | Inspect the note's state; look for `masterUrl` |
| Photos saved small | The ci original returned non-200 | Check the `fileId` and `ci.xiaohongshu.com` with curl |

---

## Naver Blog

Content script on `https://blog.naver.com/*` and `https://m.blog.naver.com/*`: `sites/naver-blog.js` (isolated world
only, no `-page.js`, no host permission). Scope, as the user asked: **photos only**, one button per picture, one picture
per click. Everything needed is already in the page: no request, no new tab, no prefetching. Researched 2026-11-07;
details in agentic-config `research/naver-blog-media-downloader.md`.

### Where the buttons go (and the iframe)

- Button `image` (`.md-download-btn[data-md-kind="image"]`) goes into the `.se-module-image` wrapper of every
  `.se-main-container a.__se_image_link[data-linkdata]`. The surrounding `<a>` opens Naver's image viewer, so the
  button stops and cancels pointer and click events.
- Desktop `blog.naver.com/<blogId>/<logNo>` is only a frameset; the post is in the same-origin `iframe#mainFrame`
  (`/PostView.naver?blogId=…&logNo=…`). The manifest entry therefore has `"all_frames": true` (the only one that does),
  and the script does nothing unless the document has `.se-viewer .se-main-container`, so the frameset's top frame, the
  list page (`PostList.naver`, titles only) and the `about:blank` helper frames stay inert. Opening a post from the list
  navigates the iframe, which injects the script again. The toast appears inside the frame that holds the post, and
  only the frame that started a click shows its result.
- `m.blog.naver.com/<blogId>/<logNo>` is a normal page with the same markup, no frames.
- The pictures load lazily, so a `MutationObserver` adds buttons as they appear. Settings → Enabled websites uses the
  id `naver-blog`.

### Blog id (filename `username`)

The blog id from the address: `blogId` of `PostView.naver?blogId=…` (desktop iframe), otherwise the path
`/<blogId>/<logNo>` (mobile, or a top-level post page). It must match `/^[A-Za-z0-9_-]+$/`; if it is missing or
invalid the click fails with "Blog id lookup failed: …". The blog's nickname is never used instead.

### Dates (filename `createdDate`)

The post's **publish time**, in this order:

1. Desktop: the inline script variable `var postWriteDate = "<ms>"` (regex over `document.scripts`; page globals are
   not visible from the isolated world).
2. Mobile: the hidden `#_post_property[addDate]` attribute (ms).
3. Fallback: the visible text `YYYY. M. D. HH:mm` (`.se_publishDate` on desktop, `.blog_date .txt` on mobile), which is
   Korean time (UTC+9) and parsed as `+09:00` (minute precision).

If none works the click fails with "Post date lookup failed: …"; a date is never guessed. The file name uses **local
time with its offset** like the other sites (`MDSettings.formatDate(ms)`), so a post shown as `2023. 3. 30. 14:00` becomes
`2023-03-30T130012+0800` in GMT+8, and a KST morning time can fall on the previous local day. `takenAt` = ms / 1000 for the exiftool
helper. The description-date option does not apply: `MDSettings.postTime` and `descriptionDate` are never called.

### Picking the file

Per picture, read `JSON.parse(link.dataset.linkdata).src` (never `<img src>`, which is a small, lazy placeholder
size). It is rewritten with `new URL`: only `https:` and hosts ending in `.pstatic.net` are accepted; the host becomes
`postfiles.pstatic.net` (the mobile page uses `mblogthumb-phinf…`, which does not serve large sizes), the path stays,
and `searchParams` `type=w3840`. The extension is the last path segment's extension, lowercased, `jpeg` → `jpg`.

- `w3840` is the largest size Naver serves (`w5000`, `orig` and no type give 404 or a 100 px thumbnail). Pictures
  uploaded wider than 3840 px come out scaled down to 3840 px; narrower ones keep their size.
- Naver re-encodes the file and strips EXIF, so camera dates are not in it; the exiftool helper writes the post date.
- **Only `.jpg` and `.png` are supported.** Any other or unknown extension (gif, webp, none) is skipped: the picture
  gets no button, rather than a guessed file type. Stickers/emoticons (another host), link-preview cards and old
  SmartEditor 2 posts (no `.se-viewer`) get no button either.
- No Referer is needed (extension downloads send none); the CDN refuses foreign Referers but not missing ones.

File name: `username` = blog id, `createdDate` as above, `website` = `naver` (`MDSettings.websiteName` gives `naver`
for both hosts, and will for every future Naver site), folder `blog.naver.com`. The picture's 0-based position among
all `a.__se_image_link` of the post, `_<n>`, is **always** added, even when the post has one picture (one click saves one
file, so the number keeps files of the same post apart): `blog.naver.com/<blogId>_--naver--_2023-03-30T130012+0800_3.jpg`.

### When Naver changes something

Run [`tools/diagnose-naver-blog.js`](tools/diagnose-naver-blog.js) on a post page (F12 → Console → paste; on the desktop
site it looks into `iframe#mainFrame`). It makes no request except an optional one-byte ranged GET. Its helpers are
copies of `sites/naver-blog.js` and `shared/naver.js`; keep them in sync. Unit tests for the helpers: `node --test tools/tests/naver-blog.test.js tools/tests/naver-shared.test.js`.

| Symptom | Likely cause | Fix |
|---|---|---|
| No buttons on a post | `.se-viewer .se-main-container`, `a.__se_image_link` or `.se-module-image` renamed, or an old SmartEditor 2 post | Inspect the post; update the selectors |
| "Blog id lookup failed" | URL shape changed (`blogId` query / `/<id>/<logNo>`) | Check `location` in the frame that holds the post |
| "Post date lookup failed" | `postWriteDate`, `#_post_property` and the date text all changed | Run the diagnose script, find the new source |
| "Picture lookup failed: … data" | `data-linkdata` is no longer JSON with `src` | Inspect the link element |
| "Picture lookup failed: … Naver's image server" | Pictures moved off `*.pstatic.net` | Check the `src`; update `rewriteImageUrl` |
| Download fails (404 / HTML file) | `type=w3840` no longer allowed | Check the sizes with a ranged `curl` |

### Future improvements

Untested or unsupported today, and may come later: animated GIFs (Naver may return a still frame or convert them to
video), stickers and emoticons, videos, old SmartEditor 2 posts, other Naver sites (the shared helpers are in `shared/naver.js`), and the full-size original of uploads wider than 3840 px (Naver may not expose it).

---

## Naver Entertain

Content script on `https://m.entertain.naver.com/*`: `sites/naver-entertain.js` (isolated world only, no `-page.js`, no
host permission), with `shared/naver.js` before it. The desktop `entertain.naver.com` answers HTTP 307 to the mobile
site, so the browser never stays on it and the manifest does not match it. Scope: **photos only**, one button per
picture, one picture per click. Everything needed is already in the page: no request, no new tab, no prefetching.
Researched 2026-11-07; details in agentic-config `research/naver-entertain-media-downloader.md`.

### Page kinds and buttons

The script does nothing unless the page has the article component (`[class*="Article_comp_news_article"]` or
`._article_body`) or the viewer's fotorama stage (`.fotorama__stage`). Class names are CSS-module hashes that change per
build, so they are matched on their prefix. Settings → Enabled websites uses the id `naver-entertain`.

- **Article** `/home/article/<oid>/<aid>` and **photo article** `/photo/article/<oid>/<aid>` (`/article/<oid>/<aid>`
  redirects to the first). One button `image` (`.md-download-btn[data-md-kind="image"]`) per
  `[class*="ArticleImage_article_image"] img` inside the article body, placed in the `ArticleImage_image_wrap` span.
  Thumbnails of related lists are not in the article component and get no button. The pictures already carry a real
  `src`; a `MutationObserver` (debounced by a timer, not requestAnimationFrame) catches late hydration and URL changes.
- **Photo viewer** `/entertain?id=…&imgId=…&oid=…&aid=…#main/<imgId>` (fotorama slider, a feed of unrelated photo
  articles). One button `viewer` on the stage; it acts on the picture
  (`.fotorama__stage__frame.fotorama__active img.fotorama__img`) that is active **at click time**. Slides change
  without navigation, so the script follows `hashchange`, DOM and class changes; the button is hidden while the active
  picture is not a JPG/PNG.
- Not supported: the photo list pages (`/photo`), and the newer album viewer `/photo/viewer?albumId=…&photoId=…` (no
  fotorama, no article component; seen 2026-11-07 when opening a list item, not investigated).

### Press name (filename `username`)

The press name with **all** whitespace removed (spaces, NBSP, ideographic space and zero-width characters: they are
removed in this value only, because `sanitize` would turn zero-width characters back into spaces), Hangul kept:
e.g. `가나연예`, `ABC뉴스`. Never the oid, the ename or a host.

- Article and photo article: first Naver's fixed Korean name `officeInfo.hname` from the page data (Next.js RSC payload,
  read only when `officeInfo.officeId` equals the address's oid). Fallback: the press logo's `alt`
  (`a[class^="PressLogo_"] img`, rendered after hydration, read at click time, spaces removed). The logo alt is not
  constant for one outlet (Korean on one article, English with stray spaces on another), which is why `hname` is first.
- Viewer: the `#footer` text line `<name> | YYYY.MM.DD. 오전|오후 H:MM`, spaces removed. Unverified: whether the footer
  name equals `hname` for every outlet (it did for the outlets checked).
- Otherwise the click fails with "Post lookup failed: no press name on this page".

### Dates (filename `createdDate`)

The **publish time** (입력), Korean time (UTC+9) turned into your local time in the file name (`MDSettings.formatDate`), `takenAt` =
ms / 1000 for the exiftool helper. A 2026.09.05. 오후 3:44 article becomes `2026-09-05T144400+0800` in GMT+8. Never
`modifyDatetime`, the `수정` item, `MDSettings.postTime` or the description date.

- Article: first the page data. The script reads every `self.__next_f.push([1,"…"])` in `document.scripts`, decodes
  each string literal with `JSON.parse` (no eval, no MAIN-world script: page globals are not visible) and takes
  `articleInfo.article.serviceDatetime` (`YYYY-MM-DD HH:mm:ss`, second precision) when the article's `articleId` and
  `officeId` equal the address's aid and oid. Fallback: the `[class*="DateInfo_info_item"]` whose
  `[class*="DateInfo_term"]` is `입력`, text `2026.09.05. 오후 3:44` (minute precision; 오전 12 is 00, 오후 12 is 12).
  If neither works: "Post date lookup failed: …".
- Viewer: the date of the footer line, minute precision (seconds 00), so the same picture saved from the viewer and from
  its article differs by the seconds.

### Picking the file

The picture's `src`, rewritten with `new URL`: the query and hash are removed (no `type` serves the original file) and
the host is kept as given (`imgnews`, `mimgnews` and `ssl.pstatic.net/mimgnews/…` all occur). Only `https:` and hosts
`pstatic.net` or `*.pstatic.net` are accepted. The blog's host swap and `w3840` are **not** used here. The extension is the
last path segment's extension, lowercased, `jpeg` → `jpg`; **only `.jpg` and `.png`** are supported, other pictures get no
button. No Referer is needed and no host permission (extension downloads are not CORS-limited).

`_<n>` is **always** added:

- Article and photo article: the 0-based position of the picture among the article-body pictures, in document order.
- Viewer: the file number of the image URL `/image/origin/<oid>/<yyyy>/<mm>/<dd>/<n>.jpg` (each slide is another
  article, so there is no position). No number: "Picture lookup failed: …".

After a slide change the hash and footer update first and the picture follows (~100-150 ms, longer on a slow connection).
The viewer therefore compares the footer's article link (office id, and article id = the picture's file number) with the
active picture. While they disagree it reads again every 100 ms for up to 2 s (the button stays busy and the toast says
"Downloading…") and stops as soon as they agree. If the picture or the footer changed during the wait and they still
disagree, it refuses ("Picture lookup failed: the slide is still loading, try again."), so the old picture is never saved
with the new slide's date. A pair that did not change at all for the whole 2 s and still disagrees (an outlet whose
article id is not the file number) is accepted.

File name examples: `entertain.naver.com/<press>_--naver--_2026-09-05T144400+0800_0.jpg` (article),
`…_123456.jpg` (viewer).

### When Naver Entertain changes something

Run [`tools/diagnose-naver-entertain.js`](tools/diagnose-naver-entertain.js) on an article, photo article or viewer page
(F12 → Console → paste). It makes no request except an optional one-byte ranged GET. It reports the page kind, oid/aid,
the press-name source and value, the date source with the raw value and UTC, the picture count, and the first picture's
`src`, rewritten URL and extension (viewer: the active image, its file number, and the footer name and date). Its helpers
are copies of `sites/naver-entertain.js` and `shared/naver.js`; keep them in sync. Unit tests:
`node --test tools/tests/naver-entertain.test.js tools/tests/naver-shared.test.js`.

| Symptom | Likely cause | Fix |
|---|---|---|
| No buttons on an article | `Article_comp_news_article`, `ArticleImage_article_image` or `ArticleImage_image_wrap` renamed | Inspect the page; update `BODY`, `BODY_IMAGES` and the wrapper selector |
| No button in the viewer | `.fotorama__stage` or the active-slide classes renamed, or the active picture is not JPG/PNG | Inspect the stage; update `ACTIVE_IMAGE` |
| "Post lookup failed: no press name on this page" | `officeInfo.hname` missing or its `officeId` differs, the logo selector changed, or the footer line changed | Run the diagnose script; check the "Press name" rows |
| "Post date lookup failed" | `serviceDatetime` and the `DateInfo_` 입력 text both changed | Run the diagnose script, find the new source |
| "Picture lookup failed: … Naver's image server" | Pictures moved off `*.pstatic.net` | Check the `src`; update `rewriteImageUrl` |
| "Picture lookup failed: … file number" | The viewer's image path changed | Check the active image's `src` |
| Download fails (404 / HTML file) | A query-less URL no longer serves the original | Check with a ranged `curl` |

### Future improvements

Unsupported today: videos, animated GIFs and other media (none seen in the sampled pages; Naver articles may embed video
players), the photo list pages, the album viewer `/photo/viewer?albumId=…`, and uploads that are not JPG or PNG. Viewer
dates have minute precision only. Whether `hname` equals the footer name for every outlet, and `hname` after a
client-side route change, are unverified.
