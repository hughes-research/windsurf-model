import * as THREE from 'three';
import boomUrl from '../boom.png';

// Top-down wishbone boom photo: mast clamp at image top, tail end at bottom.
// Scans both arm runs per row for centerline + thickness, and bakes a texture
// for planar projection from above.
export async function loadBoomShape() {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('boom.png failed to load'));
    img.src = boomUrl;
  });
  const W = img.width, H = img.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;

  // Opaque runs per row.
  const spans = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    let start = -1;
    for (let x = 0; x < W; x++) {
      const on = data[(y * W + x) * 4 + 3] > 20;
      if (on && start < 0) start = x;
      else if (!on && start >= 0) { row.push([start, x - 1]); start = -1; }
    }
    if (start >= 0) row.push([start, W - 1]);
    spans.push(row);
  }
  const top = spans.findIndex((r) => r.length);
  let bottom = H - 1;
  while (!spans[bottom].length) bottom--;

  // Arm zone: rows where the two arms are clearly separated (skips the clamp
  // at the front and the tail piece where they converge).
  const armRows = [];
  for (let y = top; y <= bottom; y++) {
    const r = spans[y];
    if (r.length >= 2 && r[r.length - 1][0] - r[0][1] > W * 0.15) armRows.push(y);
  }
  const armTop = armRows[0], armBottom = armRows[armRows.length - 1];
  const mid = (sp) => (sp[0] + sp[1]) / 2;

  // n samples per arm: d = px behind the boom front, c/r = center/half-width px.
  function arms(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const y = Math.round(armTop + (i / (n - 1)) * (armBottom - armTop));
      const r = spans[y];
      const L = r[0], R = r[r.length - 1];
      out.push({
        d: y - top,
        left: { c: mid(L), r: (L[1] - L[0]) / 2 },
        right: { c: mid(R), r: (R[1] - R[0]) / 2 },
      });
    }
    return out;
  }
  let centerX = 0;
  for (const s of arms(9)) centerX += (s.left.c + s.right.c) / 2 / 9;

  // Dark matte under the photo so mipmaps don't bleed white.
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#171310';
  ctx.fillRect(0, 0, W, H);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  return { texture, W, H, top, length: bottom - top, centerX, arms };
}
