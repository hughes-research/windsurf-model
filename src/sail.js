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

/** 3D cloth surface point including belly, twist, and pocket bulge. */
function surfacePos(shape, u, v) {
  const xl = shape.luffX(u), xr = shape.leechX(u);
  const chord = xr - xl;
  const flat = interp1(PROFILE_PTS, v);
  const prof = flat + camWeight(u) * (interp1(CAM_PROFILE_PTS, v) - flat);
  const belly = interp1(DRAFT_PTS, u) * chord * prof;
  const twist = 0.55 * u * u * v * chord; // parabolic leech twist
  return new THREE.Vector3(xl + v * chord, u * shape.height, belly + twist + pocketBulge(u, v));
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
  const params = new Float32Array(count * 3); // (v, u, damp) for flutter
  const idx = [];
  let k = 0;
  for (let i = 0; i <= NU; i++) {
    const u = i / NU;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      const p = surfacePos(shape, u, v);
      pos.set([p.x, p.y, p.z], k * 3);
      uv.set(shape.uvFor(u, v), k * 2);
      params.set([v, u, battenDamp(u, v)], k * 3);
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

  // Semi-transparent carbon batten rods in the pockets.
  const rodMat = new THREE.MeshPhysicalMaterial({
    color: 0xf2f2f2, transparent: true, opacity: 0.25, roughness: 0.2,
    clearcoat: 0.5, depthWrite: false,
  });
  for (const bt of BATTENS) {
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const v = 0.12 + (i / 20) * (0.985 - 0.12);
      const p = surfacePos(shape, bt.u - bt.du * v, v);
      p.z += 0.004;
      pts.push(p);
    }
    group.add(new THREE.Mesh(taperedTube(pts, (t) => 0.0045 + 0.0035 * t, 8, 40), rodMat));
  }
  for (const um of MINIS) {
    const chord = shape.leechX(um) - shape.luffX(um);
    const v0 = Math.max(0.6, 1 - 0.28 / chord);
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const v = v0 + (i / 8) * (0.985 - v0);
      const p = surfacePos(shape, um, v);
      p.z += 0.003;
      pts.push(p);
    }
    group.add(new THREE.Mesh(taperedTube(pts, () => 0.0028, 8, 16), rodMat));
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
  const sleeve = new THREE.Mesh(sleeveGeo, new THREE.MeshPhysicalMaterial({
    map: shape.texture, roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.5,
  }));
  sleeve.scale.z = 0.68; // teardrop fairing
  sleeve.name = 'sleeve';
  group.add(sleeve);

  // Leech flutter: sinusoidal z-offset, strongest upper leech, damped at battens.
  const base = pos.slice();
  function update(t) {
    for (let i = 0; i < count; i++) {
      const v = params[i * 3], u = params[i * 3 + 1], damp = params[i * 3 + 2];
      pos[i * 3 + 2] = base[i * 3 + 2]
        + 0.011 * damp * v * v * (0.25 + 0.75 * u) * Math.sin(4.5 * t + 9 * v + 6 * u);
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return { mesh: group, update };
}
