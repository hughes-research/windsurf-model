/**
 * Board outline and texture loader.
 *
 * Uses a top-down deck photo for outline width and deck UVs, plus a bottom
 * photo warped into the same frame for the hull texture. Both share one UV set
 * via planar top projection.
 *
 * Parameter t runs tail (0, image bottom) → nose (1, image top).
 * Parameter s runs 0 → 1 across the board width at each station.
 *
 * @module boardImage
 */

import * as THREE from 'three';
import { loadAndScan } from './util.js';
import deckUrl from './board_map.png';
import bottomUrl from '../board_bottom.png';

/** CSS filter applied to exports that run light/pink. */
const CORRECT = 'brightness(0.85) saturate(1.25) contrast(1.05)';

/** Content x-bounds of a scan, sampled across 51 rows. */
function bbox(scan) {
  let l = Infinity, r = -Infinity;
  for (let i = 0; i <= 50; i++) {
    const [a, b] = scan.edgeAt(i / 50);
    l = Math.min(l, a);
    r = Math.max(r, b);
  }
  return { l, r };
}

/**
 * Load deck and bottom photos and build a board shape descriptor.
 *
 * @param {number} length - Target board length in meters.
 * @returns {Promise<{
 *   texture: THREE.Texture,
 *   bottomTexture: THREE.Texture,
 *   widthAt: (t: number) => number,
 *   uvFor: (t: number, s: number) => [number, number]
 * }>}
 */
export async function loadBoardShape(length) {
  const [deck, bottom] = await Promise.all([loadAndScan(deckUrl), loadAndScan(bottomUrl)]);
  const { W, H } = deck;
  const scale = length / (deck.bottom - deck.top);

  const makeCanvas = () => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#6f0d12'; // matte so mipmaps blend toward board red, not white
    ctx.fillRect(0, 0, W, H);
    ctx.filter = CORRECT;
    return [c, ctx];
  };
  const asTexture = (c) => {
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  };

  const [cd, xd] = makeCanvas();
  xd.drawImage(deck.img, 0, 0);

  // Bottom photo: warp its content box onto the deck photo's, mirrored so it
  // reads correctly from below through the shared top-projection UVs.
  const [cb, xb] = makeCanvas();
  const db = bbox(deck), bb = bbox(bottom);
  xb.translate(db.l + (db.r - db.l) / 2, deck.top);
  xb.scale(-(db.r - db.l) / (bb.r - bb.l), (deck.bottom - deck.top) / (bottom.bottom - bottom.top));
  xb.translate(-(bb.l + (bb.r - bb.l) / 2), -bottom.top);
  xb.drawImage(bottom.img, 0, 0);

  return {
    texture: asTexture(cd),
    bottomTexture: asTexture(cb),
    widthAt: (t) => {
      const [l, r] = deck.edgeAt(t);
      return (r - l) * scale;
    },
    uvFor(t, s) {
      const [l, r] = deck.edgeAt(t);
      // Inset 2px so anti-aliased edge pixels don't smear down the rails.
      return [(l + 2 + s * (r - l - 4)) / W, 1 - deck.rowAt(t) / H];
    },
  };
}
