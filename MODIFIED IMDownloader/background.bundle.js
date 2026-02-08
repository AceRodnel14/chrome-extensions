(() => {
"use strict";

const pendingDownloads = {};

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {

  console.group("📦 onDeterminingFilename triggered");
  console.log("Download ID:", item.id);
  console.log("Original URL:", item.url);
  console.log("Original filename:", item.filename);
  console.log("byExtensionId:", item.byExtensionId);
  console.log("Our extension ID:", chrome.runtime.id);

  // Instagram override first
  const customName = pendingDownloads[item.url];

  if (customName) {
    console.log("Instagram pending match found.");
    console.log("Overriding with:", customName);

    suggest({
      filename: customName,
      conflictAction: "overwrite"
    });

    delete pendingDownloads[item.url];
    console.groupEnd();
    return;
  }

  // Domain-based folder logic for ALL downloads
  try {

    let rawUrl = item.url.startsWith("blob:")
      ? item.url.replace("blob:", "")
      : item.url;

    console.log("Processed raw URL:", rawUrl);

    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();

    console.log("Parsed hostname:", hostname);

    let domain = hostname
      .replace(/^www\./, "")
      .replace(/[^a-zA-Z0-9.-]/g, "");

    console.log("Sanitized domain:", domain);

    let originalFilename;

    if (item.filename) {
      originalFilename = item.filename.split('/').pop();
      console.log("Using item.filename:", originalFilename);
    } else {
      originalFilename = url.pathname.split('/').pop() || "downloaded_file";
      console.log("Derived from URL path:", originalFilename);
    }

    const targetPath = `${domain}/${originalFilename}`;

    console.log("Final target path:", targetPath);

    suggest({
      filename: targetPath,
      conflictAction: "overwrite"
    });

  } catch (error) {
    console.error("Error during domain folder logic:", error);
    suggest();
  }

  console.groupEnd();
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

      //   pendingDownloads[file.url] = file.filename;
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
