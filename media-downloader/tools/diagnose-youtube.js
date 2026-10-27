// mediadownloader: YouTube posts health check.
//
// Run it when YouTube post downloads stop working, to see which piece YouTube changed:
//   1. Open a channel's Posts tab on youtube.com that has image posts (e.g. https://www.youtube.com/@MrBeast/posts),
//      in the browser where mediadownloader is installed.
//   2. Press F12 → Console, paste this whole file, press Enter.
//   3. Read the table. FAIL rows say what broke; context.md → "When YouTube changes something" says what to do.
//
// Legend: PASS = works. FAIL = broken, needs action. SKIP = not checked, the page has nothing to test it with.
// INFO = information, or normal on some pages.
//
// It only reads (GET/HEAD requests); nothing is downloaded, clicked or changed, and no settings are touched. The
// function returns the rows, so a script can read them (CDP Runtime.evaluate with awaitPromise).
// The constants below are copies from sites/youtube.js; keep them in sync.
(async () => {
  // keep in sync with sites/youtube.js:9 (POST) and :257 (POST_IMAGES)
  const POST = "ytd-backstage-post-renderer, ytd-post-renderer, ytd-shared-post-renderer";
  const POST_IMAGES = "ytd-backstage-image-renderer, ytd-backstage-poll-renderer img";
  // keep in sync with sites/youtube.js:313-314 (onPostsPage)
  const onPostsPage = /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/(posts|community)\/?$/.test(location.pathname) || /^\/post\/[^/]+/.test(location.pathname);

  const rows = [];
  const add = (check, result, detail = "") => rows.push({ check, result, detail: String(detail).slice(0, 160) });
  // One failing check never aborts the table.
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (err) {
      add(name, "FAIL", err.message);
    }
  };
  // GET with a timeout. Resolves { status, ok, text, json, notJson }; rejects with "timed out after 10 s" or the network error.
  const getJSON = async (url, init = {}, ms = 10000) => {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
      const text = await r.text();
      let json = null;
      let notJson = false;
      try {
        json = JSON.parse(text);
      } catch {
        notJson = text.length > 0;
      }
      return { status: r.status, ok: r.ok, type: r.headers.get("content-type"), text, json, notJson };
    } catch (err) {
      throw new Error(err?.name === "TimeoutError" ? `timed out after ${ms / 1000} s` : err.message);
    }
  };
  const countBy = (els, attr) => els.reduce((acc, e) => ({ ...acc, [e.dataset[attr]]: (acc[e.dataset[attr]] || 0) + 1 }), {});

  // ---- page and extension
  add("Page", "INFO", `${location.hostname}${location.pathname}${onPostsPage ? "" : " (not a channel's Posts tab or a /post/ page, so no buttons are expected here)"}`);
  add("Chrome version", "INFO", navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || "unknown");
  const allButtons = [...document.querySelectorAll(".md-download-btn")];
  add("mediadownloader active in this tab", allButtons.length ? "PASS" : "INFO",
    allButtons.length ? `${allButtons.length} buttons ${JSON.stringify(countBy(allButtons, "mdKind"))}` : "no buttons: extension not loaded, site disabled in Settings, or page not supported");

  // ---- page data (what sites/youtube-page.js reads)
  const posts = [...document.querySelectorAll(POST)];
  add("Post elements", posts.length ? "PASS" : onPostsPage ? "FAIL" : "SKIP", posts.length ? `${posts.length} posts` : `no ${POST}; open a channel's Posts tab`);
  const datas = posts.map((p) => p.data || p.__data?.data).filter(Boolean);
  add("Post data on the elements", datas.length ? "PASS" : posts.length ? "FAIL" : "SKIP",
    datas.length ? `keys: ${Object.keys(datas[0]).slice(0, 8).join(", ")}` : "elements have no .data; youtube-page.js cannot read posts");
  const kinds = datas.reduce((acc, d) => {
    const k = Object.keys(d.backstageAttachment || {})[0] || (d.originalPost ? "shared post" : "no attachment");
    return { ...acc, [k]: (acc[k] || 0) + 1 };
  }, {});
  add("Attachment types", Object.keys(kinds).some((k) => /ImageRenderer/.test(k)) ? "PASS" : datas.length ? "FAIL" : "SKIP",
    JSON.stringify(kinds) + (Object.keys(kinds).some((k) => /ImageRenderer/.test(k)) ? "" : " (no backstageImageRenderer / postMultiImageRenderer; renamed?)"));

  const withImage = datas.find((d) => d.backstageAttachment?.backstageImageRenderer || d.backstageAttachment?.postMultiImageRenderer);
  const attachment = withImage?.backstageAttachment;
  const thumb = (attachment?.backstageImageRenderer || attachment?.postMultiImageRenderer?.images?.[0]?.backstageImageRenderer)?.image?.thumbnails?.at(-1)?.url;
  add("Image URL", thumb ? "PASS" : withImage ? "FAIL" : "SKIP", thumb || (withImage ? "no image.thumbnails[].url in the attachment" : "no image post loaded"));
  const handle = (withImage?.authorEndpoint?.browseEndpoint?.canonicalBaseUrl || "").match(/^\/@([^/?]+)/)?.[1];
  add("Author handle", handle ? "PASS" : withImage ? "FAIL" : "SKIP", handle || "no authorEndpoint.browseEndpoint.canonicalBaseUrl like /@handle (the display name is used instead)");

  // ---- CDN: "=d" is the original file; CORS lets the content script read its type
  if (thumb) {
    await step("Original image (=d)", async () => {
      const base = (thumb.startsWith("//") ? `https:${thumb}` : thumb).split("=")[0];
      try {
        const r = await getJSON(`${base}=d`, { method: "HEAD" });
        add("Original image (=d)", r.ok ? "PASS" : "FAIL", `HTTP ${r.status}, ${r.type}`);
      } catch (err) {
        if (/timed out/.test(err.message)) throw err;
        add("Original image (=d)", "FAIL", `${err.message} (CORS blocked? then the file type cannot be checked and .jpg is assumed)`);
      }
    });
  } else add("Original image (=d)", "SKIP", "no image post loaded");

  // ---- exact publish date from the post's own page
  if (withImage?.postId) {
    await step("Post date lookup", async () => {
      const r = await getJSON(`/post/${encodeURIComponent(withImage.postId)}`, { credentials: "include" });
      const date = (r.text.match(/"publishDate":"([^"]+)"/) || r.text.match(/"datePublished":"([^"]+)"/) || [])[1];
      add("Post date lookup", date && !Number.isNaN(Date.parse(date)) ? "PASS" : "FAIL",
        date ? `${date} (feed says "${withImage.publishedTimeText?.runs?.[0]?.text || "?"}")` : `HTTP ${r.status}, no "publishDate" or "datePublished" in the post page`);
    });
  } else add("Post date lookup", "SKIP", "no image post loaded");

  // ---- placement
  // The buttons go on posts that show images (not on a post nested in a reshared one), in the toolbar after Comments.
  const imagePosts = posts.filter((p) => !p.parentElement?.closest(POST) && p.querySelector(POST_IMAGES));
  add("Image elements in posts", imagePosts.length ? "PASS" : posts.length ? "INFO" : "SKIP",
    imagePosts.length ? `${imagePosts.length} of ${posts.length} posts contain ${POST_IMAGES}` : `no post contains ${POST_IMAGES} (text posts only, or YouTube renamed the image element)`);
  const toolbarOf = (p) => p.querySelector("ytd-comment-action-buttons-renderer #toolbar");
  const toolbarPost = imagePosts.find(toolbarOf);
  add("Post toolbar", toolbarPost ? "PASS" : imagePosts.length ? "FAIL" : "SKIP",
    toolbarPost ? "" : imagePosts.length ? "no ytd-comment-action-buttons-renderer #toolbar in an image post; post buttons will be missing" : "no image post loaded");
  const header = [...document.querySelectorAll("ytd-tabbed-page-header")].find((h) => h.getBoundingClientRect().width > 0);
  const avatar = header?.querySelector("yt-page-header-renderer yt-avatar-shape img, yt-page-header-renderer yt-decorated-avatar-view-model img");
  const banner = header?.querySelector("yt-image-banner-view-model img");
  add("Channel avatar element", avatar?.src ? "PASS" : "INFO", avatar?.src || "not found (fine if this is not a channel page)");
  add("Channel banner element", banner?.src ? "PASS" : "INFO", banner?.src || "not found (some channels have no banner)");

  // Buttons only appear on a channel's Posts tab and on /post/<id> (see onPostsPage in sites/youtube.js).
  const withButton = imagePosts.filter((p) => p.querySelector(".md-download-btn"));
  add("mediadownloader post buttons", !onPostsPage || !imagePosts.length ? "SKIP" : withButton.length === imagePosts.length ? "PASS" : "FAIL",
    !onPostsPage ? "not a Posts page" : imagePosts.length ? `${withButton.length} of ${imagePosts.length} image posts have a button; kinds ${JSON.stringify(countBy(allButtons, "mdKind"))}` : "no image post loaded");

  // ---- summary
  console.table(rows);
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.result]: (acc[r.result] || 0) + 1 }), {});
  const failed = rows.filter((r) => r.result === "FAIL").map((r) => r.check);
  console.log(`mediadownloader YouTube health check: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}.` +
    (failed.length ? `\nFailed: ${failed.join("; ")}\nSee context.md → "When YouTube changes something". Reload the extension and the tab, then run again.` : ""));
  return rows;
})();
