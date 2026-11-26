// Run with: node --test media-downloader/tools/tests/*.test.js
// Loads the pure helpers of sites/rednote.js and sites/rednote-page.js the way a test can (see x.test.js).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(file, exportsSeed = {}) {
  const mod = { exports: exportsSeed };
  const ctx = { module: mod, URL, document: { addEventListener() {} }, window: {} };
  ctx.globalThis = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../sites", file), "utf8"), ctx);
  return mod.exports;
}
const { mapProbe, safeMediaUrl, pathOfUrlDefault, originalUrl, fallbackUrl, streamUrl, sniffExt, parseReply, stepsOf, slideSteps, slideIndexOf, slideProblem } = load("rednote.js");
const page = load("rednote-page.js", { forTest: true });

const ID = "1040g3mo327tpt01gkm005q3uupdn9erhh7okpa8";
const DEFAULT = `http://sns-web-i10.rednotecdn.com/202611240817/04ded89c56e38b5303d282550f6aa841/oss-sg/notes_pre_post/${ID}!nd_dft_wlteh_webp_3`;

test("pathOfUrlDefault: stamp, signature and !suffix are dropped", () => {
  assert.strictEqual(pathOfUrlDefault(DEFAULT), `oss-sg/notes_pre_post/${ID}`);
  assert.strictEqual(pathOfUrlDefault(DEFAULT.replace("http:", "https:")), `oss-sg/notes_pre_post/${ID}`);
});

test("pathOfUrlDefault: no oss-sg prefix is still valid, other shapes and foreign hosts are not", () => {
  assert.strictEqual(pathOfUrlDefault(`https://sns-web-i10.rednotecdn.com/1/ab/notes_post/${ID}!x`), `notes_post/${ID}`);
  assert.strictEqual(pathOfUrlDefault(`https://sns-web-i10.rednotecdn.com/1/ab/a/b/c/${ID}!x`), null); // too many segments
  assert.strictEqual(pathOfUrlDefault(`https://evil.example.com/1/ab/oss-sg/notes_pre_post/${ID}!x`), null);
  assert.strictEqual(pathOfUrlDefault(`https://sns-web-i10.rednotecdn.com/oss-sg/notes_pre_post/${ID}`), null); // no stamp/sig
  assert.strictEqual(pathOfUrlDefault(`https://sns-web-i10.rednotecdn.com/1/ab/oss-sg/notes_pre_post/../../x!y`), null);
  assert.strictEqual(pathOfUrlDefault(""), null);
});

test("originalUrl: valid fileId first, else urlDefault, else null", () => {
  assert.strictEqual(originalUrl({ fileId: `oss-sg/notes_pre_post/${ID}`, urlDefault: "" }), `https://ci.xiaohongshu.com/oss-sg/notes_pre_post/${ID}`);
  assert.strictEqual(originalUrl({ fileId: "../../etc/passwd", urlDefault: DEFAULT }), `https://ci.xiaohongshu.com/oss-sg/notes_pre_post/${ID}`);
  assert.strictEqual(originalUrl({ fileId: "https://evil.com/x", urlDefault: "" }), null);
  assert.strictEqual(originalUrl({}), null);
  assert.strictEqual(originalUrl(null), null);
});

test("allow-list: only https/http on rednotecdn.com or xhscdn.com, upgraded to https", () => {
  assert.strictEqual(safeMediaUrl("http://sns-video-hw.xhscdn.com/a/b.mp4"), "https://sns-video-hw.xhscdn.com/a/b.mp4");
  assert.strictEqual(safeMediaUrl("https://sns-web-i10.rednotecdn.com/x"), "https://sns-web-i10.rednotecdn.com/x");
  for (const bad of [
    "javascript:alert(1)",
    "http://evil.com/a.jpg",
    "https://ci.xiaohongshu.com.evil.com/a",
    "https://rednotecdn.com.evil.com/a",
    "https://evilrednotecdn.com/a",
    "https://user:pw@sns.rednotecdn.com/a",
    "https://sns.rednotecdn.com:8443/a",
    "data:text/html,x",
    "//sns.rednotecdn.com/a",
    "",
    null,
    42,
  ]) assert.strictEqual(safeMediaUrl(bad), null, String(bad));
});

