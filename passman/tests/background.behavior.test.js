// Runs the real background.js in node:vm with a stubbed chrome API and a fetch spy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const EXT = 'extid';
const PASSMAN = 'http://127.0.0.1:18080';
const NONCE = 'a'.repeat(32);
const settle = () => new Promise((r) => setTimeout(r, 30));
const HOUR = 3600 * 1000;

const SITES = [
  { id: 'e1', label: 'Instagram main', schemes: ['https'], host: 'instagram.com', port: '', subdomains: true },
  { id: 'e2', label: 'Instagram alt', schemes: ['https'], host: 'instagram.com', port: '', subdomains: true },
];
const freshCache = (over = {}) => ({
  origin: PASSMAN, user: 'me', sessionExpires: Date.now() + 24 * HOUR, fetchedAt: Date.now(), sites: SITES, ...over,
});

// Minimal fake of the IndexedDB calls shared/store.js makes. Values are JSON-cloned like structured clone.
function fakeIdb(data) {
  const later = (fn) => setTimeout(fn, 0);
  return {
    open() {
      const req = {};
      later(() => {
        req.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore() {},
          transaction() {
            const tx = {};
            tx.objectStore = () => ({
              get: (k) => ({ result: data.has(k) ? JSON.parse(data.get(k)) : undefined }),
              put: (v, k) => { data.set(k, JSON.stringify(v)); return {}; },
              delete: (k) => { data.delete(k); return {}; },
            });
            later(() => tx.oncomplete && tx.oncomplete());
            return tx;
          },
        };
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };
}

function boot(opts = {}) {
  const listeners = { message: null, updated: [], changed: [], cookies: [] };
  const idbData = new Map();
  const cookieJar = { present: opts.cookie !== false };
  const store = { local: { origin: PASSMAN }, session: {} };
  if (opts.cache) idbData.set('sitesCache', JSON.stringify(opts.cache));
  const fetches = []; // { url, init }
  const sent = [];
  const area = (obj) => ({
    async get(k) {
      if (typeof k === 'string') return k in obj ? { [k]: obj[k] } : {};
      return { ...obj };
    },
    async set(o) { Object.assign(obj, o); },
    async remove(k) { delete obj[k]; },
  });
  const noop = { addListener() {} };
  const chrome = {
    runtime: { id: EXT, onMessage: { addListener: (f) => { listeners.message = f; } }, onInstalled: noop, onStartup: noop },
    storage: { local: area(store.local), session: area(store.session), onChanged: { addListener: (f) => listeners.changed.push(f) } },
    permissions: { contains: async () => true },
    cookies: {
      get: async () => (cookieJar.present ? { name: 'passman_session' } : null),
      onChanged: { addListener: (f) => listeners.cookies.push(f) },
    },
    tabs: {
      onUpdated: { addListener: (f) => listeners.updated.push(f) },
      onRemoved: noop,
      get: async () => ({ url: 'https://www.instagram.com/login' }),
      query: async () => [{ id: 1 }],
      sendMessage: async (tabId, msg, o) => { sent.push({ tabId, msg, opts: o }); return { ok: true }; },
    },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  };
  const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  const fetch = async (url, init) => {
    fetches.push({ url, init });
    const u = new URL(url);
    if (opts.status && u.pathname !== '/api/export') return json({}, opts.status);
    if (u.pathname === '/api/sites') {
      if (opts.sitesDelay) await new Promise((r) => setTimeout(r, opts.sitesDelay));
      return json({ user: opts.apiUser || 'me', sessionExpires: new Date(Date.now() + 24 * HOUR).toISOString(), sites: SITES });
    }
    if (u.pathname === '/api/fill/e1') return json({ username: 'u', password: 'pw' });
    return json({}, 404);
  };
  const ctx = vm.createContext({ chrome, fetch, URL, console, setTimeout, clearTimeout, Date, Promise, JSON, indexedDB: fakeIdb(idbData) });
  ctx.self = ctx;
  ctx.importScripts = (...fs_) => fs_.forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });

  const call = (msg, sender) => new Promise((resolve) => {
    const keep = listeners.message(msg, sender, resolve);
    if (!keep) resolve(undefined);
  });
  const paths = () => fetches.map((f) => new URL(f.url).pathname);
  const fills = () => sent.filter((s) => s.msg && s.msg.type === 'passman:fill');
  const cached = async () => { await settle(); return idbData.has('sitesCache') ? JSON.parse(idbData.get('sitesCache')) : undefined; };
  return { listeners, store, fetches, sent, call, paths, fills, chrome, idbData, cached, cookieJar, opts };
}

