const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../shared/logic.js');

const ID = 'abcdefabcdefabcdefabcdefabcdefab';

test('normalizeOrigin', () => {
  assert.equal(L.normalizeOrigin('https://pm.example.com/vault?x=1#y'), 'https://pm.example.com');
  assert.equal(L.normalizeOrigin('  pm.example.com  '), 'https://pm.example.com');
  assert.equal(L.normalizeOrigin('127.0.0.1:18080'), 'http://127.0.0.1:18080');
  assert.equal(L.normalizeOrigin('localhost:3000/x'), 'http://localhost:3000');
  assert.equal(L.normalizeOrigin('http://127.0.0.1:18080/'), 'http://127.0.0.1:18080');
  assert.equal(L.normalizeOrigin('https://pm.example.com:443'), 'https://pm.example.com');
  for (const bad of ['', 'ftp://x.com', 'javascript:alert(1)', 'https://u:p@x.com', 'a b', null, 5, 'https://']) {
    assert.equal(L.normalizeOrigin(bad), null, String(bad));
  }
});

test('isInsecureRemote', () => {
  assert.equal(L.isInsecureRemote('http://pm.example.com'), true);
  assert.equal(L.isInsecureRemote('http://127.0.0.1:18080'), false);
  assert.equal(L.isInsecureRemote('https://pm.example.com'), false);
});

test('sameOrigin / isWebUrl', () => {
  assert.equal(L.sameOrigin('http://127.0.0.1:18080/a', 'http://127.0.0.1:18080'), true);
  assert.equal(L.sameOrigin('http://127.0.0.1:18081/a', 'http://127.0.0.1:18080'), false);
  assert.equal(L.isWebUrl('chrome://extensions'), false);
  assert.equal(L.isWebUrl('https://a.com'), true);
});

const EXT = 'extid';
test('classifySender', () => {
  const tab = { id: 3 };
  assert.equal(L.classifySender({ id: EXT, url: 'https://a.com/x', frameId: 0, tab }, EXT), 'content');
  assert.equal(L.classifySender({ id: EXT, url: 'https://a.com/x', frameId: 2, tab }, EXT), null);
  assert.equal(L.classifySender({ id: 'other', url: 'https://a.com/x', frameId: 0, tab }, EXT), null);
  assert.equal(L.classifySender({ id: EXT, url: 'chrome-extension://extid/menu.html#abc', frameId: 4, tab }, EXT), 'menu');
  // menu page as a top-level tab is not a menu
  assert.equal(L.classifySender({ id: EXT, url: 'chrome-extension://extid/menu.html', frameId: 0, tab }, EXT), null);
  assert.equal(L.classifySender({ id: EXT, url: 'chrome-extension://extid/popup.html', frameId: 0 }, EXT), 'popup');
  assert.equal(L.classifySender({ id: EXT, url: 'chrome-extension://extid/options.html', frameId: 0, tab }, EXT), 'options');
  assert.equal(L.classifySender({ id: EXT, url: 'chrome-extension://extid/menu.html.evil', frameId: 1, tab }, EXT), null);
  assert.equal(L.classifySender({ id: EXT, url: 'chrome-extension://other/menu.html', frameId: 1, tab }, EXT), null);
  assert.equal(L.classifySender(null, EXT), null);
});

test('validateMessage', () => {
  assert.deepEqual(L.validateMessage({ type: 'cs:count', extra: 1 }, 'content'), { type: 'cs:count' });
  assert.equal(L.validateMessage({ type: 'menu:fill', nonce: ID, id: ID }, 'content'), null, 'wrong sender kind');
  assert.deepEqual(L.validateMessage({ type: 'menu:fill', nonce: ID, id: 'a-b-1', x: 1 }, 'menu'), { type: 'menu:fill', nonce: ID, id: 'a-b-1' });
  assert.equal(L.validateMessage({ type: 'menu:fill', nonce: 'short', id: 'a' }, 'menu'), null);
  assert.equal(L.validateMessage({ type: 'menu:fill', nonce: ID, id: '../x' }, 'menu'), null);
  assert.equal(L.validateMessage({ type: 'menu:list' }, 'menu'), null);
  assert.equal(L.validateMessage({ type: 'cs:menuOpen', nonce: ID }, 'content').nonce, ID);
  assert.equal(L.validateMessage({ type: 'popup:fill', tabId: '3', id: 'a' }, 'popup'), null);
  assert.deepEqual(L.validateMessage({ type: 'popup:fill', tabId: 3, id: 'a' }, 'popup'), { type: 'popup:fill', tabId: 3, id: 'a' });
  assert.equal(L.validateMessage({ type: 'popup:status' }, 'popup').tabId, undefined);
  assert.equal(L.validateMessage({ type: 'nope' }, 'popup'), null);
  assert.equal(L.validateMessage(null, 'popup'), null);
  assert.equal(L.validateMessage({ type: 'cs:count' }, null), null);
});

