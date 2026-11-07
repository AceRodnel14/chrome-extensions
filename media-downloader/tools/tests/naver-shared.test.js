// Run with: node --test media-downloader/tools/tests/*.test.js
// Tests of shared/naver.js, used by the Naver Blog and Naver Entertain content scripts.
const test = require("node:test");
const assert = require("node:assert");
const { extensionOf, parseKst, stripSpaces } = require("../../shared/naver.js");
const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());

for (const [address, expected] of [
  ["https://postfiles.pstatic.net/a/b.JPEG/image.JPEG?type=w3840", "jpg"],
  ["https://postfiles.pstatic.net/a/b.JPEG/IMG_1.JPG", "jpg"],
  ["https://postfiles.pstatic.net/a/b.JPEG/x.jpeg", "jpg"],
  ["https://postfiles.pstatic.net/a/b.PNG/shot.png", "png"],
  ["https://postfiles.pstatic.net/a/b.PNG/shot.PNG?type=w3840", "png"],
  ["https://postfiles.pstatic.net/a/b.JPEG/anim.gif", null],
  ["https://postfiles.pstatic.net/a/b.JPEG/pic.webp", null],
  ["https://postfiles.pstatic.net/a/b.JPEG/noextension", null],
  ["https://postfiles.pstatic.net/a/b.JPEG/", null], // the folder's .JPEG is not the file's extension
  ["https://postfiles.pstatic.net/a/b.JPEG/pic.jpg.exe", null],
  ["/a/b.JPEG/image.jpg?type=1", "jpg"],
  ["", null],
]) {
  test(`extensionOf(${JSON.stringify(address)})`, () => assert.strictEqual(extensionOf(address), expected));
}

test("parseKst: afternoon time", () => {
  assert.strictEqual(iso(parseKst("2023. 3. 30. 14:00")), "2023-03-30T05:00:00.000Z");
});

test("parseKst: a KST morning time is the previous UTC day", () => {
  assert.strictEqual(iso(parseKst("2023. 3. 30. 08:30")), "2023-03-29T23:30:00.000Z");
  assert.strictEqual(iso(parseKst("2025. 1. 1. 00:05")), "2024-12-31T15:05:00.000Z");
});

test("parseKst: two-digit parts, surrounding text, no trailing dot", () => {
  assert.strictEqual(iso(parseKst("  2025. 11. 17. 16:00 ")), "2025-11-17T07:00:00.000Z");
  assert.strictEqual(iso(parseKst("2025. 11. 17 16:00")), "2025-11-17T07:00:00.000Z");
});

for (const bad of ["", null, undefined, "3 hours ago", "방금 전", "2023. 2. 31. 10:00", "2023. 13. 1. 10:00", "2023. 3. 30. 25:00", "2023. 3. 30. 10:75"]) {
  test(`parseKst rejects ${JSON.stringify(bad)}`, () => assert.strictEqual(parseKst(bad), null));
}

test("parseKst: entertain format with 오전/오후", () => {
  assert.strictEqual(iso(parseKst("2026.09.05. 오후 3:44")), "2026-09-05T06:44:00.000Z");
  assert.strictEqual(iso(parseKst("2026.09.05. 오전 9:05")), "2026-09-05T00:05:00.000Z");
  assert.strictEqual(iso(parseKst("입력2026.09.05. 오후 3:44")), "2026-09-05T06:44:00.000Z"); // text with a prefix
});

test("parseKst: 12 o'clock edge cases (오전 12 is 00, 오후 12 is 12)", () => {
  assert.strictEqual(iso(parseKst("2026.09.05. 오전 12:00")), "2026-09-04T15:00:00.000Z"); // 00:00 KST
  assert.strictEqual(iso(parseKst("2026.09.05. 오전 12:30")), "2026-09-04T15:30:00.000Z");
  assert.strictEqual(iso(parseKst("2026.09.05. 오후 12:00")), "2026-09-05T03:00:00.000Z"); // 12:00 KST
  assert.strictEqual(iso(parseKst("2026.09.05. 오후 11:59")), "2026-09-05T14:59:00.000Z");
  assert.strictEqual(iso(parseKst("2026.09.05. 오전 11:59")), "2026-09-05T02:59:00.000Z");
  assert.strictEqual(iso(parseKst("2026.09.05. 오후 1:00")), "2026-09-05T04:00:00.000Z");
  assert.strictEqual(iso(parseKst("2026.09.05. 오전 1:00")), "2026-09-04T16:00:00.000Z");
});

test("parseKst: page-data format with seconds", () => {
  assert.strictEqual(iso(parseKst("2026-09-05 15:44:09")), "2026-09-05T06:44:09.000Z");
  assert.strictEqual(iso(parseKst("2026-01-01 00:00:00")), "2025-12-31T15:00:00.000Z");
});

for (const bad of [
  "2026.09.05. 오후 0:30", // no hour 0 with a meridiem
  "2026.09.05. 오후 13:00",
  "2026.09.05. 오전 0:00",
  "2026.02.30. 오후 3:44",
  "2026-02-30 10:00:00",
  "2026-09-05 24:00:00",
  "2026-09-05 10:60:00",
  "2026-09-05 10:00:61",
  "2026-13-05 10:00:00",
  "2026-09-05",
]) {
  test(`parseKst rejects ${JSON.stringify(bad)}`, () => assert.strictEqual(parseKst(bad), null));
}

for (const [text, expected] of [
  ["가나 뉴스", "가나뉴스"],
  ["  Example   Press  ", "ExamplePress"],
  ["가나 다　라", "가나다라"], // NBSP and ideographic space
  ["가​나‍다⁠라﻿마", "가나다라마"], // zero-width characters (sanitize would turn them into spaces)
  ["\t가\n나\r", "가나"],
  ["", ""],
  [null, ""],
  [undefined, ""],
]) {
  test(`stripSpaces(${JSON.stringify(text)})`, () => assert.strictEqual(stripSpaces(text), expected));
}
