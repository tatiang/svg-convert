import JSZip from "jszip";
import { convert, type ConversionStats } from "./converter";

// ── Build date stamp ───────────────────────────────────────────────────────
const buildDateEl = document.getElementById("buildDate");
if (buildDateEl) {
  const d = new Date(__BUILD_DATE__);
  const date = d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  });
  buildDateEl.textContent = `Built ${date} at ${time}`;
}

// ── Types ──────────────────────────────────────────────────────────────────
type Status = "pending" | "processing" | "done" | "error";

interface Entry {
  id: string;
  file: File;
  outputName: string;
  status: Status;
  processedAt: Date;
  rawText?: string;
  svg?: string;
  stats?: ConversionStats;
  error?: string;
}

// ── State ──────────────────────────────────────────────────────────────────
const entries: Entry[] = [];

// ── DOM refs ───────────────────────────────────────────────────────────────
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const dropzone = document.getElementById("dropzone") as HTMLElement;
const resultsSection = document.getElementById(
  "resultsSection"
) as HTMLElement;
const resultsToggle = document.getElementById(
  "resultsToggle"
) as HTMLButtonElement;
const resultsCount = document.getElementById("resultsCount") as HTMLElement;
const resultsList = document.getElementById("resultsList") as HTMLElement;
const downloadAllBtn = document.getElementById(
  "downloadAllBtn"
) as HTMLButtonElement;
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement;
const previewSection = document.getElementById(
  "previewSection"
) as HTMLElement;
const previewLabel = document.getElementById("previewLabel") as HTMLElement;
const sourcePreview = document.getElementById("sourcePreview") as HTMLElement;
const convertedPreview = document.getElementById(
  "convertedPreview"
) as HTMLElement;

// ── File input / drag-drop ─────────────────────────────────────────────────
fileInput.addEventListener("change", () => {
  if (fileInput.files?.length) handleFiles(fileInput.files);
});

["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);
dropzone.addEventListener("drop", (e) => {
  const files = (e as DragEvent).dataTransfer?.files;
  if (files?.length) handleFiles(files);
});

// ── Collapsible toggle ─────────────────────────────────────────────────────
resultsToggle.addEventListener("click", () => {
  const expanded = resultsToggle.getAttribute("aria-expanded") === "true";
  resultsToggle.setAttribute("aria-expanded", String(!expanded));
  resultsList.hidden = expanded;
  const icon = resultsToggle.querySelector(".toggle-icon") as HTMLElement;
  icon.textContent = expanded ? "▶" : "▼";
});

// ── Clear ──────────────────────────────────────────────────────────────────
clearBtn.addEventListener("click", () => {
  entries.length = 0;
  resultsList.innerHTML = "";
  resultsSection.hidden = true;
  previewSection.hidden = true;
  downloadAllBtn.disabled = true;
  fileInput.value = "";
});

// ── Download All ZIP ───────────────────────────────────────────────────────
downloadAllBtn.addEventListener("click", async () => {
  const done = entries.filter((e) => e.status === "done" && e.svg);
  if (done.length === 0) return;
  if (done.length === 1) {
    triggerDownload(done[0].svg!, done[0].outputName);
    return;
  }
  const zip = new JSZip();
  for (const entry of done) zip.file(entry.outputName, entry.svg!);
  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, "converted_svgs.zip");
});

// ── Batch processing ───────────────────────────────────────────────────────
async function handleFiles(files: FileList) {
  const svgFiles = Array.from(files).filter(
    (f) => f.name.toLowerCase().endsWith(".svg") || f.type === "image/svg+xml"
  );
  if (svgFiles.length === 0) return;

  // Create entry objects and append pending rows immediately so the user
  // can see all queued files before processing starts.
  const batch: Entry[] = svgFiles.map((file) => ({
    id: crypto.randomUUID(),
    file,
    outputName: buildOutputName(file.name),
    status: "pending" as Status,
    processedAt: new Date(),
  }));

  entries.push(...batch);
  resultsSection.hidden = false;
  // Keep list expanded when new files arrive.
  resultsToggle.setAttribute("aria-expanded", "true");
  resultsList.hidden = false;
  (resultsToggle.querySelector(".toggle-icon") as HTMLElement).textContent =
    "▼";

  for (const entry of batch) appendRow(entry);
  updateHeader();

  // Process sequentially so rows update in order.
  for (const entry of batch) {
    await processEntry(entry);
  }
}

