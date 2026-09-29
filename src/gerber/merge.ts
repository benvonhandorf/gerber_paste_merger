import type { ImageGraphic, ImageTree } from '@tracespace/plotter';
import { BoundingBox } from '@tracespace/plotter';

/** Concatenates several already-placed (world-space) images' graphics into one image. */
export function mergeImages(images: ImageTree[]): ImageTree {
  const children: ImageGraphic[] = images.flatMap((img) => img.children);
  return { type: 'image', units: 'mm', size: BoundingBox.fromGraphics(children), children };
}
