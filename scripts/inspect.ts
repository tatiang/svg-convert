import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DOMParser as XmlDOMParser } from "@xmldom/xmldom";

// xmldom doesn't implement querySelector; converter only uses it to detect
// <parsererror>, which xmldom doesn't emit anyway. Shim it as a no-op.
class ShimmedDOMParser extends XmlDOMParser {
  parseFromString(text: string, type: string) {
    const doc = super.parseFromString(text, type as any);
    if (!(doc as any).querySelector) {
      (doc as any).querySelector = () => null;
    }
    return doc;
  }
}
// @ts-expect-error – inject a DOMParser into the global scope for converter.ts
globalThis.DOMParser = ShimmedDOMParser;

const { convert } = await import("../src/converter");

const dir = process.argv[2] ?? "samples";
const files = readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith(".svg"))
  .sort((a, b) => {
    const na = parseInt(a.match(/(\d+)/)?.[1] ?? "0", 10);
    const nb = parseInt(b.match(/(\d+)/)?.[1] ?? "0", 10);
    return na - nb;
  });

console.log(
  "file".padEnd(20),
  "srcPaths".padStart(9),
  "srcSubs".padStart(8),
  "mask".padStart(5),
  "dupes".padStart(6),
  "cut".padStart(5),
  "score".padStart(6)
);
console.log("-".repeat(70));

let totalCut = 0;
let totalScore = 0;
for (const f of files) {
  const text = readFileSync(join(dir, f), "utf8");
  try {
    const { stats } = convert(text);
    totalCut += stats.cutCount;
    totalScore += stats.scoreCount;
    console.log(
      f.padEnd(20),
      String(stats.sourcePathCount).padStart(9),
      String(stats.sourceSubpathCount).padStart(8),
      String(stats.maskSubpathsRemoved).padStart(5),
      String(stats.duplicatesRemoved).padStart(6),
      String(stats.cutCount).padStart(5),
      String(stats.scoreCount).padStart(6)
    );
  } catch (e) {
    console.log(f.padEnd(20), "ERROR:", (e as Error).message);
  }
}
console.log("-".repeat(70));
console.log("totals".padEnd(20), " ".repeat(35), String(totalCut).padStart(5), String(totalScore).padStart(6));