test('sanitizeSecret', () => {
  assert.equal(L.sanitizeSecret({ username: 'u' }), null);
  assert.deepEqual(L.sanitizeSecret({ username: 'u', password: 'p', extra: 1 }), { username: 'u', password: 'p' });
});

test('overlay helpers', () => {
  const pts = L.samplePoints({ left: 0, top: 0, right: 100, bottom: 50 }, 4);
  assert.equal(pts.length, 9);
  assert.deepEqual(pts[4], [50, 25]);
  const ok = { opacity: '1', visibility: 'visible', display: 'block', pointerEvents: 'auto' };
  assert.equal(L.styleTampered(ok), false);
  assert.equal(L.styleTampered({ ...ok, opacity: '0.01' }), true);
  assert.equal(L.styleTampered({ ...ok, visibility: 'hidden' }), true);
  assert.equal(L.styleTampered({ ...ok, pointerEvents: 'none' }), true);
  assert.equal(L.styleTampered({ ...ok, opacity: 'NaN' }), true);
  assert.deepEqual(L.overlayVerdict([true, true], [ok, ok]), { ok: true });
  assert.equal(L.overlayVerdict([true, false], [ok]).reason, 'covered');
  assert.equal(L.overlayVerdict([], [ok]).ok, false);
  assert.equal(L.overlayVerdict([true], [ok, { ...ok, opacity: '0' }]).reason, 'tampered');
});

test('styleTampered: transforms, filters, masks, clipping, blend modes', () => {
  const ok = { opacity: '1', visibility: 'visible', display: 'block', pointerEvents: 'auto', transform: 'none', filter: 'none', mask: 'none', maskImage: 'none', clipPath: 'none', mixBlendMode: 'normal' };
  assert.equal(L.styleTampered(ok), false);
  assert.equal(L.styleTampered({ opacity: '1', visibility: 'visible', display: 'block' }), false, 'absent props are not judged');
  assert.equal(L.styleTampered({ ...ok, transform: 'matrix(1, 0, 0, 1, 5, 0)' }), true);
  assert.equal(L.styleTampered({ ...ok, filter: 'opacity(0.1)' }), true);
  assert.equal(L.styleTampered({ ...ok, mask: 'url(#m) 0% 0% / auto' }), true);
  assert.equal(L.styleTampered({ ...ok, maskImage: 'linear-gradient(red, blue)' }), true);
  assert.equal(L.styleTampered({ ...ok, clipPath: 'inset(0px 50px)' }), true);
  assert.equal(L.styleTampered({ ...ok, mixBlendMode: 'multiply' }), true);
  assert.equal(L.styleTampered({ ...ok, mask: 'none 0% 0% / auto repeat border-box border-box add match-source' }), false);
});

test('rectMoved', () => {
  const r = { left: 10, top: 20, width: 320, height: 232 };
  assert.equal(L.rectMoved({ ...r }, r), false);
  assert.equal(L.rectMoved({ ...r, left: 10.5 }, r), false);
  assert.equal(L.rectMoved({ ...r, top: 25 }, r), true);
  assert.equal(L.rectMoved({ ...r, width: 100 }, r), true);
  assert.equal(L.rectMoved({ ...r, height: NaN }, r), true);
});

test('pageOrigin drops path, query, hash and credentials', () => {
  assert.equal(L.pageOrigin('https://user:pw@www.instagram.com/accounts/login/?next=/x#h'), 'https://www.instagram.com');
  assert.equal(L.pageOrigin('http://127.0.0.1:18090/test-login.html'), 'http://127.0.0.1:18090');
  assert.equal(L.pageOrigin('chrome://extensions'), null);
  assert.equal(L.pageOrigin(undefined), null);
});

test('visibility gate needs continuous visibility', () => {
  const g = L.makeVisibilityGate(500);
  assert.equal(g.ok(0), false);
  g.update(true, 100);
  assert.equal(g.ok(550), false);
  assert.equal(g.ok(600), true);
  g.update(false, 700);
  assert.equal(g.ok(2000), false);
  g.update(true, 2000);
  g.update(true, 2300);
  assert.equal(g.ok(2400), false);
  assert.equal(g.ok(2500), true);
  g.update(undefined, 2600);
  assert.equal(g.ok(3500), false);
});
