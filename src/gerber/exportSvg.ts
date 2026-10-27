import * as ClipperLib from 'clipper-lib';
import type { ImageGraphic, ImageTree, PathSegment, SimpleShape } from '@tracespace/plotter';
import type { Design } from '../model';
import { placeMergedPaste } from './exportGerber';
import { shapeToBoundarySegments } from './shapeSegments';
import { splitIntoLoops } from './write';
import { isEmptyBox } from './bbox';

/** Clipper works on integers; 1e4 units per mm = 0.1 micron resolution. */
const CLIPPER_SCALE = 10_000;
/** Max distance between a flattened arc's chord and the true arc, in mm. */
const ARC_TOLERANCE_MM = 0.002;

type Pt = [number, number];
type Poly = Pt[];

export interface SvgExportResult {
  text: string;
  warnings: string[];
  padCount: number;
}

// ---- Geometry -> polygons (world mm, Y-up) ----

function flattenArc(seg: Extract<PathSegment, { type: 'arc' }>): Pt[] {
  const r = seg.radius;
  const sweep = seg.end[2] - seg.start[2];
  const step = r > ARC_TOLERANCE_MM ? 2 * Math.acos(1 - ARC_TOLERANCE_MM / r) : Math.PI / 2;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / step));
  const pts: Pt[] = [];
  for (let i = 1; i < n; i++) {
    const t = seg.start[2] + (sweep * i) / n;
    pts.push([seg.center[0] + r * Math.cos(t), seg.center[1] + r * Math.sin(t)]);
  }
  pts.push([seg.end[0], seg.end[1]]);
  return pts;
}

/** A continuous run of segments as a polyline (closed loops simply repeat their first point at the end). */
function runToPoints(run: PathSegment[]): Poly {
  const first = run[0]!;
  const pts: Poly = [[first.start[0], first.start[1]]];
  for (const seg of run) {
    if (seg.type === 'line') pts.push([seg.end[0], seg.end[1]]);
    else pts.push(...flattenArc(seg));
  }
  return pts;
}

function segmentsToPolys(segments: PathSegment[]): Poly[] {
  return splitIntoLoops(segments)
    .filter((l) => l.length > 0)
    .map((loop) => {
      const pts = runToPoints(loop);
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      if (pts.length > 1 && a[0] === b[0] && a[1] === b[1]) pts.pop();
      return pts;
    })
    .filter((p) => p.length >= 3);
}

function simpleShapeToPolys(shape: SimpleShape): Poly[] {
  return segmentsToPolys(shapeToBoundarySegments(shape));
}

// ---- Clipper helpers ----

function toClipper(polys: Poly[]): ClipperLib.Paths {
  return polys.map((p) => p.map(([x, y]) => ({ X: Math.round(x * CLIPPER_SCALE), Y: Math.round(y * CLIPPER_SCALE) })));
}

function fromClipper(paths: ClipperLib.Paths): Poly[] {
  return paths.map((p) => p.map((pt): Pt => [pt.X / CLIPPER_SCALE, pt.Y / CLIPPER_SCALE]));
}

function execute(clipType: number, subject: ClipperLib.Paths, clip: ClipperLib.Paths, fill: number): ClipperLib.Paths {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  if (clip.length > 0) c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const out: ClipperLib.Paths = [];
  c.Execute(clipType, out, fill, fill);
  return out;
}

/** Resolves holes/orientation of one shape's loops (even-odd) into a clean, consistently oriented set. */
function normalize(polys: Poly[]): ClipperLib.Paths {
  return execute(ClipperLib.ClipType.ctUnion, toClipper(polys), [], ClipperLib.PolyFillType.pftEvenOdd);
}

function offset(paths: ClipperLib.Paths, deltaMm: number, closed: boolean): ClipperLib.Paths {
  if (deltaMm === 0 && closed) return paths;
  const co = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE_MM * CLIPPER_SCALE);
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, closed ? ClipperLib.EndType.etClosedPolygon : ClipperLib.EndType.etOpenRound);
  const out: ClipperLib.Paths = [];
  co.Execute(out, deltaMm * CLIPPER_SCALE);
  return out;
}

// ---- Output ----

type Primitive =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rx?: number }
  | { kind: 'poly'; polys: Poly[] };

