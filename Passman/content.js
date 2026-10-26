// Passman content script: top frame of http(s) pages only.
// Finds login forms, shows a small button in the fields (closed shadow root) and
// opens the entry menu as an extension iframe. Never sees entry lists or secrets
// until the service worker pushes a verified fill message.
(() => {
  'use strict';
  if (window.__passmanContent) return;
  window.__passmanContent = true;

  const L = window.PassmanLogic;
  const D = window.PassmanDetect;
  const MENU_W = 320;
  const MENU_H = 232;
  const BTN = 22;

  const state = {
    enabled: false,
    forms: [],
    fields: new Set(),     // detected username/password inputs
    count: 0,
    countFor: null,        // location.href the count belongs to
    btn: null,             // { host, el }
    btnField: null,
    btnHover: false,
    menu: null,            // { host, iframe, nonce, form, w, h }
  };
  let observer = null;
  let scanTimer = null;
  let hideTimer = null;

  // ---- helpers ----

  function send(message) {
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function randomHex() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  function isVisible(el) {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(el);
    return cs.visibility === 'visible' && cs.display !== 'none' && parseFloat(cs.opacity) > 0;
  }

  function makeHost() {
    const host = document.createElement('div');
    const css = { all: 'initial', position: 'fixed', top: '0', left: '0', width: '0', height: '0', 'z-index': '2147483647', display: 'block', 'pointer-events': 'auto' };
    for (const k of Object.keys(css)) host.style.setProperty(k, css[k], 'important');
    const shadow = host.attachShadow({ mode: 'closed' });
    document.documentElement.appendChild(host);
    return { host, shadow };
  }

  function isOurs(node) {
    return (state.btn && node === state.btn.host) || (state.menu && node === state.menu.host);
  }

  // ---- scanning ----

  function scheduleScan(delay) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, delay == null ? 300 : delay);
  }

  function detect() {
    return D.findLoginForms(document, isVisible);
  }

  function scan() {
    if (!state.enabled) return;
    state.forms = detect();
    state.fields = new Set();
    for (const f of state.forms) {
      state.fields.add(f.password);
      if (f.username) state.fields.add(f.username);
    }
    if (!state.forms.length) {
      state.countFor = null;
      state.count = 0;
      hideAll();
      return;
    }
    if (state.countFor !== location.href) {
      state.countFor = location.href;
      send({ type: 'cs:count' }).then((r) => {
        state.count = r && r.ok && Number.isInteger(r.count) ? r.count : 0;
        if (!state.count) hideAll();
        else if (document.activeElement && state.fields.has(document.activeElement)) showButton(document.activeElement);
      });
    }
  }

  function formOf(field) {
    return state.forms.find((f) => f.password === field || f.username === field) || null;
  }

  // ---- field button ----

  function ensureButton() {
    if (state.btn) return state.btn;
    const { host, shadow } = makeHost();
    const style = document.createElement('style');
    style.textContent =
      'button{all:initial;position:fixed;box-sizing:border-box;width:' + BTN + 'px;height:' + BTN + 'px;border-radius:5px;' +
      'background:#fff;border:1px solid #c9ced6;cursor:pointer;display:none;align-items:center;justify-content:center;' +
      'box-shadow:0 1px 3px rgba(0,0,0,.35);pointer-events:auto}' +
      'button:hover{background:#eef3ff}img{all:initial;width:16px;height:16px;display:block;pointer-events:none}';
    const el = document.createElement('button');
    el.setAttribute('aria-label', 'Passman: autofill');
    el.title = 'Passman';
    const img = document.createElement('img');
    img.src = window.PassmanLogo || '';
    img.alt = '';
    img.draggable = false;
    el.appendChild(img);
    shadow.append(style, el);
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('mouseenter', () => { state.btnHover = true; clearTimeout(hideTimer); });
    el.addEventListener('mouseleave', () => { state.btnHover = false; scheduleHide(); });
    el.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      e.preventDefault();
      e.stopPropagation();
      const form = state.btnField && formOf(state.btnField);
      if (!form) return;
      if (state.menu) closeMenu();
      else openMenu(form, state.btnField);
    });
    state.btn = { host, el };
    return state.btn;
  }

  function showButton(field) {
    if (!state.count || !state.fields.has(field) || !isVisible(field)) return;
    clearTimeout(hideTimer);
    const b = ensureButton();
    const r = field.getBoundingClientRect();
    state.btnField = field;
    b.el.style.left = Math.max(0, r.right - BTN - 4) + 'px';
    b.el.style.top = Math.max(0, r.top + (r.height - BTN) / 2) + 'px';
    b.el.style.display = 'flex';
  }

  function hideButton() {
    if (state.btn) state.btn.el.style.display = 'none';
    state.btnField = null;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (state.btnHover || state.menu) return;
      if (document.activeElement && state.fields.has(document.activeElement)) return;
      hideButton();
    }, 250);
  }

  // ---- menu ----

  async function openMenu(form, field) {
    closeMenu();
    const nonce = randomHex();
    const reply = await send({ type: 'cs:menuOpen', nonce });
    if (!reply || !reply.ok) return;
    const { host, shadow } = makeHost();
    const h = MENU_H; // fixed: the page must not infer the entry count from the size
    const r = field.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const left = Math.min(Math.max(8, r.right - MENU_W), Math.max(8, vw - MENU_W - 8));
    let top = r.bottom + 4;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 4);
    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('menu.html') + '#' + nonce;
    iframe.setAttribute('title', 'Passman');
    iframe.setAttribute('allowtransparency', 'false');
    iframe.style.cssText =
      'all:initial;position:fixed;border:0;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.35);' +
      'background:#fff;color-scheme:normal;opacity:1;visibility:visible;pointer-events:auto;display:block;' +
      'width:' + MENU_W + 'px;height:' + h + 'px;left:' + left + 'px;top:' + top + 'px';
    shadow.appendChild(iframe);
    // Layout is recorded once the iframe is in the DOM; checkOverlay compares against it.
    const box = iframe.getBoundingClientRect();
    state.menu = { host, iframe, nonce, form, w: MENU_W, h, rect: { left: box.left, top: box.top, width: box.width, height: box.height } };
    iframe.addEventListener('load', () => { try { iframe.focus(); } catch (e) { /* ignore */ } });
  }

  function closeMenu() {
    if (!state.menu) return;
    state.menu.host.remove();
    state.menu = null;
    send({ type: 'cs:menuClose' });
  }

  function hideAll() {
    closeMenu();
    hideButton();
  }

  // Abort the fill if the menu is covered, moved, resized or made see-through.
  function checkOverlay() {
    const m = state.menu;
    if (!m || !m.host.isConnected || m.host.parentNode !== document.documentElement || !m.iframe.isConnected) {
      return { ok: false, reason: 'detached' };
    }
    const rect = m.iframe.getBoundingClientRect();
    if (Math.abs(rect.width - m.w) > 1 || Math.abs(rect.height - m.h) > 1 || L.rectMoved(rect, m.rect, 1)) {
      return { ok: false, reason: 'tampered' };
    }
    const hits = L.samplePoints(rect, 6).map(([x, y]) => document.elementFromPoint(x, y) === m.host);
    // body is left out on purpose: the menu's IntersectionObserver v2 gate covers it.
    const els = [m.host, m.iframe, document.documentElement];
    const styles = els.map((el) => {
      const cs = getComputedStyle(el);
      return {
        opacity: cs.opacity, visibility: cs.visibility, display: cs.display,
        pointerEvents: cs.pointerEvents,
        transform: cs.transform, filter: cs.filter, mask: cs.mask, maskImage: cs.maskImage || cs.webkitMaskImage,
        clipPath: cs.clipPath, mixBlendMode: cs.mixBlendMode,
      };
    });
    return L.overlayVerdict(hits, styles);
  }

  // ---- fill ----

  // NEVER AUTO-FILL: doFill runs only for a 'passman:fill' message from the service worker,
  // which it sends only after a click on Autofill / an entry / Fill. Nothing here fills on its own.
  function doFill(msg) {
    if (typeof msg.password !== 'string' || typeof msg.username !== 'string') return { ok: false, reason: 'bad_message' };
    if (msg.url !== location.href) return { ok: false, reason: 'tab_changed' };
    let form = null;
    if (msg.source === 'menu') {
      if (!state.menu) return { ok: false, reason: 'no_menu' };
      const verdict = checkOverlay();
      if (!verdict.ok) {
        hideAll();
        return { ok: false, reason: 'overlay_' + verdict.reason };
      }
      form = state.menu.form;
      if (!form.password.isConnected || !isVisible(form.password)) {
        hideAll();
        return { ok: false, reason: 'no_form' };
      }
    } else if (msg.source === 'popup') {
      const forms = detect();
      const active = document.activeElement;
      form = forms.find((f) => f.password === active || f.username === active) || forms[0] || null;
      if (!form) return { ok: false, reason: 'no_form' };
    } else {
      return { ok: false, reason: 'bad_message' };
    }
    D.fillForm(form, { username: msg.username, password: msg.password }, window);
    hideAll();
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !msg || typeof msg !== 'object') return false;
    if (msg.type === 'passman:close') {
      hideAll();
      sendResponse({ ok: true });
    } else if (msg.type === 'passman:sitesUpdated') {
      state.countFor = null; // the site list changed: ask again (cache-only) on the next scan
      scheduleScan(0);
      sendResponse({ ok: true });
    } else if (msg.type === 'passman:fill') {
      sendResponse(doFill(msg));
    }
    return false;
  });

  // ---- page events ----

  function onPointerOver(e) {
    if (state.fields.has(e.target)) showButton(e.target);
  }

  document.addEventListener('focusin', (e) => {
    if (state.fields.has(e.target)) showButton(e.target);
    else if (e.target && e.target.tagName === 'INPUT') scheduleScan(0);
  }, true);
  document.addEventListener('mouseover', onPointerOver, true);
  document.addEventListener('focusout', scheduleHide, true);
  document.addEventListener('mouseout', (e) => { if (state.fields.has(e.target)) scheduleHide(); }, true);
  document.addEventListener('mousedown', (e) => {
    if (state.menu && !isOurs(e.target)) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (state.menu || state.btnField)) hideAll();
  }, true);
  window.addEventListener('scroll', hideAll, true);
  window.addEventListener('resize', hideAll);
  window.addEventListener('pagehide', hideAll);

  // ---- start ----

  function startObserver() {
    observer = new MutationObserver((records) => {
      if (records.every((r) => isOurs(r.target) || (r.addedNodes.length && Array.from(r.addedNodes).every(isOurs)))) return;
      scheduleScan();
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'hidden', 'style', 'class'],
    });
  }

  function apply(origin) {
    const o = L.normalizeOrigin(origin);
    const enable = !!o && location.origin !== o;
    if (enable === state.enabled) return;
    state.enabled = enable;
    if (enable) {
      startObserver();
      scan();
    } else {
      if (observer) observer.disconnect();
      hideAll();
    }
  }

  try {
    chrome.storage.local.get('origin').then((v) => apply(v.origin));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.origin) apply(changes.origin.newValue);
    });
  } catch (e) { /* extension context gone */ }
})();
