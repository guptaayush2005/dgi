const { handleRequest, setStore, setPersistenceAdapter, emptyStore } = require('../server');

let blobSdkPromise;
let blobSdk;

async function getBlobSdk() {
  if (!blobSdkPromise) blobSdkPromise = import('@vercel/blob');
  blobSdk = blobSdk || await blobSdkPromise;
  return blobSdk;
}

async function readStore() {
  const { get } = await getBlobSdk();
  const result = await get('library-data.json', {
    access: 'private',
    useCache: false
  });
  if (!result) return { store: emptyStore(), etag: null };
  if (result.statusCode !== 200 || !result.stream) {
    throw new Error('The persistent library database could not be read.');
  }
  const parsed = JSON.parse(await new Response(result.stream).text());
  return { store: parsed, etag: result.blob.etag };
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeConcurrentStore(baseStore, changedStore, latestStore) {
  const merged = structuredClone(latestStore);
  for (const key of Object.keys(changedStore)) {
    const before = baseStore[key];
    const changed = changedStore[key];
    const latest = latestStore[key];
    if (sameValue(before, changed)) continue;
    if (sameValue(latest, before) || sameValue(latest, changed)) {
      merged[key] = changed;
      continue;
    }
    if (before && changed && latest && !Array.isArray(before) && !Array.isArray(changed) && !Array.isArray(latest) && typeof before === 'object' && typeof changed === 'object' && typeof latest === 'object') {
      const values = { ...latest };
      for (const itemKey of Object.keys(changed)) {
        if (sameValue(before[itemKey], changed[itemKey])) continue;
        if (!sameValue(latest[itemKey], before[itemKey]) && !sameValue(latest[itemKey], changed[itemKey])) {
          throw new Error(`Concurrent updates conflict in ${key}. Reload and retry.`);
        }
        values[itemKey] = changed[itemKey];
      }
      merged[key] = values;
      continue;
    }
    throw new Error(`Concurrent updates conflict in ${key}. Reload and retry.`);
  }
  return merged;
}

async function processRequest(req, res) {
  let currentEtag = null;
  let baseStore = emptyStore();
  try {
    const loaded = await readStore();
    currentEtag = loaded.etag;
    baseStore = loaded.store;
    setStore(loaded.store);
    setPersistenceAdapter(async nextStore => {
      const { put } = await getBlobSdk();
      let candidate = structuredClone(nextStore);
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          const saved = await put('library-data.json', JSON.stringify(candidate), {
            access: 'private',
            addRandomSuffix: false,
            allowOverwrite: Boolean(currentEtag),
            ifMatch: currentEtag || undefined,
            contentType: 'application/json',
            cacheControlMaxAge: 0
          });
          currentEtag = saved.etag;
          setStore(candidate);
          return;
        } catch (error) {
          const etagConflict = error?.name === 'BlobPreconditionFailedError' || error?.name === 'BlobAlreadyExistsError' || error?.status === 412 || error?.statusCode === 412 || error?.status === 409;
          if (!etagConflict) throw error;
          if (attempt === 11) {
            const conflict = new Error('The library is receiving several saves at once. Wait a moment and reload the page.');
            conflict.statusCode = 503;
            throw conflict;
          }
          await new Promise(resolve => setTimeout(resolve, Math.min(25 * (attempt + 1), 200) + Math.floor(Math.random() * 40)));
          const latest = await readStore();
          try {
            candidate = mergeConcurrentStore(baseStore, candidate, latest.store);
          } catch (mergeError) {
            mergeError.statusCode = 409;
            throw mergeError;
          }
          baseStore = latest.store;
          currentEtag = latest.etag;
        }
      }
    });
    await handleRequest(req, res);
  } catch (error) {
    console.error('Vercel storage request failed:', error);
    if (!res.headersSent) {
      res.writeHead(Number(error.statusCode) || 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: Number(error.statusCode) === 409 ? error.message : 'Library storage is unavailable.' }));
    }
  } finally {
    setPersistenceAdapter(null);
  }
}

let requestQueue = Promise.resolve();
module.exports = function handler(req, res) {
  const current = requestQueue.then(() => processRequest(req, res));
  requestQueue = current.catch(() => undefined);
  return current;
};
