import * as THREE from 'three';
import { interp1, taperedTube, smoothLuffX } from './util.js';

// Luff sleeve half-width by height: deep race sleeve, fattest around the
// cambers at boom height, tapering to the head.
const SLEEVE_PTS = [[0, 0.06], [0.25, 0.075], [0.6, 0.055], [0.85, 0.032], [1, 0.014]];

// 3D shaping applied on top of the scanned planform: draft belly peaking
// ~40% back from the luff, deepest near boom height, leech twist up high.
const DRAFT_PTS = [[0, 0.06], [0.235, 0.095], [0.5, 0.075], [0.8, 0.038], [1, 0.008]];

// Chordwise camber profile: flat across the X-ply entry zone behind the
// sleeve (underside-of-a-wing flat), swooshing up to max draft ~40% back,
// easing out to the leech.
const PROFILE_PTS = [
  [0, 0], [0.05, 0.012], [0.12, 0.05], [0.26, 0.45], [0.42, 1],
  [0.68, 0.62], [0.88, 0.22], [1, 0],
];

// Batten lines measured from the dark stripes in the catalog render (two
// interpolated where black print hides them). u = position at the luff;
// du = how far the rod's rear drops by the leech (u units — lower battens
// fan downward aft). Pockets bulge to the belly side as gaussian ridges.
const BATTENS = [
  { u: 0.153, du: 0.0235 },    // luff end from tensioner-paddle scan; drop user-calibrated
  { u: 0.301, du: 0.0165 },    // rear down 7 cm (user-calibrated)
  { u: 0.435, du: 0 },
  { u: 0.58, du: 0 },
  { u: 0.722, du: 0 },         // measured flat
  { u: 0.85, du: -0.014 },     // measured: gentle rise aft
  { u: 0.9365, du: -0.047 },
];
// Four leech mini-battens midway between the main battens (first one
// measured at 0.375 in the render; the rest follow the midpoint pattern).
// They only exist near the leech — miniGate ramps them in aft of ~78% chord.
const MINIS = [0.375, 0.5075, 0.651, 0.786];
const miniGate = (v) => Math.max(0, Math.min(1, (v - 0.78) * 8));

const POCKET_SIGMA = 0.009, POCKET_HEIGHT = 0.006; // residual cloth tension over the rod
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
  // pockets stop at the mast sleeve and taper before the leech edge
  const fade = Math.max(0, Math.min(1, (v - 0.1) * 10, (0.98 - v) * 15));
  return POCKET_HEIGHT * b * fade;
}

// Cloth surface point incl. belly, twist, and pocket bulge.
function surfacePos(shape, u, v) {
  const xl = shape.luffX(u), xr = shape.leechX(u);
  const chord = xr - xl;
  const belly = interp1(DRAFT_PTS, u) * chord * interp1(PROFILE_PTS, v);
  const twist = 0.55 * u * u * v * chord; // parabolic: head falls open to leeward
  return new THREE.Vector3(xl + v * chord, u * shape.height, belly + twist + pocketBulge(u, v));
}

// Battens stiffen the cloth: flutter scale is 0 at a rod, 1 between rods.
function battenDamp(u, v) {
  let s = 0;
  for (const bt of BATTENS) s += Math.exp(-(((u - (bt.u - bt.du * v)) / 0.012) ** 2));
  for (const um of MINIS) s += miniGate(v) * Math.exp(-(((u - um) / 0.012) ** 2));
  return Math.max(0, 1 - s);
}

export function createSail(shape) {
  const NU = 260, NV = 36; // NU fine enough to resolve the pocket ridges
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

  // Round carbon rods lying in the pockets on the belly side, tapered
  // thinner toward the luff like real tube battens.
  const group = new THREE.Group();
  group.add(mesh);
  const rodMat = new THREE.MeshPhysicalMaterial({
    color: 0xf2f2f2, transparent: true, opacity: 0.25, roughness: 0.2,
    clearcoat: 0.5, depthWrite: false, // clear rod: shows as a glassy ridge, print stays visible
  });
  for (const bt of BATTENS) {
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const v = 0.12 + (i / 20) * (0.985 - 0.12);
      const p = surfacePos(shape, bt.u - bt.du * v, v);
      p.z += 0.004; // rod rides on the cloth surface
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

  // Luff sleeve: a tapered teardrop tube along the smooth luff curve that
  // swallows the mast, wrapped with the printed X-ply strip from the render.
  // Path leans toward the belly (+z) so the leeward face fairs into the sail
  // while the windward face bulges below it — the underside of the aerofoil.
  const luff = smoothLuffX(shape);
  const sleevePts = [];
  for (let i = 0; i <= 30; i++) {
    const u = i / 30;
    sleevePts.push(new THREE.Vector3(
      luff(u) + 0.015, u * shape.height, 0.5 * interp1(SLEEVE_PTS, u),
    ));
  }
  const sleeveGeo = taperedTube(sleevePts, (t) => interp1(SLEEVE_PTS, t), 18, 120);
  const sPos = sleeveGeo.attributes.position, sUv = sleeveGeo.attributes.uv;
  for (let i = 0; i < sUv.count; i++) {
    const t = sUv.getX(i);    // along the tube = u
    const wrap = sUv.getY(i); // around the tube 0..1
    const band = 0.02 + 0.1 * (0.5 - 0.5 * Math.cos(2 * Math.PI * wrap));
    sUv.setXY(i, ...shape.uvFor(t, band));
  }
  const sleeve = new THREE.Mesh(sleeveGeo, new THREE.MeshPhysicalMaterial({
    map: shape.texture, roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.5,
  }));
  sleeve.scale.z = 0.68; // squash the circle into a teardrop-ish fairing
  sleeve.name = 'sleeve';
  group.add(sleeve);

  // Flutter: small z wobble, strongest at the upper leech, killed at the rods.
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
