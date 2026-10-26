// Tiny key-value store over IndexedDB, used by the service worker only. IndexedDB is
// per extension origin, so web pages and content scripts (which run with the web page's
// storage, not ours) cannot read it, unlike chrome.storage.local. The IDB factory is
// passed in so the node tests can supply a fake.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PassmanStore = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function createIdbStore(idb, dbName, storeName) {
    const DB = dbName || 'passman';
    const STORE = storeName || 'kv';
    let opening = null;

    function open() {
      if (opening) return opening;
      opening = new Promise((resolve, reject) => {
        const req = idb.open(DB, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { opening = null; reject(req.error); };
      });
      return opening;
    }

    function run(mode, fn) {
      return open().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = tx.onabort = () => reject(tx.error);
      }));
    }

    return {
      get: (key) => run('readonly', (s) => s.get(key)),
      set: (key, value) => run('readwrite', (s) => s.put(value, key)),
      remove: (key) => run('readwrite', (s) => s.delete(key)),
    };
  }

  return { createIdbStore };
});
