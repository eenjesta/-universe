#!/usr/bin/env node
/**
 * Measures 16-bit PCM WAV files with the lab's metrics (dev only):
 *   node src/audio/dev/wav-metrics.mjs shots/audio/vtol_hover-before.wav shots/audio/vtol_hover.wav [--from 1.6]
 */
import fs from 'node:fs';
import { analyse } from './metrics.js';

function readWav(file) {
  const b = fs.readFileSync(file);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 12;
  let fmt = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = dv.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { ch: dv.getUint16(o + 10, true), sr: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true) };
    if (id === 'data' && fmt) {
      if (fmt.bits !== 16) throw new Error(`${file}: only 16-bit PCM`);
      const len = Math.floor(size / (2 * fmt.ch));
      const chans = [...Array(fmt.ch)].map(() => new Float32Array(len));
      for (let i = 0; i < len; i++) for (let c = 0; c < fmt.ch; c++) chans[c][i] = dv.getInt16(o + 8 + (i * fmt.ch + c) * 2, true) / 32768;
      return { sampleRate: fmt.sr, length: len, numberOfChannels: fmt.ch, getChannelData: (c) => chans[c] };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error(`${file}: no data chunk`);
}

const argv = process.argv.slice(2);
const fi = argv.indexOf('--from');
const from = fi >= 0 ? Number(argv[fi + 1]) : 0;
const files = argv.filter((a, i) => !a.startsWith('--') && (fi < 0 || i !== fi + 1));
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('file', 30), pad('peak', 6), pad('centr', 6), pad('lapC', 6), pad('>2k%', 6), pad('tone', 12), pad('segRms', 7), pad('lapDb', 7), pad('aDb', 7), pad('lapA', 7), pad('mod', 9), 'click');
for (const f of files) {
  const r = analyse(readWav(f), from);
  console.log(pad(f.split('/').pop(), 30), pad(r.peak, 6), pad(r.centroid, 6), pad(r.lapCentroid, 6), pad(r.hi2k, 6), pad(`${r.tone}@${r.toneHz}`, 12), pad(r.segRmsDb, 7), pad(r.lapDb, 7), pad(r.aDb, 7), pad(r.lapA, 7), pad(`${r.modPct}%@${r.modHz}`, 9), r.clickDb);
}
