import * as THREE from 'three';

// Load an image and scan its alpha silhouette: [left, right] pixel per row.
// u runs 0 (bottom-most content row) -> 1 (top-most).
export async function loadAndScan(url, alphaEdge = 20) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(`${url} failed to load`));
    img.src = url;
  });
  const W = img.width, H = img.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;
  const alphaAt = (x, y) => data[(y * W + x) * 4 + 3];

  const edges = new Array(H).fill(null);
  for (let y = 0; y < H; y++) {
    let l = -1;
    for (let x = 0; x < W; x++) if (alphaAt(x, y) > alphaEdge) { l = x; break; }
    if (l < 0) continue;
    for (let x = W - 1; x >= l; x--) if (alphaAt(x, y) > alphaEdge) { edges[y] = [l, x]; break; }
  }
  const top = edges.findIndex(Boolean);
  let bottom = H - 1;
  while (!edges[bottom]) bottom--;

  const rowAt = (u) => bottom - u * (bottom - top);
  const edgeAt = (u) => edges[Math.round(rowAt(u))] ?? [0, 0];
  return { img, W, H, top, bottom, rowAt, edgeAt };
}

// Catmull-Rom interpolation through [x, y] control points, x ascending, clamped.
export function interp1(pts, x) {
  const n = pts.length;
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[n - 1][0]) return pts[n - 1][1];
  let i = 0;
  while (pts[i + 1][0] < x) i++;
  const [x0, y0] = pts[i];
  const [x1, y1] = pts[i + 1];
  const t = (x - x0) / (x1 - x0);
  const xp = i > 0 ? pts[i - 1][0] : x0 - (x1 - x0);
  const yp = i > 0 ? pts[i - 1][1] : y0;
  const xn = i < n - 2 ? pts[i + 2][0] : x1 + (x1 - x0);
  const yn = i < n - 2 ? pts[i + 2][1] : y1;
  const m0 = ((y1 - yp) / (x1 - xp)) * (x1 - x0);
  const m1 = ((yn - y0) / (xn - x0)) * (x1 - x0);
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0
       + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
}

// Tube along a point path with per-t radius (TubeGeometry can't taper).
export function taperedTube(points, radiusFn, radialSegments = 14, tubularSegments = 64) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const pos = [], uv = [], idx = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPointAt(t, p);
    const r = radiusFn(t);
    const N = frames.normals[Math.min(i, tubularSegments - 1)];
    const B = frames.binormals[Math.min(i, tubularSegments - 1)];
    for (let j = 0; j <= radialSegments; j++) {
      const a = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(a), cos = Math.cos(a);
      pos.push(p.x + r * (cos * N.x + sin * B.x),
               p.y + r * (cos * N.y + sin * B.y),
               p.z + r * (cos * N.z + sin * B.z));
      uv.push(t, j / radialSegments);
    }
  }
  const ring = radialSegments + 1;
  for (let i = 0; i < tubularSegments; i++)
    for (let j = 0; j < radialSegments; j++) {
      const a = i * ring + j;
      idx.push(a, a + 1, a + ring, a + 1, a + ring + 1, a + ring);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
