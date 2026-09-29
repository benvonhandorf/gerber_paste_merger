import type {
  ImageTree,
  ImageGraphic,
  ImageShape,
  ImagePath,
  ImageRegion,
  Shape,
  SimpleShape,
  ErasableShape,
  PathSegment,
  Position,
  ArcPosition,
} from '@tracespace/plotter';
import { BoundingBox } from '@tracespace/plotter';
import { mirrorAngle, mirrorPointAboutX, rotateAndTranslate, rotateAngle, swapsAxes, type Rotation90 } from './geometry';

/**
 * Mirrors a point across x = mirrorX (if given), then rotates (about the
 * local origin) and translates it. Mirroring first matches the order used
 * for arc angles in `transformArcPosition`.
 */
function tp(p: Position, rotation: Rotation90, dx: number, dy: number, mirrorX?: number): Position {
  const base = mirrorX === undefined ? p : mirrorPointAboutX(p, mirrorX);
  return rotateAndTranslate(base, rotation, dx, dy);
}

function transformArcPosition(p: ArcPosition, rotation: Rotation90, dx: number, dy: number, mirrorX?: number): ArcPosition {
  const [x, y] = tp([p[0], p[1]], rotation, dx, dy, mirrorX);
  const theta = mirrorX === undefined ? p[2] : mirrorAngle(p[2]);
  return [x, y, rotateAngle(theta, rotation)];
}

function transformSegment(seg: PathSegment, rotation: Rotation90, dx: number, dy: number, mirrorX?: number): PathSegment {
  if (seg.type === 'line') {
    return { type: 'line', start: tp(seg.start, rotation, dx, dy, mirrorX), end: tp(seg.end, rotation, dx, dy, mirrorX) };
  }
  return {
    type: 'arc',
    start: transformArcPosition(seg.start, rotation, dx, dy, mirrorX),
    end: transformArcPosition(seg.end, rotation, dx, dy, mirrorX),
    center: tp(seg.center, rotation, dx, dy, mirrorX),
    radius: seg.radius,
  };
}

function transformSimpleShape(shape: SimpleShape, rotation: Rotation90, dx: number, dy: number, mirrorX?: number): SimpleShape {
  switch (shape.type) {
    case 'circle': {
      const [cx, cy] = tp([shape.cx, shape.cy], rotation, dx, dy, mirrorX);
      return { type: 'circle', cx, cy, r: shape.r };
    }
    case 'rectangle': {
      // Stored as a lower-left corner + size; transform the shape's *center*
      // (which is mirror/rotation-invariant to compute) and re-derive the
      // corner from the (possibly axis-swapped) size. A mirror alone never
      // swaps xSize/ySize - a reflection keeps an axis-aligned rectangle
      // axis-aligned with the same width/height, unlike a 90-degree turn.
      const cx = shape.x + shape.xSize / 2;
      const cy = shape.y + shape.ySize / 2;
      const [rcx, rcy] = tp([cx, cy], rotation, dx, dy, mirrorX);
      const xSize = swapsAxes(rotation) ? shape.ySize : shape.xSize;
      const ySize = swapsAxes(rotation) ? shape.xSize : shape.ySize;
      const result: SimpleShape = {
        type: 'rectangle',
        x: rcx - xSize / 2,
        y: rcy - ySize / 2,
        xSize,
        ySize,
      };
      if (shape.r !== undefined) result.r = shape.r;
      return result;
    }
    case 'polygon':
      return { type: 'polygon', points: shape.points.map((p) => tp(p, rotation, dx, dy, mirrorX)) };
    case 'outline':
      return { type: 'outline', segments: shape.segments.map((s) => transformSegment(s, rotation, dx, dy, mirrorX)) };
  }
}

function transformErasableShape(shape: ErasableShape, rotation: Rotation90, dx: number, dy: number, mirrorX?: number): ErasableShape {
  const transformed = transformSimpleShape(shape, rotation, dx, dy, mirrorX) as ErasableShape;
  if (shape.erase !== undefined) transformed.erase = shape.erase;
  return transformed;
}

function transformShape(shape: Shape, rotation: Rotation90, dx: number, dy: number, mirrorX?: number): Shape {
  if (shape.type === 'layeredShape') {
    return { type: 'layeredShape', shapes: shape.shapes.map((s) => transformErasableShape(s, rotation, dx, dy, mirrorX)) };
  }
  return transformSimpleShape(shape, rotation, dx, dy, mirrorX);
}

function transformGraphic(graphic: ImageGraphic, rotation: Rotation90, dx: number, dy: number, mirrorX?: number): ImageGraphic {
  if (graphic.type === 'imageShape') {
    const g: ImageShape = { type: 'imageShape', shape: transformShape(graphic.shape, rotation, dx, dy, mirrorX) };
    return g;
  }
  const segments = graphic.segments.map((s) => transformSegment(s, rotation, dx, dy, mirrorX));
  if (graphic.type === 'imagePath') {
    const g: ImagePath = { type: 'imagePath', width: graphic.width, segments };
    return g;
  }
  const g: ImageRegion = { type: 'imageRegion', segments };
  return g;
}

/**
 * Mirrors an image across x = mirrorX (if given), rotates it (about its own
 * local origin, i.e. the Gerber file's coordinate origin) by a 90-degree
 * step, and translates it by `(dx, dy)`. Returns a new image; the input is
 * left untouched.
 */
export function transformImage(image: ImageTree, rotation: Rotation90, dx: number, dy: number, mirrorX?: number): ImageTree {
  const children = image.children.map((g) => transformGraphic(g, rotation, dx, dy, mirrorX));
  return {
    type: 'image',
    units: image.units,
    size: BoundingBox.fromGraphics(children),
    children,
  };
}
