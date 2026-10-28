# Build module — progress log

Owner: build engineer (src/build/). Read this first when resuming.

## Plan (files in src/build/)
- `catalog.js` — categories (1–6) + pieces (ids, en/nl names, costs, snap type, power, unlocks, points)
- `geo.js` — GeoBuilder (merged vertex-coloured geometry with box UVs) + primitives
- `materials.js` — shared piece materials (metal, concrete, wood, glass, glow, neon, solar, banner, plant) with reveal patch + night uniforms
- `pieces.js` — procedural geometry per piece (+ physics/hit boxes in local space, variants ground/deck)
- `hologram.js` — ghost hologram material (fresnel, scanlines, grid, flicker), edge lines, projected grid
- `placement.js` — grid math, aim raycast (structures + terrain + foreign solids), snapping (planes), validation
- `structures.js` — instanced mesh sets, records, slots, physics boxes, persistence, reveal/dissolve
- `power.js` — production/consumption, energy accrual, base level
- `harvest.js` — resource nodes (instanced), hold-E interactions, ring, floating text, respawn
- `hud.js` + `build.css` — resources panel, build bar + piece strip, key hints, crosshair, base label
- `index.js` — install(ctx) → ctx.build; build mode overlay controller
- `dev/lab.html` + `dev/lab.js` — fast visual lab

## Status (13:50)
- [x] All files written: catalog, geo, materials, pieces, hologram, placement, structures, power,
      harvest, hud + build.css, icons, index (controller), dev/lab.html + dev/lab.js
- [x] Lab boots (`/src/build/dev/lab.html?view=house|sheet|ghost|nodes&time=17.6|20&hud=1&piece=…&focus=<pieceId>`),
      placeAt works for all pieces, HUD renders (resources, base label, power line)
- [x] Fixed: tower collider too wide, rock toNonIndexed warning, glass too milky
- NOTE: `npx vite build` currently fails because of src/vehicles (another engineer, missing ./traffic.js) — not ours

- [x] (14:30) Full game verified (low quality): module installs, 0 errors; quest "home" completes via placeAt
      (foundation 1, walls 4, roof 1, power 1 → done); B / 1–6 / Tab / R / Mouse0 place / X remove (+50 % refund)
      via debug.simulate; physics: player stands on a placed foundation; persistence: save → reload → restored
- [x] Lab look pass: cube module, tower, landing pad, house at golden hour + night; ghost hologram uses alpha
      blending (edges additive); glass night glow varied per panel; delta chips left of the resources panel
- [x] Placement fixes: room volumes need ≥ 2 supports; plane occlusion is height based; decor hits act as ground

- [x] (14:55) High-quality game shots: shots/build/final_build_ghost.png (build=1 at the plot: cube hologram,
      projected grid, bar, hints), final_villa_golden.png + final_villa_night.png (44-piece two-storey villa,
      quest "home" done, base level 4, 0 errors). placeAt got an optional `level`.
- [x] notes/build-requests.md written (shell edge markers over the resources panel, Esc + pointer lock, audio
      recipes used, systems quest matching, vehicles landing pads)

- [x] (15:05) harvest close-up (final_harvest.png) + NL lab (lab_ghost_nl.png) captured

## Resumed 17:02 (run 2)
- [x] vite build check passes (vehicles fixed by its owner)
- [x] i18n audit: all player-facing strings in src/build use t({en, nl}) / English default
- [x] Visual fixes: ghost hologram no longer saturates to white (lower HDR, lines alpha-blended),
      light pools 3x weaker (light mast blew out the ground at night), crystals: facet shading +
      cyan ground glow at night, projected grid brighter by day (uBoost from dayFactor)

- [x] (17:40) full-game functional re-check (low quality, one page): 0 errors, build=1 active, placeAt
      costs spent (metal −32 / stone −70 / wood −14), duplicate → build:invalid 'occupied', quest "home"
      done, remove → 50 % refund, R/Tab/Digit3/B keys, harvest node (+11 wood, node depleted), player
      stands on a placed foundation (y 22.25 = slab top), 60-piece villa script → reload → 66 restored
- battery piece redesigned (graphite cabinet, fins, charge bars) — the old one read as a white box

- build controls read the core action map (touch layer compatible); keyboard hints hidden on touch;
  per-frame allocations removed (HUD rows array, grid corner arrays, slot strings)

- [x] (18:01) final high-quality shots: final_build_ghost.png (cube hologram, translucent cyan, grid,
      bar, hints), final_villa_golden.png + final_villa_night.png (60-piece villa, vantage inside the plot
      at (-195, 302) → (-213, 315); the old vantage outside the plot was full of bushes)
- [x] perf (60 pieces, high): 74 instanced build meshes, ~9.9 k build triangles, frame 329 calls / 2.6 M tris
- [x] vite build check passes (18:03)

- [x] (18:12) power: 2 solar + generator + lamp → noon production 11/min, night 3/min (lamp −0.2/min),
      +5 energy in 30 s simulated, 2 power:change events
- [x] (18:20) NL check (?lang=nl): Grondstoffen, Structuur/Muur/Vloer/Dak/Decor/Energie, hints Plaatsen/
      Draaien/Verwijderen/Volgend onderdeel/Annuleren, "Jouw basis — Niveau 1", 1.250, 0 errors
      (shots/build/final_nl_build.png). Default English verified in all other shots.

- [x] (18:30) final_harvest.png re-shot (energy crystal at 19.3 h: facets, cyan ground glow, progress
      ring, prompt, "Collector" quest). The 18:08 attempt framed the wrong spot (zone arrival not settled
      when the eval ran) — wait ~4 s after ready before teleporting in scripted shots.

## Status: DONE (brief "Done when" verified) — remaining items are polish / other modules (see below)

## Open problems / notes
- Esc while the pointer is locked: the browser releases the lock first, the shell opens the pause
  menu while build mode stays active (request in build-requests.md → shell).
- Quest "home" ignores structures placed before it starts (request → systems).
- Light pools (lamps, light mast, crystals) are flat additive planes: on steep ground they can clip
  or float a few cm (kept small, polygon offset).
- Shell edge markers can overlap the resources panel (request → shell).
- Only verified under SwiftShader; shaders follow the real-GPU rules (guarded maths, HDR ≤ ~6).

