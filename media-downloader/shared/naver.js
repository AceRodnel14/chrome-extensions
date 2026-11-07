// Helpers shared by the Naver sites (sites/naver-blog.js, sites/naver-entertain.js).
// Loaded as a plain script after settings.js and report.js, so it exposes a single global: MDNaver.
// Unit tests load this file with a `module` object (tools/tests/naver-shared.test.js); a content script has none.
// The diagnose scripts are pasted into the console and cannot load this file: they keep copies, marked "keep in sync".
(() => {
  // File extension from the last path segment: jpg or png, else null (gif, webp, none: the picture is skipped).
  function extensionOf(address) {
    let path = String(address).split(/[?#]/)[0];
    try {
      path = new URL(address).pathname;
    } catch {
      // not an absolute URL: the text before ? or # is used as is
    }
    const ext = path.split("/").pop().match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase().replace("jpeg", "jpg");
    return ext === "jpg" || ext === "png" ? ext : null;
  }

  // Korean time (UTC+9) text → epoch ms, or null if it does not parse or is an impossible date. Accepts
  //   "2023. 3. 30. 14:00"          (blog; 24-hour clock)
  //   "2026.09.05. 오후 3:44"        (entertain; 오전 = AM, 오후 = PM: 오전 12 is 00, 오후 12 is 12)
  //   "2026-09-05 15:44:09"         (entertain page data, with seconds)
  function parseKst(text) {
    const s = String(text ?? "");
    let y, mo, d, h, mi, sec;
    const iso = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (iso) {
      [y, mo, d, h, mi, sec] = iso.slice(1).map(Number);
    } else {
      const m = s.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s+(오전|오후)?\s*(\d{1,2}):(\d{2})/);
      if (!m) return null;
      [y, mo, d] = m.slice(1, 4).map(Number);
      h = Number(m[5]);
      mi = Number(m[6]);
      sec = 0;
      if (m[4]) {
        if (h < 1 || h > 12) return null;
        h = (h % 12) + (m[4] === "오후" ? 12 : 0);
      }
    }
    if (h > 23 || mi > 59 || sec > 59) return null;
    const ms = Date.UTC(y, mo - 1, d, h - 9, mi, sec);
    const k = new Date(ms + 9 * 3600000); // back to KST wall-clock to catch impossible dates like 2023. 2. 31.
    const same = k.getUTCFullYear() === y && k.getUTCMonth() === mo - 1 && k.getUTCDate() === d && k.getUTCHours() === h;
    return same ? ms : null;
  }

  // A press name for the file name: ALL whitespace removed, Hangul kept. The zero-width characters are listed because
  // MDSettings.sanitize would turn them back into spaces.
  const stripSpaces = (text) => String(text ?? "").replace(/[\s\u200B-\u200F\u2060-\u206F\uFEFF]/g, "");

  const api = { extensionOf, parseKst, stripSpaces };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.MDNaver = api;
})();
