// Run with: node --test media-downloader/tools/tests/*.test.js
// Loads the pure helpers of sites/naver-entertain.js the way a test can: the file hands them to `module.exports`
// (a content script has no `module`, so it runs normally in the browser). MDNaver comes from shared/naver.js.
// Press names, ids and dates below are made up.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MDNaver = require("../../shared/naver.js");
const mod = { exports: {} };
const ctx = { module: mod, URL, MDNaver };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../sites/naver-entertain.js"), "utf8"), ctx);
const { settleViewer, slideMatches, articleIdsFrom, rewriteImageUrl, rscChunks, objectsUnder, dateFromRsc, pressFromRsc, parseFooter, viewerFileNumber, viewerOid } = mod.exports;
const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());

// ---- address

for (const [pathname, expected] of [
  ["/home/article/123/0000001234", { oid: "123", aid: "0000001234" }],
  ["/photo/article/045/0009999999/", { oid: "045", aid: "0009999999" }],
  ["/article/123/0000001234", { oid: "123", aid: "0000001234" }],
  ["/home/article/123", null],
  ["/home/article/abc/0000001234", null],
  ["/entertain", null],
  ["/photo", null],
  ["/home/article/123/0000001234/extra", null],
]) {
  test(`articleIdsFrom(${JSON.stringify(pathname)})`, () => assert.strictEqual(JSON.stringify(articleIdsFrom(pathname)), JSON.stringify(expected)));
}

// ---- URL rewrite

test("rewriteImageUrl strips the query and keeps the host as given", () => {
  assert.strictEqual(rewriteImageUrl("https://imgnews.pstatic.net/image/123/2026/09/05/0000001234_001_20260905154400.jpg?type=w647"), "https://imgnews.pstatic.net/image/123/2026/09/05/0000001234_001_20260905154400.jpg");
  assert.strictEqual(rewriteImageUrl("https://mimgnews.pstatic.net/image/origin/123/2026/09/05/42.jpg?type=m1920_1080"), "https://mimgnews.pstatic.net/image/origin/123/2026/09/05/42.jpg");
  assert.strictEqual(rewriteImageUrl("https://ssl.pstatic.net/mimgnews/image/origin/123/2026/09/05/42.jpg?type=m1920_1080#x"), "https://ssl.pstatic.net/mimgnews/image/origin/123/2026/09/05/42.jpg");
  assert.strictEqual(rewriteImageUrl("https://pstatic.net/a/b.jpg?x=1"), "https://pstatic.net/a/b.jpg");
});

test("rewriteImageUrl keeps an address without a query, drops credentials and port", () => {
  assert.strictEqual(rewriteImageUrl("https://imgnews.pstatic.net/image/1/a.png"), "https://imgnews.pstatic.net/image/1/a.png");
  assert.strictEqual(rewriteImageUrl("https://u:p@imgnews.pstatic.net:8443/image/1/a.jpg?type=w1"), "https://imgnews.pstatic.net/image/1/a.jpg");
});

for (const bad of [
  "http://imgnews.pstatic.net/image/1/a.jpg",
  "https://example.com/image/1/a.jpg",
  "https://imgnews.naver.net/image/1/a.jpg",
  "https://imgnews.pstatic.net.evil.com/a.jpg",
  "https://evilpstatic.net/a.jpg",
  "https://imgnews.pstatic.net@evil.com/a.jpg",
  "//imgnews.pstatic.net/a.jpg",
  "javascript:alert(1)",
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs%3D",
  "not a url",
  "",
  undefined,
]) {
  test(`rewriteImageUrl rejects ${JSON.stringify(bad)}`, () => assert.strictEqual(rewriteImageUrl(bad), null));
}

// ---- page data (RSC chunks)

const article = (over = {}) => ({ officeId: "123", articleId: "0000001234", modifyDatetime: "2026-09-05 17:00:00", serviceDatetime: "2026-09-05 15:44:09", content: "$1f", ...over });
const payload = (a = article(), office = { officeId: "123", hname: "예시 신문", ename: "example" }) =>
  `e:["$","$L1e",null,{"result":{"articleInfo":{"article":${JSON.stringify(a)},"x":1},"officeInfo":${JSON.stringify(office)}}}]\n`;
const push = (text) => `self.__next_f.push([1,${JSON.stringify(text)}])`;

