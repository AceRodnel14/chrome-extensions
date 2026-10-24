# How mediadownloader gets files

This file explains, per website, where the download buttons come from, which APIs are called to find the
original files, and how the files are saved. Supported: Instagram, X (Twitter), YouTube posts and Reddit; add a section
per new site.

Last verified against the live sites: **2026-10-24** (Chrome 156): Instagram, X, YouTube posts and Reddit.

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
| Website folder | For button downloads: the site's main host (`MDSettings.SITES[].hosts[0]`, e.g. `instagram.com`, `x.com`, `youtube.com`, `reddit.com`). For every other download: the domain of the file's URL without `www.` (download-organizer's rule). |
| Filename | The filename pattern from Settings with `username`, `createdDate`, `website` filled in, plus `_<index>` for carousels and story sets. |

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
   YouTube's post page `publishDate`, Reddit `created_utc`).
2. `background.js` starts the downloads and records the click's download IDs as one batch in `chrome.storage.session`
   (survives the worker being stopped during long downloads). Every click gets a batch, with or without exiftool.
3. When every download of the batch is `complete` or `interrupted` (`chrome.downloads.onChanged`), the completed
   files that have a `takenAt` go to the helper in **one** message: `{action: "setDates", exiftoolDir, files: [{path, takenAt}]}`.
4. The helper finds exiftool in that folder (`exiftool.exe`, or the Perl `exiftool` script run with `perl`;
   `exiftool(-k).exe` is refused because it waits for a key press), writes an exiftool argument file with one
   block per file separated by `-execute`, and runs exiftool **once** for the batch. `-echo3`/`-echo4` markers split
   the output so each file gets its own result.
5. The result goes into the batch's report (below).

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

Tags and value, same as the original Python script: `-m -overwrite_original -DateTimeOriginal=… -AllDates=…
-CreationTime=… -ModifyDate=…`, value `YYYY:MM:DD HH:MM:SS` = `taken_at` in **UTC**, no time zone (the same time as
`createdDate` in the filename). exiftool writes what each format supports and skips the rest (checked: JPEG, HEIC,
WebP, PNG, MP4/MOV). `-m` lets it write despite "[minor]" problems, such as the non-standard EXIF in some PNGs
from YouTube posts ("IFD0 pointer references previous IFD0 directory"), which otherwise fail the file. For MP4/MOV it stores the value as given, which is right because those dates are UTC by
standard; it also appends the computer's offset to `UserData:DateTimeOriginal` on its own. Photos show the UTC clock
time (e.g. 8 hours behind Philippine time). Profile pictures (no post date) and other downloads are not touched.

Settings → **Test** sends `{action: "version", exiftoolDir}` and shows the exiftool version or the helper's error
(including "helper not installed", which is Chrome's "Specified native messaging host not found").

### Enabled websites

`MDSettings.SITES` lists every supported site. A site's content script only adds buttons while its switch is on in
Settings; switching it off removes the buttons from open tabs immediately (via `chrome.storage.onChanged`). A site is
added to the list only once its content script exists.

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
| Credentials | `credentials: "include"` | Uses the browser's Instagram session |

GraphQL calls are `POST /graphql/query` with form fields `doc_id`, `variables` (JSON), `lsd`, `server_timestamps=true`.
The `doc_id`s are Instagram's persisted query IDs. **They are the part most likely to break.** `DOC` in
`sites/instagram.js` keeps each one with its operation name; Instagram's scripts define them as
`__d("<Name>_instagramRelayOperation",[],(function(a,b,c,d,e,f){e.exports="<doc_id>"}),null);`, which is how
Diagnose mode and `tools/diagnose.js` find the current value. See "When Instagram changes something" below.

### Endpoints used

| What | Call | Returns |
|---|---|---|
| Post, reel, carousel | `GET /api/v1/media/{mediaId}/info/` | `items[0]` with `image_versions2.candidates`, `video_versions`, `carousel_media`, `taken_at`, `user.username` |
| Story and highlight items | GraphQL `doc_id 39400183649572570` (`PolarisStoriesV3HighlightsPageQuery`), variables `{ reel_ids: [id], initial_reel_id: id, first: 1, __relay_internal__pv__PolarisCommunityNoteStoriesLabelEnabledrelayprovider: true }` where `id` is a user ID (stories) or `"highlight:<id>"` | `data.xdt_api__v1__feed__reels_media__connection.edges[0].node` with `items[]` and `user` |
| Profile (HD profile picture) | GraphQL `doc_id 28717443601247930` (`PolarisProfilePageContentQuery`), variables `{ id, enable_integrity_filters: true, …7 relay provider flags }` | `data.user.hd_profile_pic_url_info.url` (usually 1080×1080; 1000×1000 for some accounts, e.g. nmixx_official). Fails with "execution error" unless every flag in `PROFILE_FLAGS` is sent. |
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
  `taken_at` as ISO without colons (`2026-10-24T112727.000Z`); profile pictures use `profile`.

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
  each request (operation, doc_id, variables, whether the LSD/CSRF tokens were found), each response, which method
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
PASS/FAIL table. (Chrome may ask you to type "allow pasting" the first time.)

| FAIL row | Meaning | Fix |
|---|---|---|
| Logged in / CSRF token | Session expired | Log in again |
| LSD token | Instagram moved or renamed the token in the page | Find the new token: View source, search for `LSD`; update the regex in `gqlRequest` (sites/instagram.js) and in diagnose.js |
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
| queryId … CHANGED | X renumbered the query | Copy the new id into `DOC` in `sites/x.js` and `BUILT_IN` in `tools/diagnose-x.js`; if the feature list changed, copy it into `TWEET_FEATURES` (diagnose-x.js always uses the current one) |
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

`createdDate` = the publish time in UTC (`2026-10-24T090000.189Z`); `takenAt` for exiftool = the same in Unix seconds.

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

Run [`tools/diagnose-youtube.js`](tools/diagnose-youtube.js) on a channel's Posts tab (F12 → Console → paste).

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
(videos, converted GIFs). Link posts to other sites (e.g. `crosspost @ redgifs.com`, YouTube links) get no button.

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
| `crosspost @ redgifs.com`, `link @ …` | Media on another site: **no button** |

### Placement

The action row (votes, comments, repost, share) is in the post's open shadow root and filled through named slots.
The button is appended to the `shreddit-post` with `slot="action-row-whitespace"`, the free slot at the end of the
row (the `share-button` slot must not be used: its fallback content *is* the Share button).

### Where the files come from

On click, `GET /by_id/<t3 id>.json?raw_json=1` (works logged out) returns the post; for a crosspost the original is
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
that is the subreddit it was shared to, not the original's; `createdDate` = `created_utc` (whole seconds, so `.000Z`); `website` = `reddit`.

### exiftool on Reddit files

Some packaged mp4s are fragmented (`sidx` box); exiftool cannot write those yet ("Can't yet handle sidx box when
writing"), so the toast is amber ("Dates set on 0 of 1; not set: …") while the video itself is fine. Seen on a converted GIF. Other
Reddit mp4s needed `-m` ("[minor] Terminator found in Meta…"), which the helper now passes.

### When Reddit changes something

Run [`tools/diagnose-reddit.js`](tools/diagnose-reddit.js) on a subreddit (F12 → Console → paste).

| FAIL row | Meaning | Fix |
|---|---|---|
| Post elements / Post attributes | `shreddit-post` or its attributes renamed | Inspect a post; update `injectPosts` (`post-type`, `domain`, `id`) |
| Action row slot | Slot renamed | List the slots in `post.shadowRoot`; pick a free one at the end of the row; update `SLOT` |
| Post lookup | `/by_id/<id>.json` changed or blocked | Try `https://www.reddit.com/comments/<id>.json`; update `getPost` |
| Gallery data / Original image | `gallery_data` / `media_metadata` changed | Update the gallery branch of `mediaOf` |
| Video packaged mp4s | Player attribute renamed | Inspect the `<shreddit-player>`; look for mp4 URLs with audio (`packaged-media.redd.it`); update `packagedMp4s` |
| No buttons on links to other sites | The `domain` filter let an external post through | Update `HOSTED` |
