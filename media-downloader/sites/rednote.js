// mediadownloader: RedNote (rednote.com) support.
// Adds a download button to every post tile on a user's profile, to the opened post (/discovery/item/<id>) and to the
// profile picture. There is no feed, bulk or "download all" mode: one click saves one post.
// A tile click opens the post like a normal click (a.cover), then waits until RedNote's own page has the post's data in
// window.__INITIAL_STATE__ (read by rednote-page.js, page world). Nothing is fetched, prefetched, retried or signed, and
// RedNote's API is never called. The description-date option does not apply here (MDSettings.postTime is never used).
(() => {
  const SITE_ID = "rednote";
  const BTN = "md-download-btn";

  // ---------------------------------------------------------------- pure helpers (unit-tested)

  const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/gif": "gif", "image/avif": "avif" };
  const extOfUrl = (url, fallback) => (url.split("?")[0].match(/\.(jpe?g|png|gif|webp|heic|avif)$/i)?.[1].toLowerCase().replace("jpeg", "jpg")) || fallback;

  // Hosts the page's media URLs may point to (never anything else).
  const CDN_HOST = /^([a-z0-9-]+\.)+(rednotecdn\.com|xhscdn\.com)$/i;
  // The original-image path under https://ci.xiaohongshu.com/ (a fileId from the page state has this exact shape).
  const ORIGINAL_PATH = /^(?:[a-z0-9_-]{1,20}\/){0,2}[A-Za-z0-9_-]{8,80}$/; // e.g. oss-sg/notes/<id>, oss-sg/notes_pre_post/<id>, notes_pre_post/<id>, <id>: no dots, no "..", no leading slash

  // A media URL from the page → https URL on an allow-listed CDN host, else null. http is upgraded to https (the CDN
  // serves both; checked on sns-web-*.rednotecdn.com).
  function safeMediaUrl(url) {
    if (typeof url !== "string" || url.length > 2000) return null;
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || u.port) return null;
    if (!CDN_HOST.test(u.hostname)) return null;
    u.protocol = "https:";
    return u.href;
  }

  // https://sns-web-i10.rednotecdn.com/<stamp>/<sig>/<path>!<suffix> → "<path>" (null when it does not look like that).
  function pathOfUrlDefault(url) {
    const safe = safeMediaUrl(url);
    const m = safe && /^\/\d+\/[0-9a-f]+\/([^!?#]+)/.exec(new URL(safe).pathname);
    return m && ORIGINAL_PATH.test(m[1]) ? m[1] : null;
  }

  // The original's URL for one photo: fileId first (when valid), else the path inside urlDefault. null if neither fits.
  function originalUrl(img) {
    const path = ORIGINAL_PATH.test(img?.fileId || "") ? img.fileId : pathOfUrlDefault(img?.urlDefault);
    return path ? `https://ci.xiaohongshu.com/${path}` : null;
  }

  // Smaller file RedNote itself shows (1080 px WebP), used only when the original is missing.
  const fallbackUrl = (img) => safeMediaUrl(img?.wbDft) || safeMediaUrl(img?.urlDefault);

  // Stream keys are obfuscated (EF4, EF5, ...) and may change: take the first non-empty list (cover excluded: the
  // caller passes a stream, never a cover image).
  function streamUrl(stream) {
    const entry = Object.values(stream || {}).find((list) => Array.isArray(list) && list.length)?.[0];
    return safeMediaUrl(entry?.masterUrl) || safeMediaUrl(entry?.backupUrls?.[0]);
  }

  // File type from the first bytes (the CDN says application/octet-stream), else a specific image Content-Type, else jpg.
  function sniffExt(head, contentType) {
    const b = Array.isArray(head) ? head : [];
    const at = (i, text) => [...text].every((c, k) => b[i + k] === c.charCodeAt(0));
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
    if (b[0] === 0x89 && at(1, "PNG")) return "png";
    if (at(0, "RIFF") && at(8, "WEBP")) return "webp";
    if (at(0, "GIF8")) return "gif";
    if (at(4, "ftyp")) {
      const brand = String.fromCharCode(...b.slice(8, 12));
      if (["heic", "heix", "mif1"].includes(brand)) return "heic";
      if (brand === "avif") return "avif";
    }
    return EXTENSIONS[(contentType || "").split(";")[0].trim().toLowerCase()] || "jpg";
  }

  // The page-world reply is untrusted text. Returns the note (only the fields we use, URLs not yet checked), null while
  // the page has no photos/video yet, and throws a plain Error for a reply that cannot be right.
  function parseReply(raw, noteId, uid) {
    let r;
    try {
      r = JSON.parse(raw);
    } catch {
      throw new Error("unreadable reply");
    }
    if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error("unexpected reply");
    if (typeof r.error === "string") return null; // not in the page state yet
    if (r.noteId !== noteId) throw new Error("reply is for another post");
    if (r.type === "") return null; // the page has only a stub of the post so far
    if (r.type !== "normal" && r.type !== "video") throw new Error(`unsupported post type ${JSON.stringify(r.type)}`);
    const imageList = Array.isArray(r.imageList) ? r.imageList.slice(0, 100).filter((i) => i && typeof i === "object") : [];
    const stream = r.video?.stream && typeof r.video.stream === "object" ? r.video.stream : {};
    if (r.type === "video" ? !streamUrl(stream) : !imageList.length) return null; // photos/video not loaded yet
    // RedNote first shows a partial post (one photo, no time) and fills in the rest a moment later: the post time is
    // the sign that the data is complete. Waiting for it also avoids saving too few photos.
    if (typeof r.time !== "number" || !Number.isFinite(r.time)) return null;
    const userId = r.user?.userId;
    if (typeof userId !== "string" || !userId) throw new Error("reply has no author");
    if (uid && userId !== uid) throw new Error(`this post belongs to another account than the profile on screen (post by ${userId}, profile ${uid})`);
    return { noteId, type: r.type, time: r.time, userId, imageList, stream };
  }

  // steps: [{ img } | { clip }]; originals: original URL (or null) per step; reply: the rednoteProbe answer (results are for
  // the non-null originals, in order). Returns [{ url, ext }]: the original with the sniffed type, the smaller file when the
  // original is missing, a live photo's clip as mp4. When the probe got no answer the originals are assumed to be jpg.
  function mapProbe(steps, originals, reply, log = () => {}, fail = (detail) => new Error(`Photo lookup failed: ${detail}`)) {
    const results = reply?.ok ? reply.results || [] : [];
    let p = 0;
    return steps.map((s, i) => {
      if (s.clip) return { url: s.clip, ext: "mp4" };
      const original = originals[i];
      const result = original ? (reply?.ok ? results[p++] : { status: 200, head: [], contentType: "" }) : null;
      if (result?.status === 200) return { url: original, ext: sniffExt(result.head, result.contentType) };
      const fallback = fallbackUrl(s.img);
      if (!fallback) throw fail(`${original || "no original URL"}: HTTP ${result?.status ?? "-"}`);
      log(`original ${original || "(none)"} not available (HTTP ${result?.status ?? "-"}); using RedNote's smaller version`);
      return { url: fallback, ext: extOfUrl(fallback, "webp") };
    });
  }

  const helpers = { mapProbe, safeMediaUrl, pathOfUrlDefault, originalUrl, fallbackUrl, streamUrl, sniffExt, parseReply };
  // Unit tests load this file with a `module` object; a content script has none.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = helpers;
    return;
  }

  let settings = MDSettings.DEFAULTS;
  const enabled = () => settings.sites[SITE_ID] !== false;

  // Diagnose mode only: explain every call in the console.
  const diag = (...args) => settings.diagnoseMode && console.info("[mediadownloader:diagnose]", ...args);

  // Errors name the call that failed ("Note lookup failed: …"); Diagnose mode adds the technical detail.
  const callError = (label, message, detail) => new Error(`${label} failed: ${message}${settings.diagnoseMode && detail ? ` [${detail}]` : ""}`);

  // ---------------------------------------------------------------- data

  // window.__INITIAL_STATE__ is JavaScript, not JSON: Set([...]) and undefined have to become JSON first.
  // Parsed with JSON.parse only (no eval); the fetched HTML is never put into the page.
  function parseState(html) {
    const raw = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/)?.[1];
    if (!raw) return null;
    try {
      return JSON.parse(raw.replace(/new Set\(\[([^\]]*)\]\)/g, "[$1]").replace(/([:[,])undefined(?=[,}\]])/g, "$1null"));
    } catch {
      return null;
    }
  }

  // Vue refs in the state: { __v_isRef: true, _value }.
  const unref = (v) => (v && typeof v === "object" && v.__v_isRef ? v._value : v);

  // The state the server put in this tab's own page (it goes stale after in-app navigation, so callers check ids).
  function pageState() {
    const script = [...document.scripts].find((s) => s.textContent.includes("window.__INITIAL_STATE__"));
    return script ? parseState(`${script.textContent}</script>`) : null;
  }

  // basicInfo of the profile in the page state, only when the state is for profile `uid`. basicInfo has no user id of
  // its own, but the profile's post cards in the same state do (user.notes[tab][i].noteCard.user.userId).
  function basicInfoFor(uid) {
    const user = unref(pageState()?.user);
    const cards = (unref(user?.notes) || []).flat();
    if (!uid || !cards.some((c) => c?.noteCard?.user?.userId === uid)) return null;
    return unref(unref(unref(user?.userPageData)?.basicInfo)) || null;
  }

  // The profile's RedNote ID (the username in file names). The DOM shows the profile on screen; the page state is only
  // used when it describes that same profile. NEVER state.user.userInfo: that is the viewer's own account.
  function redIdOf(uid) {
    const fromDom = document.querySelector(".user-redId")?.textContent.replace(/^\s*rednote\s*ID\s*[:：]?\s*/i, "").trim();
    if (fromDom) return fromDom;
    const basic = basicInfoFor(uid);
    if (basic?.redId) return basic.redId;
    throw callError("Profile lookup", "no RedNote ID on this page.", `no .user-redId and the page state is not for profile ${uid}`);
  }

  // The profile on screen: from the address, else from the post links of its tiles (the modal changes the address).
  function profileUid() {
    const fromPath = location.pathname.match(/^\/user\/profile\/([0-9a-f]+)/)?.[1];
    if (fromPath) return fromPath;
    return document.querySelector("section.note-item a.cover")?.getAttribute("href")?.match(/\/user\/profile\/([0-9a-f]+)/)?.[1] || null;
  }

  // Ask rednote-page.js (page world) for the opened post's data; null while it is not there yet.
  function readNote(noteId, uid) {
    const el = document.documentElement;
    el.removeAttribute("data-md-note");
    el.setAttribute("data-md-want", noteId);
    el.dispatchEvent(new CustomEvent("md:rednote-note", { bubbles: true }));
    const raw = el.getAttribute("data-md-note");
    el.removeAttribute("data-md-note");
    el.removeAttribute("data-md-want");
    if (!raw) return null;
    try {
      return parseReply(raw, noteId, uid);
    } catch (err) {
      throw callError("Note lookup", err.message, `${noteId}: ${raw.slice(0, 200)}`);
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CAPTCHA = "RedNote asked for a security check (captcha): solve it in this tab, then click again.";

  // Wait (poll every 250 ms, 10 s at most) until the page state has the post. Never clicks again, never solves a captcha.
  async function waitForNote(noteId, uid) {
    for (let waited = 0; waited <= 10000; waited += 250) {
      if (location.pathname.startsWith("/website-login/")) throw new Error(CAPTCHA);
      const note = readNote(noteId, uid);
      if (note) return note;
      await sleep(250);
    }
    if (location.pathname.startsWith("/website-login/")) throw new Error(CAPTCHA);
    throw callError("Note lookup", "the post did not load in time", `${noteId} at ${location.href}`);
  }

  // ---------------------------------------------------------------- media → files

  // Every file of a note, in order: [{ url, ext }]. Photos are the original upload (ci.xiaohongshu.com/<path>); their
  // type is sniffed from the first bytes, read by the background worker (one message for the whole note).
  async function filesOf(note) {
    if (note.type === "video") {
      const clip = streamUrl(note.stream);
      if (!clip) throw callError("Video lookup", "RedNote returned no video file for this post.", `${note.noteId}: no video stream masterUrl`);
      return [{ url: clip, ext: "mp4" }]; // imageList[0] is only the cover
    }
    const steps = []; // photos, each live photo followed by its clip
    for (const img of note.imageList) {
      steps.push({ img });
      const live = img.livePhoto === true ? streamUrl(img.stream) : null;
      if (live) steps.push({ clip: live });
    }
    const originals = steps.map((s) => (s.img ? originalUrl(s.img) : null));
    const probe = originals.filter(Boolean);
    diag(`File type probe: ranged GET of ${probe.length} originals (through the background worker)`);
    let reply = { ok: true, results: [] };
    if (probe.length) {
      try {
        reply = await chrome.runtime.sendMessage({ type: "rednoteProbe", urls: probe });
      } catch (err) {
        reply = { ok: false, error: err.message };
      }
    }
    if (!reply?.ok) diag("File type probe: no answer, assuming the originals are jpg", reply);
    return mapProbe(steps, originals, reply, diag, (detail) => callError("Photo lookup", "RedNote has no file for one of the photos.", detail));
  }

  // What to download for a clicked button → [{ url, filename, takenAt }].
  async function filesFor(target) {
    const website = MDSettings.websiteName(location.hostname);
    if (target.kind === "profile") {
      const uid = profileUid();
      const src = basicInfoFor(uid)?.images || document.querySelector(".user-info .avatar img.user-image")?.src;
      if (!src) throw callError("Profile picture lookup", "no profile picture on this page.", "no basicInfo.images and no .user-info .avatar img");
      const url = src.split("?")[0];
      const vars = { username: redIdOf(uid), createdDate: "profile", website };
      return [{ url, filename: MDSettings.buildFilename(settings.filenamePattern, vars, null, extOfUrl(url, "jpg")) }];
    }
    // Read before the click: the opened post changes the address, and the profile stays on screen below it.
    const uid = profileUid();
    const username = redIdOf(uid);
    if (target.kind === "tile") {
      diag("opening the post", target.noteId);
      target.cover.click(); // exactly one click per button press
    }
    const note = await waitForNote(target.noteId, uid);
    const files = await filesOf(note);
    const takenAt = Math.floor(note.time / 1000) || null;
    const vars = { username, createdDate: MDSettings.formatDate(takenAt ? takenAt * 1000 : null), website };
    return files.map((f, i) => ({
      url: f.url,
      filename: MDSettings.buildFilename(settings.filenamePattern, vars, files.length > 1 ? i : null, f.ext),
      takenAt, // post time in Unix seconds, for the exiftool helper
    }));
  }

  // ---------------------------------------------------------------- downloading + feedback

  // One download at a time in this tab: a click during an in-flight one is ignored (the tile click opens a post).
  let busy = false;

  async function download(getTarget, btn) {
    if (busy) {
      toast("A download is still running: wait for it to finish, then click again.", "warning");
      setTimeout(() => busy && toast("Downloading…"), 4300); // bring the progress text back once the warning has faded
      return;
    }
    busy = true;
    if (btn) btn.style.opacity = "0.4";
    toast("Downloading…");
    try {
      const target = getTarget(); // read at click time: the tile can be re-rendered
      diag("download clicked", { kind: target.kind, noteId: target.noteId, page: location.href });
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
      flash(btn, "#d93900");
    } finally {
      busy = false;
      if (btn) btn.style.opacity = "";
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

  function makeButton(kind, getTarget, style) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN;
    btn.dataset.mdKind = kind;
    btn.title = kind === "profile" ? "Download profile picture" : "Download";
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML = ICON;
    Object.assign(btn.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "32px",
      height: "32px",
      padding: "0",
      flexShrink: "0",
      border: "none",
      borderRadius: "999px",
      background: "rgba(255,255,255,.92)",
      color: "#222",
      boxShadow: "0 1px 4px rgba(0,0,0,.3)",
      cursor: "pointer",
      transition: "transform .15s ease, opacity .15s ease",
      ...style,
    });
    btn.addEventListener("mouseenter", () => (btn.style.transform = "scale(1.08)"));
    btn.addEventListener("mouseleave", () => (btn.style.transform = ""));
    // Tiles and the profile header are links/handlers that open things on click; keep the click to ourselves.
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "touchstart"]) {
      btn.addEventListener(type, (e) => e.stopPropagation());
    }
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      download(getTarget, btn);
    });
    return btn;
  }

  // Link of a tile (or the address of the opened post) → { noteId, cover }, read when the button is clicked.
  function tileTarget(section) {
    const href = section.querySelector("a.cover")?.getAttribute("href");
    const url = href && new URL(href, location.origin);
    const noteId = url?.pathname.match(/\/user\/profile\/[0-9a-f]+\/([0-9a-f]+)/)?.[1];
    if (!noteId) throw callError("Note lookup", "no link to the post on this tile.", "no a.cover[href] with /user/profile/<uid>/<id>");
    return { kind: "tile", noteId, cover: section.querySelector("a.cover") };
  }

  function openNoteTarget() {
    const noteId = location.pathname.match(/^\/discovery\/item\/([0-9a-f]+)/)?.[1];
    if (!noteId) throw callError("Note lookup", "this is not an opened post.", location.pathname);
    return { kind: "note", noteId };
  }

  // Only a user's profile (and the post modal opened over it) gets buttons: not the feed, search or /explore/<id>.
  const onProfile = () => /^\/(user\/profile|discovery\/item)\//.test(location.pathname) && Boolean(document.querySelector(".user-redId"));

  function injectTiles() {
    for (const section of document.querySelectorAll("section.note-item")) {
      if (section.querySelector(`.${BTN}`) || !section.querySelector("a.cover")) continue;
      const holder = section.firstElementChild || section;
      if (getComputedStyle(holder).position === "static") holder.style.position = "relative";
      holder.append(makeButton("tile", () => tileTarget(section), { position: "absolute", top: "8px", right: "8px", zIndex: "3" }));
    }
  }

  function injectNote() {
    const bar = document.querySelector("#noteContainer > .author .author-wrapper");
    if (!bar || bar.querySelector(`.${BTN}`) || !/^\/discovery\/item\//.test(location.pathname)) return;
    bar.append(makeButton("note", openNoteTarget, { marginLeft: "12px" }));
  }

  function injectProfile() {
    if (!/^\/user\/profile\//.test(location.pathname)) return;
    const wrapper = document.querySelector(".user-info > .avatar > .avatar-wrapper");
    if (!wrapper || wrapper.querySelector(`.${BTN}`)) return;
    if (getComputedStyle(wrapper).position === "static") wrapper.style.position = "relative";
    wrapper.append(makeButton("profile", () => ({ kind: "profile" }), { position: "absolute", right: "0", bottom: "0", zIndex: "3" }));
  }

  function injectAll() {
    if (!enabled() || !onProfile()) return removeAll();
    injectTiles();
    injectNote();
    injectProfile();
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
