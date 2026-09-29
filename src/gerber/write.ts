import type { ImageGraphic, Shape, PathSegment, Position } from '@tracespace/plotter';
import { shapeToBoundarySegments } from './shapeSegments';

/**
 * Serializes plotted, merged graphics (already in world-space millimeters)
 * back into RS-274X Gerber text.
 *
 * Strategy: circle/rectangle/obround flashes get real, deduplicated
 * apertures (the common case for paste pads, and the smallest/most
 * conventional output). Anything else a pad could plot as - an irregular
 * polygon, a macro-derived outline, a shape with a hole, a clear-polarity
 * cutout - is written as an equivalent filled region (G36/G37), which can
 * represent any of those exactly. Stroked paths (rare in paste layers) get
 * a round aperture matching their width, since the plotter does not retain
 * whether the original stroking aperture was round or rectangular.
 */

const SCALE = 1_000_000; // 6 decimal places, i.e. the file's coordinate unit is 1e-6 mm
const EPSILON_MM = 1e-6;

function fmt(mm: number): string {
  const n = Math.round(mm * SCALE);
  return n === 0 ? '0' : String(n);
}

function round6(mm: number): number {
  return Math.round(mm * SCALE) / SCALE;
}

class ApertureRegistry {
  private codes = new Map<string, string>();
  private defLines: string[] = [];
  private next = 10;

  private codeFor(key: string, def: (code: number) => string): string {
    const existing = this.codes.get(key);
    if (existing) return existing;
    const code = this.next++;
    const codeStr = String(code);
    this.codes.set(key, codeStr);
    this.defLines.push(`%ADD${codeStr}${def(code)}*%`);
    return codeStr;
  }

  circle(diameterMm: number): string {
    const d = round6(diameterMm);
    return this.codeFor(`C:${d}`, () => `C,${d}`);
  }

  rectangle(xSizeMm: number, ySizeMm: number): string {
    const x = round6(xSizeMm);
    const y = round6(ySizeMm);
    return this.codeFor(`R:${x}x${y}`, () => `R,${x}X${y}`);
  }

  obround(xSizeMm: number, ySizeMm: number): string {
    const x = round6(xSizeMm);
    const y = round6(ySizeMm);
    return this.codeFor(`O:${x}x${y}`, () => `O,${x}X${y}`);
  }

  get definitions(): readonly string[] {
    return this.defLines;
  }
}

type Polarity = 'dark' | 'clear';

type Op =
  | { kind: 'flash'; apertureCode: string; x: number; y: number; polarity: Polarity }
  | { kind: 'stroke'; apertureCode: string; segments: PathSegment[]; polarity: Polarity }
  | { kind: 'region'; loops: PathSegment[][]; polarity: Polarity };

function segStart(seg: PathSegment): Position {
  return seg.type === 'line' ? seg.start : [seg.start[0], seg.start[1]];
}

function segEnd(seg: PathSegment): Position {
  return seg.type === 'line' ? seg.end : [seg.end[0], seg.end[1]];
}

function pointsEqual(a: Position, b: Position): boolean {
  return Math.abs(a[0] - b[0]) < EPSILON_MM && Math.abs(a[1] - b[1]) < EPSILON_MM;
}

function reverseSegment(seg: PathSegment): PathSegment {
  return seg.type === 'line'
    ? { type: 'line', start: seg.end, end: seg.start }
    : { type: 'arc', start: seg.end, end: seg.start, center: seg.center, radius: seg.radius };
}

/**
 * When a region has more than one loop (e.g. an aperture hole: an outer
 * boundary plus one or more inner cutouts), makes every loop after the
 * first wind opposite the outer one. Gerber readers that use the nonzero
 * winding rule for multi-contour regions need this to render the inner
 * loops as holes rather than solid fill; readers using even-odd ignore
 * winding, so this is safe either way.
 */
function orientLoopsForRegion(loops: PathSegment[][]): PathSegment[][] {
  return loops.map((loop, i) => (i === 0 ? loop : [...loop].reverse().map(reverseSegment)));
}

/**
 * Splits a flat segment list into closed loops, breaking wherever the next
 * segment's start doesn't meet the previous one's end. This is how the
 * plotter represents an aperture hole: one `outline` shape whose `segments`
 * contain an outer loop immediately followed by an inner loop.
 */
function splitIntoLoops(segments: PathSegment[]): PathSegment[][] {
  const loops: PathSegment[][] = [];
  let current: PathSegment[] = [];
  let prevEnd: Position | null = null;
  for (const seg of segments) {
    const start = segStart(seg);
    if (prevEnd && !pointsEqual(prevEnd, start)) {
      loops.push(current);
      current = [];
    }
    current.push(seg);
    prevEnd = segEnd(seg);
  }
  if (current.length > 0) loops.push(current);
  return loops;
}

function planShape(shape: Shape, apertures: ApertureRegistry, polarity: Polarity): Op[] {
  switch (shape.type) {
    case 'circle':
      return [{ kind: 'flash', apertureCode: apertures.circle(shape.r * 2), x: shape.cx, y: shape.cy, polarity }];
    case 'rectangle': {
      const cx = shape.x + shape.xSize / 2;
      const cy = shape.y + shape.ySize / 2;
      const apertureCode =
        shape.r !== undefined ? apertures.obround(shape.xSize, shape.ySize) : apertures.rectangle(shape.xSize, shape.ySize);
      return [{ kind: 'flash', apertureCode, x: cx, y: cy, polarity }];
    }
    case 'polygon':
    case 'outline':
      return [{ kind: 'region', loops: orientLoopsForRegion(splitIntoLoops(shapeToBoundarySegments(shape))), polarity }];
    case 'layeredShape':
      return shape.shapes.flatMap((s) => planShape(s, apertures, s.erase ? 'clear' : 'dark'));
  }
}

