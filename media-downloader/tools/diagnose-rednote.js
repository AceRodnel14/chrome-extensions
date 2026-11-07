// mediadownloader: RedNote health check.
//
// Run it when RedNote downloads stop working, to see which piece RedNote changed:
//   1. Open a user's profile on www.rednote.com (logged in) in the browser where mediadownloader is installed, with
//      image and video posts visible.
//   2. Press F12 → Console, paste this whole file, press Enter.
//   3. Read the table. FAIL rows say what broke; context.md → "When RedNote changes something" says what to do.
//
// Legend: PASS = works. FAIL = broken, needs action. SKIP = not checked, the page has nothing to test it with.
// INFO = information, or normal on some pages.
//
// It only reads: at most ONE request to RedNote (the first tile's post page, like a click does), nothing is
// downloaded, clicked or changed, and no settings are touched. The function returns the rows, so a script can read
// them (CDP Runtime.evaluate with awaitPromise). The code below is copied from sites/rednote.js; keep it in sync.
(async () => {
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

  // keep in sync with sites/rednote.js:24-32 (parseState) and :35 (unref)
  const parseState = (html) => {
    const raw = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/)?.[1];
    if (!raw) return null;
    try {
      return JSON.parse(raw.replace(/new Set\(\[([^\]]*)\]\)/g, "[$1]").replace(/([:[,])undefined(?=[,}\]])/g, "$1null"));
    } catch {
      return null;
    }
  };
  const unref = (v) => (v && typeof v === "object" && v.__v_isRef ? v._value : v);
  // keep in sync with sites/rednote.js:38-41 (pageState)
  const script = [...document.scripts].find((s) => s.textContent.includes("window.__INITIAL_STATE__"));

  // ---- page and extension
  const uid = location.pathname.match(/^\/user\/profile\/([0-9a-f]+)/)?.[1] || null;
  add("Page", "INFO", `${location.hostname}${location.pathname}${uid ? "" : " (open a user's profile: /user/profile/<id>)"}`);
  add("Chrome version", "INFO", navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || "unknown");
  const buttons = [...document.querySelectorAll(".md-download-btn")];
  const kinds = buttons.reduce((acc, b) => ({ ...acc, [b.dataset.mdKind]: (acc[b.dataset.mdKind] || 0) + 1 }), {});
  add("mediadownloader active in this tab", buttons.length ? "PASS" : "INFO",
    buttons.length ? `${buttons.length} buttons ${JSON.stringify(kinds)}` : "no buttons: extension not loaded, site disabled in Settings, or page not supported");

  // ---- the profile's data in the page (state goes stale after in-app navigation, so ids are compared)
  let basic = null;
  const state0 = script ? parseState(`${script.textContent}</script>`) : null;
  await step("Page state (window.__INITIAL_STATE__)", async () => {
    const state = state0;
    add("Page state (window.__INITIAL_STATE__)", state ? "PASS" : "FAIL", state ? `top keys: ${Object.keys(state).slice(0, 8).join(", ")}` : "no parsable window.__INITIAL_STATE__ script");
    basic = unref(unref(unref(state?.user)?.userPageData)?.basicInfo) || null;
  });
  const domId = document.querySelector(".user-redId")?.textContent.replace(/^\s*rednote\s*ID\s*[:：]?\s*/i, "").trim() || "";
  add("RedNote ID on screen (.user-redId)", domId ? "PASS" : uid ? "FAIL" : "SKIP", domId || "no .user-redId; the file name username would be missing");
  // keep in sync with sites/rednote.js:45-52 (basicInfoFor)
  const cards = (unref(unref(state0?.user)?.notes) || []).flat();
  const stateIsThisProfile = Boolean(uid) && cards.some((c) => c?.noteCard?.user?.userId === uid);
  if (stateIsThisProfile) {
    add("State matches this profile (post cards' noteCard.user.userId)", "PASS", uid);
    add("State RedNote ID equals the one on screen", basic?.redId === domId ? "PASS" : "FAIL", `state ${basic?.redId} / screen ${domId}`);
  } else {
    add("State matches this profile (post cards' noteCard.user.userId)", "INFO", `state has ${cards.length} cards, none by ${uid}: normal after in-app navigation (the extension then uses the screen)`);
  }

  // ---- tiles (what sites/rednote.js reads to place buttons and to find the post)
  // keep in sync with sites/rednote.js:295-320 (tileTarget, injectTiles)
  const tiles = [...document.querySelectorAll("section.note-item")];
  add("Post tiles (section.note-item)", tiles.length ? "PASS" : uid ? "FAIL" : "SKIP", tiles.length ? `${tiles.length} tiles` : "none; RedNote changed its grid (or a login wall covers it)");
  const cover = tiles[0]?.querySelector("a.cover");
  const href = cover && new URL(cover.getAttribute("href"), location.origin);
  const noteId = href?.pathname.match(/\/user\/profile\/[0-9a-f]+\/([0-9a-f]+)/)?.[1];
  const token = href?.searchParams.get("xsec_token");
  add("First tile link (a.cover: post id + xsec_token)", noteId && token ? "PASS" : tiles.length ? "FAIL" : "SKIP", noteId ? `${noteId}, token ${token ? "present" : "MISSING"}` : "no /user/profile/<uid>/<id> link");
  const tilesWith = tiles.filter((t) => t.querySelector(".md-download-btn")).length;
  add("mediadownloader buttons on tiles", tiles.length && tilesWith === tiles.length ? "PASS" : tiles.length ? "FAIL" : "SKIP", `${tilesWith} of ${tiles.length} tiles have one`);
  const avatar = document.querySelector(".user-info > .avatar > .avatar-wrapper");
  add("Profile picture holder (.user-info > .avatar > .avatar-wrapper)", avatar ? "PASS" : uid ? "FAIL" : "SKIP", avatar?.querySelector(".md-download-btn") ? "has a button" : "no button");

  // ---- one post lookup, exactly like a click
  // keep in sync with sites/rednote.js:72-90 (getNote)
  if (noteId && token) {
    await step("Post lookup (/explore/<id>)", async () => {
      const r = await fetch(`/explore/${noteId}?xsec_token=${encodeURIComponent(token)}&xsec_source=pc_user`, { credentials: "include", signal: AbortSignal.timeout(15000) });
      if (r.redirected || r.url.includes("/website-login/")) return add("Post lookup (/explore/<id>)", "FAIL", `security check or login: redirected to ${new URL(r.url).pathname}. Open a post in this tab, solve it, run again`);
      if (r.status !== 200) return add("Post lookup (/explore/<id>)", "FAIL", `HTTP ${r.status}`);
      const state = parseState(await r.text());
      const note = unref(unref(unref(unref(state?.note)?.noteDetailMap)?.[noteId])?.note);
      add("Post lookup (/explore/<id>)", note ? "PASS" : "FAIL", note ? `${note.type}, ${note.imageList?.length} images, time ${note.time}` : "no window.__INITIAL_STATE__ or note.noteDetailMap[id].note");
      if (!note) return;
      // keep in sync with sites/rednote.js:99-102 (streamUrl)
      const streamUrl = (stream) => {
        const e = Object.values(stream || {}).find((l) => Array.isArray(l) && l.length)?.[0];
        return e?.masterUrl || e?.backupUrls?.[0] || null;
      };
      const clip = streamUrl(note.video?.media?.stream);
      const fileId = note.imageList?.[0]?.fileId;
      add("Post files (imageList[].fileId or video stream masterUrl)", clip || fileId ? "PASS" : "FAIL", clip ? `video ${clip.slice(0, 80)}` : fileId ? `${note.imageList.length} images, first ${fileId}` : "neither a fileId nor a masterUrl");
      add("Post time (note.time, ms)", Number.isFinite(note.time) && note.time > 0 ? "PASS" : "FAIL", `${note.time} = ${new Date(note.time).toISOString?.() || "?"}`);
      add("Post author matches the profile", !uid || note.user?.userId === uid ? "PASS" : "FAIL", `post by ${note.user?.userId}, profile ${uid}`);
      const live = (note.imageList || []).filter((i) => i.livePhoto === true).length;
      add("Live photos in this post", "INFO", live ? `${live} (clip ${streamUrl(note.imageList.find((i) => i.livePhoto)?.stream) ? "found" : "MISSING: saved as still only"})` : "none");
      // The CDN is not read from the page (CORS); the extension's background worker HEADs it. Information only.
      add("Original image URL (CDN, not tested here)", "INFO", fileId ? `https://ci.xiaohongshu.com/${fileId}` : "n/a (video post)");
    });
  } else add("Post lookup (/explore/<id>)", "SKIP", "no tile link to look up");

  // ---- profile picture
  // keep in sync with sites/rednote.js:151-157 (filesFor, kind "profile")
  const avatarSrc = (stateIsThisProfile ? basic?.images : null) || document.querySelector(".user-info .avatar img.user-image")?.src;
  add("Profile picture URL", avatarSrc ? "PASS" : uid ? "FAIL" : "SKIP", avatarSrc ? avatarSrc.split("?")[0] : "no basicInfo.images and no avatar image");

  // ---- summary
  console.table(rows);
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.result]: (acc[r.result] || 0) + 1 }), {});
  const failed = rows.filter((r) => r.result === "FAIL").map((r) => r.check);
  console.log(`mediadownloader RedNote health check: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}.` +
    (failed.length ? `\nFailed: ${failed.join("; ")}\nSee context.md → "When RedNote changes something". Reload the extension and the tab, then run again.` : ""));
  return rows;
})();
