/**
 * Structured logger: one JSON object per line on stdout (Railway parses them),
 * or a compact human format on a TTY (LOG_FORMAT=pretty).
 *
 *   const log = createLogger({ level: 'info' });
 *   log.info('player joined', { id: 'p3', players: 4 });
 *   const clog = log.child({ conn: 12 });   // adds fields to every line
 *   log.throttle('tick-error', 10_000).error('sim.step failed', { err });  // ≤ 1 line / 10 s per key
 *
 * Levels: debug < info < warn < error < silent. Error objects in fields are
 * reduced to { message, stack }.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function errFields(fields) {
  if (!fields) return fields;
  let out = fields;
  for (const k in fields) {
    const v = fields[k];
    if (v instanceof Error) {
      if (out === fields) out = { ...fields };
      out[k] = { message: v.message, code: v.code, stack: v.stack?.split('\n').slice(0, 6).join('\n') };
    }
  }
  return out;
}

export function createLogger({ level = 'info', format = 'json', base = {}, write } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const out = write || ((line) => process.stdout.write(line + '\n'));
  const throttles = new Map();

  function emit(lvl, msg, fields) {
    if (LEVELS[lvl] < min) return;
    const f = errFields(fields);
    if (format === 'pretty') {
      const ts = new Date().toISOString().slice(11, 23);
      const extra = { ...base, ...f };
      const rest = Object.keys(extra).length ? ' ' + JSON.stringify(extra) : '';
      out(`${ts} ${lvl.toUpperCase().padEnd(5)} ${msg}${rest}`);
    } else {
      out(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...base, ...f }));
    }
  }

  const api = {
    level,
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    enabled: (lvl) => LEVELS[lvl] >= min,
    child: (fields) => createLogger({ level, format, base: { ...base, ...fields }, write: out }),
    /** A logger that prints at most one line per `ms` for `key` (suppressed count is added). */
    throttle(key, ms = 10_000) {
      const wrap = (lvl) => (m, f) => {
        const now = Date.now();
        const t = throttles.get(key) || { at: 0, suppressed: 0 };
        throttles.set(key, t);
        if (now - t.at < ms) {
          t.suppressed++;
          return;
        }
        const suppressed = t.suppressed;
        t.at = now;
        t.suppressed = 0;
        emit(lvl, m, suppressed ? { ...f, suppressed } : f);
      };
      return { debug: wrap('debug'), info: wrap('info'), warn: wrap('warn'), error: wrap('error') };
    },
  };
  return api;
}