async function processEntry(entry: Entry) {
  setRowStatus(entry, "processing");
  try {
    const text = await entry.file.text();
    entry.rawText = text;
    const { outputSvg, stats } = convert(text);
    entry.svg = outputSvg;
    entry.stats = stats;
    entry.processedAt = new Date();
    setRowStatus(entry, "done");
  } catch (err) {
    entry.error = (err as Error).message;
    setRowStatus(entry, "error");
  }
  updateHeader();
}

// ── Row rendering ──────────────────────────────────────────────────────────
function appendRow(entry: Entry) {
  const row = document.createElement("div");
  row.className = "result-row result-pending";
  row.dataset.id = entry.id;
  row.innerHTML = `
    <span class="row-icon">⏳</span>
    <span class="row-name" title="${entry.file.name}">${entry.file.name}</span>
    <span class="row-meta">Queued</span>
    <span class="row-time"></span>
    <span class="row-buttons"></span>
  `;
  resultsList.appendChild(row);
}

function setRowStatus(entry: Entry, status: Status) {
  entry.status = status;
  const row = resultsList.querySelector<HTMLElement>(
    `[data-id="${entry.id}"]`
  );
  if (!row) return;

  row.className = `result-row result-${status}`;
  const icon = row.querySelector<HTMLElement>(".row-icon")!;
  const meta = row.querySelector<HTMLElement>(".row-meta")!;
  const time = row.querySelector<HTMLElement>(".row-time")!;
  const buttons = row.querySelector<HTMLElement>(".row-buttons")!;

  if (status === "processing") {
    icon.textContent = "⏳";
    meta.textContent = "Processing…";
  } else if (status === "done" && entry.stats) {
    const s = entry.stats;
    icon.textContent = "✅";
    meta.textContent = `${s.cutCount} cut · ${s.scoreCount} score · ${s.duplicatesRemoved} dupes removed`;
    time.textContent = entry.processedAt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Los_Angeles",
    });

    const dlBtn = makeButton("Download", "btn-sm", () =>
      triggerDownload(entry.svg!, entry.outputName)
    );
    const pvBtn = makeButton("Preview", "btn-sm btn-ghost", () =>
      showPreview(entry)
    );
    buttons.innerHTML = "";
    buttons.append(pvBtn, dlBtn);
  } else if (status === "error") {
    icon.textContent = "❌";
    meta.textContent = `Error: ${entry.error}`;
  }
}

function makeButton(
  label: string,
  cls: string,
  onClick: () => void
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = cls;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

// ── Header count + Download All label ─────────────────────────────────────
function updateHeader() {
  const total = entries.length;
  const done = entries.filter((e) => e.status === "done").length;
  const processing = entries.filter((e) => e.status === "processing").length;

  resultsCount.textContent =
    processing > 0
      ? `${done} / ${total} done`
      : `${total} file${total === 1 ? "" : "s"}`;

  const doneEntries = entries.filter((e) => e.status === "done");
  downloadAllBtn.disabled = doneEntries.length === 0;
  downloadAllBtn.textContent =
    doneEntries.length > 1
      ? `Download All ${doneEntries.length} (ZIP)`
      : doneEntries.length === 1
        ? "Download (SVG)"
        : "Download All (ZIP)";
}

// ── Preview ────────────────────────────────────────────────────────────────
function showPreview(entry: Entry) {
  if (!entry.svg || !entry.rawText) return;
  previewLabel.textContent = entry.file.name;
  sourcePreview.innerHTML = sanitizeForPreview(entry.rawText);
  convertedPreview.innerHTML = sanitizeForPreview(entry.svg);
  previewSection.hidden = false;
  previewSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function triggerDownload(data: string | Blob, filename: string) {
  const blob =
    data instanceof Blob ? data : new Blob([data], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// "CC layer 2.svg" → "Cataract_Canyon_052626_2.svg" (today's date, MMDDYY).
// If the input has no trailing number, falls back to the original "_xtool" suffix.
function buildOutputName(inputName: string): string {
  const stem = inputName.replace(/\.svg$/i, "");
  const match = stem.match(/(\d+)\s*$/);
  if (!match) return `${stem}_xtool.svg`;
  const n = match[1];
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  return `Cataract_Canyon_${mm}${dd}${yy}_${n}.svg`;
}

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
