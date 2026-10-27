/**
 * Tiny synchronous event bus. Listener errors are caught and logged so one
 * faulty subscriber can never break the emitter (or other subscribers).
 * See ARCHITECTURE.md → "Event catalog" for the names in use.
 */
export class Events {
  constructor() {
    this.map = new Map();
  }

  on(name, fn) {
    let set = this.map.get(name);
    if (!set) this.map.set(name, (set = new Set()));
    set.add(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const off = this.on(name, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off(name, fn) {
    this.map.get(name)?.delete(fn);
  }

  emit(name, payload) {
    const set = this.map.get(name);
    if (set) {
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[events] listener for "${name}" failed`, err);
        }
      }
    }
    const any = this.map.get('*');
    if (any) {
      for (const fn of [...any]) {
        try {
          fn(name, payload);
        } catch (err) {
          console.error('[events] wildcard listener failed', err);
        }
      }
    }
  }
}
