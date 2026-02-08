chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  try {
    let rawUrl = item.url.startsWith("blob:")
      ? item.url.replace("blob:", "")
      : item.url;

    const url = new URL(rawUrl);
    let domain = url.hostname.replace(/^www\./, "").replace(/[^a-zA-Z0-9.-]/g, "");

    let originalFilename = item.filename
      ? item.filename.split('/').pop()
      : url.pathname.split('/').pop() || "downloaded_file";

    const targetPath = `${domain}/${originalFilename}`;

    // Always log to service worker console
    console.log("Raw URL:", item.url);
    console.log("Processed URL:", rawUrl);
    console.log("Domain:", domain);
    console.log("Original filename:", originalFilename);
    console.log("Target path:", targetPath);

    suggest({ filename: targetPath });

  } catch (e) {
    console.error("Error:", e);
    suggest({ filename: item.filename });
  }
});