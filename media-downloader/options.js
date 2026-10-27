const form = document.getElementById("settings");
const patternInput = document.getElementById("filenamePattern");
const locationInput = document.getElementById("saveLocation");
const locationErrorEl = document.getElementById("saveLocationError");
const organizeInput = document.getElementById("organizeOtherDownloads");
const diagnoseInput = document.getElementById("diagnoseMode");
const exiftoolInput = document.getElementById("exiftoolEnabled");
const exiftoolDirInput = document.getElementById("exiftoolDir");
const exiftoolStatusEl = document.getElementById("exiftoolStatus");
const previewEl = document.getElementById("preview");
const pathPreviewEl = document.getElementById("pathPreview");
const otherPathPreviewEl = document.getElementById("otherPathPreview");
const statusEl = document.getElementById("status");

// Static sample values for the live preview.
const SAMPLE = { username: "davidbeckham", createdDate: MDSettings.formatDate("2024-03-01T12:00:00Z"), website: MDSettings.websiteName("www.instagram.com") };

function renderVariables() {
  const dl = document.getElementById("variables");
  for (const [name, text] of Object.entries(MDSettings.VARIABLES)) {
    const dt = document.createElement("dt");
    dt.textContent = name;
    const dd = document.createElement("dd");
    dd.textContent = text;
    dl.append(dt, dd);
  }
}

function renderSites(enabledSites) {
  const box = document.getElementById("sites");
  for (const site of MDSettings.SITES) {
    const label = document.createElement("label");
    label.className = "choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "site";
    input.value = site.id;
    input.checked = enabledSites[site.id] !== false;
    const hosts = document.createElement("small");
    hosts.textContent = site.hosts.join(", ");
    label.append(input, ` ${site.name} `, hosts);
    box.append(label);
  }
}

async function renderLearnedDocIds() {
  const { learnedDocIds = {} } = await chrome.storage.local.get("learnedDocIds");
  const list = document.getElementById("learnedDocIds");
  list.replaceChildren();
  const entries = Object.entries(learnedDocIds);
  for (const [name, id] of entries.length ? entries : [["None", ""]]) {
    const li = document.createElement("li");
    li.textContent = id ? `${name}: ${id}` : name;
    list.append(li);
  }
  document.getElementById("forgetDocIds").disabled = !entries.length;
}

document.getElementById("forgetDocIds").addEventListener("click", async () => {
  await chrome.storage.local.remove("learnedDocIds");
  renderLearnedDocIds();
  statusEl.textContent = "Remembered ids forgotten; the built-in ids are used again.";
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.learnedDocIds) renderLearnedDocIds();
});

function showExiftoolStatus(text, kind = "") {
  exiftoolStatusEl.textContent = text;
  exiftoolStatusEl.className = kind;
}

// Asks the helper (through background.js) which exiftool it finds in the folder typed in.
async function testExiftool() {
  showExiftoolStatus("Testing…");
  const reply = await chrome.runtime.sendMessage({ type: "exiftoolTest", exiftoolDir: exiftoolDirInput.value.trim() });
  if (reply?.ok) showExiftoolStatus(`exiftool ${reply.version} found (${reply.exiftool})`, "ok");
  else showExiftoolStatus(reply?.error || "No answer from the helper.", "fail");
  return Boolean(reply?.ok);
}

document.getElementById("exiftoolTest").addEventListener("click", testExiftool);

// Shown with Windows separators, since that is where the files end up for most people.
const asWindowsPath = (path) => `Downloads\\${path.replaceAll("/", "\\")}`;

function updatePreview() {
  const pattern = patternInput.value.trim() || MDSettings.DEFAULTS.filenamePattern;
  const filename = MDSettings.buildFilename(pattern, SAMPLE, null, "jpg");
  previewEl.textContent = filename;

  const error = MDSettings.saveLocationError(locationInput.value);
  locationErrorEl.textContent = error || "";
  locationErrorEl.hidden = !error;
  locationInput.setAttribute("aria-invalid", String(Boolean(error)));

  const location = locationInput.value.trim();
  pathPreviewEl.textContent = error ? "—" : asWindowsPath(MDSettings.buildPath(location, MDSettings.siteFolder("instagram"), filename));
  otherPathPreviewEl.textContent = error
    ? "—"
    : organizeInput.checked
      ? asWindowsPath(MDSettings.buildPath(location, "github.com", "report.pdf"))
      : `${asWindowsPath("report.pdf")} (not sorted)`;
  return !error;
}

async function init() {
  const settings = await MDSettings.load();
  renderVariables();
  renderSites(settings.sites);
  patternInput.value = settings.filenamePattern;
  locationInput.value = settings.saveLocation;
  organizeInput.checked = settings.organizeOtherDownloads;
  diagnoseInput.checked = settings.diagnoseMode;
  exiftoolInput.checked = settings.exiftoolEnabled;
  exiftoolDirInput.value = settings.exiftoolDir;
  renderLearnedDocIds();
  form.querySelector(`input[name="imageSize"][value="${settings.imageSize}"]`).checked = true;
  updatePreview();
}

for (const input of [patternInput, locationInput]) {
  input.addEventListener("input", () => {
    updatePreview();
    statusEl.textContent = "";
  });
}

form.addEventListener("change", () => {
  updatePreview();
  statusEl.textContent = "";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!updatePreview()) {
    statusEl.textContent = "Not saved: fix the save location first.";
    locationInput.focus();
    return;
  }
  if (exiftoolInput.checked && !exiftoolDirInput.value.trim()) {
    statusEl.textContent = "Not saved: enter the exiftool folder, or turn exiftool off.";
    exiftoolDirInput.focus();
    return;
  }
  const sites = {};
  for (const input of form.querySelectorAll('input[name="site"]')) sites[input.value] = input.checked;
  const filenamePattern = patternInput.value.trim() || MDSettings.DEFAULTS.filenamePattern;
  const saveLocation = MDSettings.cleanFolder(locationInput.value);
  await MDSettings.save({
    filenamePattern,
    saveLocation,
    imageSize: form.querySelector('input[name="imageSize"]:checked').value,
    organizeOtherDownloads: organizeInput.checked,
    diagnoseMode: diagnoseInput.checked,
    exiftoolEnabled: exiftoolInput.checked,
    exiftoolDir: exiftoolDirInput.value.trim(),
    sites,
  });
  patternInput.value = filenamePattern;
  locationInput.value = saveLocation.replaceAll("/", "\\");
  updatePreview();
  statusEl.textContent = "Saved. Open tabs pick this up right away.";
  // Turning exiftool on: check the helper and folder straight away, so a problem shows here and not after a download.
  if (exiftoolInput.checked) testExiftool();
});

init();
