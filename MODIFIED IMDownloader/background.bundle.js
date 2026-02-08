(() => {
"use strict";

const pendingDownloads = {};

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {

  if (item.byExtensionId !== chrome.runtime.id) {
    suggest();
    return;
  }

  const customName = pendingDownloads[item.url];

  if (customName) {
    console.log("📝 Overriding filename:", customName);

    suggest({
      filename: customName,
      conflictAction: "overwrite"
    });

    delete pendingDownloads[item.url];
  } else {
    suggest();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  console.group("📩 MESSAGE RECEIVED IN BACKGROUND");
  console.log("Full message:", msg);
  console.groupEnd();

  if (msg.type === "BATCH_DOWNLOAD" && Array.isArray(msg.files)) {

    console.group("🚀 BATCH DOWNLOAD START");
    console.log("Total files:", msg.files.length);
    console.groupEnd();

    msg.files.forEach((file, index) => {

      console.group(`⬇️ FILE ${index + 1}`);
      console.log("URL:", file.url);
      console.log("Custom filename:", file.filename);
      console.groupEnd();

      pendingDownloads[file.url] = file.filename;
      pendingDownloads[file.url] = "instagram/" + file.filename;


      chrome.downloads.download({
        url: file.url,
        saveAs: false
      }, (downloadId) => {

        if (chrome.runtime.lastError) {
          console.error("❌ DOWNLOAD FAILED:", chrome.runtime.lastError.message);
        } else {
          console.log("✅ DOWNLOAD STARTED:", file.filename);
        }

      });

    });

  } else {
    console.log("⚠️ Message ignored");
  }

});

})();
