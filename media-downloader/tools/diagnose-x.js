// mediadownloader: X (Twitter) health check.
//
// Run it when X downloads stop working, to see which piece X changed:
//   1. Open a profile on x.com that has posts with photos or videos (logged in, in the browser where
//      mediadownloader is installed), and scroll until a post with media is on screen.
//   2. Press F12 → Console, paste this whole file, press Enter.
//   3. Read the table. FAIL rows say what broke; context.md → "When X changes something" says what to do.
//
// Legend: PASS = works. FAIL = broken, needs action (a "CHANGED:" detail means X renumbered something). WARN = differs from the old UI, check the detail.
// SKIP = not checked, the page has nothing to test it with. INFO = information, or normal on some pages.
//
// It only reads (GET requests); nothing is downloaded, clicked or changed, and no settings are touched. The function
// returns the rows, so a script can read them (CDP Runtime.evaluate with awaitPromise).
// Keep BUILT_IN and FEATURES in sync with DOC / TWEET_FEATURES in sites/x.js, and the action bar rule with BAR_PARTS (sites/x.js).
// X serves two web UIs (maybe per account): the old one (React + Redux, data-testid) and a new Tailwind one
// (data-engagement-action, no React props, no main.*.js). The first row says which one this page is; checks that only
// make sense for the old UI become INFO in the new one.
(async () => {
  const BUILT_IN = { TweetResultByRestId: "U8lc5aomF5krJzZ9vJ9wxg" };
  const FEATURES = [
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

  // ---- which web UI
  const oldUi = Boolean(document.querySelector('article[data-testid="tweet"]'));
  // The new UI is also known without a post on screen (Media grid): it has no #react-root and loads x-web/entry-client-*.js.
  const pageIsNew = !document.querySelector("#react-root") && [...document.scripts].some((x) => /\/x-web\/.*entry-client/.test(x.src));
  const newUi = !oldUi && (pageIsNew || Boolean(document.querySelector("article [data-engagement-action]")));
  const onX = /(^|\.)(x|twitter)\.com$/.test(location.hostname);
  add("X web UI", oldUi || newUi ? "INFO" : "SKIP",
    oldUi ? "old (React + Redux, data-testid)" : newUi ? "new (Tailwind, data-engagement-action; posts come from X's API)" : "cannot tell (no post on screen and no page-level sign of the new UI)");

  // ---- page data (what sites/x-page.js reads; the new UI has none, so every click uses one API lookup)
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
    add("Redux store", store ? "PASS" : newUi ? "INFO" : "FAIL", store ? `${tweets.length} posts loaded` : newUi ? "none in the new UI (expected; posts are looked up through X's API)" : "no <Provider store> in the React tree; x-page.js cannot read posts by id");
    if (!store && newUi) return;
    add("Posts with media in the store", withMedia ? "PASS" : tweets.length ? "FAIL" : "SKIP",
      withMedia ? `e.g. ${withMedia.id_str}: ${withMedia.extended_entities.media.map((m) => m.type).join(", ")}` : tweets.length ? "posts have no extended_entities.media" : "no posts loaded; scroll to a post with media");
    if (withMedia) {
      const users = store.getState().entities.users?.entities || {};
      add("Post owner in the store", users[withMedia.user]?.screen_name ? "PASS" : "FAIL", users[withMedia.user]?.screen_name || `entities.users has no ${withMedia.user}`);
    }
  });

  // Prefer a post with photos or a video as the sample.
  // The new UI has no data-testid: a post is an <article> with an engagement bar, media is a pbs.twimg.com image or a <video>.
  const articles = newUi ? [...document.querySelectorAll("article")].filter((a) => a.querySelector("[data-engagement-action]")) : [...document.querySelectorAll('article[data-testid="tweet"]')];
  const hasMedia = (a) => Boolean(a.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"], img[src*="pbs.twimg.com/media/"], video'));
  const mediaArticles = articles.filter(hasMedia);
  const article = mediaArticles[0] || articles[0];
  let propTweet = null;
  const artKey = article && Object.keys(article).find((k) => k.startsWith("__reactFiber"));
  for (let f = artKey && article[artKey], d = 0; f && d < 80 && !propTweet; f = f.return, d++) {
    if (f.memoizedProps?.tweet?.id_str) propTweet = f.memoizedProps.tweet;
  }
  add("Post element", article ? "PASS" : newUi ? "SKIP" : onX ? "FAIL" : "SKIP", article ? `${articles.length} articles, ${mediaArticles.length} with photos or video` : newUi ? "no post on screen (fine on the Media grid; scroll to a post to test the rest)" : 'no <article> with an engagement bar (old UI: article[data-testid="tweet"]); action-bar buttons will be missing');
  add("Post React props", propTweet ? "PASS" : newUi ? "INFO" : article ? "FAIL" : "SKIP", propTweet ? `tweet ${propTweet.id_str}, user ${typeof propTweet.user === "object" ? propTweet.user.screen_name : propTweet.user}` : newUi ? "none in the new UI (expected)" : "no `tweet` prop above the <article>");
  // keep in sync with BAR_PARTS in sites/x.js: an action bar is a [role=group] with Reply and Like/Unlike (either UI)
  const isBar = (b) =>
    (b.querySelector('[data-testid="reply"]') && b.querySelector('[data-testid="like"], [data-testid="unlike"]')) ||
    (b.querySelector('[data-engagement-action="reply"]') && b.querySelector('[data-engagement-action="like"], [data-engagement-action="unlike"]'));
  const bar = article && [...article.querySelectorAll('[role="group"]')].find(isBar);
  add("Action bar", bar ? "PASS" : article ? "FAIL" : "SKIP",
    bar ? [...bar.querySelectorAll("[data-testid], [data-engagement-action]")].map((e) => e.dataset.testid || e.dataset.engagementAction).filter((t) => !t.startsWith("app-")).join(", ") : article ? 'no [role="group"] with reply and like in the post' : "no post loaded");
  // New UI: the post's own id comes from the reply control (/compose/post?in_reply_to=<id>) or the analytics link.
  const uiTweetId = newUi && article
    ? (article.querySelector('[data-engagement-action="reply"] a')?.getAttribute("href")?.match(/^\/compose\/post\?(?:.*&)?in_reply_to=(\d+)(?:&|$)/)?.[1] ||
       article.querySelector('a[href$="/analytics"]')?.getAttribute("href")?.match(/\/status\/(\d+)\/analytics$/)?.[1])
    : null;
  if (newUi && article) add("Post id from the post's own links", uiTweetId ? "PASS" : "FAIL", uiTweetId || "no in_reply_to reply link and no /status/<id>/analytics link in the post");

  // ---- the fallback API query
  const mainSrc = [...document.scripts].map((s) => s.src).find((u) => /\/client-web\/main\.[\w]+\.js/.test(u));
  let current = null;
  if (!mainSrc) add("X main script", newUi ? "WARN" : "FAIL", newUi ? "none in the new UI; the built-in queryId is used (the API lookup below shows if it still works)" : "no responsive-web/client-web/main.*.js; X replaced its web app");
  else {
    await step("queryId TweetResultByRestId", async () => {
      const text = (await getJSON(mainSrc, {}, 20000)).text;
      const m = text.match(/queryId:"([^"]+)",operationName:"TweetResultByRestId",operationType:"\w+",metadata:\{featureSwitches:(\[[^\]]*\])/);
      current = m && { id: m[1], features: JSON.parse(m[2]) };
      add("queryId TweetResultByRestId", !current ? "FAIL" : current.id === BUILT_IN.TweetResultByRestId ? "PASS" : "FAIL",
        !current ? "operation not found in main.js" : current.id === BUILT_IN.TweetResultByRestId ? current.id : `CHANGED: built-in ${BUILT_IN.TweetResultByRestId}, X now uses ${current.id}`);
    });
  }

  const testId = withMedia?.id_str || propTweet?.id_str || uiTweetId;
  // Without main.js (new UI) the built-in queryId and feature list are what the extension uses, so test those.
  const lookup = current || (!mainSrc && newUi ? { id: BUILT_IN.TweetResultByRestId, features: FEATURES } : null);
  let apiPhoto = null;
  if (testId && lookup) {
    await step("Post lookup (API)", async () => {
      const params = new URLSearchParams({
        variables: JSON.stringify({ tweetId: testId, withCommunity: false, includePromotedContent: false, withVoice: false }),
        features: JSON.stringify(Object.fromEntries(lookup.features.map((f) => [f, false]))),
      });
      const res = await getJSON(`/i/api/graphql/${lookup.id}/TweetResultByRestId?${params}`, {
        credentials: "include",
        headers: { authorization: `Bearer ${BEARER}`, "x-csrf-token": csrf || "", "x-twitter-auth-type": "OAuth2Session", "x-twitter-active-user": "yes" },
      });
      const json = res.json;
      const result = json?.data?.tweetResult?.result;
      const tweet = result?.tweet || result;
      const media = tweet?.legacy?.extended_entities?.media;
      const owner = tweet?.core?.user_results?.result;
      apiPhoto = media?.find((m) => m.type === "photo");
      add("Post lookup (API)", media ? "PASS" : "FAIL",
        media ? `${media.map((m) => m.type).join(", ")} by ${owner?.core?.screen_name || owner?.legacy?.screen_name || "?"}`
          : res.notJson ? `HTTP ${res.status}, not JSON (a web page?)` : json?.errors?.[0]?.message || `HTTP ${res.status}, no data.tweetResult.result.legacy.extended_entities (keys: ${Object.keys(json?.data || {})})`);
    });
  } else add("Post lookup (API)", "SKIP", testId ? "no queryId" : "no post loaded");

  // ---- CDN
  const photo = tweets.flatMap((t) => t.extended_entities?.media || []).find((m) => m.type === "photo") || apiPhoto;
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
