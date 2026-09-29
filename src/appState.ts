import type { Design } from './model';
import type { Rotation90 } from './gerber/geometry';

interface PlacementSnapshot {
  id: string;
  x: number;
  y: number;
  rotation: Rotation90;
  flipped: boolean;
}

/**
 * Central mutable app state. Kept as a plain class (not a framework store):
 * callers mutate it through these methods, then trigger a re-render
 * themselves. Undo/redo intentionally only tracks placement (x/y/rotation),
 * not which designs are loaded - see the plan for why that's enough.
 */
export class AppState {
  designs: Design[] = [];
  selected = new Set<string>();
  exportSide: 'top' | 'bottom' = 'top';
  gridMm = 1;

  private undoStack: PlacementSnapshot[][] = [];
  private redoStack: PlacementSnapshot[][] = [];

  get referenceId(): string | null {
    return this.selected.values().next().value ?? null;
  }

  get referenceDesign(): Design | null {
    const id = this.referenceId;
    return id ? (this.designs.find((d) => d.id === id) ?? null) : null;
  }

  get selectedDesigns(): Design[] {
    return this.designs.filter((d) => this.selected.has(d.id));
  }

  private snapshot(): PlacementSnapshot[] {
    return this.designs.map((d) => ({ id: d.id, x: d.x, y: d.y, rotation: d.rotation, flipped: d.flipped }));
  }

  /** Call after a placement-changing action (drag end, align, distribute, rotate, numeric edit) settles. */
  pushHistory(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(this.snapshot());
    this.applySnapshot(this.undoStack.pop()!);
    return true;
  }

  redo(): boolean {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(this.snapshot());
    this.applySnapshot(this.redoStack.pop()!);
    return true;
  }

  private applySnapshot(snap: PlacementSnapshot[]): void {
    for (const s of snap) {
      const d = this.designs.find((dd) => dd.id === s.id);
      if (d) {
        d.x = s.x;
        d.y = s.y;
        d.rotation = s.rotation;
        d.flipped = s.flipped;
      }
    }
  }

  addDesigns(designs: Design[]): void {
    this.pushHistory();
    this.designs.push(...designs);
    this.selected = new Set(designs.map((d) => d.id));
  }

  removeDesign(id: string): void {
    this.pushHistory();
    this.designs = this.designs.filter((d) => d.id !== id);
    this.selected.delete(id);
  }

  select(ids: string[]): void {
    this.selected = new Set(ids);
  }

  toggleSelect(id: string): void {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
  }

  selectAll(): void {
    this.selected = new Set(this.designs.map((d) => d.id));
  }

  rotateSelected(deltaDeg: 90 | -90): void {
    this.pushHistory();
    const table: Record<Rotation90, Rotation90> = { 0: 90, 90: 180, 180: 270, 270: 0 };
    const tableBack: Record<Rotation90, Rotation90> = { 0: 270, 90: 0, 180: 90, 270: 180 };
    for (const d of this.selectedDesigns) {
      d.rotation = deltaDeg === 90 ? table[d.rotation] : tableBack[d.rotation];
    }
  }

  flipSelected(): void {
    this.pushHistory();
    for (const d of this.selectedDesigns) {
      d.flipped = !d.flipped;
    }
  }

  nudgeSelected(dxMm: number, dyMm: number): void {
    this.pushHistory();
    for (const d of this.selectedDesigns) {
      d.x += dxMm;
      d.y += dyMm;
    }
  }

  /** Applies align/distribute results (each `{id, x, y}`) as one undo step. */
  applyPlacementUpdates(updates: Array<{ id: string; x: number; y: number }>): void {
    if (updates.length === 0) return;
    this.pushHistory();
    for (const u of updates) {
      const d = this.designs.find((dd) => dd.id === u.id);
      if (d) {
        d.x = u.x;
        d.y = u.y;
      }
    }
  }
}
