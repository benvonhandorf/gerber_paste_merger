import type { Box } from '../gerber/bbox';
import { isEmptyBox, worldBBox } from '../gerber/bbox';
import type { Rotation90 } from '../gerber/geometry';

/**
 * The minimal shape align/distribute operates on: a placement (x, y,
 * rotation) plus the design's own local (pre-placement) bounding box.
 * Kept decoupled from the full `Design` model so this module stays a pure,
 * easily-testable function library.
 */
export interface Placeable {
  id: string;
  x: number;
  y: number;
  rotation: Rotation90;
  localBox: Box;
}

export type Update = { id: string; x: number; y: number };

/**
 * The design's bounding box as it would be if placed at (0, 0) - i.e. the
 * local box rotated about the origin but not yet translated. Because
 * translation shifts every corner uniformly, `worldBox = rotatedBox0 +
 * (x, y)` for all four corner values, which is what lets every align/distribute
 * formula below just solve for the (x, y) that puts an edge where we want it.
 */
function rotatedBox0(p: Pick<Placeable, 'localBox' | 'rotation'>): Box {
  return worldBBox(p.localBox, p.rotation, 0, 0);
}

export function worldBox(p: Placeable): Box {
  return worldBBox(p.localBox, p.rotation, p.x, p.y);
}

export type HorizontalEdge = 'left' | 'right' | 'hcenter';
export type VerticalEdge = 'top' | 'bottom' | 'vcenter';

/** Solves for the x that gives `p` the requested horizontal edge value. Leaves `p.x` unchanged if it has no geometry to align. */
function xFor(p: Placeable, edge: HorizontalEdge, value: number): number {
  const box = rotatedBox0(p);
  if (isEmptyBox(box)) return p.x;
  const [bx1, , bx2] = box;
  if (edge === 'left') return value - bx1;
  if (edge === 'right') return value - bx2;
  return value - (bx1 + bx2) / 2;
}

/** Solves for the y that gives `p` the requested vertical edge value. Leaves `p.y` unchanged if it has no geometry to align. */
function yFor(p: Placeable, edge: VerticalEdge, value: number): number {
  const box = rotatedBox0(p);
  if (isEmptyBox(box)) return p.y;
  const [, by1, , by2] = box;
  if (edge === 'bottom') return value - by1;
  if (edge === 'top') return value - by2;
  return value - (by1 + by2) / 2;
}

function edgeValueX(box: Box, edge: HorizontalEdge): number | null {
  if (isEmptyBox(box)) return null;
  const [x1, , x2] = box;
  return edge === 'left' ? x1 : edge === 'right' ? x2 : (x1 + x2) / 2;
}

function edgeValueY(box: Box, edge: VerticalEdge): number | null {
  if (isEmptyBox(box)) return null;
  const [, y1, , y2] = box;
  return edge === 'bottom' ? y1 : edge === 'top' ? y2 : (y1 + y2) / 2;
}

/** Aligns every target's given horizontal edge/center to the reference's. */
export function alignHorizontal(reference: Placeable, targets: Placeable[], edge: HorizontalEdge): Update[] {
  const value = edgeValueX(worldBox(reference), edge);
  if (value === null) return [];
  return targets.filter((t) => t.id !== reference.id).map((t) => ({ id: t.id, x: xFor(t, edge, value), y: t.y }));
}

/** Aligns every target's given vertical edge/center to the reference's. */
export function alignVertical(reference: Placeable, targets: Placeable[], edge: VerticalEdge): Update[] {
  const value = edgeValueY(worldBox(reference), edge);
  if (value === null) return [];
  return targets.filter((t) => t.id !== reference.id).map((t) => ({ id: t.id, x: t.x, y: yFor(t, edge, value) }));
}

export type Side = 'left' | 'right' | 'above' | 'below';

/**
 * Places `target` directly adjacent to `reference` on the given side, with
 * `marginMm` of clear space between their bounding boxes (e.g. "right side
 * of the other layer with a 15mm margin"). Optionally also aligns the
 * perpendicular edge/center in the same call (e.g. also align tops).
 */
