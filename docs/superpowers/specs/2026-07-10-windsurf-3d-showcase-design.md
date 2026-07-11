# Severne Mach 3D Showcase — Design

2026-07-10 · approved by user

## What

Single-page web app: a procedurally generated Severne Mach slalom windsurf kit
(6.5 sail, mast, boom, slalom board, fin) in a clean dark studio. Orbit/zoom
with inertia, auto-rotate when idle, subtle sail flutter.

## Stack

Vite + npm, plain JavaScript, `three` as the only dependency. Geometry is
math; the sail texture is the official Severne catalog render
(`026-Mach-9-render-final-lr-1.png`, user-supplied).

## Structure

```
index.html
src/
  main.js        renderer, camera, lights, controls, loop
  sail.js        parametric sail membrane (luff curve, chord, belly, twist)
  hardware.js    mast, boom, extension, base
  board.js       lofted slalom hull + fin, deck texture
  sailTexture.js canvas-painted sail graphics (red panels, battens, logos, window)
  util.js        1D spline interp, tapered tube geometry
```

## Key decisions

- **Sail**: parametric surface, u along luff (tack→head), v luff→leech.
  The planform comes from scanning the catalog PNG's alpha silhouette at load
  time (`sailImage.js`), so the mesh outline matches the render exactly and
  UVs map straight into the image; draft belly and leech twist are added in
  3D on top. The PNG's own alpha gives the translucent window for free.
- **Board**: outline and deck texture from a scanned top-down deck photo
  (`src/board_map.png`, user-supplied), planar-projected onto the deck half
  of the loft; hull stays plain white (user request).
- **Board**: superellipse cross-sections lofted along length with rocker;
  raked extruded fin.
- **Studio**: RoomEnvironment IBL + key/rim lights, fake radial-gradient
  contact shadow (no shadow maps), CSS gradient backdrop, kit floats.
- **Interaction**: OrbitControls, damping, auto-rotate pauses on interaction
  and resumes after 3 s idle. Flutter = small per-frame vertex offset near
  the leech.

## Checks

Dev-mode assert: no non-finite values in any geometry. `vite build` passes.
Visual verification in browser.

## Skipped (add later if wanted)

Configurator, spec hotspots, water scene, footstraps.
