// Run with: node --test media-downloader/tools/tests/*.test.js
// Loads the pure helpers of sites/x.js the way a test can: the file hands them to `module.exports`
// (a content script has no `module`, so it runs normally in the browser).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const mod = { exports: {} };
const ctx = { module: mod, URL }; // the browser globals the helpers use
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../sites/x.js"), "utf8"), ctx);
const { route, barKind, idFromReplyHref, idFromAnalyticsHref } = mod.exports;

// A fake action bar: `has` answers "does it contain this selector?" from a list of present selectors.
const bar = (...present) => barKind((selector) => present.includes(selector));

test("route: /status/<id> link", () => {
  assert.deepStrictEqual({ ...route("/NASA/status/2123820070803542306") }, { type: "tweet", username: "NASA", id: "2123820070803542306", index: null });
  assert.strictEqual(route("https://x.com/NASA/status/123?s=20").id, "123");
});

test("route: /photo/<n> and /video/<n> give a zero-based index", () => {
  assert.strictEqual(route("/NASA/status/5/photo/1").index, 0);
  assert.strictEqual(route("/NASA/status/5/photo/3").index, 2);
  assert.strictEqual(route("/NASA/status/5/video/2").index, 1);
});

test("route: profiles, reserved paths and non-numeric ids", () => {
  assert.deepStrictEqual({ ...route("/NASA") }, { type: "profile", username: "NASA" });
  assert.strictEqual(route("/home").type, "other");
  assert.strictEqual(route("/NASA/status/abc").type, "profile");
});

test("idFromReplyHref: the post's own id, not any other id on the page", () => {
  assert.strictEqual(idFromReplyHref("/compose/post?in_reply_to=2123820070803542306"), "2123820070803542306");
  assert.strictEqual(idFromReplyHref("/compose/post?x=1&in_reply_to=77&y=2"), "77");
  assert.strictEqual(idFromReplyHref("/NASA/status/2123820070803542306"), null);
  assert.strictEqual(idFromReplyHref(null), null);
});

test("idFromAnalyticsHref: takes the analytics link, never a quoted post's plain link", () => {
  assert.strictEqual(idFromAnalyticsHref("/someuser/status/1234567890123456789/analytics"), "1234567890123456789");
  assert.strictEqual(idFromAnalyticsHref("/quoted_user/status/1111111111111111111"), null); // a quoted post
  assert.strictEqual(idFromAnalyticsHref("/NASA/status/5/photo/1"), null);
  assert.strictEqual(idFromAnalyticsHref(undefined), null);
});

test("barKind: old UI (data-testid), new UI (data-engagement-action), neither", () => {
  assert.strictEqual(bar('[data-testid="reply"]', '[data-testid="like"], [data-testid="unlike"]'), "old");
  assert.strictEqual(bar('[data-engagement-action="reply"]', '[data-engagement-action="like"], [data-engagement-action="unlike"]'), "new");
  assert.strictEqual(bar('[data-engagement-action="reply"]'), null); // no like: not the action bar
  assert.strictEqual(bar('[data-testid="reply"]', '[data-engagement-action="like"], [data-engagement-action="unlike"]'), null); // never mixed
  assert.strictEqual(bar(), null);
});