export function placeAdjacent(
  reference: Placeable,
  target: Placeable,
  side: Side,
  marginMm: number,
  alsoAlign?: HorizontalEdge | VerticalEdge,
): Update {
  const refBox = worldBox(reference);
  if (isEmptyBox(refBox)) return { id: target.id, x: target.x, y: target.y };
  const [rx1, ry1, rx2, ry2] = refBox;

  let x = target.x;
  let y = target.y;
  if (side === 'right') x = xFor(target, 'left', rx2 + marginMm);
  else if (side === 'left') x = xFor(target, 'right', rx1 - marginMm);
  else if (side === 'above') y = yFor(target, 'bottom', ry2 + marginMm);
  else y = yFor(target, 'top', ry1 - marginMm);

  if (alsoAlign) {
    if (side === 'left' || side === 'right') {
      y = yFor(target, alsoAlign as VerticalEdge, edgeValueY(refBox, alsoAlign as VerticalEdge)!);
    } else {
      x = xFor(target, alsoAlign as HorizontalEdge, edgeValueX(refBox, alsoAlign as HorizontalEdge)!);
    }
  }
  return { id: target.id, x, y };
}

export type Axis = 'horizontal' | 'vertical';

/**
 * Chains each item after the previous one with a fixed edge-to-edge gap
 * (e.g. "15mm between every board"), in the items' current position order
 * along the axis. The first item does not move.
 */
export function distributeWithGap(items: Placeable[], axis: Axis, gapMm: number): Update[] {
  const sorted = sortByPosition(items, axis);
  const updates: Update[] = [];
  // effective (possibly just-updated) box of the previous item, so gaps chain correctly
  let prevBox = sorted.length > 0 ? worldBox(sorted[0]!) : ([] as Box);
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (isEmptyBox(prevBox)) {
      updates.push({ id: cur.id, x: cur.x, y: cur.y });
      continue;
    }
    const x = axis === 'horizontal' ? xFor(cur, 'left', prevBox[2] + gapMm) : cur.x;
    const y = axis === 'horizontal' ? cur.y : yFor(cur, 'bottom', prevBox[3] + gapMm);
    updates.push({ id: cur.id, x, y });
    prevBox = worldBBox(cur.localBox, cur.rotation, x, y);
  }
  return updates;
}

/**
 * Spreads items evenly between the first and last item's position (both of
 * which stay fixed), matching each item's leading edge to equally-spaced
 * positions along the axis.
 */
export function distributeEvenly(items: Placeable[], axis: Axis): Update[] {
  const sorted = sortByPosition(items, axis);
  if (sorted.length < 3) return [];
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const firstBox = worldBox(first);
  const lastBox = worldBox(last);
  if (isEmptyBox(firstBox) || isEmptyBox(lastBox)) return [];

  const startEdge = axis === 'horizontal' ? firstBox[0] : firstBox[1];
  const endEdge = axis === 'horizontal' ? lastBox[0] : lastBox[1];
  const step = (endEdge - startEdge) / (sorted.length - 1);

  const updates: Update[] = [];
  for (let i = 1; i < sorted.length - 1; i++) {
    const item = sorted[i]!;
    const target = startEdge + step * i;
    if (axis === 'horizontal') updates.push({ id: item.id, x: xFor(item, 'left', target), y: item.y });
    else updates.push({ id: item.id, x: item.x, y: yFor(item, 'bottom', target) });
  }
  return updates;
}

function sortByPosition(items: Placeable[], axis: Axis): Placeable[] {
  return [...items].sort((a, b) => {
    const av = axis === 'horizontal' ? worldBox(a) : worldBox(a);
    const bv = axis === 'horizontal' ? worldBox(b) : worldBox(b);
    if (isEmptyBox(av) || isEmptyBox(bv)) return 0;
    return axis === 'horizontal' ? av[0] - bv[0] : av[1] - bv[1];
  });
}
