// Saves files through chrome.downloads, which reports real success/failure and is not subject to
// Chrome's per-site "download multiple files" prompt the way page-level <a download> clicks are.
//
// It also decides the folder of every download in Chrome (this replaces the download-organizer extension),
// inside the "Save location" base folder when one is set:
//   - files from mediadownloader's buttons go to the site's folder, e.g. "<save location>/instagram.com/<filename>"
//   - every other download goes to a folder named after the domain it came from, e.g. "<save location>/github.com/<filename>"
importScripts("shared/settings.js");

let settings = MDSettings.DEFAULTS;
const settingsReady = MDSettings.load().then((loaded) => (settings = loaded));
chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area === "sync") settings = await MDSettings.load();
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// URL -> paths we asked for, in order, so onDeterminingFilename can re-apply them (the same URL may be queued twice).
const ownDownloads = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "download") return;
  const folder = MDSettings.siteFolder(msg.site);

  Promise.all(
    msg.files.map(async ({ url, filename, takenAt }) => {
      await settingsReady;
      const path = MDSettings.buildPath(settings.saveLocation, folder, filename);
      ownDownloads.set(url, [...(ownDownloads.get(url) || []), path]);
      return chrome.downloads
        .download({ url, filename: path, conflictAction: "uniquify" })
        .then((id) => ({ filename: path, ok: Boolean(id), id, takenAt }))
        .catch((err) => ({ filename: path, ok: false, error: err.message }));
    })
  ).then((results) => {
    const exiftool = settings.exiftoolEnabled && settings.exiftoolDir ? results.filter((r) => r.ok && r.takenAt).length : 0;
    trackBatch(results, sender.tab?.id, exiftool > 0);
    sendResponse({ results: results.map(({ filename, ok, error }) => ({ filename, ok, error })), exiftool });
  });

  return true; // respond asynchronously
});

// ---------------------------------------------------------------- batches: one per click
//
// chrome.downloads.download() only says Chrome *accepted* a download; the file can still fail afterwards (a 404, a
// network error). So every click is followed until each of its downloads is complete or interrupted, then the tab
// gets one report: how many files were asked for, how many were saved, which failed and why, and (with exiftool on)
// how many got their date. Batches wait in chrome.storage.session because Chrome may stop this worker while a large
// video is still downloading.
//
// The exiftool part: the batch's saved files that have a post date go to native/mediadownloader_exiftool.py, which
// writes them all with a single exiftool run.

const EXIFTOOL_HOST = "com.mediadownloader.exiftool";
let batchesLock = Promise.resolve();

// Serialized read-modify-write of the pending batches:
// { [batchId]: { tabId, total, dates, pending: { [downloadId]: { filename, takenAt } }, done: [{ path, filename, takenAt }], failed: [{ filename, error }] } }
function withBatches(change) {
  const run = batchesLock.then(async () => {
    const { batches = {} } = await chrome.storage.session.get("batches");
    const result = await change(batches);
    await chrome.storage.session.set({ batches });
    return result;
  });
  batchesLock = run.catch(() => {});
  return run;
}

function trackBatch(results, tabId, dates) {
  const started = results.filter((r) => r.ok);
  const batch = {
    tabId,
    total: results.length,
    dates, // whether exiftool should date the saved files
    pending: Object.fromEntries(started.map((r) => [r.id, { filename: r.filename, takenAt: r.takenAt || null }])),
    done: [],
    failed: results.filter((r) => !r.ok).map((r) => ({ filename: r.filename, error: r.error || "did not start" })),
  };
  if (!started.length) return finishBatch(batch);
  const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  withBatches((batches) => {
    batches[batchId] = batch;
  }).then(async () => {
    // Small files can finish before the batch was stored; settle those now.
    for (const { id } of started) {
      const [item] = await chrome.downloads.search({ id });
      if (item && item.state !== "in_progress") settleDownload(id, item.state);
    }
  });
}

function settleDownload(downloadId, state) {
  return withBatches(async (batches) => {
    const batchId = Object.keys(batches).find((b) => downloadId in batches[b].pending);
    if (!batchId) return null;
    const batch = batches[batchId];
    const { filename, takenAt } = batch.pending[downloadId];
    const [item] = await chrome.downloads.search({ id: downloadId });
    if (state === "complete" && item?.filename) batch.done.push({ path: item.filename, filename, takenAt });
    else batch.failed.push({ filename, error: item?.error ? downloadError(item.error) : "the download did not finish" });
    delete batch.pending[downloadId];
    if (Object.keys(batch.pending).length) return null;
    delete batches[batchId];
    return batch;
  }).then((finished) => finished && finishBatch(finished));
}

chrome.downloads.onChanged.addListener((delta) => {
  const state = delta.state?.current;
  if (state === "complete" || state === "interrupted") settleDownload(delta.id, state);
});

// Chrome's interrupt reasons, in words.
function downloadError(reason) {
  const words = {
    SERVER_BAD_CONTENT: "the site has no such file (404)",
    SERVER_FORBIDDEN: "the site refused the download (403)",
    SERVER_UNAUTHORIZED: "the site wants a login",
    NETWORK_FAILED: "network error",
    NETWORK_TIMEOUT: "network timeout",
    NETWORK_DISCONNECTED: "network disconnected",
    FILE_NO_SPACE: "the disk is full",
    FILE_ACCESS_DENIED: "no permission to write the file",
    USER_CANCELED: "cancelled",
  };
  return words[reason] || reason;
}

