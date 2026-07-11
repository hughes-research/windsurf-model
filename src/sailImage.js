import * as THREE from 'three';
import sailUrl from '../026-Mach-9-render-final-lr-1.png';

const ALPHA_EDGE = 20;   // window alpha (~27) still counts as "inside"
const HEIGHT = 4.25;     // rigged sail height, meters

// Loads the catalog render and scans its alpha silhouette so geometry and UVs
// follow the real sail outline. u: foot(0)->head(1). x in meters, tack at 0.
export async function loadSailShape() {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('sail image failed to load'));
    img.src = sailUrl;
  });
  const W = img.width, H = img.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;
  const alphaAt = (x, y) => data[(y * W + x) * 4 + 3];

  const edges = new Array(H).fill(null); // [leftPx, rightPx] per row
  for (let y = 0; y < H; y++) {
    let l = -1;
    for (let x = 0; x < W; x++) if (alphaAt(x, y) > ALPHA_EDGE) { l = x; break; }
    if (l < 0) continue;
    for (let x = W - 1; x >= l; x--) if (alphaAt(x, y) > ALPHA_EDGE) { edges[y] = [l, x]; break; }
  }
  const top = edges.findIndex(Boolean);
  let bottom = H - 1;
  while (!edges[bottom]) bottom--;

  const rowAt = (u) => bottom - u * (bottom - top);
  const edgeAt = (u) => edges[Math.round(rowAt(u))] ?? [0, 0];
  const scale = HEIGHT / (bottom - top);
  const x0 = edges[bottom][0]; // tack = x origin

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
