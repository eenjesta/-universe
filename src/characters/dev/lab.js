/**
 * Dev-only character lab (not part of the game build): renders portrait grids
 * with the real character pipeline but without loading the whole game.
 *   /src/characters/dev/lab.html?set=faces&framing=face
 * Sets window.__game.ready so tools/shot.mjs can capture it.
 */
import * as THREE from 'three';
import { createPortraits } from '../portraits.js';
import { NAMED } from '../npc-roster.js';
import { normalizeAppearance, PLAYER_OUTFITS, HAIR_STYLES } from '../appearance.js';
import { DEFAULT_APPEARANCE } from '../../core/state.js';

const q = Object.fromEntries(new URLSearchParams(location.search));
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(1280, 720, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const ctx = { engine: { renderer, snapshot: null }, npcs: null };
const portraits = createPortraits(ctx, {
  resolveAppearance: (id) => {
    if (id === 'player') return normalizeAppearance(DEFAULT_APPEARANCE);
    const r = NAMED.find((x) => x.id === id);
    return r ? normalizeAppearance(r.app) : null;
  },
});
const base = normalizeAppearance({ ...DEFAULT_APPEARANCE, ...(q.app ? JSON.parse(q.app) : {}) });
const framing = q.framing || 'face';
const view = q.view || 'three-quarter';
const W = +(q.w || (framing === 'full' ? 200 : 250));
const H = +(q.h || (framing === 'full' ? 350 : 280));
let jobs = [];
const set = q.set || 'faces';
if (set === 'faces') for (let f = 0; f < 6; f++) for (const body of ['m', 'f']) jobs.push({ ...base, face: f, body });
else if (set === 'hair') for (const h of HAIR_STYLES) jobs.push({ ...base, hair: h.id });
else if (set === 'outfits') for (const o of PLAYER_OUTFITS) jobs.push({ ...base, outfit: o.id, outfitColor: o.color, accentColor: o.accent });
else if (set === 'named') jobs = NAMED.map((n) => n.id);
else if (set === 'one') jobs = [base];
const views = q.views ? q.views.split(',') : [view];
const out = document.getElementById('out');
const t0 = performance.now();
for (const j of jobs) {
  for (const v of views) {
    const c = portraits.render(j, { width: W, height: H, framing, view: v, fast: true, look: q.look !== '0' });
    c.className = 'p';
    out.appendChild(c);
  }
}
window.__game = { ready: true, debug: { info: () => ({ ms: Math.round(performance.now() - t0), jobs: jobs.length }) } };
