# Development Guide

Workflow, conventions, and extension points for working on this codebase.

## Setup

```bash
npm install
npm run dev
```

Vite's dev server serves `index.html` at the repo root and hot-reloads any module under `src/` on save. No build step is required to iterate — every source file is a plain ES module loaded directly by the browser in dev mode.

```bash
npm run build     # production bundle to dist/
npm run preview   # serve dist/ locally, to sanity-check the built output
```

Run `npm run build` before considering any change finished — it catches import errors and other issues that dev-mode's more permissive module resolution can mask.

## The visual verification loop

This is not a project you can validate by reading a diff — nearly every change here is a *shape*, and shapes have to be looked at. The workflow used throughout development, and the one to keep using:

1. **Make one change.** See [`SAIL_RIGGING.md` → Iterative trim as a workflow](SAIL_RIGGING.md#iterative-trim-as-a-workflow) for why "one change at a time" matters more here than in typical application code — compound changes make it much harder to tell which part of a fix worked.
2. **Let the dev server hot-reload, then wait briefly before capturing a screenshot.** There's a real race between a save and a screenshot tool firing — see [`TROUBLESHOOTING.md` → Stale render mistaken for a failed fix](TROUBLESHOOTING.md#stale-render-mistaken-for-a-failed-fix). A short pause (order of a second) avoids capturing a transitional frame.
3. **Orbit to the angle that actually shows the change.** The default camera position does not show the underside of the board, the inner (windward) face of the sail, or a grazing view along the luff — all of which matter for different kinds of changes. Drag the camera to match whatever angle the change is meant to be visible from before judging it.
4. **Compare against the actual reference photo**, not against memory of it. Rigging details in particular (rake angle, boom slope, batten position) are easy to misjudge from an unfamiliar camera angle; put the reference image and the render side by side.
5. **Check the console.** A change that silently throws (a `NaN` in geometry, a missing import) can still leave the *previous* frame on screen if the render loop's error handling doesn't clear it — an unchanged screenshot after an edit is not proof the edit was harmless. See the dev-mode NaN/Infinity check below.

## Dev-mode geometry sanity check

`main.js` includes a guard that only runs in dev mode:

```js
if (import.meta.env.DEV) {
  scene.traverse((o) => {
    const a = o.geometry?.attributes.position;
    if (!a) return;
    for (let i = 0; i < a.array.length; i++)
      if (!Number.isFinite(a.array[i])) throw new Error(`non-finite position in ${o.name || o.type}`);
  });
}
```

This walks every mesh in the scene once, right after assembly, and throws immediately if any vertex position is `NaN` or `Infinity` — which is the typical symptom of a division by zero or an out-of-range spline lookup in one of the geometry builders. It's deliberately loud (throws, not logs) because a silently-`NaN`'d mesh usually just doesn't render, which is easy to miss and hard to trace back to its source. If you add new geometry-building code, this check covers it automatically — no per-module wiring needed, since it walks the fully-assembled scene graph.

## Code conventions

Conventions actually followed across this codebase, worth keeping consistent:

- **Tuning constants live at the top of the file that uses them, named in `SCREAMING_SNAKE_CASE`, with a one-line comment stating their unit and physical meaning** (`/** Rigged sail height in meters (luff length). */`). Anyone retuning the model should be able to find every adjustable number by skimming the top of the relevant file, without reading the geometry-building code below it.
- **JSDoc on every exported function and module**, including parameter/return shapes for anything returning an object with multiple methods (a "shape descriptor" — see [`PHOTO_TO_GEOMETRY.md`](PHOTO_TO_GEOMETRY.md#2-wrap-the-scan-in-a-shape-descriptor)). Internal (non-exported) helper functions get a one-line `/** ... */` rather than full JSDoc.
- **Comments explain *why*, not *what*.** The code is straightforward enough (once you know the coordinate system) that restating what a line does adds noise; a comment earns its place by explaining a non-obvious reason — why an offset exists, why a value was chosen, what physical thing a magic number represents.
- **No premature abstraction.** Each of the four photo-mapped parts (sail, board, boom, and the hardware that combines two of them) has its own scan + geometry module pair, with no shared "part" base class or factory — they're independent enough, and different enough in their parameterization (`(u,v)` vs `(t,s)` vs `d`-along-a-path), that a shared abstraction would cost more in indirection than it would save in repetition. The only genuinely shared code (`loadAndScan`, `taperedTube`, `interp1`, `smoothLuffX`) lives in `util.js` because it's actually identical across uses, not because it's superficially similar.
- **No framework, no build-time type system, no CSS framework.** Plain ES modules, Vite's zero-config defaults, inline `<style>` in `index.html` for the handful of page-level styles (backdrop gradient, caption text). This is a deliberate fit to project size — introducing any of these would add setup and indirection without addressing a real pain point at ~800 lines of source across eight files.
- **Single dependency.** `three` is the only runtime dependency; `vite` the only dev dependency. Before reaching for a new package, check whether Three.js's existing utilities, the DOM/Canvas APIs, or a few more lines of code already cover it — every non-geometry problem in this project so far has been solved without adding one.

## Adding a new photo-mapped part

The recipe — this is exactly the path the fin followed when it went from a hand-drawn `THREE.Shape` to a photo-derived blade (see [`PHOTO_TO_GEOMETRY.md` → Worked example: the fin](PHOTO_TO_GEOMETRY.md#worked-example-the-fin)):

1. **Get a clean source photo.** Transparent background, flat-on or top-down, no baked drop shadow. See [`PHOTO_TO_GEOMETRY.md` → Preparing a source photo](PHOTO_TO_GEOMETRY.md#preparing-a-source-photo) for the full checklist.
2. **Decide the parameterization.** Does the part vary primarily along one axis with a simple width profile (like the board — `widthAt(t)`), does it have two independent curved arms (like the boom), or is it closer to the sail's full `(u, v)` surface? Pick the closest existing pattern rather than inventing a new one.
3. **Write `<part>Image.js`.** Call `loadAndScan()` (or write a multi-span scanner if the part has disjoint regions — see [`PHOTO_TO_GEOMETRY.md` → Multi-span scanning](PHOTO_TO_GEOMETRY.md#multi-span-scanning-two-part-shapes)). Fix real-world scale from exactly one known measurement. Return a shape descriptor: pure functions closing over the scan, named for the part's own vocabulary, plus a `uvFor(...)` that derives from the same scan the geometry will use.
4. **Write `<part>.js`.** Loft a `THREE.BufferGeometry` by walking a parametric grid and calling the shape descriptor at each vertex. Reuse `taperedTube()` from `util.js` if the part is closer to a swept profile than a lofted grid. Texture with `shape.texture` directly if the UVs already line up; composite a corrected/warped canvas texture first if not (see [`PHOTO_TO_GEOMETRY.md` → Textures vs. outlines](PHOTO_TO_GEOMETRY.md#textures-vs-outlines-they-can-diverge)).
5. **Wire it into `main.js`.** Add the new `load<Part>Shape()` call to the `Promise.all(...)` at the top of `init()`, and pass its result into whatever function builds the part's meshes and adds them to the scene graph.
6. **Verify visually**, per the loop above, from multiple angles — and check the dev-mode geometry guard doesn't throw.

No existing module needs to change for this to work — that's the point of keeping each part's pipeline independent (see [`ARCHITECTURE.md` → Design principle](ARCHITECTURE.md#design-principle)).

## Retuning existing parts

For anything covered by a named constant — sail draft, batten position, boom trim, rig rake — start from the [customization cheat sheet in the README](../README.md#customization-cheat-sheet), which maps "what I want to change" directly to the file and constant. For a number that should come from a photo rather than being guessed, follow the measurement methodology in [`SAIL_RIGGING.md` → Measuring features from a photo](SAIL_RIGGING.md#measuring-features-from-a-photo) instead of estimating pixel positions from a screenshot.

## Design history

`docs/superpowers/specs/` holds the original design specification written before implementation began, covering the intended scope (studio product shot, not a configurator or water scene) and the approaches considered and rejected. The git commit history is itself a fairly literal log of the iterative rigging process — commit messages through the batten and boom tuning phases record the specific measurement or correction each commit made, in the same units the corrections were originally requested in (centimeters, degrees). Reading `git log --oneline` front-to-back is a reasonable way to understand how the current constants were arrived at, if this document's summary isn't enough detail.
