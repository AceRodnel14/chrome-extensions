// The in-page menu. Runs inside an iframe of the extension's own origin, so the
// page it is embedded in cannot read it or click inside it. The fill click happens
// here; the service worker verifies it came from this page before fetching a secret.
(() => {
  'use strict';
  const nonce = location.hash.slice(1);
  const content = document.getElementById('content');
  const who = document.getElementById('who');

  const MESSAGES = {
    not_configured: 'Passman is not set up. Open the extension options.',
    no_permission: 'Passman has no access to your server yet. Open the extension options.',
    unreachable: 'Cannot reach the passman server.',
    unauthorized: 'Signed out of passman.',
    logged_out: 'Signed out of passman.',
    setup_required: 'Finish the passman setup first.',
    denied: 'This menu is not allowed to do that.',
    no_match: 'That entry no longer matches this page.',
    tab_changed: 'The page changed. Try again.',
    overlay_covered: 'Autofill cancelled: something on the page is covering this menu.',
    overlay_tampered: 'Autofill cancelled: the page changed how this menu is displayed.',
    overlay_detached: 'Autofill cancelled: the menu was removed.',
    no_form: 'The login form is gone.',
  };

  function show(text, cls, origin) {
    content.className = 'body ' + (cls || 'muted');
    content.textContent = text;
    if (origin && /^https?:\/\//.test(origin)) {
      content.append(' ');
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = 'Open passman';
      a.addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: origin }); close(); });
      content.appendChild(a);
    }
  }

  const L = window.PassmanLogic;
  const GATE_MS = 500;
  const gate = L.makeVisibilityGate(GATE_MS);
  let readyAt = Infinity; // set when the entries are rendered

  // IntersectionObserver v2: isVisible is false while the page covers us, fades us
  // out, or applies transforms/filters to us. A fill needs 500 ms of continuous visibility.
  try {
    const io = new IntersectionObserver((records) => {
      const last = records[records.length - 1];
      gate.update(last.isVisible === true && last.isIntersecting, performance.now());
    }, { trackVisibility: true, delay: 100, threshold: [0, 1] });
    io.observe(document.documentElement);
  } catch (e) { /* unsupported: the gate never opens, fills are refused */ }

  // Activation guard: ignore clicks/keys right after render and while not visibly shown.
  function allowed() {
    const now = performance.now();
    return now - readyAt >= GATE_MS && gate.ok(now);
  }

  const send = (m) => chrome.runtime.sendMessage(m).catch(() => null);
  const close = () => send({ type: 'menu:close', nonce });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  async function fill(entry, buttons) {
    if (!allowed()) return show('Autofill cancelled: the menu was not clearly visible. Try again.', 'error');
    buttons.forEach((b) => { b.disabled = true; });
    const r = await send({ type: 'menu:fill', nonce, id: entry.id });
    if (r && r.ok) return; // the content script closes this iframe after filling
    const signedOut = r && (r.error === 'unauthorized' || r.error === 'logged_out');
    show(MESSAGES[r && r.error] || 'Could not fill this login.', 'error', signedOut ? r.origin : null);
  }

  function renderSingle(entry) {
    content.className = 'body';
    content.textContent = '';
    const q = document.createElement('div');
    q.append('Autofill ');
    const strong = document.createElement('strong');
    strong.textContent = entry.label || '(untitled)';
    q.append(strong, '?');
    const sub = document.createElement('div');
    sub.className = 'muted';
    sub.textContent = 'Passman is contacted when you confirm.';
    const ok = document.createElement('button');
    ok.className = 'primary';
    ok.textContent = 'Autofill';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    const row = document.createElement('div');
    row.className = 'row';
    row.append(ok, cancel);
    content.append(q, sub, row);
    ok.addEventListener('click', (e) => { if (e.isTrusted) fill(entry, [ok, cancel]); });
    cancel.addEventListener('click', close);
  }

  function renderMany(entries) {
    content.className = 'list';
    content.textContent = '';
    const ul = document.createElement('ul');
    for (const entry of entries) {
      const li = document.createElement('li');
      li.className = 'pick';
      li.tabIndex = 0;
      const text = document.createElement('div');
      text.className = 'text';
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = entry.label || '(untitled)';
      text.append(label);
      li.appendChild(text);
      const go = (e) => { if (e.isTrusted) fill(entry, []); };
      li.addEventListener('click', go);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
      ul.appendChild(li);
    }
    content.appendChild(ul);
  }

  (async () => {
    const r = await send({ type: 'menu:list', nonce });
    if (!r || !r.ok) return show(MESSAGES[r && r.error] || 'Passman is unavailable.', 'error', r && r.error === 'logged_out' ? r.origin : null);
    if (!r.entries.length) return show('No saved logins for this page.');
    if (r.entries.length === 1) renderSingle(r.entries[0]);
    else renderMany(r.entries);
    readyAt = performance.now();
  })();
})();
