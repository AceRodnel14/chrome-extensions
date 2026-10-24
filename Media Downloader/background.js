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
    const exiftool = settings.exiftoolEnabled ? queueExiftool(results, sender.tab?.id) : 0;
    sendResponse({ results: results.map(({ filename, ok, error }) => ({ filename, ok, error })), exiftool });
  });

  return true; // respond asynchronously
});

// ---------------------------------------------------------------- exiftool helper (native messaging)
//
// After all files of one click have finished downloading, the batch goes to native/mediadownloader_exiftool.py,
// which writes each file's post date with a single exiftool run. Batches wait in chrome.storage.session because
// Chrome may stop this worker while a large video is still downloading.

const EXIFTOOL_HOST = "com.mediadownloader.exiftool";
let batchesLock = Promise.resolve();

// Serialized read-modify-write of the pending batches: { [batchId]: { tabId, pending: { [downloadId]: takenAt }, done: [{ path, takenAt }] } }
function withBatches(change) {
  const run = batchesLock.then(async () => {
    const { exifBatches = {} } = await chrome.storage.session.get("exifBatches");
    const result = await change(exifBatches);
    await chrome.storage.session.set({ exifBatches });
    return result;
  });
  batchesLock = run.catch(() => {});
  return run;
}

// Returns how many files will get their date set (0 = none queued).
function queueExiftool(results, tabId) {
  const files = results.filter((r) => r.ok && r.takenAt);
  if (!files.length || !settings.exiftoolDir) return 0;
  const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  withBatches((batches) => {
    batches[batchId] = { tabId, pending: Object.fromEntries(files.map((f) => [f.id, f.takenAt])), done: [] };
  }).then(async () => {
    // Small files can finish before the batch was stored; settle those now.
    for (const { id } of files) {
      const [item] = await chrome.downloads.search({ id });
      if (item && item.state !== "in_progress") settleDownload(id, item.state);
    }
  });
  return files.length;
}

function settleDownload(downloadId, state) {
  return withBatches(async (batches) => {
    const batchId = Object.keys(batches).find((b) => downloadId in batches[b].pending);
    if (!batchId) return null;
    const batch = batches[batchId];
    if (state === "complete") {
      const [item] = await chrome.downloads.search({ id: downloadId });
      if (item?.filename) batch.done.push({ path: item.filename, takenAt: batch.pending[downloadId] });
    }
    delete batch.pending[downloadId];
    if (Object.keys(batch.pending).length) return null;
    delete batches[batchId];
    return batch;
  }).then((finished) => finished && runExiftool(finished));
}

chrome.downloads.onChanged.addListener((delta) => {
  const state = delta.state?.current;
  if (state === "complete" || state === "interrupted") settleDownload(delta.id, state);
});

async function runExiftool(batch) {
  if (!batch.done.length) return;
  await settingsReady;
  let reply;
  try {
    reply = await chrome.runtime.sendNativeMessage(EXIFTOOL_HOST, { action: "setDates", exiftoolDir: settings.exiftoolDir, files: batch.done });
  } catch (err) {
    reply = { ok: false, error: helperError(err) };
  }
  reply ||= { ok: false, error: "the exiftool helper exited without an answer" };
  const failed = reply.ok ? reply.results.filter((r) => !r.ok) : [];
  const report = {
    type: "exiftoolResult",
    ok: reply.ok && !failed.length,
    updated: reply.ok ? reply.results.length - failed.length : 0,
    total: batch.done.length,
    error: reply.ok ? failed[0]?.error || null : reply.error,
  };
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
