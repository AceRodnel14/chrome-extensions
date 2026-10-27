(() => {
  'use strict';
  const L = window.PassmanLogic;
  const $ = (id) => document.getElementById(id);
  const input = $('url');
  const result = $('result');

  function say(text, isError) {
    result.textContent = text;
    result.className = isError ? 'error' : 'muted';
  }

  function updateWarn() {
    const o = L.normalizeOrigin(input.value);
    $('warn').hidden = !(o && L.isInsecureRemote(o));
  }

  const STATE_TEXT = {
    not_configured: 'Not configured.',
    no_permission: 'Access to that address has not been allowed.',
    unreachable: 'Cannot reach the server.',
    setup_required: 'Reachable, but passman still needs its first-time setup.',
    logged_out: 'Signed out of passman (or the list has not been loaded). Open passman, sign in, then press Refresh now.',
  };

  function showSites(info, signedIn) {
    const el = $('sites');
    if (!info || !info.fetchedAt) { el.textContent = 'Site list: not loaded yet. Sign in to passman, then press Refresh now.'; return; }
    el.textContent = 'Site list: ' + info.count + ' site' + (info.count === 1 ? '' : 's') +
      ', last updated ' + new Date(info.fetchedAt).toLocaleString() +
      (signedIn ? ', signed in until ' + new Date(info.sessionExpires).toLocaleString() : ', signed out') + '.';
  }

  async function test(type) {
    const r = await chrome.runtime.sendMessage({ type: type || 'options:status' }).catch(() => null);
    const s = r && r.status;
    showSites(s && s.sites, s && s.state === 'connected');
    if (!s) return say('No answer from the extension.', true);
    if (s.state === 'connected') return say('Signed in as ' + s.user.username + '.');
    say(STATE_TEXT[s.state] || 'Not connected.', true);
  }

  $('save').addEventListener('click', () => {
    const origin = L.normalizeOrigin(input.value);
    if (!origin) return say('Enter a valid http or https address.', true);
    // permissions.request must start inside the click handler.
    chrome.permissions.request({ origins: [origin + '/*'] }).then(async (granted) => {
      if (!granted) return say('Permission was not granted, so nothing was saved.', true);
      const { origin: old } = await chrome.storage.local.get('origin');
      await chrome.storage.local.set({ origin });
      if (old && old !== origin) chrome.permissions.remove({ origins: [old + '/*'] }).catch(() => {});
      input.value = origin;
      updateWarn();
      say('Saved ' + origin + '.');
      test('options:refresh');
    }, (e) => say('Could not request permission: ' + e.message, true));
  });
  $('test').addEventListener('click', () => test());
  $('refresh').addEventListener('click', () => test('options:refresh'));
  $('interval').addEventListener('change', () => {
    chrome.storage.local.set({ recheckMinutes: L.normalizeInterval($('interval').value) });
  });
  input.addEventListener('input', updateWarn);

  // ---- export backup ----
  // Talks to passman directly from this page. The passwords go only to <origin>/api/export
  // (see L.buildExportRequest), are never stored or logged, and the fields are cleared after use.
  function sayExport(text, isError) {
    $('exportResult').textContent = text;
    $('exportResult').className = isError ? 'error' : 'muted';
  }

  $('export').addEventListener('click', async () => {
    const btn = $('export');
    const password = $('xpass').value;
    const backup = $('bpass').value;
    if (!password) return sayExport('Enter your passman password.', true);
    if (backup !== $('bpass2').value) return sayExport('The backup passwords do not match.', true);
    const { origin: stored } = await chrome.storage.local.get('origin');
    const origin = L.normalizeOrigin(stored);
    const info = (await chrome.runtime.sendMessage({ type: 'options:status' }).catch(() => null)) || {};
    const username = info.status && info.status.user && info.status.user.username;
    if (!origin) return sayExport('Save the passman address first.', true);
    if (!username) return sayExport('Sign in to passman and press Refresh now first, so your username is known.', true);
    btn.disabled = true;
    sayExport('Exporting...');
    const req = L.buildExportRequest(origin, username, password, backup);
    try {
      const res = await fetch(req.url, req.init);
      if (!res.ok) {
        let msg = 'Export failed (' + res.status + ').';
        try { const j = await res.json(); if (j && typeof j.error === 'string') msg = j.error; } catch (e) { /* keep default */ }
        return sayExport(msg, true);
      }
      const blob = await res.blob();
      const name = L.exportFilename(res.headers.get('Content-Disposition'), res.headers.get('Content-Type'), Date.now());
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
      sayExport('Saved ' + name + '.');
    } catch (e) {
      sayExport('Cannot reach the passman server.', true);
    } finally {
      for (const id of ['xpass', 'bpass', 'bpass2']) $(id).value = '';
      btn.disabled = false;
    }
  });

  chrome.storage.local.get(['origin', 'recheckMinutes']).then(({ origin, recheckMinutes }) => {
    $('interval').value = String(L.normalizeInterval(recheckMinutes));
    if (origin) { input.value = origin; updateWarn(); test(); }
  });
})();