test("fallbackUrl and streamUrl use the allow-list; any codec key, masterUrl then backupUrls[0]", () => {
  assert.strictEqual(fallbackUrl({ wbDft: "http://evil.com/a", urlDefault: DEFAULT }), DEFAULT.replace("http:", "https:"));
  assert.strictEqual(fallbackUrl({ wbDft: "", urlDefault: "javascript:1" }), null);
  const clip = "http://sns-video-bd.xhscdn.com/x.mp4";
  assert.strictEqual(streamUrl({ EF4: [], EF5: [{ masterUrl: clip, backupUrls: [] }] }), clip.replace("http:", "https:"));
  assert.strictEqual(streamUrl({ H264: [{ masterUrl: "", backupUrls: [clip] }] }), clip.replace("http:", "https:"));
  assert.strictEqual(streamUrl({ H264: [{ masterUrl: "http://evil.com/x.mp4", backupUrls: [clip] }] }), clip.replace("http:", "https:"));
  assert.strictEqual(streamUrl({ H264: [{ masterUrl: "http://evil.com/x.mp4" }] }), null);
  assert.strictEqual(streamUrl({}), null);
  assert.strictEqual(streamUrl(undefined), null);
});

test("sniffExt: magic bytes win over the Content-Type", () => {
  const b = (...x) => [...x, ...new Array(16 - x.length).fill(0)];
  const put = (...parts) => { const a = new Array(16).fill(0); for (const [at, s] of parts) [...s].forEach((c, i) => (a[at + i] = c.charCodeAt(0))); return a; };
  assert.strictEqual(sniffExt(b(0xff, 0xd8, 0xff, 0xe0), "application/octet-stream"), "jpg");
  assert.strictEqual(sniffExt(b(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10), "application/octet-stream"), "png");
  assert.strictEqual(sniffExt(put([0, "RIFF"], [8, "WEBP"]), "image/jpeg"), "webp");
  assert.strictEqual(sniffExt(put([0, "GIF89a"]), ""), "gif");
  for (const brand of ["heic", "heix", "mif1"]) assert.strictEqual(sniffExt(put([4, "ftyp"], [8, brand]), ""), "heic");
  assert.strictEqual(sniffExt(put([4, "ftyp"], [8, "avif"]), ""), "avif");
  assert.strictEqual(sniffExt(put([4, "ftyp"], [8, "isom"]), "image/png"), "png"); // unknown brand: Content-Type
});

test("sniffExt: unknown bytes use a specific image Content-Type, else jpg", () => {
  const unknown = new Array(16).fill(7);
  assert.strictEqual(sniffExt(unknown, "image/png"), "png");
  assert.strictEqual(sniffExt(unknown, "image/webp; charset=x"), "webp");
  assert.strictEqual(sniffExt(unknown, "application/octet-stream"), "jpg");
  assert.strictEqual(sniffExt([], ""), "jpg");
  assert.strictEqual(sniffExt(undefined, undefined), "jpg");
});

test("page ref unwrap: _rawValue first, then _value, nested refs, depth-limited", () => {
  const { unwrap } = page;
  assert.strictEqual(unwrap(5), 5);
  assert.strictEqual(unwrap({ __v_isRef: true, _rawValue: "a", _value: "b" }), "a");
  assert.strictEqual(unwrap({ __v_isRef: true, _value: "b" }), "b");
  assert.strictEqual(unwrap({ __v_isRef: true, _rawValue: { __v_isRef: true, _value: 7 } }), 7);
  assert.deepStrictEqual({ ...unwrap({ a: 1 }) }, { a: 1 }); // plain objects pass through
  const loop = { __v_isRef: true }; loop._rawValue = loop;
  assert.doesNotThrow(() => unwrap(loop)); // a self-referencing ref cannot hang
});

test("page serializeNote: only the small whitelist, refs unwrapped, no extra fields", () => {
  const ref = (v) => ({ __v_isRef: true, _rawValue: v });
  const note = ref({
    noteId: "n1", type: "normal", time: 1700000000000, secret: "x", desc: "long text",
    user: ref({ userId: "u1", nickname: "n" }),
    imageList: ref([ref({ urlDefault: DEFAULT, fileId: "f", livePhoto: true, junk: 1, infoList: [{ imageScene: "WB_DFT", url: "w" }], stream: { H1: [{ masterUrl: "m", backupUrls: ["b"], x: 1 }] } })]),
  });
  const out = page.serializeNote("n1", note);
  assert.deepStrictEqual([...Object.keys(out)].sort(), ["imageList", "noteId", "time", "type", "user", "video"]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out.user)), { userId: "u1" });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out.imageList[0])), { urlDefault: DEFAULT, fileId: "f", wbDft: "w", livePhoto: true, stream: { H1: [{ masterUrl: "m", backupUrls: ["b"] }] } });
  assert.strictEqual(page.serializeNote("n1", null), null);
});

const good = (over = {}) => JSON.stringify({ noteId: "n1", type: "normal", time: 1700000000000, user: { userId: "u1" }, imageList: [{ urlDefault: DEFAULT }], video: { stream: {} }, ...over });

