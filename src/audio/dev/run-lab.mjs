#!/usr/bin/env node
/**
 * Runs the audio lab headless and prints a measurement table (dev only).
 *   node src/audio/dev/run-lab.mjs                       # all cases
 *   node src/audio/dev/run-lab.mjs --only laser,warp     # selected labels
 *   node src/audio/dev/run-lab.mjs --wav music.title --seconds 60   # also write shots/audio/<label>.wav
 *   node src/audio/dev/run-lab.mjs --only vtol@hover --wav vtol@hover --suffix -before  # <label>-before.wav
 *   node src/audio/dev/run-lab.mjs --only engines --json out.json   # every engine case (+ laser/boost/warp/scan)
 * Columns: peak, RMS (active windows), maxRms, active s, hf (old 4 kHz HP ratio), NaN, then the
 * spectrum of the analysed span: centroid Hz, laptop centroid (HP 180 Hz), % energy > 2 kHz,
 * most prominent tonal peak > 900 Hz (dB over local median @ Hz; a "beep" is > ~15 dB), RMS,
 * laptop RMS (HP 180 Hz), A-weighted level, laptop A-weighted level (≈ loudness on MacBook
 * speakers), strongest envelope modulation 2–60 Hz (depth % @ Hz: the rotor rhythm) and the
 * click score (steady noise ≈ 6–9 dB; compare a :game case with its @steady siblings).
 * Needs the shared dev server (default http://localhost:5199).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, []),
);
const base = (args.base || 'http://localhost:5199').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling'] });
const kill = setTimeout(() => {
  console.error('[lab] global timeout');
  browser.close().finally(() => process.exit(1));
}, Number(args.timeout || 900000));
try {
  const page = await browser.newPage();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(`  [${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
  await page.goto(`${base}/src/audio/dev/lab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.audioLab, null, { timeout: 60000 });
  if (args.wav) {
    for (const label of String(args.wav).split(',')) {
      const b64 = await page.evaluate(([l, s]) => window.audioLab.wav(l, s), [label, args.seconds ? Number(args.seconds) : null]);
      fs.mkdirSync('shots/audio', { recursive: true });
      const file = `shots/audio/${label.replace(/[^a-z0-9.-]/gi, '_')}${args.suffix && args.suffix !== true ? args.suffix : ''}.wav`;
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      console.log(`[lab] wrote ${file}`);
    }
  }
  if (!args.noRun) {
    let only = args.only ? String(args.only).split(',') : null;
    if (only && only.includes('engines')) {
      const all = await page.evaluate(() => window.audioLab.cases);
      const eng = all.filter((l) => /^(vtol|car|ship)[.@:]/.test(l) || ['laser', 'boost', 'warp', 'scan'].includes(l));
      only = [...new Set([...only.filter((l) => l !== 'engines'), ...eng])];
    }
    const res = await page.evaluate((o) => window.audioLab.run(o), only);
    const pad = (s, n) => String(s).padEnd(n);
    console.log(pad('case', 18), pad('peak', 6), pad('rmsDb', 7), pad('active', 7), pad('centr', 6), pad('lapC', 6), pad('>2k%', 6), pad('tone', 12), pad('segRms', 7), pad('lapDb', 7), pad('aDb', 7), pad('lapA', 7), pad('mod', 9), pad('click', 6), pad('ms', 6), 'notes');
    let bad = 0;
    for (const r of res) {
      if (r.error) {
        console.log(pad(r.label, 24), 'ERROR', r.error.split('\n')[0]);
        bad++;
        continue;
      }
      const flag = r.nan ? ' NAN' : r.peak >= 0.99 ? ' CLIP' : r.peak < 0.01 ? ' SILENT' : '';
      if (flag) bad++;
      console.log(pad(r.label, 18), pad(r.peak, 6), pad(r.rmsDb, 7), pad(r.activeSec, 7), pad(r.centroid, 6), pad(r.lapCentroid, 6), pad(r.hi2k, 6), pad(`${r.tone}@${r.toneHz}`, 12), pad(r.segRmsDb, 7), pad(r.lapDb, 7), pad(r.aDb, 7), pad(r.lapA, 7), pad(`${r.modPct}%@${r.modHz}`, 9), pad(r.clickDb, 6), pad(r.ms, 6), r.notes, flag);
    }
    console.log(`[lab] ${res.length} cases, ${bad} problem(s)`);
    if (args.json) fs.writeFileSync(String(args.json), JSON.stringify(res, null, 1));
  }
} finally {
  clearTimeout(kill);
  await browser.close();
}
