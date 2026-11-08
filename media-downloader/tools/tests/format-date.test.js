// Run with: node --test media-downloader/tools/tests/*.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = { chrome: { storage: { sync: {} } } };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../shared/settings.js"), "utf8"), ctx);
const { formatDate, buildFilename, descriptionDate } = ctx.MDSettings;

function inTZ(tz, fn) {
  const old = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally {
    if (old === undefined) delete process.env.TZ; else process.env.TZ = old;
  }
}

const cases = [
  ["Asia/Singapore", "2026-11-08T05:47:11Z", "2026-11-08T134711+0800"],
  ["UTC", "2026-11-08T05:47:11Z", "2026-11-08T054711+0000"],
  ["America/New_York", "2026-07-01T12:00:00Z", "2026-07-01T080000-0400"],
  ["America/New_York", "2026-01-15T12:00:00Z", "2026-01-15T070000-0500"],
  ["America/St_Johns", "2026-01-15T12:00:00Z", "2026-01-15T083000-0330"],
  ["Asia/Kathmandu", "2026-11-08T05:47:11Z", "2026-11-08T113211+0545"],
  ["Asia/Singapore", "2026-11-07T20:00:00Z", "2026-11-08T040000+0800"],
  ["Asia/Singapore", "2026-11-08T05:47:11.999Z", "2026-11-08T134711+0800"],
];
for (const [tz, iso, want] of cases) {
  test(`${tz} ${iso}`, () => assert.strictEqual(inTZ(tz, () => formatDate(iso)), want));
}

test("ms, ISO string and Date give the same output", () => {
  inTZ("Asia/Singapore", () => {
    const iso = "2026-11-08T05:47:11Z";
    const want = "2026-11-08T134711+0800";
    assert.strictEqual(formatDate(Date.parse(iso)), want);
    assert.strictEqual(formatDate(iso), want);
    assert.strictEqual(formatDate(new Date(iso)), want);
  });
});

test("falsy and invalid input give empty string", () => {
  for (const v of [null, undefined, 0, ""]) assert.strictEqual(formatDate(v), "");
  assert.strictEqual(formatDate("garbage"), "");
});

test("description date renders at 16:00 in GMT+8", () => {
  const got = inTZ("Asia/Singapore", () => formatDate(descriptionDate("261107") * 1000));
  assert.strictEqual(got, "2026-11-07T160000+0800");
});

test("buildFilename keeps + in the offset", () => {
  const createdDate = inTZ("Asia/Singapore", () => formatDate("2026-11-08T05:47:11Z"));
  assert.strictEqual(
    buildFilename("username_--website--_createdDate", { username: "jessicaleeseul", website: "instagram", createdDate }, 2, "jpg"),
    "jessicaleeseul_--instagram--_2026-11-08T134711+0800_2.jpg");
});

test("buildFilename keeps - in the offset", () => {
  const createdDate = inTZ("America/St_Johns", () => formatDate("2026-01-15T12:00:00Z"));
  assert.match(buildFilename("createdDate", { createdDate }, 1, "jpg"), /-0330/);
});
