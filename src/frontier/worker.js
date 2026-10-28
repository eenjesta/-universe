/**
 * Frontier generation worker: rebuilds the exact worldgen of the main thread
 * from `exportForWorker()` data (hub border profile + coarse hub grid +
 * highways) and answers jobs FIFO with transferable typed arrays.
 *
 *   { type: 'init', data }                          → { type: 'ready', ms }
 *   { type: 'tile', id, x0, z0, size, cells }       → { type: 'tile', id, … } (see buildTile)
 *   { type: 'chunk', id, cx, cz, grass, gstep }     → { type: 'chunk', id, decor, nodes, pois, grass }
 *   { type: 'map', id, x0, z0, size, px }           → { type: 'map', id, rgba }
 */
import { createWorldgen } from '../../shared/worldgen/index.js';
import { packTile, packChunk, mapTile } from './pack.js';

let wg = null;
const queue = [];
let scheduled = false;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    const t0 = performance.now();
    wg = createWorldgen(m.data);
    self.postMessage({ type: 'ready', ms: Math.round(performance.now() - t0) });
    return;
  }
  if (m.type === 'drop') {
    // the main thread no longer needs these jobs
    const ids = new Set(m.ids);
    for (let i = queue.length - 1; i >= 0; i--) if (ids.has(queue[i].id)) queue.splice(i, 1);
    return;
  }
  queue.push(m);
  if (!scheduled) {
    scheduled = true;
    setTimeout(run, 0);
  }
};

function run() {
  scheduled = false;
  if (!wg || !queue.length) return;
  const m = queue.shift();
  try {
    if (m.type === 'tile') {
      const out = packTile(wg, m);
      self.postMessage(out.msg, out.transfer);
    } else if (m.type === 'chunk') {
      const out = packChunk(wg, m);
      self.postMessage(out.msg, out.transfer);
    } else if (m.type === 'map') {
      const rgba = mapTile(wg, m);
      self.postMessage({ type: 'map', id: m.id, rgba }, [rgba.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, error: String(err?.stack || err) });
  }
  // yield between jobs so 'drop' messages get through
  if (queue.length && !scheduled) {
    scheduled = true;
    setTimeout(run, 0);
  }
}
