/**
 * Parametric sail membrane, battens, and luff sleeve.
 *
 * Builds a 3D sail surface on top of the scanned 2D planform from sailImage.js.
 * Adds draft belly, leech twist, camber profiles, batten pockets, and subtle
 * leech flutter animation.
 *
 * Surface parameters:
 *   u = 0 at foot (tack) → u = 1 at head, along the luff
 *   v = 0 at luff → v = 1 at leech, across the chord
 *
 * @module sail
 */

import * as THREE from 'three';
import { interp1, taperedTube, smoothLuffX } from './util.js';

/** Luff sleeve half-width (m) by height u. */
const SLEEVE_PTS = [[0, 0.06], [0.25, 0.075], [0.6, 0.055], [0.85, 0.032], [1, 0.014]];

/** Max draft depth (as fraction of chord) by height u. */
const DRAFT_PTS = [[0, 0.06], [0.235, 0.095], [0.5, 0.075], [0.8, 0.038], [1, 0.008]];

/** Chordwise camber profile: flat X-ply entry, peak ~40% back, ease to leech. */
const PROFILE_PTS = [
  [0, 0], [0.05, 0.012], [0.12, 0.05], [0.26, 0.45], [0.42, 1],
  [0.68, 0.62], [0.88, 0.22], [1, 0],
];

/** Camber-inducer profile: fuller entry when cams rotate. */
const CAM_PROFILE_PTS = [
  [0, 0.3], [0.05, 0.42], [0.12, 0.55], [0.26, 0.75], [0.42, 1],
  [0.68, 0.62], [0.88, 0.22], [1, 0],
];

/** Main batten positions: u at luff, du = leech drop in u-units. */
const BATTENS = [
  { u: 0.153, du: 0.0235 },
  { u: 0.301, du: 0.0165 },
  { u: 0.435, du: 0 },
  { u: 0.58, du: 0 },
  { u: 0.722, du: 0 },
  { u: 0.85, du: -0.014 },
  { u: 0.9365, du: -0.047 },
];

/** Five hard cams on battens 1–5, plus a softer cam on batten 6. */
const CAMS = BATTENS.slice(0, 5).map((b) => b.u);
const SOFT_CAM = { u: BATTENS[5].u, w: 0.45 };

/** Gaussian weight of camber inducers at height u (0–1). */
function camWeight(u) {
  let s = 0;
  for (const uc of CAMS) s += Math.exp(-(((u - uc) / 0.06) ** 2));
  s += SOFT_CAM.w * Math.exp(-(((u - SOFT_CAM.u) / 0.06) ** 2));
  return Math.min(1, s);
}

/** Leech mini-batten positions (midpoints between main battens). */
const MINIS = [0.375, 0.5075, 0.651, 0.786];

/** Ramp mini-battens in near the leech (v > ~0.78). */
const miniGate = (v) => Math.max(0, Math.min(1, (v - 0.78) * 8));

const POCKET_SIGMA = 0.009, POCKET_HEIGHT = 0.006;

/** Gaussian bulge over batten rods (residual cloth tension). */
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

/** Surface components at (u, v) — kept separate so the wind can modulate them. */
function surfaceParts(shape, u, v) {
  const xl = shape.luffX(u), xr = shape.leechX(u);
  const chord = xr - xl;
  const flat = interp1(PROFILE_PTS, v);
  const prof = flat + camWeight(u) * (interp1(CAM_PROFILE_PTS, v) - flat);
  const belly = interp1(DRAFT_PTS, u) * chord * prof;
  const twist = 0.55 * u * u * v * chord; // parabolic leech twist
  return { x: xl + v * chord, y: u * shape.height, belly, twist, pocket: pocketBulge(u, v) };
}

/** 3D cloth surface point including belly, twist, and pocket bulge. */
function surfacePos(shape, u, v) {
  const p = surfaceParts(shape, u, v);
  return new THREE.Vector3(p.x, p.y, p.belly + p.twist + p.pocket);
}

/**
 * Wind strength 0..1: a smooth pseudo-random gust signal built from
 * incommensurate sines — deterministic, never repeats visibly.
 */
function gustAt(t) {
  const g = 0.5 + 0.35 * Math.sin(0.45 * t) + 0.25 * Math.sin(0.97 * t + 2.1)
    + 0.15 * Math.sin(1.73 * t + 4.0);
  return Math.max(0, Math.min(1, g));
}

/** Flutter damping: 0 at batten rods, 1 between them. */
function battenDamp(u, v) {
  let s = 0;
  for (const bt of BATTENS) s += Math.exp(-(((u - (bt.u - bt.du * v)) / 0.012) ** 2));
  for (const um of MINIS) s += miniGate(v) * Math.exp(-(((u - um) / 0.012) ** 2));
  return Math.max(0, 1 - s);
}

