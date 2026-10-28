import fsp from 'node:fs/promises';
import path from 'node:path';

let seq = 0;

/** Write `data` to `file` atomically: temp file in the same dir → fsync → rename. */
export async function writeAtomic(file, data) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${++seq}.tmp`);
  const fh = await fsp.open(tmp, 'w', 0o600);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } catch (err) {
    await fh.close().catch(() => {});
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  await fh.close();
  try {
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Serialises async work per key (e.g. one write at a time per file). */
export class KeyedQueue {
  constructor() {
    this.tails = new Map();
  }
  run(key, fn) {
    const prev = this.tails.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    this.tails.set(key, tail);
    tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
  /** Resolves when everything queued so far has finished. */
  async idle() {
    while (this.tails.size) await Promise.all([...this.tails.values()]);
  }
}