test("rscChunks decodes the string literals and skips malformed ones", () => {
  const texts = [push("abc\n"), `self.__next_f.push([1,"bad \\q escape"])`, "self.__next_f.push([0,\"x\"])", `${push("d")};${push("e")}`, "var other = 1;"];
  assert.strictEqual(JSON.stringify(rscChunks(texts)), JSON.stringify(["abc\n", "d", "e"])); // JSON: the helpers run in another vm realm
});

test("dateFromRsc: serviceDatetime as KST when oid and aid match", () => {
  const chunks = rscChunks([push(payload())]);
  assert.strictEqual(iso(dateFromRsc(chunks, "123", "0000001234")), "2026-09-05T06:44:09.000Z");
});

test("dateFromRsc: works when the payload is split over several chunks", () => {
  const text = payload();
  const chunks = rscChunks([push(text.slice(0, 40)), push(text.slice(40, 90)), push(text.slice(90))]);
  assert.strictEqual(iso(dateFromRsc(chunks, "123", "0000001234")), "2026-09-05T06:44:09.000Z");
});

test("dateFromRsc: a different articleId or officeId gives null", () => {
  const chunks = rscChunks([push(payload())]);
  assert.strictEqual(dateFromRsc(chunks, "123", "0000009999"), null);
  assert.strictEqual(dateFromRsc(chunks, "999", "0000001234"), null);
});

test("dateFromRsc: modifyDatetime is never used", () => {
  const chunks = rscChunks([push(payload(article({ serviceDatetime: undefined })))]);
  assert.strictEqual(dateFromRsc(chunks, "123", "0000001234"), null);
  const bad = rscChunks([push(payload(article({ serviceDatetime: "not a date" })))]);
  assert.strictEqual(dateFromRsc(bad, "123", "0000001234"), null);
});

test("dateFromRsc: picks the matching article among several, ignores malformed ones", () => {
  const other = payload(article({ articleId: "0000000001", serviceDatetime: "2020-01-01 00:00:00" }));
  const chunks = rscChunks([push('x:{"articleInfo":{"article":{broken'), push(other), push(payload())]);
  assert.strictEqual(iso(dateFromRsc(chunks, "123", "0000001234")), "2026-09-05T06:44:09.000Z");
});

test("dateFromRsc: braces and quotes inside strings do not confuse the scan", () => {
  const tricky = payload(article({ content: 'a "quoted" } { brace \\ text', subcontent: "}}}" }));
  assert.strictEqual(iso(dateFromRsc(rscChunks([push(tricky)]), "123", "0000001234")), "2026-09-05T06:44:09.000Z");
});

test("dateFromRsc: nothing found", () => {
  assert.strictEqual(dateFromRsc([], "123", "0000001234"), null);
  assert.strictEqual(dateFromRsc(["no data here"], "123", "0000001234"), null);
});

test("pressFromRsc: hname with whitespace removed when officeId matches", () => {
  const chunks = rscChunks([push(payload())]);
  assert.strictEqual(pressFromRsc(chunks, "123"), "예시신문");
});

test("pressFromRsc: other office, missing or blank hname gives null", () => {
  assert.strictEqual(pressFromRsc(rscChunks([push(payload())]), "999"), null);
  assert.strictEqual(pressFromRsc(rscChunks([push(payload(article(), { officeId: "123", ename: "example" }))]), "123"), null);
  assert.strictEqual(pressFromRsc(rscChunks([push(payload(article(), { officeId: "123", hname: "  ​ " }))]), "123"), null);
  assert.strictEqual(pressFromRsc([], "123"), null);
});

test("pressFromRsc: NBSP and zero-width characters in hname are removed", () => {
  const chunks = rscChunks([push(payload(article(), { officeId: "123", hname: "예시 신​문⁠사" }))]);
  assert.strictEqual(pressFromRsc(chunks, "123"), "예시신문사");
});

test("objectsUnder returns every parsed object under the key", () => {
  assert.strictEqual(JSON.stringify(objectsUnder('{"k":{"a":1}},{"k":{"b":"}"}},{"k":{oops', "k")), JSON.stringify([{ a: 1 }, { b: "}" }]));
});

// ---- viewer footer and file number

test("parseFooter: press name without spaces and the KST minute", () => {
  const text = "[포토] 예시 제목\n더보기\n\n예시 방송국 | 2026.09.05. 오후 3:44\n\n1 / 18,007\n\n좋아요";
  const f = parseFooter(text);
  assert.strictEqual(f.press, "예시방송국");
  assert.strictEqual(iso(f.ms), "2026-09-05T06:44:00.000Z");
});

