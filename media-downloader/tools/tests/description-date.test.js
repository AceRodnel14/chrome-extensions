// Run with: node --test media-downloader/tools/tests/*.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = { chrome: { storage: { sync: {} } } };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../shared/settings.js"), "utf8"), ctx);
const { descriptionDate, postTime, DEFAULTS } = ctx.MDSettings;
const iso = (s) => (s === null ? null : new Date(s * 1000).toISOString());

const cases = [
  ["2027 Seoul Fashion Week S/S #최유진 #YUJIN #CHOI_YUJIN #Kep1er", null],
  ["[Update] 261024 Yujin - IVE ‘Looks Can Kill’ Fansign Event Credit: lamhyj91 @_yujin_an #ive", "2026-10-24T08:00:00.000Z"],
  ["[Video] 261102 Yujin talks about QUICKJIN", "2026-11-02T08:00:00.000Z"],
  ["261030 37th gyeongnam sports festival ‘RUN2U’ (j cut)", "2026-10-30T08:00:00.000Z"],
  ["Haewon and Bae - NMIXX - 261018", "2026-10-18T08:00:00.000Z"],
  ["261105 Irene", "2026-11-05T08:00:00.000Z"],
  ["261101 IVE Cut(막방) #IVE https://t.co/ReyfGEiQHN", "2026-11-01T08:00:00.000Z"],
  ["240307 🦊📸 12:41 PM https://t.co/K2JMdZTeWR", "2024-03-07T08:00:00.000Z"],
  ["[261107]", "2026-11-07T08:00:00.000Z"],
  ["#261107", "2026-11-07T08:00:00.000Z"],
  ["261107_x", "2026-11-07T08:00:00.000Z"],
  ["20261107", null],
  ["abc261107", null],
  ["https://t.co/261107", null],
  ["261107 a 261107", null],
  ["261107 / 261108", null],
  ["261332", null],
  ["250229", null],
  ["240229", "2024-02-29T08:00:00.000Z"],
  ["", null],
  [null, null],
];
for (const [text, expected] of cases) {
  test(`descriptionDate(${JSON.stringify(text)})`, () => assert.strictEqual(iso(descriptionDate(text)), expected));
}

test("an invalid date does not count towards 'exactly one'", () => {
  assert.strictEqual(iso(descriptionDate("261332 and 261107")), "2026-11-07T08:00:00.000Z");
});

test("postTime", () => {
  const real = 1700000000;
  assert.strictEqual(DEFAULTS.preferDescriptionDate, false);
  assert.strictEqual(postTime(real, "261107", { preferDescriptionDate: false }), real);
  assert.strictEqual(postTime(real, "no date", { preferDescriptionDate: true }), real);
  assert.strictEqual(iso(postTime(real, "261107", { preferDescriptionDate: true })), "2026-11-07T08:00:00.000Z");
});
