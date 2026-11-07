// mediadownloader: RedNote (rednote.com) support.
// Adds a download button to every post tile on a user's profile, to the opened post (the modal over the profile) and
// to the profile picture. There is no feed, bulk or "download all" mode: one click saves one post.
// Everything needed comes from the profile page itself plus ONE request per click: the post's own page
// (/explore/<id>?xsec_token=…), whose HTML carries the post's full data in window.__INITIAL_STATE__. Nothing is
// prefetched, retried or signed. The description-date option does not apply here (MDSettings.postTime is never used).
(() => {
  const SITE_ID = "rednote";
  const BTN = "md-download-btn";

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

  const noteCache = new Map();

  // One request: the post's own page. Blocked (login/security check) pages are reported, never retried.
  async function getNote(noteId, token) {
    if (noteCache.has(noteId)) return noteCache.get(noteId);
    if (!/^[0-9a-f]+$/i.test(noteId)) throw callError("Note lookup", "this post has an unexpected id.", `id ${JSON.stringify(noteId)}`);
    if (!token) throw callError("Note lookup", "this post's link has no access token.", `${noteId}: no xsec_token`);
    const path = `/explore/${noteId}?xsec_token=${encodeURIComponent(token)}&xsec_source=pc_user`;
    diag(`Note lookup: GET /explore/${noteId}?xsec_token=…`);
    const blocked = (detail) =>
      callError("Note lookup", "RedNote asks for a security check. Open the note in this tab, complete it, then try again.", detail);
    const r = await fetch(path, { credentials: "include" });
    if (r.redirected || r.url.includes("/website-login/")) throw blocked(`redirected to ${new URL(r.url).pathname}`);
    if (r.status !== 200) throw blocked(`HTTP ${r.status}`);
    const state = parseState(await r.text());
    if (!state) throw blocked("no window.__INITIAL_STATE__ in the page");
    const detail = unref(unref(unref(state.note)?.noteDetailMap)?.[noteId]);
    const note = unref(detail?.note);
    if (!note) throw callError("Note lookup", "RedNote did not return this post.", `${noteId}: no note.noteDetailMap[id].note`);
    diag("Note lookup: OK", { type: note.type, images: note.imageList?.length, time: note.time });
    noteCache.set(noteId, note);
    return note;
  }

  // ---------------------------------------------------------------- media → files

  const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/gif": "gif", "image/avif": "avif" };
  const extOfUrl = (url, fallback) => (url.split("?")[0].match(/\.(jpe?g|png|gif|webp|heic|avif)$/i)?.[1].toLowerCase().replace("jpeg", "jpg")) || fallback;

  // Stream keys are obfuscated (EF4, EF5, …) and may change: take the first non-empty list.
  function streamUrl(stream) {
    const entry = Object.values(stream || {}).find((list) => Array.isArray(list) && list.length)?.[0];
    return entry?.masterUrl || entry?.backupUrls?.[0] || null;
  }

  // Smaller file RedNote itself shows (1080 px WebP), used only when the original is missing.
  const fallbackUrl = (img) => img.infoList?.find((i) => i.imageScene === "WB_DFT")?.url || img.urlDefault || img.url || null;

  // Every file of a note, in order: [{ url, ext }]. Photos are the original upload (ci.xiaohongshu.com/<fileId>); their
  // type is read from a request made by the background worker (one message for the whole note).
  async function filesOf(note) {
    const clip = streamUrl(note.video?.media?.stream);
    if (note.type === "video" || clip) {
      if (!clip) throw callError("Video lookup", "RedNote returned no video file for this post.", `${note.noteId}: no video.media.stream[*][0].masterUrl`);
      return [{ url: clip, ext: "mp4" }]; // imageList[0] is only the cover
    }
    const steps = []; // photos, each live photo followed by its clip
    for (const img of note.imageList || []) {
      steps.push({ img });
      const live = img.livePhoto === true ? streamUrl(img.stream) : null;
      if (live) steps.push({ clip: live });
    }
    if (!steps.length) throw new Error("This post has no photos or videos.");
    const originals = steps.map((s) => (s.img?.fileId ? `https://ci.xiaohongshu.com/${s.img.fileId}` : null));
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
    const results = reply?.ok ? reply.results : [];
    if (!reply?.ok) diag("File type probe: no answer, assuming the originals are jpg", reply);
    let p = 0;
    return steps.map((s, i) => {
      if (s.clip) return { url: s.clip, ext: "mp4" };
      const original = originals[i];
      const result = original ? (reply?.ok ? results[p++] : { status: 200, contentType: "" }) : null;
      if (result?.status === 200) return { url: original, ext: EXTENSIONS[result.contentType] || "jpg" };
      const fallback = fallbackUrl(s.img);
      if (!fallback) throw callError("Photo lookup", "RedNote has no file for one of the photos.", `${original || "no fileId"}: HTTP ${result?.status ?? "-"}`);
      diag(`original ${original || "(none)"} not available (HTTP ${result?.status ?? "-"}); using RedNote's smaller version`);
      return { url: fallback, ext: extOfUrl(fallback, "webp") };
    });
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
    const uid = profileUid();
    const note = await getNote(target.noteId, target.token);
    if (uid && note.user?.userId && note.user.userId !== uid) {
      throw callError("Profile lookup", "this post belongs to another account than the profile on screen.", `post by ${note.user.userId}, profile ${uid}`);
    }
    const files = await filesOf(note);
    const takenAt = Math.floor(note.time / 1000) || null;
    const vars = { username: redIdOf(uid), createdDate: MDSettings.formatDate(takenAt ? takenAt * 1000 : null), website };
    return files.map((f, i) => ({
      url: f.url,
      filename: MDSettings.buildFilename(settings.filenamePattern, vars, files.length > 1 ? i : null, f.ext),
      takenAt, // post time in Unix seconds, for the exiftool helper
    }));
  }

  // ---------------------------------------------------------------- downloading + feedback

  async function download(getTarget, btn) {
    if (btn?.dataset.busy) return;
    if (btn) {
      btn.dataset.busy = "1";
      btn.style.opacity = "0.4";
    }
    toast("Downloading…");
    try {
      const target = getTarget(); // read at click time: the links' tokens can change
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

  // Link of a tile (or the address of the opened post) → { noteId, token }, read when the button is clicked.
  function tileTarget(section) {
    const href = section.querySelector("a.cover")?.getAttribute("href");
    const url = href && new URL(href, location.origin);
    const noteId = url?.pathname.match(/\/user\/profile\/[0-9a-f]+\/([0-9a-f]+)/)?.[1];
    if (!noteId) throw callError("Note lookup", "no link to the post on this tile.", "no a.cover[href] with /user/profile/<uid>/<id>");
    return { kind: "tile", noteId, token: url.searchParams.get("xsec_token") };
  }

  function openNoteTarget() {
    const noteId = location.pathname.match(/^\/discovery\/item\/([0-9a-f]+)/)?.[1];
    if (!noteId) throw callError("Note lookup", "this is not an opened post.", location.pathname);
    return { kind: "note", noteId, token: new URLSearchParams(location.search).get("xsec_token") };
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
