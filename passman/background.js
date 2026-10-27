// Passman service worker. The only place that talks to the passman server for the
// extension's own purposes (the options page does the backup export itself).
//
// PRIVACY MODEL: passman is contacted only when the user acts (see README "What passman
// sees"). Pages are matched against a saved-sites list kept in the worker's IndexedDB; loading a
// page, opening the in-page menu and the timer-less recheck never make a request.
importScripts('shared/logic.js', 'shared/store.js');

const L = self.PassmanLogic;
const EXT_ID = chrome.runtime.id;
// The saved-sites list lives in this worker's own IndexedDB (extension origin only), never in
// chrome.storage.local, which content scripts can read. storage.local keeps only the
// passman address and the recheck setting.
const store = self.PassmanStore.createIdbStore(self.indexedDB);
chrome.storage.local.remove('sitesCache').catch(() => {}); // left over from an older version

// ---- configuration ----

async function getOrigin() {
  const { origin } = await chrome.storage.local.get('origin');
  return L.normalizeOrigin(origin) || null;
}

async function getRecheckMinutes() {
  const { recheckMinutes } = await chrome.storage.local.get('recheckMinutes');
  return L.normalizeInterval(recheckMinutes);
}

async function hasPermission(origin) {
  try {
    return await chrome.permissions.contains({ origins: [origin + '/*'] });
  } catch (e) {
    return false;
  }
}

// ---- passman API (the session cookie rides along) ----

// Resolves to { ok:true, data } or { ok:false, error } where error is one of
// not_configured | no_permission | unreachable | unauthorized | not_found | bad_response.
async function api(path) {
  const origin = await getOrigin();
  if (!origin) return { ok: false, error: 'not_configured' };
  if (!(await hasPermission(origin))) return { ok: false, error: 'no_permission' };
  let res;
  try {
    res = await fetch(origin + path, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
  } catch (e) {
    return { ok: false, error: 'unreachable' };
  }
  if (res.status === 401) {
    await wipeCache();
    return { ok: false, error: 'unauthorized' };
  }
  if (res.status === 404) return { ok: false, error: 'not_found' };
  if (!res.ok) return { ok: false, error: 'bad_response' };
  try {
    return { ok: true, data: await res.json(), origin };
  } catch (e) {
    return { ok: false, error: 'bad_response' };
  }
}

async function tabUrl(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab && typeof tab.url === 'string' ? tab.url : '';
  } catch (e) {
    return '';
  }
}

// ---- saved-sites list: { origin, user, sessionExpires, fetchedAt, sites } in IndexedDB ----

const CACHE_KEY = 'sitesCache';
const DEBOUNCE_MS = 5000; // minimum gap between refreshes started by passman tab loads
let refreshing = null;
let refreshingForce = false;

// The cached list for the configured passman address, or null.
async function readCache() {
  const origin = await getOrigin();
  const c = await store.get(CACHE_KEY).catch(() => null);
  if (!origin || !c || c.origin !== origin || !Array.isArray(c.sites) || !Number.isFinite(c.sessionExpires)) return null;
  return c;
}

// Matching state without any network: 'none' | 'expired' | 'ok'.
function cacheState(cache) {
  if (!cache) return 'none';
  return L.sessionActive(cache, Date.now()) ? 'ok' : 'expired';
}

async function wipeCache() {
  await store.remove(CACHE_KEY).catch(() => {});
  chrome.action.setBadgeText({ text: '' }).catch(() => {});
  chrome.tabs.query({}).then((tabs) => tabs.forEach((t) => setBadge(t.id, 0)), () => {});
  notifyTabs();
}

