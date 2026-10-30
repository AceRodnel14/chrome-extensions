// mediadownloader: Instagram health check.
//
// Run it when downloads stop working, to see which piece Instagram changed:
//   1. Open a profile on instagram.com that has posts, ideally with highlights and a current story
//      (logged in, in the browser where mediadownloader is installed).
//   2. Press F12 → Console, paste this whole file, press Enter.
//   3. Read the table. FAIL rows say what broke; context.md → "When Instagram changes something" says what to do.
//
// Legend: PASS = works. FAIL = broken, needs action (a "CHANGED:" detail means Instagram renumbered something).
// SKIP = not checked, the page has nothing to test it with. INFO = information, or normal on some pages.
//
// It only reads; nothing is downloaded, clicked or changed, and no settings are touched. The only POSTs are
// Instagram's own read-only GraphQL queries (the same ones the extension sends); opening the story/highlight queries
// does not mark anything as seen. The function returns the rows, so a script can read them (CDP Runtime.evaluate
// with awaitPromise). The constants below are copies from sites/instagram.js; keep them in sync.
(async () => {
  // keep in sync with sites/instagram.js:7 (IG_APP_ID), :12-16 (DOC ids), :17 (REELS_FLAGS), :19-27 (PROFILE_FLAGS)
  const IG_APP_ID = "936619743392459";
  const BUILT_IN = {
    PolarisStoriesV3HighlightsPageQuery: "29299425373007309",
    PolarisProfilePageContentQuery: "40158838120366999",
    PolarisSearchBoxNonProfiledRefetchableQuery: "27634848489527274",
  };
  const PROFILE_FLAGS = {
    __relay_internal__pv__PolarisCannesGuardianExperienceEnabledrelayprovider: true,
    __relay_internal__pv__PolarisCASB976ProfileEnabledrelayprovider: false,
    __relay_internal__pv__PolarisProfileInformTreatmentBannerEnabledrelayprovider: false,
    __relay_internal__pv__PolarisWebSchoolsEnabledrelayprovider: false,
    __relay_internal__pv__PolarisProfileRingsGradientEnabledrelayprovider: false,
    __relay_internal__pv__PolarisRepostsConsumptionEnabledrelayprovider: true,
    __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
  };
  const REELS_FLAGS = { __relay_internal__pv__PolarisCommunityNoteStoriesLabelEnabledrelayprovider: true };

  const rows = [];
  const add = (check, result, detail = "") => rows.push({ check, result, detail: String(detail).slice(0, 160) });
  const short = (v) => JSON.stringify(v)?.slice(0, 140);
  // One failing check never aborts the table.
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (err) {
      add(name, "FAIL", err.message);
    }
  };
  // Request with a timeout. Resolves { status, ok, text, json, notJson }; rejects with "timed out after 10 s" or the network error.
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

  // ---- what is on this page
  const [first] = location.pathname.split("/").filter(Boolean);
  const reserved = ["p", "reel", "reels", "stories", "explore", "direct", "accounts"];
  const pageUser = first && !reserved.includes(first) ? first : null;
  const postCode = [...document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')]
    .map((a) => a.getAttribute("href").match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)?.[1]).find(Boolean);
  const highlightId = [...document.querySelectorAll('a[href*="/stories/highlights/"]')]
    .map((a) => a.getAttribute("href").match(/highlights\/(\d+)/)?.[1]).find(Boolean);

  // ---- page and extension
  add("Page", "INFO", `${location.hostname}${location.pathname} (${pageUser ? `profile of ${pageUser}` : `not a profile page${first ? `: /${first}` : ""}; open a profile for the full check`})`);
  add("Chrome version", "INFO", navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || "unknown");
  const allButtons = [...document.querySelectorAll(".md-download-btn")];
  add("mediadownloader active in this tab", allButtons.length ? "PASS" : "INFO",
    allButtons.length ? `${allButtons.length} buttons ${JSON.stringify(countBy(allButtons, "mdKind"))}` : "no buttons: extension not loaded, site disabled in Settings, or page not supported");

  // ---- session and tokens
  const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
  const lsd = ([...document.scripts].map((s) => s.textContent).join(" ").match(/"LSD",\[\],\{"token":"(.*?)"/) || [])[1];
  const dtsg = ([...document.scripts].map((s) => s.textContent).join(" ").match(/"DTSGInitialData",\[\],\{"token":"(.*?)"/) || [])[1];
  add("Logged in", document.cookie.includes("ds_user_id") ? "PASS" : "FAIL", document.cookie.includes("ds_user_id") ? "" : "log in to Instagram");
  add("CSRF token (cookie)", csrf ? "PASS" : "FAIL", csrf ? "" : "no csrftoken cookie");
  add("LSD token (page scripts)", lsd ? "PASS" : "FAIL", lsd ? "" : 'pattern "LSD",[],{"token":"…"} not found in the page; GraphQL calls will fail');
  add("fb_dtsg token (page scripts)", dtsg ? "PASS" : "FAIL", dtsg ? "" : 'pattern "DTSGInitialData",[],{"token":"…"} not found in the page; GraphQL calls will fail');

  // ---- current GraphQL ids in Instagram's scripts
  const current = {};
  await step("doc_id lookup in Instagram's scripts", async () => {
    const scripts = [...new Set([...performance.getEntriesByType("resource").map((e) => e.name), ...[...document.scripts].map((s) => s.src)]
      .filter((u) => /\/rsrc\.php\/.*\.js/.test(u)))];
    // each script is fetched with its own timeout; a slow or failed one counts as empty
    const texts = await Promise.all(scripts.map((u) => getJSON(u, {}, 15000).then((r) => r.text).catch(() => "")));
    for (const name of Object.keys(BUILT_IN)) {
      const re = new RegExp(`__d\\("${name}_instagramRelayOperation",\\[\\],\\(function\\([^)]*\\)\\{[^}]*?"(\\d{10,})"`);
      current[name] = texts.map((t) => t.match(re)?.[1]).find(Boolean) || null;
      if (!current[name]) add(`doc_id ${name}`, "INFO", `not in the ${scripts.length} scripts on this page (normal on some pages); built-in ${BUILT_IN[name]}`);
      else if (current[name] === BUILT_IN[name]) add(`doc_id ${name}`, "PASS", `${current[name]} (same as built-in)`);
      else add(`doc_id ${name}`, "FAIL", `CHANGED: Instagram uses ${current[name]}, built-in is ${BUILT_IN[name]}`);
    }
  });
  const docId = (name) => current[name] || BUILT_IN[name];

  // ---- request helpers (same as sites/instagram.js)
  const call = (url, init) => getJSON(url, { credentials: "include", ...init, headers: { "X-IG-App-ID": IG_APP_ID, ...(init?.headers || {}) } });
  const gql = (name, variables) =>
    call("/api/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-FB-LSD": lsd || "", "X-CSRFToken": csrf || "" },
      body: new URLSearchParams({ doc_id: docId(name), variables: JSON.stringify(variables), lsd: lsd || "", fb_dtsg: dtsg || "", server_timestamps: "true" }),
    });
  const problem = (res) =>
    res.status === 429 ? "HTTP 429 rate limited: wait a few minutes" :
    res.status !== 200 ? `HTTP ${res.status}` :
    !res.json ? `not JSON (a web page?): ${res.text.slice(0, 60)}` :
    !res.json.data && res.json.errors ? `Instagram error: ${short(res.json.errors[0])}` : null;

  // ---- post lookup (posts, reels, carousels)
  let ownerName = null;
  const POST_CHECK = "Post lookup  GET /api/v1/media/{id}/info/";
  if (!postCode) add("Post lookup", "SKIP", "no post or reel link on this page; open a profile");
  else {
    await step(POST_CHECK, async () => {
      const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      let id = 0n;
      for (const ch of postCode.length > 28 ? postCode.slice(0, -28) : postCode) id = id * 64n + BigInt(A.indexOf(ch));
      const res = await call(`/api/v1/media/${id}/info/`);
      const item = res.json?.items?.[0];
      const media = item?.carousel_media?.[0] || item;
      const fileUrl = media?.video_versions?.[0]?.url || media?.image_versions2?.candidates?.[0]?.url;
      ownerName = item?.user?.username || null;
      if (problem(res)) add(POST_CHECK, "FAIL", problem(res));
      else if (!fileUrl) add(POST_CHECK, "FAIL", `answered, but no video_versions/image_versions2 in items[0]: keys ${short(Object.keys(item || {}))}`);
      else {
        add(POST_CHECK, "PASS", `${postCode} by ${ownerName}, ${item.carousel_media ? `carousel of ${item.carousel_media.length}` : media.video_versions ? "video" : "image"}`);
        await step("File download from CDN", async () => {
          const cdn = await getJSON(fileUrl, { headers: { Range: "bytes=0-1023" } });
          add("File download from CDN", [200, 206].includes(cdn.status) ? "PASS" : "FAIL", `HTTP ${cdn.status} ${new URL(fileUrl).hostname}`);
        });
      }
    });
  }

  // ---- username -> user ID
  const username = pageUser || ownerName;
  let userId = null;
  if (!username) add("User search", "SKIP", "no username on this page");
  else {
    await step("User search (GraphQL)", async () => {
      const res = await gql("PolarisSearchBoxNonProfiledRefetchableQuery", { hasQuery: true, query: username });
      const users = res.json?.data?.xdt_api__v1__fbsearch__non_profiled_serp?.users;
      userId = users?.find((u) => u.username?.toLowerCase() === username.toLowerCase())?.id || null;
      add("User search (GraphQL)", problem(res) ? "FAIL" : userId ? "PASS" : "FAIL",
        problem(res) || (userId ? `${username} → ${userId}` : users ? `${users.length} results, none named ${username}` : `no xdt_api__v1__fbsearch__non_profiled_serp.users: data keys ${short(Object.keys(res.json?.data || {}))}`));
    });
  }

  // ---- profile picture
  if (!userId) add("Profile query (HD profile picture)", "SKIP", "needs the user ID from the search");
  else {
    await step("Profile query (HD profile picture)", async () => {
      const res = await gql("PolarisProfilePageContentQuery", { enable_integrity_filters: true, id: userId, ...PROFILE_FLAGS });
      const hd = res.json?.data?.user?.hd_profile_pic_url_info?.url;
      add("Profile query (HD profile picture)", problem(res) ? "FAIL" : hd ? "PASS" : "FAIL",
        problem(res) ? `${problem(res)} (an "execution error" usually means the relay provider flags changed)` :
        hd ? "hd_profile_pic_url_info found" : `no data.user.hd_profile_pic_url_info: user keys ${short(Object.keys(res.json?.data?.user || {}))}`);
    });
  }

  // ---- stories and highlights
  const reelsQuery = (check, reelId) =>
    step(check, async () => {
      const res = await gql("PolarisStoriesV3HighlightsPageQuery", { first: 1, initial_reel_id: reelId, reel_ids: [reelId], ...REELS_FLAGS });
      const conn = res.json?.data?.xdt_api__v1__feed__reels_media__connection;
      const items = conn?.edges?.[0]?.node?.items;
      add(check, problem(res) ? "FAIL" : conn ? "PASS" : "FAIL",
        problem(res) || (conn ? (items?.length ? `${items.length} items` : "query works; no active items right now") :
          `no xdt_api__v1__feed__reels_media__connection: data keys ${short(Object.keys(res.json?.data || {}))}`));
    });
  if (!userId) add("Story query (GraphQL)", "SKIP", "needs the user ID from the search");
  else await reelsQuery("Story query (GraphQL)", userId);
  if (!highlightId) add("Highlight query (GraphQL)", "SKIP", "no highlight on this page; open a profile that has highlights");
  else await reelsQuery("Highlight query (GraphQL)", `highlight:${highlightId}`);

  // ---- page structure the buttons rely on
  const sampleEl = document.querySelector('svg[aria-label="Like"], a[href*="/p/"], header img');
  add("React data readable (reels viewer, story slides)", sampleEl && Object.keys(sampleEl).some((k) => k.startsWith("__reactFiber")) ? "PASS" : "INFO",
    sampleEl ? "" : "no sample element on this page");
  if (pageUser) {
    const avatar = [...document.querySelectorAll("header img, main img")].find((i) => i.alt?.toLowerCase() === `${pageUser.toLowerCase()}'s profile picture`);
    add("Profile picture element", avatar ? "PASS" : "FAIL", avatar ? `alt "${avatar.alt}"` : `no img with alt "${pageUser}'s profile picture" (the badge will not appear)`);
  }

  // ---- summary
  console.table(rows);
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.result]: (acc[r.result] || 0) + 1 }), {});
  const failed = rows.filter((r) => r.result === "FAIL").map((r) => r.check);
  console.log(`mediadownloader Instagram health check: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}.` +
    (failed.length ? `\nFailed: ${failed.join("; ")}\nSee context.md → "When Instagram changes something". Reload the extension and the tab, then run again.` : ""));
  return rows;
})();
