import { describe, expect, it } from 'vitest';
import { mirrorAngle, mirrorPointAboutX, normalizeRotation, rotateAndTranslate, rotateAngle, rotatePoint, swapsAxes } from './geometry';

describe('normalizeRotation', () => {
  it('snaps to the nearest 90-degree step and wraps into [0, 360)', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-360)).toBe(0);
  });
});

describe('rotatePoint', () => {
  it('is exact (no floating point noise) at every 90-degree step', () => {
    expect(rotatePoint([2, 3], 0)).toEqual([2, 3]);
    expect(rotatePoint([2, 3], 90)).toEqual([-3, 2]);
    expect(rotatePoint([2, 3], 180)).toEqual([-2, -3]);
    expect(rotatePoint([2, 3], 270)).toEqual([3, -2]);
  });
});

describe('rotateAndTranslate', () => {
  it('rotates about the origin first, then translates', () => {
    expect(rotateAndTranslate([1, 0], 90, 10, 20)).toEqual([10, 21]);
  });
});

describe('rotateAngle', () => {
  it('adds the rotation without wrapping, preserving arc sweep direction/magnitude', () => {
    // A CCW full circle is start=0, end=2*PI (not end=0) - rotating must not
    // collapse that back into an ambiguous/zero-length sweep.
    const start = 0;
    const end = Math.PI * 2;
    expect(rotateAngle(start, 90)).toBeCloseTo(Math.PI / 2);
    expect(rotateAngle(end, 90)).toBeCloseTo(Math.PI * 2 + Math.PI / 2);
    expect(rotateAngle(end, 90) - rotateAngle(start, 90)).toBeCloseTo(end - start);
  });
});

describe('swapsAxes', () => {
  it('is true only for 90 and 270', () => {
    expect(swapsAxes(0)).toBe(false);
    expect(swapsAxes(90)).toBe(true);
    expect(swapsAxes(180)).toBe(false);
    expect(swapsAxes(270)).toBe(true);
  });
});

describe('mirrorPointAboutX', () => {
  it('reflects across the given vertical line, leaving y untouched', () => {
    expect(mirrorPointAboutX([2, 3], 0)).toEqual([-2, 3]);
    expect(mirrorPointAboutX([2, 3], 10)).toEqual([18, 3]);
  });

  it('leaves a point already on the mirror line in place', () => {
    expect(mirrorPointAboutX([5, 7], 5)).toEqual([5, 7]);
  });
});

describe('mirrorAngle', () => {
  it('reflects an angle across the vertical axis regardless of the mirror line position', () => {
    expect(mirrorAngle(0)).toBeCloseTo(Math.PI);
    expect(mirrorAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(mirrorAngle(Math.PI)).toBeCloseTo(0);
  });

  it('flips a sweep\'s sign, matching how reflection reverses rotational direction', () => {
    const start = 0;
    const end = Math.PI * 2;
    expect(mirrorAngle(end) - mirrorAngle(start)).toBeCloseTo(-(end - start));
  });
});
