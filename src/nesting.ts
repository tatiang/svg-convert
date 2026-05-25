import { endpointSequence, type Subpath } from "./subpaths";

export type Polygon = Array<[number, number]>;
export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

export function subpathToPolygon(sp: Subpath): Polygon {
  return endpointSequence(sp.commands);
}

export function bbox(poly: Polygon): BBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Ray-casting point-in-polygon. */
export function pointInPolygon(
  point: [number, number],
  poly: Polygon
): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Returns a point that is guaranteed to lie strictly inside the polygon. */
export function interiorPoint(poly: Polygon): [number, number] {
  const b = bbox(poly);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  if (pointInPolygon([cx, cy], poly)) return [cx, cy];
  const w = b.maxX - b.minX;
  for (let i = 1; i < 20; i++) {
    const f = i / 20;
    const cand: [number, number] = [b.minX + f * w, cy];
    if (pointInPolygon(cand, poly)) return cand;
  }
  return poly[0];
}