// Date the saved files (if exiftool is on), then send the tab one report.
async function finishBatch(batch) {
  let dates = null;
  const datable = batch.done.filter((f) => f.takenAt);
  if (batch.dates && datable.length) {
    await settingsReady;
    let reply;
    try {
      reply = await chrome.runtime.sendNativeMessage(EXIFTOOL_HOST, {
        action: "setDates",
        exiftoolDir: settings.exiftoolDir,
        files: datable.map(({ path, takenAt }) => ({ path, takenAt })),
      });
    } catch (err) {
      reply = { ok: false, error: helperError(err) };
    }
    reply ||= { ok: false, error: "the exiftool helper exited without an answer" };
    const results = reply.ok ? reply.results || [] : [];
    const notSet = reply.ok
      ? datable.filter((f) => !results.find((r) => r.path === f.path)?.ok).map((f) => ({
          filename: f.filename,
          error: results.find((r) => r.path === f.path)?.error || "exiftool gave no result for this file",
        }))
      : datable.map((f) => ({ filename: f.filename, error: reply.error }));
    dates = { total: datable.length, set: datable.length - notSet.length, notSet };
  }
  const report = { type: "batchResult", total: batch.total, saved: batch.done.length, savedFiles: batch.done.map((f) => f.filename), failed: batch.failed, dates };
  if (batch.tabId !== undefined) chrome.tabs.sendMessage(batch.tabId, report).catch(() => {});
}

// Chrome's message when the helper is not registered is cryptic; say what to do instead.
function helperError(err) {
  const message = err?.message || String(err);
  return /not found|forbidden/i.test(message)
    ? `the exiftool helper is not installed (run native/install.sh on Linux or native\\install.bat on Windows): ${message}`
    : message;
}

// Settings page → "Test": ask the helper which exiftool it finds.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "exiftoolTest") return;
  chrome.runtime
    .sendNativeMessage(EXIFTOOL_HOST, { action: "version", exiftoolDir: msg.exiftoolDir })
    .then(sendResponse, (err) => sendResponse({ ok: false, error: helperError(err) }));
  return true;
});

// ---------------------------------------------------------------- RedGifs lookups (for Reddit posts linking there)
//
// RedGifs' API only allows pages on redgifs.com (CORS), so sites/reddit.js asks here; host permission for
// api.redgifs.com lets this worker read it. Every call needs a temporary token, which works for about a day.

const REDGIFS_API = "https://api.redgifs.com/v2";
let redgifsToken = null;

async function redgifsFetch(path, retry = true) {
  if (!redgifsToken) {
    const r = await fetch(`${REDGIFS_API}/auth/temporary`);
    if (!r.ok) throw new Error(`RedGifs refused a session (${r.status}).`);
    redgifsToken = (await r.json()).token;
  }
  const r = await fetch(`${REDGIFS_API}${path}`, { headers: { Authorization: `Bearer ${redgifsToken}` } });
  if (r.status === 401 && retry) {
    redgifsToken = null; // expired
    return redgifsFetch(path, false);
  }
  return r;
}

// Reply: { ok: true, gif: { urls: { hd, sd, … }, createDate, userName, hasAudio } } or { ok: false, error }.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "redgifs") return;
  redgifsFetch(`/gifs/${encodeURIComponent(msg.id)}`)
    .then(async (r) => {
      if (r.status === 404 || r.status === 410) return { ok: false, error: "RedGifs has no such clip (it was removed)." };
      if (r.status === 429) return { ok: false, error: "RedGifs is rate limiting requests. Wait a minute and try again." };
      if (!r.ok) return { ok: false, error: `RedGifs returned an error (${r.status}).` };
      const { gif } = await r.json();
      return gif?.urls ? { ok: true, gif } : { ok: false, error: "RedGifs returned no files for this clip." };
    })
    .catch((err) => ({ ok: false, error: `RedGifs could not be reached: ${err.message}` }))
    .then(sendResponse);
  return true;
});

function takeOwnPath(url) {
  const queue = ownDownloads.get(url);
  if (!queue?.length) return null;
  const path = queue.shift();
  if (!queue.length) ownDownloads.delete(url);
  return path;
}

function domainOf(url) {
  try {
    const host = new URL(url.startsWith("blob:") ? url.slice(5) : url).hostname;
    return host.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9.-]/g, "");
  } catch {
    return "";
  }
}

// download-organizer's rule: <domain without www.>/<file name Chrome chose>. Blob URLs carry the page they came
// from. data: URLs carry no address and Chrome records no referrer for them, so they are left where Chrome puts them.
function organizedPath(item) {
  const domain = domainOf(item.url);
  if (!domain) return null;
  let name = (item.filename || "").split(/[\\/]/).pop();
  if (!name) {
    try {
      name = new URL(item.url).pathname.split("/").pop();
    } catch {}
  }
  return MDSettings.buildPath(settings.saveLocation, domain, name || "download");
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  settingsReady.then(() => {
    if (item.byExtensionId === chrome.runtime.id) {
      const path = takeOwnPath(item.url);
      return path ? suggest({ filename: path, conflictAction: "uniquify" }) : suggest();
    }
    const path = settings.organizeOtherDownloads ? organizedPath(item) : null;
    return path ? suggest({ filename: path, conflictAction: "uniquify" }) : suggest();
  });
  return true; // suggest is called asynchronously
});
