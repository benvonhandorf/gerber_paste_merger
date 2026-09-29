import type { Design } from '../model';
import { effectivePasteLayer, flipMirrorX, physicalPasteSide } from '../model';
import { transformImage } from './transform';
import { mergeImages } from './merge';
import { writeGerber } from './write';

export interface ExportResult {
  text: string;
  warnings: string[];
  padCount: number;
}

/**
 * Places, merges, and serializes every visible design's paste layer for one
 * side into a single Gerber file. A design flipped via `design.flipped`
 * contributes its *other* raw side (mirrored in place), so a board mounted
 * upside-down on the panel still lines up with the rest of this side's
 * stencil.
 */
export function exportMergedPaste(designs: Design[], side: 'top' | 'bottom'): ExportResult {
  const warnings: string[] = [];
  const placed = [];
  for (const design of designs) {
    if (!design.visible) continue;
    const layer = effectivePasteLayer(design, side);
    if (!layer) {
      const physicalSide = physicalPasteSide(design, side);
      const note = design.flipped ? ` (it's flipped, so its ${physicalSide} paste is needed for the ${side} output)` : '';
      warnings.push(`"${design.name}" has no ${physicalSide} paste layer loaded${note} - skipped.`);
      continue;
    }
    const mirrorX = design.flipped ? flipMirrorX(design) : undefined;
    placed.push(transformImage(layer.image, design.rotation, design.x, design.y, mirrorX));
  }

  const merged = mergeImages(placed);
  const text = writeGerber(merged.children, {
    fileFunction: { type: 'Paste', side: side === 'top' ? 'Top' : 'Bot' },
    generationSoftware: { vendor: 'GerberPasteMerger', application: 'GerberPasteMerger', version: '1.0.0' },
  });
  return { text, warnings, padCount: merged.children.length };
}
