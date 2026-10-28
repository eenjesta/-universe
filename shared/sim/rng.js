/**
 * Deterministic PRNG helpers for the simulation (identical to src/core/math.js
 * mulberry32 / hashString / Rng so seeded sequences match the client).
 * Pure JS: no DOM, no Node APIs.
 */

/** mulberry32 → function producing floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash → 32-bit seed. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded random helper: `new Rng('trees')` or `new Rng(1234)`. */
export class Rng {
  constructor(seed = 1) {
    this.next = mulberry32(typeof seed === 'string' ? hashString(seed) : seed);
  }
  random() {
    return this.next();
  }
  range(min, max) {
    return min + (max - min) * this.next();
  }
  int(min, maxInclusive) {
    return Math.floor(this.range(min, maxInclusive + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
}