const page = { id: EXT, url: 'https://www.instagram.com/accounts/login/', frameId: 0, tab: { id: 1 }, documentId: 'doc1' };
const menuSender = { id: EXT, url: `chrome-extension://${EXT}/menu.html#${NONCE}`, frameId: 5, tab: { id: 1 } };
const popupSender = { id: EXT, url: `chrome-extension://${EXT}/popup.html`, frameId: 0 };

test('page load and menu open make zero fetches', async () => {
  const b = boot({ cache: freshCache() });
  assert.equal((await b.call({ type: 'cs:count' }, page)).count, 2);
  assert.equal((await b.call({ type: 'cs:count' }, { ...page, url: 'https://example.org/login' })).count, 0);
  assert.equal((await b.call({ type: 'cs:menuOpen', nonce: NONCE }, page)).ok, true);
  const list = await b.call({ type: 'menu:list', nonce: NONCE }, menuSender);
  assert.equal(list.ok, true);
  assert.equal(JSON.stringify(list.entries.map((e) => e.label)), JSON.stringify(['Instagram main', 'Instagram alt']));
  assert.equal(list.origin, PASSMAN);
  await settle();
  assert.equal(b.fetches.length, 0);
  assert.equal(b.fills().length, 0);
});

test('no list yet: no matches and no fetch', async () => {
  const b = boot();
  assert.equal((await b.call({ type: 'cs:count' }, page)).count, 0);
  await settle();
  assert.equal(b.fetches.length, 0);
});

test('expired session: no matches, menu says logged out, no fetch', async () => {
  const b = boot({ cache: freshCache({ sessionExpires: Date.now() - 1000 }) });
  assert.equal((await b.call({ type: 'cs:count' }, page)).count, 0);
  await b.call({ type: 'cs:menuOpen', nonce: NONCE }, page);
  const list = await b.call({ type: 'menu:list', nonce: NONCE }, menuSender);
  assert.equal(list.ok, false);
  assert.equal(list.error, 'logged_out');
  assert.equal((await b.call({ type: 'menu:fill', nonce: NONCE, id: 'e1' }, menuSender)).ok, false);
  await settle();
  assert.equal(b.fetches.length, 0);
  assert.equal(b.fills().length, 0);
});

test('IP pages never match or fill', async () => {
  const ip = { ...page, url: 'http://127.0.0.1:8080/login' };
  const b = boot({ cache: freshCache({ sites: [{ ...SITES[0], host: '127.0.0.1', schemes: ['http'], port: '8080', subdomains: false }] }) });
  assert.equal((await b.call({ type: 'cs:count' }, ip)).count, 0);
  await b.call({ type: 'cs:menuOpen', nonce: NONCE }, ip);
  assert.equal((await b.call({ type: 'menu:fill', nonce: NONCE, id: 'e1' }, menuSender)).ok, false);
  assert.equal(b.fetches.length, 0);
});

test('a pick makes exactly one fetch, /api/fill with the page origin, then fills', async () => {
  const b = boot({ cache: freshCache() });
  await b.call({ type: 'cs:menuOpen', nonce: NONCE }, page);
  assert.equal((await b.call({ type: 'menu:fill', nonce: 'b'.repeat(32), id: 'e1' }, menuSender)).ok, false);
  assert.equal((await b.call({ type: 'menu:fill', nonce: NONCE, id: 'e1' }, page)).ok, false, 'content sender');
  assert.equal(b.fetches.length, 0);
  assert.equal(b.fills().length, 0);
  const r = await b.call({ type: 'menu:fill', nonce: NONCE, id: 'e1' }, menuSender);
  assert.equal(r.ok, true);
  await settle();
  assert.equal(b.fetches.length, 1);
  const u = new URL(b.fetches[0].url);
  assert.equal(u.pathname, '/api/fill/e1');
  assert.equal(u.searchParams.get('url'), 'https://www.instagram.com');
  assert.equal(b.fetches[0].init.method, 'GET');
  assert.equal(b.fills().length, 1);
  assert.equal(b.fills()[0].opts.documentId, 'doc1');
  assert.equal(b.fills()[0].msg.source, 'menu');
});

test('an entry the local list does not match cannot be filled', async () => {
  const b = boot({ cache: freshCache() });
  await b.call({ type: 'cs:menuOpen', nonce: NONCE }, { ...page, url: 'https://example.org/' });
  assert.equal((await b.call({ type: 'menu:fill', nonce: NONCE, id: 'e1' }, menuSender)).ok, false);
  assert.equal(b.fetches.length, 0);
});

