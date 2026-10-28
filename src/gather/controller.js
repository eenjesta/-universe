import * as THREE from 'three';
import { C, S } from '../../shared/protocol.js';
import { TOOLS, featureRule, bestTool, toolDamage, toolNeeded, GATHER_TEXT, GATHER_REASONS, rockRadius } from '../../shared/defs/tools.js';
import { NODE_GATHER } from '../../shared/sim/nodes.js';
import { REASONS } from '../../shared/defs/reasons.js';
import { t } from '../core/i18n.js';

/**
 * Gathering controller: look-at targeting (camera ray, forgiving fallback in front of the player),
 * the context prompt, hold E / LMB (no weapon drawn) / the touch action button → the best owned tool
 * is drawn and swung; every impact sends C.HARVEST { feature, tool, hit } (world features: trees,
 * rocks, crystal formations, plants, mushrooms) — predicted FX at once, the server's S.FEATURE
 * reconciles HP and ends it (felled / broken / picked). Resource nodes (src/build/harvest.js) use
 * the same flow: local swings, then one C.HARVEST { node, tool }.
 */
const SCAN_R = 7.5; // m around the player
const NODE_R = 6;
const IDLE_PUT_AWAY = 1.8; // s without swinging before the tool goes back

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();

export function createController(ctx, { fx, hud, anims, hands }) {
  const { input, events, ui } = ctx;
  const F = () => ctx.frontier?.features || null;
  const nodeApi = () => ctx.nodeHarvest || null;
  const near = [];
  const ruleProbe = { id: '', type: '', variant: '', scale: 1, biome: '' };

  // ---------------------------------------------------------------- inventory (server mirror)
  const inv = { items: {} };
  const refreshInv = () => {
    const it = ctx.state?.get?.('smp.items');
    inv.items = it && typeof it === 'object' ? it : {};
  };
  refreshInv();
  events.on('net:inv', () => setTimeout(refreshInv, 0));
  events.on('state:change', (e) => {
    if (typeof e?.path === 'string' && e.path.startsWith('smp.items')) refreshInv();
  });

  const online = () => {
    const m = ctx.net?.mode;
    return (m === 'online' || m === 'local') && typeof ctx.net?.send === 'function';
  };
  const meId = () => ctx.net?.id ?? null;

  // ---------------------------------------------------------------- targets
  function makeTarget() {
    return { src: null, id: null, f: null, node: null, rule: null, act: 'chop', tier: 0, tool: 'multitool', ok: true, need: null, text: '', aim: new THREE.Vector3(), top: new THREE.Vector3(), r: 1, y0: 0, y1: 1, dist: 0, hp: 1, max: 1, kindName: '' };
  }
  let target = null;
  const cand = makeTarget();
  const best = makeTarget();
  const cur = makeTarget(); // the stored current target
  const fbT = makeTarget(); // best "in front of me" fallback of a scan
  let scanT = 0;

  function ruleOf(f) {
    ruleProbe.id = f.id;
    ruleProbe.type = f.type;
    ruleProbe.variant = f.kind === 3 || f.kind === 4 ? f.variant : f.name;
    ruleProbe.scale = f.scale;
    ruleProbe.biome = f.biome;
    return featureRule(ruleProbe);
  }

  function verbFor(f, rule) {
    if (rule.kind === 'tree') return GATHER_TEXT.tree;
    if (rule.kind === 'rock') return rule.tier > 0 ? GATHER_TEXT.ore : GATHER_TEXT.rock;
    if (rule.kind === 'crystal') return GATHER_TEXT.crystal;
    if (rule.kind === 'pebble') return GATHER_TEXT.pebble;
    if (rule.kind === 'berries') return GATHER_TEXT.berries;
    if (rule.kind === 'mushroom') return GATHER_TEXT.mushroom;
    return f.name === 'glowPlant' ? GATHER_TEXT.fruit : GATHER_TEXT.fiber;
  }

  /** Fills `tg` for a frontier feature; false when it's not gatherable. */
  function fromFeature(tg, f, P) {
    const rule = ruleOf(f);
    if (!rule) return false;
    tg.src = 'feature';
    tg.id = f.id;
    tg.f = tg.f || {};
    Object.assign(tg.f, f);
    tg.node = null;
    tg.rule = rule;
    tg.act = rule.act;
    tg.tier = rule.tier;
    tg.kindName = rule.kind;
    let r = 0.6;
    let h = 0.5;
    if (rule.kind === 'tree') {
      r = 0.35 + 0.25 * f.scale;
      h = 1.3;
    } else if (rule.kind === 'rock') {
      r = rockRadius(f.name, f.scale) + 0.2;
      h = Math.min(1.3, r * 0.7);
    } else if (rule.kind === 'crystal') {
      r = 0.7 * f.scale;
      h = 0.9 * f.scale;
    } else if (rule.kind === 'berries') {
      r = 0.9 * f.scale;
      h = 0.8 * f.scale;
    } else {
      r = 0.45 * f.scale + 0.2;
      h = 0.3 * f.scale;
    }
    tg.r = r;
    tg.aim.set(f.x, f.y + h, f.z);
    const topH = rule.kind === 'tree' ? 2.4 : rule.kind === 'crystal' ? 1.9 * f.scale : rule.kind === 'rock' ? Math.min(2.6, h * 1.6 + 0.4) : h + 0.7;
    tg.top.set(f.x, f.y + topH, f.z);
    // the vertical extent the camera ray is tested against (a trunk is "looked at" anywhere along it)
    tg.y0 = f.y + (rule.kind === 'tree' ? 0.25 : 0);
    tg.y1 = f.y + (rule.kind === 'tree' ? 4.5 : rule.kind === 'crystal' ? 2.2 * f.scale : rule.kind === 'rock' ? Math.max(0.4, h * 1.7) : rule.kind === 'berries' ? 1.4 * f.scale : 0.6 * f.scale + 0.1);
    tg.dist = Math.hypot(f.x - P.x, f.z - P.z);
    return tg.dist <= rule.reach + 0.5;
  }

  function fromNode(tg, n, P) {
    const G = NODE_GATHER[n.type];
    if (!G) return false;
    tg.src = 'node';
    tg.id = n.sid;
    tg.f = null;
    tg.node = n;
    tg.rule = null;
    tg.act = G.act;
    tg.tier = 0;
    tg.kindName = n.type;
    tg.r = 1.2 * (n.scale || 1);
    tg.aim.set(n.x, n.y + 0.6, n.z);
    tg.top.set(n.x, n.y + 2.0, n.z);
    tg.y0 = n.y;
    tg.y1 = n.y + 1.4 * (n.scale || 1);
    tg.dist = Math.hypot(n.x - P.x, n.z - P.z);
    return tg.dist <= 3.6;
  }

  function copyTarget(dst, src) {
    for (const k in src) {
      if (k === 'aim' || k === 'top') dst[k].copy(src[k]);
      else if (k === 'f') {
        if (src.f) dst.f = Object.assign(dst.f || {}, src.f);
        else dst.f = null;
      } else dst[k] = src[k];
    }
  }

  /**
   * Scores a candidate against the camera ray (lower = better; Infinity = not looked at): the
   * distance between the ray and the target's vertical extent (x, y0…y1, z), relative to its radius.
   */
  function rayScore(tg) {
    const hx = tg.aim.x - _o.x;
    const hz = tg.aim.z - _o.z;
    const dh = _d.x * _d.x + _d.z * _d.z;
    // the ray's height where it passes closest (horizontally) to the target's axis
    const tc = dh > 1e-6 ? (hx * _d.x + hz * _d.z) / dh : 0;
    let y = _o.y + _d.y * Math.max(0, tc);
    y = y < tg.y0 ? tg.y0 : y > tg.y1 ? tg.y1 : y;
    _w.set(hx, y - _o.y, hz);
    const along = _w.dot(_d);
    if (along < 0.3) return Infinity;
    _a.copy(_d).multiplyScalar(along).sub(_w);
    const perp = _a.length();
    const lim = tg.r * 1.25 + 0.35;
    if (perp > lim) return Infinity;
    return perp / lim + tg.dist * 0.05;
  }

  function scan() {
    const P = ctx.player?.position;
    const cam = ctx.engine?.camera || ctx.camera;
    if (!P || !cam) return null;
    cam.getWorldPosition(_o);
    cam.getWorldDirection(_d);
    let bestScore = Infinity;
    let fallback = Infinity;
    let fb = null;
    fbT.f = fbT.f || null;
    const fwdx = _d.x;
    const fwdz = _d.z;
    const fl = Math.hypot(fwdx, fwdz) || 1;
    const consider = (tg) => {
      let s = rayScore(tg);
      if (s < bestScore) {
        bestScore = s;
        copyTarget(best, tg);
      }
      // forgiving: in front of the player (camera yaw), within ±55°
      const dx = (tg.aim.x - P.x) / Math.max(0.01, tg.dist);
      const dz = (tg.aim.z - P.z) / Math.max(0.01, tg.dist);
      const cos = (dx * fwdx + dz * fwdz) / fl;
      if (cos > 0.57 || tg.dist < 1.2) {
        s = tg.dist * 0.4 + (1 - cos) * 2;
        if (s < fallback) {
          fallback = s;
          fb = fbT;
          copyTarget(fb, tg);
        }
      }
    };
    const fr = F();
    if (fr && online()) {
      fr.near(P.x, P.z, SCAN_R, near);
      for (const f of near) if (fromFeature(cand, f, P)) consider(cand);
    }
    const api = nodeApi();
    if (api) {
      for (const list of [api.nodes, api.wnodes]) {
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const n = list[i];
          if (!n.available || n.waitT > 0) continue;
          if (Math.abs(n.x - P.x) > NODE_R || Math.abs(n.z - P.z) > NODE_R) continue;
          if (fromNode(cand, n, P)) consider(cand);
        }
      }
    }
    if (bestScore < Infinity) return best;
    return fb;
  }

  function decorate(tg) {
    // tool + prompt text
    const act = tg.act;
    tg.tool = act === 'gather' ? 'hands' : bestTool(inv, act, tg.tier);
    const T = TOOLS[tg.tool];
    tg.ok = act === 'gather' || (T.tier >= tg.tier && (T.power[act] || 0) > 0);
    tg.need = tg.ok ? null : toolNeeded(act, tg.tier);
    let verb;
    if (tg.src === 'node') verb = nodeApi()?.types?.[tg.kindName]?.label || GATHER_TEXT.node;
    else verb = verbFor(tg.f, tg.rule);
    if (!tg.ok) tg.text = t(GATHER_TEXT.needs, { tool: t(TOOLS[tg.need]?.name || { en: tg.need }) });
    else if (act === 'gather') tg.text = t(verb);
    else tg.text = `${t(verb)} · ${t(T.name)}${tg.tool === 'multitool' ? ' …' : ''}`;
  }

  // ---------------------------------------------------------------- swinging
  let active = null; // { tg, seq, hp, max, nextSwing, waiting, swings, started }
  let idleT = 0;
  let clickHeld = false;
  const tipV = new THREE.Vector3();
  const dirV = new THREE.Vector3();
  let seq = 0;

  function start(tg) {
    stop(false);
    active = { tg: makeTarget(), hp: 1, max: 1, nextSwing: 0, waiting: 0, swings: 0, pending: false };
    copyTarget(active.tg, tg);
    const hp = tg.src === 'node' ? NODE_GATHER[tg.kindName]?.hp || 35 : tg.rule.hp;
    active.hp = active.max = hp;
    const st = tg.src === 'feature' ? F()?.state?.(tg.id) : null;
    if (st?.hp > 0) active.hp = st.hp;
    if (ctx.combat?.armed) ctx.combat.holster?.();
    hands.hold(tg.tool);
    idleT = 0;
    // onboarding: the multitool works, but an axe / pickaxe is much better
    if (tg.tool === 'multitool') {
      const want = tg.act === 'chop' ? 'axe' : 'pickaxe';
      hud.tip(`craft-${want}`, {
        title: t({ en: 'Ø Multitool — slow', nl: 'Ø-multitool — langzaam' }),
        text: t(
          want === 'axe'
            ? { en: 'Craft an Axe (I → Crafting, no workbench needed): trees fall 2.5× faster.', nl: 'Maak een bijl (I → Maken, geen werkbank nodig): bomen vallen 2,5× sneller.' }
            : { en: 'Craft a Pickaxe (I → Crafting, no workbench needed): rocks break 2.5× faster and ore rocks give metal.', nl: 'Maak een houweel (I → Maken, geen werkbank nodig): rotsen breken 2,5× sneller en ertsrotsen geven metaal.' },
        ),
        icon: want === 'axe' ? 'tool-axe' : 'tool-pickaxe',
      });
    }
  }

  function stop(keepTool = true) {
    if (!active) return;
    hands.cancelImpact();
    active = null;
    if (!keepTool) hands.hold(null);
  }

  function swingOnce() {
    const tg = active.tg;
    const T = TOOLS[tg.tool];
    const action = tg.act === 'gather' ? 'gather' : tg.act;
    const r = hands.swing(action, T.swing, tg.aim);
    if (!r) return false;
    active.pending = true;
    active.nextSwing = Math.max(T.swing, r.dur * 0.98);
    active.swings++;
    if (tg.act !== 'gather') ctx.audio?.play?.('gather.swing', { position: tg.aim, volume: 0.8 });
    return true;
  }

  hands.onImpact(() => {
    if (!active?.pending) return;
    active.pending = false;
    impact();
  });

  function impact() {
    const tg = active.tg;
    const P = ctx.player?.position;
    if (!P) return;
    dirV.set(tg.aim.x - P.x, 0, tg.aim.z - P.z);
    if (dirV.lengthSq() < 1e-6) dirV.set(1, 0, 0);
    dirV.normalize();
    const dmg = tg.act === 'gather' ? active.hp : toolDamage(tg.tool, tg.act);
    const before = active.hp;
    active.hp = Math.max(0, active.hp - dmg);
    const frac = 1 - active.hp / Math.max(1, active.max);
    if (tg.src === 'feature') {
      seq++;
      ctx.net.send({ t: C.HARVEST, feature: tg.id, tool: tg.tool, hit: seq });
      if (tg.act !== 'gather') {
        anims.hit(tg.f, { dir: dirV, tool: tg.tool, act: tg.act, frac, mine: true });
        hud.showBar(tg.top, active.hp / active.max);
        if (tg.tool === 'mining-laser' && hands.tipWorld(tipV)) fx.beam(tipV, tg.aim, true);
      }
      if (active.hp <= 0) active.waiting = 1.6; // the server decides
    } else {
      // resource node: local swings, the last one harvests
      nodeFx(tg, dirV, frac);
      hud.showBar(tg.top, active.hp / active.max);
      if (active.hp <= 0 && before > 0) {
        const api = nodeApi();
        try {
          api?.harvest?.(tg.node, tg.tool);
        } catch (err) {
          console.warn('[gather] node harvest failed', err);
        }
        stop();
      }
    }
  }

  const NODE_DUST = { metal: [0.42, 0.44, 0.5], stone: [0.62, 0.6, 0.55], wood: [0.6, 0.45, 0.3], energy: [0.35, 0.6, 0.75] };
  function nodeFx(tg, dir, frac) {
    const n = tg.node;
    const at = _a.set(n.x - dir.x * 0.7, n.y + 0.6, n.z - dir.z * 0.7);
    const back = _w.set(-dir.x, 0.3, -dir.z);
    nodeApi()?.poke?.(n, 0.04 + 0.04 * frac);
    if (tg.kindName === 'wood') {
      fx.burst('chip', at, { n: 12, dir: back, speed: 3.4, spread: 0.8 });
      ctx.audio?.play?.('gather.chop', { position: at, wood: frac });
    } else {
      if (tg.tool === 'mining-laser') {
        fx.burst('ember', at, { n: 10, dir: back, speed: 3, spread: 0.9 });
        ctx.audio?.play?.('gather.laser', { position: at });
        if (hands.tipWorld(tipV)) fx.beam(tipV, at, true);
      } else {
        fx.burst('spark', at, { n: tg.kindName === 'metal' ? 16 : 8, dir: back, speed: 5.5, spread: 0.8 });
        ctx.audio?.play?.('gather.mine', { position: at, ore: tg.kindName === 'metal' ? 1 : 0, pitch: tg.kindName === 'energy' ? 1.25 : 1 });
      }
      if (tg.kindName === 'energy') fx.burst('shard', at, { n: 8, dir: back, speed: 3.5, spread: 0.9 });
      fx.burst('crumb', at, { n: 6, dir: back, speed: 2.6, spread: 0.8, color: NODE_DUST[tg.kindName] });
      fx.burst('dust', at, { n: 2, dir: back, speed: 0.8, color: NODE_DUST[tg.kindName] });
    }
  }

  /** S.HARVESTED for a node (harvest.js calls this): break burst + rewards. */
  function nodeHarvested(n, res, mine) {
    const at = _a.set(n.x, n.y + 0.7, n.z);
    const type = n.type;
    if (type === 'wood') {
      fx.burst('chip', at, { n: 20, speed: 3.5, spread: 1, up: 0.8 });
      fx.debris('log', at, { n: 3, speed: 2.2, up: 1.2, scale: [0.9, 0.16, 0.16], spin: 3, life: 3, magnet: mine ? () => playerChest() : null, delay: 0.5 });
      ctx.audio?.play?.('gather.crumble', { position: at, size: 0.6 });
    } else if (type === 'energy') {
      fx.burst('shard', at, { n: 30, speed: 5, spread: 1, up: 0.8 });
      fx.burst('mote', at, { n: 14, speed: 1.4, up: 1 });
      ctx.audio?.play?.('gather.shatter', { position: at });
    } else {
      fx.debris('rock', at, { n: 7, speed: 3.5, scale: 0.2, color: NODE_DUST[type], life: 3.5, magnet: mine ? () => playerChest() : null, delay: 0.6 });
      fx.burst('dust', at, { n: 10, speed: 1.4, spread: 1, up: 0.4, color: NODE_DUST[type], size: 1 });
      if (type === 'metal') fx.burst('spark', at, { n: 16, speed: 6, spread: 1 });
      ctx.audio?.play?.('gather.crumble', { position: at, size: 0.9 });
    }
    const pp = ctx.player?.position;
    if (pp && Math.hypot(pp.x - n.x, pp.z - n.z) < 8) ctx.cameraRig?.shake?.(0.08);
    if (mine && res) {
      hud.reward(_a.set(n.x, n.y + 1.6, n.z), { res });
      ctx.audio?.play?.('gather.pop', { n: 1 });
    }
  }
  const chest = new THREE.Vector3();
  const playerChest = () => {
    const p = ctx.player?.position;
    return p ? chest.set(p.x, p.y + 1.1, p.z) : null;
  };

  // ---------------------------------------------------------------- server messages
  function featureRec(id) {
    if (active?.tg?.id === id && active.tg.f) return active.tg.f;
    return F()?.get?.(id) || null;
  }

  function onFeature(m) {
    if (!m || typeof m.id !== 'string') return;
    const mine = m.by != null && m.by === meId();
    const fr = F();
    const final = m.state === 'felled' || m.state === 'broken' || m.state === 'picked';
    const f = featureRec(m.id);
    if (final) {
      fr?.set?.(m.id, m.state, Number(m.regrowAt) || 0);
      if (f) {
        const got = mine ? m.got : null;
        const at = new THREE.Vector3(f.x, f.y + 1.4, f.z);
        anims.finish(f, {
          state: m.state,
          dir: m.dir,
          tool: m.tool,
          mine,
          onCollect: () => {
            if (got) hud.reward(at.set(ctx.player?.position?.x ?? f.x, (ctx.player?.position?.y ?? f.y) + 2.0, ctx.player?.position?.z ?? f.z), got);
          },
        });
      } else if (mine && m.got) hud.reward(new THREE.Vector3(ctx.player.position.x, ctx.player.position.y + 2, ctx.player.position.z), m.got);
      if (active?.tg?.id === m.id) {
        hud.showBar(active.tg.top, 0);
        stop();
      }
      if (mine) {
        ctx.state?.add?.('stats.harvested', 1);
        events.emit('gather:done', { id: m.id, state: m.state, got: m.got || null, tool: m.tool });
        events.emit('harvest', { resource: Object.keys(m.got?.res || {})[0] || null, amount: Object.values(m.got?.res || {})[0] || 0, source: 'feature', feature: m.id, online: true });
      }
      return;
    }
    if (m.state === 'hit') {
      if (mine) {
        if (active?.tg?.id === m.id) {
          active.hp = Math.min(active.hp, m.hp);
          active.max = m.max || active.max;
          hud.showBar(active.tg.top, active.hp / active.max);
        }
        if (m.got && f) {
          // beside the strike point (left: the anchored prompt grows to the right), counts up per feature
          const P = ctx.player?.position;
          let dx = f.x - (P?.x ?? f.x - 1);
          let dz = f.z - (P?.z ?? f.z);
          const l = Math.hypot(dx, dz) || 1;
          dx /= l;
          dz /= l;
          const r = active?.tg?.id === m.id ? Math.min(1.2, active.tg.r) : 0.6;
          const h = active?.tg?.id === m.id ? Math.min(1.5, Math.max(0.5, active.tg.aim.y - f.y)) : 1.2;
          _a.set(f.x - dx * r + dz * 0.7, f.y + h, f.z - dz * r - dx * 0.7);
          hud.reward(_a, m.got, { big: false, key: m.id });
        }
      } else if (f) {
        // someone else is working on it: shake / chips / sound for everyone around
        const pp = ctx.player?.position;
        if (pp && Math.hypot(pp.x - f.x, pp.z - f.z) < 70) anims.hit(f, { dir: m.dir, tool: m.tool, frac: 1 - m.hp / Math.max(1, m.max), mine: false });
      }
    }
  }

  function onDeny(m) {
    if (m?.of !== C.HARVEST || m.feature == null) return;
    const id = m.feature;
    const isActive = active?.tg?.id === id;
    switch (m.reason) {
      case 'rate':
        if (isActive) active.nextSwing = Math.max(active.nextSwing, 0.15);
        return;
      case 'depleted':
        if (m.state) F()?.set?.(id, m.state, Number(m.regrowAt) || 0);
        if (isActive) stop();
        return;
      case 'tool': {
        if (isActive) stop();
        const need = toolNeeded(m.act || 'mine', m.need || 1);
        hud.deny(t(GATHER_TEXT.needs, { tool: t(TOOLS[need]?.name || { en: need }) }));
        return;
      }
      case 'noItem':
        refreshInv();
        if (isActive) stop();
        return;
      default:
        if (isActive) stop();
        if (m.reason === 'far' || m.reason === 'blocked' || m.reason === 'safe') hud.deny(t(GATHER_REASONS[m.reason] || REASONS[m.reason] || REASONS.invalid));
    }
  }

  function onWelcome(m) {
    const fr = F();
    if (!fr) return;
    fr.reset?.();
    const list = Array.isArray(m?.features) ? m.features : [];
    for (const e of list) {
      if (Array.isArray(e)) fr.set(e[0], e[1], Number(e[2]) || 0);
      else if (e?.id) fr.set(e.id, e.state, Number(e.regrowAt) || 0);
    }
  }

  // ---------------------------------------------------------------- per frame
  function enabled() {
    const p = ctx.player;
    if (!ctx.modes?.is?.('explore') || ctx.modes.transitioning) return false;
    if (!p || p.onFoot === false || p.dead || p.swimming) return false;
    if (ctx.build?.active || ctx.dialogue?.isOpen || ui.isModalOpen?.()) return false;
    if (!input.gameEnabled) return false;
    if (ctx.state?.get?.('smp.dead')) return false;
    return true;
  }

  let promptShown = false;
  function hidePrompt() {
    if (promptShown) {
      ui.prompt.hide('gather');
      promptShown = false;
    }
  }

  function update(dt) {
    if (!enabled()) {
      if (active) stop(false);
      if (hands.held && !active) hands.hold(null);
      target = null;
      hidePrompt();
      clickHeld = false;
      return;
    }
    // weapons win: a drawn weapon puts the tool away
    if (ctx.combat?.armed && hands.held) {
      stop(false);
      hands.hold(null);
    }
    // targeting at ~15 Hz (every frame while idle-swinging isn't needed: the active target is kept)
    scanT -= dt;
    if (scanT <= 0) {
      scanT = 1 / 15;
      const tg = scan();
      if (tg) {
        decorate(tg);
        copyTarget(cur, tg);
        target = cur;
      } else target = null;
    }
    const interact = ctx.interactions?.current;
    const eFree = !interact || String(interact.id || '').startsWith('bld-');
    // LMB = gather while no weapon is drawn (consume the press so combat doesn't draw a gun)
    if (target && !ctx.combat?.armed && input.pressed('Mouse0')) {
      input._pressed?.delete?.('Mouse0');
      clickHeld = true;
    }
    if (!input.down('Mouse0')) clickHeld = false;
    const want = (eFree && input.down('KeyE')) || clickHeld;
    // prompt
    if (target && eFree) {
      const prog = active && active.tg.id === target.id ? 1 - active.hp / Math.max(1, active.max) : null;
      ui.prompt.show('gather', { key: 'E', text: target.text, hold: true, progress: prog, anchor: target.top });
      promptShown = true;
    } else hidePrompt();
    // start / switch / stop
    if (want && target) {
      if (!target.ok) {
        if (input.pressed('KeyE') || input.pressed('Mouse0') || clickHeld) {
          hud.deny(target.text);
          clickHeld = false;
        }
      } else if (!active || (active.tg.id !== target.id && !active.waiting)) start(target);
    } else if (!want && active && !active.waiting) stop();
    if (active) {
      idleT = 0;
      if (active.waiting > 0) {
        active.waiting -= dt;
        if (active.waiting <= 0) stop();
      } else {
        // drifted out of reach?
        const P = ctx.player.position;
        const tg = active.tg;
        const reach = tg.src === 'node' ? 4 : (tg.rule?.reach || 3) + 1;
        if (Math.hypot(tg.aim.x - P.x, tg.aim.z - P.z) > reach) stop();
        else {
          active.nextSwing -= dt;
          if (active.nextSwing <= 0 && !active.pending) swingOnce();
        }
      }
    } else if (hands.held) {
      idleT += dt;
      if (idleT > IDLE_PUT_AWAY) hands.hold(null);
    }
  }

  // ---------------------------------------------------------------- wiring
  const offs = [];
  function attachNet() {
    for (const off of offs.splice(0)) off?.();
    const net = ctx.net;
    if (!net?.on) return;
    offs.push(net.on(S.FEATURE, onFeature));
    offs.push(net.on(S.DENY, onDeny));
  }
  attachNet();
  events.on('net:welcome', (m) => {
    onWelcome(m);
    refreshInv();
  });
  if (ctx.net?.welcome) onWelcome(ctx.net.welcome);
  const fr = F();
  if (fr && typeof ctx.net?.serverTime === 'function') fr.setClock(() => ctx.net.serverTime());
  events.on('world:frontier', () => {
    const f2 = F();
    if (f2 && typeof ctx.net?.serverTime === 'function') f2.setClock(() => ctx.net.serverTime());
    if (ctx.net?.welcome) onWelcome(ctx.net.welcome);
  });

  return {
    update,
    nodeHarvested,
    get target() {
      return target;
    },
    get active() {
      return active;
    },
    /** True while LMB would gather (a gatherable in reach, no weapon drawn) — combat skips click-to-draw. */
    get wantsClick() {
      return !!target && !ctx.combat?.armed;
    },
    stop,
    debug: { scan, onFeature, onDeny, inv },
  };
}
