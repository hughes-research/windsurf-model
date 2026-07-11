# The Parametric Sail Model

The sail is the most elaborate part of this project: a scanned 2D planform (see [`PHOTO_TO_GEOMETRY.md`](PHOTO_TO_GEOMETRY.md)) with a full 3D camber model layered on top in `src/sail.js`. This document explains every constant in that file — what it controls, what unit it's in, and how its value was actually determined — plus the general methodology for measuring rigging features from a photo, which is the part of this project hardest to get right by guessing.

If you only remember one thing from this document: **every "shape" number here either came from scanning a pixel, or from a windsurfer describing a real-world rigging measurement in centimeters — never from eyeballing a screenshot.** The one time that rule was broken (early batten placement, before the tensioner-paddle scanning technique existed), it took four rounds of correction to fix. See [Measuring features from a photo](#measuring-features-from-a-photo).

## Coordinate system recap

- `u ∈ [0, 1]`: position along the luff. `u = 0` is the tack (foot), `u = 1` is the head.
- `v ∈ [0, 1]`: position across the chord. `v = 0` is the luff, `v = 1` is the leech.
- World axes: **y** = `u × shape.height` (physical height off the deck). **x** = chord position (`luffX(u) + v × chord`). **z** = draft — positive z is the belly/leeward bulge.

Every constant below is expressed in this space unless noted otherwise.

## The shaping stack

A single function, `surfacePos(shape, u, v)`, computes the final 3D position of every point on the cloth. It layers four independent effects, in this order:

```text
scanned 2D planform (luffX, leechX from the photo)
   + chordwise camber profile × draft depth   →  "belly"
   + leech twist
   + batten/mini-batten pocket bulge
   = final surface point
```

### 1. Draft depth by height — `DRAFT_PTS`

```js
const DRAFT_PTS = [[0, 0.06], [0.235, 0.095], [0.5, 0.075], [0.8, 0.038], [1, 0.008]];
```

A spline (via `interp1`, Catmull-Rom through these control points) giving **maximum draft depth as a fraction of local chord**, indexed by height `u`. Peaks at 9.5% of chord around `u = 0.235` (boom height) and eases toward nearly flat at the head — a race sail carries most of its power low, near the boom, and goes progressively flatter toward the tip where twist takes over instead.

### 2. Chordwise camber profile — `PROFILE_PTS` and `CAM_PROFILE_PTS`

Two profile curves, each mapping `v` (0 = luff, 1 = leech) to a normalized depth multiplier (0 to 1, peak at 1):

```js
// Flat entry — used where no camber inducer is present
const PROFILE_PTS = [
  [0, 0], [0.05, 0.012], [0.12, 0.05], [0.26, 0.45], [0.42, 1],
  [0.68, 0.62], [0.88, 0.22], [1, 0],
];

// Cammed entry — used at camber-inducer stations
const CAM_PROFILE_PTS = [
  [0, 0.3], [0.05, 0.42], [0.12, 0.55], [0.26, 0.75], [0.42, 1],
  [0.68, 0.62], [0.88, 0.22], [1, 0],
];
```

Both peak at `v = 0.42` (maximum draft ~42% back from the luff) and share the same tail shape into the leech. They differ entirely in the **entry** — the first ~25% of chord, right behind the luff sleeve:

- `PROFILE_PTS` starts at exactly `0` and stays low through `v = 0.12` — a flat, wing-underside entry. This is the correct shape for any part of the sail *without* a camber inducer holding the mast, where the cloth is free to run flat off the sleeve.
- `CAM_PROFILE_PTS` starts at `0.3`, not `0` — proud, not flush with the luff line. This is deliberate: a camber inducer physically forces the cloth to already be bulging *at* the sleeve, not just building draft further back. Starting the cammed profile at 0 (like the flat one) and only diverging later would have produced a hollow between the sleeve and the draft buildup — wrong. Starting proud makes the cloth emerge from the sleeve already full, fairing continuously into the sleeve's own rounded nose.

### 3. Camber inducer blending — `camWeight(u)`

```js
const CAMS = BATTENS.slice(0, 5).map((b) => b.u);
const SOFT_CAM = { u: BATTENS[5].u, w: 0.45 };
function camWeight(u) {
  let s = 0;
  for (const uc of CAMS) s += Math.exp(-(((u - uc) / 0.06) ** 2));
  s += SOFT_CAM.w * Math.exp(-(((u - SOFT_CAM.u) / 0.06) ** 2));
  return Math.min(1, s);
}
```

This Mach 6.5 carries **five hard camber inducers**, on battens 1 through 5, plus a **soft cam** on batten 6 that pushes at roughly half strength — battens above that are cam-free, twist-only. `camWeight(u)` is a sum of Gaussian bumps centered at each cam station (σ = 0.06 in `u`-units, roughly a 26 cm falloff at this sail's scale), clamped to a max of 1. It answers "how much cam influence exists at this height," blending smoothly between neighboring cam stations rather than switching abruptly panel-to-panel — which is physically right, since the cloth between two cammed battens is still held somewhat full by both neighbors, not free to go flat.

`surfacePos()` uses this weight to blend the two profile curves:

```js
const flat = interp1(PROFILE_PTS, v);
const prof = flat + camWeight(u) * (interp1(CAM_PROFILE_PTS, v) - flat);
const belly = interp1(DRAFT_PTS, u) * chord * prof;
```

At `camWeight = 0` (above the cams, or between cam-free battens) this reduces to the flat profile. At `camWeight = 1` (dead center on a hard cam) it's fully the cammed profile. In between, a linear blend.

### 4. Leech twist

```js
const twist = 0.55 * u * u * v * chord;
```

A deliberately parabolic term in `u` (not linear) — twist barely exists near the boom and grows sharply toward the head, matching how the top few panels of a race sail visibly fall open to leeward while the powered lower sail stays locked by the cams. Scales with both `v` (twist only displaces the leech side, not the luff, since it's a rotation about the luff) and local `chord` (a wider panel twists a greater absolute distance for the same angular twist).

### 5. Batten and mini-batten pockets — `pocketBulge(u, v)`

A residual cloth-tension bulge riding *on top of* the round batten rod geometry (see [Battens are physical rods, not decals](#battens-are-physical-rods-not-decals) below) — the cloth pulls slightly proud over a taut batten even though the rod itself provides most of the visible roundness.

```js
const POCKET_SIGMA = 0.009, POCKET_HEIGHT = 0.006;
function pocketBulge(u, v) {
  let b = 0;
  for (const bt of BATTENS) {
    const x = (u - (bt.u - bt.du * v)) / POCKET_SIGMA;
    b += Math.exp(-x * x);
  }
  for (const um of MINIS) {
    const x = (u - um) / POCKET_SIGMA;
    b += 0.6 * miniGate(v) * Math.exp(-x * x);
  }
  const fade = Math.max(0, Math.min(1, (v - 0.1) * 10, (0.98 - v) * 15));
  return POCKET_HEIGHT * b * fade;
}
```

Note `bt.u - bt.du * v` — the batten's u-position *at this specific v* (see [Battens are sloped lines](#battens-are-sloped-lines-not-level-rows), below), so the pocket ridge tracks the batten's actual diagonal line across the sail, not a level row. `fade` kills the bulge near the mast sleeve (`v < 0.1`) and right at the leech edge (`v > 0.98`) — battens don't visibly bulge the cloth at their very tips.

## Battens are sloped lines, not level rows

```js
const BATTENS = [
  { u: 0.153, du: 0.0235 },  // batten 1: rear drops 10 cm
  { u: 0.301, du: 0.0165 },  // batten 2: rear drops 7 cm
  { u: 0.435, du: 0 },       // batten 3: flat
  { u: 0.58, du: 0 },        // batten 4: flat
  { u: 0.722, du: 0 },       // batten 5: flat
  { u: 0.85, du: -0.014 },   // batten 6: rear rises
  { u: 0.9365, du: -0.047 }, // batten 7: rear rises further
];
```

Each entry is `{ u, du }`: **`u`** is the batten's position at the *luff* end, in the same height-parameter space as everything else. **`du`** is how much the batten's position shifts by the time it reaches the *leech* — positive `du` means the rear end sits *lower* (closer to the tack) than the front end; negative means it sits *higher*. A batten's actual u-position at any chord fraction `v` is `u - du * v`.

This isn't a stylistic choice — it's what the catalog photo actually shows. The lower two battens visibly slope downward toward the clew (10 cm and 7 cm respectively, at full scale, as specified directly from a windsurfer's read of the reference photos), the middle three run dead level, and the upper two *fan upward* toward the leech — which reads correctly once you know upper battens on a twisted-off head open the leech, and their outer ends sit higher relative to their luff attachment as a geometric consequence of that twist. Every batten's `du` here was measured or specified individually; there is no formula that derives one from another.

## Battens are physical rods, not decals

Early iterations painted batten pockets as flat cloth bulges — visually plausible from a distance, wrong up close, because real battens are **round carbon rods** visible as distinct 3D forms, not just print. `createSail()` adds a translucent tube mesh per batten, following the exact same sloped line as the pocket bulge above:

```js
const rodMat = new THREE.MeshPhysicalMaterial({
  color: 0xf2f2f2, transparent: true, opacity: 0.25, roughness: 0.2,
  clearcoat: 0.5, depthWrite: false,
});
for (const bt of BATTENS) {
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const v = 0.12 + (i / 20) * (0.985 - 0.12);
    const p = surfacePos(shape, bt.u - bt.du * v, v);
    p.z += 0.004;                          // ride slightly above the cloth surface
    pts.push(p);
  }
  group.add(new THREE.Mesh(taperedTube(pts, (t) => 0.0045 + 0.0035 * t, 8, 40), rodMat));
}
```

Two details worth noting: the rod material is **translucent** (25% opacity), not solid black — a solid rod reads as a hard black stick sitting on top of the sail; a translucent one reads as a rod *inside* a pocket, letting the print show through, which is what the real thing looks like. And each rod is built by walking `surfacePos()` — the same 3D-shaping function the cloth itself uses — so the rod automatically follows the sail's belly and twist rather than needing its own separate curve math.

**Battens stiffen the cloth**, so the flutter animation (below) is damped to zero exactly along each rod:

```js
function battenDamp(u, v) {
  let s = 0;
  for (const bt of BATTENS) s += Math.exp(-(((u - (bt.u - bt.du * v)) / 0.012) ** 2));
  for (const um of MINIS) s += miniGate(v) * Math.exp(-(((u - um) / 0.012) ** 2));
  return Math.max(0, 1 - s);
}
```

A slightly wider Gaussian (σ = 0.012 vs. the pocket bulge's 0.009) — the flutter-killing effect of a rod extends a bit further along the luff than the visible cloth bulge does, which reads correctly: cloth stops moving before the tension ridge itself fully fades out.

## Leech mini-battens

```js
const MINIS = [0.375, 0.5075, 0.651, 0.786];
const miniGate = (v) => Math.max(0, Math.min(1, (v - 0.78) * 8));
```

Four short stabilizer battens sit midway between the main battens, but **only near the leech** — they don't run the full chord. `miniGate(v)` ramps their influence (both the pocket bulge and the flutter damping) from 0 to 1 over `v = 0.78` to `0.905`, so above that threshold they behave exactly like a main batten locally, and below it they don't exist at all. Their rod geometry is correspondingly short — built only over `v ∈ [v0, 0.985]` where `v0` is computed from the local chord so each mini-batten is a fixed physical length regardless of how wide the sail is at that height:

```js
const v0 = Math.max(0.6, 1 - 0.28 / chord);
```

The first mini-batten's position (`0.375`) came from a direct pixel measurement on the catalog render; the remaining three follow the even-spacing pattern visible between the main battens at that part of the sail.

## The luff sleeve

The sail's leading edge isn't the bare scanned luff line — it's a separate lofted tube, `sleeve`, that visually swallows the mast:

```js
const SLEEVE_PTS = [[0, 0.06], [0.25, 0.075], [0.6, 0.055], [0.85, 0.032], [1, 0.014]];
```

Half-width by height, in meters — fattest (7.5 cm half-width, 15 cm across) around `u = 0.25` where the camber inducers live, tapering to 1.4 cm half-width at the head. Three shaping details make this read as a real race-sail sleeve rather than a simple tube:

- **Asymmetric offset.** The sleeve's centerline path is pushed toward the belly (+z) by half its own local half-width: `luff(u) + 0.015` in x, `0.5 * interp1(SLEEVE_PTS, u)` in z. This means the leeward face fairs almost flush into the sail's own draft curve, while the windward face bulges out below the membrane as a full round volume — matching how a deep race sleeve reads from the concave (inner) side as the rounded underside of a wing, not a symmetric pole.
- **Camber bumps.** `camBump(t)` adds an extra 0.008 m (half that at the soft cam) to the sleeve radius exactly at each cam station — the physical lump of the inducer fitting pressing against the mast from inside the sleeve cloth.
- **Squash into a teardrop.** `sleeve.scale.z = 0.68` — the tube's circular cross-section is compressed in the z-axis after being built, turning a round tube into an elongated, more aerodynamic-looking fairing.

The sleeve's texture is a **wrap projection**, not the direct row/column lookup the cloth uses — see [`PHOTO_TO_GEOMETRY.md`](PHOTO_TO_GEOMETRY.md#uv-projection-strategies) for why a curved tube needs a different UV strategy than a flat-ish surface. It samples a narrow band near the luff edge of the sail photo (`v` between roughly 0.02 and 0.12) and wraps it around the tube's circumference, so the gray X-ply crosshatch print follows the tube's curvature correctly instead of stretching.

The mast itself is nearly invisible: `hardware.js` only builds a short stub from just below the tack up to `u ≈ 0.03` — everything above that is implied by the sleeve. This matches reality; on a rigged race sail with a deep sleeve, you cannot see the mast at all except right at the base, below the tack, where the extension protrudes.

## Wind simulation

The sail's per-frame motion is driven by a wind model, not a fixed animation. The wind itself is a smooth pseudo-random gust signal — a sum of incommensurate sines, so it never visibly repeats and needs no random number generator:

```js
function gustAt(t) {
  const g = 0.5 + 0.35 * Math.sin(0.45 * t) + 0.25 * Math.sin(0.97 * t + 2.1)
    + 0.15 * Math.sin(1.73 * t + 4.0);
  return Math.max(0, Math.min(1, g));
}
```

Each frame, the gust value drives three effects, each grounded in how real sail materials respond:

- **The leech opens and closes.** The twist term (stored per-vertex at build time, separately from the static shape) is scaled by `1 + 0.3·dev + 0.14·sin(1.5t − 2.4u)·(0.3 + 0.7g)` — a slow gust response plus a sine wave that *travels up the sail*, the visible ripple of a gust sweeping across. Because the twist term already scales with `u²·v`, the response concentrates at the upper leech: measured across a gust cycle, the top of the leech swings ~13 cm while the cam-locked lower leech moves ~3 cm. The leech does most of the flexing; the cammed body barely moves.
- **Panels breathe between battens.** The belly term is scaled by `1 + 0.05·dev·(0.25 + 0.75·damp)` — a small effect, deliberately: monofilm and X-ply resist stretching, and the `damp` field pins the modulation to near zero along every batten rod, so the breathing lives in the panel centers.
- **Leech flutter scales with wind.** The high-frequency shiver (`amp·damp·v²·(0.25 + 0.75u)·sin(4.5t + 9v + 6u)`) keeps its spatial shaping — strongest at the upper leech, zero at battens — but its amplitude is now `0.005 + 0.013·g`: near-still in a lull, lively in a gust.

**The batten rods ride the moving cloth.** Every rod tube records its per-ring `(u, v, belly, twist, damp)` at build time; each frame the same deformation formula is evaluated at each ring's station and applied as a rigid z-shift to that ring. Without this, a 13 cm leech swing would visibly pull the cloth away from static rods. The cloth's `computeVertexNormals()` runs every frame to keep lighting correct as the surface deforms — the dominant per-frame CPU cost in the scene (see [`ARCHITECTURE.md`](ARCHITECTURE.md#performance-profile)); the rods skip normal recomputation since a per-ring z-shift barely changes theirs.

## Rig-level trim (in `main.js` and `hardware.js`)

A few numbers that shape how the *whole rig* sits, not the sail's own geometry — these came directly from a windsurfer's real-world measurements, not from photo scanning, and are collected here since they're frequently retuned together:

| Constant | File | Value | Physical meaning |
|---|---|---|---|
| `RIG_RAKE` | `main.js` | `-0.34` rad (≈ −19.5°) | Mast rake aft from vertical — how far back the whole rig leans, characteristic of powered-up planing trim |
| `rig.position.y` | `main.js` | `0.015` m | Tack-to-deck air gap — how high the tack sits above the mast track |
| `rigPivot.position.x` | `main.js` | `0.02` m | Mast track fore/aft offset from board center |
| boom `yAt(d)` | `hardware.js` | `by + 0.36 − 0.47·(d/L)^1.1` | Boom height profile: 36 cm above clew height at the front, sloping down to 11 cm below clew height at the tail |
| boom length | `hardware.js` | `ch + 0.01` (≈ clew chord + 1 cm) | How far the boom extends past the mast; the tail block itself sits ~1 cm short of the scanned clew edge, tuned to look outhauled snug rather than overhung |
| mast-foot gap | `hardware.js` | matches `rig.position.y` | Collar + universal-joint stack height, sized to exactly fill the tack-to-deck gap with no visible overlap or float |

These were reached through roughly thirty rounds of "move X by N centimeters, check from this angle, adjust" — see [Iterative trim as a workflow](#iterative-trim-as-a-workflow) below for the general process that produced them.

## Measuring features from a photo

When a rigging feature's position needs to come from the photo (not from a windsurfer's stated measurement), don't eyeball pixel coordinates from a screenshot — **write a small script that scans the actual source PNG's pixel data** and run it. Two concrete techniques were used in this project, and the second replaced the first once its limitation became clear.

### Technique 1: dark-row scanning

The first approach for finding batten stripe positions: for a set of chord fractions (e.g. `v = 0.15, 0.25, 0.35, ...`), scan down the luff and flag any row where the pixel at that chord fraction is both opaque and dark (low luminance):

```js
const dark = [0.3, 0.5, 0.65].every((f) => {
  const px = Math.round(l + f * w);
  return alpha(px, y) > 100 && luminance(px, y) < 60;
});
```

This works, but it's ambiguous exactly where you need precision most: a black batten stripe printed over a black background logo (or over boom hardware in the photo) produces false positives and false negatives right at the moments that matter.

### Technique 2: high-contrast proxy signal

The fix wasn't a better threshold — it was finding a **different, higher-contrast feature that's mechanically tied to the thing you actually want to measure.** Each batten on this sail has a bright red tensioner paddle at its luff end, sitting on the sail's gray X-ply luff panel. Red-on-gray is trivially easy to detect precisely, and the paddle's position *is* the batten's luff-end position:

```js
const isRedPaddle = (x, y) => {
  const i = (y * W + x) * 4;
  return data[i + 3] > 200        // opaque
    && data[i] > 150              // strong red channel
    && data[i] - data[i + 1] > 70 // red significantly exceeds green
    && data[i + 1] < 130;         // green stays low
};
```

Scanning a narrow strip near the luff (say `v ≈ 0.045` to `0.1`) for runs matching this predicate found every batten's luff-end position to within a pixel or two — far tighter than the dark-stripe method ever achieved, because the signal-to-noise ratio of "bright red against gray" beats "dark stripe against dark print" by a wide margin.

**The general lesson**: when a direct scan of the feature you want is ambiguous, look for a *different* visual feature on the same photo that's mechanically or geometrically tied to it, and has much better contrast. A batten's own printed stripe is hard to isolate; the hardware sitting at its end usually isn't.

### A worked scan snippet

The pattern for any one-off measurement script (run once, in a browser console, against the loaded image — not committed as project code):

```js
const img = new Image();
await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = '/path/to/source.png'; });
const c = document.createElement('canvas');
c.width = img.width; c.height = img.height;
const ctx = c.getContext('2d');
ctx.drawImage(img, 0, 0);
const data = ctx.getImageData(0, 0, img.width, img.height).data;
// ... scan `data` for the feature, print results, transcribe into the relevant *_PTS or BATTENS constant ...
```

Write it, run it once, read off the numbers, delete the script. It's disposable tooling for producing a constant, not part of the shipped code.

## Iterative trim as a workflow

The rig-level numbers in the table above weren't derived from any formula — they came from a tight loop: **make one change, render it, look at it from the angle that matters, adjust, repeat.** A few practices made this converge instead of oscillating:

- **Change one thing at a time.** A request like "boom front up 15 cm, tail block smaller" is really two independent changes; verify each visually before assuming both landed correctly, or a bad interaction between them is invisible until much later.
- **Match the reference photo's actual camera angle**, not just any angle. Rake, twist, and boom height often look plausible from the default orbit position and visibly wrong from the angle the reference photo was actually shot at (a low three-quarter planing shot, an aerial shot straight down). Reproduce that specific viewpoint before declaring a match.
- **Absolute measurements beat relative nudges once you have a reference point.** Early corrections were phrased as deltas ("move it down 10 cm more"); once a stable baseline existed, later corrections were exact figures ("2.8 cm off the deck," "1 cm from the clew") — deltas compound error if any one step is misjudged, absolute values don't.
- **Distinguish "the code is wrong" from "the render is stale."** A change that appears to do nothing is more often a hot-reload or renderer-throttling issue than an incorrect fix — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) before assuming a correctly-applied change produced the wrong result.
