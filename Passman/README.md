# Passman

A browser extension (Manifest V3) for Google Chrome, Brave, Microsoft Edge and Chromium that autofills logins from
**passman**, a self-hosted password manager. It reuses your passman web session: you sign in to passman in a normal
tab, and the extension never sees or stores your login password.

It is plain JavaScript with no bundler and no build step, like the other extensions in this repository.

## Installation

1. Go to `chrome://extensions` (Brave: `brave://extensions`, Edge: `edge://extensions`).
2. Turn on **Developer mode**, click **Load unpacked** and choose the `Passman` folder (the one with `manifest.json`).
3. Put the folder somewhere permanent first: the browser loads it from there every time it starts.
4. After `git pull`, click the extension's reload arrow and reload open tabs.

## Setup

1. Open the extension's **Options** (right-click the toolbar icon, or the link in the popup).
2. Type the address of your passman server, for example `https://passman.example.com` (paths are dropped; the address
   is reduced to its origin). `http` is accepted for `localhost` and `127.0.0.1`; for any other host the options page
   warns you, because the session and passwords would cross the network in clear text.
3. Click **Save and allow access**. The browser asks for permission to reach that one address, which is what lets the
   extension send your passman session cookie to it (`optional_host_permissions`). Changing the address removes the old
   grant. Note that the extension's content script is declared for all http(s) sites, so the browser's install warning
   already says it can "read and change all your data" on websites; the script stays idle until a login form appears.
4. Open passman in a normal tab and sign in. Passman's own tab loading is what loads the saved-sites list; click the
   toolbar icon: it should say **Connected as <you>** and show when your session ends.
5. Reload tabs that were already open.
6. Optional: in the options, choose how old the list may get before the popup or a fill refreshes it ("Recheck after",
   12 hours by default) and press **Refresh now** after adding entries in passman.

## Using it

- **On a login page**, focus or hover the username or password field. If your saved-sites list has an entry for the
  site, a small passman button appears at the right edge of the field. Click it: with one match the menu asks
  "Autofill <entry>?", with several you pick one. Escape, a click outside, scrolling or resizing closes it. Opening the
  menu uses only the local list; passman is contacted when you confirm.
- **Toolbar popup** shows who you are signed in as and until when, and the entries matching the current tab, each with a
  **Fill** button. A dot badge on the icon means the page matches a saved site (it is not a count).
- Once the session end passes, the extension treats you as signed out without asking the server: no buttons, and the
  popup says "Sign in to passman". Signing in again (a passman tab loading) reloads the list.
- **Options > Export backup** downloads the same backup file as the passman website (see below).
- Pages opened by IP address never match, and nothing is filled there. `localhost` works.
- The popup states: not configured (link to options), access not granted, unreachable, signed out, connected.

## Guarantees

- **Nothing is ever filled without your click** on Autofill, on an entry in the menu, or on Fill in the popup. There is
  no auto-fill, no fill on page load and no fill on focus. The code that sends a fill message exists in one place and
  is reachable only from those clicks; `tests/invariants.test.js` fails if that changes.
- **Passman does not learn which sites you visit.** Visited pages are matched locally (see below). Passman hears
  about a specific page only when you pick an entry to fill, and then only that page's origin. Passman is contacted only
  when you act, so it can scale to zero.
- **A password is requested only when you click an entry to fill it**, and is never cached or logged.

## How matching works

1. The extension downloads the list of saved sites with `GET /api/sites`: one record per entry holding id, label,
   scheme(s), host, port and a "subdomains" flag, plus your username and when your session expires. No usernames per
   entry, no passwords. The list is stored on disk in the extension's own IndexedDB (see "Security notes" for what that
   means). It is wiped on any signed-out answer, when the passman session cookie is removed or expires (see below), when
   you change the passman address, and when a refresh returns a different user.
2. When a page shows a visible password field, the extension checks the page's address against that list **inside the
   browser**. This check never starts a request, so loading a page cannot reach passman, not even as a timing signal.
   A match shows the button and a dot on the toolbar icon. If the list is missing, or the session end has passed, there
   is no match.
3. Clicking the button lists the matching labels from the local list, again without a request. Only when you pick an
   entry does the extension call `GET /api/fill/{id}?url=<page origin>`, which returns that entry's login if (and only
   if) the server agrees that it matches that origin.

