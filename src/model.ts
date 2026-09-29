import type { ImageTree } from '@tracespace/plotter';
import type { Rotation90 } from './gerber/geometry';
import type { Box } from './gerber/bbox';
import { isEmptyBox, unionBoxes } from './gerber/bbox';
import type { GerberType, GerberSide } from '@tracespace/identify-layers';

/** One parsed Gerber layer belonging to a design, in its own local (unplaced) mm space. */
export interface DesignLayer {
  type: NonNullable<GerberType>;
  side: NonNullable<GerberSide>;
  filename: string;
  image: ImageTree;
  warning?: string;
}

/** A loaded PCB design: its layers, plus where the user has placed it on the shared canvas. */
export interface Design {
  id: string;
  name: string;
  layers: DesignLayer[];
  x: number;
  y: number;
  rotation: Rotation90;
  /**
   * True if this design is mounted upside-down on the panel: its bottom
   * paste (mirrored, in place) becomes its top-side contribution and vice
   * versa. Lets one design's top and bottom paste be exported to a single
   * stencil side, e.g. for panelizing a board's own two sides together, or
   * for boards deliberately placed face-down among others.
   */
  flipped: boolean;
  visible: boolean;
}

export function findLayer(design: Design, type: string, side: string): DesignLayer | undefined {
  return design.layers.find((l) => l.type === type && l.side === side);
}

export function pasteLayer(design: Design, side: 'top' | 'bottom'): DesignLayer | undefined {
  return findLayer(design, 'solderpaste', side);
}

/** The raw (unflipped) paste side that actually needs to exist for `side` to be exportable, once `design.flipped` is applied. */
export function physicalPasteSide(design: Design, side: 'top' | 'bottom'): 'top' | 'bottom' {
  if (!design.flipped) return side;
  return side === 'top' ? 'bottom' : 'top';
}

/** Returns the paste layer that will physically face `side` once the design's flip state is applied. */
export function effectivePasteLayer(design: Design, side: 'top' | 'bottom'): DesignLayer | undefined {
  return pasteLayer(design, physicalPasteSide(design, side));
}

/** X-coordinate of the vertical line a flipped design's layers mirror about, keeping its footprint in place. */
export function flipMirrorX(design: Design): number | undefined {
  const box = designLocalBox(design);
  return isEmptyBox(box) ? undefined : (box[0] + box[2]) / 2;
}

/** Local bbox used for the workspace view: the union of every loaded layer. */
export function designLocalBox(design: Design): Box {
  return unionBoxes(design.layers.map((l) => l.image.size));
}

/**
 * Local bbox used for align/distribute math: the board outline if one was
 * loaded (so "align right edges" lines up physical board edges), otherwise
 * the union of the paste layers (top and bottom).
 */
export function alignmentLocalBox(design: Design): Box {
  const outline = findLayer(design, 'outline', 'all') ?? design.layers.find((l) => l.type === 'outline');
  if (outline) return outline.image.size;
  const paste = design.layers.filter((l) => l.type === 'solderpaste');
  if (paste.length > 0) return unionBoxes(paste.map((l) => l.image.size));
  return designLocalBox(design);
}

let nextId = 1;
export function makeDesignId(): string {
  return `design-${nextId++}`;
}
