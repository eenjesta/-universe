import * as THREE from 'three';

/**
 * Space map (metres, +Y up, −Z north). The asteroid field sits in front of
 * the default arrival point; Station Halo hangs north-east above it, the
 * anomaly glows inside the western field, the derelict lies in the Northern
 * Rings, and the convoy crosses the nebula in the east toward the station.
 */
const v = (x, y, z) => new THREE.Vector3(x, y, z);

export const SPACE = {
  /** Default arrival (warp-in from the planet): ship heading north into the field. */
  spawn: { position: v(0, 60, 2650), yaw: 0, pitch: 0.04 },
  field: { center: v(0, 0, -600), radii: v(3600, 1100, 3200) },
  rings: { center: v(-400, 350, -7600), radii: [1600, 2100, 2600], tilt: new THREE.Euler(0.22, 0.3, 0.12) },
  anomaly: v(-3400, -200, -2400),
  wreck: v(-1900, 380, -9050),
  station: v(3700, 1600, -5400),
  /** Camera direction for the "02" approach: toward the planet azimuth, 39° up. */
  stationView: new THREE.Vector3(-0.389, 0.629, -0.673).normalize(),
  convoyPath: [v(11000, -400, 5200), v(9800, -150, 1800), v(8000, 250, -1600), v(6000, 900, -4000), v(4950, 1300, -4800)],
  nebula: { center: v(9200, 0, 1200), radius: 4200 },
  /** Hero rocks [x, y, z, radius]. */
  heroRocks: [
    [-760, 160, 1150, 230],
    [980, -260, 560, 170],
    [-3660, -110, -2680, 260],
    [-3110, -330, -2140, 190],
    [300, 520, -7100, 300],
    [2250, 420, -1850, 210],
  ],
  /** Keep-out spheres for procedural rock placement [Vector3, radius]. */
  keepOut: [],
};

SPACE.keepOut.push(
  [SPACE.spawn.position, 150],
  [SPACE.anomaly, 380],
  [SPACE.wreck, 320],
  [SPACE.station, 2300],
);
// keep the convoy corridor clear
{
  const curve = new THREE.CatmullRomCurve3(SPACE.convoyPath);
  for (let i = 0; i <= 24; i++) SPACE.keepOut.push([curve.getPoint(i / 24), 650]);
}

/** Stage spawns for ?stage=… (computed by the missions module where they depend on live objects). */
export const STAGES = ['station', 'convoy', 'anomaly', 'wreck'];
