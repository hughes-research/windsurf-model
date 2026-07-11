# Architecture

System design for the Severne Mach 3D showcase: how the modules relate, how data flows from a PNG on disk to a lit triangle on screen, and how the scene graph is assembled. Read this before touching `main.js` or adding a new part.

## Design principle

**One pipeline, applied three times.** The sail, the board, and the boom are visually unrelated, but every one of them is built by the same four-stage process:

1. **Scan** a source photo's alpha channel to recover its silhouette as pixel data.
2. **Wrap** that pixel data in a small set of pure functions — a *shape descriptor* — that answer "how wide is this part at position X" and "what UV coordinate does this 3D point correspond to."
3. **Loft** a `THREE.BufferGeometry` by walking a parametric grid and calling the shape descriptor at each step.
4. **Texture** the resulting mesh with the same source photo (or a lightly processed derivative of it).

No part's geometry code knows anything about another part's geometry code. The only thing they share is `util.js`, which holds the two truly generic operations (`loadAndScan`, `taperedTube`) plus a spline helper and one shared curve fit (`smoothLuffX`) used by both the sail and the hardware.

## Module graph

```text
                          ┌─────────────┐
                          │   main.js   │   scene assembly, camera, lights, animation loop
                          └──────┬──────┘
              ┌──────────────────┼──────────────────┐
              │                  │                   │
      ┌───────▼──────┐   ┌───────▼───────┐   ┌───────▼───────┐
      │ sailImage.js │   │ boardImage.js │   │  boomImage.js │   scan photos → shape descriptors
      └───────┬──────┘   └───────┬───────┘   └───────┬───────┘
              │                  │                   │
      ┌───────▼──────┐   ┌───────▼───────┐           │
      │    sail.js   │   │   board.js    │           │
      └───────┬──────┘   └───────────────┘           │
              │                                       │
      ┌───────▼───────────────────────────────────────▼──────┐
      │                     hardware.js                       │   mast, boom, outhaul, foot
      └────────────────────────┬────────────────────────────┘
                                │
                          ┌─────▼─────┐
                          │  util.js  │   loadAndScan, taperedTube, interp1, smoothLuffX
                          └───────────┘
```

`hardware.js` depends on both `sailImage.js`'s shape descriptor (for the luff curve and clew height) and `boomImage.js`'s shape descriptor (for the arm geometry) — it's the one module that composes two photo-derived shapes into a single set of meshes.

## Data flow: PNG to mesh

Traced through the sail, the deepest pipeline:

1. `main.js` calls `loadSailShape()`.
2. `sailImage.js` calls `loadAndScan(sailUrl)` from `util.js`, which loads the image into an offscreen canvas, reads every row's alpha channel, and returns `edgeAt(u) → [leftPx, rightPx]` plus the pixel-space top/bottom content bounds.
3. `sailImage.js` wraps that in sail-specific semantics: converts pixel rows to a normalized height parameter `u` (0 = tack, 1 = head), fixes a real-world scale (`HEIGHT` meters ÷ content-height-in-pixels), and finds the clew by scanning for the silhouette's rightmost point. It returns a **shape descriptor**: `{ texture, height, clewU, luffX(u), leechX(u), uvFor(u, v) }`.
4. `main.js` passes that descriptor to `createSail(shape)` in `sail.js`, which walks a 260×36 `(u, v)` grid, calling `shape.luffX`/`leechX`/`uvFor` at every vertex, and layering on 3D shaping (draft, twist, camber, battens — see [`SAIL_RIGGING.md`](SAIL_RIGGING.md)) that has no dependency on the photo at all.
5. The resulting `THREE.BufferGeometry` is textured with `shape.texture` — the *original* image, untouched, decoded once as a WebGL texture. The mesh's UVs, not the texture, are what make the geometry line up with the print.

The board and boom pipelines follow the identical shape: scan → descriptor → loft → texture. The board is the one case where the *texture* isn't the raw source image — `boardImage.js` composites the deck and bottom photos into two derived canvases first (matte background, color correction, and a warped mirror for the bottom). See [`PHOTO_TO_GEOMETRY.md`](PHOTO_TO_GEOMETRY.md#textures-vs-outlines-they-can-diverge) for why.

## Scene graph

Assembled in `main.js`'s `init()`:

