import { renderFragment } from '@tracespace/renderer';
import type { Design } from '../model';
import { designLocalBox, flipMirrorX } from '../model';
import { isEmptyBox, worldBBox } from '../gerber/bbox';
import type { Rotation90 } from '../gerber/geometry';
import { hastToSvg } from './hastToDom';

const SVG_NS = 'http://www.w3.org/2000/svg';

function layerColor(type: string, side: string): string {
  if (type === 'solderpaste') return side === 'bottom' ? '#4fa8e0' : '#e2a13a';
  if (type === 'outline') return '#9aa0a6';
  if (type === 'silkscreen') return '#e8e8e8';
  if (type === 'soldermask') return '#2d6a4f';
  if (type === 'copper') return '#c87137';
  return '#888888';
}

/**
 * `@tracespace/renderer` already flips Y for on-screen display (its output
 * coordinates are (localX, -localY)), so a design's cached content lives in
 * that pre-flipped space, not raw Gerber (Y-up) space. The matrices below
 * are the placement transform (rotate by a 90-degree step about the local
 * origin, then translate to (x, y)) re-derived to take that pre-flipped
 * input directly, so the world coordinate math in gerber/transform.ts and
 * tools/align.ts (which *does* work in true Y-up mm) never has to change.
 * Screen space itself is also Y-flipped (screenY = -worldY), i.e. "up" on
 * screen matches increasing Gerber Y, the normal PCB-tool convention.
 */
const RENDER_MATRIX: Record<Rotation90, [number, number, number, number]> = {
  0: [1, 0, 0, 1],
  90: [0, -1, 1, 0],
  180: [-1, 0, 0, -1],
  270: [0, 1, -1, 0],
};

