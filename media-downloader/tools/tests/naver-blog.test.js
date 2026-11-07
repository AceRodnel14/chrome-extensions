// Run with: node --test media-downloader/tools/tests/*.test.js
// Loads the pure helpers of sites/naver-blog.js the way a test can: the file hands them to `module.exports`
// (a content script has no `module`, so it runs normally in the browser).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const mod = { exports: {} };
const ctx = { module: mod, URL, URLSearchParams }; // the browser globals the helpers use
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../sites/naver-blog.js"), "utf8"), ctx);
const { blogIdFrom, rewriteImageUrl, dateFromScripts } = mod.exports;
const { parseKst } = require("../../shared/naver.js"); // shared helper, used for the one cross-check below

const PATH = "MjAyNTAxMjNfMjM2/MDAx.Srq.Fm.JPEG/image.JPEG";

test("rewriteImageUrl: mobile host becomes postfiles with type=w3840", () => {
  assert.strictEqual(rewriteImageUrl(`https://mblogthumb-phinf.pstatic.net/${PATH}`), `https://postfiles.pstatic.net/${PATH}?type=w3840`);
});

test("rewriteImageUrl: postfiles stays, existing ?type is replaced", () => {
  assert.strictEqual(rewriteImageUrl(`https://postfiles.pstatic.net/${PATH}?type=w80_blur`), `https://postfiles.pstatic.net/${PATH}?type=w3840`);
  assert.strictEqual(rewriteImageUrl(`https://blogfiles.pstatic.net/${PATH}?type=w773`), `https://postfiles.pstatic.net/${PATH}?type=w3840`);
});

test("rewriteImageUrl: percent-encoded names and a fragment survive / go", () => {
  assert.strictEqual(
    rewriteImageUrl("https://postfiles.pstatic.net/a/b.JPEG/%EC%82%AC%EC%A7%84.jpg#x"),
    "https://postfiles.pstatic.net/a/b.JPEG/%EC%82%AC%EC%A7%84.jpg?type=w3840",
  );
});

for (const bad of [
  `http://postfiles.pstatic.net/${PATH}`,
  `https://example.com/${PATH}`,
  `https://pstatic.net/${PATH}`,
  `https://postfiles.pstatic.net.evil.com/${PATH}`,
  `https://evilpstatic.net/${PATH}`,
  `https://postfiles.pstatic.net@evil.com/${PATH}`,
  `//postfiles.pstatic.net/${PATH}`,
  "javascript:alert(1)",
  "not a url",
  "",
  undefined,
]) {
  test(`rewriteImageUrl rejects ${JSON.stringify(bad)}`, () => assert.strictEqual(rewriteImageUrl(bad), null));
}

test("rewriteImageUrl drops credentials and port", () => {
  assert.strictEqual(rewriteImageUrl("https://u:p@postfiles.pstatic.net:8443/x/y.jpg"), "https://postfiles.pstatic.net/x/y.jpg?type=w3840");
});

for (const [search, pathname, expected] of [
  ["?blogId=exampleblog&logNo=123456789012&redirect=Dlog", "/PostView.naver", "exampleblog"],
  ["?blogId=a_b-c&logNo=1", "/PostView.nhn", "a_b-c"],
  ["", "/exampleblog/123456789012", "exampleblog"],
  ["", "/exampleblog/123456789012/", "exampleblog"],
  ["?fromRss=true", "/some_id/42", "some_id"],
  ["?blogId=../x&logNo=1", "/PostView.naver", null], // invalid id: refused, no fallback
  ["?blogId=a b&logNo=1", "/PostView.naver", null],
  ["?blogId=&logNo=1", "/PostView.naver", null],
  ["?logNo=1", "/PostView.naver", null], // missing blogId: no fallback to anything else
  ["", "/PostView.naver", null],
  ["", "/PostList.naver", null],
  ["", "/exampleblog", null],
  ["?blogId=other", "/exampleblog/1", "exampleblog"], // the query only counts on PostView
  ["", "/bad%20id/1", null],
  ["", "/", null],
]) {
  test(`blogIdFrom(${JSON.stringify(search)}, ${JSON.stringify(pathname)})`, () => assert.strictEqual(blogIdFrom(search, pathname), expected));
}

test("dateFromScripts finds postWriteDate and ignores other scripts", () => {
  const texts = ["var a = 1;", 'var postWriteDate = "1680152412063"; var x;', "var postWriteDate = '1';"];
  assert.strictEqual(dateFromScripts(texts), 1680152412063);
  assert.strictEqual(dateFromScripts(["var other = \"1680152412063\""]), null);
  assert.strictEqual(dateFromScripts([]), null);
});

test("the epoch and the visible KST text agree for the researched sample", () => {
  assert.strictEqual(parseKst("2023. 3. 30. 14:00"), Math.floor(1680152412063 / 60000) * 60000);
});
