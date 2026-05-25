import { convert, type ConversionStats } from "./converter";

const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const dropzone = document.getElementById("dropzone") as HTMLElement;
const sourcePreview = document.getElementById("sourcePreview") as HTMLElement;
const convertedPreview = document.getElementById(
  "convertedPreview"
) as HTMLElement;
const statsEl = document.getElementById("stats") as HTMLElement;
const downloadBtn = document.getElementById("downloadBtn") as HTMLButtonElement;

let lastOutput: { svg: string; name: string } | null = null;

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) handleFile(f);
});

["dragenter", "dragover"].forEach((ev) => {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((ev) => {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });
});
dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) handleFile(f);
});

downloadBtn.addEventListener("click", () => {
  if (!lastOutput) return;
  const blob = new Blob([lastOutput.svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = lastOutput.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

async function handleFile(file: File) {
  const text = await file.text();
  sourcePreview.innerHTML = sanitizeForPreview(text);
  try {
    const { outputSvg, stats } = convert(text);
    convertedPreview.innerHTML = sanitizeForPreview(outputSvg);
    statsEl.hidden = false;
    statsEl.textContent = formatStats(stats);
    const baseName = file.name.replace(/\.svg$/i, "");
    lastOutput = { svg: outputSvg, name: `${baseName}_xtool.svg` };
    downloadBtn.disabled = false;
  } catch (err) {
    convertedPreview.innerHTML = "";
    statsEl.hidden = false;
    statsEl.textContent = "Error: " + (err as Error).message;
    lastOutput = null;
    downloadBtn.disabled = true;
  }
}

function formatStats(s: ConversionStats): string {
  return (
    `Source: ${s.sourcePathCount} paths / ${s.sourceSubpathCount} sub-paths → ` +
    `Converted: ${s.cutCount} cut + ${s.engraveCount} engrave ` +
    `(${s.duplicatesRemoved} duplicate${s.duplicatesRemoved === 1 ? "" : "s"} removed, ` +
    `${s.maskSubpathsRemoved} mask sub-path${s.maskSubpathsRemoved === 1 ? "" : "s"} removed)`
  );
}

// Strip <script> elements before injecting an SVG into the DOM. Source files
// come from the user's disk, but defense in depth is cheap.
function sanitizeForPreview(svgText: string): string {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  if (doc.querySelector("parsererror")) return "";
  doc.querySelectorAll("script").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  });
  return new XMLSerializer().serializeToString(doc.documentElement);
}
