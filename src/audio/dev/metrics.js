/**
 * Audio measurements shared by the lab page (lab.js, OfflineAudioContext renders)
 * and the WAV CLI (wav-metrics.mjs). Pure JS: works on an AudioBuffer or on any
 * { sampleRate, length, numberOfChannels, getChannelData(ch) } object.
 *
 *   analyse(buf, fromSeconds) → { peak, peakDb, rmsDb, maxRmsDb, activeSec, hf, dc, nan,
 *     centroid, lapCentroid, hi1k, hi2k, bands, tone, toneHz, segRmsDb, lapDb, aDb, lapA,
 *     modHz, modPct, clickDb, frames }  (see spectral() for the definitions)
 */
export function analyse(buf, from = 0) {
  const sr = buf.sampleRate;
  const win = Math.floor(sr * 0.05);
  const a = Math.exp((-2 * Math.PI * 4000) / sr);
  let peak = 0;
  let nan = 0;
  let sum = 0;
  let hfSum = 0;
  let dc = 0;
  const nWin = Math.ceil(buf.length / win);
  const winE = new Float64Array(nWin);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    let hp = 0;
    let prev = 0;
    for (let i = 0; i < d.length; i++) {
      const x = d[i];
      if (!Number.isFinite(x)) {
        nan++;
        continue;
      }
      const ax = Math.abs(x);
      if (ax > peak) peak = ax;
      sum += x * x;
      dc += x;
      hp = a * (hp + x - prev);
      prev = x;
      hfSum += hp * hp;
      winE[(i / win) | 0] += x * x;
    }
  }
  const n = buf.length * buf.numberOfChannels;
  const thr = Math.pow(10, -50 / 10); // energy threshold per sample
  let active = 0;
  let activeE = 0;
  let maxWin = 0;
  for (let w = 0; w < nWin; w++) {
    const e = winE[w] / (win * buf.numberOfChannels);
    if (e > thr) {
      active++;
      activeE += e;
    }
    if (e > maxWin) maxWin = e;
  }
  const db = (v) => (v > 0 ? Math.round(10 * Math.log10(v) * 10) / 10 : -Infinity);
  return {
    peak: Math.round(peak * 1000) / 1000,
    peakDb: db(peak * peak),
    rmsDb: active ? db(activeE / active) : -Infinity,
    maxRmsDb: db(maxWin),
    activeSec: Math.round(active * win / sr * 100) / 100,
    hf: sum > 0 ? Math.round((hfSum / sum) * 1000) / 1000 : 0,
    dc: Math.round((dc / n) * 1e5) / 1e5,
    nan,
    ...spectral(buf, from),
  };
}

// ------------------------------------------------------------- spectrum
/** In-place iterative radix-2 FFT (re, im: Float64Array of length 2^k). */
function fft(re, im) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/**
 * Spectral + perceptual metrics over [from, end] s:
 *   centroid (Hz), hi1k / hi2k (% of energy above 1 / 2 kHz), bands (% per band),
 *   tone (most prominent narrow peak above 900 Hz: dB over the local median, @ Hz),
 *   segRmsDb (plain RMS), lapDb (RMS after a 2-pole 180 Hz high-pass ≈ what laptop
 *   speakers can play), clickDb (max short-time energy of the 2nd difference over its
 *   local median — steady noise ≈ 6–9 dB, a click / zipper step sticks out far above).
 */