test("parseFooter: 오전 12 is midnight, NBSP and zero-width characters in the name", () => {
  const f = parseFooter("제목\n예시 방​송 | 2026.09.05. 오전 12:05\n");
  assert.strictEqual(f.press, "예시방송");
  assert.strictEqual(iso(f.ms), "2026-09-04T15:05:00.000Z");
});

for (const bad of ["", null, undefined, "제목만 있음", "예시 | 날짜 없음", "예시 | 2026.02.30. 오후 3:44", " | 2026.09.05. 오후 3:44", "2026.09.05. 오후 3:44"]) {
  test(`parseFooter rejects ${JSON.stringify(bad)}`, () => assert.strictEqual(parseFooter(bad), null));
}

for (const [address, number, oid] of [
  ["https://mimgnews.pstatic.net/image/origin/123/2026/09/05/42.jpg?type=m1920_1080", "42", "123"],
  ["https://ssl.pstatic.net/mimgnews/image/origin/045/2026/09/05/123456.jpg", "123456", "045"],
  ["https://imgnews.pstatic.net/image/123/2026/09/05/0000001234_001_20260905154400.jpg", null, null], // an article picture, not a viewer one
  ["https://mimgnews.pstatic.net/image/origin/123/2026/09/05/name.jpg", null, "123"],
  ["https://mimgnews.pstatic.net/image/origin/123/2026/09/05/", null, "123"],
  ["", null, null],
]) {
  test(`viewerFileNumber/viewerOid(${JSON.stringify(address)})`, () => {
    assert.strictEqual(viewerFileNumber(address), number);
    assert.strictEqual(viewerOid(address), oid);
  });
}

for (const [href, image, expected] of [
  ["https://m.entertain.naver.com/photo/article/123/0000111111", "https://mimgnews.pstatic.net/image/origin/123/2026/09/05/111111.jpg", true],
  ["/photo/article/123/0000111122", "https://mimgnews.pstatic.net/image/origin/123/2026/09/05/111122.jpg?type=m1920_1080", true],
  ["https://m.entertain.naver.com/photo/article/123/0000111122", "https://mimgnews.pstatic.net/image/origin/123/2026/09/05/111111.jpg", false], // footer already on the next slide
  [undefined, "https://mimgnews.pstatic.net/image/origin/123/2026/09/05/111111.jpg", null],
  ["https://m.entertain.naver.com/photo", "https://mimgnews.pstatic.net/image/origin/123/2026/09/05/111111.jpg", null],
  ["/photo/article/123/0000111111", "https://mimgnews.pstatic.net/image/origin/123/2026/09/05/name.jpg", null],
]) {
  test(`slideMatches(${JSON.stringify(href)}, ${JSON.stringify(image.slice(-30))})`, () => assert.strictEqual(slideMatches(href, image), expected));
}

const reading = (url, href, match) => ({ url, href, match });
const verdict = (readings) => JSON.stringify(settleViewer(readings));

test("settleViewer: a match on the first read is used", () => {
  assert.strictEqual(verdict([reading("a", "h1", true)]), '{"status":"ok","index":0}');
});

test("settleViewer: cannot tell (null) is used", () => {
  assert.strictEqual(verdict([reading("a", "h1", null)]), '{"status":"ok","index":0}');
});

test("settleViewer: the picture changes partway, then matches", () => {
  assert.strictEqual(verdict([reading("old", "new", false), reading("old", "new", false), reading("new", "new", true)]), '{"status":"ok","index":2}');
});

test("settleViewer: the picture changes and still disagrees, so it refuses", () => {
  assert.strictEqual(verdict([reading("old", "new", false), reading("new2", "new", false)]), '{"status":"loading","index":-1}');
  assert.strictEqual(verdict([reading("old", "new", false), reading(null, null, false)]), '{"status":"loading","index":-1}');
});

test("settleViewer: the footer changes late and nothing matches, so it refuses", () => {
  assert.strictEqual(verdict([reading("old", "h1", false), reading("old", "h2", false)]), '{"status":"loading","index":-1}');
});

test("settleViewer: a stable mismatch for the whole window is accepted (the last reading)", () => {
  assert.strictEqual(verdict([reading("a", "h1", false), reading("a", "h1", false), reading("a", "h1", false)]), '{"status":"stable","index":2}');
});
