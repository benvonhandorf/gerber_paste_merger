import type { ImageTree, SizeEnvelope } from '@tracespace/plotter';
import { BoundingBox } from '@tracespace/plotter';
import { rotateAndTranslate, type Rotation90 } from './geometry';

/** An empty box (`[]`) means "no geometry"; callers should treat it as absent. */
export type Box = SizeEnvelope;

export function isEmptyBox(box: Box): box is [] {
  return box.length === 0;
}

/** Union of several boxes, skipping empty ones. */
export function unionBoxes(boxes: Box[]): Box {
  return BoundingBox.sum(boxes);
}

export function localBBox(image: ImageTree): Box {
  return image.size;
}

/**
 * Projects a local-space box into world space given a placement
 * (rotate about the local origin, then translate). Since rotation is
 * always a 90-degree step, the result is exactly axis-aligned again -
 * we just need the min/max of the four rotated corners.
 */
export function worldBBox(box: Box, rotation: Rotation90, dx: number, dy: number): Box {
  if (isEmptyBox(box)) return [];
  const [x1, y1, x2, y2] = box;
  const corners: Array<[number, number]> = [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
  const transformed = corners.map((c) => rotateAndTranslate(c, rotation, dx, dy));
  const xs = transformed.map((p) => p[0]);
  const ys = transformed.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function boxWidth(box: Box): number {
  return isEmptyBox(box) ? 0 : box[2] - box[0];
}

export function boxHeight(box: Box): number {
  return isEmptyBox(box) ? 0 : box[3] - box[1];
}
