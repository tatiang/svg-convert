import {
  splitSubpaths,
  groupByBBox,
  subpathBBox,
  isCanvasRect,
  type Subpath,
} from "./subpaths";
import {
  subpathToPolygon,
  interiorPoint,
  pointInPolygon,
} from "./nesting";

export type ViewBox = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

export type ConversionStats = {
  sourcePathCount: number;
  sourceSubpathCount: number;
  maskSubpathsRemoved: number;
  duplicatesRemoved: number;
  cutCount: number;
  scoreCount: number;
};

export type ConversionResult = {
  outputSvg: string;
  stats: ConversionStats;
};

const CUT_COLOR = "#FF0000";
const SCORE_COLOR = "#0000FF";
const STROKE_WIDTH = "0.1";

export function convert(sourceSvgText: string): ConversionResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(sourceSvgText, "image/svg+xml");

  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("Failed to parse SVG: " + parserError.textContent);
  }

  const svgEl = doc.documentElement;
  if (svgEl.nodeName.toLowerCase() !== "svg") {
    throw new Error("Root element is not <svg>");
  }

  const viewBox = readViewBox(svgEl);

  const pathEls = Array.from(doc.getElementsByTagName("path"));
  const sourcePathCount = pathEls.length;

  let sourceSubpathCount = 0;
  let maskSubpathsRemoved = 0;
  const withoutCanvas: Subpath[] = [];
  for (const p of pathEls) {
    const d = p.getAttribute("d");
    if (!d) continue;
    const subs = splitSubpaths(d);
    sourceSubpathCount += subs.length;
    for (const sp of subs) {
      if (isCanvasRect(sp, viewBox)) {
        maskSubpathsRemoved++;
        continue;
      }
      withoutCanvas.push(sp);
    }
  }

  // Cluster subpaths by bbox proximity — each unique contour is emitted by
  // Laser Map Maker as a stroke, a mask hole, and/or a positive fill with
  // small per-vertex differences. groupByBBox collapses those variants.
  //
  // Two categories of subpaths are dropped before grouping:
  //
  // 1. Near-full-canvas polygons: the inverse-fill mask path also contains a
  //    single large polygon that stitches all the real contours into one even-odd
  //    fill by routing along canvas edges. Its bbox spans ≥95% of the canvas in
  //    both dimensions. When stroked this polygon reproduces the scored contours
  //    plus unwanted canvas-edge seam lines, so it is always dropped.
  //
  // 2. Degenerate (zero-area) paths: canvas-edge seam connectors appear as
  //    separate <path> elements with zero or near-zero height or width. Drop any
  //    subpath whose shorter bbox dimension is less than 5 units.
  const canvasW = viewBox.width;
  const canvasH = viewBox.height;
  const realSubpaths = withoutCanvas.filter((sp) => {
    const bb = subpathBBox(sp);
    if (!bb) return false;
    const w = bb.maxX - bb.minX;
    const h = bb.maxY - bb.minY;
    // Drop degenerate (seam-connector) paths
    if (Math.min(w, h) < 5) return false;
    // Drop near-full-canvas stitching polygon
    if (w / canvasW > 0.95 && h / canvasH > 0.95) return false;
    return true;
  });
  const artifactsRemoved = withoutCanvas.length - realSubpaths.length;

  const groups = groupByBBox(realSubpaths);
  const unique = groups.map((g) => g.members[0]);
  const duplicatesRemoved = realSubpaths.length - unique.length + artifactsRemoved;

  // All real contours (group size ≥ 2: appeared as both stroke and fill variants)
  // become SCORE guides. Contours that appear only once are checked for nesting
  // and default to CUT if standalone.
  //
  // Additionally, every SCORE contour that is not itself nested inside a larger
  // SCORE contour also gets a CUT copy — the physical piece boundary that the
  // laser needs to cut through. Inner SCORE contours (nested inside an outer one)
  // are guides only and are not cut.
  const scoreGroups = groups.filter((g) => g.members.length > 1);
  const onceGroups  = groups.filter((g) => g.members.length === 1);

  const scoreReps = scoreGroups.map((g) => g.members[0]);
  const onceReps  = onceGroups.map((g)  => g.members[0]);

  const scorePolys    = scoreReps.map((sp) => subpathToPolygon(sp));
  const scoreInteriors = scorePolys.map((p)  => interiorPoint(p));
  const oncePolys     = onceReps.map((sp)  => subpathToPolygon(sp));
  const onceInteriors = oncePolys.map((p)   => interiorPoint(p));

  const score: Subpath[] = [...scoreReps];
  const cut: Subpath[]   = [];

  // Score paths that are NOT nested inside another score path also go to cut —
  // those are the outermost piece boundaries at this layer level.
  for (let i = 0; i < scoreReps.length; i++) {
    const insideAnotherScore = scoreInteriors.some((_, j) => {
      if (j === i) return false;
      return pointInPolygon(scoreInteriors[i], scorePolys[j]);
    });
    if (!insideAnotherScore) {
      cut.push(scoreReps[i]);
    }
  }

  // Count=1 paths: use nesting to decide.
  for (let i = 0; i < onceReps.length; i++) {
    const interior = onceInteriors[i];

    const insideScore = scorePolys.some((ep) => pointInPolygon(interior, ep));
    if (insideScore) { cut.push(onceReps[i]); continue; }

    const insideOther = oncePolys.some((op, j) => {
      if (j === i) return false;
      return pointInPolygon(interior, op);
    });
    if (insideOther) { cut.push(onceReps[i]); continue; }

    const containsOther = onceInteriors.some((pt, j) => {
      if (j === i) return false;
      return pointInPolygon(pt, oncePolys[i]);
    });
    if (containsOther) { score.push(onceReps[i]); continue; }

    cut.push(onceReps[i]);
  }

  const outputSvg = emitSvg(viewBox, cut, score);

  return {
    outputSvg,
    stats: {
      sourcePathCount,
      sourceSubpathCount,
      maskSubpathsRemoved,
      duplicatesRemoved,
      cutCount: cut.length,
      scoreCount: score.length,
    },
  };
}

