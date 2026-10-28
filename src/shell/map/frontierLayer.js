/**
 * Cached, north-up rendering of the procedural planet layer
 * (`ctx.frontier.minimap.draw(g, cx, cz, metresPerPixel)`, src/frontier/minimap.js) for the HUD minimap
 * and the world map.
 *
 * The frontier layer only REQUESTS missing tiles while it draws (≤ 2 worker jobs in flight) and the tiles
 * arrive asynchronously, so a view that is drawn once and then left alone stays empty. This cache:
 *   - primes the coarsest zoom first for a new area (a tiny scratch draw at ~1/32 of the view's resolution
 *     requests 1–4 big tiles), so the whole view shows the right biome colours within a moment and the
 *     fine tiles refine it, instead of flat placeholder squares;
 *   - re-draws at `every` while tiles keep arriving (the layer's tile count changed within `settle` s), then
 *     keeps a slow tail (every `tailEvery` s for `tail` s after the last change) in case the worker was busy
 *     with terrain jobs — and stops early once the frontier reports nothing missing (draw() → { missing });
 *   - otherwise costs nothing: the HUD composites the cached canvas each frame.
 *
 *   const layer = new FrontierLayer()
 *   layer.ensure(frontier, cx, cz, mpp, widthPx, heightPx, now) → true when the canvas was redrawn
 *   layer.canvas / .cx / .cz / .mpp  (the canvas centre is (cx, cz); mpp = metres per canvas pixel)
 */
import { MAP_EXTENT } from './mapImage.js';
import { HUB_FEATHER } from './mapStyle.js';

/** The planet layer paints everything outside this half-size; the hub image's feathered edge (the outer
 * HUB_FEATHER metres of ±MAP_EXTENT) cross-fades over it. */
export const HUB_HOLE = MAP_EXTENT - HUB_FEATHER;
const DRAW_OPTS = { pois: false, hole: HUB_HOLE };

export class FrontierLayer {
  constructor({ settle = 2.5, every = 0.22, moveFrac = 0.12, tail = 14, tailEvery = 0.6 } = {}) {
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    this.g = this.canvas?.getContext('2d') || null;
    this.cx = NaN;
    this.cz = NaN;
    this.mpp = 0;
    this.w = 0;
    this.h = 0;
    this.version = 0; // bumps on every redraw
    this.drawnAt = -1e9;
    this.missing = -1; // tiles the frontier still lacks for this view (-1 = it doesn't say)
    this._tiles = -1;
    this._changedAt = -1e9;
    this._front = null;
    this._scratch = null;
    this.settle = settle; // s of quick redraws after the last change
    this.every = every; // s between redraws while settling
    this.tail = tail; // s of slow redraws after the last change (tiles may stall behind terrain jobs)
    this.tailEvery = tailEvery;
    this.moveFrac = moveFrac; // re-centre after moving this fraction of the canvas
  }

  /** Forget the cached picture (e.g. a new frontier instance after a reseed). */
  reset() {
    this.cx = NaN;
    this._tiles = -1;
    this.drawnAt = -1e9;
    this.missing = -1;
    if (this.g) this.g.clearRect(0, 0, this.w, this.h);
  }

  /** Requests the coarse tiles of an area first (a scratch draw at low resolution). */
  _prime(fm, cx, cz, spanM) {
    if (!this._scratch) {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      this._scratch = c.getContext('2d');
    }
    try {
      fm.draw(this._scratch, cx, cz, Math.max(1, spanM / 32), DRAW_OPTS);
    } catch {
      /* the real draw reports problems */
    }
  }

  ensure(frontier, cx, cz, mpp, w, h, now) {
    const fm = frontier?.minimap;
    if (!fm?.draw || !this.g) return false;
    if (frontier !== this._front) {
      this._front = frontier;
      this.reset();
    }
    w = Math.max(8, Math.round(w));
    h = Math.max(8, Math.round(h));
    const tiles = fm.size | 0;
    if (tiles !== this._tiles) {
      this._tiles = tiles;
      this._changedAt = now;
    }
    const sizeChanged = w !== this.w || h !== this.h;
    const zoomed = !(this.mpp > 0) || Math.abs(mpp / this.mpp - 1) > 0.035;
    const movedPx = Math.max(Math.abs(cx - this.cx), Math.abs(cz - this.cz)) / (this.mpp || mpp);
    const moved = !(movedPx < Math.min(w, h) * this.moveFrac);
    const since = now - this._changedAt;
    const wait = now - this.drawnAt;
    const incomplete = this.missing !== 0; // unknown (-1) counts as incomplete
    // tiles still missing but nothing in flight (the layer requests only while it draws): draw again so it asks
    const idle = this.missing > 0 && fm.stats?.().pending === 0 && wait >= this.every;
    const settling = idle || (incomplete && ((since < this.settle && wait >= this.every) || (since < this.tail && wait >= this.tailEvery)));
    if (!sizeChanged && !zoomed && !moved && !settling) return false;
    if (sizeChanged) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.w = w;
      this.h = h;
    }
    if (zoomed || moved || sizeChanged) {
      this._changedAt = now; // a new area: tiles will be requested
      this.missing = -1;
      this._prime(fm, cx, cz, Math.max(w, h) * mpp);
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    let r;
    try {
      // pois: false — the shell draws POIs itself (typed icon once discovered, "?" until then)
      r = fm.draw(g, cx, cz, mpp, DRAW_OPTS);
    } catch (err) {
      if (!this._warned) {
        this._warned = true;
        console.warn('[shell] frontier map layer failed', err);
      }
      return false;
    }
    // newer frontier layers say how many tiles of this view are still on their way
    this.missing = r && Number.isFinite(r.missing) ? r.missing : -1;
    this.cx = cx;
    this.cz = cz;
    this.mpp = mpp;
    this.drawnAt = now;
    this.version++;
    return true;
  }
}

/** Quantises a metres-per-pixel value to ~4 % steps so a slowly changing zoom doesn't redraw every frame. */
export function quantMpp(mpp) {
  const k = Math.log(mpp) / Math.log(1.04);
  return Math.pow(1.04, Math.round(k));
}
