// Dump every distinct subpath bbox in the file with no merging at all
import { readFileSync } from "node:fs";
import { DOMParser as XmlDOMParser } from "@xmldom/xmldom";
import { splitSubpaths, isCanvasRect, subpathBBox } from "../src/subpaths";

const file = process.argv[2];
const text = readFileSync(file, "utf8");
const doc = new XmlDOMParser().parseFromString(text, "image/svg+xml");
const svg = doc.documentElement!;
const vb = (svg.getAttribute("viewBox") || "0 0 1448 1448").split(/\s+/).map(Number);
const viewBox = { minX: vb[0], minY: vb[1], width: vb[2], height: vb[3] };
const paths = Array.from(doc.getElementsByTagName("path"));
paths.forEach((p, pi) => {
  const stroke = p.getAttribute("stroke") ?? "(none)";
  const fill = p.getAttribute("fill") ?? "(none)";
  const subs = splitSubpaths(p.getAttribute("d") ?? "");
  subs.forEach((sp, si) => {
    const bb = subpathBBox(sp)!;
    const canvas = isCanvasRect(sp, viewBox);
    const w = (bb.maxX - bb.minX).toFixed(0);
    const h = (bb.maxY - bb.minY).toFixed(0);
    console.log(
      `path#${pi}  sub#${si}  stroke=${stroke.padEnd(8)}  fill=${fill.padEnd(8)}  bbox=(${bb.minX.toFixed(0)},${bb.minY.toFixed(0)})+(${w}x${h})  canvas=${canvas}`
    );
  });
});
