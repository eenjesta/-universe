/**
 * Async character builds (characters module): requestArrays(app, lod) resolves
 * with cached arrays immediately, otherwise builds them in a small pool of
 * module workers (build-worker.js, round robin) and inserts the result into
 * the shared LRU cache. Falls back to a main-thread build (in a later task)
 * when workers are unavailable. Concurrent requests for the same key share
 * one build.
 */
import { arraysKey, cachedArrays, putArrays, buildCharacterArrays } from './character.js';
import { normalizeAppearance } from './appearance.js';

const POOL = 2;
const workers = [];
let workerFailed = false;
let nextId = 1;
let rr = 0;
const pending = new Map(); // id → { key, resolve, reject, fallback }
const inflight = new Map(); // key → Promise

function spawn() {
  const w = new Worker(new URL('./build-worker.js', import.meta.url), { type: 'module', name: `chr-build-${workers.length}` });
  w.onmessage = (e) => {
    const { id, key, arrays, error } = e.data || {};
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(putArrays(key || p.key, arrays));
  };
  w.onerror = (e) => {
    console.warn('[characters] build worker failed — building on the main thread', e?.message || e);
    workerFailed = true;
    workers.length = 0;
    for (const p of pending.values()) p.fallback();
    pending.clear();
  };
  return w;
}

/** Next worker of the pool (round robin), or null when workers are unavailable. */
function getWorker() {
  if (workerFailed) return null;
  try {
    while (workers.length < POOL) workers.push(spawn());
  } catch (err) {
    console.warn('[characters] no build worker — building on the main thread', err);
    workerFailed = true;
    workers.length = 0;
    return null;
  }
  rr = (rr + 1) % workers.length;
  return workers[rr];
}

/** Number of builds waiting in the workers. */
export function pendingBuilds() {
  return pending.size;
}

/** Promise of the geometry arrays for app + lod (never rejects; falls back to a sync build). */
export function requestArrays(app, lod = 1) {
  const a = normalizeAppearance(app);
  const key = arraysKey(a, lod);
  const hit = cachedArrays(key);
  if (hit) return Promise.resolve(hit);
  if (inflight.has(key)) return inflight.get(key);
  const syncBuild = () => buildCharacterArrays(a, lod);
  const promise = new Promise((resolve) => {
    const w = getWorker();
    if (!w) {
      setTimeout(() => resolve(syncBuild()), 0);
      return;
    }
    const id = nextId++;
    pending.set(id, {
      key,
      resolve,
      reject: (err) => {
        console.warn('[characters] worker build failed, retrying on the main thread', err);
        resolve(syncBuild());
      },
      fallback: () => resolve(syncBuild()),
    });
    w.postMessage({ id, app: a, lod });
  }).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** True if arrays for app + lod are cached (a swap would be instant). */
export function hasArrays(app, lod = 1) {
  return !!cachedArrays(arraysKey(app, lod));
}
