// mediadownloader: Instagram health check.
//
// Run it when downloads stop working, to see which piece Instagram changed:
//   1. Open a profile on instagram.com that has posts, ideally with highlights and a current story
//      (logged in, in the browser where mediadownloader is installed).
//   2. Press F12 → Console, paste this whole file, press Enter.
//   3. Read the table. FAIL rows say what broke; context.md → "When Instagram changes something" says what to do.
//
// It only reads; nothing is downloaded and no settings are changed. Opening the story/highlight queries does not
// mark anything as seen. Keep BUILT_IN in sync with DOC in sites/instagram.js.
(async () => {
  const IG_APP_ID = "936619743392459";
  const BUILT_IN = {
    PolarisStoriesV3HighlightsPageQuery: "39400183649572570",
    PolarisProfilePageContentQuery: "28717443601247930",
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

  // ---- session and tokens
  const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
  const lsd = ([...document.scripts].map((s) => s.textContent).join(" ").match(/"LSD",\[\],\{"token":"(.*?)"/) || [])[1];
  add("Logged in", document.cookie.includes("ds_user_id") ? "PASS" : "FAIL", document.cookie.includes("ds_user_id") ? "" : "log in to Instagram");
  add("CSRF token (cookie)", csrf ? "PASS" : "FAIL", csrf ? "" : "no csrftoken cookie");
  add("LSD token (page scripts)", lsd ? "PASS" : "FAIL", lsd ? "" : 'pattern "LSD",[],{"token":"…"} not found in the page; GraphQL calls will fail');

  // ---- current GraphQL ids in Instagram's scripts
  const scripts = [...new Set([...performance.getEntriesByType("resource").map((e) => e.name), ...[...document.scripts].map((s) => s.src)]
    .filter((u) => /\/rsrc\.php\/.*\.js/.test(u)))];
  const texts = await Promise.all(scripts.map((u) => fetch(u).then((r) => r.text()).catch(() => "")));
  const current = {};
  for (const name of Object.keys(BUILT_IN)) {
    const re = new RegExp(`__d\\("${name}_instagramRelayOperation",\\[\\],\\(function\\([^)]*\\)\\{[^}]*?"(\\d{10,})"`);
    current[name] = texts.map((t) => t.match(re)?.[1]).find(Boolean) || null;
    if (!current[name]) add(`doc_id ${name}`, "INFO", `not in the ${scripts.length} scripts on this page (normal on some pages); built-in ${BUILT_IN[name]}`);
    else if (current[name] === BUILT_IN[name]) add(`doc_id ${name}`, "PASS", `${current[name]} (same as built-in)`);
    else add(`doc_id ${name}`, "FAIL", `CHANGED: Instagram uses ${current[name]}, built-in is ${BUILT_IN[name]}`);
  }
  const docId = (name) => current[name] || BUILT_IN[name];

  // ---- request helpers (same as sites/instagram.js)
  async function call(url, init) {
    const r = await fetch(url, { credentials: "include", ...init, headers: { "X-IG-App-ID": IG_APP_ID, ...(init?.headers || {}) } });
    const text = await r.text();
    try {
      return { status: r.status, json: JSON.parse(text) };
    } catch {
      return { status: r.status, json: null, notJson: text.slice(0, 60) };
    }
  }
  const gql = (name, variables) =>
    call("/graphql/query", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-FB-LSD": lsd || "", "X-CSRFToken": csrf || "" },
      body: new URLSearchParams({ doc_id: docId(name), variables: JSON.stringify(variables), lsd: lsd || "", server_timestamps: "true" }),
    });
  const problem = (res) =>
    res.status === 429 ? "HTTP 429 rate limited: wait a few minutes" :
    res.status !== 200 ? `HTTP ${res.status}` :
    !res.json ? `not JSON (a web page?): ${res.notJson}` :
    !res.json.data && res.json.errors ? `Instagram error: ${short(res.json.errors[0])}` : null;

  // ---- what is on this page
  const [first] = location.pathname.split("/").filter(Boolean);
  const reserved = ["p", "reel", "reels", "stories", "explore", "direct", "accounts"];
  const pageUser = first && !reserved.includes(first) ? first : null;
  const postCode = [...document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')]
    .map((a) => a.getAttribute("href").match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)?.[1]).find(Boolean);
  const highlightId = [...document.querySelectorAll('a[href*="/stories/highlights/"]')]
    .map((a) => a.getAttribute("href").match(/highlights\/(\d+)/)?.[1]).find(Boolean);

  // ---- post lookup (posts, reels, carousels)
  let ownerName = null;
  if (!postCode) add("Post lookup", "SKIP", "no post or reel link on this page; open a profile");
  else {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let id = 0n;
    for (const ch of postCode.length > 28 ? postCode.slice(0, -28) : postCode) id = id * 64n + BigInt(A.indexOf(ch));
    const res = await call(`/api/v1/media/${id}/info/`);
    const item = res.json?.items?.[0];
    const media = item?.carousel_media?.[0] || item;
    const fileUrl = media?.video_versions?.[0]?.url || media?.image_versions2?.candidates?.[0]?.url;
    ownerName = item?.user?.username || null;
    if (problem(res)) add("Post lookup  GET /api/v1/media/{id}/info/", "FAIL", problem(res));
    else if (!fileUrl) add("Post lookup  GET /api/v1/media/{id}/info/", "FAIL", `answered, but no video_versions/image_versions2 in items[0]: keys ${short(Object.keys(item || {}))}`);
    else {
      add("Post lookup  GET /api/v1/media/{id}/info/", "PASS", `${postCode} by ${ownerName}, ${item.carousel_media ? `carousel of ${item.carousel_media.length}` : media.video_versions ? "video" : "image"}`);
      const cdn = await fetch(fileUrl, { headers: { Range: "bytes=0-1023" } }).catch((e) => ({ status: String(e) }));
      add("File download from CDN", [200, 206].includes(cdn.status) ? "PASS" : "FAIL", `HTTP ${cdn.status} ${new URL(fileUrl).hostname}`);
    }
  }

  // ---- username -> user ID
  const username = pageUser || ownerName;
  let userId = null;
  if (!username) add("User search", "SKIP", "no username on this page");
  else {
    const res = await gql("PolarisSearchBoxNonProfiledRefetchableQuery", { hasQuery: true, query: username });
    const users = res.json?.data?.xdt_api__v1__fbsearch__non_profiled_serp?.users;
    userId = users?.find((u) => u.username?.toLowerCase() === username.toLowerCase())?.id || null;
    add("User search (GraphQL)", problem(res) ? "FAIL" : userId ? "PASS" : "FAIL",
      problem(res) || (userId ? `${username} → ${userId}` : users ? `${users.length} results, none named ${username}` : `no xdt_api__v1__fbsearch__non_profiled_serp.users: data keys ${short(Object.keys(res.json?.data || {}))}`));
  }

  // ---- profile picture
  if (!userId) add("Profile query (HD profile picture)", "SKIP", "needs the user ID from the search");
  else {
    const res = await gql("PolarisProfilePageContentQuery", { enable_integrity_filters: true, id: userId, ...PROFILE_FLAGS });
    const hd = res.json?.data?.user?.hd_profile_pic_url_info?.url;
    add("Profile query (HD profile picture)", problem(res) ? "FAIL" : hd ? "PASS" : "FAIL",
      problem(res) ? `${problem(res)} (an "execution error" usually means the relay provider flags changed)` :
      hd ? "hd_profile_pic_url_info found" : `no data.user.hd_profile_pic_url_info: user keys ${short(Object.keys(res.json?.data?.user || {}))}`);
  }

  // ---- stories and highlights
  const reelsQuery = async (check, reelId) => {
    const res = await gql("PolarisStoriesV3HighlightsPageQuery", { first: 1, initial_reel_id: reelId, reel_ids: [reelId], ...REELS_FLAGS });
    const conn = res.json?.data?.xdt_api__v1__feed__reels_media__connection;
    const items = conn?.edges?.[0]?.node?.items;
    add(check, problem(res) ? "FAIL" : conn ? "PASS" : "FAIL",
      problem(res) || (conn ? (items?.length ? `${items.length} items` : "query works; no active items right now") :
        `no xdt_api__v1__feed__reels_media__connection: data keys ${short(Object.keys(res.json?.data || {}))}`));
  };
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
  const buttons = document.querySelectorAll(".md-download-btn").length;
  add("mediadownloader buttons on this page", buttons ? "PASS" : "INFO", buttons ? `${buttons} buttons` : "none: extension not loaded in this tab, Instagram disabled in Settings, or placement rules no longer match");

  console.table(rows);
  const failed = rows.filter((r) => r.result === "FAIL");
  console.log(failed.length ? `mediadownloader health check: ${failed.length} FAIL. See context.md → "When Instagram changes something".` : "mediadownloader health check: no failures.");
  return rows;
})();
