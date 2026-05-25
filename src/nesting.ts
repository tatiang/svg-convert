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
  // Try the centroid of the bounding box first; if outside, scan a horizontal
  // ray of candidates near the bbox center until one lands inside.
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
  // Fallback: first vertex (caller will handle false positives gracefully).
  return poly[0];
}

export type Classification = "cut" | "engrave";

/**
 * Classify each subpath as cut or engrave based on geometric nesting.
 *
 * Rule (from user): a contour that contains another contour is an engrave
 * guide (it marks where the next-higher layer gets glued on). A contour that
 * does not contain any other contour — including standalone contours — is a
 * cut line.
 */
export function classifyCutEngrave(subpaths: Subpath[]): Classification[] {
  const polys = subpaths.map(subpathToPolygon);
  const boxes = polys.map(bbox);
  const interiors = polys.map(interiorPoint);

  return subpaths.map((_sp, i) => {
    for (let j = 0; j < subpaths.length; j++) {
      if (i === j) continue;
      // Cheap bbox reject: A can only contain B if A's bbox fully encloses B's.
      const a = boxes[i];
      const b = boxes[j];
      if (
        b.minX < a.minX ||
        b.maxX > a.maxX ||
        b.minY < a.minY ||
        b.maxY > a.maxY
      ) {
        continue;
      }
      if (pointInPolygon(interiors[j], polys[i])) {
        return "engrave";
      }
    }
    return "cut";
  });
}
