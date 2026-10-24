// mediadownloader: Reddit support.
// Adds a download button to posts whose media Reddit hosts itself (i.redd.it images and GIFs, galleries, v.redd.it
// videos, and crossposts of those), in feeds and on post pages. Link posts to other sites get no button.
// File lists come from Reddit's own JSON (/by_id/<id>.json); videos use the "packaged" mp4 the page's player
// carries, because Reddit's plain video files have no sound.
(() => {
  const SITE_ID = "reddit";
  const BTN = "md-download-btn";

  // Domains a post's media must come from (crossposts report their original's domain).
  const HOSTED = new Set(["i.redd.it", "v.redd.it", "reddit.com", "www.reddit.com"]);
  const MEDIA_TYPES = new Set(["image", "gallery", "video", "gif", "crosspost"]);

  let settings = MDSettings.DEFAULTS;
  const enabled = () => settings.sites[SITE_ID] !== false;

  // Diagnose mode only: explain every call in the console.
  const diag = (...args) => settings.diagnoseMode && console.info("[mediadownloader:diagnose]", ...args);

  // Errors name the call that failed ("Post lookup failed: …"); Diagnose mode adds the technical detail.
  const callError = (label, message, detail) => new Error(`${label} failed: ${message}${settings.diagnoseMode && detail ? ` [${detail}]` : ""}`);

  // ---------------------------------------------------------------- data

  async function getPost(id) {
    const path = `/by_id/${id}.json?raw_json=1`;
    diag(`Post lookup: GET ${path}`);
    const r = await fetch(path, { credentials: "include" });
    if (r.status === 429) throw callError("Post lookup", "Reddit is rate limiting requests. Wait a minute and try again.", "HTTP 429");
    if (!r.ok) throw callError("Post lookup", `Reddit returned an error (${r.status}).`, `GET ${path}: HTTP ${r.status}`);
    let json;
    try {
      json = await r.json();
    } catch {
      throw callError("Post lookup", "Reddit returned something that is not data.", `GET ${path}: not JSON`);
    }
    const post = json?.data?.children?.[0]?.data;
    if (!post) throw callError("Post lookup", "Reddit did not return this post.", `GET ${path}: no data.children[0].data`);
    diag("Post lookup: OK", post);
    return post;
  }

  // The player's packaged-media-json lists mp4s with picture and sound: { playbackMp4s: { permutations: [{ source }] } }.
  function packagedFromAttribute(value) {
    try {
      return (JSON.parse(value)?.playbackMp4s?.permutations || []).map((p) => p.source).filter((s) => s?.url);
    } catch {
      return [];
    }
  }

  // From the post's player on screen, else from the post's own page (the player is in its HTML).
  async function packagedMp4s(postEl, permalink) {
    const attr = postEl?.querySelector("shreddit-player[packaged-media-json], shreddit-player-2[packaged-media-json]")?.getAttribute("packaged-media-json");
    if (attr) return packagedFromAttribute(attr);
    diag(`no player on screen; reading ${permalink} for its packaged mp4s`);
    const html = await (await fetch(permalink, { credentials: "include" })).text();
    const raw = html.match(/packaged-media-json="([^"]+)"/)?.[1];
    if (!raw) return [];
    const decoded = new DOMParser().parseFromString(`<i x="${raw}"></i>`, "text/html").body.firstChild.getAttribute("x");
    return packagedFromAttribute(decoded);
  }

  // ---------------------------------------------------------------- media → files

  const extOf = (url, fallback) => (url.split("?")[0].match(/\.(jpe?g|png|gif|webp|mp4)$/i)?.[1].toLowerCase().replace("jpeg", "jpg")) || fallback;

  // Images and GIFs are always the uploaded file: Reddit's smaller previews are cropped ("crop=smart") and their
  // format depends on what the browser accepts. The size setting applies to videos only.
  const imageFile = (original) => ({ url: original, ext: extOf(original, "jpg") });

  function pickVideo(sources) {
    const list = [...sources].sort((a, b) => (a.bitrateBps || 0) - (b.bitrateBps || 0));
    if (settings.imageSize === "small") return list[0];
    if (settings.imageSize === "medium") return list[Math.floor((list.length - 1) / 2)];
    return list.at(-1);
  }

  // Every file of a post, in order: [{ url, ext }]. `skipped` counts gallery items that could not be saved.
  async function mediaOf(post, postEl) {
    if (post.is_gallery) {
      const files = [];
      let skipped = 0;
      for (const item of post.gallery_data?.items || []) {
        const meta = post.media_metadata?.[item.media_id];
        if (!meta || meta.status !== "valid") {
          skipped++;
          continue;
        }
        if (meta.e === "Image") {
          // i.redd.it only serves the extension the file was uploaded with ("image/jpg" → .jpg, "image/jpeg" → .jpeg).
          const ext = (meta.m || "image/jpeg").split("/")[1];
          files.push(imageFile(`https://i.redd.it/${item.media_id}.${ext}`));
        } else if (meta.e === "AnimatedImage" && (meta.s?.gif || meta.s?.mp4)) {
          files.push(meta.s.gif ? { url: `https://i.redd.it/${item.media_id}.gif`, ext: "gif" } : { url: meta.s.mp4, ext: "mp4" });
        } else skipped++; // e.g. videos inside a gallery: Reddit gives no file with sound for them
      }
      return { files, skipped };
    }
    const video = post.secure_media?.reddit_video || post.media?.reddit_video;
    if (post.is_video && video) {
      const sources = await packagedMp4s(postEl, post.permalink);
      if (sources.length) {
        const pick = pickVideo(sources);
        return { files: [{ url: pick.url, ext: "mp4" }], skipped: 0 };
      }
      // A GIF converted to video has no sound anyway, so the plain file is complete.
      if (!video.has_audio || video.is_gif) return { files: [{ url: video.fallback_url, ext: "mp4" }], skipped: 0 };
      throw callError("Finding the video", "Reddit gave no version of this video with sound.", "no packaged-media-json on the player or the post page");
    }
    if (/^https:\/\/i\.redd\.it\//.test(post.url_overridden_by_dest || post.url || "")) {
      const original = post.url_overridden_by_dest || post.url;
      return { files: [imageFile(original)], skipped: 0 };
    }
    return { files: [], skipped: 0 };
  }

  async function filesFor(target) {
    let post = await getPost(target.id);
    // Files are named after the subreddit the clicked post is in; for a crosspost that is where it was shared to.
    const subreddit = post.subreddit;
    // A crosspost shows, and should save, the original post's files (with the original's date).
    if (post.crosspost_parent_list?.length) post = post.crosspost_parent_list[0];
    const { files, skipped } = await mediaOf(post, target.el);
    if (!files.length) throw new Error("This post has no photos or videos hosted on Reddit.");
    const takenAt = Math.floor(post.created_utc) || null;
    const vars = {
      username: subreddit || post.subreddit || post.author || "",
      createdDate: MDSettings.formatDate(takenAt ? takenAt * 1000 : null),
      website: MDSettings.websiteName(location.hostname),
    };
    return {
      skipped,
      files: files.map((f, i) => ({
        url: f.url,
        filename: MDSettings.buildFilename(settings.filenamePattern, vars, files.length > 1 ? i : null, f.ext),
        takenAt, // post time in Unix seconds, for the exiftool helper
      })),
    };
  }

  // ---------------------------------------------------------------- downloading + feedback

  async function download(target, btn) {
    if (btn?.dataset.busy) return;
    if (btn) {
      btn.dataset.busy = "1";
      btn.style.opacity = "0.4";
    }
    toast("Downloading…");
    diag("download clicked", { target: { id: target.id }, page: location.href });
    try {
      const { files, skipped } = await filesFor(target);
      diag("files to save", files, skipped ? `${skipped} gallery items skipped` : "");
      const { results, exiftool } = await chrome.runtime.sendMessage({ type: "download", site: SITE_ID, files });
      diag("chrome.downloads started", results, exiftool ? `${exiftool} files will get their date` : "exiftool not used");
      // The verdict comes later, once every file has finished (see the "batchResult" listener below).
      reportNote = skipped ? ` ${skipped} gallery item${skipped === 1 ? "" : "s"} could not be saved.` : "";
      lastButton = btn;
      toast(MDReport.waiting(results.length, exiftool > 0) + reportNote);
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

  function makeButton(getTarget) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN;
    btn.dataset.mdKind = "post";
    btn.title = "Download";
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML = ICON;
    Object.assign(btn.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "32px",
      height: "32px",
      marginLeft: "8px",
      padding: "0",
      flexShrink: "0",
      border: "none",
      borderRadius: "999px",
      background: "var(--color-button-secondary-background, #e5ebee)",
      color: "var(--color-button-secondary-text, #0f1a1c)",
      cursor: "pointer",
      transition: "transform .15s ease, opacity .15s ease",
    });
    btn.addEventListener("mouseenter", () => (btn.style.transform = "scale(1.08)"));
    btn.addEventListener("mouseleave", () => (btn.style.transform = ""));
    // A click anywhere on a feed post opens it; keep the click to ourselves.
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "touchstart"]) {
      btn.addEventListener(type, (e) => e.stopPropagation());
    }
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      download(getTarget(), btn);
    });
    return btn;
  }

  // Posts render their action row (votes, comments, share) in a shadow root filled through named slots; ours joins it
  // as a child of the post assigned to the free slot at the end of the row.
  const SLOT = "action-row-whitespace";

  function injectPosts() {
    for (const post of document.querySelectorAll("shreddit-post")) {
      if (post.querySelector(`:scope > .${BTN}`)) continue;
      const type = post.getAttribute("post-type");
      const domain = (post.getAttribute("domain") || "").toLowerCase();
      if (!MEDIA_TYPES.has(type) || !HOSTED.has(domain) || !/^t3_/.test(post.id)) continue;
      if (post.querySelector(`:scope > [slot="${SLOT}"]`)) continue; // slot already taken by Reddit
      const btn = makeButton(() => ({ id: post.id, el: post }));
      btn.slot = SLOT;
      post.append(btn);
    }
  }

  function injectAll() {
    if (!enabled()) return;
    injectPosts();
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
  let reportNote = ""; // e.g. gallery items that could not be saved, added to the final message
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "batchResult") return;
    diag("batch result", msg);
    const { kind, text } = MDReport.summary(msg);
    toast(text + (kind === "error" ? "" : reportNote), kind);
    flash(lastButton, { success: "#0a7d2c", warning: "#b26a00", error: "#d93900" }[kind]);
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
