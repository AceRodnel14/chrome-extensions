// mediadownloader: Reddit health check.
//
// Run it when Reddit downloads stop working, to see which piece Reddit changed:
//   1. Open a subreddit on www.reddit.com with image, gallery and video posts, in the browser where mediadownloader
//      is installed, and scroll a little so several posts are loaded.
//   2. Press F12 → Console, paste this whole file, press Enter.
//   3. Read the table. FAIL rows say what broke; context.md → "When Reddit changes something" says what to do.
//
// Legend: PASS = works. FAIL = broken, needs action. SKIP = not checked, the page has nothing to test it with.
// INFO = information, or normal on some pages.
//
// It only reads (GET/HEAD requests); nothing is downloaded, clicked or changed, and no settings are touched. The
// function returns the rows, so a script can read them (CDP Runtime.evaluate with awaitPromise).
// The constants below are copies from sites/reddit.js; keep them in sync.
(async () => {
  // keep in sync with sites/reddit.js:12-15
  const HOSTED = new Set(["i.redd.it", "v.redd.it", "reddit.com", "www.reddit.com"]);
  const MEDIA_TYPES = new Set(["image", "gallery", "video", "gif", "crosspost"]);
  const isRedgifs = (domain) => /(^|\.)redgifs\.com$/.test(domain);
  // keep in sync with sites/reddit.js:288 (SLOT)
  const SLOT = "action-row-whitespace";

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
  const chrome_ = navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || "unknown";
  const posts = [...document.querySelectorAll("shreddit-post")];
  add("Page", "INFO", `${location.hostname}${location.pathname}${location.hostname === "www.reddit.com" ? (posts.length ? "" : " (no posts here; open a subreddit)") : " (mediadownloader only runs on www.reddit.com)"}`);
  add("Chrome version", "INFO", chrome_);
  const allButtons = [...document.querySelectorAll(".md-download-btn")];
  add("mediadownloader active in this tab", allButtons.length ? "PASS" : "INFO",
    allButtons.length ? `${allButtons.length} buttons ${JSON.stringify(countBy(allButtons, "mdKind"))}` : "no buttons: extension not loaded, site disabled in Settings, or page not supported");

  // ---- post elements and their attributes (what sites/reddit.js reads to place buttons)
  add("Post elements", posts.length ? "PASS" : location.hostname === "www.reddit.com" ? "FAIL" : "SKIP", posts.length ? `${posts.length} shreddit-post` : "no shreddit-post elements; Reddit changed its post element (or this is old.reddit.com, which is not supported)");
  const kinds = posts.reduce((acc, p) => {
    const k = `${p.getAttribute("post-type")} @ ${p.getAttribute("domain")}`;
    return { ...acc, [k]: (acc[k] || 0) + 1 };
  }, {});
  const attrsOk = posts.length && posts.every((p) => p.getAttribute("post-type") && p.getAttribute("domain") && /^t3_/.test(p.id));
  add("Post attributes (post-type, domain, id)", attrsOk ? "PASS" : posts.length ? "FAIL" : "SKIP", JSON.stringify(kinds));
  const slotOk = posts[0]?.shadowRoot?.querySelector(`slot[name="${SLOT}"]`);
  add("Action row slot", slotOk ? "PASS" : posts.length ? "FAIL" : "SKIP", slotOk ? SLOT : `no slot[name="${SLOT}"] in the post's shadow root; buttons will not show`);

  // Same lookup as sites/reddit.js getPost: /comments/<id>.json returns [postListing, commentsListing].
  const lookup = async (id) => {
    const bare = String(id).replace(/^t3_/, "");
    if (!/^[a-z0-9]+$/i.test(bare)) return { status: 0, post: null, badId: true };
    const res = await getJSON(`/comments/${bare}.json?raw_json=1&limit=1`, { credentials: "include" });
    const post = res.ok && Array.isArray(res.json) ? res.json[0]?.data?.children?.[0]?.data || null : null;
    return { status: res.status, notJson: res.notJson, post };
  };
  const why = (res) => (res.badId ? "unexpected post id" : `HTTP ${res.status}${res.notJson ? ", not JSON (a block page?)" : res.post ? "" : ", no [0].data.children[0].data"}`);

  // ---- JSON for a post with hosted media
  const hosted = posts.find((p) => HOSTED.has((p.getAttribute("domain") || "").toLowerCase()) && /^(image|gallery|video|gif)$/.test(p.getAttribute("post-type")));
  const LOOKUP = "Post lookup (/comments/<id>.json)";
  if (hosted) {
    await step(LOOKUP, async () => {
      const res = await lookup(hosted.id);
      const data = res.post;
      add(LOOKUP, data ? "PASS" : "FAIL", data ? `${hosted.id}: ${data.post_hint || (data.is_gallery ? "gallery" : "?")}, by ${data.author}, created_utc ${data.created_utc}` : why(res));
    });
  } else add(LOOKUP, "SKIP", "no image/gallery/video post with Reddit-hosted media loaded");

  const gallery = posts.find((p) => p.getAttribute("post-type") === "gallery");
  if (gallery) {
    await step("Gallery data", async () => {
      const res = await lookup(gallery.id);
      const g = res.post;
      const first = g?.gallery_data?.items?.[0];
      const meta = first && g.media_metadata?.[first.media_id];
      add("Gallery data", meta?.m ? "PASS" : "FAIL", meta?.m ? `${g.gallery_data.items.length} items, first ${meta.e} ${meta.m}` : g ? "no gallery_data.items / media_metadata[id].m" : `post lookup failed: ${why(res)}`);
      if (meta?.m) {
        const url = `https://i.redd.it/${first.media_id}.${meta.m.split("/")[1]}`;
        try {
          const r = await getJSON(url, { method: "HEAD" });
          add("Original image (i.redd.it)", r.ok ? "PASS" : "FAIL", `${url}: HTTP ${r.status}`);
        } catch (err) {
          add("Original image (i.redd.it)", "INFO", `${url}: ${err.message} (CORS; the extension downloads it without reading it)`);
        }
      }
    });
  } else add("Gallery data", "SKIP", "no gallery post loaded");

  // ---- videos: the packaged mp4 (with sound) on the player
  const videoPost = posts.find((p) => p.getAttribute("post-type") === "video" && p.getAttribute("domain") === "v.redd.it");
  const player = videoPost?.querySelector("shreddit-player[packaged-media-json], shreddit-player-2[packaged-media-json]");
  if (videoPost) {
    let mp4s = [];
    try {
      mp4s = JSON.parse(player?.getAttribute("packaged-media-json") || "{}")?.playbackMp4s?.permutations || [];
    } catch {}
    add("Video packaged mp4s (with sound)", mp4s.length ? "PASS" : "FAIL",
      mp4s.length ? mp4s.map((p) => p.source?.dimensions?.height + "p").join(", ") : "no packaged-media-json on the player; videos would have no sound");
  } else add("Video packaged mp4s (with sound)", "SKIP", "no v.redd.it video post loaded");

  // ---- RedGifs: the clip lookup happens in the extension's background worker, so the page cannot test it
  add("RedGifs clip lookup (api.redgifs.com)", "INFO", "runs in the extension; test by clicking the button on a RedGifs post");

  // ---- buttons
  // keep in sync with sites/reddit.js:291-297 (injectPosts): which posts get a button
  const domainOf = (p) => (p.getAttribute("domain") || "").toLowerCase();
  const supported = (p) => {
    const type = p.getAttribute("post-type");
    return (isRedgifs(domainOf(p)) ? type === "link" || type === "crosspost" : MEDIA_TYPES.has(type) && HOSTED.has(domainOf(p))) && /^t3_/.test(p.id);
  };
  const hasButton = (p) => Boolean(p.querySelector(":scope > .md-download-btn"));
  // Posts whose slot Reddit filled itself never get a button (sites/reddit.js:297).
  const slotTaken = (p) => Boolean(p.querySelector(`:scope > [slot="${SLOT}"]:not(.md-download-btn)`));
  const expected = (p) => supported(p) && !slotTaken(p);
  const eligible = posts.filter((p) => expected(p) && !isRedgifs(domainOf(p)));
  const withButton = eligible.filter(hasButton);
  const skipped = posts.filter((p) => supported(p) && slotTaken(p) && !hasButton(p)).length;
  add("mediadownloader buttons", eligible.length && withButton.length === eligible.length ? "PASS" : eligible.length ? "FAIL" : "SKIP",
    `${withButton.length} of ${eligible.length} Reddit-hosted media posts have one${skipped ? ` (${skipped} posts skipped: Reddit filled the slot)` : ""}`);
  const redgifs = posts.filter((p) => expected(p) && isRedgifs(domainOf(p)));
  const redgifsWith = redgifs.filter(hasButton);
  add("RedGifs posts have a button", redgifs.length && redgifsWith.length === redgifs.length ? "PASS" : redgifs.length ? "FAIL" : "SKIP",
    redgifs.length ? `${redgifsWith.length} of ${redgifs.length} RedGifs posts have one` : "no RedGifs post loaded");
  const external = posts.filter((p) => !supported(p) && hasButton(p));
  add("No buttons on links to other sites", external.length ? "FAIL" : "PASS", external.length ? `${external.length} unsupported posts have a button` : "");

  // ---- summary
  console.table(rows);
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.result]: (acc[r.result] || 0) + 1 }), {});
  const failed = rows.filter((r) => r.result === "FAIL").map((r) => r.check);
  console.log(`mediadownloader Reddit health check: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}.` +
    (failed.length ? `\nFailed: ${failed.join("; ")}\nSee context.md → "When Reddit changes something". Reload the extension and the tab, then run again.` : ""));
  return rows;
})();
