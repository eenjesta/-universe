import { createWorldgen } from '../../shared/worldgen/index.js';
import { packTile, packChunk, mapTile } from './pack.js';

/**
 * Two generation workers: 'terrain' (tiles + minimap tiles) and 'detail'
 * (chunk features + grass). Bounded jobs in flight per kind; results go to
 * `onMessage(kind, msg)`. If Web Workers are unavailable the same packers run
 * on the main thread, a few jobs per frame (`pump()`).
 */
const KIND_OF = { tile: 'terrain', map: 'terrain', chunk: 'detail' };

export function createWorkers({ data, onMessage, maxInFlight = { tile: 6, chunk: 6, map: 2 } }) {
  const inflight = { tile: new Set(), chunk: new Set(), map: new Set() };
  const workers = {};
  let sync = null; // main-thread fallback
  const ready = [];

  const handle = (kind) => (e) => {
    const m = e.data;
    if (m.type === 'ready') return;
    if (m.type === 'error') {
      console.warn(`[frontier] ${kind} worker job failed`, m.error);
      for (const s of Object.values(inflight)) s.delete(m.id);
      return;
    }
    inflight[m.type]?.delete(m.id);
    onMessage(m.type, m);
  };

  try {
    for (const name of ['terrain', 'detail']) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: `frontier-${name}` });
      w.onmessage = handle(name);
      w.onerror = (err) => console.error(`[frontier] ${name} worker error`, err.message || err);
      w.postMessage({ type: 'init', data });
      workers[name] = w;
      ready.push(
        new Promise((res) => {
          const prev = w.onmessage;
          w.onmessage = (e) => {
            if (e.data?.type === 'ready') {
              w.onmessage = prev;
              res(e.data.ms);
            } else prev(e);
          };
        }),
      );
    }
  } catch (err) {
    console.warn('[frontier] Web Workers unavailable — generating on the main thread', err);
    for (const w of Object.values(workers)) w.terminate();
    sync = { wg: createWorldgen(data), queue: [] };
  }

  return {
    ready: Promise.all(ready),
    /** Free job slots for a kind. */
    capacity(kind) {
      return Math.max(0, (maxInFlight[kind] ?? 4) - inflight[kind].size);
    },
    send(kind, msg) {
      inflight[kind].add(msg.id);
      if (sync) sync.queue.push(msg);
      else workers[KIND_OF[kind]].postMessage(msg);
    },
    drop(kind, ids) {
      for (const id of ids) inflight[kind].delete(id);
      if (sync) {
        const s = new Set(ids);
        sync.queue = sync.queue.filter((m) => !s.has(m.id));
      } else workers[KIND_OF[kind]].postMessage({ type: 'drop', ids });
    },
    /** Main-thread fallback: run jobs within a small time budget. */
    pump(budgetMs = 4) {
      if (!sync) return;
      const t0 = performance.now();
      while (sync.queue.length && performance.now() - t0 < budgetMs) {
        const m = sync.queue.shift();
        let out;
        if (m.type === 'tile') out = packTile(sync.wg, m).msg;
        else if (m.type === 'chunk') out = packChunk(sync.wg, m).msg;
        else out = { type: 'map', id: m.id, rgba: mapTile(sync.wg, m) };
        inflight[m.type]?.delete(m.id);
        onMessage(m.type, out);
      }
    },
    get inWorker() {
      return !sync;
    },
    inflight: () => ({ tile: inflight.tile.size, chunk: inflight.chunk.size, map: inflight.map.size }),
    terminate() {
      for (const w of Object.values(workers)) w.terminate();
    },
  };
}
