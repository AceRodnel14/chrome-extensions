# How mediadownloader gets files

This file explains, per website, where the download buttons come from, which APIs are called to find the
original files, and how the files are saved. Only Instagram is supported so far; add a section per new site.

Last verified against the live sites: **2026-10-24** (Chrome 156).

---

## Common to all websites

### Saving files

- The content script for a site works out the list of files (`{ url, filename }`) and sends it to the background
  worker: `chrome.runtime.sendMessage({ type: "download", site, files })`.
- `background.js` saves each one with `chrome.downloads.download({ url, filename: path, conflictAction: "uniquify" })`
  and reports per-file success or failure back to the page, which shows a toast.
- Why `chrome.downloads` and not a page-level `<a download>` click (what IMDownloader did): page-level downloads
  are rate-limited per site by Chrome's "this site wants to download multiple files" prompt and fail silently
  once blocked; `chrome.downloads` is not, and it reports real errors.
- The file's URL is the site's CDN URL directly; nothing is proxied or re-encoded.

### Paths

`<Save location>/<website folder>/<filename>`, all relative to Chrome's Downloads folder:

| Part | Where it comes from |
|---|---|
| Save location | Settings. Optional. Relative only: `chrome.downloads` rejects absolute paths, so `C:\…` is refused in Settings. `\` and `/` both work; `..`, unsafe characters and Windows reserved names (CON, NUL, …) are cleaned. |
| Website folder | For button downloads: the site's main host (`MDSettings.SITES[].hosts[0]`, e.g. `instagram.com`). For every other download: the domain of the file's URL without `www.` (download-organizer's rule). |
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
`com.mediadownloader.exiftool` for extension ID `cedeopcefllcjmmkopihgkkngehmfmmk` only (pinned by the `key` in
`manifest.json`; unpacked extensions otherwise get a different ID per folder).

1. The content script sends each file with `takenAt` (Instagram `taken_at`, Unix seconds = publish time).
2. `background.js` starts the downloads; if exiftool is on, it records the click's download IDs as one batch in
   `chrome.storage.session` (survives the worker being stopped during long downloads).
3. When every download of the batch is `complete` or `interrupted` (`chrome.downloads.onChanged`), the completed
   files' full paths go to the helper in **one** message: `{action: "setDates", exiftoolDir, files: [{path, takenAt}]}`.
4. The helper finds exiftool in that folder (`exiftool.exe`, or the Perl `exiftool` script run with `perl`;
   `exiftool(-k).exe` is refused because it waits for a key press), writes an exiftool argument file with one
   block per file separated by `-execute`, and runs exiftool **once** for the batch. `-echo3`/`-echo4` markers split
   the output so each file gets its own result.
5. The result goes back to the tab: "Dates set on N files" or the error.

Tags and value, same as the original Python script: `-overwrite_original -DateTimeOriginal=… -AllDates=…
-CreationTime=… -ModifyDate=…`, value `YYYY:MM:DD HH:MM:SS` = `taken_at` in **UTC**, no time zone (the same time as
`createdDate` in the filename). exiftool writes what each format supports and skips the rest (checked: JPEG, HEIC,
WebP, PNG, MP4/MOV). For MP4/MOV it stores the value as given, which is right because those dates are UTC by
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
| Profile (HD profile picture) | GraphQL `doc_id 28717443601247930` (`PolarisProfilePageContentQuery`), variables `{ id, enable_integrity_filters: true, …7 relay provider flags }` | `data.user.hd_profile_pic_url_info.url` (1080×1080). Fails with "execution error" unless every flag in `PROFILE_FLAGS` is sent. |
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
