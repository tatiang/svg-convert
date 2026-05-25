import {
  splitSubpaths,
  canonicalKey,
  isCanvasRect,
  type Subpath,
} from "./subpaths";

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
  engraveCount: number;
};

export type ConversionResult = {
  outputSvg: string;
  stats: ConversionStats;
};

const CUT_COLOR = "#FF0000";
const ENGRAVE_COLOR = "#000000";
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

  // Count occurrences per canonical key, then dedup keeping first occurrence.
  // Subpaths appearing exactly once come only from the mask (CUT boundary).
  // Subpaths appearing 2+ times are stroked + filled duplicates (ENGRAVE guides).
  const counts = new Map<string, number>();
  for (const sp of withoutCanvas) {
    const key = canonicalKey(sp);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, Subpath>();
  for (const sp of withoutCanvas) {
    const key = canonicalKey(sp);
    if (!seen.has(key)) seen.set(key, sp);
  }
  const unique = Array.from(seen.values());
  const duplicatesRemoved = withoutCanvas.length - unique.length;

  const cut = unique.filter((sp) => (counts.get(canonicalKey(sp)) ?? 1) === 1);
  const engrave = unique.filter((sp) => (counts.get(canonicalKey(sp)) ?? 1) > 1);

  const outputSvg = emitSvg(viewBox, cut, engrave);

  return {
    outputSvg,
    stats: {
      sourcePathCount,
      sourceSubpathCount,
      maskSubpathsRemoved,
      duplicatesRemoved,
      cutCount: cut.length,
      engraveCount: engrave.length,
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
  engrave: Subpath[]
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
  if (engrave.length > 0) {
    lines.push(
      `  <g id="engrave" fill="none" stroke="${ENGRAVE_COLOR}" stroke-width="${STROKE_WIDTH}" vector-effect="non-scaling-stroke">`
    );
    for (const sp of engrave) {
      lines.push(`    <path d="${ensureClosed(sp.raw)}"/>`);
    }
    lines.push(`  </g>`);
  }
  lines.push(`</svg>`);
  return lines.join("\n");
}
