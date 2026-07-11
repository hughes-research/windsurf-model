import * as THREE from 'three';
import { interp1 } from './util.js';

// Slalom board lofted from superellipse cross-sections: outline and deck
// texture come from the scanned top-down deck photo, hull stays white.
// Board-local: bottom rocker line at y=0, tail at +x (same side as the clew),
// nose at -x. Mast track sits at x=0.
export const LEN = 2.32;
const TAIL_X = 1.3;
const THICK_PTS = [[0, 0.085], [0.3, 0.125], [0.55, 0.13], [0.8, 0.085], [1, 0.03]];
const ROCKER_PTS = [[0, 0.015], [0.25, 0], [0.55, 0.005], [0.75, 0.05], [0.9, 0.11], [1, 0.17]];

export const DECK_AT_TRACK = interp1(ROCKER_PTS, TAIL_X / LEN) + interp1(THICK_PTS, TAIL_X / LEN);

export function createBoard(shape) {
  const g = new THREE.Group();
  const NT = 60, NJ = 32, n = 2.6; // superellipse exponent: boxy slalom rails
  const pos = [], uv = [];
  for (let i = 0; i <= NT; i++) {
    const t = i / NT;
    const x = TAIL_X - t * LEN;
    // Shrink first/last rings to close tail and nose.
    const end = Math.min(1, t * 40, (1 - t) * 40) * 0.98 + 0.02;
    const w = shape.widthAt(t) * end;
    const h = interp1(THICK_PTS, t) * end;
    const r = interp1(ROCKER_PTS, t);
    for (let j = 0; j <= NJ; j++) {
      const a = (j / NJ) * Math.PI * 2;
      const sy = Math.sin(a), sz = Math.cos(a);
      const y = r + h / 2 + Math.sign(sy) * Math.pow(Math.abs(sy), 2 / n) * (h / 2);
      const z = Math.sign(sz) * Math.pow(Math.abs(sz), 2 / n) * (w / 2);
      pos.push(x, y, z);
      uv.push(...shape.uvFor(t, 0.5 - z / (w || 1))); // planar top projection
    }
  }
  // Deck faces first, hull faces second, so each half gets its own material.
  const ring = NJ + 1;
  const idxDeck = [], idxHull = [];
  for (let i = 0; i < NT; i++)
    for (let j = 0; j < NJ; j++) {
      const a = i * ring + j;
      (j < NJ / 2 ? idxDeck : idxHull).push(a, a + 1, a + ring, a + 1, a + ring + 1, a + ring);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex([...idxDeck, ...idxHull]);
  geo.addGroup(0, idxDeck.length, 0);
  geo.addGroup(idxDeck.length, idxHull.length, 1);
  geo.computeVertexNormals();
  // The deck photo has baked lighting — keep added light flat so it doesn't wash out.
  const deckMat = new THREE.MeshPhysicalMaterial({
    map: shape.texture, color: 0xe4e4e4, roughness: 0.85, metalness: 0,
    clearcoat: 0.06, clearcoatRoughness: 0.6, envMapIntensity: 0.35,
  });
  const hullMat = new THREE.MeshPhysicalMaterial({
    map: shape.bottomTexture, color: 0xe4e4e4, roughness: 0.85, metalness: 0,
    clearcoat: 0.06, clearcoatRoughness: 0.6, envMapIntensity: 0.35,
  });
  const hull = new THREE.Mesh(geo, [deckMat, hullMat]);
  hull.name = 'board';
  g.add(hull);

  // Raked slalom fin under the tail.
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.03, -0.25, 0.15, -0.4);
  s.lineTo(0.17, -0.41);
  s.quadraticCurveTo(0.13, -0.18, 0.11, 0);
  s.closePath();
  const finGeo = new THREE.ExtrudeGeometry(s, {
    depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2,
  });
  const fin = new THREE.Mesh(finGeo, new THREE.MeshStandardMaterial({
    color: 0x1a1b1e, roughness: 0.3, metalness: 0.4,
  }));
  fin.position.set(TAIL_X - 0.16, interp1(ROCKER_PTS, 0.03) + 0.005, -0.006);
  fin.name = 'fin';
  g.add(fin);

  return g;
}
