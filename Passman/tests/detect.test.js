const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../shared/detect.js');

// Minimal element fakes: enough of the DOM surface that detect.js uses.
function input(attrs = {}, extra = {}) {
  const el = { tagName: 'INPUT', attrs, parentElement: null, form: null, disabled: false, readOnly: false, hidden: false, ...extra };
  el.getAttribute = (n) => (n in attrs ? attrs[n] : null);
  return el;
}
function container(children, parent = null, isForm = false) {
  const c = { tagName: isForm ? 'FORM' : 'DIV', children, parentElement: parent };
  c.querySelectorAll = (sel) => {
    const all = children.flatMap((ch) => (ch.querySelectorAll ? ch.querySelectorAll('input') : [ch]));
    if (sel === 'input') return all;
    if (sel === 'input[type=password]') return all.filter((e) => e.getAttribute('type') === 'password');
    throw new Error('selector ' + sel);
  };
  for (const ch of children) ch.parentElement = c;
  if (isForm) for (const ch of c.querySelectorAll('input')) ch.form = c;
  return c;
}
const visible = (el) => !el.hidden;

test('plain form: preceding text input is the username', () => {
  const search = input({ type: 'text' });
  const user = input({ type: 'text' });
  const pw = input({ type: 'password' });
  const form = container([user, pw], null, true);
  const page = container([search, form]);
  const forms = D.findLoginForms(page, visible);
  assert.equal(forms.length, 1);
  assert.equal(forms[0].password, pw);
  assert.equal(forms[0].username, user);
});

test('autocomplete=username wins over proximity', () => {
  const hinted = input({ type: 'text', autocomplete: 'username' });
  const near = input({ type: 'text' });
  const pw = input({ type: 'password' });
  const f = D.findLoginForms(container([hinted, near, pw], null, true), visible);
  assert.equal(f[0].username, hinted);
});

test('no form element: container climbs to a div with other inputs', () => {
  const email = input({ type: 'email' });
  const pw = input({ type: 'password' });
  const inner = container([pw]);
  const outer = container([email, inner]);
  const f = D.findLoginForms(outer, visible);
  assert.equal(f.length, 1);
  assert.equal(f[0].username, email);
});

test('hidden password and hidden username are skipped', () => {
  const user = input({ type: 'text' }, { hidden: true });
  const user2 = input({ type: 'text' });
  const pw = input({ type: 'password' });
  assert.equal(D.findLoginForms(container([user, user2, pw], null, true), visible)[0].username, user2);
  const hiddenPw = input({ type: 'password' }, { hidden: true });
  assert.equal(D.findLoginForms(container([user2, hiddenPw], null, true), visible).length, 0);
});

test('password-only form has no username; new-password and disabled ignored', () => {
  const pw = input({ type: 'password' });
  const f = D.findLoginForms(container([pw], null, true), visible);
  assert.equal(f.length, 1);
  assert.equal(f[0].username, null);
  assert.equal(D.findLoginForms(container([input({ type: 'password', autocomplete: 'new-password' })], null, true), visible).length, 0);
  assert.equal(D.findLoginForms(container([input({ type: 'password' }, { disabled: true })], null, true), visible).length, 0);
});

test('text input after the password is not a username', () => {
  const pw = input({ type: 'password' });
  const after = input({ type: 'text' });
  assert.equal(D.findLoginForms(container([pw, after], null, true), visible)[0].username, null);
});

test('fillForm sets values through the prototype setter and fires events', () => {
  const events = [];
  class Ev { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  const proto = {};
  let stored = new WeakMap();
  Object.defineProperty(proto, 'value', { set(v) { stored.set(this, v); }, get() { return stored.get(this); } });
  const win = { HTMLInputElement: { prototype: proto }, InputEvent: Ev, Event: Ev, KeyboardEvent: Ev };
  const mk = () => {
    const el = Object.create(proto);
    el.focus = () => events.push('focus');
    el.dispatchEvent = (e) => events.push(e.type);
    return el;
  };
  const user = mk(), pw = mk();
  D.fillForm({ username: user, password: pw }, { username: 'bob', password: 's3' }, win);
  assert.equal(user.value, 'bob');
  assert.equal(pw.value, 's3');
  assert.deepEqual(events, ['focus', 'input', 'change', 'keyup', 'focus', 'input', 'change', 'keyup']);
  // empty username leaves the field alone
  events.length = 0;
  D.fillForm({ username: user, password: pw }, { username: '', password: 'x' }, win);
  assert.equal(user.value, 'bob');
});
