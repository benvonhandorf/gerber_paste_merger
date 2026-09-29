import { describe, expect, it } from 'vitest';
import type { PathSegment } from '@tracespace/plotter';
import { parseGerber } from './parse';
import { transformImage } from './transform';
import { writeGerber } from './write';
import { mergeImages } from './merge';

const SAMPLE = `%FSLAX46Y46*%
%MOMM*%
%ADD10C,0.500000*%
%ADD11R,1.000000X0.500000*%
%ADD12O,1.200000X0.600000*%
%AMROUNDED*
21,1,0.800000,0.400000,0,0,$1*
%
%ADD13ROUNDED,90*%
%ADD14C,0.800000X0.300000*%
G01*
%LPD*%
D10*
X1000000Y2000000D03*
D11*
X3000000Y2000000D03*
D12*
X5000000Y2000000D03*
D13*
X7000000Y2000000D03*
D14*
X9000000Y2000000D03*
G36*
X0Y0D02*
X0Y1000000D01*
X1000000Y1000000D01*
X1000000Y0D01*
X0Y0D01*
G37*
M02*
`;

function countByType(text: string) {
  const image = parseGerber(text).image;
  const counts: Record<string, number> = {};
  for (const g of image.children) {
    const key = g.type === 'imageShape' ? `imageShape:${g.shape.type}` : g.type;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

describe('parse -> transform -> write -> parse round trip', () => {
  it('preserves the overall bounding box under translation', () => {
    const parsed = parseGerber(SAMPLE);
    expect(parsed.ok).toBe(true);
    const moved = transformImage(parsed.image, 0, 100, 50);
    const out = writeGerber(moved.children);
    const reparsed = parseGerber(out);
    expect(reparsed.ok).toBe(true);

    const [x1, y1, x2, y2] = parsed.image.size as number[];
    const [rx1, ry1, rx2, ry2] = reparsed.image.size as number[];
    expect(rx1).toBeCloseTo(x1! + 100, 5);
    expect(ry1).toBeCloseTo(y1! + 50, 5);
    expect(rx2).toBeCloseTo(x2! + 100, 5);
    expect(ry2).toBeCloseTo(y2! + 50, 5);
  });

  it('preserves shape kinds and counts through the round trip', () => {
    const before = countByType(SAMPLE);
    const parsed = parseGerber(SAMPLE);
    const moved = transformImage(parsed.image, 90, 0, 0);
    const out = writeGerber(moved.children);
    const after = countByType(out);

    expect(before['imageShape:circle']).toBe(1); // D10
    expect(after['imageShape:circle']).toBe(1);
    expect(before['imageShape:rectangle']).toBe(2); // D11 plain rect + D12 obround
    expect(after['imageShape:rectangle']).toBe(2);

    // Everything else (D13 macro-rotated pad, D14 round-with-hole, and the
    // explicit G36 region) has no exact aperture and gets written as one or
    // more G36 regions. A region is *always* how a re-parse represents a
    // filled area - never as imageShape:outline/layeredShape, since those
    // AST shapes only come from aperture flashes, not G36 commands. A region
    // with N loops (e.g. D14's hole) also always reparses as N separate
    // imageRegion nodes, since the plotter doesn't retain which contours
    // came from the same G36 block. So: D13 -> 1 loop -> 1 region;
    // D14 -> 2 loops (outer + hole) -> 2 regions; explicit region -> 1
    // loop -> 1 region.
    expect(after['imageShape:outline']).toBeUndefined();
    expect(after['imageShape:layeredShape']).toBeUndefined();
    expect(after['imageRegion']).toBe(4);
  });

  it('rotates a circular pad position exactly 90 degrees about the local origin', () => {
    const parsed = parseGerber(SAMPLE);
    const rotated = transformImage(parsed.image, 90, 0, 0);
    const out = writeGerber(rotated.children);
    const reparsed = parseGerber(out);
    const circle = reparsed.image.children.find((g) => g.type === 'imageShape' && g.shape.type === 'circle');
    expect(circle).toBeDefined();
    if (circle?.type === 'imageShape' && circle.shape.type === 'circle') {
      // Original circle center (1, 2) rotated 90 deg CCW about origin -> (-2, 1)
      expect(circle.shape.cx).toBeCloseTo(-2, 5);
      expect(circle.shape.cy).toBeCloseTo(1, 5);
      expect(circle.shape.r).toBeCloseTo(0.25, 5);
    }
  });

  it('swaps rectangle X/Y size on a 90-degree rotation', () => {
    const parsed = parseGerber(SAMPLE);
    const rotated = transformImage(parsed.image, 90, 0, 0);
    const out = writeGerber(rotated.children);
    const reparsed = parseGerber(out);
    const rects = reparsed.image.children.filter((g) => g.type === 'imageShape' && g.shape.type === 'rectangle');
    // D11 plain rect was xSize=1, ySize=0.5 -> after 90deg should be xSize=0.5, ySize=1
    const plain = rects.find((g) => g.type === 'imageShape' && g.shape.type === 'rectangle' && g.shape.r === undefined);
    expect(plain).toBeDefined();
    if (plain?.type === 'imageShape' && plain.shape.type === 'rectangle') {
      expect(plain.shape.xSize).toBeCloseTo(0.5, 5);
      expect(plain.shape.ySize).toBeCloseTo(1, 5);
    }
  });

  it('keeps disconnected same-tool strokes apart (e.g. two spoked-circle pads drawn with one aperture)', () => {
    // Mirrors a real KiCad paste-layer pattern: a "spoked circle" pad is
    // drawn as several separate arcs with the same round aperture, each
    // preceded by its own D02 move. Two such pads back-to-back with no
    // aperture change in between get flattened into a single imagePath by
    // the plotter - the writer must not bridge the gap between them.
    const spokedPads = `%FSLAX46Y46*%
%MOMM*%
%ADD10C,0.300000*%
G01*
%LPD*%
D10*
X0Y0D02*
G75*
G02*
X1000000Y0I500000J0D01*
G01*
X2000000Y2000000D02*
G75*
G02*
X3000000Y2000000I500000J0D01*
G01*
M02*
`;
    const parsed = parseGerber(spokedPads);
    expect(parsed.ok).toBe(true);
    const moved = transformImage(parsed.image, 0, 0, 0);
    const out = writeGerber(moved.children);

    // The two arcs must each get their own D02 move (i.e. two D02s), not
    // be joined into one continuous draw.
    const moveCount = (out.match(/D02\*/g) ?? []).length;
    expect(moveCount).toBe(2);

    const reparsed = parseGerber(out);
    expect(reparsed.ok).toBe(true);
    const arcs = reparsed.image.children.filter((g) => g.type === 'imagePath').flatMap((g) => (g as { segments: PathSegment[] }).segments);
    expect(arcs).toHaveLength(2);
    // Second arc's start must be preserved as (2, 2), not silently
    // replaced by the first arc's end point (1, 0).
    const secondArc = arcs[1]!;
    expect(secondArc.start[0]).toBeCloseTo(2, 5);
    expect(secondArc.start[1]).toBeCloseTo(2, 5);
  });

  it('mirrors a circular pad position across the given vertical line, keeping its radius', () => {
    const parsed = parseGerber(SAMPLE);
    const mirrored = transformImage(parsed.image, 0, 0, 0, 5);
    const out = writeGerber(mirrored.children);
    const reparsed = parseGerber(out);
    const circle = reparsed.image.children.find((g) => g.type === 'imageShape' && g.shape.type === 'circle');
    expect(circle).toBeDefined();
    if (circle?.type === 'imageShape' && circle.shape.type === 'circle') {
      // Original circle center (1, 2) mirrored about x=5 -> (9, 2)
      expect(circle.shape.cx).toBeCloseTo(9, 5);
      expect(circle.shape.cy).toBeCloseTo(2, 5);
      expect(circle.shape.r).toBeCloseTo(0.25, 5);
    }
  });

  it('keeps rectangle X/Y size unchanged under a mirror (unlike a 90-degree rotation)', () => {
    const parsed = parseGerber(SAMPLE);
    const mirrored = transformImage(parsed.image, 0, 0, 0, 0);
    const out = writeGerber(mirrored.children);
    const reparsed = parseGerber(out);
    const rects = reparsed.image.children.filter((g) => g.type === 'imageShape' && g.shape.type === 'rectangle');
    const plain = rects.find((g) => g.type === 'imageShape' && g.shape.type === 'rectangle' && g.shape.r === undefined);
    expect(plain).toBeDefined();
    if (plain?.type === 'imageShape' && plain.shape.type === 'rectangle') {
      expect(plain.shape.xSize).toBeCloseTo(1, 5);
      expect(plain.shape.ySize).toBeCloseTo(0.5, 5);
    }
  });

  it('merges two placed designs into one file without dropping shapes', () => {
    const parsed = parseGerber(SAMPLE);
    const a = transformImage(parsed.image, 0, 0, 0);
    const b = transformImage(parsed.image, 180, 50, 0);
    const merged = mergeImages([a, b]);
    expect(merged.children.length).toBe(a.children.length + b.children.length);
    const out = writeGerber(merged.children, { fileFunction: { type: 'Paste', side: 'Top' } });
    const reparsed = parseGerber(out);
    expect(reparsed.ok).toBe(true);
    // Each design's D14 hole-aperture flash (1 shape) reparses as 2 separate
    // regions (see the note above), so the written+reparsed file gains one
    // extra top-level graphic per design relative to the merged, pre-write
    // image.
    expect(reparsed.image.children.length).toBe(merged.children.length + 2);
  });
});