// force=false honours the 5 s debounce (passman tab loads). A forced call is never
// swallowed by a running non-forced one: it runs right after it.
function refreshSites(force, chain) {
  // chain: always run after whatever is in flight (it may have started before a sign-in).
  if (refreshing && !chain && (!force || refreshingForce)) return refreshing;
  const prev = refreshing;
  refreshingForce = force;
  const p = (async () => {
    if (prev) await prev.catch(() => {});
    const { sitesAttemptAt } = await chrome.storage.session.get('sitesAttemptAt');
    if (!force && typeof sitesAttemptAt === 'number' && Date.now() - sitesAttemptAt < DEBOUNCE_MS) return { ok: true, skipped: true };
    await chrome.storage.session.set({ sitesAttemptAt: Date.now() });
    const r = await api('/api/sites');
    if (!r.ok) return r;
    const rec = L.parseCache(r.data, r.origin, Date.now());
    if (!rec) return { ok: false, error: 'bad_response' };
    const old = await readCache();
    if (old && old.user !== rec.user) await wipeCache(); // a different account: nothing carries over
    await store.set(CACHE_KEY, rec);
    notifyTabs();
    return { ok: true };
  })();
  const tracked = p.finally(() => { if (refreshing === tracked) { refreshing = null; refreshingForce = false; } });
  refreshing = tracked;
  return tracked;
}

// Tell open pages to re-check themselves against the new list (content scripts
// cannot read it). Tabs without our content script just ignore the message.
function notifyTabs() {
  chrome.tabs.query({}).then((tabs) => {
    for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'passman:sitesUpdated' }, { frameId: 0 }).catch(() => {});
  }, () => {});
}

async function listInfo(cache) {
  return {
    count: cache ? cache.sites.length : 0,
    fetchedAt: cache ? cache.fetchedAt : 0,
    sessionExpires: cache ? cache.sessionExpires : 0,
    user: cache ? cache.user : '',
  };
}

// Status for the popup and options, from the local list only (no network).
async function localStatus() {
  const origin = await getOrigin();
  if (!origin) return { state: 'not_configured', origin };
  if (!(await hasPermission(origin))) return { state: 'no_permission', origin };
  const cache = await readCache();
  const cs = cacheState(cache);
  const info = await listInfo(cache);
  if (cs === 'ok') return { state: 'connected', origin, user: { username: cache.user }, sessionExpires: cache.sessionExpires, sites: info };
  return { state: 'logged_out', origin, sites: info };
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.origin) store.remove(CACHE_KEY).then(notifyTabs, () => {});
});

// ---- signed-out detection without a request: the passman session cookie ----
// chrome.cookies is a local API; no network is involved.

const SESSION_COOKIE = 'passman_session';

function isPassmanCookie(cookie, origin) {
  try {
    return !!cookie && cookie.name === SESSION_COOKIE &&
      String(cookie.domain || '').replace(/^\./, '').toLowerCase() === new URL(origin).hostname;
  } catch (e) {
    return false;
  }
}

// The cookie was deleted or expired (logout in the web app, server clearing it, expiry).
// 'overwrite' is a refresh of the cookie, not a sign-out.
// Signing in sets the cookie: the user just acted and passman is awake, so load the list now
// (passman's login is a single-page flow, so no tab load would otherwise follow it).
const LOGIN_REFRESH_MS = 1000;
let loginTimer = null;

chrome.cookies.onChanged.addListener(async (info) => {
  if (!info) return;
  if (!info.removed) {
    const origin = await getOrigin();
    if (origin && isPassmanCookie(info.cookie, origin)) {
      clearTimeout(loginTimer);
      // forced + chained: bypasses the 5 s tab-load debounce, and runs after a refresh that
      // may have started on the login page before the cookie existed (and got a 401).
      loginTimer = setTimeout(() => { refreshSites(true, true); }, LOGIN_REFRESH_MS);
    }
    return;
  }
  if (info.cause === 'overwrite') return;
  const origin = await getOrigin();
  if (origin && isPassmanCookie(info.cookie, origin)) wipeCache();
});

