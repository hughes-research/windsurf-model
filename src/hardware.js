/**
 * Rig hardware: mast, boom, blocks, outhaul, and mast base.
 *
 * Rig-local coordinates: sail tack at origin, mast foot just below.
 * Boom arms are traced from the scanned top-down boom photo with planar UV projection.
 *
 * @module hardware
 */

import * as THREE from 'three';
import { taperedTube, smoothLuffX } from './util.js';

/**
 * Build mast, boom, head/tail blocks, outhaul lines, and mast base.
 *
 * @param {object} shape - Sail shape from {@link loadSailShape} (height, clewU, luffX, leechX).
 * @param {object} boom - Boom shape from {@link loadBoomShape} (texture, arms, length, etc.).
 * @returns {THREE.Group}
 */
export function createHardware(shape, boom) {
  const g = new THREE.Group();
  const carbon = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.35, metalness: 0.55 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.3, metalness: 0.9 });

  const luff = smoothLuffX(shape);
  const mastX = (u) => luff(u) + 0.015;
  // Only the stub below the tack shows — the rest lives inside the luff sleeve.
  const mastPts = [
    new THREE.Vector3(mastX(0), -0.007, 0),
    new THREE.Vector3(mastX(0.01), 0.06, 0),
    new THREE.Vector3(mastX(0.03), 0.13, 0),
  ];
  g.add(new THREE.Mesh(taperedTube(mastPts, () => 0.026, 14, 8), carbon));
  // (The sleeve tip cap lives in sail.js so it can flex with the mast.)

  // Wishbone boom at clew height, arms traced from the top-down boom photo.
  const bu = shape.clewU;
  const by = bu * shape.height;
  const bx = mastX(bu);
  const ch = shape.leechX(bu) - bx;
  const bl = ch + 0.01;             // boom length front→tail: end ~0.5 cm past clew
  const mpp = bl / boom.length;     // meters per photo pixel
  const boomMat = new THREE.MeshPhysicalMaterial({
    map: boom.texture, roughness: 0.55, metalness: 0.1, clearcoat: 0.2, clearcoatRoughness: 0.4,
  });
  const yAt = (d) => by + 0.36 - 0.47 * Math.pow(d / boom.length, 1.1); // front high, sloping aft
  for (const side of ['left', 'right']) {
    const pts = [], radii = [];
    for (const smp of boom.arms(16)) {
      const { c, r } = smp[side];
      pts.push(new THREE.Vector3(bx + smp.d * mpp, yAt(smp.d), (c - boom.centerX) * mpp));
      radii.push(THREE.MathUtils.clamp(r * mpp, 0.008, 0.026)); // rope merges guard
    }
    // Arm ends plunge into the head and tail blocks so nothing floats.
    const sgn = Math.sign(pts[0].z) || 1;
    pts.unshift(new THREE.Vector3(bx + 0.015, by + 0.36, sgn * 0.02));
    radii.unshift(radii[0]);
    pts.push(new THREE.Vector3(bx + ch - 0.035, by - 0.11, sgn * 0.015));
    radii.push(radii[radii.length - 1]);
    const rAt = (t) => {
      const f = t * (radii.length - 1), i = Math.floor(f);
      return radii[i] + (radii[Math.min(i + 1, radii.length - 1)] - radii[i]) * (f - i);
    };
    const geo = taperedTube(pts, rAt, 12, 60);
    const posA = geo.attributes.position, uvA = geo.attributes.uv;
    for (let i = 0; i < posA.count; i++) { // project photo from above
      const imgX = boom.centerX + posA.getZ(i) / mpp;
      const imgY = boom.top + (posA.getX(i) - bx) / mpp;
      uvA.setXY(i, imgX / boom.W, 1 - imgY / boom.H);
    }
    g.add(new THREE.Mesh(geo, boomMat));
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.085, 0.075), carbon);
  head.position.set(bx + 0.01, by + 0.36, 0);
  g.add(head);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.08), carbon);
  tail.position.set(bx + ch - 0.035, by - 0.11, 0); // back face ~1 cm off clew
  g.add(tail);

  // Outhaul: two rope strands from clew grommet to boom end.
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0xb6b0a4, roughness: 0.9 });
  const clew = new THREE.Vector3(bx + ch, by, 0.022);
  const boomEnd = new THREE.Vector3(bx + ch - 0.03, by - 0.105, 0);
  for (const o of [0.008, -0.008]) {
    const p1 = clew.clone().add(new THREE.Vector3(0, 0, o * 0.3));
    const p2 = boomEnd.clone().add(new THREE.Vector3(0, 0, o));
    const mid = p1.clone().lerp(p2, 0.5).add(new THREE.Vector3(0.007, 0, o * 0.4));
    g.add(new THREE.Mesh(taperedTube([p1, mid, p2], () => 0.0028, 8, 24), ropeMat));
  }

  // Mast foot: collar at mast base + universal joint to deck.
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.008, 16), alloy);
  collar.position.set(mastX(0), -0.007, 0);
  g.add(collar);
  const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.007, 12), carbon);
  joint.position.set(mastX(0), -0.0125, 0);
  g.add(joint);

  return g;
}
