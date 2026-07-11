# Severne Mach — 3D Showcase

Interactive 3D viewer for a Severne Mach slalom windsurf kit: 6.5 m² sail, mast, boom, slalom board, and fin. The scene runs in the browser with orbit/zoom controls, auto-rotation when idle, and subtle sail flutter.

Built with **Vite** and **Three.js**. Geometry is procedural; textures come from catalog photos scanned at load time.

## Features

- **Photo-driven outlines** — Sail, board, and boom shapes are extracted from PNG alpha channels, so mesh silhouettes match the source renders exactly.
- **Parametric sail** — Draft belly, leech twist, camber inducers, batten pockets, and luff sleeve are added in 3D on top of the scanned planform.
- **Lofted board** — Superellipse cross-sections with rocker, textured deck and bottom, raked fin.
- **Studio presentation** — RoomEnvironment IBL, key/rim lights, radial contact shadow, dark gradient backdrop.
- **Interaction** — OrbitControls with damping; auto-rotate pauses on drag and resumes after 3 s idle.

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`).

Other scripts:

| Command | Description |
|---------|-------------|
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |

## Project structure

```
index.html              Entry page, caption overlay, dark backdrop
src/
  main.js               Renderer, scene, lights, controls, animation loop
  util.js               Image alpha scanning, splines, tapered tubes
  sailImage.js          Load & scan sail catalog render → planform + UVs
  sail.js               Parametric sail membrane, battens, sleeve, flutter
  boomImage.js          Load & scan boom photo → arm paths + texture
  hardware.js           Mast, boom, blocks, outhaul, mast base
  boardImage.js         Load & scan deck/bottom photos → outline + UVs
  board.js              Lofted hull mesh + fin
  board_map.png         Top-down deck photo (outline + deck texture)
026-Mach-9-render-final-lr-1.png   Sail catalog render (texture + outline)
board_bottom.png        Bottom hull photo
boom.png                Top-down boom photo
docs/superpowers/specs/ Design notes
```

## How it works

### Image scanning (`util.js`)

`loadAndScan()` loads a PNG, reads pixel alpha per row, and returns left/right edge bounds. Rows map to a normalized parameter **u** (0 = bottom of content, 1 = top). Downstream modules scale edges to meters and build UV coordinates.

### Sail pipeline

1. **`sailImage.js`** — Scans the Severne catalog render. Derives luff/leech curves, clew height (boom position), and UV mapping. The PNG alpha provides the translucent window for free.
2. **`sail.js`** — Builds a `(u, v)` parametric surface: **u** along the luff (foot → head), **v** across the chord (luff → leech). Adds 3D shaping (belly, twist, cam pockets), batten rods, luff sleeve, and per-frame leech flutter.
3. **`hardware.js`** — Places mast stub, wishbone boom (traced from `boom.png`), head/tail blocks, outhaul, and mast foot.

### Board pipeline

1. **`boardImage.js`** — Scans top-down deck photo for width-at-station and deck UVs. Warps the bottom photo into the same frame for hull texture.
2. **`board.js`** — Lofts superellipse cross-sections along length with thickness and rocker curves. Deck and hull halves use separate materials.

### Scene assembly (`main.js`)

```
kit (floating group)
├── board (hull + fin)
└── rigPivot (rake + mast-track position)
    └── rig
        ├── sail (cloth + battens + sleeve)
        └── hardware (mast, boom, rigging)
```

Kit floats 0.5 m above a canvas-drawn radial shadow. Rig pivots at the mast track with ~19° aft rake.

## Coordinate systems

| Part | Axes |
|------|------|
| **Sail / rig** | Tack at origin. **y** = height (foot → head). **x** = chord (luff → leech). **z** = draft (belly/leeward). |
| **Board** | Bottom rocker at **y** = 0. Tail at **+x**, nose at **−x**. Mast track at **x** = 0. |

## Required assets

These PNG files must be present (user-supplied catalog photos):

| File | Purpose |
|------|---------|
| `026-Mach-9-render-final-lr-1.png` | Sail texture and silhouette |
| `src/board_map.png` | Deck outline and deck texture |
| `board_bottom.png` | Hull bottom texture |
| `boom.png` | Boom arms and texture |

Images should have clean alpha edges. The sail scan uses alpha threshold 20 so the translucent window panel still counts as inside the sail.

## Development notes

- **Dev geometry check** — In development mode, `main.js` traverses all meshes and throws if any vertex position is non-finite.
- **Materials** — Deck/sail photos have baked lighting; env-map intensity is kept low to avoid washing out detail.
- **Performance** — Pixel ratio capped at 2. Sail mesh is 260×36 segments to resolve pocket ridges.

## Possible extensions

Not implemented yet: size/configurator UI, spec hotspots, water scene, footstraps.

## License

Private project (`package.json`: `"private": true`).
