import * as THREE from 'three';
import { taperedTube } from './util.js';

// Rig-local coords: sail tack at origin, mast foot just below (short base + joint).
export function createHardware(shape) {
  const g = new THREE.Group();
  const carbon = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.35, metalness: 0.55 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.3, metalness: 0.9 });

  // Luff curve: the mast bends in a smooth arc, so fit a parabola through the
  // scanned luff instead of tracking its notches (fittings, boom cutaway).
  const [ua, ub, uc] = [0.05, 0.5, 0.95];
  const [xa, xb, xc] = [shape.luffX(ua), shape.luffX(ub), shape.luffX(uc)];
  const mastX = (u) =>
    0.015
    + xa * ((u - ub) * (u - uc)) / ((ua - ub) * (ua - uc))
    + xb * ((u - ua) * (u - uc)) / ((ub - ua) * (ub - uc))
    + xc * ((u - ua) * (u - ub)) / ((uc - ua) * (uc - ub));
  const mastPts = [new THREE.Vector3(mastX(0), -0.05, 0)];
  for (let i = 0; i <= 14; i++) {
    const u = i / 14;
    mastPts.push(new THREE.Vector3(mastX(u), u * shape.height, 0));
  }
  g.add(new THREE.Mesh(taperedTube(mastPts, (t) => 0.027 - 0.015 * t, 14, 90), carbon));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), carbon);
  cap.position.set(mastX(1), shape.height, 0);
  g.add(cap);

  // Wishbone boom at clew height, both sides, meeting past the clew.
  const bu = shape.clewU;
  const by = bu * shape.height;
  const bx = mastX(bu);
  const ch = shape.leechX(bu) - bx;
  for (const s of [1, -1]) {
    const pts = [
      new THREE.Vector3(bx + 0.03, by, s * 0.03),
      new THREE.Vector3(bx + 0.42 * ch, by - 0.02, s * 0.27),
      new THREE.Vector3(bx + 0.82 * ch, by - 0.045, s * 0.17),
      new THREE.Vector3(bx + ch + 0.1, by - 0.06, s * 0.03),
    ];
    g.add(new THREE.Mesh(taperedTube(pts, () => 0.016, 12, 60), carbon));
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.11), carbon);
  head.position.set(bx + 0.01, by, 0);
  g.add(head);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.12), carbon);
  tail.position.set(bx + ch + 0.1, by - 0.06, 0);
  g.add(tail);

  // Short mast foot: collar at the mast base + small universal joint to the deck.
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.045, 16), alloy);
  collar.position.set(mastX(0), -0.045, 0);
  g.add(collar);
  const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.035, 12), carbon);
  joint.position.set(mastX(0), -0.075, 0);
  g.add(joint);

  return g;
}
