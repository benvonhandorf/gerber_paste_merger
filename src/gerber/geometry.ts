/** Shared 2D geometry helpers used by the transform and write pipeline. */

/** A 2D point, matching the plotter's `[x, y]` tuple convention. */
export type Pt = [number, number];

/** Rotation is restricted to 90-degree steps so shapes stay axis-aligned. */
export type Rotation90 = 0 | 90 | 180 | 270;

/** Normalizes any integer degree value into 0/90/180/270. */
export function normalizeRotation(deg: number): Rotation90 {
  const mod = ((Math.round(deg / 90) * 90) % 360) + (deg < 0 ? 360 : 0);
  return (((mod % 360) + 360) % 360) as Rotation90;
}

/**
 * Exact sin/cos for 90-degree steps, avoiding the floating point noise
 * `Math.cos(Math.PI / 2)` produces (e.g. 6.12e-17 instead of 0). Exactness
 * here matters downstream: it keeps rotated rectangles axis-aligned and lets
 * the writer dedupe apertures by comparing rounded numbers.
 */
const ROTATION_TABLE: Record<Rotation90, { cos: number; sin: number }> = {
  0: { cos: 1, sin: 0 },
  90: { cos: 0, sin: 1 },
  180: { cos: -1, sin: 0 },
  270: { cos: 0, sin: -1 },
};

/** Rotates a point counterclockwise about the origin by a 90-degree step. */
export function rotatePoint([x, y]: Pt, rotation: Rotation90): Pt {
  const { cos, sin } = ROTATION_TABLE[rotation];
  return [x * cos - y * sin, x * sin + y * cos];
}

/** Rotates about the origin, then translates. */
export function rotateAndTranslate([x, y]: Pt, rotation: Rotation90, dx: number, dy: number): Pt {
  const [rx, ry] = rotatePoint([x, y], rotation);
  return [rx + dx, ry + dy];
}

const HALF_PI = Math.PI / 2;

/**
 * Rotates an arc-position angle (radians) by a 90-degree step.
 *
 * Deliberately does NOT wrap into [0, 2*PI): the plotter encodes a full
 * sweep's direction and magnitude as `end.theta - start.theta` and lets
 * that value run past 2*PI or below 0 rather than wrapping it (e.g. a CCW
 * full circle is `start=0, end=2*PI`, not `end=0`). Wrapping here would
 * silently flip arc directions after rotation.
 */
export function rotateAngle(theta: number, rotation: Rotation90): number {
  return theta + (rotation / 90) * HALF_PI;
}

/** True when a rotation swaps the roles of the X and Y axes (90 or 270). */
export function swapsAxes(rotation: Rotation90): boolean {
  return rotation === 90 || rotation === 270;
}

/**
 * Mirrors a point across the vertical line x = mirrorX (left-right flip),
 * modeling a physical "flip the board over" about a vertical hinge.
 * Combined with a 90-degree rotation this reaches every orientation a
 * rotation-plus-mirror (dihedral) placement can produce, so one mirror axis
 * is enough - a top-to-bottom flip is just this mirror plus a 180 rotation.
 */
export function mirrorPointAboutX([x, y]: Pt, mirrorX: number): Pt {
  return [2 * mirrorX - x, y];
}

/**
 * Mirrors an arc-position angle (radians) to match `mirrorPointAboutX`.
 * Reflecting the (cos theta, sin theta) direction across a vertical line
 * negates its X component, i.e. replaces theta with PI - theta - the result
 * doesn't depend on where that vertical line sits, only its orientation.
 */
export function mirrorAngle(theta: number): number {
  return Math.PI - theta;
}
