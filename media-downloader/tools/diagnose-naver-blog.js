// mediadownloader: Naver Blog health check.
//
// Run it when Naver Blog downloads stop working, to see which piece Naver changed:
//   1. Open a blog post on blog.naver.com (desktop) or m.blog.naver.com (mobile) in the browser where
//      mediadownloader is installed.
//   2. Press F12 → Console, paste this whole file, press Enter. On the desktop site it can be pasted in the top frame:
//      the post lives in iframe#mainFrame (same origin), and the script looks inside it.
//   3. Read the table. FAIL rows say what broke; context.md → "When Naver changes something" says what to do.
//
// Legend: PASS = works. FAIL = broken, needs action. SKIP = not checked, the page has nothing to test it with.
// INFO = information, or normal on some pages.
//
// It only reads: nothing is downloaded, clicked or changed, and no settings are touched. The only request is one
// optional ranged GET (Range: bytes=0-0) of the first picture, which a page normally cannot read (CORS): that is
// reported as SKIP, not FAIL. The function returns the rows, so a script can read them (CDP Runtime.evaluate with
// awaitPromise). The helpers below are copied from sites/naver-blog.js and shared/naver.js; keep them in sync.
(async () => {
  const rows = [];
  const add = (check, result, detail = "") => rows.push({ check, result, detail: String(detail).slice(0, 200) });
  // One failing check never aborts the table.
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (err) {
      add(name, "FAIL", err.message);
    }
  };

  // keep in sync with sites/naver-blog.js (blogIdFrom, rewriteImageUrl, dateFromScripts) and shared/naver.js (extensionOf, parseKst, below)
  const BLOG_ID = /^[A-Za-z0-9_-]+$/;
  const blogIdFrom = (search, pathname) => {
    const fromQuery = /^\/PostView\.(naver|nhn)$/i.test(pathname) ? new URLSearchParams(search).get("blogId") : null;
    const candidate = fromQuery ?? pathname.match(/^\/([^/]+)\/\d+\/?$/)?.[1] ?? null;
    return candidate && BLOG_ID.test(candidate) ? candidate : null;
  };
  const rewriteImageUrl = (src) => {
    let url;
    try {
      url = new URL(src);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || !url.hostname.endsWith(".pstatic.net")) return null;
    url.username = "";
    url.password = "";
    url.port = "";
    url.hostname = "postfiles.pstatic.net";
    url.hash = "";
    url.searchParams.set("type", "w3840");
    return url.href;
  };
  const dateFromScripts = (texts) => {
    for (const text of texts) {
      const ms = Number(/var\s+postWriteDate\s*=\s*["'](\d{10,13})["']/.exec(text)?.[1]);
      if (Number.isFinite(ms) && ms > 0) return ms;
    }
    return null;
  };

  // keep in sync with shared/naver.js (extensionOf, parseKst)
  // File extension from the last path segment: jpg or png, else null (gif, webp, none: the picture is skipped).
  function extensionOf(address) {
    let path = String(address).split(/[?#]/)[0];
    try {
      path = new URL(address).pathname;
    } catch {
      // not an absolute URL: the text before ? or # is used as is
    }
    const ext = path.split("/").pop().match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase().replace("jpeg", "jpg");
    return ext === "jpg" || ext === "png" ? ext : null;
  }

  // Korean time (UTC+9) text → epoch ms, or null if it does not parse or is an impossible date. Accepts
  //   "2023. 3. 30. 14:00"          (blog; 24-hour clock)
  //   "2026.09.05. 오후 3:44"        (entertain; 오전 = AM, 오후 = PM: 오전 12 is 00, 오후 12 is 12)
  //   "2026-09-05 15:44:09"         (entertain page data, with seconds)
  function parseKst(text) {
    const s = String(text ?? "");
    let y, mo, d, h, mi, sec;
    const iso = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (iso) {
      [y, mo, d, h, mi, sec] = iso.slice(1).map(Number);
    } else {
      const m = s.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s+(오전|오후)?\s*(\d{1,2}):(\d{2})/);
      if (!m) return null;
      [y, mo, d] = m.slice(1, 4).map(Number);
      h = Number(m[5]);
      mi = Number(m[6]);
      sec = 0;
      if (m[4]) {
        if (h < 1 || h > 12) return null;
        h = (h % 12) + (m[4] === "오후" ? 12 : 0);
      }
    }
    if (h > 23 || mi > 59 || sec > 59) return null;
    const ms = Date.UTC(y, mo - 1, d, h - 9, mi, sec);
    const k = new Date(ms + 9 * 3600000); // back to KST wall-clock to catch impossible dates like 2023. 2. 31.
    const same = k.getUTCFullYear() === y && k.getUTCMonth() === mo - 1 && k.getUTCDate() === d && k.getUTCHours() === h;
    return same ? ms : null;
  }

  // ---- which document holds the post: this one, or the same-origin iframe#mainFrame of the desktop frameset
  let doc = document;
  let loc = location;
  const frame = document.querySelector("iframe#mainFrame");
  if (frame) {
    try {
      if (frame.contentDocument?.location) {
        doc = frame.contentDocument;
        loc = frame.contentDocument.location;
      }
    } catch {
      add("Post frame (iframe#mainFrame)", "FAIL", "cannot read the frame (not same origin)");
    }
  }
  add("Page", "INFO", `${location.hostname}${location.pathname}${doc !== document ? ` (post in iframe#mainFrame: ${loc.pathname}${loc.search.slice(0, 60)})` : ""}`);
  add("Chrome version", "INFO", navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || "unknown");
  const inPost = Boolean(doc.querySelector(".se-viewer .se-main-container"));
  add("Post body (.se-viewer .se-main-container)", inPost ? "PASS" : "FAIL",
    inPost ? "found" : "not found: not a post page, the frame has not loaded, or an old SmartEditor 2 post (not supported)");
  const buttons = [...doc.querySelectorAll(".md-download-btn")];
  add("mediadownloader active in this page", buttons.length ? "PASS" : "INFO",
    buttons.length ? `${buttons.length} buttons, kinds ${[...new Set(buttons.map((b) => b.dataset.mdKind))].join(",")}` : "no buttons: extension not loaded, site disabled in Settings, or page not supported");

  // ---- blog id and log number
  const blogId = blogIdFrom(loc.search, loc.pathname);
  add("Blog id (PostView blogId= or /<id>/<logNo>)", blogId ? "PASS" : "FAIL", blogId || `no valid id in ${loc.pathname}${loc.search.slice(0, 60)}`);
  const logNo = new URLSearchParams(loc.search).get("logNo") || loc.pathname.match(/^\/[^/]+\/(\d+)/)?.[1] || "";
  add("Log number (post id)", logNo ? "PASS" : "FAIL", logNo || "none in the address");

  // ---- date
  const fromScript = dateFromScripts([...doc.scripts].map((s) => s.textContent));
  const addDate = Number(doc.querySelector("#_post_property")?.getAttribute("addDate"));
  const textEl = [".se_publishDate", ".blog_date .txt"].map((s) => doc.querySelector(s)).find((e) => e && parseKst(e.textContent));
  const fromText = textEl ? parseKst(textEl.textContent) : null;
  let ms = null;
  let source = "";
  if (fromScript) [ms, source] = [fromScript, "script var postWriteDate"];
  else if (Number.isFinite(addDate) && addDate > 0) [ms, source] = [addDate, "#_post_property[addDate]"];
  else if (fromText) [ms, source] = [fromText, "visible KST text (fallback)"];
  add("Date source", ms ? "PASS" : inPost ? "FAIL" : "SKIP",
    ms ? `${source}: raw ${source.startsWith("visible") ? JSON.stringify(textEl.textContent.trim()) : ms} = ${new Date(ms).toISOString()} UTC` : "no postWriteDate script, #_post_property[addDate] or KST text");
  if (ms && fromText && Math.abs(fromText - ms) > 60000) {
    add("Date matches the visible KST text", "FAIL", `${new Date(ms).toISOString()} vs text ${JSON.stringify(textEl.textContent.trim())} = ${new Date(fromText).toISOString()}`);
  } else if (ms && fromText) {
    add("Date matches the visible KST text", "PASS", JSON.stringify(textEl.textContent.trim()));
  } else add("Date matches the visible KST text", "SKIP", "no readable visible date to compare with");

  // ---- pictures
  const links = [...doc.querySelectorAll(".se-main-container a.__se_image_link")];
  const withData = links.filter((a) => a.dataset.linkdata);
  add("Pictures (a.__se_image_link[data-linkdata])", withData.length ? "PASS" : inPost ? "FAIL" : "SKIP", `${withData.length} with data of ${links.length} links`);
  const withButton = withData.filter((a) => a.closest(".se-module-image")?.querySelector(".md-download-btn")).length;
  add("Buttons on pictures", withData.length ? "INFO" : "SKIP", `${withButton} of ${withData.length} pictures have a button (unsupported types get none)`);
  const first = withData[0];
  let rewritten = null;
  if (first) {
    let src = null;
    try {
      src = JSON.parse(first.dataset.linkdata).src;
    } catch {
      add("First picture data-linkdata", "FAIL", "not JSON");
    }
    if (src) {
      rewritten = rewriteImageUrl(src);
      const ext = rewritten ? extensionOf(rewritten) : null;
      add("First picture src", "INFO", src);
      add("First picture rewritten URL", rewritten ? "PASS" : "FAIL", rewritten || "src is not an https *.pstatic.net address");
      add("First picture extension", ext ? "PASS" : rewritten ? "FAIL" : "SKIP", ext || "not jpg/png: such pictures are skipped (no button)");
      add("Wrapper (.se-module-image)", first.closest(".se-module-image") ? "PASS" : "FAIL", first.closest(".se-module-image") ? "found" : "button would have no place");
    }
  } else add("First picture", "SKIP", "no pictures");
  const types = withData.reduce((acc, a) => {
    try {
      const e = extensionOf(JSON.parse(a.dataset.linkdata).src) || "other";
      return { ...acc, [e]: (acc[e] || 0) + 1 };
    } catch {
      return { ...acc, bad: (acc.bad || 0) + 1 };
    }
  }, {});
  add("Picture types in this post", "INFO", JSON.stringify(types));

  // ---- one ranged request, only to see what the CDN says (a page cannot read it: CORS)
  if (rewritten) {
    try {
      const r = await fetch(rewritten, { headers: { Range: "bytes=0-0" }, credentials: "omit", signal: AbortSignal.timeout(15000) });
      const type = r.headers.get("content-type") || "";
      add("CDN ranged GET (bytes=0-0)", r.status === 200 || r.status === 206 ? "PASS" : "FAIL", `HTTP ${r.status}, ${type}`);
    } catch (err) {
      add("CDN ranged GET (bytes=0-0)", "SKIP", `not readable from a page (CORS is expected): ${err.message}`);
    }
  } else add("CDN ranged GET (bytes=0-0)", "SKIP", "no URL to try");

  // ---- summary
  console.table(rows);
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.result]: (acc[r.result] || 0) + 1 }), {});
  const failed = rows.filter((r) => r.result === "FAIL").map((r) => r.check);
  console.log(`mediadownloader Naver Blog health check: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}.` +
    (failed.length ? `\nFailed: ${failed.join("; ")}\nSee context.md → "When Naver changes something". Reload the extension and the tab, then run again.` : ""));
  return rows;
})();
