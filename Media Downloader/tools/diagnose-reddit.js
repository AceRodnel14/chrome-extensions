// mediadownloader: Reddit health check.
//
// Run it when Reddit downloads stop working, to see which piece Reddit changed:
//   1. Open a subreddit on www.reddit.com with image, gallery and video posts, in the browser where mediadownloader
//      is installed, and scroll a little so several posts are loaded.
//   2. Press F12 → Console, paste this whole file, press Enter.
//   3. Read the table. FAIL rows say what broke; context.md → "When Reddit changes something" says what to do.
//
// It only reads; nothing is downloaded and no settings are changed.
(async () => {
  const HOSTED = new Set(["i.redd.it", "v.redd.it", "reddit.com", "www.reddit.com"]);
  const rows = [];
  const add = (check, result, detail = "") => rows.push({ check, result, detail: String(detail).slice(0, 160) });

  // ---- post elements and their attributes (what sites/reddit.js reads to place buttons)
  const posts = [...document.querySelectorAll("shreddit-post")];
  add("Post elements", posts.length ? "PASS" : "FAIL", posts.length ? `${posts.length} shreddit-post` : "no shreddit-post elements; Reddit changed its post element (or this is old.reddit.com, which is not supported)");
  const kinds = posts.reduce((acc, p) => {
    const k = `${p.getAttribute("post-type")} @ ${p.getAttribute("domain")}`;
    return { ...acc, [k]: (acc[k] || 0) + 1 };
  }, {});
  const attrsOk = posts.length && posts.every((p) => p.getAttribute("post-type") && p.getAttribute("domain") && /^t3_/.test(p.id));
  add("Post attributes (post-type, domain, id)", attrsOk ? "PASS" : posts.length ? "FAIL" : "SKIP", JSON.stringify(kinds));
  const slotOk = posts[0]?.shadowRoot?.querySelector('slot[name="action-row-whitespace"]');
  add("Action row slot", slotOk ? "PASS" : posts.length ? "FAIL" : "SKIP", slotOk ? "action-row-whitespace" : 'no slot[name="action-row-whitespace"] in the post\'s shadow root; buttons will not show');

  // ---- JSON for a post with hosted media
  const hosted = posts.find((p) => HOSTED.has((p.getAttribute("domain") || "").toLowerCase()) && /^(image|gallery|video|gif)$/.test(p.getAttribute("post-type")));
  let data = null;
  if (hosted) {
    try {
      const r = await fetch(`/by_id/${hosted.id}.json?raw_json=1`, { credentials: "include" });
      data = r.ok ? (await r.json())?.data?.children?.[0]?.data : null;
      add("Post lookup (/by_id/<id>.json)", data ? "PASS" : "FAIL", data ? `${hosted.id}: ${data.post_hint || (data.is_gallery ? "gallery" : "?")}, by ${data.author}, created_utc ${data.created_utc}` : `HTTP ${r.status}`);
    } catch (err) {
      add("Post lookup (/by_id/<id>.json)", "FAIL", err.message);
    }
  } else add("Post lookup (/by_id/<id>.json)", "SKIP", "no image/gallery/video post with Reddit-hosted media loaded");

  const gallery = posts.find((p) => p.getAttribute("post-type") === "gallery");
  if (gallery) {
    const g = (await (await fetch(`/by_id/${gallery.id}.json?raw_json=1`)).json())?.data?.children?.[0]?.data;
    const first = g?.gallery_data?.items?.[0];
    const meta = first && g.media_metadata?.[first.media_id];
    add("Gallery data", meta?.m ? "PASS" : "FAIL", meta?.m ? `${g.gallery_data.items.length} items, first ${meta.e} ${meta.m}` : "no gallery_data.items / media_metadata[id].m");
    if (meta?.m) {
      const url = `https://i.redd.it/${first.media_id}.${meta.m.split("/")[1]}`;
      try {
        const r = await fetch(url, { method: "HEAD" });
        add("Original image (i.redd.it)", r.ok ? "PASS" : "FAIL", `${url}: HTTP ${r.status}`);
      } catch (err) {
        add("Original image (i.redd.it)", "INFO", `${url}: ${err.message} (CORS; the extension downloads it without reading it)`);
      }
    }
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

  // ---- buttons
  const eligible = posts.filter((p) => HOSTED.has((p.getAttribute("domain") || "").toLowerCase()) && /^(image|gallery|video|gif|crosspost)$/.test(p.getAttribute("post-type")));
  const withButton = eligible.filter((p) => p.querySelector(":scope > .md-download-btn"));
  const external = posts.filter((p) => !HOSTED.has((p.getAttribute("domain") || "").toLowerCase()) && p.querySelector(":scope > .md-download-btn"));
  add("mediadownloader buttons", eligible.length && withButton.length === eligible.length ? "PASS" : eligible.length ? "FAIL" : "SKIP",
    `${withButton.length} of ${eligible.length} Reddit-hosted media posts have one`);
  add("No buttons on links to other sites", external.length ? "FAIL" : "PASS", external.length ? `${external.length} external posts have a button` : "");

  console.table(rows);
  const failed = rows.filter((r) => r.result === "FAIL");
  console.log(failed.length ? `${failed.length} problem(s): see context.md → "When Reddit changes something".` : "Everything mediadownloader needs from Reddit works.");
})();