function spectral(buf, from = 0) {
  const sr = buf.sampleRate;
  const N = 4096;
  const hop = 2048;
  const i0 = Math.min(buf.length - N, Math.max(0, Math.floor(from * sr)));
  const hann = new Float64Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const P = new Float64Array(N / 2 + 1);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let frames = 0;
  const chans = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c));
  for (const d of chans) {
    for (let s = i0; s + N <= buf.length; s += hop) {
      for (let i = 0; i < N; i++) {
        re[i] = (Number.isFinite(d[s + i]) ? d[s + i] : 0) * hann[i];
        im[i] = 0;
      }
      fft(re, im);
      for (let k = 0; k <= N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
      frames++;
    }
  }
  const hz = (k) => (k * sr) / N;
  let tot = 0;
  let wsum = 0;
  let a1 = 0;
  let a2 = 0;
  let totA = 0;
  let totLapA = 0;
  let totLap = 0;
  let wsumLap = 0;
  const aW = (f) => {
    const f2 = f * f;
    const ra = (12194 * 12194 * f2 * f2) / ((f2 + 20.6 * 20.6) * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) * (f2 + 12194 * 12194));
    return ra * ra * 1.585; // +2 dB → A(1 kHz) = 0 dB
  };
  const lapW = (f) => {
    const r = Math.pow(f / 180, 4);
    return r / (1 + r);
  };
  const edges = [0, 100, 300, 1000, 2000, 4000, sr / 2 + 1];
  const band = new Float64Array(edges.length - 1);
  for (let k = 1; k <= N / 2; k++) {
    const f = hz(k);
    tot += P[k];
    wsum += f * P[k];
    if (f > 1000) a1 += P[k];
    if (f > 2000) a2 += P[k];
    const wa = aW(f);
    const wl = lapW(f);
    totA += P[k] * wa;
    totLapA += P[k] * wa * wl;
    totLap += P[k] * wl;
    wsumLap += f * P[k] * wl;
    for (let b = 0; b < band.length; b++) if (f >= edges[b] && f < edges[b + 1]) band[b] += P[k];
  }
  // tonal prominence above 900 Hz (local median over ±40 bins ≈ ±430 Hz)
  let tone = 0;
  let toneHz = 0;
  const kMin = Math.ceil((900 * N) / sr);
  const kMax = Math.min(N / 2 - 41, Math.floor((9000 * N) / sr));
  const tmp = [];
  for (let k = kMin; k <= kMax; k++) {
    if (!(P[k] >= P[k - 1] && P[k] >= P[k + 1])) continue;
    tmp.length = 0;
    for (let j = k - 40; j <= k + 40; j++) if (Math.abs(j - k) > 3) tmp.push(P[j]);
    tmp.sort((x, y) => x - y);
    const med = tmp[tmp.length >> 1] || 1e-30;
    const prom = 10 * Math.log10((P[k] + 1e-30) / (med + 1e-30));
    // only peaks that carry real energy (> −60 dB of the total) count
    if (prom > tone && P[k] > tot * 1e-6) {
      tone = prom;
      toneHz = Math.round(hz(k));
    }
  }
  // time-domain: RMS, laptop RMS (HP 180 Hz, Q .707), click score
  const w0 = (2 * Math.PI * 180) / sr;
  const al = Math.sin(w0) / (2 * 0.7071);
  const cw = Math.cos(w0);
  const b0 = (1 + cw) / 2 / (1 + al);
  const b1 = -(1 + cw) / (1 + al);
  const a1c = (-2 * cw) / (1 + al);
  const a2c = (1 - al) / (1 + al);
  let e = 0;
  let eLap = 0;
  let count = 0;
  const cw1 = Math.floor(sr * 0.001); // 1 ms windows
  const nW = Math.floor((buf.length - i0) / cw1);
  const clickE = new Float64Array(Math.max(1, nW));
  for (const d of chans) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = i0; i < buf.length; i++) {
      const x = Number.isFinite(d[i]) ? d[i] : 0;
      const y = b0 * x + b1 * x1 + b0 * x2 - a1c * y1 - a2c * y2;
      const d2 = x - 2 * x1 + x2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      e += x * x;
      eLap += y * y;
      count++;
      const w = ((i - i0) / cw1) | 0;
      if (w < nW && i > i0 + 2) clickE[w] += d2 * d2;
    }
  }
  // modulation (rhythm): energy envelope in 5 ms blocks → strongest periodicity 2–60 Hz
  const blk = Math.floor(sr * 0.005);
  const nB = Math.floor((buf.length - i0) / blk);
  const env = new Float64Array(Math.max(1, nB));
  for (const d of chans) for (let b = 0; b < nB; b++) for (let i = 0; i < blk; i++) {
    const x = d[i0 + b * blk + i] || 0;
    env[b] += x * x;
  }
  let envMean = 0;
  for (let b = 0; b < nB; b++) envMean += env[b] / Math.max(1, nB);
  let modHz = 0;
  let modPct = 0;
  if (nB > 64 && envMean > 0) {
    const fs = 1 / 0.005;
    let wsumH = 0;
    for (let b = 0; b < nB; b++) wsumH += 0.5 - 0.5 * Math.cos((2 * Math.PI * b) / (nB - 1));
    for (let fm = 2; fm <= 60; fm += 0.25) {
      let xr = 0;
      let xi = 0;
      for (let b = 0; b < nB; b++) {
        const wv = (0.5 - 0.5 * Math.cos((2 * Math.PI * b) / (nB - 1))) * (env[b] - envMean);
        const ph = (2 * Math.PI * fm * b) / fs;
        xr += wv * Math.cos(ph);
        xi -= wv * Math.sin(ph);
      }
      const m = (2 * Math.hypot(xr, xi)) / (wsumH * envMean);
      if (m > modPct) {
        modPct = m;
        modHz = fm;
      }
    }
  }
  let click = 0;
  const R = 50; // ±50 ms neighbourhood
  const loc = [];
  for (let w = 0; w < nW; w += 1) {
    loc.length = 0;
    for (let j = Math.max(0, w - R); j <= Math.min(nW - 1, w + R); j += 3) if (Math.abs(j - w) > 2) loc.push(clickE[j]);
    if (!loc.length) continue;
    loc.sort((x, y) => x - y);
    const med = loc[loc.length >> 1];
    if (med <= 1e-14) continue;
    const r = clickE[w] / med;
    if (r > click) click = r;
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  const dbp = (v) => (v > 0 ? r1(10 * Math.log10(v)) : -Infinity);
  return {
    centroid: tot > 0 ? Math.round(wsum / tot) : 0,
    hi1k: tot > 0 ? Math.round((a1 / tot) * 1000) / 10 : 0,
    hi2k: tot > 0 ? Math.round((a2 / tot) * 10000) / 100 : 0,
    bands: [...band].map((b) => (tot > 0 ? Math.round((b / tot) * 1000) / 10 : 0)).join('/'),
    tone: r1(tone),
    toneHz,
    segRmsDb: count ? dbp(e / count) : -Infinity,
    lapDb: count ? dbp(eLap / count) : -Infinity,
    aDb: count && tot > 0 ? dbp(((e / count) * totA) / tot) : -Infinity,
    lapA: count && tot > 0 ? dbp(((e / count) * totLapA) / tot) : -Infinity,
    lapCentroid: totLap > 0 ? Math.round(wsumLap / totLap) : 0,
    modHz,
    modPct: Math.round(modPct * 100),
    clickDb: dbp(click),
    frames,
  };
}
