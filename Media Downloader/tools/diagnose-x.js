// mediadownloader: X (Twitter) health check.
//
// Run it when X downloads stop working, to see which piece X changed:
//   1. Open a profile on x.com that has posts with photos or videos (logged in, in the browser where
//      mediadownloader is installed), and scroll until a post with media is on screen.
//   2. Press F12 → Console, paste this whole file, press Enter.
//   3. Read the table. FAIL rows say what broke; context.md → "When X changes something" says what to do.
//
// It only reads; nothing is downloaded and no settings are changed. Keep BUILT_IN in sync with DOC in sites/x.js.
(async () => {
  const BUILT_IN = { TweetResultByRestId: "a-Xpq8PjX9K6U5cmc1f05A" };
  const BEARER =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

  const rows = [];
  const add = (check, result, detail = "") => rows.push({ check, result, detail: String(detail).slice(0, 160) });

  // ---- session
  const csrf = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1];
  add("Logged in", document.cookie.includes("twid=") ? "PASS" : "FAIL", document.cookie.includes("twid=") ? "" : "log in to X");
  add("CSRF token (ct0 cookie)", csrf ? "PASS" : "FAIL", csrf ? "" : "no ct0 cookie; API calls will fail");

  // ---- page data (what sites/x-page.js reads)
  let store = null;
  const root = document.querySelector("#react-root")?.firstElementChild;
  const rootKey = root && Object.keys(root).find((k) => k.startsWith("__reactFiber"));
  for (let f = rootKey && root[rootKey], d = 0; f && d < 80 && !store; f = f.child, d++) {
    if (f.memoizedProps?.store?.getState) store = f.memoizedProps.store;
  }
  const tweets = Object.values(store?.getState()?.entities?.tweets?.entities || {});
  const withMedia = tweets.find((t) => t.extended_entities?.media?.length);
  add("Redux store", store ? "PASS" : "FAIL", store ? `${tweets.length} posts loaded` : "no <Provider store> in the React tree; x-page.js cannot read posts by id");
  add("Posts with media in the store", withMedia ? "PASS" : tweets.length ? "FAIL" : "SKIP",
    withMedia ? `e.g. ${withMedia.id_str}: ${withMedia.extended_entities.media.map((m) => m.type).join(", ")}` : tweets.length ? "posts have no extended_entities.media" : "no posts loaded; scroll to a post with media");
  if (withMedia) {
    const users = store.getState().entities.users?.entities || {};
    add("Post owner in the store", users[withMedia.user]?.screen_name ? "PASS" : "FAIL", users[withMedia.user]?.screen_name || `entities.users has no ${withMedia.user}`);
  }

  const article = document.querySelector('article[data-testid="tweet"]');
  let propTweet = null;
  const artKey = article && Object.keys(article).find((k) => k.startsWith("__reactFiber"));
  for (let f = artKey && article[artKey], d = 0; f && d < 80 && !propTweet; f = f.return, d++) {
    if (f.memoizedProps?.tweet?.id_str) propTweet = f.memoizedProps.tweet;
  }
  add("Post element", article ? "PASS" : "FAIL", article ? "" : 'no article[data-testid="tweet"]; action-bar buttons will be missing');
  add("Post React props", propTweet ? "PASS" : article ? "FAIL" : "SKIP", propTweet ? `tweet ${propTweet.id_str}, user ${typeof propTweet.user === "object" ? propTweet.user.screen_name : propTweet.user}` : "no `tweet` prop above the <article>");
  const bar = article?.querySelector('[role="group"]');
  add("Action bar", bar?.querySelector('[data-testid="reply"]') && bar.querySelector('[data-testid="like"], [data-testid="unlike"]') ? "PASS" : article ? "FAIL" : "SKIP",
    bar ? [...bar.querySelectorAll("[data-testid]")].map((e) => e.dataset.testid).filter((t) => !t.startsWith("app-")).join(", ") : 'no [role="group"] in the post');

  // ---- the fallback API query
  const mainSrc = [...document.scripts].map((s) => s.src).find((u) => /\/client-web\/main\.[\w]+\.js/.test(u));
  let current = null;
  if (!mainSrc) add("X main script", "FAIL", "no responsive-web/client-web/main.*.js; X replaced its web app");
  else {
    const text = await (await fetch(mainSrc)).text();
    const m = text.match(/queryId:"([^"]+)",operationName:"TweetResultByRestId",operationType:"\w+",metadata:\{featureSwitches:(\[[^\]]*\])/);
    current = m && { id: m[1], features: JSON.parse(m[2]) };
    add("queryId TweetResultByRestId", !current ? "FAIL" : current.id === BUILT_IN.TweetResultByRestId ? "PASS" : "CHANGED",
      !current ? "operation not found in main.js" : current.id === BUILT_IN.TweetResultByRestId ? current.id : `built-in ${BUILT_IN.TweetResultByRestId}, X now uses ${current.id}`);
  }

  const testId = withMedia?.id_str || propTweet?.id_str;
  if (testId && current) {
    try {
      const params = new URLSearchParams({
        variables: JSON.stringify({ tweetId: testId, withCommunity: false, includePromotedContent: false, withVoice: false }),
        features: JSON.stringify(Object.fromEntries(current.features.map((f) => [f, false]))),
      });
      const r = await fetch(`/i/api/graphql/${current.id}/TweetResultByRestId?${params}`, {
        credentials: "include",
        headers: { authorization: `Bearer ${BEARER}`, "x-csrf-token": csrf || "", "x-twitter-auth-type": "OAuth2Session", "x-twitter-active-user": "yes" },
      });
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      const result = json?.data?.tweetResult?.result;
      const tweet = result?.tweet || result;
      const media = tweet?.legacy?.extended_entities?.media;
      const owner = tweet?.core?.user_results?.result;
      add("Post lookup (API)", media ? "PASS" : "FAIL",
        media ? `${media.map((m) => m.type).join(", ")} by ${owner?.core?.screen_name || owner?.legacy?.screen_name || "?"}`
          : !json ? `HTTP ${r.status}, not JSON (a web page?)` : json.errors?.[0]?.message || `HTTP ${r.status}, no data.tweetResult.result.legacy.extended_entities (keys: ${Object.keys(json.data || {})})`);
    } catch (err) {
      add("Post lookup (API)", "FAIL", err.message);
    }
  } else add("Post lookup (API)", "SKIP", testId ? "no queryId" : "no post loaded");

  // ---- CDN
  const photo = tweets.flatMap((t) => t.extended_entities?.media || []).find((m) => m.type === "photo");
  if (photo) {
    const [, base, ext] = photo.media_url_https.match(/^(.*\/media\/[^./?]+)\.(\w+)/) || [];
    try {
      const r = await fetch(`${base}?format=${ext}&name=orig`);
      add("Photo from CDN (name=orig)", r.ok ? "PASS" : "FAIL", `HTTP ${r.status}, ${r.headers.get("content-type")}`);
    } catch (err) {
      add("Photo from CDN (name=orig)", "FAIL", err.message);
    }
  } else add("Photo from CDN (name=orig)", "SKIP", "no photo post loaded");

  // ---- profile header (only on a profile page)
  const pic = [...document.querySelectorAll('a[href$="/photo"]')].find((a) => a.querySelector('img[src*="/profile_images/"]'));
  const banner = [...document.querySelectorAll('a[href$="/header_photo"]')].find((a) => a.querySelector('img[src*="/profile_banners/"]'));
  add("Profile picture element", pic ? "PASS" : "INFO", pic ? pic.querySelector("img").src : 'no a[href$="/photo"] with a profile_images <img> (fine if this is not a profile page)');
  add("Banner element", banner ? "PASS" : "INFO", banner ? banner.querySelector("img").src : 'no a[href$="/header_photo"] with a profile_banners <img> (some accounts have no banner)');

  const buttons = document.querySelectorAll(".md-download-btn");
  const kinds = [...buttons].reduce((acc, b) => ({ ...acc, [b.dataset.mdKind]: (acc[b.dataset.mdKind] || 0) + 1 }), {});
  add("mediadownloader buttons", buttons.length ? "PASS" : "FAIL", buttons.length ? JSON.stringify(kinds) : "none: extension not loaded in this tab, X disabled in Settings, or placement rules no longer match");

  console.table(rows);
  const failed = rows.filter((r) => r.result === "FAIL" || r.result === "CHANGED");
  console.log(failed.length ? `${failed.length} problem(s): see context.md → "When X changes something".` : "Everything mediadownloader needs from X works.");
})();
