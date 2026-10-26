const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../shared/logic.js');
const cases = require('./fixtures/match-cases.json');

// Shared vectors written by the backend: the local matcher must agree with the server.
test('siteMatches agrees with every shared vector', () => {
  assert.ok(cases.length > 0);
  for (const c of cases) {
    const [site] = L.parseSites({ sites: c.pattern ? [{ ...c.pattern, id: 'x1', label: 'L' }] : [] });
    const got = site ? L.siteMatches(site, c.page) : false;
    assert.equal(got, c.match, `stored=${c.stored} page=${c.page}`);
  }
});

test('IP pages never match, whatever the list holds', () => {
  const mk = (host, sub) => L.parseSites({ sites: [{ id: 'a', label: 'l', schemes: ['http', 'https'], host, port: '', subdomains: sub }] })[0];
  assert.equal(L.siteMatches(mk('127.0.0.1', false), 'http://127.0.0.1/'), false);
  assert.equal(L.siteMatches(mk('3.4', true), 'https://1.2.3.4/'), false);
  assert.equal(L.siteMatches(mk('::1', false), 'http://[::1]/'), false);
  assert.equal(L.siteMatches(mk('localhost', false), 'http://localhost/'), true);
  assert.equal(L.isIpHost('1.2.3.4'), true);
  assert.equal(L.isIpHost('example.com'), false);
});

test('parseSites keeps id and label and drops malformed records', () => {
  const out = L.parseSites({ sites: [
    { id: 'e1', label: 'Mine', schemes: ['https'], host: 'A.com', port: '', subdomains: true },
    { id: 'e2', schemes: ['ftp'], host: 'b.com' },
    { schemes: ['https'], host: 'noid.com' },
    { id: '<x>', schemes: ['https'], host: 'badid.com' },
    { id: 'e3', schemes: ['https'], host: '' },
    { id: 'e4', schemes: ['https'], host: 'c.com', port: 'x' },
    null,
  ] });
  assert.equal(out.length, 1);
  assert.deepEqual({ ...out[0], schemes: [...out[0].schemes] }, { id: 'e1', label: 'Mine', schemes: ['https'], host: 'a.com', port: '', subdomains: true });
  assert.deepEqual(L.parseSites(null), []);
});

test('matchingSites, countMatches and intervals', () => {
  const sites = L.parseSites({ sites: [
    { id: 'a', label: 'IG one', schemes: ['https'], host: 'instagram.com', port: '', subdomains: true },
    { id: 'b', label: 'IG two', schemes: ['https'], host: 'instagram.com', port: '', subdomains: true },
    { id: 'c', label: 'X', schemes: ['https'], host: 'x.com', port: '', subdomains: true },
  ] });
  assert.equal(L.countMatches(sites, 'https://www.instagram.com/accounts/login/'), 2);
  assert.deepEqual(L.matchingSites(sites, 'https://www.instagram.com/').map((e) => e.id), ['a', 'b']);
  assert.equal(L.countMatches(sites, 'https://notinstagram.com/'), 0);
  assert.equal(L.countMatches(sites, 'chrome://x'), 0);
  assert.equal(L.normalizeInterval('60'), 60);
  assert.equal(L.normalizeInterval('1440'), 1440);
  assert.equal(L.normalizeInterval('5'), 720);
  assert.equal(L.normalizeInterval(undefined), 720);
});

test('parseCache, sessionActive and isStale', () => {
  const data = { user: 'bob', sessionExpires: '2030-01-01T00:00:00Z', sites: [{ id: 'a', label: 'l', schemes: ['https'], host: 'a.com', port: '', subdomains: false }] };
  const c = L.parseCache(data, 'http://pm', 1000);
  assert.equal(c.user, 'bob');
  assert.equal(c.origin, 'http://pm');
  assert.equal(c.sites.length, 1);
  assert.equal(L.parseCache({ ...data, sessionExpires: 'nope' }, 'o', 1), null);
  assert.equal(L.parseCache({ ...data, user: undefined }, 'o', 1), null);
  assert.equal(L.parseCache({ ...data, user: { username: 'al' } }, 'o', 1).user, 'al');
  assert.equal(L.sessionActive(c, Date.parse('2029-12-31T00:00:00Z')), true);
  assert.equal(L.sessionActive(c, Date.parse('2030-01-02T00:00:00Z')), false);
  assert.equal(L.sessionActive(null, 1), false);
  assert.equal(L.isStale(null, 60, 1), true);
  assert.equal(L.isStale({ fetchedAt: 0 }, 60, 59 * 60000), false);
  assert.equal(L.isStale({ fetchedAt: 0 }, 60, 61 * 60000), true);
});

test('buildExportRequest targets only <origin>/api/export, with no cookie', () => {
  const r = L.buildExportRequest('https://pm.example.com', 'bob', 'pw1', 'bk');
  assert.equal(r.url, 'https://pm.example.com/api/export');
  assert.equal(r.init.method, 'POST');
  assert.equal(r.init.credentials, 'omit');
  assert.deepEqual(JSON.parse(r.init.body), { username: 'bob', password: 'pw1', backupPassword: 'bk' });
  assert.deepEqual(JSON.parse(L.buildExportRequest('https://pm', 'bob', 'pw1', '').init.body), { username: 'bob', password: 'pw1' });
});

test('exportFilename', () => {
  const now = Date.parse('2026-10-25T10:00:00Z');
  assert.equal(L.exportFilename('attachment; filename="passman-backup-2026.zip"', 'application/zip', now), 'passman-backup-2026.zip');
  assert.equal(L.exportFilename('attachment; filename="../../etc/passwd"', '', now), 'passwd');
  assert.equal(L.exportFilename(null, 'application/zip', now), 'passman-backup-2026-10-25.zip');
  assert.equal(L.exportFilename('', 'application/json', now), 'passman-backup-2026-10-25.json');
});
