import * as THREE from 'three';
import { loadAndScan } from './util.js';
import sailUrl from '../026-Mach-9-render-final-lr-1.png';

const HEIGHT = 4.25; // rigged sail height, meters

// Loads the catalog render and scans its alpha silhouette so geometry and UVs
// follow the real sail outline. u: foot(0)->head(1). x in meters, tack at 0.
// Alpha threshold 20: the translucent window (~27) still counts as "inside".
export async function loadSailShape() {
  const { img, W, H, top, bottom, rowAt, edgeAt } = await loadAndScan(sailUrl);
  const scale = HEIGHT / (bottom - top);
  const x0 = edgeAt(0)[0]; // tack = x origin

  // clew = rightmost point of the whole silhouette -> boom height
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
