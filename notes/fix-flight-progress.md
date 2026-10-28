# Fix flight / chase camera / parked-ship visibility — progress log

Scope: src/vehicles/** (all), src/space/flight.js (player flight + chase camera only).
Not touched: src/characters (camera-rig request → notes/vehicles-requests.md), src/core, src/shell,
src/systems, src/audio, src/space shader/material/sky/nebula/asteroid files.
Scratch files: scratchpad/ff/ (shared scratchpad → own subfolder).

## Status
- [ ] baseline measurements (before)
- [ ] A: air attitude (VTOL/ship) + car attitude; drive-mode chase camera
- [ ] B: space flight roll / chase camera
- [ ] C: parked ship visibility (golden hour + night), VTOL/car fill
- [ ] D: vehicles shader / CPU NaN audit
- [ ] verify: logic (low), screenshots (medium/high), build, errors []

## Findings