function readViewBox(svgEl: Element): ViewBox {
  const vb = svgEl.getAttribute("viewBox");
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return {
        minX: parts[0],
        minY: parts[1],
        width: parts[2],
        height: parts[3],
      };
    }
  }
  const w = parseFloat(svgEl.getAttribute("width") || "0");
  const h = parseFloat(svgEl.getAttribute("height") || "0");
  return { minX: 0, minY: 0, width: w || 1000, height: h || 1000 };
}

// Ensure path data ends with Z so the laser closes the loop. Without it
// the stroked contours (which in the source don't include Z) leave a tiny
// uncut gap at the start point.
function ensureClosed(d: string): string {
  return /[Zz]\s*$/.test(d) ? d : `${d.trimEnd()} Z`;
}

function emitSvg(
  viewBox: ViewBox,
  cut: Subpath[],
  score: Subpath[]
): string {
  const vb = `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`;
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="${vb}">`
  );
  if (cut.length > 0) {
    lines.push(
      `  <g id="cut" fill="none" stroke="${CUT_COLOR}" stroke-width="${STROKE_WIDTH}" vector-effect="non-scaling-stroke">`
    );
    for (const sp of cut) {
      lines.push(`    <path d="${ensureClosed(sp.raw)}"/>`);
    }
    lines.push(`  </g>`);
  }
  if (score.length > 0) {
    lines.push(
      `  <g id="score" fill="none" stroke="${SCORE_COLOR}" stroke-width="${STROKE_WIDTH}" vector-effect="non-scaling-stroke">`
    );
    for (const sp of score) {
      lines.push(`    <path d="${ensureClosed(sp.raw)}"/>`);
    }
    lines.push(`  </g>`);
  }
  lines.push(`</svg>`);
  return lines.join("\n");
}
