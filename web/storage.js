let opening;
function openStore() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  if (!opening)
    opening = new Promise((resolve) => {
      const request = indexedDB.open("reelforge-studio", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("studio");
        db.createObjectStore("renders").createIndex("date", "date");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  return opening;
}
async function transaction(store, mode, action) {
  const db = await openStore();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export const readLocal = (key) => transaction("studio", "readonly", (s) => s.get(key)).catch(() => undefined);
export const saveLocal = (key, value) =>
  transaction("studio", "readwrite", (s) => s.put(value, key))
    .then((id) => id !== undefined)
    .catch(() => false);
export const forgetLocal = (key) => transaction("studio", "readwrite", (s) => s.delete(key)).catch(() => undefined);
export const cachedScene = async (key) =>
  (await transaction("renders", "readonly", (s) => s.get(key)).catch(() => undefined))?.bytes;
export async function checkpointScene(key, bytes) {
  if (!globalThis.indexedDB) return;
  try {
    await transaction("renders", "readwrite", (s) => s.put({ date: Date.now(), bytes }, key));
    await transaction("renders", "readwrite", (s) => {
      const count = s.count();
      count.onsuccess = () => {
        let excess = count.result - 24;
        if (excess <= 0) return;
        const r = s.index("date").openKeyCursor();
        r.onsuccess = () => {
          const c = r.result;
          if (!c || excess-- <= 0) return;
          s.delete(c.primaryKey);
          c.continue();
        };
      };
      return count;
    });
  } catch {
    /* Storage pressure must never interrupt an edit. */
  }
}
export async function hashBytes(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("");
}
export async function fingerprint(file) {
  let state = new Uint8Array(32);
  const chunk = 4 * 1024 * 1024;
  for (let i = 0; i < file.size; i += chunk) {
    const part = new Uint8Array(await file.slice(i, i + chunk).arrayBuffer());
    const block = new Uint8Array(state.length + part.length);
    block.set(state);
    block.set(part, state.length);
    state = new Uint8Array(await crypto.subtle.digest("SHA-256", block));
  }
  return Array.from(state, (n) => n.toString(16).padStart(2, "0")).join("");
}

// Reads and writes inside one IndexedDB transaction, including across open tabs.
export async function updateLocal(key, change) {
  const db = await openStore();
  if (!db) return false;
  return new Promise((resolve) => {
    const tx = db.transaction("studio", "readwrite");
    const store = tx.objectStore("studio");
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        store.put(change(request.result), key);
      } catch {
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = tx.onabort = () => resolve(false);
  });
}
