import { readFileSync, writeFileSync } from "node:fs";
import { DOMParser as XmlDOMParser } from "@xmldom/xmldom";

class ShimmedDOMParser extends XmlDOMParser {
  parseFromString(text: string, type: string) {
    const doc = super.parseFromString(text, type as any);
    if (!(doc as any).querySelector) (doc as any).querySelector = () => null;
    return doc;
  }
}
// @ts-expect-error
globalThis.DOMParser = ShimmedDOMParser;

const { convert } = await import("../src/converter");

const inFile = process.argv[2];
const outFile = process.argv[3] ?? "/tmp/converted.svg";
const text = readFileSync(inFile, "utf8");
const { outputSvg, stats } = convert(text);
writeFileSync(outFile, outputSvg);
console.log(stats);
console.log(`wrote ${outFile}`);
