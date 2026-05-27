// SVG path-`d` manipulation, kept at the string level — no need to convert curves
// to absolute points for the dedup we're doing. Each closed contour is one subpath.

export type Subpath = {
  /** Original `d` substring for this subpath, beginning with `M`/`m`. */
  raw: string;
  /** Parsed commands (letter + numeric args). Endpoints used for polygon approximation. */
  commands: Command[];
};

export type Command = {
  cmd: string;
  args: number[];
};

const COMMAND_RE = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
const NUMBER_RE = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;

export function parseCommands(d: string): Command[] {
  const out: Command[] = [];
  let m: RegExpExecArray | null;
  COMMAND_RE.lastIndex = 0;
  while ((m = COMMAND_RE.exec(d)) !== null) {
    const cmd = m[1];
    const argsStr = m[2];
    const args = (argsStr.match(NUMBER_RE) || []).map(Number);
    out.push({ cmd, args });
  }
  return out;
}

/** Split a path `d` into subpaths at each M/m. */
export function splitSubpaths(d: string): Subpath[] {
  const commands = parseCommands(d);
  const subpaths: Subpath[] = [];
  let current: Command[] | null = null;
  for (const c of commands) {
    if (c.cmd === "M" || c.cmd === "m") {
      if (current && current.length > 0) {
        subpaths.push(materialize(current));
      }
      current = [c];
    } else {
      if (!current) current = [];
      current.push(c);
    }
  }
  if (current && current.length > 0) {
    subpaths.push(materialize(current));
  }
  return subpaths;
}

function materialize(commands: Command[]): Subpath {
  return { commands, raw: stringify(commands) };
}

export function stringify(commands: Command[]): string {
  return commands
    .map((c) => {
      if (c.args.length === 0) return c.cmd;
      return c.cmd + " " + c.args.map(formatNum).join(" ");
    })
    .join(" ");
}

function formatNum(n: number): string {
  // round to 2 decimals, drop trailing zeros / unnecessary dot
  const r = Math.round(n * 100) / 100;
  let s = r.toFixed(2);
  s = s.replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

/**
 * Bounding box of the subpath's endpoint sequence.
 */
export function subpathBBox(sp: Subpath): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  const pts = endpointSequence(sp.commands);
  if (pts.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Group subpaths by bbox proximity. Laser Map Maker emits each contour as a
 * stroke, an inverse-fill mask hole, and a positive fill — with slightly
 * different start points, winding, rounding, and (for the fill) ~2× the
 * endpoint count from polygon densification. None of those rewrites move the
 * bbox by more than a few units, so bbox match within `tol` is a reliable
 * dedup signal. Returns one group per unique contour; group sizes ≥ 2 are
 * the stroked+filled duplicates the README calls SCORE guides.
 */
export function groupByBBox(
  subpaths: Subpath[],
  tol = 15
): Array<{ members: Subpath[]; bbox: NonNullable<ReturnType<typeof subpathBBox>> }> {
  const groups: Array<{
    members: Subpath[];
    bbox: NonNullable<ReturnType<typeof subpathBBox>>;
  }> = [];
  for (const sp of subpaths) {
    const bb = subpathBBox(sp);
    if (!bb) continue;
    const match = groups.find(
      (g) =>
        Math.abs(g.bbox.minX - bb.minX) <= tol &&
        Math.abs(g.bbox.minY - bb.minY) <= tol &&
        Math.abs(g.bbox.maxX - bb.maxX) <= tol &&
        Math.abs(g.bbox.maxY - bb.maxY) <= tol
    );
    if (match) {
      match.members.push(sp);
    } else {
      groups.push({ members: [sp], bbox: bb });
    }
  }
  return groups;
}

/** Compute absolute endpoint (x,y) after each drawing command. Skips Z. */
export function endpointSequence(commands: Command[]): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  for (const c of commands) {
    const abs = c.cmd === c.cmd.toUpperCase();
    const a = c.args;
    switch (c.cmd.toUpperCase()) {
      case "M": {
        // M takes (x,y) pairs; first pair is moveto, subsequent are implicit L.
        for (let i = 0; i < a.length; i += 2) {
          const nx = abs ? a[i] : x + a[i];
          const ny = abs ? a[i + 1] : y + a[i + 1];
          x = nx;
          y = ny;
          if (i === 0) {
            startX = x;
            startY = y;
          }
          points.push([x, y]);
        }
        break;
      }
      case "L": {
        for (let i = 0; i < a.length; i += 2) {
          x = abs ? a[i] : x + a[i];
          y = abs ? a[i + 1] : y + a[i + 1];
          points.push([x, y]);
        }
        break;
      }
      case "H": {
        for (let i = 0; i < a.length; i++) {
          x = abs ? a[i] : x + a[i];
          points.push([x, y]);
        }
        break;
      }
      case "V": {
        for (let i = 0; i < a.length; i++) {
          y = abs ? a[i] : y + a[i];
          points.push([x, y]);
        }
        break;
      }
      case "C": {
        // 6 args per segment; endpoint is last 2.
        for (let i = 0; i < a.length; i += 6) {
          x = abs ? a[i + 4] : x + a[i + 4];
          y = abs ? a[i + 5] : y + a[i + 5];
          points.push([x, y]);
        }
        break;
      }
      case "S": {
        // 4 args; endpoint is last 2.
        for (let i = 0; i < a.length; i += 4) {
          x = abs ? a[i + 2] : x + a[i + 2];
          y = abs ? a[i + 3] : y + a[i + 3];
          points.push([x, y]);
        }
        break;
      }
      case "Q": {
        for (let i = 0; i < a.length; i += 4) {
          x = abs ? a[i + 2] : x + a[i + 2];
          y = abs ? a[i + 3] : y + a[i + 3];
          points.push([x, y]);
        }
        break;
      }
      case "T": {
        for (let i = 0; i < a.length; i += 2) {
          x = abs ? a[i] : x + a[i];
          y = abs ? a[i + 1] : y + a[i + 1];
          points.push([x, y]);
        }
        break;
      }
      case "A": {
        // 7 args; endpoint is last 2.
        for (let i = 0; i < a.length; i += 7) {
          x = abs ? a[i + 5] : x + a[i + 5];
          y = abs ? a[i + 6] : y + a[i + 6];
          points.push([x, y]);
        }
        break;
      }
      case "Z": {
        x = startX;
        y = startY;
        break;
      }
    }
  }
  return points;
}

/** Does this subpath trace the four corners of `viewBox` (in any order/direction)? */
export function isCanvasRect(
  sp: Subpath,
  viewBox: { minX: number; minY: number; width: number; height: number },
  tol = 0.5
): boolean {
  const pts = endpointSequence(sp.commands);
  if (pts.length < 4 || pts.length > 6) return false; // 4 corners; +0/1/2 for repeats/close
  const maxX = viewBox.minX + viewBox.width;
  const maxY = viewBox.minY + viewBox.height;
  const corners: Array<[number, number]> = [
    [viewBox.minX, viewBox.minY],
    [viewBox.minX, maxY],
    [maxX, viewBox.minY],
    [maxX, maxY],
  ];
  for (const p of pts) {
    const onCorner = corners.some(
      (c) => Math.abs(p[0] - c[0]) <= tol && Math.abs(p[1] - c[1]) <= tol
    );
    if (!onCorner) return false;
  }
  // and we should have hit all four corners
  for (const c of corners) {
    const hit = pts.some(
      (p) => Math.abs(p[0] - c[0]) <= tol && Math.abs(p[1] - c[1]) <= tol
    );
    if (!hit) return false;
  }
  return true;
}
