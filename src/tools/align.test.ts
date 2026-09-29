import { describe, expect, it } from 'vitest';
import { alignHorizontal, alignVertical, distributeEvenly, distributeWithGap, placeAdjacent, worldBox, type Placeable } from './align';

function box(w: number, h: number, x = 0, y = 0, rotation: Placeable['rotation'] = 0): Placeable {
  return { id: `${x},${y}`, x, y, rotation, localBox: [0, 0, w, h] };
}

describe('worldBox', () => {
  it('accounts for rotation and translation', () => {
    const p = box(10, 4, 5, 5, 90);
    // local box [0,0,10,4] rotated 90 CCW about origin -> [-4,0,0,10], + (5,5)
    expect(worldBox(p)).toEqual([1, 5, 5, 15]);
  });
});

describe('alignHorizontal / alignVertical', () => {
  it('aligns left edges without touching y', () => {
    const ref = box(10, 10, 0, 0);
    const target = { ...box(4, 4, 20, 7), id: 't' };
    const [update] = alignHorizontal(ref, [target], 'left');
    expect(update).toEqual({ id: 't', x: 0, y: 7 });
  });

  it('aligns right edges with a margin via placeAdjacent, and matches the plan example', () => {
    // "align to the right side of another layer with a 15mm margin"
    const ref = box(20, 10, 0, 0);
    const target = { ...box(8, 6, 999, 999), id: 't' };
    const update = placeAdjacent(ref, target, 'right', 15);
    expect(update.x).toBe(35); // ref right edge (20) + 15mm margin
    expect(update.y).toBe(999); // y untouched since no alsoAlign was given
  });

  it('placeAdjacent can also align the perpendicular edge in one call', () => {
    const ref = box(20, 10, 0, 0);
    const target = { ...box(8, 6, 999, 999), id: 't' };
    const update = placeAdjacent(ref, target, 'right', 15, 'top');
    expect(update.x).toBe(35);
    expect(update.y).toBe(4); // ref top (10) - target height (6) = 4, so tops match at y=10
  });

  it('aligns top edges (max Y) without touching x', () => {
    const ref = box(10, 10, 0, 0);
    const target = { ...box(4, 4, 7, 20), id: 't' };
    const [update] = alignVertical(ref, [target], 'top');
    expect(update).toEqual({ id: 't', x: 7, y: 6 }); // 10 - 4 = 6
  });

  it('centers horizontally', () => {
    const ref = box(10, 10, 0, 0); // center x = 5
    const target = { ...box(4, 4, 0, 0), id: 't' }; // center should land at x=3 so its own center (3+2=5) = 5
    const [update] = alignHorizontal(ref, [target], 'hcenter');
    expect(update!.x).toBe(3);
  });
});

describe('distributeWithGap', () => {
  it('chains items left-to-right with a fixed edge gap, leaving the first untouched', () => {
    const a = { ...box(10, 10, 0, 0), id: 'a' };
    const b = { ...box(10, 10, 100, 3), id: 'b' }; // out of order on purpose
    const c = { ...box(10, 10, 50, -2), id: 'c' };
    const updates = distributeWithGap([a, b, c], 'horizontal', 5);
    const byId = Object.fromEntries(updates.map((u) => [u.id, u]));
    // sorted order by current x is a(0), c(50), b(100)
    expect(byId.c!.x).toBe(15); // a's right edge (10) + 5mm gap
    expect(byId.c!.y).toBe(-2); // y untouched
    expect(byId.b!.x).toBe(30); // c's new right edge (25) + 5mm gap
  });
});

describe('distributeEvenly', () => {
  it('keeps the first and last fixed and spaces the middle evenly by leading edge', () => {
    const a = { ...box(2, 2, 0, 0), id: 'a' };
    const b = { ...box(2, 2, 40, 0), id: 'b' };
    const mid = { ...box(2, 2, 5, 0), id: 'mid' }; // between a and b, but not evenly spaced yet
    const updates = distributeEvenly([a, mid, b], 'horizontal');
    expect(updates).toEqual([{ id: 'mid', x: 20, y: 0 }]);
  });

  it('does nothing with fewer than 3 items', () => {
    const a = { ...box(2, 2, 0, 0), id: 'a' };
    const b = { ...box(2, 2, 40, 0), id: 'b' };
    expect(distributeEvenly([a, b], 'horizontal')).toEqual([]);
  });
});
