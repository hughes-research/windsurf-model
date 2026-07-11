/**
 * Sail planform and texture loader.
 *
 * Scans the official Severne catalog render alpha channel to derive the
 * sail outline, luff/leech curves, and UV mapping. Geometry in sail.js
 * builds on top of this 2D shape.
 *
 * Coordinate system:
 *   u = 0 at foot (tack), u = 1 at head
 *   x in meters, tack at x = 0
 *
 * @module sailImage
 */

import * as THREE from 'three';
import { loadAndScan } from './util.js';
import sailUrl from '../026-Mach-9-render-final-lr-1.png';

/** Rigged sail height in meters (luff length). */
const HEIGHT = 4.25;

/**
 * Load the catalog render and build a parametric sail shape.
 *
 * @returns {Promise<{
 *   texture: THREE.Texture,
 *   height: number,
 *   clewU: number,
 *   luffX: (u: number) => number,
 *   leechX: (u: number) => number,
 *   uvFor: (u: number, v: number) => [number, number]
 * }>}
 */
export async function loadSailShape() {
  const { img, W, H, top, bottom, rowAt, edgeAt } = await loadAndScan(sailUrl);
  const scale = HEIGHT / (bottom - top);
  const x0 = edgeAt(0)[0]; // tack = x origin

  // Clew = rightmost point of the whole silhouette → boom height.
  let clewU = 0.25, maxR = 0;
  for (let i = 0; i <= 200; i++) {
    const u = i / 200;
    const r = edgeAt(u)[1];
    if (r > maxR) { maxR = r; clewU = u; }
  }

  const texture = new THREE.Texture(img);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  return {
    texture,
    height: HEIGHT,
    clewU,
    luffX: (u) => (edgeAt(u)[0] - x0) * scale,
    leechX: (u) => (edgeAt(u)[1] - x0) * scale,
    uvFor(u, v) {
      const [l, r] = edgeAt(u);
      return [(l + v * (r - l)) / W, 1 - rowAt(u) / H];
    },
  };
}
