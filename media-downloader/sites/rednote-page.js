// Runs in the page's own JavaScript world (manifest "world": "MAIN"), because only from here can we read
// window.__INITIAL_STATE__ as RedNote's app keeps it (Vue refs). Once a post is open, its data is in
// note.noteDetailMap[<id>].note. The isolated content script asks by dispatching "md:rednote-note" on an element
// (data-md-want="<note id>"); we answer synchronously by writing a SMALL serialized object (or {error}) to the
// element's data-md-note attribute. The whole state is never serialized, and nothing here calls RedNote or the network.
(() => {
  const MAX_DEPTH = 6;
  const MAX_LIST = 100;

  // Vue refs: { __v_isRef: true, _rawValue / _value }, possibly nested. Depth-limited.
  function unwrap(v, depth = 0) {
    while (v && typeof v === "object" && v.__v_isRef && depth++ < MAX_DEPTH) v = v._rawValue !== undefined ? v._rawValue : v._value;
    return v;
  }

  const str = (v) => (typeof v === "string" ? v : "");
  const strings = (list, max) => (Array.isArray(list) ? list.filter((s) => typeof s === "string").slice(0, max) : []);

  // stream: { <codec key>: [{ masterUrl, backupUrls: [...] }] } → the same shape, strings only.
  function streams(stream) {
    const out = {};
    const s = unwrap(stream);
    if (!s || typeof s !== "object") return out;
    for (const key of Object.keys(s).slice(0, 8)) {
      const list = unwrap(s[key]);
      if (!Array.isArray(list)) continue;
      out[key] = list.slice(0, 4).map((e) => ({ masterUrl: str(unwrap(e)?.masterUrl), backupUrls: strings(unwrap(unwrap(e)?.backupUrls), 3) }));
    }
    return out;
  }

  function serializeNote(noteId, note) {
    note = unwrap(note);
    if (!note || typeof note !== "object") return null;
    const list = unwrap(note.imageList);
    const imageList = (Array.isArray(list) ? list : []).slice(0, MAX_LIST).map((raw) => {
      const img = unwrap(raw) || {};
      const info = unwrap(img.infoList);
      return {
        urlDefault: str(img.urlDefault),
        fileId: str(img.fileId),
        wbDft: str((Array.isArray(info) ? info : []).map(unwrap).find((i) => i?.imageScene === "WB_DFT")?.url),
        livePhoto: img.livePhoto === true,
        stream: streams(img.stream),
      };
    });
    return {
      noteId: str(unwrap(note.noteId)) || noteId,
      type: str(unwrap(note.type)),
      time: Number(unwrap(note.time)),
      user: { userId: str(unwrap(unwrap(note.user)?.userId)) },
      imageList,
      video: { stream: streams(unwrap(unwrap(note.video)?.media)?.stream) },
    };
  }

  function lookup(noteId) {
    const state = window.__INITIAL_STATE__;
    const map = unwrap(unwrap(unwrap(state)?.note)?.noteDetailMap);
    const entry = map && typeof map === "object" ? unwrap(map[noteId]) : null;
    const out = serializeNote(noteId, entry?.note);
    return out || { error: "note not in the page state yet" };
  }

  // Unit tests load this file with a `module.exports.forTest` marker; the page's own globals never have one.
  if (typeof module !== "undefined" && module.exports?.forTest === true) {
    Object.assign(module.exports, { unwrap, serializeNote });
    return;
  }

  document.addEventListener(
    "md:rednote-note",
    (e) => {
      if (!(e.target instanceof Element)) return;
      let reply;
      try {
        const want = e.target.getAttribute("data-md-want") || "";
        reply = /^[0-9a-f]{8,40}$/i.test(want) ? lookup(want) : { error: "bad note id" };
      } catch (err) {
        reply = { error: String(err?.message || err) };
      }
      e.target.setAttribute("data-md-note", JSON.stringify(reply));
    },
    true
  );
})();
