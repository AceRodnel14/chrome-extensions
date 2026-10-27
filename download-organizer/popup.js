const toggle = document.getElementById("debugToggle");
const openBtn = document.getElementById("openConsole");

// Load saved state
chrome.storage.local.get("debugLogsEnabled", (data) => {
  toggle.checked = data.debugLogsEnabled || false;
});

// Save state on change
toggle.addEventListener("change", () => {
  chrome.storage.local.set({ debugLogsEnabled: toggle.checked });
});

// Open service worker console
openBtn.addEventListener("click", () => {
  chrome.runtime.getBackgroundPage((bg) => {
    console.log("Service worker console opened.");
  });
  alert("To view logs, go to chrome://extensions → 'Service worker' → 'Inspect'");
});