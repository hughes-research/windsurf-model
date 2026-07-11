# Photo to Geometry: The Core Technique

This is the reusable method behind every mesh in this project: turning a plain product photo — no depth data, no photogrammetry rig, no reference mesh — into 3D geometry whose outline and texture are *provably* correct, because they're read directly from the photo's own pixels rather than approximated by hand. This document is written to be useful outside this specific project; the recipe generalizes to any flat-ish product shot with a clean alpha channel.

## When this technique applies

It works well when:

- The subject is photographed **flat-on or top-down**, with a **transparent background** (a clean alpha channel, not a white background you'd have to key out).
- The subject's silhouette *is* most of its shape information — a sail, a board deck, a wishbone boom, a fin, a label, a flag. Anything closer to a plan-view or elevation than a 3D scan.
- You want the *print* on the object (a logo, a batten stripe, a deck pad) to line up exactly with the *geometry*, which is the thing hand-modeling is worst at.

It does not replace photogrammetry or 3D scanning when the subject's volume can't be inferred from a silhouette — a helmet, a hull's midship cross-section, anything genuinely bulbous in a direction the photo doesn't show. In this project, the board's *thickness and rocker* (its side-profile curve) are hand-tuned splines, not scanned, precisely because the top-down photo used for the outline says nothing about the side profile. Know which axis your photo actually informs.

## The four-stage pipeline

### 1. Scan the alpha silhouette

The foundational primitive, `loadAndScan()` in `src/util.js`:

```js
export async function loadAndScan(url, alphaEdge = 20) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(`${url} failed to load`));
    img.src = url;
  });
  const W = img.width, H = img.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;
  const alphaAt = (x, y) => data[(y * W + x) * 4 + 3];

  const edges = new Array(H).fill(null);
  for (let y = 0; y < H; y++) {
    let l = -1;
    for (let x = 0; x < W; x++) if (alphaAt(x, y) > alphaEdge) { l = x; break; }
    if (l < 0) continue;
    for (let x = W - 1; x >= l; x--) if (alphaAt(x, y) > alphaEdge) { edges[y] = [l, x]; break; }
  }
  const top = edges.findIndex(Boolean);
  let bottom = H - 1;
  while (!edges[bottom]) bottom--;

  const rowAt = (u) => bottom - u * (bottom - top);
  const edgeAt = (u) => edges[Math.round(rowAt(u))] ?? [0, 0];
  return { img, W, H, top, bottom, rowAt, edgeAt };
}
```

The algorithm: draw the image into an offscreen `<canvas>`, read the full pixel buffer once with `getImageData`, then for every row find the leftmost and rightmost pixel whose alpha exceeds a threshold. That's the row's silhouette span. Do this for every row and you have the object's outline as a lookup table, indexed by row.

**This assumes one contiguous span per row** — true for a sail (single blob) or a board (single blob), false for a wishbone boom (two arms with a gap between them, at least in the middle of its length). For multi-span subjects, scan *all* opaque runs per row instead of just the outermost left/right edge — see [Multi-span scanning](#multi-span-scanning-two-part-shapes) below.

**Alpha threshold, chosen deliberately.** `alphaEdge = 20` isn't arbitrary — it's set so that the sail's translucent viewing window (whose fill alpha is around 27) still counts as "inside the sail," while true background transparency (alpha 0) doesn't. If your source has a semi-transparent design element you want geometry to include, sample its actual alpha value and set the threshold just below it. If you want translucent elements *excluded* from the silhouette (they'll still render as translucent via the texture's own alpha, just won't extend the mesh), raise the threshold above them.

**Normalize to a parameter, not raw pixels.** The scan returns `rowAt(u)` and `edgeAt(u)` where `u ∈ [0, 1]`, `u = 0` at the bottom of the content and `u = 1` at the top — never raw pixel coordinates. Every downstream consumer (geometry, hardware placement, texture UV) works in this normalized space, so the geometry code has zero dependency on the source image's resolution. Swap in a higher-resolution photo of the same subject and nothing downstream needs to change.

### 2. Wrap the scan in a shape descriptor

Don't hand the raw scan result to your geometry builder. Wrap it in a small object of pure functions with domain-specific names and real-world units — a *shape descriptor*. From `sailImage.js`:

```js
export async function loadSailShape() {
  const { img, W, H, top, bottom, rowAt, edgeAt } = await loadAndScan(sailUrl);
  const scale = HEIGHT / (bottom - top);       // pixels → meters, once
  const x0 = edgeAt(0)[0];                     // tack = x origin

  // ... derive clewU by scanning for the silhouette's rightmost point ...

  return {
    texture,
    height: HEIGHT,
    clewU,
    luffX: (u) => (edgeAt(u)[0] - x0) * scale,
    leechX: (u) => (edgeAt(u)[1] - x0) * scale,
    uvFor(u, v) {
      const [l, r] = edgeAt(u);
      return [(l + v * (r - l)) / W, 1 - rowAt(u) / H];
    },
  };
}
```

Three things happen here that are worth doing every time:

- **Real-world scale is fixed once, at load, from a single known dimension.** The sail's rigged luff length (`HEIGHT = 4.25` m) is the one number that isn't derived from the photo — it comes from the product spec sheet. Everything else (chord width, clew height, batten spacing) falls out of the photo's *proportions* once that one anchor is set. This is the general pattern: one real-world measurement in, arbitrary photo resolution handled automatically.
- **Origin is picked meaningfully, not at (0,0).** `x0` is the tack's x-position in pixels, so `luffX(0)` comes out to exactly `0` — every downstream consumer gets a coordinate system whose origin is a physically meaningful point (the tack), not the top-left of the source image.
- **`uvFor(u, v)` closes over the same `edgeAt`/`rowAt` used for geometry.** This is the load-bearing detail: because the UV function and the geometry function derive from the *same* scan, a vertex placed at `(u, v)` and a UV coordinate computed for `(u, v)` are guaranteed consistent — the print lines up with the mesh by construction, not by manual alignment.

### 3. Loft geometry by walking the descriptor

Build a `THREE.BufferGeometry` by hand: allocate flat `Float32Array`s for position/UV, walk a `(u, v)` (or `(t, s)`, or arc-length) grid, call the shape descriptor at every step, and triangulate the grid with a fixed index pattern. From `sail.js` (simplified):

```js
for (let i = 0; i <= NU; i++) {
  const u = i / NU;
  for (let j = 0; j <= NV; j++) {
    const v = j / NV;
    const p = surfacePos(shape, u, v);          // 3D shaping on top of the 2D scan
    pos.set([p.x, p.y, p.z], k * 3);
    uv.set(shape.uvFor(u, v), k * 2);
    k++;
  }
}
// ring = NV + 1; two triangles per grid cell, standard winding
```

This is the point where photo-derived data (the 2D outline) and hand-authored data (3D shaping — draft, rocker, taper) combine: `surfacePos()` calls `shape.luffX`/`leechX` for the *planform*, then layers belly, twist, and camber on top in the z-axis, entirely independent of the photo. The photo governs where the mesh's edges are; the math governs how it bulges between them.

**Grid resolution should match the finest detail you need to resolve**, not be uniform for its own sake. The sail mesh is 260×36 — coarse across the chord (36; the surface barely varies there beyond a smooth camber curve) but very fine along the luff (260; enough to resolve the batten pocket ridges and the sharp flat→cammed profile transition without visible faceting). Pick resolution per-axis based on what varies fastest along it.

### 4. Texture with the source photo — or a processed derivative

The simplest case: pass the *raw* photo straight to `material.map`, unmodified, because the UVs already line it up correctly (the sail does this). But two situations call for compositing a new canvas texture first, rather than using the source image directly:

- **Two-sided or multi-surface textures from one photo.** If a photo's silhouette needs to texture a surface from more than one direction (see [Textures vs. outlines](#textures-vs-outlines-they-can-diverge) below), you may need to warp or duplicate it into a new canvas.
- **The source photo needs correction.** Product photography sometimes runs lighter or more saturated than the true product color (true of `board_map.png` in this project — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md#texture-looks-washed-out-or-wrong-colored)). Bake the correction into a canvas *once at load* via `ctx.filter`, never per-frame.

Either way, **give transparent-background PNGs an opaque matte behind them before using them as a `map`**, even when the mesh's alpha channel isn't used for transparency:

```js
ctx.fillStyle = '#6f0d12'; // a color close to the subject's own base color
ctx.fillRect(0, 0, W, H);
ctx.drawImage(img, 0, 0);   // draw the photo on top of the matte
```

Without this, GPU mipmap generation blends transparent-background pixels (which are `rgba(0,0,0,0)` — black, not "nothing") into the edge texels at a distance, and objects viewed at a grazing angle or from far away pick up a dark or white fringe along every silhouette edge. Picking a matte color close to the subject's dominant hue makes any residual bleed invisible instead of a visible seam.

## Multi-span scanning: two-part shapes

`loadAndScan()` assumes one contiguous opaque run per row. A wishbone boom photographed top-down violates that for most of its length — two arms with visible daylight between them. `boomImage.js` scans differently: instead of leftmost/rightmost edge, it records *every* opaque run per row:

```js
const spans = [];
for (let y = 0; y < H; y++) {
  const row = [];
  let start = -1;
  for (let x = 0; x < W; x++) {
    const on = data[(y * W + x) * 4 + 3] > 20;
    if (on && start < 0) start = x;
    else if (!on && start >= 0) { row.push([start, x - 1]); start = -1; }
  }
  if (start >= 0) row.push([start, W - 1]);
  spans.push(row);
}
```

From there, a second pass classifies rows: a row belongs to the "two separate arms" zone only if it has at least two runs *and* the gap between the outermost edges exceeds some fraction of the image width — a heuristic that excludes the mast clamp (where the arms haven't yet separated) and the tail block (where they converge again) from the "trace two independent curves" logic. Each arm's centerline and thickness are then just the run's midpoint and half-width.

**The general lesson**: before reaching for `loadAndScan`'s single-span model, ask whether every row of your subject really has one contiguous run. If not, scan all runs per row and add a classifier for which rows are in which regime — don't try to force a two-part shape through a one-part scanner with a wider alpha threshold or blur, which just produces a worse single span instead of two correct ones.

## UV projection strategies

Three different ways this project maps a scan onto 3D geometry, and when to use each:

| Strategy | Used by | When to use it |
|---|---|---|
| **Direct row/column lookup** — UV comes straight from `edgeAt(u)` and `rowAt(u)`, same as the geometry | Sail cloth | The mesh *is* the photographed plane, just displaced in one axis (draft). Simplest and most accurate — no projection math, no seams. |
| **Planar top projection** — a 3D point's UV is derived by projecting it straight down (or along whatever axis the photo was shot from) back onto the 2D scan | Board deck/hull, sleeve wrap band | The mesh has real volume (a lofted hull, a tube), but the source photo was shot from one direction. You accept that steep side walls get UV-stretched, in exchange for one clean, seamless UV set shared by every face. |
| **Per-vertex ray projection through a scale factor** — convert a 3D point back to photo pixel space via a fixed meters-per-pixel ratio, independent of the geometry's own parameterization | Boom arms | The tube's own path parameter (`t` = distance along the arm) doesn't correspond 1:1 to the photo's pixel rows once the tube bends in 3D — so UVs are computed by re-projecting the *world-space* vertex position back into photo space, not by carrying the original scan parameter through. |

**Shared UV sets are worth engineering for.** The board's deck and hull use *one* UV set (`shape.uvFor(t, s)`, a planar top projection) even though they're textured with two different photos. This works because both photos were warped into the same coordinate frame at load time (see next section) — meaning the mesh doesn't need two UV channels or a seam at the rail where deck meets hull; both texture lookups just use different `map`s on the same underlying UV coordinate, assigned to different triangle groups via `geometry.addGroup()`.

## Textures vs. outlines: they can diverge

The most subtle trick in this project: **the mesh you loft doesn't have to be textured by the same photo you scanned for its outline.**

`board.js`'s outline comes entirely from `board_map.png` (the deck photo) — width-at-station, rocker pivot placement, everything. But the *hull* half of that same mesh is textured with `board_bottom.png`, a completely different photograph, shot from the opposite side. To make this work, `boardImage.js` doesn't just load the bottom photo — it **warps it into the deck photo's coordinate frame** before use:

```js
const db = bbox(deck), bb = bbox(bottom);
xb.translate(db.l + (db.r - db.l) / 2, deck.top);
xb.scale(-(db.r - db.l) / (bb.r - bb.l), (deck.bottom - deck.top) / (bottom.bottom - bottom.top));
xb.translate(-(bb.l + (bb.r - bb.l) / 2), -bottom.top);
xb.drawImage(bottom.img, 0, 0);
```

Three canvas transform operations, applied in this order — translate to the deck photo's center, scale (with a *negative* x factor) to match the deck photo's bounding box, translate back by the bottom photo's own center — compose into: draw the bottom photo so its content box lines up exactly with the deck photo's content box, mirrored left-right.

The mirror isn't a bug workaround — it's physically necessary. A "bottom of the board" photo is shot looking *up* at the hull from below. The mesh's UV projection, being a top-down planar projection, looks *down* at the hull. Viewed through that shared top-down UV set, an un-mirrored bottom photo would read backwards (text reversed, the fin on the wrong side). Mirroring the source once, at load, in the warp step, fixes it permanently — instead of trying to compensate with a flipped UV coordinate at every vertex, which would be easy to get subtly wrong in exactly one axis and hard to debug.

**The general pattern**: when two photos need to share one UV space, don't try to make the geometry's UV function branch between two different projections. Warp one photo into the other's frame once, at load, and let both textures live in the same coordinate system afterward.

## Preparing a source photo

Checklist before scanning a new photo for this pipeline:

- **Transparent background**, not white. A white background will be read as opaque content by the alpha scanner and become part of the silhouette.
- **No baked drop shadow** in the alpha channel — a soft shadow's semi-transparent pixels will extend the scanned silhouette past the real object edge. If the source has one, either re-export without it or raise `alphaEdge` above the shadow's peak alpha (check the shadow doesn't exceed your translucent-detail threshold, if you have one).
- **Shot flat-on or top-down**, not at a perspective angle — the scan assumes the photographed plane maps directly onto a parametric axis (height, length) with no foreshortening to correct for.
- **Know which real-world dimension anchors the scale.** Every shape descriptor in this project fixes scale from exactly one known measurement (sail luff length, board length, boom length inferred from clew position) — decide that anchor before writing the loader.
- **Sample a few pixels before trusting the alpha threshold.** Use a throwaway console script to sample alpha at a spot you know should read as "inside" and a spot that should read as "background," and set `alphaEdge` between them — don't assume the default of 20 is right for a new source.

## Worked example: adding a new part

To texture-map a new flat part (say, a fin, following up on the one gap in this project — see [`README.md`](../README.md#known-limitations)):

1. Get a top-down or flat-on photo with transparent background, e.g. `fin.png`.
2. Write `finImage.js`: call `loadAndScan(finUrl)`, fix scale from the fin's known depth or span, return a descriptor with `widthAt(t)` (or whatever parameterization fits a fin's shape) and `uvFor(t, s)`.
3. Write `fin.js`: replace the hand-drawn `THREE.Shape` extrusion currently in `board.js` with a loft that calls the new descriptor at each station, the same way `board.js` calls `boardImage.js`'s `widthAt`.
4. Wire it into `main.js`: add `loadFinShape()` to the `Promise.all` at the top of `init()`, pass the result into the fin-building call.

That's the entire recipe — no part of the existing sail, board, or boom pipeline needs to change, because each part's scanning and geometry modules are fully independent, sharing only `util.js`.
