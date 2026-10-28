/**
 * Dedicated map-tile worker for the frontier minimap / world-map layer (src/frontier/minimap.js), so map
 * tiles never wait behind terrain jobs in the shared terrain worker.
 *
 *   { type: 'init', data }                 → { type: 'ready' }   (data = worldgen.exportForWorker())
 *   { type: 'map', id, x0, z0, size, px }  → { type: 'map', id, rgba }
 *   { type: 'drop', ids }                  forget queued jobs
 * Jobs run in order (the layer asks for the coarse tiles of a new view first); at most a few are in flight.
 */
import { createWorldgen } from '../../shared/worldgen/index.js';
import { mapTile } from './mapTile.js';

let wg = null;
const queue = [];
let scheduled = false;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    wg = createWorldgen(m.data);
    self.postMessage({ type: 'ready' });
    schedule();
    return;
  }
  if (m.type === 'drop') {
    const ids = new Set(m.ids);
    for (let i = queue.length - 1; i >= 0; i--) if (ids.has(queue[i].id)) queue.splice(i, 1);
    return;
  }
  if (m.type === 'map') {
    queue.push(m);
    schedule();
  }
};

function schedule() {
  if (scheduled || !wg || !queue.length) return;
  scheduled = true;
  setTimeout(run, 0);
}

function run() {
  scheduled = false;
  const m = queue.shift();
  if (m) {
    try {
      const rgba = mapTile(wg, m);
      self.postMessage({ type: 'map', id: m.id, rgba }, [rgba.buffer]);
    } catch (err) {
      self.postMessage({ type: 'error', id: m.id, error: String(err?.stack || err) });
    }
  }
  schedule();
}
