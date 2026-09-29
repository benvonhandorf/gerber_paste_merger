import type { CircleShape, RectangleShape, PolygonShape, OutlineShape, SimpleShape, PathSegment, Position } from '@tracespace/plotter';

function line(start: Position, end: Position): PathSegment {
  return { type: 'line', start, end };
}

/** A full-circle boundary as one 360-degree CCW arc, matching the plotter's own convention for round apertures with a hole. */
export function circleBoundary(shape: CircleShape): PathSegment[] {
  const { cx, cy, r } = shape;
  const start: Position = [cx + r, cy];
  return [{ type: 'arc', start: [start[0], start[1], 0], end: [start[0], start[1], Math.PI * 2], center: [cx, cy], radius: r }];
}

/**
 * A rectangle's boundary as four line segments. Note: `shape.r` (the
 * obround corner radius) is intentionally ignored here - in practice it is
 * only ever set on a top-level Obround aperture flash, which `write.ts`
 * renders exactly via a real `O` aperture and never routes through this
 * boundary fallback. If it ever did reach here, the corners would come out
 * square instead of rounded.
 */
export function rectBoundary(shape: RectangleShape): PathSegment[] {
  const { x, y, xSize, ySize } = shape;
  const p1: Position = [x, y];
  const p2: Position = [x + xSize, y];
  const p3: Position = [x + xSize, y + ySize];
  const p4: Position = [x, y + ySize];
  return [line(p1, p2), line(p2, p3), line(p3, p4), line(p4, p1)];
}

export function polygonBoundary(shape: PolygonShape): PathSegment[] {
  const pts = shape.points;
  const segments: PathSegment[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    segments.push(line(a, b));
  }
  return segments;
}

/** Already a boundary path (possibly several disconnected closed loops, e.g. a hole). */
export function outlineBoundary(shape: OutlineShape): PathSegment[] {
  return shape.segments;
}

/** Converts any simple shape into a boundary path suitable for a Gerber region (G36/G37). */
export function shapeToBoundarySegments(shape: SimpleShape): PathSegment[] {
  switch (shape.type) {
    case 'circle':
      return circleBoundary(shape);
    case 'rectangle':
      return rectBoundary(shape);
    case 'polygon':
      return polygonBoundary(shape);
    case 'outline':
      return outlineBoundary(shape);
  }
}
