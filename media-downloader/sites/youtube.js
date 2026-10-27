// mediadownloader: YouTube posts support, only on a channel's "Posts" tab and a post's own page (/post/<id>); not videos,
// and not the posts shelves elsewhere (a channel's Home tab, feeds), whose posts open their /post/ page when clicked.
// Adds download buttons to posts and to the channel avatar and banner. The images come from the data YouTube already
// loaded into the page (read by youtube-page.js); the exact publish time comes from the post's own page, because the
// feed only says "7 hours ago".
(() => {
  const SITE_ID = "youtube";
  const BTN = "md-download-btn";
  const POST = "ytd-backstage-post-renderer, ytd-post-renderer, ytd-shared-post-renderer";

  let settings = MDSettings.DEFAULTS;
  const enabled = () => settings.sites[SITE_ID] !== false;

  // Diagnose mode only: explain every call in the console.
  const diag = (...args) => settings.diagnoseMode && console.info("[mediadownloader:diagnose]", ...args);

  // Errors name the call that failed ("Post date lookup failed: …"); Diagnose mode adds the technical detail.
  const callError = (label, message, detail) => new Error(`${label} failed: ${message}${settings.diagnoseMode && detail ? ` [${detail}]` : ""}`);

  // ---------------------------------------------------------------- page data

  // Ask youtube-page.js (page world) for the post an element belongs to.
  function resolveFromPage(el) {
    el.removeAttribute("data-md-media");
    el.dispatchEvent(new CustomEvent("md:resolve", { bubbles: true }));
    const raw = el.getAttribute("data-md-media");
    el.removeAttribute("data-md-media");
    const found = raw ? JSON.parse(raw) : null;
    if (found?.error) diag("reading the page data failed", found.error);
    return found?.postId ? found : null;
  }

  // The post's own page is the reference for the exact publish time (the Posts tab only says "7 hours ago") and the
  // image list (posts shown in shelves, e.g. a channel's Home tab, only carry their first image).
  const postPages = new Map();

  // Same shapes as imagesOf in youtube-page.js: one image, several images, or a poll with image choices.
  function imagesOf(attachment) {
    const last = (image) => image?.thumbnails?.at(-1)?.url;
    const urls = attachment?.backstageImageRenderer
      ? [last(attachment.backstageImageRenderer.image)]
      : attachment?.postMultiImageRenderer
        ? attachment.postMultiImageRenderer.images.map((i) => last(i.backstageImageRenderer?.image))
        : (attachment?.pollRenderer?.choices || []).map((c) => last(c.image));
    return urls.filter(Boolean).map((u) => (u.startsWith("//") ? `https:${u}` : u).split("=")[0]);
  }

  // The post renderer for postId in the page's ytInitialData; a reshared post gives its original.
  function postFromInitialData(html, postId) {
    const json = html.match(/var ytInitialData = (\{.*?\});<\/script>/s)?.[1];
    if (!json) return null;
    let found = null;
    const walk = (o) => {
      if (found || !o || typeof o !== "object") return;
      if (o.postId === postId && (o.backstageAttachment || o.originalPost)) return (found = o);
      for (const k in o) walk(o[k]);
    };
    try {
      walk(JSON.parse(json));
    } catch {
      return null;
    }
    return found?.originalPost?.backstagePostRenderer || found?.originalPost?.postRenderer || found;
  }

  async function postPage(postId) {
    if (postPages.has(postId)) return postPages.get(postId);
    diag(`Post page lookup: GET /post/${postId}`);
    const r = await fetch(`/post/${postId}`, { credentials: "include" });
    if (!r.ok) throw callError("Post date lookup", `YouTube returned an error (${r.status}).`, `GET /post/${postId}: HTTP ${r.status}`);
    const html = await r.text();
    const value = (html.match(/"publishDate":"([^"]+)"/) || html.match(/"datePublished":"([^"]+)"/) || [])[1];
    const time = value ? Date.parse(value) : NaN;
    if (Number.isNaN(time)) {
      throw callError("Post date lookup", "the post's page has no publish date. YouTube may have changed it.", `GET /post/${postId}: no "publishDate" or "datePublished" in ${html.length} bytes`);
    }
    const images = imagesOf(postFromInitialData(html, postId)?.backstageAttachment);
    diag(`Post page lookup: ${value}, ${images.length} images`);
    const page = { time, images };
    postPages.set(postId, page);
    return page;
  }

  // ---------------------------------------------------------------- media → files

  // "=d" is the uploaded file itself; "=s<n>" is resized so the longer side is n px.
  const SIZE_OPTIONS = { original: "=d", medium: "=s1280", small: "=s640" };
  const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic" };

  // yt3 serves CORS headers for youtube.com, so the real type can be checked before naming the file.
  async function imageFile(base) {
    const url = base + (SIZE_OPTIONS[settings.imageSize] || SIZE_OPTIONS.original);
    let type = "";
    try {
      type = (await fetch(url, { method: "HEAD" })).headers.get("content-type")?.split(";")[0] || "";
    } catch (err) {
      diag("could not check the image type, assuming jpg", url, err);
    }
    return { url, ext: EXTENSIONS[type] || "jpg" };
  }

  async function filesFor(target) {
    const vars = { username: target.username, website: MDSettings.websiteName(location.hostname) };
    if (target.type !== "post") {
      const file = await imageFile(target.base);
      return [{ url: file.url, filename: MDSettings.buildFilename(settings.filenamePattern, { ...vars, createdDate: target.type }, null, file.ext) }];
    }
    const post = target.post;
    if (!post.images.length) {
      throw new Error(post.attachment === "videoRenderer" || post.attachment === "postUploadedVideoRenderer"
        ? "This post shares a video; only images in posts are saved."
        : "This post has no images.");
    }
    const page = await postPage(post.postId);
    // The post page lists every image; the element's data may only have the first (Home tab shelf).
    const images = page.images.length >= post.images.length ? page.images : post.images;
    if (images.length !== post.images.length) diag(`the post page has ${images.length} images, the element's data ${post.images.length}`);
    const takenAt = Math.floor(page.time / 1000);
    const postVars = { ...vars, username: post.handle || post.name, createdDate: MDSettings.formatDate(page.time) };
    return Promise.all(
      images.map(async (base, i) => {
        const file = await imageFile(base);
        const index = images.length > 1 ? i : null;
        return { url: file.url, filename: MDSettings.buildFilename(settings.filenamePattern, postVars, index, file.ext), takenAt };
      })
    );
  }

  // ---------------------------------------------------------------- downloading + feedback

  async function download(target, btn) {
    if (btn?.dataset.busy) return;
    if (btn) {
      btn.dataset.busy = "1";
      btn.style.opacity = "0.4";
    }
    toast("Downloading…");
    diag("download clicked", { button: btn?.dataset.mdKind, target, page: location.href });
    try {
      const files = await filesFor(target);
      diag("files to save", files);
      const { results, exiftool } = await chrome.runtime.sendMessage({ type: "download", site: SITE_ID, files });
      diag("chrome.downloads started", results, exiftool ? `${exiftool} files will get their date` : "exiftool not used");
      // The verdict comes later, once every file has finished (see the "batchResult" listener below).
      lastButton = btn;
      toast(MDReport.waiting(results.length, exiftool > 0));
    } catch (err) {
      console.error("[mediadownloader]", err);
      toast(err.message || "The download failed. Please try again.", "error");
      flash(btn, "#cc0000");
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
  const TOAST_COLORS = { progress: "#065fd4", success: "#2ba640", warning: "#b26a00", error: "#cc0000" };

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
        font: '14px/18px Roboto, Arial, sans-serif',
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
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 2 20 20" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M7.1 16.9h9.8v-1.65H7.1Zm4.9-3.15 3.8-3.8-1.15-1.15-1.85 1.875V5.95h-1.65v4.675L9.35 8.8 8.2 9.95Zm0 8.05q-2.025 0-3.812-.775-1.788-.775-3.113-2.1-1.325-1.325-2.1-3.113Q2.2 14.025 2.2 12t.775-3.825q.775-1.8 2.1-3.125Q6.4 3.725 8.188 2.962 9.975 2.2 12 2.2t3.825.762q1.8.763 3.125 2.088 1.325 1.325 2.088 3.112Q21.8 9.95 21.8 12t-.762 3.825q-.763 1.775-2.088 3.1-1.325 1.325-3.112 2.1Q14.05 21.8 12 21.8Zm0-1.65q3.425 0 5.788-2.363Q20.15 15.425 20.15 12t-2.362-5.788Q15.425 3.85 12 3.85q-3.425 0-5.787 2.362Q3.85 8.575 3.85 12q0 3.425 2.363 5.787Q8.575 20.15 12 20.15ZM12 12Z"/></svg>';

  const TITLES = { profile: "Download channel picture", banner: "Download channel banner" };

  function makeButton(kind, getTarget, style = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN;
    btn.dataset.mdKind = kind;
    btn.title = TITLES[kind] || "Download images";
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML = ICON;
    Object.assign(btn.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "40px",
      height: "40px",
      padding: "0",
      flexShrink: "0",
      border: "none",
      borderRadius: "50%",
      background: "transparent",
      color: "var(--yt-spec-text-primary, #0f0f0f)",
      cursor: "pointer",
      transition: "transform .15s ease, opacity .15s ease",
      ...style,
    });
    btn.addEventListener("mouseenter", () => (btn.style.transform = "scale(1.12)"));
    btn.addEventListener("mouseleave", () => (btn.style.transform = ""));
    // Posts open their own page and the avatar opens the channel's "About" panel when clicked; keep the click to ourselves.
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "touchstart"]) {
      btn.addEventListener(type, (e) => e.stopPropagation());
    }
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      let target;
      try {
        target = getTarget();
      } catch (err) {
        target = null;
      }
      if (target) download(target, btn);
      else toast("Finding the post failed: no post data on this element. YouTube may have changed this page.", "error");
    });
    return btn;
  }

  // Images in a post: single and multi-image posts use ytd-backstage-image-renderer; polls may have image choices.
  const POST_IMAGES = "ytd-backstage-image-renderer, ytd-backstage-poll-renderer img";

  // Every post has a toolbar: Like, Dislike, Share, Comments. Ours goes after Comments, on posts that show images.
  function injectPosts() {
    for (const post of document.querySelectorAll(POST)) {
      if (post.parentElement?.closest(POST)) continue; // the original inside a reshared post
      if (!post.querySelector(POST_IMAGES)) continue; // text, text-only polls, shared videos
      const toolbar = post.querySelector("ytd-comment-action-buttons-renderer #toolbar");
      if (!toolbar || toolbar.querySelector(`:scope > .${BTN}`)) continue;
      toolbar.append(
        makeButton("post", () => {
          const data = resolveFromPage(toolbar);
          diag("post data", data);
          return data ? { type: "post", post: data } : null;
        })
      );
    }
  }

  // Channel header: badges on the avatar and the banner. Their URLs without size options are the full uploads.
  function injectChannelImages() {
    // YouTube keeps pages visited earlier in the DOM, hidden; only the shown one counts.
    const header = [...document.querySelectorAll("ytd-tabbed-page-header")].find((h) => h.getBoundingClientRect().width > 0);
    const handle = location.pathname.match(/^\/@([^/]+)/)?.[1];
    if (!header || !handle) return;
    const kinds = [
      ["profile", header.querySelector("yt-page-header-renderer yt-avatar-shape img, yt-page-header-renderer yt-decorated-avatar-view-model img")],
      ["banner", header.querySelector("yt-image-banner-view-model img")],
    ];
    for (const [kind, img] of kinds) {
      if (!img?.src || !/yt3\.(ggpht|googleusercontent)\.com/.test(img.src) || img.getBoundingClientRect().width < 60) continue;
      const host = img.parentElement;
      const current = host.querySelector(`:scope > .${BTN}[data-md-kind="${kind}"]`);
      if (current?.dataset.mdUser === handle) continue;
      current?.remove(); // left over from the previous channel after in-app navigation
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      const base = img.src.split("=")[0];
      const btn = makeButton(kind, () => ({ type: kind, username: decodeURIComponent(handle), base }), {
        position: "absolute",
        right: kind === "banner" ? "8px" : "0",
        bottom: kind === "banner" ? "8px" : "0",
        width: "32px",
        height: "32px",
        background: "#fff",
        color: "#0f0f0f",
        zIndex: "2",
        boxShadow: "0 1px 4px rgba(0,0,0,.35)",
      });
      btn.dataset.mdUser = handle;
      btn.querySelector("svg").setAttribute("width", "28");
      btn.querySelector("svg").setAttribute("height", "28");
      host.append(btn);
    }
  }

  // /@handle/posts (also /channel/<id>/posts, /c/…, /user/…, and the old "community" name) and /post/<id>.
  const onPostsPage = () =>
    /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/(posts|community)\/?$/.test(location.pathname) || /^\/post\/[^/]+/.test(location.pathname);

  function injectAll() {
    if (!enabled()) return;
    // YouTube navigates without reloading, so leaving the Posts pages must take the buttons away again.
    if (!onPostsPage()) return removeAll();
    injectPosts();
    injectChannelImages();
  }

  function removeAll() {
    document.querySelectorAll(`.${BTN}`).forEach((b) => b.remove());
  }

  // ---------------------------------------------------------------- start

  // A timer rather than requestAnimationFrame: rAF is paused in background tabs, so tabs opened in the
  // background would get no buttons until shown.
  let queued = 0;
  const observer = new MutationObserver(() => {
    if (!queued) queued = setTimeout(() => ((queued = 0), injectAll()), 150);
  });

  // The background worker reports once every file of a click has finished: how many were saved, which failed,
  // and how many got their date. The toast says "Downloading…" until then.
  let lastButton = null;
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "batchResult") return;
    diag("batch result", msg);
    const { kind, text } = MDReport.summary(msg);
    toast(text, kind);
    flash(lastButton, { success: "#2ba640", warning: "#b26a00", error: "#cc0000" }[kind]);
  });

  chrome.storage.onChanged.addListener(async (_changes, area) => {
    if (area !== "sync") return;
    settings = await MDSettings.load();
    if (enabled()) injectAll();
    else removeAll();
  });

  MDSettings.load().then((loaded) => {
    settings = loaded;
    observer.observe(document.body, { childList: true, subtree: true });
    injectAll();
  });
})();
