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
// It only reads: it never clicks a tile (to check the post part, open one post first), at most ONE ranged request to the
// image CDN, nothing is downloaded or changed, and no settings are touched. The function returns the rows, so a script can read
// them (CDP Runtime.evaluate with awaitPromise). The code below is copied from sites/rednote.js; keep it in sync.
// Run it in the page's world (DevTools console, or CDP Runtime.evaluate): it reads window.__INITIAL_STATE__.
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

  // keep in sync with sites/rednote.js (parseState, unref)
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
  // keep in sync with sites/rednote.js (pageState)
  const script = [...document.scripts].find((s) => s.textContent.includes("window.__INITIAL_STATE__"));

  // ---- page and extension
  const uid = location.pathname.match(/^\/user\/profile\/([0-9a-f]+)/)?.[1] || document.querySelector("section.note-item a.cover")?.getAttribute("href")?.match(/\/user\/profile\/([0-9a-f]+)/)?.[1] || null; // keep in sync with profileUid
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
  // keep in sync with sites/rednote.js (basicInfoFor)
  const cards = (unref(unref(state0?.user)?.notes) || []).flat();
  const stateIsThisProfile = Boolean(uid) && cards.some((c) => c?.noteCard?.user?.userId === uid);
  if (stateIsThisProfile) {
    add("State matches this profile (post cards' noteCard.user.userId)", "PASS", uid);
    add("State RedNote ID equals the one on screen", basic?.redId === domId ? "PASS" : "FAIL", `state ${basic?.redId} / screen ${domId}`);
  } else {
    add("State matches this profile (post cards' noteCard.user.userId)", "INFO", `state has ${cards.length} cards, none by ${uid}: normal after in-app navigation (the extension then uses the screen)`);
  }

  // ---- tiles (what sites/rednote.js reads to place buttons and to find the post)
  // keep in sync with sites/rednote.js (tileTarget, injectTiles)
  const tiles = [...document.querySelectorAll("section.note-item")];
  add("Post tiles (section.note-item)", tiles.length ? "PASS" : uid ? "FAIL" : "SKIP", tiles.length ? `${tiles.length} tiles` : "none; RedNote changed its grid (or a login wall covers it)");
  const cover = tiles[0]?.querySelector("a.cover");
  const href = cover && new URL(cover.getAttribute("href"), location.origin);
  const noteId = href?.pathname.match(/\/user\/profile\/[0-9a-f]+\/([0-9a-f]+)/)?.[1];
  add("First tile link (a.cover: post id; clicking it opens the post)", noteId ? "PASS" : tiles.length ? "FAIL" : "SKIP", noteId || "no /user/profile/<uid>/<id> link");
  const tilesWith = tiles.filter((t) => t.querySelector(".md-download-btn")).length;
  add("mediadownloader buttons on tiles", tiles.length && tilesWith === tiles.length ? "PASS" : tiles.length ? "FAIL" : "SKIP", `${tilesWith} of ${tiles.length} tiles have one`);
  const avatar = document.querySelector(".user-info > .avatar > .avatar-wrapper");
  add("Profile picture holder (.user-info > .avatar > .avatar-wrapper)", avatar ? "PASS" : uid ? "FAIL" : "SKIP", avatar?.querySelector(".md-download-btn") ? "has a button" : "no button");

  // ---- the opened post (only when one is open: /discovery/item/<id>). The page-world bridge answers only then.
  // keep in sync with sites/rednote.js (readNote, parseReply, originalUrl, sniffExt) and sites/rednote-page.js
  const openId = location.pathname.match(/^\/discovery\/item\/([0-9a-f]+)/)?.[1] || null;
  const ORIGINAL_PATH = /^(?:[a-z0-9_-]{1,20}\/){0,2}[A-Za-z0-9_-]{8,80}$/;
  if (!openId) {
    for (const c of ["Page bridge answers (md:rednote-note)", "Page state has the open post (note.noteDetailMap[id])", "Post fields (type, time, author, files)", "Original image URL matches the allowed pattern", "Original image probe (ranged GET, magic bytes)"]) add(c, "SKIP", "no post is open: click a tile (or open /discovery/item/<id>), then run again");
  } else {
    let reply = null;
    await step("Page bridge answers (md:rednote-note)", async () => {
      const el = document.documentElement;
      el.removeAttribute("data-md-note");
      el.setAttribute("data-md-want", openId);
      el.dispatchEvent(new CustomEvent("md:rednote-note", { bubbles: true }));
      const raw = el.getAttribute("data-md-note");
      el.removeAttribute("data-md-note");
      el.removeAttribute("data-md-want");
      reply = raw ? JSON.parse(raw) : null;
      add("Page bridge answers (md:rednote-note)", reply ? "PASS" : "FAIL", reply ? Object.keys(reply).join(", ") : "no data-md-note attribute: rednote-page.js (world MAIN) is not running; reload the extension and the tab");
    });
    const inMap = unref(unref(unref(unref(window.__INITIAL_STATE__)?.note)?.noteDetailMap)?.[openId]);
    // window.__INITIAL_STATE__ is only visible here when this script runs in the page's world (DevTools console does).
    add("Page state has the open post (note.noteDetailMap[id])", reply && !reply.error ? "PASS" : "FAIL", reply?.error || (inMap ? "present" : "no note.noteDetailMap[id].note"));
    if (reply && !reply.error) {
      const img = reply.imageList?.[0];
      const clip = Object.values(reply.video?.stream || {}).find((l) => l.length)?.[0]?.masterUrl;
      add("Post fields (type, time, author, files)", (reply.type === "normal" || reply.type === "video") && Number.isFinite(reply.time) && reply.user?.userId && (reply.type === "video" ? clip : img) ? "PASS" : "FAIL",
        `${reply.type}, ${reply.imageList?.length} images, time ${reply.time}, author ${reply.user?.userId}${uid && reply.user?.userId !== uid ? ` (NOT profile ${uid})` : ""}`);
      const live = (reply.imageList || []).filter((i) => i.livePhoto).length;
      add("Live photos in this post", "INFO", live ? `${live}` : "none");
      const fromUrl = (u) => { try { return new URL(u).pathname.match(/^\/\d+\/[0-9a-f]+\/([^!?#]+)/)?.[1] || null; } catch { return null; } };
      const path = ORIGINAL_PATH.test(img?.fileId || "") ? img.fileId : fromUrl(img?.urlDefault);
      const original = path && ORIGINAL_PATH.test(path) ? `https://ci.xiaohongshu.com/${path}` : null;
      add("Original image URL matches the allowed pattern", original ? "PASS" : reply.type === "video" ? "SKIP" : "FAIL", original || (reply.type === "video" ? "video post" : `fileId ${JSON.stringify(img?.fileId)}, urlDefault ${String(img?.urlDefault).slice(0, 80)}`));
      if (original) {
        // The CDN has no CORS headers, so this can fail from the page: the extension's background worker is what really probes.
        try {
          const r = await fetch(original, { headers: { Range: "bytes=0-15" }, signal: AbortSignal.timeout(15000) });
          const b = [...new Uint8Array(await r.arrayBuffer()).slice(0, 16)];
          const at = (i, t) => [...t].every((c, k) => b[i + k] === c.charCodeAt(0));
          const type = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "jpg" : b[0] === 0x89 && at(1, "PNG") ? "png" : at(0, "RIFF") && at(8, "WEBP") ? "webp" : at(0, "GIF8") ? "gif" : at(4, "ftyp") ? "heic/avif" : "unknown";
          add("Original image probe (ranged GET, magic bytes)", r.status === 206 || r.status === 200 ? "PASS" : "FAIL", `HTTP ${r.status}, ${r.headers.get("content-type")}, sniffed ${type}`);
        } catch (err) {
          // ci.xiaohongshu.com sends no CORS headers: a network error / TypeError here is expected, not a failure.
          add("Original image probe (ranged GET, magic bytes)", "INFO", "CDN not readable from the page (CORS); the extension's background worker probes it");
        }
      }
    }
  }

  // ---- profile picture
  // keep in sync with sites/rednote.js (filesFor, kind "profile")
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
