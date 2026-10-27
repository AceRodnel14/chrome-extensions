// Pure logic shared by the service worker, the pages and the node tests.
// No chrome.* and no DOM access in here.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PassmanLogic = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
  const NONCE_RE = /^[0-9a-f]{32}$/;
  const MAX_ENTRIES = 50;

  // "passman.example.com", "http://127.0.0.1:18080/vault?x=1" -> an origin, or null.
  function normalizeOrigin(input) {
    if (typeof input !== 'string') return null;
    let s = input.trim();
    if (!s || s.length > 300 || /\s/.test(s)) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      const host = s.split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      s = (isLoopback(host) ? 'http://' : 'https://') + s;
    }
    let u;
    try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password || !u.hostname) return null;
    return u.origin;
  }

  function isLoopback(host) {
    return host === 'localhost' || host === '::1' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);
  }

  // Plain http to something that is not this machine: the session cookie and the
  // passwords would cross the network in clear text.
  function isInsecureRemote(origin) {
    try {
      const u = new URL(origin);
      return u.protocol === 'http:' && !isLoopback(u.hostname);
    } catch (e) { return false; }
  }

  function isWebUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url);
  }

  function sameOrigin(url, origin) {
    try { return new URL(url).origin === origin; } catch (e) { return false; }
  }

  // Which kind of extension context sent a message? Decided only from what the
  // browser sets on `sender`, never from the message body.
  function classifySender(sender, extId) {
    if (!sender || sender.id !== extId) return null;
    const url = typeof sender.url === 'string' ? sender.url : '';
    if (/^https?:\/\//i.test(url)) {
      const topFrame = sender.frameId === 0 && sender.tab && Number.isInteger(sender.tab.id);
      return topFrame ? 'content' : null;
    }
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    if (u.protocol !== 'chrome-extension:' || u.host !== extId) return null;
    if (u.pathname === '/menu.html') {
      const inFrame = Number.isInteger(sender.frameId) && sender.frameId > 0 && sender.tab && Number.isInteger(sender.tab.id);
      return inFrame ? 'menu' : null;
    }
    if (u.pathname === '/popup.html') return 'popup';
    if (u.pathname === '/options.html') return 'options';
    return null;
  }

  const ALLOWED = {
    content: ['cs:count', 'cs:menuOpen', 'cs:menuClose'],
    menu: ['menu:list', 'menu:fill', 'menu:close'],
    popup: ['popup:status', 'popup:fill'],
    options: ['options:status', 'options:refresh'],
  };

  // Returns a cleaned copy of the message, or null when it is not acceptable.
  function validateMessage(msg, kind) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return null;
    if (!kind || !ALLOWED[kind] || !ALLOWED[kind].includes(msg.type)) return null;
    const out = { type: msg.type };
    switch (msg.type) {
      case 'cs:count':
      case 'cs:menuClose':
      case 'options:status':
      case 'options:refresh':
        break;
      case 'cs:menuOpen':
        if (!NONCE_RE.test(msg.nonce)) return null;
        out.nonce = msg.nonce;
        break;
      case 'menu:list':
      case 'menu:close':
        if (!NONCE_RE.test(msg.nonce)) return null;
        out.nonce = msg.nonce;
        break;
      case 'menu:fill':
        if (!NONCE_RE.test(msg.nonce) || !ID_RE.test(msg.id)) return null;
        out.nonce = msg.nonce;
        out.id = msg.id;
        break;
      case 'popup:status':
        if (msg.tabId !== undefined && !Number.isInteger(msg.tabId)) return null;
        out.tabId = msg.tabId;
        break;
      case 'popup:fill':
        if (!Number.isInteger(msg.tabId) || !ID_RE.test(msg.id)) return null;
        out.tabId = msg.tabId;
        out.id = msg.id;
        break;
      default:
        return null;
    }
    return out;
  }

  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

  function sanitizeSecret(data) {
    if (!data || typeof data.password !== 'string' || data.password.length > 4096) return null;
    return { username: str(data.username, 1024), password: data.password };
  }

  // ---- overlay check helpers (the DOM part lives in content.js) ----

  // Points spread over a rect: corners (inset), edge midpoints and the centre.
  function samplePoints(rect, inset) {
    const i = inset == null ? 4 : inset;
    const l = rect.left + i, r = rect.right - i, t = rect.top + i, b = rect.bottom - i;
    const cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2;
    return [[l, t], [cx, t], [r, t], [l, cy], [cx, cy], [r, cy], [l, b], [cx, b], [r, b]];
  }

  const isNone = (v) => v == null || v === '' || v === 'none' || String(v).startsWith('none ');

  // `style` is { opacity, visibility, display, pointerEvents, transform, filter, mask,
  // maskImage, clipPath, mixBlendMode } as computed-style strings. Properties that
  // are absent (undefined) are not judged, so one function serves host, iframe, html and body.
  function styleTampered(style) {
    if (!style) return true;
    const opacity = parseFloat(style.opacity);
    if (!(opacity >= 1)) return true;
    if (style.visibility !== 'visible') return true;
    if (style.display === 'none') return true;
    if (style.pointerEvents === 'none') return true;
    if (!isNone(style.transform) || !isNone(style.filter) || !isNone(style.mask) ||
        !isNone(style.maskImage) || !isNone(style.clipPath)) return true;
    if (style.mixBlendMode != null && style.mixBlendMode !== '' && style.mixBlendMode !== 'normal') return true;
    return false;
  }

  // The iframe must still sit exactly where it was opened (tolerance in px).
  function rectMoved(now, recorded, tol) {
    const t = tol == null ? 1 : tol;
    return ['left', 'top', 'width', 'height'].some((k) => !(Math.abs(now[k] - recorded[k]) <= t));
  }

  // The origin is all the server gets to see of a page's URL.
  function pageOrigin(url) {
    if (!isWebUrl(url)) return null;
    try { return new URL(url).origin; } catch (e) { return null; }
  }

  // Menu-side gate: the fill is accepted only after the iframe has been reported
  // visible (IntersectionObserver v2) continuously for `minMs`.
  function makeVisibilityGate(minMs) {
    let since = null;
    return {
      update(isVisible, now) {
        if (isVisible === true) { if (since === null) since = now; } else since = null;
      },
      ok(now) { return since !== null && now - since >= minMs; },
    };
  }

  // hits: array of booleans, true when elementFromPoint returned our host.
  function overlayVerdict(hits, styles) {
    if (!hits.length || !hits.every(Boolean)) return { ok: false, reason: 'covered' };
    if (styles.some(styleTampered)) return { ok: false, reason: 'tampered' };
    return { ok: true };
  }

  // ---- local site matching (the server only ever sends the list of sites) ----

  const DEFAULT_PORT = { http: '80', https: '443' };
  const INTERVALS = [15, 60, 360, 720, 1440]; // minutes: "recheck after"
  const DEFAULT_INTERVAL = 720;

  function normalizeInterval(v) {
    const n = Number(v);
    return INTERVALS.includes(n) ? n : DEFAULT_INTERVAL;
  }

  // Keep only well-formed site records from GET /api/sites.
  function parseSites(data) {
    if (!data || !Array.isArray(data.sites)) return [];
    const out = [];
    for (const x of data.sites) {
      if (!x || typeof x.id !== 'string' || !ID_RE.test(x.id)) continue;
      if (typeof x.host !== 'string' || !x.host || x.host.length > 300) continue;
      if (!Array.isArray(x.schemes)) continue;
      const schemes = x.schemes.filter((v) => v === 'http' || v === 'https');
      if (!schemes.length) continue;
      const port = typeof x.port === 'string' ? x.port : '';
      if (port && !/^\d{1,5}$/.test(port)) continue;
      out.push({ id: x.id, label: str(x.label, 200), schemes, host: x.host.toLowerCase(), port, subdomains: x.subdomains === true });
      if (out.length >= 5000) break;
    }
    return out;
  }

  // Does this site record cover the page URL?
  function siteMatches(site, url) {
    let u;
    try { u = new URL(url); } catch (e) { return false; }
    const scheme = u.protocol.slice(0, -1);
    if (scheme !== 'http' && scheme !== 'https') return false;
    if (!site.schemes.includes(scheme)) return false;
    const pagePort = u.port || DEFAULT_PORT[scheme];
    if (pagePort !== (site.port || DEFAULT_PORT[scheme])) return false;
    const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, ''); // lower-cased, punycode, no trailing root dot
    // IP literals never match: nothing is offered or filled on a page opened by IP address.
    if (isIpHost(host)) return false;
    return host === site.host || (site.subdomains === true && host.endsWith('.' + site.host));
  }

  function isIpHost(host) {
    return /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':');
  }

  // Local entries for a page: [{id, label}] (at most MAX_ENTRIES).
  function matchingSites(sites, url) {
    const out = [];
    for (const s of sites) {
      if (siteMatches(s, url)) out.push({ id: s.id, label: s.label });
      if (out.length >= MAX_ENTRIES) break;
    }
    return out;
  }

  function countMatches(sites, url) {
    let n = 0;
    for (const s of sites) if (siteMatches(s, url)) n++;
    return n;
  }

  // GET /api/sites answer -> the record kept in storage.local, or null if malformed.
  function parseCache(data, origin, now) {
    if (!data || typeof data !== 'object') return null;
    const u = data.user;
    const user = typeof u === 'string' ? u : (u && typeof u.username === 'string' ? u.username : '');
    const expires = Date.parse(data.sessionExpires);
    if (!user || !Number.isFinite(expires)) return null;
    return { origin, user: user.slice(0, 100), sessionExpires: expires, fetchedAt: now, sites: parseSites(data) };
  }

  // The list counts as signed out once the session end has passed (no network needed).
  function sessionActive(cache, now) {
    return !!cache && Number.isFinite(cache.sessionExpires) && now <= cache.sessionExpires;
  }

  function isStale(cache, minutes, now) {
    return !cache || !(now - cache.fetchedAt <= minutes * 60000);
  }

  // The only request that carries the user's passman password. Goes to <origin>/api/export,
  // never with the cookie. Pure so the tests can check exactly where it points.
  function buildExportRequest(origin, username, password, backupPassword) {
    const body = { username, password };
    if (backupPassword) body.backupPassword = backupPassword;
    return {
      url: origin + '/api/export',
      init: {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    };
  }

  // Name from Content-Disposition (basename only), else passman-backup-<date>.json|.zip.
  function exportFilename(disposition, contentType, now) {
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition || '');
    if (m) {
      let name = m[1];
      try { name = decodeURIComponent(name); } catch (e) { /* keep raw */ }
      name = name.split(/[\\/]/).pop().replace(/[^\w.\- ]/g, '_').slice(0, 120);
      if (name && name !== '.' && name !== '..') return name;
    }
    const ext = /zip/i.test(contentType || '') ? 'zip' : 'json';
    return 'passman-backup-' + new Date(now).toISOString().slice(0, 10) + '.' + ext;
  }

  return {
    DEFAULT_PORT, INTERVALS, DEFAULT_INTERVAL, normalizeInterval, parseSites, siteMatches, matchingSites, countMatches, isIpHost,
    parseCache, sessionActive, isStale, buildExportRequest, exportFilename,
    ID_RE, NONCE_RE, MAX_ENTRIES,
    normalizeOrigin, isLoopback, isInsecureRemote, isWebUrl, sameOrigin,
    classifySender, validateMessage, sanitizeSecret,
    samplePoints, styleTampered, overlayVerdict, rectMoved, pageOrigin, makeVisibilityGate,
  };
});
