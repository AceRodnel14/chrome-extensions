// Source-level backstop for the privacy and "never auto-fill" guarantees (README
// "Guarantees"). tests/background.behavior.test.js checks the same things by running the code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const bg = read('background.js');
const content = read('content.js');
const options = read('options.js');
const manifest = JSON.parse(read('manifest.json'));

function caseBody(src, label) {
  const start = src.indexOf(`case '${label}':`);
  assert.ok(start >= 0, label);
  const next = src.indexOf("\n    case '", start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}
function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const next = src.indexOf('\n}\n', start);
  return src.slice(start, next);
}
const count = (src, re) => (src.match(re) || []).length;

test('passman:fill is sent from exactly one place, inside fillEntry', () => {
  assert.equal(count(bg, /type:\s*'passman:fill'/g), 1);
  assert.ok(/type:\s*'passman:fill'/.test(fnBody(bg, 'fillEntry')));
});

test('fillEntry is called only from the menu:fill and popup:fill cases', () => {
  assert.equal(count(bg, /\bfillEntry\(/g), 3); // definition + two calls
  assert.ok(/fillEntry\(tabId, msg\.id, 'menu'/.test(caseBody(bg, 'menu:fill')));
  assert.ok(/fillEntry\(msg\.tabId, msg\.id, 'popup'/.test(caseBody(bg, 'popup:fill')));
});

test('only the menu and popup pages may trigger a fill', () => {
  const L = require('../shared/logic.js');
  for (const kind of ['content', 'options']) {
    assert.equal(L.validateMessage({ type: 'menu:fill', nonce: 'a'.repeat(32), id: 'x' }, kind), null);
    assert.equal(L.validateMessage({ type: 'popup:fill', tabId: 1, id: 'x' }, kind), null);
  }
});

test('content script fills only inside doFill, reached only from the passman:fill message', () => {
  assert.equal(count(content, /D\.fillForm\(/g), 1);
  assert.equal(count(content, /\bdoFill\(/g), 2); // definition + the onMessage call
});

test('/api/fill is requested only inside fillEntry; the old endpoints are gone', () => {
  assert.equal(count(bg, /\/api\/fill\//g), 1);
  assert.ok(/\/api\/fill\//.test(fnBody(bg, 'fillEntry')));
  assert.equal(count(bg, /\/api\/(match|passwords|state)\b/g), 0);
});

test('page-load and menu paths make no request', () => {
  for (const label of ['cs:count', 'menu:list']) {
    assert.ok(!/fetch\(|\bapi\(|refreshSites|fillEntry/.test(caseBody(bg, label)), label);
  }
});

test('no timers: no alarms permission or API use', () => {
  assert.ok(!manifest.permissions.includes('alarms'));
  assert.ok(!/chrome\.alarms|setInterval/.test(bg + content + options));
});

test('the site list lives in the worker IndexedDB, never in chrome.storage; wiped on 401', () => {
  assert.ok(/store\.set\(CACHE_KEY, rec\)/.test(bg));
  assert.ok(!/chrome\.storage\.(local|session)\.set\([^)]*(CACHE_KEY|\bsites\b|sitesCache)/.test(bg));
  assert.ok(/status === 401\) \{\s*await wipeCache\(\)/.test(bg));
  // content scripts: no list data can reach them through storage events or reads
  assert.ok(!/sitesCache|CACHE_KEY/.test(content));
  assert.ok(/changes\.origin/.test(content));
  assert.ok(!/storage\.local\.get\(\s*(null|undefined)?\s*\)/.test(content));
  assert.ok(manifest.content_scripts.every((c) => !c.js.includes('shared/store.js')));
});

test('sign-out is also detected from the session cookie (local, no request)', () => {
  assert.ok(manifest.permissions.includes('cookies'));
  assert.ok(/chrome\.cookies\.onChanged\.addListener/.test(bg));
  assert.ok(/cause === 'overwrite'/.test(bg));
  assert.ok(!/fetch\(|\bapi\(/.test(fnBody(bg, 'checkSession')));
});

test('export: the background never touches /api/export, options uses the pure request builder', () => {
  assert.equal(count(bg, /api\/export/g), 0);
  assert.ok(/L\.buildExportRequest\(/.test(options));
  assert.equal(count(options, /\bfetch\(/g), 1);
  assert.ok(/fetch\(req\.url, req\.init\)/.test(options));
  assert.ok(!/console\./.test(options));
});
