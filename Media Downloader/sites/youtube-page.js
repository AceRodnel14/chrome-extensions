// Runs in the page's own JavaScript world (manifest "world": "MAIN"), because only from here can we read the `data`
// YouTube's Polymer elements carry. The isolated content script asks by dispatching "md:resolve" on an element inside
// a post; we answer by writing the post's images to the element's data-md-media attribute.
(() => {
  const POST = "ytd-backstage-post-renderer, ytd-post-renderer, ytd-shared-post-renderer";

  // yt3 image URLs are "<host>/<key>=<size and crop options>"; without the options they are the full upload.
  const baseUrl = (url) => (url.startsWith("//") ? `https:${url}` : url).split("=")[0];
  const lastThumb = (image) => image?.thumbnails?.at(-1)?.url;

  // Single image, several images, or a poll whose choices have images.
  function imagesOf(attachment) {
    if (!attachment) return [];
    const single = lastThumb(attachment.backstageImageRenderer?.image);
    if (single) return [single];
    const multi = attachment.postMultiImageRenderer?.images || [];
    if (multi.length) return multi.map((i) => lastThumb(i.backstageImageRenderer?.image)).filter(Boolean);
    const poll = attachment.pollRenderer?.choices || [];
    return poll.map((c) => lastThumb(c.image)).filter(Boolean);
  }

  function serialize(post) {
    // A reshared post shows, and should save, the original post.
    const original = post.originalPost?.backstagePostRenderer || post.originalPost?.postRenderer;
    if (original) return serialize(original);
    const author = post.authorEndpoint?.browseEndpoint || post.authorText?.runs?.[0]?.navigationEndpoint?.browseEndpoint || {};
    const attachment = post.backstageAttachment || {};
    return {
      postId: post.postId,
      handle: (author.canonicalBaseUrl || "").match(/^\/@([^/?]+)/)?.[1] || "",
      name: post.authorText?.runs?.map((r) => r.text).join("") || post.authorText?.simpleText || "",
      images: imagesOf(attachment).map(baseUrl),
      attachment: Object.keys(attachment)[0] || null,
    };
  }

  document.addEventListener(
    "md:resolve",
    (e) => {
      let found = null;
      try {
        const el = e.target instanceof Element ? e.target.closest(POST) : null;
        const data = el?.data || el?.__data?.data;
        found = data?.postId || data?.originalPost ? serialize(data) : null;
      } catch (err) {
        found = { error: String(err?.message || err) };
      }
      if (found) e.target.setAttribute("data-md-media", JSON.stringify(found));
    },
    true
  );
})();