Rules (the server uses the same ones; `tests/fixtures/match-cases.json` holds shared test vectors): the page's scheme
must be one of the record's schemes; the port must equal the record's port, or both must be the scheme's default; the
host must equal the record's host, or end with `.` plus it when subdomains are allowed. An entry stored with a scheme
matches that scheme; one stored without a scheme matches `https` only, except single-label hosts (such as `localhost`
or `nas`), which match either scheme. Entries with an IP address are not offered by the server, and pages opened by IP
address are refused by the extension.

The list is fetched only on these triggers, and never by a timer: a passman tab finishing loading (at most once every
5 seconds, so signing in or out in the web app is noticed quickly); **Refresh now** in the options; opening the popup
when the list is older than "Recheck after" (or missing); and right after a successful fill when the list is that old.
Being past the recheck time never causes a request by itself. Nothing is fetched at browser start or install, unless the browser restores a passman tab (that tab loading is the trigger above).

Signing in to passman refreshes the list: when the `passman_session` cookie is set, the extension loads `/api/sites`
about a second later (passman's login is a single-page flow, so no page load would follow it). That is a request you
just caused by signing in.

Signing out in the passman web app is noticed **without any request**: the extension listens for the removal or expiry
of the `passman_session` cookie of your passman address (`chrome.cookies.onChanged`, a local browser event) and wipes
the list, buttons and badges at once. If the cookie is already gone when the popup or the in-page menu opens (cookies
cleared, browser restarted), the list is wiped then, again with no request. The extension only checks that the cookie
exists; it never reads or uses its value.

## What passman sees

Every request goes to your passman address and carries your session cookie, except the export, which carries your
password instead.

| Request | When | What it reveals |
|---|---|---|
| `GET /api/sites` | a passman tab finishes loading; you press Refresh now; you open the popup and the list is older than "Recheck after" (or empty); a fill succeeds and the list is that old | that you are using the browser. Never sent because of a page you visit, never by a timer |
| `GET /api/fill/{id}?url=<origin>` | you pick an entry in the menu, or press Fill in the popup | the entry you chose and the origin of that one page, which already has a saved entry |
| `POST /api/export` | you press Export backup in the options | your username and password (and the optional backup password) are sent to this address only, without the cookie |

Visiting a login page, opening the in-page menu, and a toolbar popup open with a fresh list make no request at all. This
is what lets passman scale to zero: it is woken only by something you do.

## How the pieces talk

| From | To | Message | Notes |
|---|---|---|---|
| content script | service worker | `cs:count` | worker matches `sender.url` (set by the browser) against the local site list; replies with a count; sets the dot badge; no network request about the page |
| content script | service worker | `cs:menuOpen` / `cs:menuClose` | registers `{nonce, documentId, origin, url}` for this tab's menu (browser-set sender fields) |
| menu iframe | service worker | `menu:list`, `menu:fill`, `menu:close` | worker checks `sender.url` is `menu.html` in a sub-frame, plus the nonce |
| service worker | passman | `GET /api/sites`, `/api/fill/{id}` | cookie sent via host permission; see "What passman sees". The options page also POSTs `/api/export` |
| service worker | content script | `passman:fill`, `passman:close` | sent to the exact `documentId` that opened the menu; `fill` carries the secret and the expected page URL |
| popup / options | service worker | `popup:status` (local; refreshes only a stale list), `popup:fill`, `options:status`, `options:refresh` | popup fill goes straight to the form, no menu |

Fill sequence from the menu: click inside the iframe, then the worker checks the nonce and that the chosen entry is in
the local matches for the page URL recorded when the menu opened, calls `/api/fill/{id}` (the first contact), and sends
`{username, password}` to the document that opened the menu. If that document has navigated away the message simply
fails. The content script checks the page URL once more, runs the overlay check, and only then fills.

## Security notes

- The button lives in a host element with a **closed shadow root**, so page scripts cannot read or script it, and
  only trusted (real) clicks on it are accepted.
- The menu is an **iframe of an extension page** (`menu.html`, the only web-accessible resource). The page cannot read
  the labels or fake a click inside it. Its URL carries a per-open random nonce that the page cannot see; the
  worker answers `menu:list` and `menu:fill` only with the nonce the content script registered, so a hostile page
  that embeds `menu.html` itself gets nothing.
- **Overlay check** before every menu fill: the content script samples nine points over the iframe with
  `elementFromPoint` and aborts if anything else is on top; if the host, iframe, `html` is not fully opaque,
  visible and displayed, or has a `transform`, `filter`, `mask`, `clip-path` or non-normal `mix-blend-mode`; if the
  host or iframe is not clickable; if it was removed; or if the iframe's position or size differs from when it opened.
  Inside the iframe, an IntersectionObserver (v2, `trackVisibility`) must have reported the menu visible for 500 ms
  without a break, and clicks or keys in the first 500 ms after the menu appears are ignored. The Autofill button is
  never auto-focused. The menu has a fixed size, so the page cannot infer how many entries matched.
- The menu and button close on `pagehide`, scroll, resize, Escape and outside clicks.
- Secrets are fetched only after you click an entry, held in local variables, never cached or logged.
- The `passman_session` cookie is HttpOnly; the browser attaches it to requests. The extension has the `cookies`
  permission only to notice that the cookie was removed or expired (and to check it still exists); it does not read or use
  the value. All requests are `GET` except the export.
- **The saved-sites list is on disk, in the service worker's own IndexedDB**, not in `chrome.storage`. Content scripts
  and web pages cannot read it, and it is never sent to them (they only learn "this page has a match" and the dot).
  Site names and addresses of your entries (no logins) are still readable by anyone who can read this browser profile,
  and by other software running as you. It is deleted on sign-out (including cookie removal), on changing the passman
  address and on a user change; removing the extension deletes it too. `chrome.storage.local` holds only the passman
  address and the recheck setting.
- **Export backup** sends your passman password (and optional backup password) from the options page only to
  `<your passman address>/api/export`, without cookies. The password fields are cleared after every attempt and are never
  stored or logged; the response is saved through a temporary blob link and the browser's normal download. Without a
  backup password the file is plain JSON with all passwords in clear text.
- Permissions: `storage`, `cookies`, `activeTab` (lets the popup read the current tab's URL when you open it) and the optional
  host permission for your passman address. There is no `tabs` permission: the in-page menu uses the URL the
  browser reports for the document that opened it.
- The content script runs on every http(s) page (top frame) but stays idle until a visible password field appears and
  a server is configured. It is disabled on passman's own origin.
- `menu.html` is a web-accessible resource, so any website can probe for it and detect that the extension is installed
  (it can also embed it, but gets no entries without the nonce). `use_dynamic_url` is not used yet.

## Limitations

- Top frame only: logins inside iframes (some SSO and payment pages) are not detected.
- No saving of new passwords or updating changed ones; manage entries in the passman web app.
- Needs an active passman web login; when the session expires, sign in again in a tab. The extension knows the session
  end from the list and shows signed-out without asking the server, so a session ended early on the server shows up as
  "Signed out of passman" at the next fill.
- A new entry is not offered until the list is refreshed (passman tab load, Refresh now, or the popup once the list is
  older than the recheck time).
- The popup cannot copy a username: the list holds no usernames.
- Pages opened by IP address are never matched.
- One server, one account at a time.
- Multi-step logins (username on one page, password on the next) are only filled when the password field is visible;
  a username-only step is not detected.
- Forms marked `autocomplete="new-password"` (sign-up, change password) are ignored.
- Sites with a strict `frame-src` / CSP can block the menu iframe. The toolbar popup still works there.
- The first-run Chrome message about developer-mode extensions is normal for unpacked extensions.

## Development

- Pure logic lives in `shared/logic.js` and `shared/detect.js`, loaded by the extension and by node.
- Tests: `node --test tests/*.test.js` (no dependencies). Syntax check: `node --check` on each `.js` file.
- `tests/background.behavior.test.js` runs the real service worker against a stubbed `chrome` and counts requests;
  `tests/invariants.test.js` is a lighter source-level backstop for the same guarantees.
- `tools/test-login.html`: a static test page, see [smoke-test.md](smoke-test.md).
- `tools/make-icons.js` regenerates `icons/` and `shared/logo.js` from the logo (needs `sharp`, installed outside the
  repo; the usage is in the file header).
