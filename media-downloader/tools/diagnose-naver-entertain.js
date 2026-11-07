// mediadownloader: Naver Entertain health check.
//
// Run it when Naver Entertain downloads stop working, to see which piece Naver changed:
//   1. Open a news article (m.entertain.naver.com/home/article/<oid>/<aid>), a photo article
//      (/photo/article/<oid>/<aid>) or the photo viewer (/entertain?...#main/<imgId>) in the browser where
//      mediadownloader is installed.
//   2. Press F12 -> Console, paste this whole file, press Enter.
//   3. Read the table. FAIL rows say what broke; context.md -> "Naver Entertain" -> "When Naver Entertain changes something" says what to do.
//
// Legend: PASS = works. FAIL = broken, needs action. SKIP = not checked, the page has nothing to test it with.
// INFO = information, or normal on some pages.
//
// It only reads: nothing is downloaded, clicked or changed, and no settings are touched. The only request is one
// optional ranged GET (Range: bytes=0-0) of the first picture, which a page normally cannot read (CORS): that is
// reported as SKIP, not FAIL. The function returns the rows, so a script can read them (CDP Runtime.evaluate with
// awaitPromise). The helpers below are copied from sites/naver-entertain.js and shared/naver.js; keep them in sync.
(async () => {
  const rows = [];
  const add = (check, result, detail = "") => rows.push({ check, result, detail: String(detail).slice(0, 200) });

  // keep in sync with shared/naver.js (extensionOf, parseKst, stripSpaces)
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

  // A press name for the file name: ALL whitespace removed, Hangul kept. The zero-width characters are listed because
  // MDSettings.sanitize would turn them back into spaces.
  const stripSpaces = (text) => String(text ?? "").replace(/[\s\u200B-\u200F\u2060-\u206F\uFEFF]/g, "");

  // keep in sync with sites/naver-entertain.js (articleIdsFrom, rewriteImageUrl, rscChunks, objectsUnder, dateFromRsc, pressFromRsc, parseFooter, viewerFileNumber, viewerOid)
  const MDNaver = { extensionOf, parseKst, stripSpaces };

  const ARTICLE_PATH = /^\/(?:(?:home|photo)\/)?article\/(\d+)\/(\d+)\/?$/;

  // { oid, aid } from /home/article/<oid>/<aid> or /photo/article/<oid>/<aid>, else null.
  function articleIdsFrom(pathname) {
    const m = String(pathname).match(ARTICLE_PATH);
    return m ? { oid: m[1], aid: m[2] } : null;
  }

  // The picture's original: the same URL with the query and hash removed (no `type` serves the original file). The host
  // is kept as given (imgnews, mimgnews and ssl.pstatic.net/mimgnews all occur). Only https: and pstatic.net or
  // *.pstatic.net are accepted, else null. Built with URL, never by string concatenation.
  function rewriteImageUrl(src) {
    let url;
    try {
      url = new URL(src);
    } catch {
      return null;
    }
    const host = url.hostname;
    if (url.protocol !== "https:" || !(host === "pstatic.net" || host.endsWith(".pstatic.net"))) return null;
    url.username = "";
    url.password = "";
    url.port = "";
    url.search = "";
    url.hash = "";
    return url.href;
  }

  // The string literals of every `self.__next_f.push([1,"..."])` in the given script texts, decoded with JSON.parse
  // (no eval). Literals that do not parse are skipped.
  function rscChunks(texts) {
    const chunks = [];
    for (const text of texts) {
      for (const m of String(text).matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
        try {
          const chunk = JSON.parse(m[1]);
          if (typeof chunk === "string") chunks.push(chunk);
        } catch {
          // malformed chunk: skipped
        }
      }
    }
    return chunks;
  }

  // Every object stored under `"<key>":{…}` in the text, parsed. The end of the object is found by counting braces
  // outside strings. Objects that do not parse are skipped.
  function objectsUnder(text, key) {
    const needle = `"${key}":{`;
    const found = [];
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
      const start = at + needle.length - 1;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') inString = false;
        } else if (c === '"') inString = true;
        else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) {
          try {
            found.push(JSON.parse(text.slice(start, i + 1)));
          } catch {
            // not JSON: skipped
          }
          break;
        }
      }
    }
    return found;
  }

  // Publish time (입력) from the page data: articleInfo.article.serviceDatetime "YYYY-MM-DD HH:mm:ss" (KST) → epoch ms, only
  // when the article's officeId and articleId equal the address's. modifyDatetime (수정) is never read. Null otherwise.
  function dateFromRsc(chunks, oid, aid) {
    const text = chunks.join("");
    for (const info of objectsUnder(text, "articleInfo")) {
      const article = info?.article;
      if (String(article?.officeId) !== oid || String(article?.articleId) !== aid) continue;
      const ms = MDNaver.parseKst(article.serviceDatetime);
      if (ms !== null) return ms;
    }
    return null;
  }

  // Naver's fixed Korean press name officeInfo.hname, whitespace removed, only when officeInfo.officeId equals the
  // address's oid. Null otherwise.
  function pressFromRsc(chunks, oid) {
    const text = chunks.join("");
    for (const office of objectsUnder(text, "officeInfo")) {
      if (String(office?.officeId) !== oid || typeof office.hname !== "string") continue;
      const name = MDNaver.stripSpaces(office.hname);
      if (name) return name;
    }
    return null;
  }

  // Viewer footer text, one line reading "<press name> | YYYY.MM.DD. 오전|오후 H:MM" → { press, ms } (press name with the
  // whitespace removed, ms the minute-precision KST time), else null.
  function parseFooter(text) {
    for (const line of String(text ?? "").split(/[\r\n]+/)) {
      const m = line.match(/^\s*([^|]+?)\s*\|\s*(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*(?:오전|오후)\s*\d{1,2}:\d{2})\s*$/);
      if (!m) continue;
      const press = MDNaver.stripSpaces(m[1]);
      const ms = MDNaver.parseKst(m[2]);
      if (press && ms !== null) return { press, ms };
    }
    return null;
  }

  // The file number of a viewer picture: .../image/origin/<oid>/<yyyy>/<mm>/<dd>/<n>.jpg → "<n>", else null.
  function viewerFileNumber(address) {
    let path = String(address);
    try {
      path = new URL(address).pathname;
    } catch {
      // not an absolute URL: used as is
    }
    return path.match(/\/image\/origin\/[^/]+\/\d{4}\/\d{2}\/\d{2}\/(\d+)\.[A-Za-z0-9]+$/)?.[1] ?? null;
  }

  // The office id of a viewer picture: the <oid> of the same path, else null.
  function viewerOid(address) {
    let path = String(address);
    try {
      path = new URL(address).pathname;
    } catch {
      // not an absolute URL: used as is
    }
    return path.match(/\/image\/origin\/([^/]+)\//)?.[1] ?? null;
  }

  const BODY = '[class*="Article_comp_news_article"], ._article_body';
  const BODY_IMAGES = '[class*="ArticleImage_article_image"] img';
  const ACTIVE_IMAGE = ".fotorama__stage__frame.fotorama__active img.fotorama__img";
  let firstUrl = null;
  const utc = (ms) => new Date(ms).toISOString();

  // ---- page kind
  const viewer = Boolean(document.querySelector(".fotorama__stage"));
  const articleEl = document.querySelector(BODY);
  const ids = articleIdsFrom(location.pathname);
  const kind = viewer ? "viewer" : articleEl ? (location.pathname.startsWith("/photo/") ? "photo article" : "article") : "none";
  add("Page", "INFO", `${location.hostname}${location.pathname}${location.hash.slice(0, 40)}`);
  add("Chrome version", "INFO", navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || "unknown");
  add("Page kind", kind === "none" ? "FAIL" : "PASS",
    kind === "none" ? "neither the article component (Article_comp_news_article) nor the viewer stage (.fotorama__stage): not a supported page, or the class names changed" : kind);
  const buttons = [...document.querySelectorAll(".md-download-btn")];
  add("mediadownloader active in this page", buttons.length ? "PASS" : "INFO",
    buttons.length ? `${buttons.length} buttons, kinds ${[...new Set(buttons.map((b) => b.dataset.mdKind))].join(",")}` : "no buttons: extension not loaded, site disabled in Settings, or page not supported");

  if (kind === "viewer") {
    // ---- photo viewer: the active slide and the footer line "<press> | <date>"
    const img = document.querySelector(ACTIVE_IMAGE);
    add("Active picture (.fotorama__active img.fotorama__img)", img ? "PASS" : "FAIL", img ? img.src : "no active slide image");
    const rewritten = img ? rewriteImageUrl(img.src) : null;
    add("Active picture rewritten URL", rewritten ? "PASS" : img ? "FAIL" : "SKIP", rewritten || "src is not an https *.pstatic.net address");
    const ext = rewritten ? extensionOf(rewritten) : null;
    add("Active picture extension", ext ? "PASS" : rewritten ? "FAIL" : "SKIP", ext || "not jpg/png: such pictures get no button");
    const number = rewritten ? viewerFileNumber(rewritten) : null;
    add("File number in the picture address (/image/origin/<oid>/<yyyy>/<mm>/<dd>/<n>.jpg)", number ? "PASS" : rewritten ? "FAIL" : "SKIP", number || "none");
    const footerText = document.querySelector("#footer")?.innerText;
    const footer = parseFooter(footerText);
    add("Footer press name (#footer '<name> | <date>')", footer ? "PASS" : "FAIL", footer ? footer.press : `no such line in #footer: ${JSON.stringify((footerText || "").slice(0, 80))}`);
    add("Footer date (KST -> UTC)", footer ? "PASS" : "FAIL", footer ? `${utc(footer.ms)} UTC (minute precision)` : "no date");
    const stageButton = document.querySelector('.fotorama__stage .md-download-btn[data-md-kind="viewer"]');
    add("Viewer button on the stage", stageButton ? "PASS" : "INFO", stageButton ? "found" : "not found (extension not loaded, or the active picture is not a JPG/PNG)");
  } else if (kind !== "none") {
    // ---- article and photo article
    add("Article ids (/home|photo/article/<oid>/<aid>)", ids ? "PASS" : "FAIL", ids ? `oid ${ids.oid}, aid ${ids.aid}` : `no ids in ${location.pathname}`);
    const chunks = rscChunks([...document.scripts].map((s) => s.textContent));
    add("Page data chunks (self.__next_f.push)", chunks.length ? "PASS" : "INFO", `${chunks.length} chunks (the DOM fallbacks are used without them)`);
    const hname = ids ? pressFromRsc(chunks, ids.oid) : null;
    const alt = stripSpaces(document.querySelector('a[class^="PressLogo_"] img')?.getAttribute("alt"));
    add("Press name from page data (officeInfo.hname, officeId = oid)", hname ? "PASS" : alt ? "INFO" : "FAIL", hname || "not found (the logo alt is the fallback)");
    add("Press name from the logo (a[class^=PressLogo_] img alt)", alt ? "PASS" : hname ? "INFO" : "FAIL", alt || "no logo alt yet (it renders after hydration)");
    const press = hname || alt;
    add("Press name used", press ? "PASS" : "FAIL", press ? `${hname ? "page data" : "logo alt"}: ${press}` : "none: a click would say 'no press name on this page'");
    if (hname && alt && hname !== alt) add("Press name page data vs logo alt", "INFO", `${hname} vs ${alt}`);
    const fromData = ids ? dateFromRsc(chunks, ids.oid, ids.aid) : null;
    let fromText = null;
    let rawText = "";
    for (const item of document.querySelectorAll('[class*="DateInfo_info_item"]')) {
      if (item.querySelector('[class*="DateInfo_term"]')?.textContent.trim() !== "입력") continue;
      rawText = (item.querySelector("em")?.textContent ?? item.textContent.replace("입력", "")).trim();
      fromText = parseKst(rawText);
    }
    const rawData = fromData !== null ? objectsUnder(chunks.join(""), "articleInfo").map((i) => i?.article).find((a) => String(a?.articleId) === ids.aid && String(a?.officeId) === ids.oid)?.serviceDatetime : "";
    add("Date source", fromData !== null || fromText !== null ? "PASS" : "FAIL",
      fromData !== null ? `page data serviceDatetime = ${utc(fromData)} UTC` : fromText !== null ? `visible 입력 text ${JSON.stringify(rawText)} = ${utc(fromText)} UTC (minute precision)` : "no serviceDatetime for this article and no readable 입력 text");
    add("Date raw value", "INFO", fromData !== null ? `page data serviceDatetime ${JSON.stringify(rawData)}` : rawText ? JSON.stringify(rawText) : "none");
    if (fromData !== null && fromText !== null) {
      add("Page data date matches the 입력 text (to the minute)", Math.floor(fromData / 60000) === Math.floor(fromText / 60000) ? "PASS" : "FAIL", `${utc(fromData)} vs ${utc(fromText)}`);
    } else add("Page data date matches the 입력 text (to the minute)", "SKIP", "only one date source is readable");
    const pictures = [...document.querySelectorAll(BODY_IMAGES)].filter((i) => i.closest(BODY));
    add("Pictures in the article body", pictures.length ? "PASS" : "FAIL", `${pictures.length} (related-list thumbnails are not counted)`);
    const withButton = pictures.filter((i) => i.closest('[class*="ArticleImage_image_wrap"]')?.querySelector(".md-download-btn")).length;
    add("Buttons on pictures", pictures.length ? "INFO" : "SKIP", `${withButton} of ${pictures.length} pictures have a button (unsupported types get none)`);
    const first = pictures[0];
    if (first) {
      const rewritten = rewriteImageUrl(first.src);
      const ext = rewritten ? extensionOf(rewritten) : null;
      add("First picture src", "INFO", first.src);
      add("First picture rewritten URL", rewritten ? "PASS" : "FAIL", rewritten || "src is not an https *.pstatic.net address");
      add("First picture extension", ext ? "PASS" : rewritten ? "FAIL" : "SKIP", ext || "not jpg/png: such pictures are skipped (no button)");
      add("Wrapper (ArticleImage_image_wrap)", first.closest('[class*="ArticleImage_image_wrap"]') ? "PASS" : "FAIL", first.closest('[class*="ArticleImage_image_wrap"]') ? "found" : "button would have no place");
      firstUrl = rewritten;
    }
  }

  // ---- one ranged request, only to see what the CDN says (a page cannot read it: CORS)
  const probe = kind === "viewer" ? rewriteImageUrl(document.querySelector(ACTIVE_IMAGE)?.src || "") : firstUrl;
  if (probe) {
    try {
      const r = await fetch(probe, { headers: { Range: "bytes=0-0" }, credentials: "omit", signal: AbortSignal.timeout(15000) });
      add("CDN ranged GET (bytes=0-0)", r.status === 200 || r.status === 206 ? "PASS" : "FAIL", `HTTP ${r.status}, ${r.headers.get("content-type") || ""}`);
    } catch (err) {
      add("CDN ranged GET (bytes=0-0)", "SKIP", `not readable from a page (CORS is expected): ${err.message}`);
    }
  } else add("CDN ranged GET (bytes=0-0)", "SKIP", "no URL to try");

  // ---- summary
  console.table(rows);
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.result]: (acc[r.result] || 0) + 1 }), {});
  const failed = rows.filter((r) => r.result === "FAIL").map((r) => r.check);
  console.log(`mediadownloader Naver Entertain health check: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}.` +
    (failed.length ? `\nFailed: ${failed.join("; ")}\nSee context.md -> "Naver Entertain" -> "When Naver Entertain changes something". Reload the extension and the tab, then run again.` : ""));
  return rows;
})();
