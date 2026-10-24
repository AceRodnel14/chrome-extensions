// mediadownloader: YouTube posts health check.
//
// Run it when YouTube post downloads stop working, to see which piece YouTube changed:
//   1. Open a channel's Posts tab on youtube.com that has image posts (e.g. https://www.youtube.com/@MrBeast/posts),
//      in the browser where mediadownloader is installed.
//   2. Press F12 → Console, paste this whole file, press Enter.
//   3. Read the table. FAIL rows say what broke; context.md → "When YouTube changes something" says what to do.
//
// It only reads; nothing is downloaded and no settings are changed.
(async () => {
  const POST = "ytd-backstage-post-renderer, ytd-post-renderer, ytd-shared-post-renderer";
  const rows = [];
  const add = (check, result, detail = "") => rows.push({ check, result, detail: String(detail).slice(0, 160) });

  // ---- page data (what sites/youtube-page.js reads)
  const posts = [...document.querySelectorAll(POST)];
  add("Post elements", posts.length ? "PASS" : "FAIL", posts.length ? `${posts.length} posts` : `no ${POST}; open a channel's Posts tab`);
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
    const base = (thumb.startsWith("//") ? `https:${thumb}` : thumb).split("=")[0];
    try {
      const r = await fetch(`${base}=d`, { method: "HEAD" });
      add("Original image (=d)", r.ok ? "PASS" : "FAIL", `HTTP ${r.status}, ${r.headers.get("content-type")}`);
    } catch (err) {
      add("Original image (=d)", "FAIL", `${err.message} (CORS blocked? then the file type cannot be checked and .jpg is assumed)`);
    }
  } else add("Original image (=d)", "SKIP", "no image post loaded");

  // ---- exact publish date from the post's own page
  if (withImage?.postId) {
    try {
      const r = await fetch(`/post/${withImage.postId}`, { credentials: "include" });
      const html = await r.text();
      const date = (html.match(/"publishDate":"([^"]+)"/) || html.match(/"datePublished":"([^"]+)"/) || [])[1];
      add("Post date lookup", date && !Number.isNaN(Date.parse(date)) ? "PASS" : "FAIL",
        date ? `${date} (feed says "${withImage.publishedTimeText?.runs?.[0]?.text || "?"}")` : `HTTP ${r.status}, no "publishDate" or "datePublished" in the post page`);
    } catch (err) {
      add("Post date lookup", "FAIL", err.message);
    }
  } else add("Post date lookup", "SKIP", "no image post loaded");

  // ---- placement
  const toolbar = posts[0]?.querySelector("ytd-comment-action-buttons-renderer #toolbar");
  add("Post toolbar", toolbar ? "PASS" : posts.length ? "FAIL" : "SKIP", toolbar ? "" : "no ytd-comment-action-buttons-renderer #toolbar in the post; post buttons will be missing");
  const header = [...document.querySelectorAll("ytd-tabbed-page-header")].find((h) => h.getBoundingClientRect().width > 0);
  const avatar = header?.querySelector("yt-page-header-renderer yt-avatar-shape img, yt-page-header-renderer yt-decorated-avatar-view-model img");
  const banner = header?.querySelector("yt-image-banner-view-model img");
  add("Channel avatar element", avatar?.src ? "PASS" : "INFO", avatar?.src || "not found (fine if this is not a channel page)");
  add("Channel banner element", banner?.src ? "PASS" : "INFO", banner?.src || "not found (some channels have no banner)");

  // Buttons only appear on a channel's Posts tab and on /post/<id> (see onPostsPage in sites/youtube.js).
  const onPostsPage = /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/(posts|community)\/?$/.test(location.pathname) || /^\/post\/[^/]+/.test(location.pathname);
  add("Posts page", onPostsPage ? "PASS" : "INFO", onPostsPage ? location.pathname : `${location.pathname} is not a Posts tab or /post/ page, so no buttons are expected here; open the channel's Posts tab`);
  const buttons = document.querySelectorAll(".md-download-btn");
  const byKind = [...buttons].reduce((acc, b) => ({ ...acc, [b.dataset.mdKind]: (acc[b.dataset.mdKind] || 0) + 1 }), {});
  add("mediadownloader buttons", buttons.length ? "PASS" : onPostsPage ? "FAIL" : "SKIP", buttons.length ? JSON.stringify(byKind) : "none: extension not loaded in this tab, YouTube disabled in Settings, or placement rules no longer match");

  console.table(rows);
  const failed = rows.filter((r) => r.result === "FAIL");
  console.log(failed.length ? `${failed.length} problem(s): see context.md → "When YouTube changes something".` : "Everything mediadownloader needs from YouTube works.");
})();
