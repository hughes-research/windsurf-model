import * as THREE from 'three';
import { interp1 } from './util.js';

// 3D shaping applied on top of the scanned planform: draft belly peaking
// ~40% back from the luff, deepest near boom height, leech twist up high.
const DRAFT_PTS = [[0, 0.06], [0.235, 0.095], [0.5, 0.075], [0.8, 0.038], [1, 0.008]];

// Batten u-positions measured from the dark stripes in the catalog render
// (two interpolated where black print hides them). Pockets bulge to the
// belly side as gaussian ridges.
const BATTENS = [0.16, 0.3, 0.435, 0.58, 0.7, 0.83, 0.95];
const POCKET_SIGMA = 0.009, POCKET_HEIGHT = 0.012;
function pocketBulge(u, v) {
  let b = 0;
  for (const ub of BATTENS) {
    const x = (u - ub) / POCKET_SIGMA;
    b += Math.exp(-x * x);
  }
  // pockets stop at the mast sleeve and taper before the leech edge
  const fade = Math.max(0, Math.min(1, (v - 0.1) * 10, (0.98 - v) * 15));
  return POCKET_HEIGHT * b * fade;
}

export function createSail(shape) {
  const NU = 260, NV = 36; // NU fine enough to resolve the pocket ridges
  const count = (NU + 1) * (NV + 1);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const params = new Float32Array(count * 2); // (v, u) for flutter
  const idx = [];
  let k = 0;
  for (let i = 0; i <= NU; i++) {
    const u = i / NU;
    const xl = shape.luffX(u), xr = shape.leechX(u);
    const chord = xr - xl;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      const belly = interp1(DRAFT_PTS, u) * chord * Math.sin(Math.PI * Math.pow(v, 0.75));
      const twist = 0.55 * u * u * v * chord; // parabolic: head falls open to leeward
      pos.set([xl + v * chord, u * shape.height, belly + twist + pocketBulge(u, v)], k * 3);
      uv.set(shape.uvFor(u, v), k * 2);
      params.set([v, u], k * 2);
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

  // Flutter: small z wobble, strongest at the upper leech.
  const base = pos.slice();
  function update(t) {
    for (let i = 0; i < count; i++) {
      const v = params[i * 2], u = params[i * 2 + 1];
      pos[i * 3 + 2] = base[i * 3 + 2]
        + 0.011 * v * v * (0.25 + 0.75 * u) * Math.sin(4.5 * t + 9 * v + 6 * u);
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return { mesh, update };
}
