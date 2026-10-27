(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const messageEl = $('message');
  const entriesEl = $('entries');
  let origin = null;
  let tabId;

  const send = (m) => chrome.runtime.sendMessage(m).catch(() => null);

  function message(text, cls, linkText, onLink) {
    messageEl.hidden = false;
    messageEl.className = 'body ' + (cls || 'muted');
    messageEl.textContent = text;
    if (linkText) {
      messageEl.append(' ');
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = linkText;
      a.addEventListener('click', (e) => { e.preventDefault(); onLink(); });
      messageEl.appendChild(a);
    }
  }

  const openOptions = () => { chrome.runtime.openOptionsPage(); window.close(); };
  const openTab = (url) => { chrome.tabs.create({ url }); window.close(); };

  const FILL_ERRORS = {
    no_form: 'No login form found on this page.',
    no_match: 'That entry no longer matches this page.',
    unauthorized: 'Signed out of passman. Open passman to sign in.',
    logged_out: 'Signed out of passman. Open passman to sign in.',
    unreachable: 'Cannot reach the passman server.',
    tab_changed: 'The page changed. Try again.',
    no_content: 'This page cannot be filled. Reload it and try again.',
    bad_tab: 'This page cannot be filled.',
  };

  function renderEntries(entries) {
    entriesEl.textContent = '';
    for (const entry of entries) {
      const li = document.createElement('li');
      const text = document.createElement('div');
      text.className = 'text';
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = entry.label || '(untitled)';
      text.append(label);
      const fillBtn = document.createElement('button');
      fillBtn.className = 'primary';
      fillBtn.textContent = 'Fill';
      li.append(text, fillBtn);
      entriesEl.appendChild(li);
      fillBtn.addEventListener('click', async () => {
        fillBtn.disabled = true;
        const r = await send({ type: 'popup:fill', tabId, id: entry.id });
        if (r && r.ok) return window.close();
        fillBtn.disabled = false;
        message(FILL_ERRORS[r && r.error] || 'Could not fill this login.', 'error');
      });
    }
  }

  async function load() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab && tab.id;
    const r = await send({ type: 'popup:status', tabId });
    const s = r && r.status;
    if (!s) { statusEl.textContent = 'Error'; return message('Passman did not answer.', 'error'); }
    origin = s.origin;
    $('open').hidden = !origin;
    switch (s.state) {
      case 'not_configured':
        statusEl.textContent = 'Not configured';
        return message('Set the address of your passman server first.', 'muted', 'Open options', openOptions);
      case 'no_permission':
        statusEl.textContent = 'Access needed';
        return message('Passman needs your permission to talk to ' + origin + '.', 'muted', 'Open options', openOptions);
      case 'unreachable':
        statusEl.textContent = 'Unreachable';
        return message('Cannot reach ' + origin + '. Is the server running?', 'error', 'Check options', openOptions);
      case 'setup_required':
        statusEl.textContent = 'Setup needed';
        return message('Finish the first-time setup in passman.', 'muted', 'Open passman', () => openTab(origin));
      case 'logged_out':
        statusEl.textContent = 'Signed out';
        return message('Sign in to passman.', 'muted', 'Open passman', () => openTab(origin));
      case 'connected': {
        statusEl.textContent = s.user.username +
          (s.sessionExpires ? ' · until ' + new Date(s.sessionExpires).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
        if (s.sessionExpires) statusEl.title = 'Signed in until ' + new Date(s.sessionExpires).toLocaleString();
        const entries = s.entries || [];
        if (!entries.length) return message('No saved logins for this page.');
        return renderEntries(entries);
      }
      default:
        statusEl.textContent = 'Error';
        return message('Unexpected answer from passman.', 'error');
    }
  }

  $('open').addEventListener('click', (e) => { e.preventDefault(); if (origin) openTab(origin); });
  $('options').addEventListener('click', (e) => { e.preventDefault(); openOptions(); });
  load();
})();
