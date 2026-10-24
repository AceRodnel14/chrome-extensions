// mediadownloader: Instagram support.
// Adds download buttons to feed posts, the reels viewer, profile grids, stories/highlights and profile pictures,
// resolves the original-resolution files through Instagram's own web APIs, and hands them to the background worker.
(() => {
  const SITE_ID = "instagram";
  const BTN = "md-download-btn";
  const IG_APP_ID = "936619743392459";

  // GraphQL queries, by Instagram's operation name. `id` (the doc_id) is the value last seen on Instagram's web app and
  // is the part that changes most often. In Diagnose mode a failing query looks up the current id in Instagram's
  // scripts and remembers it (chrome.storage.local "learnedDocIds"); see context.md → "When Instagram changes something".
  const DOC = {
    reelsMedia: { name: "PolarisStoriesV3HighlightsPageQuery", id: "39400183649572570", label: "Stories/highlights query" },
    profile: { name: "PolarisProfilePageContentQuery", id: "28717443601247930", label: "Profile query" },
    search: { name: "PolarisSearchBoxNonProfiledRefetchableQuery", id: "27634848489527274", label: "User search" },
  };
  const REELS_FLAGS = { __relay_internal__pv__PolarisCommunityNoteStoriesLabelEnabledrelayprovider: true };
  // PolarisProfilePageContentQuery fails with "execution error" unless every flag the page sends is present.
  const PROFILE_FLAGS = {
    __relay_internal__pv__PolarisCannesGuardianExperienceEnabledrelayprovider: true,
    __relay_internal__pv__PolarisCASB976ProfileEnabledrelayprovider: false,
    __relay_internal__pv__PolarisProfileInformTreatmentBannerEnabledrelayprovider: false,
    __relay_internal__pv__PolarisWebSchoolsEnabledrelayprovider: false,
    __relay_internal__pv__PolarisProfileRingsGradientEnabledrelayprovider: false,
    __relay_internal__pv__PolarisRepostsConsumptionEnabledrelayprovider: true,
    __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
  };

  const RESERVED = new Set(["accounts", "direct", "explore", "legal", "about", "p", "reel", "reels", "stories", "tv", "challenge", "emails", "session", "your_activity"]);

  let settings = MDSettings.DEFAULTS;
  let learnedDocIds = {};
  const enabled = () => settings.sites[SITE_ID] !== false;

  // Diagnose mode only: explain every call in the console.
  const diag = (...args) => settings.diagnoseMode && console.info("[mediadownloader:diagnose]", ...args);

  // ---------------------------------------------------------------- routes

  function route(href = location.href) {
    const url = new URL(href, location.origin);
    const [a, b, c] = url.pathname.split("/").filter(Boolean);
    if (!a) return { type: "home" };
    if (a === "stories") {
      if (b === "highlights") return { type: "highlight", highlightID: c || null };
      return b ? { type: "story", username: b, storyID: c || null } : { type: "other" };
    }
    if (a === "p" || a === "tv" || a === "reel") return { type: "post", code: b || null };
    if (a === "reels") return { type: "reels", code: b || null };
    if (RESERVED.has(a)) return { type: "other" };
    if (b === "p" || b === "reel") return { type: "post", code: c || null, username: a };
    return { type: "profile", username: a };
  }

  // ---------------------------------------------------------------- API

  let lsdToken = null;

  // Errors name the call that failed ("Profile query failed: …"); Diagnose mode adds the technical detail.
  function callError(label, message, detail) {
    const err = new Error(`${label} failed: ${message}${settings.diagnoseMode && detail ? ` [${detail}]` : ""}`);
    err.retryable = true;
    return err;
  }

  async function gql(doc, variables) {
    const docId = learnedDocIds[doc.name] || doc.id;
    try {
      return await gqlRequest(doc, docId, variables);
    } catch (err) {
      if (!settings.diagnoseMode || !err.retryable) throw err;
      // The id may have changed: look up the current one in Instagram's scripts and retry once.
      const current = await discoverDocId(doc.name);
      if (!current || current === docId) {
        diag(`${doc.name}: no newer doc_id found in Instagram's scripts (using ${docId})`);
        throw err;
      }
      diag(`${doc.name}: doc_id changed ${docId} -> ${current}, retrying`);
      const json = await gqlRequest(doc, current, variables);
      learnedDocIds = { ...learnedDocIds, [doc.name]: current };
      await chrome.storage.local.set({ learnedDocIds });
      diag(`${doc.name}: new doc_id ${current} works and is remembered`);
      return json;
    }
  }

  async function gqlRequest(doc, docId, variables) {
    lsdToken ||= ([...document.scripts].map((s) => s.textContent).join(" ").match(/"LSD",\[\],\{"token":"(.*?)"/) || [])[1];
    const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
    diag(`${doc.label}: POST /graphql/query`, { operation: doc.name, doc_id: docId, variables, lsdFound: Boolean(lsdToken), csrfFound: Boolean(csrf) });
    const r = await fetch("/graphql/query", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-IG-App-ID": IG_APP_ID,
        "X-FB-LSD": lsdToken || "",
        "X-CSRFToken": csrf || "",
      },
      body: new URLSearchParams({ doc_id: docId, variables: JSON.stringify(variables), lsd: lsdToken || "", server_timestamps: "true" }),
    });
    return parseResponse(r, doc.label, `${doc.name} doc_id ${docId}`);
  }

  async function api(path, label) {
    diag(`${label}: GET /api/v1/${path}`);
    const r = await fetch(`/api/v1/${path}`, { headers: { "X-IG-App-ID": IG_APP_ID }, credentials: "include" });
    return parseResponse(r, label, `GET /api/v1/${path}`);
  }

  async function parseResponse(r, label, request) {
    const fail = (message, detail, retryable = true) => {
      const err = callError(label, message, `${request}${detail ? `: ${detail}` : ""}`);
      err.retryable = retryable;
      return err;
    };
    if (r.status === 401 || r.url.includes("/accounts/login")) throw fail("please log in to Instagram and try again.", "", false);
    if (r.status === 429) throw fail("Instagram is rate limiting requests. Wait a minute and try again.", "HTTP 429", false);
    const text = await r.text();
    if (!r.ok) throw fail(`Instagram returned an error (${r.status}).`, `HTTP ${r.status} ${text.slice(0, 120)}`);
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw fail("Instagram returned something that is not data (probably a web page).", `HTTP ${r.status}, starts with ${JSON.stringify(text.slice(0, 60))}`);
    }
    if (!json?.data && json?.errors?.length) throw fail(`Instagram returned an error: ${json.errors[0].message}`, JSON.stringify(json.errors[0]).slice(0, 200));
    diag(`${label}: OK`, json);
    return json;
  }

  // Instagram's scripts define every GraphQL operation as
  //   __d("<Name>_instagramRelayOperation",[],(function(a,b,c,d,e,f){e.exports="<doc_id>"}),null);
  // Only the scripts this page already loaded are searched (the browser serves them from its cache).
  async function discoverDocId(name) {
    const pattern = new RegExp(`__d\\("${name}_instagramRelayOperation",\\[\\],\\(function\\([^)]*\\)\\{[^}]*?"(\\d{10,})"`);
    const urls = new Set([
      ...performance.getEntriesByType("resource").map((e) => e.name),
      ...[...document.scripts].map((s) => s.src),
    ].filter((u) => /\/rsrc\.php\/.*\.js/.test(u)));
    diag(`${name}: searching ${urls.size} Instagram scripts for the current doc_id`);
    for (const url of urls) {
      try {
        const match = (await (await fetch(url)).text()).match(pattern);
        if (match) return match[1];
      } catch {}
    }
    return null;
  }

  function mediaIdFromCode(code) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const short = code.length > 28 ? code.slice(0, -28) : code; // private posts carry a 28-char suffix
    let id = 0n;
    for (const ch of short) id = id * 64n + BigInt(alphabet.indexOf(ch));
    return id.toString();
  }

  async function getPost(code) {
    const json = await api(`media/${mediaIdFromCode(code)}/info/`, "Post lookup");
    const media = json.items?.[0];
    if (!media) throw callError("Post lookup", "Instagram did not return this post.", "no items[0] in the response");
    return media;
  }

  async function getReel(reelId) {
    const json = await gql(DOC.reelsMedia, { first: 1, initial_reel_id: reelId, reel_ids: [reelId], ...REELS_FLAGS });
    const node = json.data?.xdt_api__v1__feed__reels_media__connection?.edges?.[0]?.node;
    if (!node?.items?.length) {
      throw callError(DOC.reelsMedia.label, "this story or highlight has no files Instagram will return.",
        `${reelId}: no xdt_api__v1__feed__reels_media__connection.edges[0].node.items`);
    }
    return node;
  }

  async function getProfile(userId) {
    const json = await gql(DOC.profile, { enable_integrity_filters: true, id: String(userId), ...PROFILE_FLAGS });
    return json.data?.user || null;
  }

  const userIdCache = new Map();

  async function userIdByUsername(username) {
    if (userIdCache.has(username)) return userIdCache.get(username);
    const json = await gql(DOC.search, { hasQuery: true, query: username });
    const users = json.data?.xdt_api__v1__fbsearch__non_profiled_serp?.users || [];
    const user = users.find((u) => u.username?.toLowerCase() === username.toLowerCase());
    if (!user) throw callError(DOC.search.label, `could not find the Instagram account "${username}".`, `${users.length} results, none named exactly ${username}`);
    const id = String(user.id || user.pk);
    userIdCache.set(username, id);
    return id;
  }

  // ---------------------------------------------------------------- page helpers

  // Ask instagram-page.js (page world) which post/story item an element belongs to.
  function resolveFromReact(el) {
    if (!el) return null;
    el.removeAttribute("data-md-media");
    el.dispatchEvent(new CustomEvent("md:resolve", { bubbles: true }));
    const raw = el.getAttribute("data-md-media");
    el.removeAttribute("data-md-media");
    return raw ? JSON.parse(raw) : null;
  }

  function codeFromLinks(root) {
    for (const a of root?.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]') || []) {
      const r = route(a.href);
      if (r.type === "post" && r.code) return r.code;
    }
    return null;
  }

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };

  // The largest on-screen image/video, i.e. the story slide being shown.
  function visibleStoryMedia() {
    return [...document.querySelectorAll("img, video")]
      .filter((el) => isVisible(el) && el.getBoundingClientRect().width > 200)
      .sort((x, y) => y.getBoundingClientRect().height - x.getBoundingClientRect().height)[0] || null;
  }

  const fileKey = (url) => (url || "").split("?")[0].split("/").pop();

  // ---------------------------------------------------------------- media → files

  function pickCandidate(candidates) {
    const list = [...candidates];
    if (list.every((c) => c.width)) list.sort((x, y) => y.width - x.width);
    if (settings.imageSize === "small") return list.at(-1);
    if (settings.imageSize === "medium") return list[Math.min(Math.ceil(list.length / 4), list.length - 1)];
    return list[0];
  }

  function extensionFor(url, isVideo) {
    const ext = (fileKey(url).match(/\.(jpe?g|png|webp|heic|mp4|mov)$/i) || [])[1];
    return ext ? ext.toLowerCase().replace("jpeg", "jpg") : isVideo ? "mp4" : "jpg";
  }

  // One entry per file: a single post gives one, a carousel gives one per slide.
  function filesFromMedia(media, username, indexOffset = null) {
    const slides = media.carousel_media?.length ? media.carousel_media : [media];
    const vars = {
      username: username || media.user?.username || "",
      createdDate: MDSettings.formatDate(media.taken_at ? media.taken_at * 1000 : null),
      website: MDSettings.websiteName(location.hostname),
    };
    return slides.map((slide, i) => {
      const isVideo = Boolean(slide.video_versions?.length);
      const url = pickCandidate(isVideo ? slide.video_versions : slide.image_versions2?.candidates || [])?.url;
      if (!url) throw new Error("Instagram did not return a file for this post.");
      const index = slides.length > 1 ? i : indexOffset;
      return {
        url,
        filename: MDSettings.buildFilename(settings.filenamePattern, vars, index, extensionFor(url, isVideo)),
        takenAt: media.taken_at || null, // post time in Unix seconds, for the exiftool helper
      };
    });
  }

  // The viewer also pre-renders neighbouring stories, so look for the timestamp inside the main card only.
  function storyCardTime(mediaEl) {
    for (let el = mediaEl; el && el !== document.body; el = el.parentElement) {
      const time = el.querySelector("time[datetime]");
      if (time) return time;
    }
    return null;
  }

  // Story/highlight: the item on screen, matched by ID from the URL, by the card's timestamp (= taken_at),
  // by the ID in React props, or by the image file shown.
  function currentStoryItem(items, storyID, mediaEl) {
    const byPk = (pk) => (pk ? items.find((it) => String(it.pk) === String(pk)) : null);
    const time = storyCardTime(mediaEl);
    const shown = mediaEl ? fileKey(mediaEl.currentSrc || mediaEl.src || mediaEl.poster) : null;
    const methods = [
      ["story ID in the address", () => byPk(storyID)],
      ["timestamp of the main card", () => time && items.find((it) => it.taken_at * 1000 === Date.parse(time.dateTime))],
      ["React props", () => byPk(resolveFromReact(time)?.pk) || byPk(resolveFromReact(mediaEl)?.pk)],
      ["file name of the shown image", () => shown && items.find((it) => (it.image_versions2?.candidates || []).some((c) => fileKey(c.url) === shown))],
    ];
    for (const [method, find] of methods) {
      const item = find();
      if (item) {
        diag(`story slide found by ${method}: index ${items.indexOf(item)} of ${items.length}`);
        return item;
      }
    }
    diag("story slide not identified; saving the whole set", { storyID, cardTime: time?.dateTime || null, shownFile: shown, mediaEl });
    return null;
  }

  async function filesFor(target) {
    switch (target.type) {
      case "post":
        return filesFromMedia(await getPost(target.code));
      case "story":
      case "highlight": {
        const reelId = target.type === "highlight" ? `highlight:${target.highlightID}` : await userIdByUsername(target.username);
        const reel = await getReel(reelId);
        const item = currentStoryItem(reel.items, target.storyID, visibleStoryMedia());
        if (item) return filesFromMedia(item, reel.user?.username, reel.items.indexOf(item));
        // Could not tell which slide is showing: save the whole set rather than the wrong one.
        return reel.items.flatMap((it, i) => filesFromMedia(it, reel.user?.username, i));
      }
      case "profilePicture": {
        const url = await profilePictureUrl(target.username, target.fallbackUrl);
        const vars = { username: target.username, createdDate: "profile", website: MDSettings.websiteName(location.hostname) };
        return [{ url, filename: MDSettings.buildFilename(settings.filenamePattern, vars, null, "jpg") }];
      }
    }
    throw new Error("There is nothing to download here.");
  }

  async function profilePictureUrl(username, fallbackUrl) {
    // 1. Embedded in the page on a fresh load (not always present).
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      if (!s.textContent.includes("hd_profile_pic_url_info")) continue;
      const hit = findInJson(s.textContent, (o) => o.username === username && o.hd_profile_pic_url_info?.url);
      if (hit) return hit.hd_profile_pic_url_info.url;
    }
    // 2. The profile query. The page's user ID can be the previous profile's after in-app navigation, so check it.
    try {
      const text = [...document.querySelectorAll('script[type="application/json"]')].map((s) => s.textContent).join(" ");
      const pageId = (text.match(/"profilePage_(\d+)"/) || text.match(/"profile_id":"(\d+)"/) || [])[1];
      let user = pageId ? await getProfile(pageId) : null;
      if (user?.username !== username) user = await getProfile(await userIdByUsername(username));
      if (user?.hd_profile_pic_url_info?.url) return user.hd_profile_pic_url_info.url;
    } catch (err) {
      console.warn("[mediadownloader] HD profile picture lookup failed, saving the thumbnail", err);
    }
    // 3. The thumbnail on the page.
    return fallbackUrl;
  }

  function findInJson(text, predicate) {
    let found = null;
    const walk = (o) => {
      if (found || !o || typeof o !== "object") return;
      if (predicate(o)) return (found = o);
      for (const k in o) walk(o[k]);
    };
    try {
      walk(JSON.parse(text));
    } catch {}
    return found;
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
      diag("chrome.downloads results", results, exiftool ? `${exiftool} files queued for exiftool` : "exiftool not used");
      const failed = results.filter((r) => !r.ok);
      if (failed.length) throw new Error(`Saving failed for ${failed.length} of ${results.length} files: ${failed[0].error || "unknown error"}`);
      const saved = results.length > 1 ? `Saved ${results.length} files.` : `Saved ${results[0].filename}`;
      toast(exiftool ? `${saved} Setting dates…` : saved, exiftool ? "progress" : "success");
      flash(btn, "#1e7a34");
    } catch (err) {
      console.error("[mediadownloader]", err);
      toast(err.message || "The download failed. Please try again.", "error");
      flash(btn, "#ed4956");
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
  const TOAST_COLORS = { progress: "#2f9e44", success: "#1e7a34", error: "#ed4956" };

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
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 2 20 20" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M7.1 16.9h9.8v-1.65H7.1Zm4.9-3.15 3.8-3.8-1.15-1.15-1.85 1.875V5.95h-1.65v4.675L9.35 8.8 8.2 9.95Zm0 8.05q-2.025 0-3.812-.775-1.788-.775-3.113-2.1-1.325-1.325-2.1-3.113Q2.2 14.025 2.2 12t.775-3.825q.775-1.8 2.1-3.125Q6.4 3.725 8.188 2.962 9.975 2.2 12 2.2t3.825.762q1.8.763 3.125 2.088 1.325 1.325 2.088 3.112Q21.8 9.95 21.8 12t-.762 3.825q-.763 1.775-2.088 3.1-1.325 1.325-3.112 2.1Q14.05 21.8 12 21.8Zm0-1.65q3.425 0 5.788-2.363Q20.15 15.425 20.15 12t-2.362-5.788Q15.425 3.85 12 3.85q-3.425 0-5.787 2.362Q3.85 8.575 3.85 12q0 3.425 2.363 5.787Q8.575 20.15 12 20.15ZM12 12Z"/></svg>';

  function makeButton(kind, getTarget, style = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN;
    btn.dataset.mdKind = kind;
    btn.title = kind === "profile" ? "Download profile picture" : "Download";
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
      background: "transparent",
      color: "rgb(var(--ig-primary-icon, 38, 38, 38))",
      cursor: "pointer",
      transition: "transform .15s ease, opacity .15s ease",
      ...style,
    });
    btn.addEventListener("mouseenter", () => (btn.style.transform = "scale(1.12)"));
    btn.addEventListener("mouseleave", () => (btn.style.transform = ""));
    // Buttons often sit inside links or the story-opening avatar; keep the click to ourselves.
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
      else toast("Finding the post failed: no post code in Instagram's page data, links or the address. Instagram may have changed this page.", "error");
    });
    return btn;
  }

  const hasOwnButton = (el, kind) => Boolean(el.querySelector(`:scope > .${BTN}[data-md-kind="${kind}"]`));

  // Feed posts, post pages and the reels viewer all have an action bar holding Like … Save.
  function injectActionBars() {
    for (const like of document.querySelectorAll('svg[aria-label="Like"], svg[aria-label="Unlike"]')) {
      let bar = like.parentElement;
      while (bar && bar !== document.body && !bar.querySelector('svg[aria-label="Save"], svg[aria-label="Remove"]')) bar = bar.parentElement;
      if (!bar || bar === document.body || bar.tagName === "ARTICLE") continue;
      if (bar.querySelector(`.${BTN}[data-md-kind="post"]`)) continue;

      const likeChild = [...bar.children].find((c) => c.contains(like));
      if (!likeChild) continue;
      const getTarget = () => {
        const sources = { react: resolveFromReact(like)?.code, articleLink: codeFromLinks(bar.closest("article")), url: route().code };
        diag("post code sources (first one wins)", sources);
        const code = sources.react || sources.articleLink || sources.url;
        return code ? { type: "post", code } : null;
      };
      if (likeChild.querySelector('svg[aria-label="Comment"]')) {
        // Feed / post page: a horizontal group of Like, Comment, Share. Add ours at its end.
        likeChild.append(makeButton("post", getTarget));
      } else {
        // Reels viewer: a vertical column, one child per action. Add ours above Save.
        const saveChild = [...bar.children].find((c) => c.querySelector('svg[aria-label="Save"], svg[aria-label="Remove"]'));
        bar.insertBefore(makeButton("post", getTarget, { margin: "0 auto" }), saveChild || null);
      }
    }
  }

  // Profile, explore and tagged grids: post/reel tiles. Reels-tab tiles draw the thumbnail as a background image.
  function injectThumbnails() {
    for (const a of document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) {
      if (hasOwnButton(a, "tile")) continue;
      const r = a.getBoundingClientRect();
      if (r.width < 100 || r.height < 100) continue;
      const target = route(a.href);
      if (target.type !== "post" || !target.code) continue;
      if (getComputedStyle(a).position === "static") a.style.position = "relative";
      const btn = makeButton("tile", () => ({ type: "post", code: target.code }), {
        position: "absolute",
        right: "4px",
        bottom: "4px",
        zIndex: "10",
        color: "#fff",
        filter: "drop-shadow(0 0 3px rgba(0,0,0,.85))",
        opacity: "0",
        pointerEvents: "none",
      });
      a.append(btn);
      a.addEventListener("mouseenter", () => Object.assign(btn.style, { opacity: "1", pointerEvents: "auto" }));
      a.addEventListener("mouseleave", () => Object.assign(btn.style, { opacity: "0", pointerEvents: "none" }));
    }
  }

  // Stories and highlights: one fixed button in the top-right corner, under the viewer's close button.
  function injectStoryButton() {
    const r = route();
    const existing = document.querySelector(`.${BTN}[data-md-kind="story"]`);
    if (r.type !== "story" && r.type !== "highlight") return existing?.remove();
    if (existing) return;
    const btn = makeButton("story", () => route(), {
      position: "fixed",
      top: "58px",
      right: "16px",
      zIndex: "9999",
      color: "#fff",
      filter: "drop-shadow(0 0 3px rgba(0,0,0,.6))",
    });
    btn.querySelector("svg").setAttribute("width", "28");
    btn.querySelector("svg").setAttribute("height", "28");
    document.body.append(btn);
  }

  // Profile pages: a badge on the bottom-right of the profile picture.
  function injectProfilePicture() {
    const r = route();
    if (r.type !== "profile") return;
    const username = r.username;
    const avatar = [...document.querySelectorAll("header img, main img")].find(
      (img) => img.alt?.toLowerCase() === `${username.toLowerCase()}'s profile picture` && img.getBoundingClientRect().width >= 60
    );
    if (!avatar) return;
    // The avatar-sized box that also holds the story ring, so the badge sits on the ring.
    let host = avatar.parentElement;
    const size = avatar.getBoundingClientRect().width;
    while (host.parentElement && host.parentElement.tagName !== "SECTION" && host.parentElement.getBoundingClientRect().width <= size + 40) {
      host = host.parentElement;
    }
    const current = host.querySelector(`:scope > .${BTN}[data-md-kind="profile"]`);
    if (current?.dataset.mdUser === username) return;
    current?.remove(); // left over from the previous profile after in-app navigation
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const btn = makeButton("profile", () => ({ type: "profilePicture", username, fallbackUrl: avatar.src }), {
      position: "absolute",
      right: "0",
      bottom: "0",
      width: "32px",
      height: "32px",
      borderRadius: "50%",
      background: "#fff",
      color: "#262626",
      zIndex: "2",
      boxShadow: "0 1px 4px rgba(0,0,0,.25)",
    });
    btn.dataset.mdUser = username;
    btn.querySelector("svg").setAttribute("width", "28");
    btn.querySelector("svg").setAttribute("height", "28");
    host.append(btn);
  }

  function injectAll() {
    if (!enabled()) return;
    injectActionBars();
    injectThumbnails();
    injectStoryButton();
    injectProfilePicture();
  }

  function removeAll() {
    document.querySelectorAll(`.${BTN}`).forEach((b) => b.remove());
  }

  // ---------------------------------------------------------------- start

  // A timer rather than requestAnimationFrame: rAF is paused in background tabs, so tabs opened in the
  // background would get no buttons until shown.
  let queued = 0;
  const observer = new MutationObserver(() => {
    if (!queued) queued = setTimeout(() => ((queued = 0), injectAll()), 100);
  });

  // The background worker reports back once exiftool has run on a finished batch.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "exiftoolResult") return;
    diag("exiftool result", msg);
    if (msg.ok) toast(`Dates set on ${msg.updated} file${msg.updated === 1 ? "" : "s"}.`, "success");
    else toast(`Saved, but setting the date failed${msg.updated ? ` for ${msg.total - msg.updated} of ${msg.total} files` : ""}: ${msg.error}`, "error");
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === "local" && changes.learnedDocIds) learnedDocIds = changes.learnedDocIds.newValue || {};
    if (area !== "sync") return;
    settings = await MDSettings.load();
    if (enabled()) injectAll();
    else removeAll();
  });

  Promise.all([MDSettings.load(), chrome.storage.local.get({ learnedDocIds: {} })]).then(([loaded, local]) => {
    settings = loaded;
    learnedDocIds = local.learnedDocIds;
    if (Object.keys(learnedDocIds).length) diag("using doc_ids learned in Diagnose mode", learnedDocIds);
    observer.observe(document.body, { childList: true, subtree: true });
    injectAll();
  });
})();
