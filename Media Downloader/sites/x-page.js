// Runs in the page's own JavaScript world (manifest "world": "MAIN"), because only from here can we read the React
// props and the Redux store X keeps every loaded post in. The isolated content script asks by dispatching
// "md:resolve" on an element (with data-md-want="<tweet id>" when it knows the id); we answer by writing the post's
// media to the element's data-md-media attribute.
(() => {
  let store = null;

  // The Redux store sits in the props of the <Provider> near the top of the React tree.
  function findStore() {
    if (store) return store;
    const root = document.querySelector("#react-root")?.firstElementChild;
    const key = root && Object.keys(root).find((k) => k.startsWith("__reactFiber"));
    for (let fiber = key && root[key], depth = 0; fiber && depth < 80; fiber = fiber.child, depth++) {
      if (fiber.memoizedProps?.store?.getState) return (store = fiber.memoizedProps.store);
    }
    return null;
  }

  const entities = () => findStore()?.getState()?.entities || {};

  // Tweets in the store reference users and retweeted/quoted tweets by id; in React props they are objects.
  const tweetById = (id) => (id ? entities().tweets?.entities?.[id] || null : null);
  const asTweet = (t) => (typeof t === "string" ? tweetById(t) : t || null);
  const asUser = (u) => (typeof u === "string" ? entities().users?.entities?.[u] || null : u || null);

  function serialize(tweet) {
    tweet = asTweet(tweet);
    if (!tweet) return null;
    const original = asTweet(tweet.retweeted_status); // a repost shows, and should save, the original post
    if (original) return serialize(original);
    const media = (tweet.extended_entities?.media || tweet.entities?.media || []).map((m) => ({
      type: m.type,
      url: m.media_url_https,
      variants: (m.video_info?.variants || []).filter((v) => v.content_type === "video/mp4"),
    }));
    const quoted = asTweet(tweet.quoted_status);
    return {
      id: tweet.id_str,
      createdAt: tweet.created_at,
      username: asUser(tweet.user)?.screen_name || "",
      media,
      quoted: !media.length && quoted ? serialize(quoted) : null,
    };
  }

  // The nearest post above an element: the `tweet` prop of the component that renders its <article>.
  function tweetFromFiber(el, wantId) {
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
    for (let fiber = key && el[key], depth = 0; fiber && depth < 80; fiber = fiber.return, depth++) {
      const tweet = fiber.memoizedProps?.tweet;
      if (tweet?.id_str && (!wantId || tweet.id_str === wantId)) return tweet;
    }
    return null;
  }

  function resolve(el) {
    const wantId = el.getAttribute("data-md-want");
    if (wantId) {
      const fromStore = tweetById(wantId);
      if (fromStore) return { source: "store", ...serialize(fromStore) };
    }
    const fromFiber = tweetFromFiber(el, wantId);
    return fromFiber ? { source: "React props", ...serialize(fromFiber) } : null;
  }

  document.addEventListener(
    "md:resolve",
    (e) => {
      let found = null;
      try {
        found = e.target instanceof Element ? resolve(e.target) : null;
      } catch (err) {
        found = { error: String(err?.message || err) };
      }
      if (found) e.target.setAttribute("data-md-media", JSON.stringify(found));
    },
    true
  );
})();