```text
scene
├── key (DirectionalLight, white, 1.5)
├── rim (DirectionalLight, blue-tinted, 0.6)
├── shadow (Mesh, radial-gradient canvas texture, no shadow maps)
└── kit (Group, floats 0.5 m above the shadow)
    ├── board (Group: hull Mesh with two material slots + fin Mesh)
    └── rigPivot (Group: rotated RIG_RAKE rad, positioned at mast-track x/y)
        └── rig (Group: offset up ~1.5 cm off the deck)
            ├── sail.mesh (Group: cloth Mesh + 7 batten-rod Meshes + 4 mini-batten Meshes + sleeve Mesh)
            └── hardware (Group: mast stub, boom arm × 2, head/tail blocks, outhaul × 2, mast-foot collar + joint)
```

Three nested transforms carry the rig from its own local space out to world space:

- **`rig.position.y`** — the tack-to-deck air gap (currently 1.5 cm), applied *before* rake, so the gap is measured perpendicular to the deck, not to gravity.
- **`rigPivot.rotation.z`** — `RIG_RAKE`, the whole rig raked aft around the mast-foot pivot point.
- **`rigPivot.position`** — places that pivot point at the board's mast track (`DECK_AT_TRACK`, exported by `board.js`, plus a small fore/aft offset).

This ordering matters: rotating a `Group` rotates everything parented under it around its own origin, so the rake rotation has to happen on the *outer* group (`rigPivot`, positioned at the physical pivot point) while the tack-gap offset happens on the *inner* group (`rig`, in the rig's own unrotated frame) — otherwise raking the rig would also swing the tack sideways instead of just tipping the mast back.

## Rendering pipeline

- **Tone mapping**: `THREE.ACESFilmicToneMapping`, exposure 1.1 — standard filmic response so the sail's saturated red doesn't clip.
- **Image-based lighting**: `RoomEnvironment` generated once through a `PMREMGenerator` at load, assigned to `scene.environment`. This is what gives the carbon hardware and the sail's clearcoat their reflections without a full HDRI.
- **Direct lighting**: one white key light, one cool-tinted rim light, both plain `DirectionalLight`s — no shadow-casting lights are configured.
- **Contact shadow**: a hand-drawn radial gradient baked into a `CanvasTexture` on a single ground plane, alpha-blended, `depthWrite: false`. This avoids the cost and self-shadowing artifacts of real shadow maps for a floating product shot where only a soft "contact" hint is needed.
- **Camera auto-fit**: `frameKit()` computes a camera distance from the vertical and horizontal FOV so the whole kit fits the viewport, re-run on every resize. It does not track the model's actual bounding box — the `5.2`/`5.4` meter constants are tuned to the specific kit dimensions, so a significantly larger or smaller kit would need those adjusted too.
- **First-frame paint**: `renderer.render()` is called once synchronously right after scene assembly, *before* `setAnimationLoop` starts. See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md#blank-canvas-with-zero-console-errors) for why.

## Performance profile

| Concern | Detail |
|---|---|
| Vertex count | Sail cloth: ~9,500 (260×36). Board hull: ~2,000 (60×32). Batten/boom/outhaul tubes: a few hundred each. |
| Per-frame work | Only the sail's `update(t)` does per-frame CPU work: rewrites the Z component of every cloth vertex and calls `computeVertexNormals()`. Everything else is static after load. |
| Texture memory | Four source PNGs (largest is the 800×1478 sail render) plus two canvas-composited derivatives at board-photo resolution (~217×786). No mipmapped texture exceeds ~1 MB raw. |
| Draw calls | ~25 meshes, no instancing — appropriate at this part count; would need batching if the scene grew to a full fleet of boards. |
| Pixel ratio | Capped at `min(devicePixelRatio, 2)` to bound fragment cost on high-DPI screens. |

## Extending the architecture

Adding a new photo-mapped part (a harness line, a footstrap, a second sail size) means adding one `<part>Image.js` scanning module and one `<part>.js` geometry module, following the existing pairs. See [`DEVELOPMENT.md`](DEVELOPMENT.md#adding-a-new-photo-mapped-part) for the step-by-step recipe, and [`PHOTO_TO_GEOMETRY.md`](PHOTO_TO_GEOMETRY.md) for which scanning pattern (`loadAndScan`'s single-span silhouette vs. `boomImage.js`'s multi-span row scan) fits which kind of photo.
