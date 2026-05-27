import { readFileSync } from "node:fs";
import { DOMParser as XmlDOMParser } from "@xmldom/xmldom";
import {
  splitSubpaths,
  isCanvasRect,
  subpathBBox,
  groupByBBox,
} from "../src/subpaths";
import { subpathToPolygon, interiorPoint, pointInPolygon } from "../src/nesting";

const file = process.argv[2];
const text = readFileSync(file, "utf8");
const doc = new XmlDOMParser().parseFromString(text, "image/svg+xml");
const svg = doc.documentElement!;
const vb = (svg.getAttribute("viewBox") || "0 0 1000 1000").split(/\s+/).map(Number);
const viewBox = { minX: vb[0], minY: vb[1], width: vb[2], height: vb[3] };

const paths = Array.from(doc.getElementsByTagName("path"));
const all: Array<{ pathIdx: number; subIdx: number; sp: any; canvas: boolean }> = [];
paths.forEach((p, pi) => {
  const d = p.getAttribute("d") ?? "";
  const subs = splitSubpaths(d);
  subs.forEach((sp, si) => {
    all.push({ pathIdx: pi, subIdx: si, sp, canvas: isCanvasRect(sp, viewBox) });
  });
});

const noCanvas = all.filter((a) => !a.canvas);
console.log(`Total subpaths: ${all.length}, after canvas removal: ${noCanvas.length}`);
console.log("\nBBoxes of each non-canvas subpath:");
for (const a of noCanvas) {
  const bb = subpathBBox(a.sp)!;
  console.log(
    `  path#${a.pathIdx} sub#${a.subIdx}: bbox=(${bb.minX.toFixed(1)},${bb.minY.toFixed(1)} → ${bb.maxX.toFixed(1)},${bb.maxY.toFixed(1)})`
  );
}

const groups = groupByBBox(noCanvas.map((a) => a.sp));
console.log(`\nGrouped into ${groups.length}:`);
const polys = groups.map((g) => subpathToPolygon(g.members[0]));
const interiors = polys.map((p) => interiorPoint(p));
groups.forEach((g, gi) => {
  console.log(
    `  group#${gi}: ${g.members.length} member(s), bbox=(${g.bbox.minX.toFixed(1)},${g.bbox.minY.toFixed(1)} → ${g.bbox.maxX.toFixed(1)},${g.bbox.maxY.toFixed(1)}), interior≈(${interiors[gi][0].toFixed(0)},${interiors[gi][1].toFixed(0)})`
  );
});

console.log("\nNesting (rows = container, cols = whose interior is inside?):");
const header = "      " + groups.map((_, i) => `g${i}`).join("  ");
console.log(header);
for (let i = 0; i < groups.length; i++) {
  const row = groups.map((_, j) => {
    if (i === j) return " · ";
    return pointInPolygon(interiors[j], polys[i]) ? " ✓ " : "   ";
  });
  console.log(`  g${i}: ` + row.join(" "));
}
