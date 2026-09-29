import { createParser } from '@tracespace/parser';
import { plot } from '@tracespace/plotter';
import type { ImageTree } from '@tracespace/plotter';
import { toMillimeters } from './units';

export interface ParsedLayer {
  /** Plotted geometry, normalized to millimeters. */
  image: ImageTree;
  /** True if the source looked like a complete, recognized Gerber file. */
  ok: boolean;
  /** Human-readable problem description when `ok` is false. */
  warning?: string;
}

/** Parses and plots Gerber source text into a millimeter-space image. */
export function parseGerber(source: string): ParsedLayer {
  const parser = createParser();
  parser.feed(source);
  const tree = parser.result();

  if (tree.filetype !== 'gerber') {
    return { image: emptyImage(), ok: false, warning: 'File does not look like an RS-274X Gerber file.' };
  }

  const image = toMillimeters(plot(tree));
  const hasDone = tree.children.some((c) => c.type === 'done');
  return hasDone ? { image, ok: true } : { image, ok: true, warning: 'File has no M02 end-of-program marker; it may be truncated.' };
}

function emptyImage(): ImageTree {
  return { type: 'image', units: 'mm', size: [], children: [] };
}
