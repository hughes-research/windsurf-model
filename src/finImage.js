/**
 * Slalom fin shape and texture loader.
 *
 * Scans a side-on fin photo (base at image top, tip at bottom) so the blade's
 * leading/trailing edge curves — including the aft sweep — come straight from
 * the photo, the same way the sail derives its luff/leech.
 *
 * Parameter u runs tip (0, image bottom) → base (1, image top).
 * x in meters, leading edge at the base = x origin, +x aft.
 *
 * @module finImage
 */

import * as THREE from 'three';
import { loadAndScan } from './util.js';
import finUrl from '../fin_texture.png';

/**
 * Load and scan the fin photo.
 *
 * @param {number} [depth=0.4] - Blade depth in meters, base to tip.
 * @returns {Promise<{
 *   texture: THREE.CanvasTexture,
 *   depth: number,
 *   leadX: (u: number) => number,
 *   trailX: (u: number) => number,
 *   uvFor: (u: number, s: number) => [number, number]
 * }>}
 */
export async function loadFinShape(depth = 0.4) {
  const { img, W, H, top, bottom, rowAt, edgeAt } = await loadAndScan(finUrl);
  const scale = depth / (bottom - top);
  const x0 = edgeAt(1)[0]; // leading edge at the base = x origin

  // Dark matte under the photo so mipmaps blend toward carbon, not white.
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#101114';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  return {
    texture,
    depth,
    leadX: (u) => (edgeAt(u)[0] - x0) * scale,
    trailX: (u) => (edgeAt(u)[1] - x0) * scale,
    uvFor(u, s) {
      const [l, r] = edgeAt(u);
      // inset 1px so anti-aliased edge pixels don't smear around the edges
      return [(l + 1 + s * (r - l - 2)) / W, 1 - rowAt(u) / H];
    },
  };
}
