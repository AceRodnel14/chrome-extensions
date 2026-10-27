# Smoke test

Run after changing the extension or when Chrome updates. About 15 minutes. Unit and behaviour tests first:
`node --test tests/*.test.js`.

## Before you start

- [ ] Passman server running (test instance: `http://127.0.0.1:18080`) with an account and these entries: two for
      `https://www.instagram.com`, one each for X, GitHub, Reddit, and one for `http://localhost:18090`.
- [ ] Load the extension unpacked and **reload** it after code changes. Check there are no errors on its card.
- [ ] In `tools/`, run `python3 -m http.server 18090 --bind 127.0.0.1` and open
      `http://localhost:18090/test-login.html` (use `localhost`, not the IP: pages opened by IP never match).
- [ ] Watch passman's container logs, or DevTools Network on the extension's service worker, for the request checks.

## Setup and popup

| # | Do | Expect |
|---|---|---|
| 1 | Click the toolbar icon before any setup | "Not configured" with an Open options link |
| 2 | Options: save `127.0.0.1:18080` | Browser asks for permission; the field shows `http://127.0.0.1:18080`; no http warning |
| 3 | Options: type `http://example.com`, do not save | Plain-http warning appears |
| 4 | Popup, signed out of passman | "Signed out" / "Sign in to passman" with an Open passman link that opens a tab |
| 5 | Sign in to passman in that tab (the tab load loads the list), reopen the popup | "Connected as <you> (signed in until ...)" |
| 6 | Options | "Site list: N sites, last updated ..., signed in until ..."; the Recheck-after select shows 12 hours |
| 7 | Stop the server, open the popup with a fresh list | Still "Connected" (no request is needed); start the server again |
| 8 | On the test page, open the popup | Lists the "Local test form" entry with a Fill button; the icon shows a dot (not a number) |

## In-page autofill

| # | Do | Expect |
|---|---|---|
| 9 | Test page, plain form: focus the username field | passman button at the field's right edge; none on pages without a match |
| 10 | Click it | Menu below the field: "Autofill <label>?" (labels, no usernames) |
| 11 | Press Escape / click elsewhere / scroll | Menu closes each time |
| 12 | Reopen, wait half a second, click Autofill | Both fields filled; the event log shows input (insertText) and change |
| 13 | Late form (appears after 1 s): focus its email field | Button appears; autofill works and the log shows input events |
| 14 | Instagram login page (two matches) | Menu lists both labels; picking one fills |
| 15 | Popup Fill on the test page | Fields filled without the menu |
| 16 | Open `http://127.0.0.1:18090/test-login.html` (the IP) and the passman site itself | No button, no dot, nothing fills |
| 17 | A site with no entry, e.g. a random login page | No button, no badge |

## Security checks (DevTools console on the test page)

| # | Do | Expect |
|---|---|---|
| 18 | `document.documentElement.lastElementChild.shadowRoot` | `null` (closed shadow root) |
| 19 | Open the menu; run `document.documentElement.lastElementChild.style.opacity='0.2'`, then click Autofill | Fill refused ("changed how this menu is displayed"); nothing filled |
| 20 | Open the menu; append a full-screen fixed `div` with max z-index after the host; click Autofill | Refused ("something ... is covering this menu") |
| 21 | Open the menu, then add a full-screen fixed `div` with `pointer-events:none` and a semi-opaque background, wait a second, click Autofill | Refused: menu reported not visible, or the overlay check fails; nothing filled |
| 22 | Open the menu and click Autofill within half a second of it appearing | Ignored; clicking again after a moment works |
| 23 | Open the menu and set `transform:translateX(3px)` or `filter:blur(1px)` on `html` | Fill refused |
| 24 | Add an iframe whose `src` is the extension's `menu.html` URL to the page (ID is on the extensions page) | "This menu is not allowed to do that"; no labels shown |
| 25 | Service worker console and page console while filling | No usernames or passwords logged |

## Privacy: when passman is contacted

| # | Do | Expect |
|---|---|---|
| 26 | With a fresh list, browse to the test login page and several unrelated login pages, without clicking anything | **No request of any kind** reaches passman |
| 27 | Click the in-field button on the test page, look at the labels, press Escape | Still no request |
| 28 | Click the button again and pick the entry | Exactly one request: `GET /api/fill/<id>?url=http%3A%2F%2Flocalhost%3A18090` (origin only); the fields fill |
| 29 | Load the test page, focus the fields, wait, reload | Fields stay empty every time: nothing fills without a click |
| 30 | Options: press Refresh now | The "last updated" time changes; exactly one `GET /api/sites` |
| 31 | Reload a passman tab twice within 5 s, then again later | One `/api/sites` for the quick pair, one more for the later load |
| 32 | Options: set Recheck after to 15 minutes, wait past it (or edit the setting after setting the system clock), do nothing | No request while idle. Then open the popup: one `/api/sites`. Reset the select to 12 hours |
| 33 | With a list older than the recheck time, pick an entry and fill | `/api/fill/<id>` first, then one `/api/sites` right after |
| 34 | Restart the browser, open the test login page | The button appears with no request at all (the list is on disk) |
| 35 | Add an entry in passman | It is not offered until Refresh now or a passman tab load |

## Sign-out and expiry

| # | Do | Expect |
|---|---|---|
| 36 | Sign out in the passman web app, reload that tab, open the test page | The list is wiped on that tab load (401): no button, no badge; the popup says "Sign in to passman"; options show "not loaded" |
| 37 | Sign in again in the passman tab (no reload) | About a second after signing in, one `/api/sites`; the list loads and the button is back on matching pages without reloading passman |
| 38 | Sign out of passman in another way (e.g. delete the session on the server) without reloading a passman tab, then pick an entry | "Signed out of passman" with an Open passman link; the list is wiped |
| 39 | Let `sessionExpires` pass (or set it short on the server), reload the test page | No button, and no request: the extension knows the session ended |
| 40a | In the passman web app click Sign out (without reloading other tabs) | Within a moment, with no request in the logs: the button and dot disappear on open tabs; popup says "Sign in to passman" |
| 40b | Sign in, let the list load, then in DevTools > Application > Cookies delete `passman_session` for the passman address | Same: wiped with no request. Sign in again to recover |
| 40c | Sign in, load the list, close the browser, delete the cookie (or use "clear cookies") and restart; open the popup | "Sign in to passman" and no request |
| 40d | In the extension's service worker DevTools open Application > Storage | `chrome.storage.local` holds only `origin` and `recheckMinutes`; the list is in IndexedDB `passman` > `kv` > `sitesCache` (visible only there) |
| 40 | Change the passman address in options | The old list is gone (options show "not loaded") until you refresh |

## Export backup

| # | Do | Expect |
|---|---|---|
| 41 | Options > Export backup: leave the password empty and click | "Enter your passman password." |
| 42 | Enter a wrong passman password | The server's message (401); the field is cleared |
| 43 | Enter the right password, no backup password | `passman-backup-<date>.json` (or the server's filename) downloads; fields cleared; the page warned about plain JSON |
| 44 | Enter the right password plus a backup password twice | An encrypted `.zip` downloads; mismatched confirmation is refused before any request |
| 45 | Check the request (logs or DevTools) | Only `POST <passman address>/api/export`, no cookie |
