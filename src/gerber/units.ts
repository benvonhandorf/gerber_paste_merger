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

const MM_PER_INCH = 25.4;

function sp([x, y]: Position, k: number): Position {
  return [x * k, y * k];
}

function sa([x, y, theta]: ArcPosition, k: number): ArcPosition {
  return [x * k, y * k, theta];
}

function scaleSegment(seg: PathSegment, k: number): PathSegment {
  if (seg.type === 'line') {
    return { type: 'line', start: sp(seg.start, k), end: sp(seg.end, k) };
  }
  return { type: 'arc', start: sa(seg.start, k), end: sa(seg.end, k), center: sp(seg.center, k), radius: seg.radius * k };
}

function scaleSimpleShape(shape: SimpleShape, k: number): SimpleShape {
  switch (shape.type) {
    case 'circle':
      return { type: 'circle', cx: shape.cx * k, cy: shape.cy * k, r: shape.r * k };
    case 'rectangle': {
      const result: SimpleShape = { type: 'rectangle', x: shape.x * k, y: shape.y * k, xSize: shape.xSize * k, ySize: shape.ySize * k };
      if (shape.r !== undefined) result.r = shape.r * k;
      return result;
    }
    case 'polygon':
      return { type: 'polygon', points: shape.points.map((p) => sp(p, k)) };
    case 'outline':
      return { type: 'outline', segments: shape.segments.map((s) => scaleSegment(s, k)) };
  }
}

function scaleErasableShape(shape: ErasableShape, k: number): ErasableShape {
  const scaled = scaleSimpleShape(shape, k) as ErasableShape;
  if (shape.erase !== undefined) scaled.erase = shape.erase;
  return scaled;
}

function scaleShape(shape: Shape, k: number): Shape {
  if (shape.type === 'layeredShape') {
    return { type: 'layeredShape', shapes: shape.shapes.map((s) => scaleErasableShape(s, k)) };
  }
  return scaleSimpleShape(shape, k);
}

function scaleGraphic(g: ImageGraphic, k: number): ImageGraphic {
  if (g.type === 'imageShape') {
    const r: ImageShape = { type: 'imageShape', shape: scaleShape(g.shape, k) };
    return r;
  }
  const segments = g.segments.map((s) => scaleSegment(s, k));
  if (g.type === 'imagePath') {
    const r: ImagePath = { type: 'imagePath', width: g.width * k, segments };
    return r;
  }
  const r: ImageRegion = { type: 'imageRegion', segments };
  return r;
}

/**
 * Returns an equivalent image expressed in millimeters. The whole app works
 * in mm internally so placement math and UI fields have one consistent unit.
 */
export function toMillimeters(image: ImageTree): ImageTree {
  if (image.units === 'mm') return image;
  const children = image.children.map((g) => scaleGraphic(g, MM_PER_INCH));
  return { type: 'image', units: 'mm', size: BoundingBox.fromGraphics(children), children };
}