// If the cookie is already gone (browser restart, cookies cleared), treat as signed out.
// Called when the popup or the in-page menu opens, and at worker start.
// Returns false only when the cookie is known to be missing.
async function checkSession() {
  const origin = await getOrigin();
  if (!origin || !(await hasPermission(origin))) return true;
  let cookie;
  try {
    cookie = await chrome.cookies.get({ url: origin + '/', name: SESSION_COOKIE });
  } catch (e) {
    return true; // cannot tell: leave the list alone
  }
  if (!cookie && (await readCache())) await wipeCache();
  return !!cookie;
}
checkSession();

// A passman tab finished loading (its URL is readable thanks to the passman host
// permission): the user may have just logged in or out.
chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status === 'loading') {
    setBadge(tabId, 0);
    clearNonce(tabId);
  }
  if (change.status !== 'complete' || !tab || typeof tab.url !== 'string') return;
  const origin = await getOrigin();
  if (origin && L.sameOrigin(tab.url, origin)) refreshSites(false);
});
chrome.tabs.onRemoved.addListener((tabId) => clearNonce(tabId));

// ---- badge ----

function setBadge(tabId, count) {
  // "has a match" only: the list can hold the same site more than once.
  const text = count > 0 ? '•' : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (count > 0) chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' }).catch(() => {});
}

// ---- menu session: only the menu iframe our content script opened may ask for entries ----
// Bound to the nonce, the exact document that opened it, and the page URL at that time.

const sessionKey = (tabId) => 'menu:' + tabId;
async function setSession(tabId, session) {
  await chrome.storage.session.set({ [sessionKey(tabId)]: session });
}
async function getSession(tabId, nonce) {
  const v = (await chrome.storage.session.get(sessionKey(tabId)))[sessionKey(tabId)];
  return v && typeof v.nonce === 'string' && v.nonce === nonce ? v : null;
}
function clearNonce(tabId) {
  chrome.storage.session.remove(sessionKey(tabId)).catch(() => {});
}

function toContent(tabId, message, documentId) {
  const target = documentId ? { documentId } : { frameId: 0 };
  return chrome.tabs.sendMessage(tabId, message, target).catch(() => null);
}

// ---- fill ----

// NEVER AUTO-FILL: this function is reached only from the 'menu:fill' and 'popup:fill'
// cases below, i.e. after the user clicked Autofill / an entry / Fill. It is the only
// place that sends 'passman:fill' and the only caller of /api/fill (enforced by
// tests/invariants.test.js). This is also the first time passman hears about the page.
// source: 'menu' | 'popup'. Secrets live only in local variables of this call.
// For the menu, `session` pins the page URL and document that opened it; the popup
// reads the active tab's URL (activeTab permission).
async function fillEntry(tabId, id, source, session) {
  const url = source === 'menu' ? session.url : await tabUrl(tabId);
  const documentId = source === 'menu' ? session.documentId : undefined;
  if (!L.isWebUrl(url)) return { ok: false, error: 'bad_tab' };
  if (source === 'menu' && !documentId) return { ok: false, error: 'bad_tab' };
  const cache = await readCache();
  if (cacheState(cache) !== 'ok') return { ok: false, error: 'logged_out' };
  // The entry must be one the local list says matches this page (IP pages never do).
  if (!L.matchingSites(cache.sites, url).some((e) => e.id === id)) return { ok: false, error: 'no_match' };
  const r = await api('/api/fill/' + encodeURIComponent(id) + '?url=' + encodeURIComponent(L.pageOrigin(url)));
  if (!r.ok) return { ok: false, error: r.error === 'not_found' ? 'no_match' : r.error };
  const secret = L.sanitizeSecret(r.data);
  if (!secret) return { ok: false, error: 'bad_response' };
  // The popup path: the tab may have navigated while we were fetching. (The menu path
  // is pinned to its document: the message fails if that document is gone.)
  if (source === 'popup' && (await tabUrl(tabId)) !== url) return { ok: false, error: 'tab_changed' };
  const res = await toContent(tabId, { type: 'passman:fill', source, url, username: secret.username, password: secret.password }, documentId);
  if (!res) return { ok: false, error: 'no_content' };
  if (!res.ok) return { ok: false, error: res.reason || 'fill_failed' };
  // We just talked to passman anyway: refresh the list if it is past its recheck time.
  if (L.isStale(cache, await getRecheckMinutes(), Date.now())) refreshSites(true);
  return { ok: true };
}

