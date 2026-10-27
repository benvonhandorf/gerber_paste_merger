import { describe, expect, it } from 'vitest';
import type { ImageGraphic, ImageTree } from '@tracespace/plotter';
import { BoundingBox } from '@tracespace/plotter';
import { writeLaserSvg } from './exportSvg';

function img(children: ImageGraphic[]): ImageTree {
  return { type: 'image', units: 'mm', size: BoundingBox.fromGraphics(children), children };
}

const rect = (x: number, y: number, xSize: number, ySize: number, r?: number): ImageGraphic => ({
  type: 'imageShape',
  shape: r === undefined ? { type: 'rectangle', x, y, xSize, ySize } : { type: 'rectangle', x, y, xSize, ySize, r },
});

function pathArea(d: string): number {
  const pts = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

describe('writeLaserSvg', () => {
  it('writes circles and rects at true scale, origin-shifted and Y-flipped', () => {
    const { text, skipped } = writeLaserSvg(
      img([{ type: 'imageShape', shape: { type: 'circle', cx: 11, cy: 21, r: 1 } }, rect(15, 20, 2, 1)]),
      0,
    );
    expect(skipped).toBe(0);
    // bbox x 10..17, y 20..22
    expect(text).toContain('width="7mm" height="2mm" viewBox="0 0 7 2"');
    expect(text).toContain('<circle cx="1" cy="1" r="1"/>');
    expect(text).toContain('<rect x="5" y="1" width="2" height="1"/>');
  });

  it('shrinks pads by half the kerf and keeps obround radius', () => {
    const { text } = writeLaserSvg(img([rect(0, 0, 2, 1, 0.5)]), 0.2);
    expect(text).toContain('<rect x="0.1" y="0.1" width="1.8" height="0.8" rx="0.4" ry="0.4"/>');
  });

  it('skips pads that vanish under the kerf', () => {
    const { text, skipped } = writeLaserSvg(img([rect(0, 0, 0.1, 0.1), rect(5, 0, 2, 2)]), 0.2);
    expect(skipped).toBe(1);
    expect(text).not.toContain('width="0.1"');
  });

  it('insets an L-shaped region', () => {
    const L: ImageGraphic = {
      type: 'imageRegion',
      segments: [
        [0, 0, 4, 0],
        [4, 0, 4, 1],
        [4, 1, 1, 1],
        [1, 1, 1, 4],
        [1, 4, 0, 4],
        [0, 4, 0, 0],
      ].map(([a, b, c, d]) => ({ type: 'line' as const, start: [a!, b!] as [number, number], end: [c!, d!] as [number, number] })),
    };
    const exact = writeLaserSvg(img([L]), 0).text.match(/d="([^"]+)"/)![1]!;
    const shrunk = writeLaserSvg(img([L]), 0.2).text.match(/d="([^"]+)"/)![1]!;
    expect(pathArea(exact)).toBeCloseTo(7, 3);
    expect(pathArea(shrunk)).toBeLessThan(7);
    expect(pathArea(shrunk)).toBeGreaterThan(4);
  });

  it('turns a stroked path into a closed outline', () => {
    const stroke: ImageGraphic = {
      type: 'imagePath',
      width: 0.5,
      segments: [{ type: 'line', start: [0, 0], end: [4, 0] }],
    };
    const { text } = writeLaserSvg(img([stroke]), 0);
    const area = pathArea(text.match(/d="([^"]+)"/)![1]!);
    expect(area).toBeGreaterThan(4 * 0.5); // rounded caps add a bit
    expect(area).toBeLessThan(4.5 * 0.5 + 0.1);
  });
});