/**
 * Build the sail group: cloth mesh, batten rods, luff sleeve, and flutter updater.
 *
 * @param {object} shape - Sail shape from loadSailShape().
 * @returns {{ mesh: THREE.Group, update: (t: number) => void }}
 */
export function createSail(shape) {
  const NU = 260, NV = 36;
  const count = (NU + 1) * (NV + 1);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const params = new Float32Array(count * 3); // (v, u, damp) for the wind model
  const comps = new Float32Array(count * 2);  // (belly, twist) — modulated live
  const idx = [];
  let k = 0;
  for (let i = 0; i <= NU; i++) {
    const u = i / NU;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      const p = surfaceParts(shape, u, v);
      pos.set([p.x, p.y, p.belly + p.twist + p.pocket], k * 3);
      uv.set(shape.uvFor(u, v), k * 2);
      params.set([v, u, battenDamp(u, v)], k * 3);
      comps.set([p.belly, p.twist], k * 2);
      k++;
    }
  }
  const ring = NV + 1;
  for (let i = 0; i < NU; i++)
    for (let j = 0; j < NV; j++) {
      const a = i * ring + j;
      idx.push(a, a + 1, a + ring, a + 1, a + ring + 1, a + ring);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhysicalMaterial({
    map: shape.texture,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.02,
    roughness: 0.35,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.35,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sail';

  const group = new THREE.Group();
  group.add(mesh);

  // Semi-transparent carbon batten rods in the pockets. Each tube records
  // its per-ring (u, v, belly, twist, damp) so the rods ride the moving
  // cloth when the wind model deforms it.
  const rodMat = new THREE.MeshPhysicalMaterial({
    color: 0xf2f2f2, transparent: true, opacity: 0.25, roughness: 0.2,
    clearcoat: 0.5, depthWrite: false,
  });
  const tubes = []; // { geo, baseZ, rings: [{ u, v, belly, twist, damp }], ringSize }
  const addRod = (uAt, v0, v1, radiusFn, radial, segs) => {
    const pts = [], samples = 20;
    for (let i = 0; i <= samples; i++) {
      const v = v0 + (i / samples) * (v1 - v0);
      const p = surfacePos(shape, uAt(v), v);
      p.z += 0.004;
      pts.push(p);
    }
    const geo = taperedTube(pts, radiusFn, radial, segs);
    const rings = [];
    for (let i = 0; i <= segs; i++) {
      const v = v0 + (i / segs) * (v1 - v0);
      const u = uAt(v);
      const p = surfaceParts(shape, u, v);
      rings.push({ u, v, belly: p.belly, twist: p.twist, damp: battenDamp(u, v) });
    }
    const baseZ = geo.attributes.position.array.slice();
    tubes.push({ geo, baseZ, rings, ringSize: radial + 1 });
    group.add(new THREE.Mesh(geo, rodMat));
  };
  for (const bt of BATTENS) addRod((v) => bt.u - bt.du * v, 0.12, 0.985, (t) => 0.0045 + 0.0035 * t, 8, 40);
  for (const um of MINIS) {
    const chord = shape.leechX(um) - shape.luffX(um);
    const v0 = Math.max(0.6, 1 - 0.28 / chord);
    addRod(() => um, v0, 0.985, () => 0.0028, 8, 16);
  }

  // Luff sleeve: tapered tube along smooth luff with X-ply texture wrap.
  const luff = smoothLuffX(shape);
  const sleevePts = [];
  for (let i = 0; i <= 30; i++) {
    const u = i / 30;
    sleevePts.push(new THREE.Vector3(
      luff(u) + 0.015, u * shape.height, 0.5 * interp1(SLEEVE_PTS, u),
    ));
  }
  const camBump = (t) => {
    let s = 0;
    for (const uc of CAMS) s += Math.exp(-(((t - uc) / 0.02) ** 2));
    return s + 0.5 * Math.exp(-(((t - SOFT_CAM.u) / 0.02) ** 2));
  };
  const sleeveGeo = taperedTube(sleevePts, (t) => interp1(SLEEVE_PTS, t) + 0.008 * camBump(t), 18, 120);
  const sUv = sleeveGeo.attributes.uv;
  for (let i = 0; i < sUv.count; i++) {
    const t = sUv.getX(i);
    const wrap = sUv.getY(i);
    const band = 0.02 + 0.1 * (0.5 - 0.5 * Math.cos(2 * Math.PI * wrap));
    sUv.setXY(i, ...shape.uvFor(t, band));
  }
  const SLEEVE_SQUASH = 0.68;
  const sleeve = new THREE.Mesh(sleeveGeo, new THREE.MeshPhysicalMaterial({
    map: shape.texture, roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.5,
  }));
  sleeve.scale.z = SLEEVE_SQUASH; // teardrop fairing
  sleeve.name = 'sleeve';
  group.add(sleeve);
  const sleeveBase = sleeveGeo.attributes.position.array.slice();
  const SLEEVE_RINGS = 121, SLEEVE_RING_SIZE = 19; // taperedTube(…, 18, 120)

  // Tip cap plugs the sleeve end and flexes with the mast (was static hardware).
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.013, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.35, metalness: 0.55 }),
  );
  const capBaseZ = 0.5 * interp1(SLEEVE_PTS, 1) * SLEEVE_SQUASH;
  cap.position.set(luff(1) + 0.015, shape.height, capBaseZ);
  group.add(cap);

  // Wind simulation. Each frame, three effects driven by the gust signal:
  //  - the leech opens and closes: the twist term is scaled by a slow gust
  //    response plus a sine wave traveling up the sail as gusts sweep across;
  //  - the panels breathe a little between battens (monofilm resists — small,
  //    and the batten damp field keeps the rod lines stiff);
  //  - high-frequency leech flutter whose amplitude grows with wind strength;
  //  - the mast flexes base-to-tip: a cantilever bend (∝ u²) sways the sleeve
  //    and carries the whole sail with it — cloth, rods, and tip cap.
  const base = pos.slice();
  const twistModAt = (t, u, g, dev) =>
    1 + 0.3 * dev + 0.14 * Math.sin(1.5 * t - 2.4 * u) * (0.3 + 0.7 * g);
  const flutterAt = (t, u, v, damp, amp) =>
    amp * damp * v * v * (0.25 + 0.75 * u) * Math.sin(4.5 * t + 9 * v + 6 * u);
  function update(t) {
    const g = gustAt(t);
    const dev = (g - 0.5) * 2; // -1..1 around the mean wind
    const flutterAmp = 0.005 + 0.013 * g;
    // Mast bend: gust load + a slower pumping spring, ~±3 cm at the tip.
    const flexBend = 0.06 * (0.35 * dev + 0.2 * Math.sin(1.1 * t + 0.5) * (0.3 + 0.7 * g));
    for (let i = 0; i < count; i++) {
      const v = params[i * 3], u = params[i * 3 + 1], damp = params[i * 3 + 2];
      const belly = comps[i * 2], twist = comps[i * 2 + 1];
      const pocketZ = base[i * 3 + 2] - belly - twist;
      const bellyMod = 1 + 0.05 * dev * (0.25 + 0.75 * damp);
      pos[i * 3 + 2] = pocketZ + belly * bellyMod + twist * twistModAt(t, u, g, dev)
        + flutterAt(t, u, v, damp, flutterAmp) + flexBend * u * u;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();

    // Rods follow the cloth: shift each tube ring by the same deformation
    // evaluated at its station.
    for (const tube of tubes) {
      const arr = tube.geo.attributes.position.array;
      for (let r = 0; r < tube.rings.length; r++) {
        const ring = tube.rings[r];
        const bellyMod = 1 + 0.05 * dev * (0.25 + 0.75 * ring.damp);
        const dz = ring.belly * (bellyMod - 1)
          + ring.twist * (twistModAt(t, ring.u, g, dev) - 1)
          + flutterAt(t, ring.u, ring.v, ring.damp, flutterAmp)
          + flexBend * ring.u * ring.u;
        for (let j = 0; j < tube.ringSize; j++) {
          const zi = (r * tube.ringSize + j) * 3 + 2;
          arr[zi] = tube.baseZ[zi] + dz;
        }
      }
      tube.geo.attributes.position.needsUpdate = true;
    }

    // Sleeve bends with the mast (local z is squashed by the teardrop scale),
    // and the tip cap rides the sleeve end.
    const sArr = sleeveGeo.attributes.position.array;
    for (let r = 0; r < SLEEVE_RINGS; r++) {
      const ru = r / (SLEEVE_RINGS - 1);
      const dz = (flexBend * ru * ru) / SLEEVE_SQUASH;
      for (let j = 0; j < SLEEVE_RING_SIZE; j++) {
        const zi = (r * SLEEVE_RING_SIZE + j) * 3 + 2;
        sArr[zi] = sleeveBase[zi] + dz;
      }
    }
    sleeveGeo.attributes.position.needsUpdate = true;
    cap.position.z = capBaseZ + flexBend;
  }
  return { mesh: group, update };
}
