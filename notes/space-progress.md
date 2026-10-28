# Space module — progress log

(Resumable log. Update after every milestone.)

## Files (src/space/)
- geo.js — loft/mirror/box-UV/merge helpers (PartBuilder)
- ship-model.js — createShipModel(opts) (player ship, shared with vehicles) — DONE, looked at in studio
- models.js — pirate, freighter, shuttle geometry, colony fallback, wreck
- layout.js — SPACE map (spawn, field, rings, anomaly, wreck, station, convoy path, hero rocks)
- sky.js — baked sky cube + env, stars, planet (baked maps), atmosphere, gas giant, sun, flare
- asteroids.js — instanced field (5 variants, GPU tumble), hero rocks, wrapped debris, collision grid
- station.js — Station Halo (ring, spires, hub, habitat ring, dock bay, shuttles, SDF)
- nebula.js — nebula puffs + anomaly rift
- fx.js — particles, flashes, debris, trails, dust/speed lines, shield bubble
- combat.js — bolts, missiles, damage, lock-on
- ships.js — pirates, wingmen, convoy
- flight.js — player flight + chase camera
- missions.js — warp-in, stages, scans, convoy, docking, landing, recovery
- hud.js + space.css — radar, speed, systems, crosshair, markers, dock reticle, vignette
- index.js — install → ctx.space, mode 'space', preview camera
- dev/lab.html + lab.js — lab: ?view=ship|models (studio) or full space mode (+stage=…)

## Status
- [x] all files written, vite build passes (13:40)
- [x] lab runs with 0 errors (low: ~70-80 draw calls, ~0.4 M tris, 1752 asteroids)
- [x] logic verified in lab via simulate: anomaly + wreck scan (space:scan), rock collision (bounce + shield dmg),
      lasers/heat, boost/FOV, missiles, space:kill, convoy start→attack→safe, docking → space:dock + repair + 150 credits
- [x] visual pass 1 (planet light, trails, flare, rift edges, rock colours, fill light, stage spawns)
- [x] full game: mode=space 0 errors (95 draw calls / 0.7 M tris at high), quest tracker top-left in English,
      L → explore (spaceport, arrival ship), vehicles colony model used in the convoy, lang=nl HUD checked
- [x] visual pass 2 (bloom, hull roughness, charcoal rocks, aura seam, HUD declutter, convoy spawn, preview pose)
- [x] final shots in shots/space/: h_default_game, h_station, h_convoy, h_anomaly, h_wreck, h_docking,
      h_preview / l_preview, l_station_nl
- DONE — see notes/space-requests.md for integration notes. Possible later work: dark dust billboards in
  the nebula, LOD for hero rocks, missile sound recipe, colony landing (later wave).