function planGraphic(graphic: ImageGraphic, apertures: ApertureRegistry): Op[] {
  if (graphic.type === 'imageShape') return planShape(graphic.shape, apertures, 'dark');
  if (graphic.type === 'imagePath') {
    return [{ kind: 'stroke', apertureCode: apertures.circle(graphic.width), segments: graphic.segments, polarity: 'dark' }];
  }
  return [{ kind: 'region', loops: orientLoopsForRegion(splitIntoLoops(graphic.segments)), polarity: 'dark' }];
}

class Emitter {
  private lines: string[] = [];
  private currentTool: string | null = null;
  private currentPolarity: Polarity = 'dark';
  private currentInterp: 'line' | 'cw' | 'ccw' | null = null;

  polarity(p: Polarity): void {
    if (p !== this.currentPolarity) {
      this.lines.push(p === 'dark' ? '%LPD*%' : '%LPC*%');
      this.currentPolarity = p;
    }
  }

  tool(code: string): void {
    if (code !== this.currentTool) {
      this.lines.push(`D${code}*`);
      this.currentTool = code;
    }
  }

  private interp(mode: 'line' | 'cw' | 'ccw'): void {
    if (mode !== this.currentInterp) {
      this.lines.push(mode === 'line' ? 'G01*' : mode === 'cw' ? 'G02*' : 'G03*');
      this.currentInterp = mode;
    }
  }

  moveTo(p: Position): void {
    this.lines.push(`X${fmt(p[0])}Y${fmt(p[1])}D02*`);
  }

  flashAt(p: Position): void {
    this.lines.push(`X${fmt(p[0])}Y${fmt(p[1])}D03*`);
  }

  drawSegment(seg: PathSegment): void {
    if (seg.type === 'line') {
      this.interp('line');
      this.lines.push(`X${fmt(seg.end[0])}Y${fmt(seg.end[1])}D01*`);
      return;
    }
    const direction = seg.end[2] - seg.start[2] >= 0 ? 'ccw' : 'cw';
    this.interp(direction);
    const i = seg.center[0] - seg.start[0];
    const j = seg.center[1] - seg.start[1];
    this.lines.push(`X${fmt(seg.end[0])}Y${fmt(seg.end[1])}I${fmt(i)}J${fmt(j)}D01*`);
  }

  region(loops: PathSegment[][]): void {
    this.lines.push('G36*');
    for (const loop of loops) {
      if (loop.length === 0) continue;
      this.moveTo(segStart(loop[0]!));
      for (const seg of loop) this.drawSegment(seg);
    }
    this.lines.push('G37*');
  }

  toText(): string {
    return this.lines.join('\n');
  }
}

export type Side = 'Top' | 'Bot';

export interface WriteOptions {
  /** Adds a Gerber X2 `%TF.FileFunction,Paste,<side>*%` attribute; omit for a generic/unspecified layer. */
  fileFunction?: { type: 'Paste' | 'Legend' | 'Profile'; side?: Side };
  generationSoftware?: { vendor: string; application: string; version: string };
}

export function writeGerber(graphics: ImageGraphic[], options: WriteOptions = {}): string {
  const apertures = new ApertureRegistry();
  const ops = graphics.flatMap((g) => planGraphic(g, apertures));

  const header: string[] = ['%MOMM*%', '%FSLAX46Y46*%', 'G75*'];
  if (options.generationSoftware) {
    const { vendor, application, version } = options.generationSoftware;
    header.push(`%TF.GenerationSoftware,${vendor},${application},${version}*%`);
  }
  if (options.fileFunction) {
    const { type, side } = options.fileFunction;
    header.push(`%TF.FileFunction,${type}${side ? `,${side}` : ''}*%`);
  }
  header.push(...apertures.definitions);

  const emitter = new Emitter();
  emitter.polarity('dark');
  for (const op of ops) {
    emitter.polarity(op.polarity);
    if (op.kind === 'flash') {
      emitter.tool(op.apertureCode);
      emitter.flashAt([op.x, op.y]);
    } else if (op.kind === 'stroke') {
      emitter.tool(op.apertureCode);
      // The plotter flattens every draw under the same aperture into one
      // segments array, even across the source file's own D02 (move)
      // breaks - so a stroke can contain several disconnected runs (e.g.
      // two separate multi-arc pad features drawn with the same tool).
      // Re-split on continuity and re-issue a move at the start of each
      // run, or a later run gets bridged to the previous one's end point
      // instead of its own true start.
      for (const run of splitIntoLoops(op.segments)) {
        if (run.length === 0) continue;
        emitter.moveTo(segStart(run[0]!));
        for (const seg of run) emitter.drawSegment(seg);
      }
    } else {
      emitter.region(op.loops);
    }
  }

  return [...header, emitter.toText(), 'M02*', ''].join('\n');
}
