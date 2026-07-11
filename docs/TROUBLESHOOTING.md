# Troubleshooting

Every real bug hit while building this project, recorded as **symptom → root cause → fix → general lesson**. Read this before spending an hour re-discovering one of these. Several of these are not specific to this codebase — they're generic Three.js/Vite/browser-automation gotchas worth knowing regardless of what you're building.

## Blank canvas with zero console errors

**Symptom**: the page loads, the `<canvas>` element exists at the correct size, all network requests for image assets succeed, module imports resolve fine when tested individually from the console — but nothing renders, and there are no errors anywhere.

**Root cause**: `requestAnimationFrame` can be silently throttled or fully suspended by the surrounding browser/automation environment (backgrounded tabs, certain embedded preview panes, headless contexts) with no error surfaced anywhere — the callback you passed to `renderer.setAnimationLoop()` simply never fires. Since the render loop is the *only* thing that calls `renderer.render()`, the canvas stays whatever it was initialized to (usually blank).

**Diagnosis**: don't trust "no console errors" as proof the scene built correctly. Instrument directly:

```js
let draws = 0;
const de = WebGL2RenderingContext.prototype.drawElements;
WebGL2RenderingContext.prototype.drawElements = function (...a) { draws++; return de.apply(this, a); };
await new Promise((r) => setTimeout(r, 500));
WebGL2RenderingContext.prototype.drawElements = de;
console.log({ draws }); // 0 confirms nothing is being drawn, regardless of what init() logged
```

If `draws` stays 0 while your own `console.log` breadcrumbs inside `init()` show it completing normally, the render loop itself is the suspended piece, not your scene-building code. Confirm by rendering one frame manually, synchronously, from the console (build the scene fresh, call `renderer.render(scene, camera)` once, screenshot) — if *that* frame paints correctly, the geometry and materials are fine and the bug is purely "rAF never fires here."

**Fix**: paint the first frame synchronously, immediately after scene assembly, *before* calling `setAnimationLoop`:

```js
renderer.render(scene, camera); // paint immediately; rAF can be throttled in background tabs
renderer.setAnimationLoop((t) => { /* ... */ });
```

This guarantees content is visible even in an environment where the animation loop never gets a chance to run, at the cost of one slightly redundant render call in the normal case.

**General lesson**: "no errors" is not the same as "working." When a canvas-based app renders nothing, verify draw calls are actually happening before debugging scene contents — the two failure modes look identical from the outside but have completely different fixes.

## `img.decode()` hangs forever during page load

**Symptom**: `await img.decode()` never resolves when called as part of a module's top-level async initialization during initial page load, even though the same `img.decode()` call resolves instantly when run later from the console against an already-loaded page.

**Root cause**: `HTMLImageElement.decode()` has looser timing guarantees than `onload` in some environments — it can be deferred behind other page-load work in ways `onload` isn't. This is an environment-specific quirk, not a spec violation, but it's a real trap for load-time image scanning.

**Fix**: use the `onload`/`onerror` event pair instead of `decode()` for anything that needs to run during initial page load:

```js
const img = new Image();
await new Promise((resolve, reject) => {
  img.onload = resolve;
  img.onerror = () => reject(new Error(`${url} failed to load`));
  img.src = url;
});
```

This is what `loadAndScan()` in `util.js` and every `load*Shape()` function in this project use — nothing calls `.decode()` anywhere.

**General lesson**: prefer `onload`/`onerror` over `img.decode()` for anything that must complete during initial page load, especially in code that will run inside embedded previews, headless browsers, or other non-standard hosting contexts. `decode()` is fine for images loaded well after the page is interactive.

## Textured mesh renders as its own interior (backface culling looks like a texturing bug)

**Symptom**: a custom-lofted mesh (the board hull, or any `taperedTube`-built geometry) appears the wrong color or shows through to background geometry from certain angles, and looks like a material or UV problem — but changing the material or texture doesn't fix it.

**Root cause**: triangle winding order determines face normal direction in Three.js (counter-clockwise = front face, by default). Hand-built geometry that constructs its index buffer with the wrong winding produces normals pointing *inward*, so from a typical outside viewing angle you're looking at backface-culled geometry — either nothing (culled) or, if you're inside the mesh's effective volume, its interior surface.

**Fix**: get the index order right — `taperedTube()` and `board.js`'s hull both use `(a, a+1, a+ring, a+1, a+ring+1, a+ring)` for each grid cell, which was the corrected order after an earlier version had it backwards.

**Diagnosis technique**: when a newly-lofted mesh looks visually wrong, check winding *before* debugging materials or textures — it's a much more common root cause for "wrong from this angle" bugs than lighting or UV issues. Fastest check: temporarily set `material.side = THREE.DoubleSide` on the mesh in question. If the mesh suddenly looks correct, the winding is backwards (front faces were being culled) — fix the index order, then you can remove the `DoubleSide` override (or keep it, if the extra draw cost doesn't matter, but fixing the winding is cheaper per-frame).

**General lesson**: when you build a `BufferGeometry` by hand, sanity-check triangle winding immediately, with a bright unlit material and `DoubleSide` toggled on/off, before investing time in textures or lighting for that mesh. A winding bug disguises itself as almost any other kind of visual bug depending on the camera angle.

