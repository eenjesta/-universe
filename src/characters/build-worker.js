/**
 * Character build worker (characters module): builds skinned geometry arrays
 * off the main thread so hero meshes (≈40k triangles, 0.3–1 s of SDF
 * marching) never stall a frame. Messages: { id, app, lod } →
 * { id, key, arrays } (typed-array buffers are transferred) or { id, error }.
 */
import { buildArrays } from './character.js';

self.onmessage = (e) => {
  const { id, app, lod } = e.data || {};
  try {
    const a = buildArrays(app, lod);
    const arrays = {
      position: a.position,
      normal: a.normal,
      uv: a.uv,
      color: a.color,
      aMat: a.aMat,
      aDetail: a.aDetail,
      skinIndex: a.skinIndex,
      skinWeight: a.skinWeight,
      index: a.index,
      count: a.count,
    };
    const transfer = [a.position, a.normal, a.uv, a.color, a.aMat, a.aDetail, a.skinIndex, a.skinWeight, a.index].map((t) => t.buffer);
    self.postMessage({ id, key: a.key, arrays }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err?.stack || err) });
  }
};
