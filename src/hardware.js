import * as THREE from 'three';
import { taperedTube } from './util.js';

// Rig-local coords: sail tack at origin, mast foot just below (short base + joint).
export function createHardware(shape, boom) {
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
  const mastPts = [new THREE.Vector3(mastX(0), -0.007, 0)];
  for (let i = 0; i <= 14; i++) {
    const u = i / 14;
    mastPts.push(new THREE.Vector3(mastX(u), u * shape.height, 0));
  }
  g.add(new THREE.Mesh(taperedTube(mastPts, (t) => 0.027 - 0.015 * t, 14, 90), carbon));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), carbon);
  cap.position.set(mastX(1), shape.height, 0);
  g.add(cap);

  // Wishbone boom at clew height, arms traced from the top-down boom photo
  // and planar-projected with its texture (top and bottom).
  const bu = shape.clewU;
  const by = bu * shape.height;
  const bx = mastX(bu);
  const ch = shape.leechX(bu) - bx;
  const bl = ch + 0.11;             // boom length front->tail, meters
  const mpp = bl / boom.length;     // meters per photo pixel
  const boomMat = new THREE.MeshPhysicalMaterial({
    map: boom.texture, roughness: 0.55, metalness: 0.1, clearcoat: 0.2, clearcoatRoughness: 0.4,
  });
  for (const side of ['left', 'right']) {
    const pts = [], radii = [];
    for (const smp of boom.arms(16)) {
      const { c, r } = smp[side];
      pts.push(new THREE.Vector3(
        bx + smp.d * mpp,
        by + 0.26 - 0.27 * Math.pow(smp.d / boom.length, 1.1), // front raised, sloping aft
        (c - boom.centerX) * mpp,
      ));
      radii.push(THREE.MathUtils.clamp(r * mpp, 0.008, 0.026)); // rope merges guard
    }
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
  head.position.set(bx + 0.01, by + 0.26, 0);
  g.add(head);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.08), carbon);
  tail.position.set(bx + ch + 0.08, by - 0.01, 0);
  g.add(tail);

  // Short mast foot: collar at the mast base + small universal joint to the deck.
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.008, 16), alloy);
  collar.position.set(mastX(0), -0.007, 0);
  g.add(collar);
  const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.007, 12), carbon);
  joint.position.set(mastX(0), -0.0125, 0);
  g.add(joint);

  return g;
}
