import * as THREE from 'three';

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
      idx.push(a, a + ring, a + 1, a + 1, a + ring, a + ring + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
