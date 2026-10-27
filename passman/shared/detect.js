// Login-form detection and filling. Works on anything shaped like DOM elements,
// so the node tests can use plain objects instead of jsdom.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PassmanDetect = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const TEXT_TYPES = ['text', 'email', 'tel', ''];

  function attr(el, name) {
    const v = el.getAttribute ? el.getAttribute(name) : null;
    return v == null ? '' : String(v).toLowerCase();
  }

  function inputType(el) {
    return attr(el, 'type').trim();
  }

  function isUsable(el, isVisible) {
    if (el.disabled || el.readOnly) return false;
    return isVisible(el);
  }

  function isUsernameCandidate(el, isVisible) {
    return TEXT_TYPES.includes(inputType(el)) && isUsable(el, isVisible);
  }

  function hasUsernameHint(el) {
    const ac = attr(el, 'autocomplete').split(/\s+/);
    return ac.includes('username') || ac.includes('email');
  }

  // The nearest ancestor (form, or up to 5 levels of containers) that holds the
  // password field plus at least one other input.
  function containerOf(pw) {
    if (pw.form) return pw.form;
    let node = pw.parentElement;
    for (let i = 0; i < 5 && node; i++) {
      if (node.querySelectorAll('input').length > 1) return node;
      if (!node.parentElement) return node;
      node = node.parentElement;
    }
    return pw.parentElement || null;
  }

  // Returns [{ password, username|null, container }] for each login-looking form.
  // `isVisible(el)` is supplied by the caller (layout is not available in node).
  function findLoginForms(rootNode, isVisible) {
    const forms = [];
    const seen = new Set();
    const pws = Array.from(rootNode.querySelectorAll('input[type=password]'));
    for (const pw of pws) {
      if (!isUsable(pw, isVisible)) continue;
      if (attr(pw, 'autocomplete').split(/\s+/).includes('new-password')) continue;
      const container = containerOf(pw);
      if (container && seen.has(container)) continue;
      if (container) seen.add(container);
      forms.push({ password: pw, username: findUsername(pw, container, isVisible), container });
    }
    return forms;
  }

  function findUsername(pw, container, isVisible) {
    const scope = container || pw.parentElement;
    if (!scope) return null;
    const inputs = Array.from(scope.querySelectorAll('input'));
    const pwIndex = inputs.indexOf(pw);
    const cands = inputs.filter((el) => el !== pw && isUsernameCandidate(el, isVisible));
    const hinted = cands.find(hasUsernameHint);
    if (hinted) return hinted;
    // nearest preceding candidate
    let best = null;
    for (const el of cands) {
      if (inputs.indexOf(el) < pwIndex) best = el;
    }
    return best;
  }

  // Set a value the way a user typing would, so React/Vue/Angular state notices.
  // `win` supplies the event constructors (window in the browser).
  function setValue(el, value, win) {
    const proto = win.HTMLInputElement && win.HTMLInputElement.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (el.focus) el.focus();
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    el.dispatchEvent(new win.KeyboardEvent('keyup', { bubbles: true }));
  }

  function fillForm(form, secret, win) {
    if (form.username && secret.username) setValue(form.username, secret.username, win);
    setValue(form.password, secret.password, win);
  }

  return { findLoginForms, findUsername, setValue, fillForm, containerOf };
});
