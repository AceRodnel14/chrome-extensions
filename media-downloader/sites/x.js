// mediadownloader: X (formerly Twitter) support.
// Adds download buttons to posts (timelines, post pages, the photo viewer), the Media tab's photo grid, profile
// pictures and banners. Post media comes from the data X already loaded into the page (React props / Redux store,
// read by x-page.js); X's own web API is only called when a post is not in the page.
(() => {
  const SITE_ID = "x";
  const BTN = "md-download-btn";

  // X's web app sends this public bearer token with every API call; it identifies the web app, not the user.
  const BEARER =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

  // GraphQL query used when a post is not in the page. `id` is the queryId last seen in X's main.js and is the part
  // that changes most often; Diagnose mode looks up the current one and remembers it (chrome.storage.local
  // "learnedDocIds", shared with Instagram). See context.md → "When X changes something".
  const DOC = { tweet: { name: "TweetResultByRestId", id: "a-Xpq8PjX9K6U5cmc1f05A", label: "Post lookup" } };
  // The query fails unless every feature switch X expects is present; their values do not matter for media.
  const TWEET_FEATURES = [
    "creator_subscriptions_tweet_preview_api_enabled", "premium_content_api_read_enabled",
    "communities_web_enable_tweet_community_results_fetch", "c9s_tweet_anatomy_moderator_badge_enabled",
    "responsive_web_grok_analyze_button_fetch_trends_enabled", "responsive_web_grok_analyze_post_followups_enabled",
    "rweb_cashtags_composer_attachment_enabled", "responsive_web_jetfuel_frame", "rweb_sports_post_context_enabled",
    "responsive_web_grok_share_attachment_enabled", "responsive_web_grok_annotations_enabled",
    "articles_preview_enabled", "responsive_web_edit_tweet_api_enabled",
    "rweb_conversational_replies_downvote_enabled", "graphql_is_translatable_rweb_tweet_is_translatable_enabled",
    "view_counts_everywhere_api_enabled", "longform_notetweets_consumption_enabled",
    "responsive_web_twitter_article_tweet_consumption_enabled", "content_disclosure_indicator_enabled",
    "content_disclosure_ai_generated_indicator_enabled", "responsive_web_grok_show_grok_translated_post",
    "responsive_web_grok_analysis_button_from_backend", "post_ctas_fetch_enabled", "rweb_cashtags_enabled",
    "freedom_of_speech_not_reach_fetch_enabled", "standardized_nudges_misinfo",
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled",
    "longform_notetweets_rich_text_read_enabled", "longform_notetweets_inline_media_enabled",
    "profile_label_improvements_pcf_label_in_post_enabled", "responsive_web_profile_redirect_enabled",
    "rweb_tipjar_consumption_enabled", "verified_phone_label_enabled", "responsive_web_nested_quote_preview_enabled",
    "responsive_web_grok_image_annotation_enabled", "responsive_web_grok_imagine_annotation_enabled",
    "responsive_web_made_on_x_label_enabled", "responsive_web_grok_community_note_auto_translation_is_enabled",
    "responsive_web_graphql_timeline_navigation_enabled",
  ];

  const RESERVED = new Set(["home", "explore", "notifications", "messages", "i", "settings", "search", "compose", "login", "logout", "signup", "tos", "privacy", "jobs", "grok", "communities", "lists", "bookmarks", "premium_sign_up"]);

  let settings = MDSettings.DEFAULTS;
  let learnedDocIds = {};
  const enabled = () => settings.sites[SITE_ID] !== false;

  // Diagnose mode only: explain every call in the console.
  const diag = (...args) => settings.diagnoseMode && console.info("[mediadownloader:diagnose]", ...args);

  // ---------------------------------------------------------------- routes

  // /<user>/status/<id>[/photo/<n> | /video/<n>]
  function route(href = location.href) {
    const url = new URL(href, location.origin);
    const [a, b, c, d, e] = url.pathname.split("/").filter(Boolean);
    if (!a || RESERVED.has(a.toLowerCase())) return { type: "other" };
    if (b === "status" && /^\d+$/.test(c || "")) {
      const index = (d === "photo" || d === "video") && /^\d+$/.test(e || "") ? Number(e) - 1 : null;
      return { type: "tweet", username: a, id: c, index };
    }
    return { type: "profile", username: a };
  }

  // ---------------------------------------------------------------- API (only for posts not in the page)

  // Errors name the call that failed ("Post lookup failed: …"); Diagnose mode adds the technical detail.
  function callError(label, message, detail) {
    const err = new Error(`${label} failed: ${message}${settings.diagnoseMode && detail ? ` [${detail}]` : ""}`);
    err.retryable = true;
    return err;
  }

  async function gql(doc, variables) {
    const queryId = learnedDocIds[doc.name] || doc.id;
    try {
      return await gqlRequest(doc, queryId, variables, TWEET_FEATURES);
    } catch (err) {
      if (!settings.diagnoseMode || !err.retryable) throw err;
      // The id or the feature list may have changed: look up both in X's main script and retry once.
      const current = await discoverQuery(doc.name);
      if (!current || (current.id === queryId && !current.features.length)) {
        diag(`${doc.name}: nothing newer found in X's scripts (using ${queryId})`);
        throw err;
      }
      diag(`${doc.name}: retrying with queryId ${current.id} and ${current.features.length} feature switches from X's scripts`);
      const json = await gqlRequest(doc, current.id, variables, current.features.length ? current.features : TWEET_FEATURES);
      if (current.id !== queryId) {
        learnedDocIds = { ...learnedDocIds, [doc.name]: current.id };
        await chrome.storage.local.set({ learnedDocIds });
        diag(`${doc.name}: new queryId ${current.id} works and is remembered`);
      }
      return json;
    }
  }

  async function gqlRequest(doc, queryId, variables, features) {
    const csrf = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1];
    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(Object.fromEntries(features.map((f) => [f, false]))),
    });
    const path = `/i/api/graphql/${queryId}/${doc.name}`;
    diag(`${doc.label}: GET ${path}`, { variables, csrfFound: Boolean(csrf) });
    const r = await fetch(`${path}?${params}`, {
      credentials: "include",
      headers: {
        authorization: `Bearer ${BEARER}`,
        "x-csrf-token": csrf || "",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
      },
    });
    return parseResponse(r, doc.label, `${doc.name} queryId ${queryId}`);
  }

  async function parseResponse(r, label, request) {
    const fail = (message, detail, retryable = true) => {
      const err = callError(label, message, `${request}${detail ? `: ${detail}` : ""}`);
      err.retryable = retryable;
      return err;
    };
    if (r.status === 401 || r.status === 403) throw fail("please log in to X and try again.", `HTTP ${r.status}`, false);
    if (r.status === 429) throw fail("X is rate limiting requests. Wait a few minutes and try again.", "HTTP 429", false);
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw fail(`X returned something that is not data (HTTP ${r.status}).`, `starts with ${JSON.stringify(text.slice(0, 60))}`);
    }
    if (!r.ok || (!json?.data && json?.errors?.length)) {
      const message = json?.errors?.[0]?.message || `HTTP ${r.status}`;
      throw fail(`X returned an error: ${message}`, JSON.stringify(json?.errors?.[0] || text.slice(0, 160)).slice(0, 200));
    }
    diag(`${label}: OK`, json);
    return json;
  }

  // X's main script defines every query as {queryId:"…",operationName:"<Name>",…,metadata:{featureSwitches:[…],…}}.
  async function discoverQuery(name) {
    const src = [...document.scripts].map((s) => s.src).find((u) => /\/client-web\/main\.[\w]+\.js/.test(u));
    if (!src) return null;
    diag(`${name}: searching ${src} for the current queryId`);
    try {
      const text = await (await fetch(src)).text();
      const match = text.match(new RegExp(`queryId:"([^"]+)",operationName:"${name}",operationType:"\\w+",metadata:\\{featureSwitches:(\\[[^\\]]*\\])`));
      return match ? { id: match[1], features: JSON.parse(match[2]) } : null;
    } catch {
      return null;
    }
  }

  // GraphQL post → the same shape x-page.js produces from the page data.
  function fromGraphql(result) {
    const tweet = result?.tweet || result; // TweetWithVisibilityResults wraps the post
    if (!tweet?.legacy) return null;
    const original = tweet.legacy.retweeted_status_result?.result;
    if (original) return fromGraphql(original);
    const user = tweet.core?.user_results?.result;
    const media = (tweet.legacy.extended_entities?.media || []).map((m) => ({
      type: m.type,
      url: m.media_url_https,
      variants: (m.video_info?.variants || []).filter((v) => v.content_type === "video/mp4"),
    }));
    const quoted = tweet.quoted_status_result?.result;
    return {
      id: tweet.rest_id,
      createdAt: tweet.legacy.created_at,
      username: user?.core?.screen_name || user?.legacy?.screen_name || "",
      media,
      quoted: !media.length && quoted ? fromGraphql(quoted) : null,
    };
  }

  async function getTweet(id) {
    const json = await gql(DOC.tweet, { tweetId: id, withCommunity: false, includePromotedContent: false, withVoice: false });
    const tweet = fromGraphql(json.data?.tweetResult?.result);
    if (!tweet) {
      throw callError(DOC.tweet.label, "X did not return this post (deleted, protected or age-restricted?).",
        `${id}: data.tweetResult.result is ${json.data?.tweetResult?.result?.__typename || "missing"}`);
    }
    return { source: "X's API", ...tweet };
  }

  // ---------------------------------------------------------------- page helpers

  // Ask x-page.js (page world) for the post an element belongs to, or for a given post id.
  function resolveFromPage(el, wantId) {
    if (!el) return null;
    el.removeAttribute("data-md-media");
    if (wantId) el.setAttribute("data-md-want", wantId);
    el.dispatchEvent(new CustomEvent("md:resolve", { bubbles: true }));
    const raw = el.getAttribute("data-md-media");
    el.removeAttribute("data-md-media");
    el.removeAttribute("data-md-want");
    const found = raw ? JSON.parse(raw) : null;
    if (found?.error) diag("reading the page data failed", found.error);
    return found?.id ? found : null;
  }

  // The post's own permalink in an <article>: the link around its timestamp (a quoted post's has none).
  function idFromArticle(article) {
    const link = article?.querySelector('a[href*="/status/"] time')?.closest("a");
    return link ? route(link.href).id : null;
  }

  // ---------------------------------------------------------------- media → files

  const SIZE_NAMES = { original: "orig", medium: "medium", small: "small" };

  function pickVariant(variants) {
    const list = [...variants].sort((x, y) => (y.bitrate || 0) - (x.bitrate || 0));
    if (settings.imageSize === "small") return list.at(-1);
    if (settings.imageSize === "medium") return list[Math.floor(list.length / 2)];
    return list[0];
  }

  // https://pbs.twimg.com/media/<key>.jpg → https://pbs.twimg.com/media/<key>?format=jpg&name=orig
  function photoUrl(url) {
    const m = url.match(/^(.*\/media\/[^./?]+)\.(\w+)/);
    return m ? { url: `${m[1]}?format=${m[2]}&name=${SIZE_NAMES[settings.imageSize] || "orig"}`, ext: m[2].replace("jpeg", "jpg") } : { url, ext: "jpg" };
  }

  // One entry per photo/video; `only` limits it to one position (the photo viewer).
  function filesFromTweet(tweet, only = null) {
    const source = tweet.media.length ? tweet : tweet.quoted; // a post without media that quotes one with media
    if (!source?.media.length) throw new Error("This post has no photos or videos.");
    const takenAt = Date.parse(source.createdAt) / 1000 || null;
    const vars = {
      username: source.username,
      createdDate: MDSettings.formatDate(takenAt ? takenAt * 1000 : null),
      website: MDSettings.websiteName(location.hostname),
    };
    const picked = only !== null && source.media[only] ? [[source.media[only], only]] : source.media.map((m, i) => [m, i]);
    return picked.map(([m, i]) => {
      const isVideo = m.type === "video" || m.type === "animated_gif";
      const file = isVideo ? { url: pickVariant(m.variants)?.url, ext: "mp4" } : photoUrl(m.url);
      if (!file.url) throw new Error("X did not return a file for this post.");
      const index = source.media.length > 1 ? i : null;
      return {
        url: file.url,
        filename: MDSettings.buildFilename(settings.filenamePattern, vars, index, file.ext),
        takenAt, // post time in Unix seconds, for the exiftool helper
      };
    });
  }

  async function filesFor(target) {
    switch (target.type) {
      case "tweet": {
        let tweet = resolveFromPage(target.el, target.id);
        diag(tweet ? `post ${tweet.id} found in the page (${tweet.source})` : `post ${target.id} not in the page; asking X's API`);
        if (!tweet) {
          if (!target.id) throw new Error("Finding the post failed: no post id in X's page data, links or the address.");
          tweet = await getTweet(target.id);
        }
        return filesFromTweet(tweet, target.index ?? null);
      }
      case "profilePicture":
      case "banner": {
        const vars = { username: target.username, createdDate: target.type === "banner" ? "banner" : "profile", website: MDSettings.websiteName(location.hostname) };
        const ext = target.url.match(/\.(jpe?g|png|gif|webp)$/i)?.[1].toLowerCase().replace("jpeg", "jpg") || "jpg";
        return [{ url: target.url, filename: MDSettings.buildFilename(settings.filenamePattern, vars, null, ext) }];
      }
    }
    throw new Error("There is nothing to download here.");
  }

  // ---------------------------------------------------------------- downloading + feedback

  async function download(target, btn) {
    if (btn?.dataset.busy) return;
    if (btn) {
      btn.dataset.busy = "1";
      btn.style.opacity = "0.4";
    }
    toast("Downloading…");
    diag("download clicked", { button: btn?.dataset.mdKind, target: { ...target, el: undefined }, page: location.href });
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
      flash(btn, "#f4212e");
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
  const TOAST_COLORS = { progress: "#1d9bf0", success: "#00ba7c", warning: "#b26a00", error: "#f4212e" };

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

  const TITLES = { profile: "Download profile picture", banner: "Download banner", viewer: "Download this photo or video" };

  function makeButton(kind, getTarget, style = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN;
    btn.dataset.mdKind = kind;
    btn.title = TITLES[kind] || "Download";
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML = ICON;
    Object.assign(btn.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "34px",
      height: "34px",
      padding: "0",
      flexShrink: "0",
      border: "none",
      borderRadius: "50%",
      background: "transparent",
      color: "inherit",
      cursor: "pointer",
      transition: "transform .15s ease, opacity .15s ease",
      ...style,
    });
    btn.addEventListener("mouseenter", () => (btn.style.transform = "scale(1.12)"));
    btn.addEventListener("mouseleave", () => (btn.style.transform = ""));
    // Buttons often sit inside links (grid tiles, avatar, banner) or clickable posts; keep the click to ourselves.
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
      else toast("Finding the post failed: no post id in X's page data, links or the address. X may have changed this page.", "error");
    });
    return btn;
  }

  const hasOwnButton = (el, kind) => Boolean(el.querySelector(`:scope > .${BTN}[data-md-kind="${kind}"]`));

  // Every post (timelines, post pages, the photo viewer) has an action bar: Reply, Repost, Like, Views, Bookmark, Share.
  function injectActionBars() {
    for (const bar of document.querySelectorAll('[role="group"]')) {
      if (!bar.querySelector('[data-testid="reply"]') || !bar.querySelector('[data-testid="like"], [data-testid="unlike"]')) continue;
      if (hasOwnButton(bar, "post") || hasOwnButton(bar, "viewer")) continue;
      const article = bar.closest("article");
      const inViewer = !article && Boolean(bar.closest('[role="dialog"]'));
      // Match the colour of the bar's own icons (they differ between the timeline and the dark photo viewer).
      const color = getComputedStyle(bar.querySelector('[data-testid="reply"] svg') || bar).color;
      const getTarget = () => {
        const r = route();
        if (inViewer) return r.type === "tweet" ? { type: "tweet", id: r.id, index: r.index, el: bar } : null;
        const sources = { articleLink: idFromArticle(article), url: r.type === "tweet" ? r.id : null };
        diag("post id sources (React props are checked first, then these)", sources);
        // The post page's main post may have no timestamp link; then the address names it.
        return { type: "tweet", id: sources.articleLink || (article?.getAttribute("tabindex") === "-1" ? sources.url : null), el: bar };
      };
      bar.append(makeButton(inViewer ? "viewer" : "post", getTarget, { color, alignSelf: "center" }));
    }
  }

  // Media tab → Photos: a grid of tiles, one per post, outside any <article>.
  function injectThumbnails() {
    for (const a of document.querySelectorAll('a[href*="/status/"]')) {
      if (a.closest("article") || hasOwnButton(a, "tile")) continue;
      const target = route(a.href);
      if (target.type !== "tweet" || target.index === null) continue;
      const r = a.getBoundingClientRect();
      if (r.width < 100 || r.height < 100) continue;
      if (getComputedStyle(a).position === "static") a.style.position = "relative";
      const btn = makeButton("tile", () => ({ type: "tweet", id: target.id, el: a }), {
        position: "absolute",
        right: "4px",
        bottom: "4px",
        zIndex: "10",
        color: "#fff",
        filter: "drop-shadow(0 0 3px rgba(0,0,0,.85))",
        opacity: "0",
        pointerEvents: "none",
      });
      btn.querySelector("svg").setAttribute("width", "26");
      btn.querySelector("svg").setAttribute("height", "26");
      a.append(btn);
      a.addEventListener("mouseenter", () => Object.assign(btn.style, { opacity: "1", pointerEvents: "auto" }));
      a.addEventListener("mouseleave", () => Object.assign(btn.style, { opacity: "0", pointerEvents: "none" }));
    }
  }

  // Profile header: badges on the profile picture (/<user>/photo) and the banner (/<user>/header_photo).
  // The image URLs only need their size suffix removed to get the largest file X keeps (400×400 and 1500×500).
  function injectProfileImages() {
    const kinds = [
      ["profile", "photo", /\/profile_images\//, (src) => src.replace(/_(normal|bigger|mini|\d+x\d+)(\.\w+)$/, "$2")],
      ["banner", "header_photo", /\/profile_banners\//, (src) => src.replace(/\/\d+x\d+$/, "")],
    ];
    for (const [kind, suffix, pattern, original] of kinds) {
      for (const a of document.querySelectorAll(`a[href$="/${suffix}"]`)) {
        const [username, last, extra] = (a.getAttribute("href") || "").split("/").filter(Boolean);
        if (last !== suffix || extra || RESERVED.has(username.toLowerCase())) continue;
        const img = [...a.querySelectorAll("img")].find((i) => pattern.test(i.src));
        if (!img || a.getBoundingClientRect().width < 60) continue;
        const current = a.querySelector(`:scope > .${BTN}[data-md-kind="${kind}"]`);
        if (current?.dataset.mdUser === username) continue;
        current?.remove(); // left over from the previous profile after in-app navigation
        if (getComputedStyle(a).position === "static") a.style.position = "relative";
        const btn = makeButton(kind, () => ({ type: kind === "banner" ? "banner" : "profilePicture", username, url: original(img.src) }), {
          position: "absolute",
          right: kind === "banner" ? "8px" : "4px",
          bottom: kind === "banner" ? "8px" : "4px",
          width: "32px",
          height: "32px",
          background: "#fff",
          color: "#0f1419",
          zIndex: "2",
          boxShadow: "0 1px 4px rgba(0,0,0,.35)",
        });
        btn.dataset.mdUser = username;
        btn.querySelector("svg").setAttribute("width", "28");
        btn.querySelector("svg").setAttribute("height", "28");
        a.append(btn);
      }
    }
  }

  function injectAll() {
    if (!enabled()) return;
    injectActionBars();
    injectThumbnails();
    injectProfileImages();
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

  // The background worker reports once every file of a click has finished: how many were saved, which failed,
  // and how many got their date. The toast says "Downloading…" until then.
  let lastButton = null;
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "batchResult") return;
    diag("batch result", msg);
    const { kind, text } = MDReport.summary(msg);
    toast(text, kind);
    flash(lastButton, { success: "#00ba7c", warning: "#b26a00", error: "#f4212e" }[kind]);
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
    observer.observe(document.body, { childList: true, subtree: true });
    injectAll();
  });
})();
