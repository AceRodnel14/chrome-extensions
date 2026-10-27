// mediadownloader: X (Twitter) health check.
//
// Run it when X downloads stop working, to see which piece X changed:
//   1. Open a profile on x.com that has posts with photos or videos (logged in, in the browser where
//      mediadownloader is installed), and scroll until a post with media is on screen.
//   2. Press F12 → Console, paste this whole file, press Enter.
//   3. Read the table. FAIL rows say what broke; context.md → "When X changes something" says what to do.
//
// Legend: PASS = works. FAIL = broken, needs action (a "CHANGED:" detail means X renumbered something).
// SKIP = not checked, the page has nothing to test it with. INFO = information, or normal on some pages.
//
// It only reads (GET requests); nothing is downloaded, clicked or changed, and no settings are touched. The function
// returns the rows, so a script can read them (CDP Runtime.evaluate with awaitPromise).
// Keep BUILT_IN in sync with DOC in sites/x.js, and the action bar rule with injectActionBars (sites/x.js:398-400).
(async () => {
  const BUILT_IN = { TweetResultByRestId: "a-Xpq8PjX9K6U5cmc1f05A" };
  const BEARER =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

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
  add("Page", "INFO", `${location.hostname}${location.pathname}${/(^|\.)(x|twitter)\.com$/.test(location.hostname) ? "" : " (mediadownloader only runs on x.com / twitter.com)"}`);
  add("Chrome version", "INFO", navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || "unknown");
  const allButtons = [...document.querySelectorAll(".md-download-btn")];
  add("mediadownloader active in this tab", allButtons.length ? "PASS" : "INFO",
    allButtons.length ? `${allButtons.length} buttons ${JSON.stringify(countBy(allButtons, "mdKind"))}` : "no buttons: extension not loaded, site disabled in Settings, or page not supported");

  // ---- session
  const csrf = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1];
  add("Logged in", document.cookie.includes("twid=") ? "PASS" : "FAIL", document.cookie.includes("twid=") ? "" : "log in to X");
  add("CSRF token (ct0 cookie)", csrf ? "PASS" : "FAIL", csrf ? "" : "no ct0 cookie; API calls will fail");

  // ---- page data (what sites/x-page.js reads)
  let store = null;
  let tweets = [];
  let withMedia = null;
  await step("Redux store", async () => {
    const root = document.querySelector("#react-root")?.firstElementChild;
    const rootKey = root && Object.keys(root).find((k) => k.startsWith("__reactFiber"));
    for (let f = rootKey && root[rootKey], d = 0; f && d < 80 && !store; f = f.child, d++) {
      if (f.memoizedProps?.store?.getState) store = f.memoizedProps.store;
    }
    tweets = Object.values(store?.getState()?.entities?.tweets?.entities || {});
    withMedia = tweets.find((t) => t.extended_entities?.media?.length);
    add("Redux store", store ? "PASS" : "FAIL", store ? `${tweets.length} posts loaded` : "no <Provider store> in the React tree; x-page.js cannot read posts by id");
    add("Posts with media in the store", withMedia ? "PASS" : tweets.length ? "FAIL" : "SKIP",
      withMedia ? `e.g. ${withMedia.id_str}: ${withMedia.extended_entities.media.map((m) => m.type).join(", ")}` : tweets.length ? "posts have no extended_entities.media" : "no posts loaded; scroll to a post with media");
    if (withMedia) {
      const users = store.getState().entities.users?.entities || {};
      add("Post owner in the store", users[withMedia.user]?.screen_name ? "PASS" : "FAIL", users[withMedia.user]?.screen_name || `entities.users has no ${withMedia.user}`);
    }
  });

  // Prefer a post with photos or a video as the sample.
  const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
  const hasMedia = (a) => Boolean(a.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]'));
  const mediaArticles = articles.filter(hasMedia);
  const article = mediaArticles[0] || articles[0];
  let propTweet = null;
  const artKey = article && Object.keys(article).find((k) => k.startsWith("__reactFiber"));
  for (let f = artKey && article[artKey], d = 0; f && d < 80 && !propTweet; f = f.return, d++) {
    if (f.memoizedProps?.tweet?.id_str) propTweet = f.memoizedProps.tweet;
  }
  add("Post element", article ? "PASS" : /(^|\.)(x|twitter)\.com$/.test(location.hostname) ? "FAIL" : "SKIP", article ? `${articles.length} articles, ${mediaArticles.length} with photos or video` : 'no article[data-testid="tweet"]; action-bar buttons will be missing');
  add("Post React props", propTweet ? "PASS" : article ? "FAIL" : "SKIP", propTweet ? `tweet ${propTweet.id_str}, user ${typeof propTweet.user === "object" ? propTweet.user.screen_name : propTweet.user}` : "no `tweet` prop above the <article>");
  // keep in sync with sites/x.js:400: an action bar is a [role=group] with Reply and Like/Unlike
  const isBar = (b) => b.querySelector('[data-testid="reply"]') && b.querySelector('[data-testid="like"], [data-testid="unlike"]');
  const bar = article && [...article.querySelectorAll('[role="group"]')].find(isBar);
  add("Action bar", bar ? "PASS" : article ? "FAIL" : "SKIP",
    bar ? [...bar.querySelectorAll("[data-testid]")].map((e) => e.dataset.testid).filter((t) => !t.startsWith("app-")).join(", ") : article ? 'no [role="group"] with reply and like in the post' : "no post loaded");

  // ---- the fallback API query
  const mainSrc = [...document.scripts].map((s) => s.src).find((u) => /\/client-web\/main\.[\w]+\.js/.test(u));
  let current = null;
  if (!mainSrc) add("X main script", "FAIL", "no responsive-web/client-web/main.*.js; X replaced its web app");
  else {
    await step("queryId TweetResultByRestId", async () => {
      const text = (await getJSON(mainSrc, {}, 20000)).text;
      const m = text.match(/queryId:"([^"]+)",operationName:"TweetResultByRestId",operationType:"\w+",metadata:\{featureSwitches:(\[[^\]]*\])/);
      current = m && { id: m[1], features: JSON.parse(m[2]) };
      add("queryId TweetResultByRestId", !current ? "FAIL" : current.id === BUILT_IN.TweetResultByRestId ? "PASS" : "FAIL",
        !current ? "operation not found in main.js" : current.id === BUILT_IN.TweetResultByRestId ? current.id : `CHANGED: built-in ${BUILT_IN.TweetResultByRestId}, X now uses ${current.id}`);
    });
  }

  const testId = withMedia?.id_str || propTweet?.id_str;
  if (testId && current) {
    await step("Post lookup (API)", async () => {
      const params = new URLSearchParams({
        variables: JSON.stringify({ tweetId: testId, withCommunity: false, includePromotedContent: false, withVoice: false }),
        features: JSON.stringify(Object.fromEntries(current.features.map((f) => [f, false]))),
      });
      const res = await getJSON(`/i/api/graphql/${current.id}/TweetResultByRestId?${params}`, {
        credentials: "include",
        headers: { authorization: `Bearer ${BEARER}`, "x-csrf-token": csrf || "", "x-twitter-auth-type": "OAuth2Session", "x-twitter-active-user": "yes" },
      });
      const json = res.json;
      const result = json?.data?.tweetResult?.result;
      const tweet = result?.tweet || result;
      const media = tweet?.legacy?.extended_entities?.media;
      const owner = tweet?.core?.user_results?.result;
      add("Post lookup (API)", media ? "PASS" : "FAIL",
        media ? `${media.map((m) => m.type).join(", ")} by ${owner?.core?.screen_name || owner?.legacy?.screen_name || "?"}`
          : res.notJson ? `HTTP ${res.status}, not JSON (a web page?)` : json?.errors?.[0]?.message || `HTTP ${res.status}, no data.tweetResult.result.legacy.extended_entities (keys: ${Object.keys(json?.data || {})})`);
    });
  } else add("Post lookup (API)", "SKIP", testId ? "no queryId" : "no post loaded");

  // ---- CDN
  const photo = tweets.flatMap((t) => t.extended_entities?.media || []).find((m) => m.type === "photo");
  if (photo) {
    await step("Photo from CDN (name=orig)", async () => {
      const [, base, ext] = photo.media_url_https.match(/^(.*\/media\/[^./?]+)\.(\w+)/) || [];
      if (!base) throw new Error(`unexpected photo URL ${photo.media_url_https}`);
      const r = await getJSON(`${base}?format=${ext}&name=orig`, { headers: { Range: "bytes=0-1023" } });
      add("Photo from CDN (name=orig)", [200, 206].includes(r.status) ? "PASS" : "FAIL", `HTTP ${r.status}, ${r.type}`);
    });
  } else add("Photo from CDN (name=orig)", "SKIP", "no photo post loaded");

  // ---- profile header (only on a profile page)
  const pic = [...document.querySelectorAll('a[href$="/photo"]')].find((a) => a.querySelector('img[src*="/profile_images/"]'));
  const banner = [...document.querySelectorAll('a[href$="/header_photo"]')].find((a) => a.querySelector('img[src*="/profile_banners/"]'));
  add("Profile picture element", pic ? "PASS" : "INFO", pic ? pic.querySelector("img").src : 'no a[href$="/photo"] with a profile_images <img> (fine if this is not a profile page)');
  add("Banner element", banner ? "PASS" : "INFO", banner ? banner.querySelector("img").src : 'no a[href$="/header_photo"] with a profile_banners <img> (some accounts have no banner)');

  // ---- buttons: X shows a post button on every action bar; check the posts with media
  const withButton = mediaArticles.filter((a) => a.querySelector('.md-download-btn[data-md-kind="post"]'));
  add("mediadownloader post buttons", mediaArticles.length ? (withButton.length === mediaArticles.length ? "PASS" : "FAIL") : "SKIP",
    mediaArticles.length ? `${withButton.length} of ${mediaArticles.length} articles with media have a button; kinds ${JSON.stringify(countBy(allButtons, "mdKind"))}` : "no article with photos or video on screen");

  // ---- summary
  console.table(rows);
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.result]: (acc[r.result] || 0) + 1 }), {});
  const failed = rows.filter((r) => r.result === "FAIL").map((r) => r.check);
  console.log(`mediadownloader X health check: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}.` +
    (failed.length ? `\nFailed: ${failed.join("; ")}\nSee context.md → "When X changes something". Reload the extension and the tab, then run again.` : ""));
  return rows;
})();