test('a 401 on fill wipes the list', async () => {
  const b = boot({ cache: freshCache(), status: 401 });
  await b.call({ type: 'cs:menuOpen', nonce: NONCE }, page);
  const r = await b.call({ type: 'menu:fill', nonce: NONCE, id: 'e1' }, menuSender);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unauthorized');
  assert.equal(await b.cached(), undefined);
  assert.equal(b.fills().length, 0);
  assert.equal((await b.call({ type: 'cs:count' }, page)).count, 0);
});

test('popup:fill fills only from the popup', async () => {
  const b = boot({ cache: freshCache() });
  const st = await b.call({ type: 'popup:status', tabId: 1 }, popupSender);
  assert.equal(st.status.state, 'connected');
  assert.equal(st.status.entries.length, 2);
  assert.equal(b.fetches.length, 0, 'fresh list: popup open makes no request');
  assert.equal((await b.call({ type: 'popup:fill', tabId: 1, id: 'e1' }, page)).ok, false);
  assert.equal(b.fills().length, 0);
  assert.equal((await b.call({ type: 'popup:fill', tabId: 1, id: 'e1' }, popupSender)).ok, true);
  assert.equal(b.fills().length, 1);
  assert.equal(b.fills()[0].msg.source, 'popup');
  assert.deepEqual({ ...b.fills()[0].opts }, { frameId: 0 });
  assert.equal(JSON.stringify(b.paths()), JSON.stringify(['/api/fill/e1']));
});

test('popup open refreshes only a stale list; a stale fill piggybacks a refresh', async () => {
  const stale = freshCache({ fetchedAt: Date.now() - 13 * HOUR });
  const b = boot({ cache: stale });
  await b.call({ type: 'popup:status', tabId: 1 }, popupSender);
  assert.equal(JSON.stringify(b.paths()), JSON.stringify(['/api/sites']));
  const c = boot({ cache: stale });
  await c.call({ type: 'cs:menuOpen', nonce: NONCE }, page);
  await c.call({ type: 'menu:fill', nonce: NONCE, id: 'e1' }, menuSender);
  await settle();
  assert.equal(JSON.stringify(c.paths()), JSON.stringify(['/api/fill/e1', '/api/sites']));
});

test('page loads, other tabs and options status never contact passman; passman tab loads refresh', async () => {
  const b = boot({ cache: freshCache() });
  for (const f of b.listeners.updated) f(2, { status: 'complete' }, { url: 'https://example.org/login' });
  for (const f of b.listeners.updated) f(2, { status: 'loading' }, { url: 'https://example.org/login' });
  await b.call({ type: 'options:status' }, { id: EXT, url: `chrome-extension://${EXT}/options.html`, frameId: 0, tab: { id: 9 } });
  await settle();
  assert.equal(b.fetches.length, 0);
  for (const f of b.listeners.updated) f(3, { status: 'complete' }, { url: PASSMAN + '/' });
  await settle();
  assert.equal(JSON.stringify(b.paths()), JSON.stringify(['/api/sites']));
  assert.equal(b.fills().length, 0);
});

test('a refresh that returns a different user replaces the list; origin change drops it', async () => {
  const b = boot({ cache: freshCache({ user: 'someone-else' }) });
  await b.call({ type: 'options:refresh' }, { id: EXT, url: `chrome-extension://${EXT}/options.html`, frameId: 0, tab: { id: 9 } });
  assert.equal((await b.cached()).user, 'me');
  b.store.local.origin = 'http://other.example';
  assert.equal((await b.call({ type: 'cs:count' }, page)).count, 0, 'cache of another origin is ignored');
});

test('a forced refresh is not swallowed by a running non-forced one', async () => {
  const b = boot({ sitesDelay: 60 });
  for (const f of b.listeners.updated) f(3, { status: 'complete' }, { url: PASSMAN + '/' });
  await settle();
  const opt = { id: EXT, url: `chrome-extension://${EXT}/options.html`, frameId: 0, tab: { id: 9 } };
  await b.call({ type: 'options:refresh' }, opt);
  assert.equal(b.paths().filter((p) => p === '/api/sites').length, 2);
});

test('no alarm API is used', () => {
  const b = boot();
  assert.equal(b.chrome.alarms, undefined);
});