/** Turns one graphic into zero or more cut outlines, shrunk by `k` (half the kerf). Empty result = pad vanished. */
function graphicToPrimitives(g: ImageGraphic, k: number): Primitive[] {
  if (g.type === 'imageShape') {
    const shape = g.shape;
    if (shape.type === 'circle') {
      const r = shape.r - k;
      return r > 0 ? [{ kind: 'circle', cx: shape.cx, cy: shape.cy, r }] : [];
    }
    if (shape.type === 'rectangle') {
      const w = shape.xSize - 2 * k;
      const h = shape.ySize - 2 * k;
      if (w <= 0 || h <= 0) return [];
      const rect: Primitive = { kind: 'rect', x: shape.x + k, y: shape.y + k, w, h };
      if (shape.r !== undefined) rect.rx = Math.max(0, shape.r - k);
      return [rect];
    }
    if (shape.type === 'layeredShape') {
      let acc: ClipperLib.Paths = [];
      for (const s of shape.shapes) {
        const paths = normalize(simpleShapeToPolys(s));
        acc = execute(
          s.erase ? ClipperLib.ClipType.ctDifference : ClipperLib.ClipType.ctUnion,
          acc,
          paths,
          ClipperLib.PolyFillType.pftNonZero,
        );
      }
      return polyPrimitive(offset(acc, -k, true));
    }
    return polyPrimitive(offset(normalize(simpleShapeToPolys(shape)), -k, true));
  }

  if (g.type === 'imageRegion') {
    return polyPrimitive(offset(normalize(segmentsToPolys(g.segments)), -k, true));
  }

  // Stroked path: grow the centerline by half its width (minus kerf) into a closed outline.
  const half = g.width / 2 - k;
  if (half <= 0) return [];
  const runs = splitIntoLoops(g.segments)
    .filter((r) => r.length > 0)
    .map(runToPoints)
    .filter((p) => p.length >= 2);
  return polyPrimitive(offset(toClipper(runs), half, false));
}

function polyPrimitive(paths: ClipperLib.Paths): Primitive[] {
  const polys = fromClipper(paths).filter((p) => p.length >= 3);
  return polys.length > 0 ? [{ kind: 'poly', polys }] : [];
}

const n4 = (v: number): string => String(Math.round(v * 1e4) / 1e4);

/** Renders merged world-space graphics (mm, Y-up) as a true-scale SVG of cut outlines. */
export function writeLaserSvg(image: ImageTree, kerfMm: number): { text: string; skipped: number } {
  const k = Math.max(0, kerfMm) / 2;
  const size = image.size;
  const [minX, minY, maxX, maxY] = isEmptyBox(size) ? [0, 0, 1, 1] : size;
  const width = maxX - minX;
  const height = maxY - minY;
  const X = (x: number): string => n4(x - minX);
  const Y = (y: number): string => n4(maxY - y);

  let skipped = 0;
  const body: string[] = [];
  for (const g of image.children) {
    const prims = graphicToPrimitives(g, k);
    if (prims.length === 0) skipped++;
    for (const p of prims) {
      if (p.kind === 'circle') {
        body.push(`<circle cx="${X(p.cx)}" cy="${Y(p.cy)}" r="${n4(p.r)}"/>`);
      } else if (p.kind === 'rect') {
        const r = p.rx !== undefined ? ` rx="${n4(p.rx)}" ry="${n4(p.rx)}"` : '';
        body.push(`<rect x="${X(p.x)}" y="${Y(p.y + p.h)}" width="${n4(p.w)}" height="${n4(p.h)}"${r}/>`);
      } else {
        const d = p.polys.map((poly) => `M${poly.map(([x, y]) => `${X(x)} ${Y(y)}`).join('L')}Z`).join('');
        body.push(`<path d="${d}"/>`);
      }
    }
  }

  const w = n4(width);
  const h = n4(height);
  const text = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`,
    `<g fill="none" stroke="#ff0000" stroke-width="0.01">`,
    ...body,
    `</g>`,
    `</svg>`,
    ``,
  ].join('\n');
  return { text, skipped };
}

/** Merges every visible design's paste layer for `side` and renders it as a laser-cutting SVG. */
export function exportMergedPasteSvg(designs: Design[], side: 'top' | 'bottom', kerfMm: number): SvgExportResult {
  const { image, warnings } = placeMergedPaste(designs, side);
  const { text, skipped } = writeLaserSvg(image, kerfMm);
  if (skipped > 0) warnings.push(`${skipped} pad(s) too small for ${kerfMm} mm kerf were skipped.`);
  return { text, warnings, padCount: image.children.length };
}
