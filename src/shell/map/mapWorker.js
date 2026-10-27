/**
 * Web Worker: bakes the shell map image off the main thread (see mapBake.js).
 * Receives the bake input (typed arrays transferred), answers with the RGBA
 * pixels (transferred back) or an error message.
 */
import { bakeMap } from './mapBake.js';

self.onmessage = async (e) => {
  try {
    const t0 = Date.now();
    const pixels = await bakeMap(e.data);
    self.postMessage({ ok: true, pixels, ms: Date.now() - t0 }, [pixels.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.stack || err) });
  }
};