test("parseReply: a good reply, pending replies", () => {
  const n = parseReply(good(), "n1", "u1");
  assert.strictEqual(n.userId, "u1");
  assert.strictEqual(n.imageList.length, 1);
  assert.strictEqual(parseReply(JSON.stringify({ error: "not yet" }), "n1", "u1"), null);
  assert.strictEqual(parseReply(good({ imageList: [] }), "n1", "u1"), null); // photos not loaded yet
  assert.strictEqual(parseReply(good({ type: "video" }), "n1", "u1"), null); // no clip yet
  assert.strictEqual(parseReply(good({ time: null }), "n1", "u1"), null); // partial post: no time yet
  assert.strictEqual(parseReply(good({ time: "1700000000000" }), "n1", "u1"), null); // a string is never a time
  assert.strictEqual(parseReply(good({ type: "" }), "n1", "u1"), null);
  const v = parseReply(good({ type: "video", video: { stream: { H1: [{ masterUrl: "https://a.xhscdn.com/v.mp4", backupUrls: [] }] } } }), "n1", "u1");
  assert.strictEqual(v.type, "video");
  assert.strictEqual(parseReply(good(), "n1", null).userId, "u1"); // no profile id known: no author check
});

test("parseReply: forged or wrong replies throw", () => {
  for (const [raw, why] of [
    ["not json", "unreadable"],
    ["[]", "array"],
    ["null", "null"],
    [good({ noteId: "other" }), "other note"],
    [good({ type: "advertisement" }), "type"],
    [good({ type: "other" }), "no type"],
    [good({ user: {} }), "no author"],
    [good({ user: { userId: "someone-else" } }), "other author"],
  ]) assert.throws(() => parseReply(raw, "n1", "u1"), (e) => typeof e?.message === "string", why);
});

test("mapProbe: probe results map to the originals in order, with the sniffed type", () => {
  const O1 = "https://ci.xiaohongshu.com/oss-sg/notes_pre_post/aaaaaaaa", O2 = "https://ci.xiaohongshu.com/oss-sg/notes_pre_post/bbbbbbbb";
  const png = [0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const steps = [{ img: { urlDefault: DEFAULT } }, { img: { urlDefault: DEFAULT } }];
  const reply = { ok: true, results: [{ status: 200, head: [0xff, 0xd8, 0xff, 0], contentType: "application/octet-stream" }, { status: 200, head: png, contentType: "" }] };
  assert.deepStrictEqual(JSON.parse(JSON.stringify(mapProbe(steps, [O1, O2], reply))), [{ url: O1, ext: "jpg" }, { url: O2, ext: "png" }]);
});

test("mapProbe: a live photo's clip is mp4 and takes no probe result", () => {
  const O1 = "https://ci.xiaohongshu.com/oss-sg/notes_pre_post/aaaaaaaa", O2 = "https://ci.xiaohongshu.com/oss-sg/notes_pre_post/bbbbbbbb";
  const steps = [{ img: {} }, { clip: "https://x.xhscdn.com/c.mp4" }, { img: {} }];
  const reply = { ok: true, results: [{ status: 200, head: [0xff, 0xd8, 0xff], contentType: "" }, { status: 200, head: [], contentType: "image/webp" }] };
  assert.deepStrictEqual(JSON.parse(JSON.stringify(mapProbe(steps, [O1, null, O2], reply))), [{ url: O1, ext: "jpg" }, { url: "https://x.xhscdn.com/c.mp4", ext: "mp4" }, { url: O2, ext: "webp" }]);
});

test("mapProbe: missing original falls back to the smaller file; no fallback throws; no probe answer assumes jpg", () => {
  const O1 = "https://ci.xiaohongshu.com/oss-sg/notes_pre_post/aaaaaaaa";
  const img = { urlDefault: DEFAULT, wbDft: DEFAULT };
  const miss = { ok: true, results: [{ status: 404, head: [], contentType: "" }] };
  assert.deepStrictEqual(JSON.parse(JSON.stringify(mapProbe([{ img }], [O1], miss))), [{ url: DEFAULT.replace("http:", "https:"), ext: "webp" }]);
  assert.throws(() => mapProbe([{ img: { urlDefault: "http://evil.com/a" } }], [O1], miss), (e) => /Photo lookup failed/.test(e.message));
  assert.throws(() => mapProbe([{ img: {} }], [null], { ok: true, results: [] }), (e) => typeof e.message === "string");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(mapProbe([{ img }], [O1], { ok: false }))), [{ url: O1, ext: "jpg" }]);
});

