// Settings shared by the options page and the content scripts.
// Loaded as a plain script, so it exposes a single global: MDSettings.
(() => {
  // Every site mediadownloader knows how to handle. A site's content script only runs when it is enabled here.
  const SITES = [
    { id: "instagram", name: "Instagram", hosts: ["instagram.com"] },
    { id: "x", name: "X (Twitter)", hosts: ["x.com", "twitter.com"] },
    { id: "youtube", name: "YouTube (posts)", hosts: ["youtube.com"] },
    { id: "reddit", name: "Reddit", hosts: ["reddit.com"] },
  ];

  const DEFAULTS = {
    filenamePattern: "username_--website--_createdDate",
    saveLocation: "", // base folder inside Chrome's Downloads folder that the site folders go in; empty = Downloads
    imageSize: "original", // original | medium | small
    organizeOtherDownloads: true, // every other download goes to a folder named after its source domain
    exiftoolEnabled: false, // write the post date into downloaded files with exiftool (needs native/ helper installed)
    exiftoolDir: "", // folder that holds exiftool / exiftool.exe
    diagnoseMode: false, // extra logging and self-repair of changed GraphQL ids; off for normal use
    sites: Object.fromEntries(SITES.map((s) => [s.id, true])),
  };

  const VARIABLES = {
    username: "Username of the account that posted it (Reddit: the subreddit)",
    createdDate: "Date it was posted (profile pictures use \"profile\", banners \"banner\")",
    website: "Site it was downloaded from, without the domain ending (instagram.com → instagram, x.com → x, youtube.com → youtube, reddit.com → reddit)",
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

  // e.g. 2026-05-29T12:42:41.000Z -> 2026-05-29T124241.000Z (colons are not allowed in filenames)
  function formatDate(date) {
    return date ? new Date(date).toISOString().replaceAll(":", "") : "";
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

  globalThis.MDSettings = {
    SITES, DEFAULTS, VARIABLES, websiteName, load, save, formatDate, buildFilename,
    siteFolder, saveLocationError, cleanFolder, buildPath,
  };
})();
