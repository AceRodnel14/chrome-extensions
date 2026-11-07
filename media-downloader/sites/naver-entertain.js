// mediadownloader: Naver Entertain (m.entertain.naver.com) support.
// Adds a download button to every picture of a news article and photo article, and one button on the active slide of
// the photo viewer (a fotorama slider). One click saves that one picture. Everything needed is already in the page: no
// request is made, no tab is opened, nothing is prefetched. The desktop host redirects to the mobile site, so the
// manifest only matches the mobile host. Class names are CSS-module hashes that change per build: they are matched on
// their prefix. The script does nothing unless the page has the article component or the fotorama stage.
// The description-date option does not apply here (MDSettings.postTime is never used).
(() => {
  const SITE_ID = "naver-entertain";
  const BTN = "md-download-btn";

  // ---------------------------------------------------------------- pure helpers (unit-tested, copied in tools/diagnose-naver-entertain.js)

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

  // Does the footer's article link describe the picture? In the viewer each slide is one photo article whose numeric
  // article id equals the picture's file number. true / false, or null when either number is missing (cannot tell).
  function slideMatches(footerHref, imageUrl) {
    const aid = String(footerHref ?? "").match(/\/article\/\d+\/(\d+)/)?.[1];
    const number = viewerFileNumber(imageUrl);
    return aid === undefined || number === null ? null : Number(aid) === Number(number);
  }

  // Decide from successive readings of the viewer ({ url, href, match }: match is true, false or null = cannot tell),
  // taken while the footer and the picture disagreed. → { status: "ok" | "stable" | "loading", index }.
  //   ok: a reading agrees (or cannot tell); use it. loading: the picture or footer changed during the wait and no
  //   reading agrees: the slide is still loading, refuse. stable: nothing changed in the whole window and the pair
  //   still disagrees: an outlet whose article id is not the file number; use the last reading.
  function settleViewer(readings) {
    const ok = readings.findIndex((r) => r.match !== false);
    if (ok >= 0) return { status: "ok", index: ok };
    const first = readings[0];
    const changed = readings.some((r) => r.url !== first.url || r.href !== first.href);
    return changed ? { status: "loading", index: -1 } : { status: "stable", index: readings.length - 1 };
  }

  const helpers = { settleViewer, slideMatches, articleIdsFrom, rewriteImageUrl, rscChunks, objectsUnder, dateFromRsc, pressFromRsc, parseFooter, viewerFileNumber, viewerOid };
  // Unit tests load this file with a `module` object (and MDNaver from shared/naver.js); a content script has none.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = helpers;
    return;
  }

  // ---------------------------------------------------------------- state and errors

  const { extensionOf, parseKst, stripSpaces } = MDNaver; // shared/naver.js, loaded before this file
  let settings = MDSettings.DEFAULTS;
  const enabled = () => settings.sites[SITE_ID] !== false;

  // Diagnose mode only: explain every call in the console.
  const diag = (...args) => settings.diagnoseMode && console.info("[mediadownloader:diagnose]", ...args);

  // Errors name the call that failed ("Picture lookup failed: …"); Diagnose mode adds the technical detail.
  const callError = (label, message, detail) => new Error(`${label} failed: ${message}${settings.diagnoseMode && detail ? ` [${detail}]` : ""}`);

  // ---------------------------------------------------------------- page data

  const BODY = '[class*="Article_comp_news_article"], ._article_body';
  const BODY_IMAGES = '[class*="ArticleImage_article_image"] img';
  const ACTIVE_IMAGE = ".fotorama__stage__frame.fotorama__active img.fotorama__img";

  const inViewer = () => Boolean(document.querySelector(".fotorama__stage"));
  const inArticle = () => Boolean(document.querySelector(BODY));

  // Every picture of the article body in document order; the position in this list is the _<n> of the file name.
  // Thumbnails of related lists are not in the article component.
  const bodyPictures = () => [...document.querySelectorAll(BODY_IMAGES)].filter((img) => img.closest(BODY));

  const scriptTexts = () => [...document.scripts].map((s) => s.textContent);

  // The file behind an <img>: { url, ext }. Throws "Picture lookup failed" when it cannot be used.
  function pictureOf(img) {
    const src = img?.src;
    const url = typeof src === "string" ? rewriteImageUrl(src) : null;
    if (!url) throw callError("Picture lookup", "this picture is not on Naver's image server.", `src ${JSON.stringify(src)}`);
    const ext = extensionOf(url);
    if (!ext) throw callError("Picture lookup", "only JPG and PNG pictures are supported.", `src ${JSON.stringify(src)}`);
    return { url, ext };
  }

  // Article: the publish time (입력) in epoch ms from the page data, else the visible 입력 text. Never 수정.
  function articleTimeMs(chunks, ids) {
    const fromData = dateFromRsc(chunks, ids.oid, ids.aid);
    if (fromData !== null) return { ms: fromData, source: "page data serviceDatetime" };
    for (const item of document.querySelectorAll('[class*="DateInfo_info_item"]')) {
      if (item.querySelector('[class*="DateInfo_term"]')?.textContent.trim() !== "입력") continue;
      const ms = parseKst(item.querySelector("em")?.textContent ?? item.textContent.replace("입력", ""));
      if (ms !== null) return { ms, source: "visible 입력 text (KST, minute precision)" };
    }
    return null;
  }

  // Article: the press name (whitespace removed) from the page data, else the logo's alt (rendered after hydration).
  function articlePress(chunks, ids) {
    const fromData = pressFromRsc(chunks, ids.oid);
    if (fromData) return { name: fromData, source: "page data officeInfo.hname" };
    const alt = stripSpaces(document.querySelector('a[class^="PressLogo_"] img')?.getAttribute("alt"));
    return alt ? { name: alt, source: "press logo alt" } : null;
  }

  // Article and photo article: what to download for a clicked picture → [{ url, filename, takenAt }].
  function articleFile(img) {
    const ids = articleIdsFrom(location.pathname);
    if (!ids) throw callError("Post lookup", "this page's address has no article id.", location.pathname);
    const picture = pictureOf(img);
    const position = bodyPictures().indexOf(img);
    if (position < 0) throw callError("Picture lookup", "this picture is no longer on the page.", "img not in the article body");
    const chunks = rscChunks(scriptTexts());
    const press = articlePress(chunks, ids);
    if (!press) throw callError("Post lookup", "no press name on this page", "no officeInfo.hname for this oid, no PressLogo alt");
    const time = articleTimeMs(chunks, ids);
    if (!time) throw callError("Post date lookup", "no publish date found on this page.", "no serviceDatetime for this article, no 입력 text");
    return { picture, position, press, time };
  }

  // Viewer: what the page shows right now: the active picture, with the press name and date from the footer.
  function readViewer() {
    const img = document.querySelector(ACTIVE_IMAGE);
    if (!img) throw callError("Picture lookup", "no picture is showing.", `no ${ACTIVE_IMAGE}`);
    const picture = pictureOf(img);
    const number = viewerFileNumber(picture.url);
    if (number === null) throw callError("Picture lookup", "no file number in this picture's address.", picture.url);
    const footer = parseFooter(document.querySelector("#footer")?.innerText);
    if (!footer) throw callError("Post lookup", "no press name on this page", "#footer has no '<name> | <date>' line");
    const href = document.querySelector("#footer a[href*='/article/']")?.getAttribute("href") ?? null;
    const officeOk = !href || !/\/article\/\d+\//.test(href) || href.match(/\/article\/(\d+)\//)[1] === viewerOid(picture.url);
    return { picture, number, footer, url: picture.url, href, match: officeOk ? slideMatches(href, picture.url) : false };
  }

  const VIEWER_POLL_MS = 100;
  const VIEWER_WAIT_MS = 2000;

  // After a slide change the hash and the footer update first and the picture follows (~100-150 ms, longer on a slow
  // connection). While the footer and the picture disagree, read again every 100 ms for up to 2 s and decide with
  // settleViewer, so the old picture is never saved with the new slide's date.
  async function viewerFile() {
    const readings = [readViewer()];
    for (let waited = 0; readings.at(-1).match === false && waited < VIEWER_WAIT_MS; waited += VIEWER_POLL_MS) {
      await new Promise((resolve) => setTimeout(resolve, VIEWER_POLL_MS));
      try {
        readings.push(readViewer());
      } catch {
        readings.push({ url: null, href: null, match: false }); // mid-swap: no active picture or footer line for a moment
      }
    }
    const verdict = settleViewer(readings);
    if (verdict.status === "loading") throw callError("Picture lookup", "the slide is still loading, try again.", readings.map((r) => `${r.href} vs ${r.url}`).join(" | "));
    const used = readings[verdict.index];
    if (!used.picture) throw callError("Picture lookup", "the slide is still loading, try again.", "no readable slide at the end");
    if (verdict.status === "stable") diag("footer and picture disagree but nothing changed for 2 s; kept", used.href, used.url);
    const { picture, number, footer } = used;
    return { picture, position: number, press: { name: footer.press, source: "#footer" }, time: { ms: footer.ms, source: "#footer (KST, minute precision)" } };
  }

  // What to download for a clicked button → [{ url, filename, takenAt }]. Read at click time: `target` is the clicked
  // article picture, or null for the viewer button, which acts on the slide that is active now.
  async function filesFor(target) {
    const found = target ? articleFile(target) : await viewerFile();
    const { picture, position, press, time } = found;
    diag("picture", { kind: target ? "article" : "viewer", position, press: press.name, pressSource: press.source, date: new Date(time.ms).toISOString(), dateSource: time.source, url: picture.url });
    const vars = { username: press.name, createdDate: MDSettings.formatDate(time.ms), website: MDSettings.websiteName(location.hostname) };
    return [{
      url: picture.url,
      filename: MDSettings.buildFilename(settings.filenamePattern, vars, position, picture.ext), // position always appears, even for 0
      takenAt: Math.floor(time.ms / 1000), // post time in Unix seconds, for the exiftool helper
    }];
  }

  // ---------------------------------------------------------------- downloading + feedback

  let pendingBatch = false; // this frame started a click whose result is still to come

  async function download(target, btn) {
    if (btn?.dataset.busy) return;
    if (btn) {
      btn.dataset.busy = "1";
      btn.style.opacity = "0.4";
    }
    toast("Downloading…");
    try {
      const files = await filesFor(target); // read at click time
      const { results, exiftool } = await chrome.runtime.sendMessage({ type: "download", site: SITE_ID, files });
      diag("chrome.downloads started", results, exiftool ? `${exiftool} files will get their date` : "exiftool not used");
      // The verdict comes later, once the file has finished (see the "batchResult" listener below).
      pendingBatch = true;
      lastButton = btn;
      toast(MDReport.waiting(results.length, exiftool > 0));
    } catch (err) {
      console.error("[mediadownloader]", err);
      toast(err.message || "The download failed. Please try again.", "error");
      flash(btn, "#d93900");
    } finally {
      if (btn) {
        delete btn.dataset.busy;
        btn.style.opacity = "";
      }
    }
  }

  function flash(btn, color) {
    if (!btn) return;
    const svg = btn.querySelector("svg");
    svg.style.color = color;
    setTimeout(() => (svg.style.color = ""), 2000);
  }

  let toastEl = null;
  let toastTimer = 0;
  const TOAST_COLORS = { progress: "#0045ac", success: "#0a7d2c", warning: "#b26a00", error: "#d93900" };

  function toast(text, kind = "progress") {
    if (!toastEl) {
      toastEl = document.createElement("div");
      Object.assign(toastEl.style, {
        position: "fixed",
        right: "24px",
        bottom: "24px",
        zIndex: "2147483000",
        maxWidth: "320px",
        padding: "12px 16px",
        borderRadius: "10px",
        boxShadow: "0 4px 16px rgba(0,0,0,.3)",
        color: "#fff",
        font: '14px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        wordBreak: "break-word",
        pointerEvents: "none",
        transition: "opacity .2s ease, transform .2s ease",
      });
    }
    if (!toastEl.isConnected) document.body.append(toastEl);
    clearTimeout(toastTimer);
    toastEl.textContent = text;
    toastEl.style.background = TOAST_COLORS[kind];
    toastEl.style.opacity = "1";
    toastEl.style.transform = "translateY(0)";
    if (kind !== "progress") {
      toastTimer = setTimeout(() => {
        toastEl.style.opacity = "0";
        toastEl.style.transform = "translateY(8px)";
      }, 4000);
    }
  }

  // ---------------------------------------------------------------- buttons

  // Material "download_for_offline": the circle-with-arrow icon used on every button.
  const ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 2 20 20" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M7.1 16.9h9.8v-1.65H7.1Zm4.9-3.15 3.8-3.8-1.15-1.15-1.85 1.875V5.95h-1.65v4.675L9.35 8.8 8.2 9.95Zm0 8.05q-2.025 0-3.812-.775-1.788-.775-3.113-2.1-1.325-1.325-2.1-3.113Q2.2 14.025 2.2 12t.775-3.825q.775-1.8 2.1-3.125Q6.4 3.725 8.188 2.962 9.975 2.2 12 2.2t3.825.762q1.8.763 3.125 2.088 1.325 1.325 2.088 3.112Q21.8 9.95 21.8 12t-.762 3.825q-.763 1.775-2.088 3.1-1.325 1.325-3.112 2.1Q14.05 21.8 12 21.8Zm0-1.65q3.425 0 5.788-2.363Q20.15 15.425 20.15 12t-2.362-5.788Q15.425 3.85 12 3.85q-3.425 0-5.787 2.362Q3.85 8.575 3.85 12q0 3.425 2.363 5.787Q8.575 20.15 12 20.15ZM12 12Z"/></svg>';

  // `target` is the article <img> the button belongs to, or null for the viewer button.
  function makeButton(target) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN;
    btn.dataset.mdKind = target ? "image" : "viewer";
    btn.title = "Download this picture";
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML = ICON; // fixed markup of this file, no page data
    Object.assign(btn.style, {
      position: "absolute",
      top: target ? "8px" : "64px",
      right: "8px",
      zIndex: "3",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "32px",
      height: "32px",
      padding: "0",
      border: "none",
      borderRadius: "999px",
      background: "rgba(255,255,255,.92)",
      color: "#222",
      boxShadow: "0 1px 4px rgba(0,0,0,.3)",
      cursor: "pointer",
      transition: "transform .15s ease, opacity .15s ease",
    });
    if (!target) btn.style.zIndex = "2147482000"; // above the slider's own layers
    btn.addEventListener("mouseenter", () => (btn.style.transform = "scale(1.08)"));
    btn.addEventListener("mouseleave", () => (btn.style.transform = ""));
    // The picture and the slider react to pointer events (zoom, swipe); keep every one to ourselves.
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "touchstart", "touchend"]) {
      btn.addEventListener(type, (e) => {
        e.stopPropagation();
        e.preventDefault();
      });
    }
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      download(target, btn);
    });
    return btn;
  }

  function injectAll() {
    if (!enabled() || !(inArticle() || inViewer())) return removeAll();
    if (inViewer()) {
      // One button for the whole stage; it acts on the active slide at click time. It is shown only while the active
      // picture is a usable JPG/PNG.
      const stage = document.querySelector(".fotorama__stage");
      let usable = true;
      try {
        pictureOf(document.querySelector(ACTIVE_IMAGE));
      } catch (err) {
        usable = false;
        diag("no viewer button:", err.message);
      }
      const existing = stage.querySelector(`.${BTN}[data-md-kind="viewer"]`);
      if (!usable) existing?.remove();
      else if (!existing) {
        if (getComputedStyle(stage).position === "static") stage.style.position = "relative";
        stage.append(makeButton(null));
      }
    }
    if (!inArticle()) return;
    for (const img of bodyPictures()) {
      const holder = img.closest('[class*="ArticleImage_image_wrap"]');
      if (!holder || holder.querySelector(`.${BTN}`)) continue;
      try {
        pictureOf(img); // pictures without a usable JPG/PNG address get no button
      } catch (err) {
        diag("no button:", err.message);
        continue;
      }
      if (getComputedStyle(holder).position === "static") holder.style.position = "relative";
      holder.append(makeButton(img));
    }
  }

  function removeAll() {
    document.querySelectorAll(`.${BTN}`).forEach((b) => b.remove());
  }

  // ---------------------------------------------------------------- start

  // A timer rather than requestAnimationFrame: rAF is paused in background tabs. The page hydrates late, and the viewer
  // changes slides without navigating, so scan on DOM changes, on the address changing and on the hash changing.
  let queued = 0;
  const schedule = () => {
    if (!queued) queued = setTimeout(() => ((queued = 0), injectAll()), 150);
  };
  const observer = new MutationObserver(schedule);
  window.addEventListener("hashchange", schedule);
  window.addEventListener("popstate", schedule);

  // The background worker reports once the file of a click has finished.
  let lastButton = null;
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "batchResult" || !pendingBatch) return;
    pendingBatch = false;
    diag("batch result", msg);
    const { kind, text } = MDReport.summary(msg);
    toast(text, kind);
    flash(lastButton, { success: "#0a7d2c", warning: "#b26a00", error: "#d93900" }[kind]);
  });

  chrome.storage.onChanged.addListener(async (_changes, area) => {
    if (area !== "sync") return;
    settings = await MDSettings.load();
    injectAll();
  });

  MDSettings.load().then((loaded) => {
    settings = loaded;
    if (document.body) observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "class"] });
    injectAll();
  });
})();