test('the site list is never written to chrome.storage (content scripts can read it)', async () => {
  const b = boot({});
  await b.call({ type: 'options:refresh' }, { id: EXT, url: `chrome-extension://${EXT}/options.html`, frameId: 0, tab: { id: 9 } });
  assert.ok(b.idbData.has('sitesCache'));
  assert.equal(JSON.stringify(b.store.local).includes('example'), false);
  assert.equal('sitesCache' in b.store.local, false);
  assert.equal('sitesCache' in b.store.session, false);
  assert.equal(JSON.stringify(b.store.session).includes('instagram'), false);
});

const cookieEvent = (over = {}) => ({ removed: true, cause: 'explicit', cookie: { name: 'passman_session', domain: '127.0.0.1' }, ...over });

test('removing the passman session cookie wipes the list without any request', async () => {
  const b = boot({ cache: freshCache() });
  for (const f of b.listeners.cookies) await f(cookieEvent());
  assert.equal(await b.cached(), undefined);
  assert.equal((await b.call({ type: 'cs:count' }, page)).count, 0);
  assert.ok(b.sent.some((s) => s.msg.type === 'passman:sitesUpdated'));
  assert.equal(b.fetches.length, 0);
});

test('cookie events that are not a sign-out leave the list alone', async () => {
  const b = boot({ cache: freshCache() });
  for (const f of b.listeners.cookies) {
    await f(cookieEvent({ cause: 'overwrite' }));                       // refreshed
    await f(cookieEvent({ removed: false }));                           // set
    await f(cookieEvent({ cookie: { name: 'other', domain: '127.0.0.1' } }));
    await f(cookieEvent({ cookie: { name: 'passman_session', domain: 'evil.example' } }));
  }
  assert.ok(await b.cached());
  assert.equal(b.fetches.length, 0);
});

test('cookie already gone at popup open or menu open: wiped, no request', async () => {
  const b = boot({ cache: freshCache(), cookie: false });
  const st = await b.call({ type: 'popup:status', tabId: 1 }, popupSender);
  assert.equal(st.status.state, 'logged_out');
  assert.equal(await b.cached(), undefined);

  const c = boot({ cache: freshCache() });
  await c.call({ type: 'cs:menuOpen', nonce: NONCE }, page);
  c.cookieJar.present = false;
  const list = await c.call({ type: 'menu:list', nonce: NONCE }, menuSender);
  assert.equal(list.error, 'logged_out');
  assert.equal(await c.cached(), undefined);
  assert.equal(c.fetches.length, 0);
  assert.equal(c.fills().length, 0);
});

test('signing in (cookie set) refreshes the list even after a 401 on the login page', async () => {
  const b = boot({ status: 401, cookie: false });
  for (const f of b.listeners.updated) f(3, { status: 'complete' }, { url: PASSMAN + '/' }); // login page loads
  await settle();
  assert.equal(JSON.stringify(b.paths()), JSON.stringify(['/api/sites']));
  assert.equal(await b.cached(), undefined);
  // the user signs in (SPA, no navigation): the session cookie is set
  b.opts.status = 0;
  b.cookieJar.present = true;
  for (const f of b.listeners.cookies) await f(cookieEvent({ removed: false, cause: 'explicit' }));
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(b.paths().filter((p) => p === '/api/sites').length, 2, 'second refresh, bypassing the 5 s debounce');
  assert.equal((await b.cached()).user, 'me');
  assert.equal((await b.call({ type: 'cs:count' }, page)).count, 2);
  assert.equal(b.fills().length, 0);
});

test('cookie-set refresh chains after a refresh already in flight, and bursts collapse to one', async () => {
  const b = boot({ sitesDelay: 80 });
  for (const f of b.listeners.updated) f(3, { status: 'complete' }, { url: PASSMAN + '/' });
  await settle();
  const set = () => Promise.all(b.listeners.cookies.map((f) => f(cookieEvent({ removed: false, cause: 'explicit' }))));
  await set(); await set(); await set();
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(b.paths().filter((p) => p === '/api/sites').length, 2, 'tab-load refresh + one chained login refresh');
});

test('cookie-set for another cookie or domain does not refresh', async () => {
  const b = boot({ cache: freshCache() });
  for (const f of b.listeners.cookies) {
    await f(cookieEvent({ removed: false, cookie: { name: 'other', domain: '127.0.0.1' } }));
    await f(cookieEvent({ removed: false, cookie: { name: 'passman_session', domain: 'evil.example' } }));
  }
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(b.fetches.length, 0);
});
