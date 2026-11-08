// Settings shared by the options page and the content scripts.
// Loaded as a plain script, so it exposes a single global: MDSettings.
(() => {
  // Every site mediadownloader knows how to handle. A site's content script only runs when it is enabled here.
  const SITES = [
    { id: "instagram", name: "Instagram", hosts: ["instagram.com"] },
    { id: "x", name: "X (Twitter)", hosts: ["x.com", "twitter.com"] },
    { id: "youtube", name: "YouTube (posts)", hosts: ["youtube.com"] },
    { id: "reddit", name: "Reddit", hosts: ["reddit.com"] },
    { id: "rednote", name: "RedNote", hosts: ["rednote.com"] },
    { id: "naver-blog", name: "Naver Blog", hosts: ["blog.naver.com", "m.blog.naver.com"] },
    { id: "naver-entertain", name: "Naver Entertain", hosts: ["entertain.naver.com", "m.entertain.naver.com"] },
  ];

  const DEFAULTS = {
    filenamePattern: "username_--website--_createdDate",
    saveLocation: "", // base folder inside Chrome's Downloads folder that the site folders go in; empty = Downloads
    imageSize: "original", // original | medium | small
    organizeOtherDownloads: true, // every other download goes to a folder named after its source domain
    preferDescriptionDate: false, // a single YYMMDD date in the post text replaces the real post time (08:00 UTC); only Instagram, Reddit and X call this
    exiftoolEnabled: false, // write the post date into downloaded files with exiftool (needs native/ helper installed)
    exiftoolDir: "", // folder that holds exiftool / exiftool.exe
    diagnoseMode: false, // extra logging and self-repair of changed GraphQL ids; off for normal use
    sites: Object.fromEntries(SITES.map((s) => [s.id, true])),
  };

  const VARIABLES = {
    username: "Username of the account that posted it (Reddit: the subreddit; Naver Blog: the blog id; Naver Entertain: the press name)",
    createdDate: "Date it was posted, or the YYMMDD date in the description if \"Prefer description YYMMDD date\" is on (Instagram, Reddit, X; profile pictures use \"profile\", banners \"banner\")",
    website: "Site it was downloaded from, without the domain ending (instagram.com → instagram, x.com → x, youtube.com → youtube, reddit.com → reddit, rednote.com → rednote, *.naver.com → naver)",
  };

  // Second-level suffixes where the site name is one label further left (bbc.co.uk → bbc).
  const TWO_PART_SUFFIXES = new Set([
    "co.uk", "org.uk", "ac.uk", "gov.uk", "co.jp", "ne.jp", "or.jp", "com.au", "net.au", "org.au",
    "co.nz", "com.br", "com.mx", "com.ar", "co.kr", "or.kr", "com.cn", "com.tw", "com.hk", "com.sg",
    "com.ph", "co.in", "co.id", "com.my", "co.za", "com.tr",
  ]);

  function websiteName(hostname) {
    const labels = hostname.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
    if (labels.length < 2) return labels[0] || "";
    const suffixLength = TWO_PART_SUFFIXES.has(labels.slice(-2).join(".")) ? 2 : 1;
    return labels[labels.length - suffixLength - 1] || labels[0];
  }

  async function load() {
    const stored = await chrome.storage.sync.get(Object.keys(DEFAULTS));
    return {
      ...DEFAULTS,
      ...stored,
      sites: { ...DEFAULTS.sites, ...(stored.sites || {}) },
    };
  }

  function save(settings) {
    return chrome.storage.sync.set(settings);
  }

  // Local time with the UTC offset, no colons (not allowed in filenames), seconds truncated:
  // 2026-11-08T05:47:11Z in GMT+8 -> 2026-11-08T134711+0800
  function formatDate(date) {
    if (!date) return "";
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    const p = (n) => String(n).padStart(2, "0");
    const off = -d.getTimezoneOffset();
    const abs = Math.abs(off);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` +
      `${off >= 0 ? "+" : "-"}${p(Math.floor(abs / 60))}${p(abs % 60)}`;
  }

  function sanitize(name) {
    return name
      .replace(/[\r\n\t\u200A-\u200F\u2060-\u206F]/g, " ")
      .replace(/[\\/:*?"<>|~]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  }

  const fillVariables = (pattern, vars) => pattern.replace(/username|createdDate|website/g, (key) => vars[key] ?? "");

  // vars: { username, createdDate, website }; index is the position inside a carousel/story set, or null.
  function buildFilename(pattern, vars, index, extension) {
    let name = sanitize(fillVariables(pattern, vars)) || sanitize(vars.username || "") || "download";
    if (index !== null && index !== undefined) name += `_${index}`;
    return `${name}.${extension}`;
  }

  // Folder for files downloaded through a site's buttons, e.g. "instagram.com".
  const siteFolder = (siteId) => SITES.find((s) => s.id === siteId)?.hosts[0] || "";

  // chrome.downloads only accepts paths relative to Chrome's Downloads folder, so absolute paths are refused.
  function saveLocationError(location) {
    const value = (location || "").trim();
    if (/^[a-zA-Z]:/.test(value) || /^[\\/]/.test(value) || value.startsWith("~")) {
      return "Chrome only lets extensions save inside its Downloads folder, so enter a folder relative to it " +
        '(e.g. "Media\\Social"). To use another drive or folder, change Chrome\'s download location ' +
        "under Settings → Downloads.";
    }
    return null;
  }

  // "Media\Social" -> "Media/Social": Windows or Unix separators, no "..", no unsafe or reserved names.
  function cleanFolder(location) {
    return (location || "")
      .split(/[\\/]+/)
      .map((segment) => sanitize(segment).replace(/^[.\s]+|[.\s]+$/g, "")) // no leading/trailing dots or spaces
      .filter(Boolean)
      .map((segment) => (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(segment) ? `${segment}_` : segment)) // Windows reserved names
      .join("/");
  }

  // Path handed to chrome.downloads: <save location>/<site folder>/<filename>, skipping empty parts.
  function buildPath(saveLocation, folder, filename) {
    const base = saveLocationError(saveLocation) ? "" : cleanFolder(saveLocation);
    return [base, cleanFolder(folder), filename].filter(Boolean).join("/");
  }

  // The one YYMMDD date in a post's description as Unix seconds (that day, 08:00 UTC), or null.
  // URLs are ignored; letters or digits next to the six digits block a match; impossible dates are not counted.
  // Zero or several valid dates (even the same one twice) give null, so the real post time is used.
  function descriptionDate(text) {
    if (!text || typeof text !== "string") return null;
    const clean = text.replace(/https?:\/\/\S+/g, " ");
    const times = [];
    for (const m of clean.matchAll(/(?<![A-Za-z0-9])(\d{2})(\d{2})(\d{2})(?![A-Za-z0-9])/g)) {
      const [yy, mm, dd] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const d = new Date(Date.UTC(2000 + yy, mm - 1, dd, 8));
      if (d.getUTCFullYear() === 2000 + yy && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd) times.push(d.getTime() / 1000);
    }
    return times.length === 1 ? times[0] : null;
  }

  // Only Instagram, Reddit and X call this; YouTube always uses the real post time.
  // Post time in Unix seconds: the description date when the setting is on and the text has exactly one, else the real time.
  function postTime(realSeconds, text, settings) {
    return (settings?.preferDescriptionDate && descriptionDate(text)) || realSeconds;
  }

  globalThis.MDSettings = {
    SITES, DEFAULTS, VARIABLES, websiteName, load, save, formatDate, buildFilename,
    siteFolder, saveLocationError, cleanFolder, buildPath, descriptionDate, postTime,
  };
})();
