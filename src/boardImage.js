import * as THREE from 'three';
import { loadAndScan } from './util.js';
import boardUrl from './board_map.png';

// Loads the top-down deck photo. t: tail(0, image bottom) -> nose(1, image top).
// s: 0..1 across the local width. Widths in meters, scaled to board length.
export async function loadBoardShape(length) {
  const { img, W, H, top, bottom, rowAt, edgeAt } = await loadAndScan(boardUrl);
  const scale = length / (bottom - top);

  const texture = new THREE.Texture(img);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  return {
    texture,
    widthAt: (t) => {
      const [l, r] = edgeAt(t);
      return (r - l) * scale;
    },
    uvFor(t, s) {
      const [l, r] = edgeAt(t);
      // inset 2px so anti-aliased edge pixels don't smear down the rails
      return [(l + 2 + s * (r - l - 4)) / W, 1 - rowAt(t) / H];
    },
  };
}
