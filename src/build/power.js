/**
 * Power grid + base level.
 *   production  solar panels × world.dayFactor, generators and fusion cores (constant)
 *   consumption lamps / light masts, scaled by the night factor (they are lit at night)
 *   capacity    250 + batteries; energy accrues into state.resources.energy
 *               (rates are per minute of play) and never above the capacity
 * Emits `power:change` {production, consumption, net, capacity} when the
 * figures change (throttled) and `build:level` {level, prev, points} when the
 * base level changes. Lamps go dark (U.uPowered → 0) in a brown-out.
 */
import { levelFor, LEVEL_POINTS } from './catalog.js';

export function createPower(ctx, reg, mats, { accrue = () => true } = {}) {
  const { state, events } = ctx;
  const st = {
    production: 0,
    consumption: 0,
    net: 0,
    capacity: 250,
    level: 1,
    points: 0,
    nextPoints: LEVEL_POINTS[1],
    pieces: 0,
    categories: 0,
    hasPower: false,
  };
  const base = { solar: 0, constant: 0, night: 0, always: 0, store: 0 };
  let version = -1;
  let acc = 0;
  let lastP = -1;
  let lastC = -1;
  let throttle = 0;
  let initialised = false;

  function recount() {
    base.solar = base.constant = base.night = base.always = base.store = 0;
    let points = 0;
    const cats = new Set();
    let n = 0;
    for (const rec of reg.records.values()) {
      const p = rec.def.power;
      if (p?.produce) {
        if (p.solar) base.solar += p.produce;
        else base.constant += p.produce;
      }
      if (p?.consume) {
        if (p.night) base.night += p.consume;
        else base.always += p.consume;
      }
      if (p?.store) base.store += p.store;
      points += rec.def.points || 1;
      cats.add(rec.def.category);
      n++;
    }
    points += cats.size * 3;
    st.points = points;
    st.pieces = n;
    st.categories = cats.size;
    st.capacity = 250 + base.store;
    st.hasPower = base.solar + base.constant + base.night + base.always + base.store > 0;
    const lvl = levelFor(points);
    st.nextPoints = LEVEL_POINTS[lvl] ?? null;
    if (lvl !== st.level) {
      const prev = st.level;
      st.level = lvl;
      if (initialised) events.emit('build:level', { level: lvl, prev, points });
    }
  }

  function figures() {
    const day = ctx.world?.dayFactor ?? 1;
    const night = mats?.U?.uNight?.value ?? 1 - day;
    st.production = base.solar * Math.max(0, Math.min(1, day)) + base.constant;
    st.consumption = base.night * night + base.always;
    st.net = st.production - st.consumption;
  }

  function emit(force = false) {
    const p = Math.round(st.production * 10) / 10;
    const c = Math.round(st.consumption * 10) / 10;
    if (!force && p === lastP && c === lastC) return;
    lastP = p;
    lastC = c;
    events.emit('power:change', { production: p, consumption: c, net: Math.round((p - c) * 10) / 10, capacity: st.capacity });
  }

  /** Per frame (pausable): accrue energy, brown-out, events. */
  function update(dt) {
    if (version !== reg.version) {
      version = reg.version;
      recount();
      figures();
      if (initialised) emit(true);
      else lastP = lastC = -1;
      initialised = true;
    }
    figures();
    throttle -= dt;
    if (throttle <= 0) {
      throttle = 2;
      emit(false);
    }
    // energy accrual (per minute rates) — single-player only: online the server owns the inventory
    if (!accrue()) acc = 0;
    else acc += (st.net / 60) * dt;
    if (acc >= 1 || acc <= -1) {
      const whole = acc > 0 ? Math.floor(acc) : Math.ceil(acc);
      acc -= whole;
      const cur = state.get('resources.energy') ?? 0;
      if (whole > 0) {
        const room = st.capacity - cur;
        if (room > 0) state.add('resources.energy', Math.min(whole, room));
      } else if (cur > 0) state.add('resources.energy', Math.max(whole, -cur));
    }
    // brown-out: lamps dim when the grid is drained at night
    const energy = state.get('resources.energy') ?? 0;
    const powered = st.net >= 0 || energy > 0 || state.get('settings.creative');
    const U = mats?.U;
    if (U) U.uPowered.value += ((powered ? 1 : 0.04) - U.uPowered.value) * Math.min(1, dt * 3);
  }

  return { state: st, update, recount, emit, figures };
}