test("original path: all four real shapes are accepted, traversal and dots are not", () => {
  const id = "1040g3l03228475g6ni005q3uupdn9erhgs4bvrg";
  for (const path of [`oss-sg/notes/${id}`, `oss-sg/notes_pre_post/${id}`, `notes_pre_post/${id}`, id]) {
    assert.strictEqual(originalUrl({ fileId: path }), `https://ci.xiaohongshu.com/${path}`, path);
    assert.strictEqual(pathOfUrlDefault(`http://sns-web-i10.rednotecdn.com/202611240817/04ded89c/${path}!nd_dft_wlteh_webp_3`), path, `urlDefault ${path}`);
  }
  for (const bad of [`../${id}`, `oss-sg/../${id}`, `a/b/c/${id}`, `oss-sg/Notes/${id}`, `/${id}`, `oss-sg/notes/${id}.jpg`, `OSS/${id}`, `oss-sg//${id}`, "short", `${id}/`, `oss-sg/notes/${id}?x=1`]) {
    assert.strictEqual(originalUrl({ fileId: bad, urlDefault: "" }), null, bad);
  }
});

test("stepsOf and slideSteps: batch order and live-photo index shifting", () => {
  const clip0 = "https://sns-video-bd.xhscdn.com/c0.mp4";
  const clip1 = "https://sns-video-bd.xhscdn.com/c1.mp4";
  const p0 = { fileId: "f0" };
  const live0 = { fileId: "f0", livePhoto: true, stream: { H1: [{ masterUrl: clip0 }] } };
  const live1 = { fileId: "f1", livePhoto: true, stream: { H1: [{ masterUrl: clip1 }] } };
  const p2 = { fileId: "f2" };

  // Live photo before slide 1 and slide 2 shifts their batch indexes.
  const steps = stepsOf([live0, live1, p2]);
  assert.strictEqual(steps.length, 5);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(steps)),
    [
      { img: live0, slide: 0 },
      { clip: clip0, slide: 0 },
      { img: live1, slide: 1 },
      { clip: clip1, slide: 1 },
      { img: p2, slide: 2 },
    ],
  );
  // Slide 0: photo + clip at batch indexes 0 and 1.
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(slideSteps(steps, 0))),
    [{ step: { img: live0, slide: 0 }, index: 0 }, { step: { clip: clip0, slide: 0 }, index: 1 }],
  );
  // Slide 1: shifted by live0's clip -> batch indexes 2 and 3.
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(slideSteps(steps, 1))),
    [{ step: { img: live1, slide: 1 }, index: 2 }, { step: { clip: clip1, slide: 1 }, index: 3 }],
  );
  // Slide 2: shifted by both live0 and live1 -> batch index 4.
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(slideSteps(steps, 2))),
    [{ step: { img: p2, slide: 2 }, index: 4 }],
  );

  // Live photo after slide 0 does not shift slide 0.
  const after = stepsOf([p0, live1, p2]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(slideSteps(after, 0))), [{ step: { img: p0, slide: 0 }, index: 0 }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(slideSteps(after, 2))), [{ step: { img: p2, slide: 2 }, index: 3 }]);
});

test("stepsOf: livePhoto without a valid stream adds no clip step", () => {
  const noStream = { fileId: "f0", livePhoto: true, stream: {} };
  const badStream = { fileId: "f1", livePhoto: true, stream: { H1: [{ masterUrl: "http://evil.com/c.mp4" }] } };
  const notLive = { fileId: "f2", livePhoto: false, stream: { H1: [{ masterUrl: "https://sns-video-bd.xhscdn.com/c.mp4" }] } };
  const steps = stepsOf([noStream, badStream, notLive]);
  assert.strictEqual(steps.length, 3);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(steps.map((s) => s.slide))), [0, 1, 2]);
  assert.strictEqual(slideSteps(steps, 2)[0].index, 2);
});

test("slideSteps: out-of-range or invalid slide throws", () => {
  const steps = stepsOf([{ fileId: "f0" }, { fileId: "f1" }]);
  for (const bad of [-1, 2, 99, null, undefined, NaN, "0"]) {
    assert.throws(() => slideSteps(steps, bad), /not in this post/);
  }
});

test("slideIndexOf and slideProblem: validation", () => {
  assert.strictEqual(slideIndexOf("0"), 0);
  assert.strictEqual(slideIndexOf("12"), 12);
  assert.strictEqual(slideIndexOf("999"), 999);
  for (const bad of ["", null, undefined, "-1", "1.5", "0a", "1000"]) {
    assert.strictEqual(slideIndexOf(bad), null, String(bad));
  }

  assert.strictEqual(slideProblem(0, 3, 3), null);
  assert.strictEqual(slideProblem(2, 3, 3), null);
  assert.match(slideProblem(null, 3, 3), /no item number/);
  assert.match(slideProblem(0, 1, 1), /only one item/);
  assert.match(slideProblem(0, 2, 3), /shows 2 items but the post has 3/);
  assert.match(slideProblem(3, 3, 3), /not in this post/);
});
