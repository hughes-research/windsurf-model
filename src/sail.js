import * as THREE from 'three';
import { interp1 } from './util.js';

// 3D shaping applied on top of the scanned planform: draft belly peaking
// ~40% back from the luff, deepest near boom height, leech twist up high.
const DRAFT_PTS = [[0, 0.06], [0.235, 0.095], [0.5, 0.075], [0.8, 0.038], [1, 0.008]];

export function createSail(shape) {
  const NU = 96, NV = 36;
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
      const twist = 0.3 * Math.pow(u, 2.4) * v * chord;
      pos.set([xl + v * chord, u * shape.height, belly + twist], k * 3);
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
