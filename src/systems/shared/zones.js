/**
 * Zone presence tracker: every 0.25 s works out which zone (layout.js) the
 * player — or the vehicle they drive — is in, emits 'zone' {zone, prev} on the
 * internal systems bus and discovers new zones (banner + XP). Discovery from
 * the air only counts below 80 m above the ground (except Aurora City).
 */
import { playerPos, zoneAt, groundY } from './util.js';

export function createZoneTracker(ctx, { sys, progress }) {
  let current = null;
  let acc = 0;

  ctx.loop.add(
    'sys-zones',
    (dt) => {
      acc += dt;
      if (acc < 0.25) return;
      acc = 0;
      if (ctx.modes.transitioning) return;
      const p = playerPos(ctx);
      if (!p) return;
      const z = zoneAt(p.x, p.z);
      if (z !== current) {
        const prev = current;
        current = z;
        sys.emit('zone', { zone: z, prev });
      }
      if (z && !progress.isDiscovered(z)) {
        const alt = p.y - groundY(ctx, p.x, p.z);
        if (z === 'city' || alt < 80) progress.discover(z);
      }
    },
    { order: 41, when: () => ctx.modes.is('explore', 'drive') },
  );

  ctx.events.on('mode:change', ({ to }) => {
    if (to !== 'explore' && to !== 'drive' && current) {
      const prev = current;
      current = null;
      sys.emit('zone', { zone: null, prev });
    }
  });

  return {
    get current() {
      return current;
    },
  };
}
