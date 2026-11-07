// mediadownloader: Naver Blog (blog.naver.com, m.blog.naver.com) support.
// Adds a download button to every picture of a blog post (SmartEditor ONE posts only). One click saves that one
// picture. Everything needed is already in the page: no request is made, no tab is opened, nothing is prefetched.
// The desktop site is a frameset: the post lives in the same-origin iframe#mainFrame, so this script runs in every
// frame (manifest all_frames) and does nothing unless the document has a post body (.se-viewer .se-main-container).
// The description-date option does not apply here (MDSettings.postTime is never used).
(() => {
  const SITE_ID = "naver-blog";
  const BTN = "md-download-btn";

  // ---------------------------------------------------------------- pure helpers (unit-tested, copied in tools/diagnose-naver-blog.js)

  const BLOG_ID = /^[A-Za-z0-9_-]+$/;
  const IMAGE_HOST = "postfiles.pstatic.net"; // serves ?type=w3840, the largest size Naver allows
  const IMAGE_TYPE = "w3840";

  // Blog id from the address: PostView.naver?blogId=<id> (desktop iframe, or a top-level PostView page), otherwise the
  // path /<id>/<logNo>. Null when it is missing or not a plain id. Never the nickname.
  function blogIdFrom(search, pathname) {
    const fromQuery = /^\/PostView\.(naver|nhn)$/i.test(pathname) ? new URLSearchParams(search).get("blogId") : null;
    const candidate = fromQuery ?? pathname.match(/^\/([^/]+)\/\d+\/?$/)?.[1] ?? null;
    return candidate && BLOG_ID.test(candidate) ? candidate : null;
  }

  // The picture's address on the CDN host that serves the biggest size, or null when it is not an https pstatic.net
  // address. Built with URL, never by string concatenation.
  function rewriteImageUrl(src) {
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
    url.hostname = IMAGE_HOST;
    url.hash = "";
    url.searchParams.set("type", IMAGE_TYPE);
    return url.href;
  }

  // `var postWriteDate = "1680152412063";` in an inline script (desktop). Epoch ms, or null.
  function dateFromScripts(texts) {
    for (const text of texts) {
      const ms = Number(/var\s+postWriteDate\s*=\s*["'](\d{10,13})["']/.exec(text)?.[1]);
      if (Number.isFinite(ms) && ms > 0) return ms;
    }
    return null;
  }

  const helpers = { blogIdFrom, rewriteImageUrl, dateFromScripts };
  // Unit tests load this file with a `module` object; a content script has none.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = helpers;
    return;
  }

  // ---------------------------------------------------------------- state and errors

  const { extensionOf, parseKst } = MDNaver; // shared/naver.js, loaded before this file

  let settings = MDSettings.DEFAULTS;
  const enabled = () => settings.sites[SITE_ID] !== false;

  // Diagnose mode only: explain every call in the console.
  const diag = (...args) => settings.diagnoseMode && console.info("[mediadownloader:diagnose]", ...args);

  // Errors name the call that failed ("Picture lookup failed: …"); Diagnose mode adds the technical detail.
  const callError = (label, message, detail) => new Error(`${label} failed: ${message}${settings.diagnoseMode && detail ? ` [${detail}]` : ""}`);

  // ---------------------------------------------------------------- page data

  const inPost = () => Boolean(document.querySelector(".se-viewer .se-main-container"));

  // Every picture link of the post in document order; the position in this list is the _<n> of the file name.
  const pictureLinks = () => [...document.querySelectorAll(".se-main-container a.__se_image_link")];

  // Publish time in epoch ms: the script variable (desktop), the hidden #_post_property[addDate] (mobile), else the
  // visible KST text. Null when none works; the caller refuses rather than guess.
  function postTimeMs() {
    const fromScript = dateFromScripts([...document.scripts].map((s) => s.textContent));
    if (fromScript) return { ms: fromScript, source: "postWriteDate script" };
    const addDate = Number(document.querySelector("#_post_property")?.getAttribute("addDate"));
    if (Number.isFinite(addDate) && addDate > 0) return { ms: addDate, source: "#_post_property[addDate]" };
    for (const selector of [".se_publishDate", ".blog_date .txt"]) {
      const text = document.querySelector(selector)?.textContent;
      const ms = parseKst(text);
      if (ms) return { ms, source: `${selector} text (KST, minute precision)` };
    }
    return null;
  }

  // The file behind a picture link: { url, ext }. Throws "Picture lookup failed" when it cannot be used.
  function pictureOf(link) {
    let src;
    try {
      src = JSON.parse(link.dataset.linkdata).src;
    } catch {
      throw callError("Picture lookup", "this picture has no readable data.", "data-linkdata is not JSON");
    }
    const url = typeof src === "string" ? rewriteImageUrl(src) : null;
    if (!url) throw callError("Picture lookup", "this picture is not on Naver's image server.", `src ${JSON.stringify(src)}`);
    const ext = extensionOf(url);
    if (!ext) throw callError("Picture lookup", "only JPG and PNG pictures are supported.", `src ${JSON.stringify(src)}`);
    return { url, ext };
  }

  // What to download for a clicked button → [{ url, filename, takenAt }].
  function filesFor(link) {
    const blogId = blogIdFrom(location.search, location.pathname);
    if (!blogId) throw callError("Blog id lookup", "no blog id in this page's address.", `${location.pathname}${location.search}`);
    const time = postTimeMs();
    if (!time) throw callError("Post date lookup", "no publish date found on this page.", "no postWriteDate script, #_post_property[addDate] or KST text");
    const picture = pictureOf(link);
    const position = pictureLinks().indexOf(link);
    if (position < 0) throw callError("Picture lookup", "this picture is no longer on the page.", "link not in .se-main-container");
    diag("picture", { blogId, position, date: new Date(time.ms).toISOString(), dateSource: time.source, url: picture.url });
    const vars = { username: blogId, createdDate: MDSettings.formatDate(time.ms), website: MDSettings.websiteName(location.hostname) };
    return [{
      url: picture.url,
      filename: MDSettings.buildFilename(settings.filenamePattern, vars, position, picture.ext), // position always appears, even for 0
      takenAt: Math.floor(time.ms / 1000), // post time in Unix seconds, for the exiftool helper
    }];
  }

  // ---------------------------------------------------------------- downloading + feedback

  let pendingBatch = false; // this frame started a click whose result is still to come

  async function download(link, btn) {
    if (btn?.dataset.busy) return;
    if (btn) {
      btn.dataset.busy = "1";
      btn.style.opacity = "0.4";
    }
    toast("Downloading…");
    try {
      const files = filesFor(link); // read at click time
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

  function makeButton(link) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN;
    btn.dataset.mdKind = "image";
    btn.title = "Download this picture";
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML = ICON; // fixed markup of this file, no page data
    Object.assign(btn.style, {
      position: "absolute",
      top: "8px",
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
    btn.addEventListener("mouseenter", () => (btn.style.transform = "scale(1.08)"));
    btn.addEventListener("mouseleave", () => (btn.style.transform = ""));
    // The surrounding <a> opens Naver's image viewer; keep every pointer event to ourselves.
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "touchstart", "touchend"]) {
      btn.addEventListener(type, (e) => {
        e.stopPropagation();
        e.preventDefault();
      });
    }
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      download(link, btn);
    });
    return btn;
  }

  function injectAll() {
    if (!enabled() || !inPost()) return removeAll();
    for (const link of pictureLinks()) {
      const holder = link.closest(".se-module-image");
      if (!holder || holder.querySelector(`.${BTN}`)) continue;
      try {
        pictureOf(link); // pictures without a usable JPG/PNG address get no button
      } catch (err) {
        diag("no button:", err.message);
        continue;
      }
      if (getComputedStyle(holder).position === "static") holder.style.position = "relative";
      holder.append(makeButton(link));
    }
  }

  function removeAll() {
    document.querySelectorAll(`.${BTN}`).forEach((b) => b.remove());
  }

  // ---------------------------------------------------------------- start

  // A timer rather than requestAnimationFrame: rAF is paused in background tabs. The page adds pictures lazily.
  let queued = 0;
  const observer = new MutationObserver(() => {
    if (!queued) queued = setTimeout(() => ((queued = 0), injectAll()), 150);
  });

  // The background worker reports once the file of a click has finished. It writes to every frame of the tab, so only
  // the frame that started the click answers.
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
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    injectAll();
  });
})();