// ---- message router ----

async function handle(msg, kind, sender) {
  const tabId = sender.tab && sender.tab.id;
  switch (msg.type) {
    case 'cs:count': {
      // LOCAL ONLY: no request of any kind is made on this path, so loading a page can
      // never reach passman, not even as a timing signal.
      const cache = await readCache();
      const count = cacheState(cache) === 'ok' ? L.countMatches(cache.sites, sender.url) : 0;
      setBadge(tabId, count);
      return { ok: true, count };
    }
    case 'cs:menuOpen':
      await setSession(tabId, {
        nonce: msg.nonce,
        documentId: sender.documentId || '',
        origin: L.pageOrigin(sender.url) || '',
        url: sender.url,
      });
      return { ok: true };
    case 'cs:menuClose':
      clearNonce(tabId);
      return { ok: true };
    case 'menu:list': {
      // Labels from the local list; no network.
      const session = await getSession(tabId, msg.nonce);
      if (!session) return { ok: false, error: 'denied' };
      await checkSession();
      const cache = await readCache();
      const origin = await getOrigin();
      if (cacheState(cache) !== 'ok') return { ok: false, error: 'logged_out', origin };
      return { ok: true, origin, entries: L.matchingSites(cache.sites, session.url) };
    }
    case 'menu:fill': {
      const session = await getSession(tabId, msg.nonce);
      if (!session) return { ok: false, error: 'denied' };
      const res = await fillEntry(tabId, msg.id, 'menu', session);
      return { ...res, origin: await getOrigin() };
    }
    case 'menu:close': {
      const session = await getSession(tabId, msg.nonce);
      if (!session) return { ok: false, error: 'denied' };
      await toContent(tabId, { type: 'passman:close' }, session.documentId);
      return { ok: true };
    }
    case 'popup:status': {
      // Popup open: ask passman only if the list is missing or past its recheck time.
      const signedIn = await checkSession();
      let status = await localStatus();
      let cache = await readCache();
      let refreshError = null;
      if (signedIn && status.state !== 'not_configured' && status.state !== 'no_permission' &&
          L.isStale(cache, await getRecheckMinutes(), Date.now())) {
        const r = await refreshSites(true);
        if (r && !r.ok) refreshError = r.error;
        status = await localStatus();
        cache = await readCache();
      }
      if (status.state === 'logged_out' && refreshError === 'unreachable') status.state = 'unreachable';
      if (status.state === 'connected' && msg.tabId !== undefined) {
        const entries = L.matchingSites(cache.sites, await tabUrl(msg.tabId));
        status.entries = entries;
        setBadge(msg.tabId, entries.length);
      }
      return { ok: true, status };
    }
    case 'options:status':
      return { ok: true, status: await localStatus() };
    case 'options:refresh': {
      const r = await refreshSites(true);
      const status = await localStatus();
      if (r && !r.ok && status.state === 'logged_out' && r.error === 'unreachable') status.state = 'unreachable';
      return { ok: true, status };
    }
    case 'popup:fill':
      return fillEntry(msg.tabId, msg.id, 'popup');
  }
  return { ok: false, error: 'unknown' };
}

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  const kind = L.classifySender(sender, EXT_ID);
  const msg = L.validateMessage(raw, kind);
  if (!msg) {
    sendResponse({ ok: false, error: 'denied' });
    return false;
  }
  handle(msg, kind, sender).then(sendResponse, () => sendResponse({ ok: false, error: 'internal' }));
  return true;
});
