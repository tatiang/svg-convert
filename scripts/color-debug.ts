import { readFileSync, writeFileSync } from "node:fs";
import { DOMParser as XmlDOMParser } from "@xmldom/xmldom";
import { splitSubpaths, isCanvasRect, groupByBBox } from "../src/subpaths";

const inFile = process.argv[2];
const outFile = process.argv[3] ?? "/tmp/color-debug.svg";
const text = readFileSync(inFile, "utf8");
const doc = new XmlDOMParser().parseFromString(text, "image/svg+xml");
const svg = doc.documentElement!;
const vbAttr = svg.getAttribute("viewBox") || "0 0 1448 1448";
const vb = vbAttr.split(/\s+/).map(Number);
const viewBox = { minX: vb[0], minY: vb[1], width: vb[2], height: vb[3] };

const paths = Array.from(doc.getElementsByTagName("path"));
const subs: any[] = [];
for (const p of paths) {
  const d = p.getAttribute("d") ?? "";
  for (const sp of splitSubpaths(d)) {
    if (!isCanvasRect(sp, viewBox)) subs.push(sp);
  }
}

const groups = groupByBBox(subs);
const labels = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
const colors = ["#000000", "#FF0000", "#0000FF", "#00AA00", "#FF8800", "#AA00FF", "#00AAAA", "#AA0000", "#0088AA", "#888888"];

const lines: string[] = [];
lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
lines.push(`<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="${vbAttr}">`);
groups.forEach((g, gi) => {
  const lbl = labels[gi] ?? `G${gi}`;
  const col = colors[gi] ?? "#888888";
  lines.push(`  <g id="${lbl}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke">`);
  for (const sp of g.members) {
    const raw = sp.raw.replace(/\s+/g, " ").trim();
    lines.push(`    <path d="${raw} Z"/>`);
  }
  lines.push(`  </g>`);
  // label text at bbox top-left
  lines.push(
    `  <text x="${g.bbox.minX + 10}" y="${g.bbox.minY + 30}" fill="${col}" font-size="40" font-family="sans-serif" font-weight="bold">${lbl}</text>`
  );
});
lines.push(`</svg>`);

writeFileSync(outFile, lines.join("\n"));
console.log(`Wrote ${outFile} with ${groups.length} color-coded groups:`);
groups.forEach((g, gi) => {
  console.log(
    `  ${labels[gi]}: ${colors[gi]}  bbox=(${g.bbox.minX.toFixed(0)},${g.bbox.minY.toFixed(0)} → ${g.bbox.maxX.toFixed(0)},${g.bbox.maxY.toFixed(0)})  members=${g.members.length}`
  );
});
