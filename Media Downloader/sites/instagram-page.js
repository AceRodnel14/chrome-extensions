// Runs in the page's own JavaScript world (manifest "world": "MAIN"), because only from here can we read
// the React props Instagram attaches to DOM nodes. The isolated content script asks by dispatching
// "md:resolve" on an element; we answer by writing what we found to its data-md-media attribute.
(() => {
  const SHORTCODE = /^[A-Za-z0-9_-]{8,}$/;
  const NUMERIC_ID = /^\d{6,}$/;

  function scan(obj, depth, seen) {
    if (!obj || typeof obj !== "object" || depth > 3 || seen.has(obj) || obj.$$typeof) return null;
    seen.add(obj);
    const looksLikeMedia = "media_type" in obj || "taken_at" in obj || "image_versions2" in obj;
    const pk = typeof obj.pk === "string" && NUMERIC_ID.test(obj.pk) ? obj.pk : null;
    const code = typeof obj.code === "string" && SHORTCODE.test(obj.code) ? obj.code : null;
    if ((pk && looksLikeMedia) || code) return { pk, code };
    for (const key of Object.keys(obj)) {
      const found = scan(obj[key], depth + 1, seen);
      if (found) return found;
    }
    return null;
  }

  function resolve(el) {
    const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
    for (let fiber = fiberKey && el[fiberKey], depth = 0; fiber && depth < 80; fiber = fiber.return, depth++) {
      const found = scan(fiber.memoizedProps, 0, new Set());
      if (found) return found;
    }
    return null;
  }

  document.addEventListener(
    "md:resolve",
    (e) => {
      const found = e.target instanceof Element ? resolve(e.target) : null;
      if (found) e.target.setAttribute("data-md-media", JSON.stringify(found));
    },
    true
  );
})();