function placementTransform(rotation: Rotation90, x: number, y: number): string {
  const [a, b, c, d] = RENDER_MATRIX[rotation];
  return `matrix(${a} ${b} ${c} ${d} ${x} ${-y})`;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WorkspaceCallbacks {
  onSelectionChange(ids: string[]): void;
  /** Fired right before a move-drag starts mutating placement, so the caller can push one undo step for the whole gesture. */
  onDragStart(ids: string[]): void;
  /** Fired once a move-drag that changed placement has settled - just refresh any numeric fields, history was already pushed at drag start. */
  onCommit(): void;
  onCursorMove?(worldX: number, worldY: number): void;
}

type DragState =
  | { kind: 'pan'; startClientX: number; startClientY: number; startVB: ViewBox }
  | { kind: 'move'; ids: string[]; startClientX: number; startClientY: number; start: Map<string, { x: number; y: number }> };

const MIN_VB_W = 2;
const MAX_VB_W = 20000;

export class Workspace {
  readonly svg: SVGSVGElement;
  private readonly gridLayer: SVGGElement;
  private readonly designsLayer: SVGGElement;
  private readonly overlayLayer: SVGGElement;
  private readonly contentCache = new Map<string, SVGGElement>();
  private viewBox: ViewBox = { x: -20, y: -120, w: 220, h: 160 };
  private designs: Design[] = [];
  private selected = new Set<string>();
  private callbacks: WorkspaceCallbacks;
  private gridMm = 0;
  private drag: DragState | null = null;
  private didDrag = false;

  constructor(callbacks: WorkspaceCallbacks) {
    this.callbacks = callbacks;
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('width', '100%');
    this.svg.setAttribute('height', '100%');
    this.svg.style.touchAction = 'none';
    this.svg.style.display = 'block';
    this.svg.style.background = '#14171a';

    this.gridLayer = document.createElementNS(SVG_NS, 'g');
    this.designsLayer = document.createElementNS(SVG_NS, 'g');
    this.overlayLayer = document.createElementNS(SVG_NS, 'g');
    this.svg.append(this.gridLayer, this.designsLayer, this.overlayLayer);

    this.applyViewBox();
    this.svg.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.svg.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.svg.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.svg.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    this.svg.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  setGridMm(mm: number): void {
    this.gridMm = mm;
    this.drawGrid();
  }

  zoomToFit(): void {
    const boxes = this.designs.filter((d) => d.visible).map((d) => designLocalBoxWorld(d));
    const real = boxes.filter((b) => !isEmptyBox(b));
    if (real.length === 0) return;
    const x1 = Math.min(...real.map((b) => b[0]));
    const y1 = Math.min(...real.map((b) => b[1]));
    const x2 = Math.max(...real.map((b) => b[2]));
    const y2 = Math.max(...real.map((b) => b[3]));
    const pad = Math.max(10, (x2 - x1) * 0.1, (y2 - y1) * 0.1);
    this.viewBox = { x: x1 - pad, y: -(y2 + pad), w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
    this.applyViewBox();
  }

  /** Full re-render: call after designs are added/removed, or visibility/layer content changes. */
  render(designs: Design[], selected: Set<string>): void {
    this.designs = designs;
    this.selected = selected;
    for (const id of [...this.contentCache.keys()]) {
      if (!designs.some((d) => d.id === id)) this.contentCache.delete(id);
    }
    this.designsLayer.replaceChildren();
    for (const design of designs) {
      if (!design.visible) continue;
      this.designsLayer.appendChild(this.buildPlacementGroup(design));
    }
    this.drawGrid();
    this.drawSelection();
  }

  /** Cheap update after a design's x/y/rotation changed (drag, align, numeric field) without rebuilding cached content. */
  updatePlacement(design: Design): void {
    const group = this.designsLayer.querySelector<SVGGElement>(`[data-design-id="${cssEscape(design.id)}"]`);
    if (group) group.setAttribute('transform', placementTransform(design.rotation, design.x, design.y));
    this.drawSelection();
  }

  private buildContent(design: Design): SVGGElement {
    const g = document.createElementNS(SVG_NS, 'g');
    for (const layer of design.layers) {
      const layerGroup = document.createElementNS(SVG_NS, 'g');
      const color = layerColor(layer.type, layer.side);
      layerGroup.setAttribute('fill', color);
      layerGroup.setAttribute('stroke', color);
      layerGroup.setAttribute('fill-rule', 'evenodd');
      layerGroup.setAttribute('clip-rule', 'evenodd');
      layerGroup.setAttribute('stroke-linecap', 'round');
      layerGroup.setAttribute('stroke-linejoin', 'round');
      layerGroup.setAttribute('stroke-width', '0');
      layerGroup.setAttribute('opacity', layer.type === 'solderpaste' ? '0.95' : '0.5');
      layerGroup.appendChild(hastToSvg(renderFragment(layer.image)));
      g.appendChild(layerGroup);
    }
    return g;
  }

  private buildPlacementGroup(design: Design): SVGGElement {
    let content = this.contentCache.get(design.id);
    if (!content) {
      content = this.buildContent(design);
      this.contentCache.set(design.id, content);
    }
    const group = document.createElementNS(SVG_NS, 'g');
    group.dataset.designId = design.id;
    group.setAttribute('transform', placementTransform(design.rotation, design.x, design.y));

    const box = designLocalBox(design);
    const hit = document.createElementNS(SVG_NS, 'rect');
    hit.setAttribute('fill', 'transparent');
    if (!isEmptyBox(box)) {
      hit.setAttribute('x', String(box[0]));
      hit.setAttribute('y', String(-box[3]));
      hit.setAttribute('width', String(box[2] - box[0]));
      hit.setAttribute('height', String(box[3] - box[1]));
    }
    (hit.style as CSSStyleDeclaration).cursor = 'move';

    const contentNode = content.cloneNode(true) as SVGGElement;
    if (design.flipped) {
      const mirrorX = flipMirrorX(design);
      // Mirrors in place (about the design's own footprint center) so
      // flipping doesn't shift where it sits; matches the export transform.
      if (mirrorX !== undefined) contentNode.setAttribute('transform', `matrix(-1 0 0 1 ${2 * mirrorX} 0)`);
    }

    group.append(hit, contentNode);
    return group;
  }

  private drawGrid(): void {
    this.gridLayer.replaceChildren();
    if (this.gridMm <= 0) return;
    const { x, y, w, h } = this.viewBox;
    const step = pickGridStep(this.gridMm, w);
    const startX = Math.floor(x / step) * step;
    const endX = x + w;
    const startY = Math.floor(y / step) * step;
    const endY = y + h;
    const frag = document.createDocumentFragment();
    for (let gx = startX; gx <= endX; gx += step) {
      frag.appendChild(gridLine(gx, y, gx, endY, isNear(gx, 0)));
    }
    for (let gy = startY; gy <= endY; gy += step) {
      frag.appendChild(gridLine(x, gy, endX, gy, isNear(gy, 0)));
    }
    this.gridLayer.appendChild(frag);
  }

  private drawSelection(): void {
    this.overlayLayer.replaceChildren();
    for (const design of this.designs) {
      if (!design.visible || !this.selected.has(design.id)) continue;
      const box = worldBBox(designLocalBox(design), design.rotation, design.x, design.y);
      if (isEmptyBox(box)) continue;
      const [x1, y1, x2, y2] = box;
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(x1));
      rect.setAttribute('y', String(-y2));
      rect.setAttribute('width', String(x2 - x1));
      rect.setAttribute('height', String(y2 - y1));
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', '#5fb3ff');
      rect.setAttribute('stroke-width', String(this.viewBox.w * 0.0015));
      rect.setAttribute('stroke-dasharray', `${this.viewBox.w * 0.006} ${this.viewBox.w * 0.004}`);
      this.overlayLayer.appendChild(rect);
    }
  }

  private applyViewBox(): void {
    const { x, y, w, h } = this.viewBox;
    this.svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  }

  private toWorkspacePoint(evt: PointerEvent | WheelEvent): { x: number; y: number } {
    const pt = this.svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  private designIdAt(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    const group = target.closest<SVGGElement>('[data-design-id]');
    return group?.dataset.designId ?? null;
  }

  private onPointerDown(evt: PointerEvent): void {
    if (evt.button !== 0) return;
    this.svg.setPointerCapture(evt.pointerId);
    this.didDrag = false;
    const id = this.designIdAt(evt.target);

    if (id) {
      let ids: string[];
      if (evt.shiftKey || evt.metaKey || evt.ctrlKey) {
        ids = this.selected.has(id) ? [...this.selected] : [...this.selected, id];
        if (!this.selected.has(id)) this.callbacks.onSelectionChange(ids);
      } else if (this.selected.has(id)) {
        ids = [...this.selected];
      } else {
        ids = [id];
        this.callbacks.onSelectionChange(ids);
      }
      const start = new Map<string, { x: number; y: number }>();
      for (const did of ids) {
        const d = this.designs.find((dd) => dd.id === did);
        if (d) start.set(did, { x: d.x, y: d.y });
      }
      this.callbacks.onDragStart(ids);
      this.drag = { kind: 'move', ids, startClientX: evt.clientX, startClientY: evt.clientY, start };
    } else {
      this.drag = { kind: 'pan', startClientX: evt.clientX, startClientY: evt.clientY, startVB: { ...this.viewBox } };
    }
  }

  private onPointerMove(evt: PointerEvent): void {
    const world = this.toWorkspacePoint(evt);
    this.callbacks.onCursorMove?.(world.x, -world.y);
    if (!this.drag) return;

    const dxClient = evt.clientX - this.drag.startClientX;
    const dyClient = evt.clientY - this.drag.startClientY;
    if (Math.abs(dxClient) > 2 || Math.abs(dyClient) > 2) this.didDrag = true;
    const rect = this.svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const scaleX = this.viewBox.w / rect.width;
    const scaleY = this.viewBox.h / rect.height;

    if (this.drag.kind === 'pan') {
      this.viewBox = {
        ...this.drag.startVB,
        x: this.drag.startVB.x - dxClient * scaleX,
        y: this.drag.startVB.y - dyClient * scaleY,
      };
      this.applyViewBox();
      this.drawGrid();
      return;
    }

    let dxWorld = dxClient * scaleX;
    let dyWorld = -(dyClient * scaleY);
    if (this.gridMm > 0) {
      dxWorld = Math.round(dxWorld / this.gridMm) * this.gridMm;
      dyWorld = Math.round(dyWorld / this.gridMm) * this.gridMm;
    }
    for (const id of this.drag.ids) {
      const design = this.designs.find((d) => d.id === id);
      const start = this.drag.start.get(id);
      if (!design || !start) continue;
      design.x = start.x + dxWorld;
      design.y = start.y + dyWorld;
      this.updatePlacement(design);
    }
  }

  private onPointerUp(evt: PointerEvent): void {
    if (this.svg.hasPointerCapture(evt.pointerId)) this.svg.releasePointerCapture(evt.pointerId);
    const wasMove = this.drag?.kind === 'move';
    const wasClickNoMove = !this.didDrag;
    const clickedEmpty = !this.designIdAt(evt.target);
    this.drag = null;
    if (wasMove && this.didDrag) this.callbacks.onCommit();
    if (wasClickNoMove && clickedEmpty && !evt.shiftKey && !evt.metaKey && !evt.ctrlKey) {
      this.callbacks.onSelectionChange([]);
    }
  }

  private onWheel(evt: WheelEvent): void {
    evt.preventDefault();
    const factor = Math.exp(evt.deltaY * 0.0015);
    const before = this.toWorkspacePoint(evt);
    const newW = clamp(this.viewBox.w * factor, MIN_VB_W, MAX_VB_W);
    const scale = newW / this.viewBox.w;
    const newH = this.viewBox.h * scale;
    this.viewBox = {
      x: before.x - (before.x - this.viewBox.x) * scale,
      y: before.y - (before.y - this.viewBox.y) * scale,
      w: newW,
      h: newH,
    };
    this.applyViewBox();
    this.drawGrid();
    this.drawSelection();
  }
}

function designLocalBoxWorld(design: Design) {
  return worldBBox(designLocalBox(design), design.rotation, design.x, design.y);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function pickGridStep(baseMm: number, viewportWidthMm: number): number {
  // Thin out the grid at low zoom so it doesn't turn into visual noise.
  let step = baseMm;
  while (viewportWidthMm / step > 80) step *= 5;
  return step;
}

function isNear(v: number, target: number): boolean {
  return Math.abs(v - target) < 1e-6;
}

function gridLine(x1: number, y1: number, x2: number, y2: number, axis: boolean): SVGLineElement {
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(x1));
  line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2));
  line.setAttribute('y2', String(y2));
  line.setAttribute('stroke', axis ? '#4a5560' : '#262b31');
  line.setAttribute('stroke-width', axis ? '0.3' : '0.1');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  return line;
}

function cssEscape(id: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