## Texture looks washed out or wrong-colored

**Symptom**: a photo-derived texture (the board deck, in this project) looks pale/blown-out compared to the reference photo once it's lit in the 3D scene, even though the source PNG looks correct when opened directly.

**Two independent causes, both present in this project:**

1. **The scene's own lighting overexposes a photo that already has baked-in lighting.** Product photography typically includes its own studio lighting baked into the pixels. Applying a standard PBR material (moderate roughness, meaningful clearcoat, full environment intensity) on top adds a second layer of lighting response, and the two stack into blown highlights. **Fix**: for any material whose `map` is a real photograph rather than a flat color chart, push roughness high (0.8+), keep clearcoat minimal (under 0.1), and reduce `envMapIntensity` well below 1 — treat the photo as already-lit and minimize what the renderer adds on top.

2. **The source export itself doesn't match the true product color.** Sampling pixels directly from `board_map.png` showed it running measurably lighter and pinker than the actual deck color visible in a reference photo of the finished product — an artifact of how that particular image was exported, not a scene-lighting problem at all. **Fix**: apply a one-time canvas-level color correction when compositing the texture, *baked in once at load*, not as a per-frame shader effect:

```js
ctx.filter = 'brightness(0.85) saturate(1.25) contrast(1.05)';
ctx.drawImage(img, 0, 0);
ctx.filter = 'none';
```

**Diagnosis**: don't guess which of the two causes applies — sample actual pixel values from the source PNG at a few known points (`getImageData` at specific coordinates) and compare against the reference photo's known color. If the raw source pixels already read light/wrong, it's cause 2; if the source pixels look right but the *rendered* result doesn't, it's cause 1.

**General lesson**: photo-sourced textures need different material tuning than procedural/flat-color textures, and "looks wrong in the render" has at least two independently-diagnosable causes (source data vs. lighting response) that require different fixes — check the source pixels before touching material properties, or vice versa, but don't change both at once.

## Debug instrumentation that silently does nothing

**Symptom**: a quick diagnostic loop written to distinguish several possible states (e.g., filling colored horizontal bands on a debug canvas to check whether a texture's UV mapping is inverted) renders as a single flat color instead of the expected bands — looking like the geometry/UV bug you were trying to diagnose, when actually the diagnostic itself is broken.

**Root cause**: a loop like this has a real bug — it never actually applies the intended per-iteration color:

```js
for (const [i, col] of ['#0a0', '#00a', '#a00', '#aa0'].entries())
  ctx.fillRect(0, (i * H) / 4, W, H / 4);   // `col` computed but never assigned to ctx.fillStyle!
```

**Fix**: `ctx.fillStyle = col;` inside the loop body, before the `fillRect` call.

**General lesson**: throwaway diagnostic code is exactly as bug-prone as production code, and a bug in a diagnostic is more dangerous than a bug in real code — it produces a plausible-looking wrong signal that sends you debugging the wrong system. When a diagnostic's output doesn't match its evident intent, re-read the diagnostic itself before concluding anything about the system under test.

## Stale render mistaken for a failed fix

**Symptom**: a source change is made, a screenshot is taken, and the screenshot appears to still show the *previous* state — making a correctly-applied fix look like it didn't work.

**Root cause**: there's a race between a dev-server hot-reload (or a full page navigation) completing and a screenshot being captured — the screenshot tool can fire before the new module has finished re-rendering, capturing a transitional or stale frame.

**Fix**: after any edit that should change the visible output, wait briefly (a few hundred milliseconds to a couple of seconds, depending on asset load complexity) before capturing a verification screenshot — enough time for HMR to apply and at least one animation frame to render with the new state. If a screenshot ever looks suspiciously identical to the prior one right after a change, re-capture rather than trusting it.

**General lesson**: visual verification after a code change has an inherent race condition between "the change is live" and "you looked at it" — build in a deliberate short pause, and don't debug a "fix didn't work" report until you've ruled out simply having looked too early.

## Ambiguous photo measurements (batten stripe detection)

**Symptom**: scanning a photo for a specific dark-printed feature (a batten stripe) produces inconsistent or wrong positions where that feature overlaps other dark print (a background logo, hardware in the photo).

This is covered in depth, with the actual fix (switch to a higher-contrast proxy signal — a colored tensioner paddle instead of the black stripe itself), in [`SAIL_RIGGING.md` → Measuring features from a photo](SAIL_RIGGING.md#measuring-features-from-a-photo). The general lesson bears repeating here: **when a direct scan for a feature is ambiguous, look for a different, higher-contrast feature that's mechanically tied to the one you actually need**, rather than tightening thresholds on a fundamentally low-contrast signal.

## Where to look next

If you hit something not covered here: check [`ARCHITECTURE.md`](ARCHITECTURE.md) for how the pieces are supposed to fit together, and [`PHOTO_TO_GEOMETRY.md`](PHOTO_TO_GEOMETRY.md) if the bug involves a photo-scanning or UV-mapping module specifically. If you fix something that belongs on this list, add it — this document is only useful if it stays current with real bugs, not hypothetical ones.
