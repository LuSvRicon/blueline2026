// ReferencePath — a smooth, closed-loop road centerline.
//
// This is the geometric backbone of the whole simulator. Everything the planner
// and traffic reason about lives in the "Frenet frame" of this path:
//
//     s  = station        -> arc-length distance travelled ALONG the centerline
//     d  = lateral offset  -> signed perpendicular distance from the centerline
//                             (+d = left of travel direction, -d = right)
//
// Working in (s, d) instead of (x, y) is the trick that makes curved-road
// planning tractable: a lane is just "hold d constant", and a lane change is a
// smooth curve in d — regardless of how the road bends in world space.

import { mod } from "../core/math.ts";

export interface FrenetPose {
  s: number;
  d: number;
  index: number; // nearest sample index (useful as a search hint next frame)
}

export interface CartesianPose {
  x: number;
  y: number;
  heading: number; // tangent angle of the centerline (radians)
}

export class ReferencePath {
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  readonly ss: number[] = []; // cumulative arc length at each sample
  readonly headings: number[] = [];
  readonly length: number; // total loop length
  readonly count: number;

  constructor(controlPoints: [number, number][], samplesPerSegment = 60) {
    // Densely sample a closed Catmull-Rom spline through the control points.
    const n = controlPoints.length;
    for (let i = 0; i < n; i++) {
      const p0 = controlPoints[mod(i - 1, n)];
      const p1 = controlPoints[i];
      const p2 = controlPoints[mod(i + 1, n)];
      const p3 = controlPoints[mod(i + 2, n)];
      for (let j = 0; j < samplesPerSegment; j++) {
        const t = j / samplesPerSegment;
        const [x, y] = catmullRom(p0, p1, p2, p3, t);
        this.xs.push(x);
        this.ys.push(y);
      }
    }
    this.count = this.xs.length;

    // Cumulative arc length (closed loop -> last segment wraps to sample 0).
    let acc = 0;
    for (let i = 0; i < this.count; i++) {
      this.ss.push(acc);
      const ni = (i + 1) % this.count;
      const dx = this.xs[ni] - this.xs[i];
      const dy = this.ys[ni] - this.ys[i];
      acc += Math.hypot(dx, dy);
    }
    this.length = acc;

    // Heading at each sample (central difference for smoothness).
    for (let i = 0; i < this.count; i++) {
      const pi = (i - 1 + this.count) % this.count;
      const ni = (i + 1) % this.count;
      const dx = this.xs[ni] - this.xs[pi];
      const dy = this.ys[ni] - this.ys[pi];
      this.headings.push(Math.atan2(dy, dx));
    }
  }

  /** Interpolated world pose (x, y, heading) at a given station s. */
  cartesianAt(s: number): CartesianPose {
    const sw = mod(s, this.length);
    // Binary search for the sample whose cumulative length brackets sw.
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.ss[mid] <= sw) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const ni = (i + 1) % this.count;
    const segLen = (ni === 0 ? this.length : this.ss[ni]) - this.ss[i];
    const t = segLen > 1e-9 ? (sw - this.ss[i]) / segLen : 0;

    const x = this.xs[i] + (this.xs[ni] - this.xs[i]) * t;
    const y = this.ys[i] + (this.ys[ni] - this.ys[i]) * t;
    const heading = this.headings[i] + shortestAngle(this.headings[i], this.headings[ni]) * t;
    return { x, y, heading };
  }

  /** Absolute road curvature |dθ/ds| at station s (1/m). Higher = tighter bend. */
  curvatureAt(s: number): number {
    const ds = 4;
    const h1 = this.cartesianAt(mod(s - ds, this.length)).heading;
    const h2 = this.cartesianAt(mod(s + ds, this.length)).heading;
    let dh = h2 - h1;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh <= -Math.PI) dh += Math.PI * 2;
    return Math.abs(dh) / (2 * ds);
  }

  /** Signed road curvature dθ/ds at station s (left turn positive). */
  signedCurvatureAt(s: number): number {
    const ds = 4;
    const h1 = this.cartesianAt(mod(s - ds, this.length)).heading;
    const h2 = this.cartesianAt(mod(s + ds, this.length)).heading;
    let dh = h2 - h1;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh <= -Math.PI) dh += Math.PI * 2;
    return dh / (2 * ds);
  }

  /** Max curvature over the next `dist` metres from s (for speed planning). */
  maxCurvatureAhead(s: number, dist: number): number {
    let k = 0;
    for (let d = 0; d <= dist; d += 4) k = Math.max(k, this.curvatureAt(s + d));
    return k;
  }

  /** World point offset laterally by d from the centerline at station s. */
  toCartesian(s: number, d: number): { x: number; y: number; heading: number } {
    const { x, y, heading } = this.cartesianAt(s);
    // Left normal of the tangent.
    const nx = -Math.sin(heading);
    const ny = Math.cos(heading);
    return { x: x + nx * d, y: y + ny * d, heading };
  }

  /**
   * Project a world point to Frenet (s, d). `hint` is a sample index near the
   * expected answer (e.g. last frame's index) to keep the search local & cheap;
   * pass -1 to search the whole loop.
   */
  toFrenet(x: number, y: number, hint = -1): FrenetPose {
    let bestI = 0;
    let bestDist = Infinity;

    if (hint >= 0) {
      // Local windowed search around the hint — O(window) instead of O(count).
      const window = 90;
      for (let k = -window; k <= window; k++) {
        const i = mod(hint + k, this.count);
        const dx = x - this.xs[i];
        const dy = y - this.ys[i];
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestI = i;
        }
      }
    } else {
      for (let i = 0; i < this.count; i++) {
        const dx = x - this.xs[i];
        const dy = y - this.ys[i];
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestI = i;
        }
      }
    }

    // Project continuously onto the bracketing polyline segment [segI, segNi]
    // using the interpolated normal h(t) so (s, d) is C⁰ continuous across
    // sample boundaries and accounts for the Frenet metric (1 - κ·d) on curves.
    const hBest = this.headings[bestI];
    const dotBest = (x - this.xs[bestI]) * Math.cos(hBest) + (y - this.ys[bestI]) * Math.sin(hBest);
    const segI = dotBest >= 0 ? bestI : (bestI - 1 + this.count) % this.count;
    const segNi = dotBest >= 0 ? (bestI + 1) % this.count : bestI;
    const x0 = this.xs[segI], y0 = this.ys[segI];
    const x1 = this.xs[segNi], y1 = this.ys[segNi];
    const vx = x1 - x0, vy = y1 - y0;
    const segLen = (segNi === 0 ? this.length : this.ss[segNi]) - this.ss[segI];
    const h0 = this.headings[segI];
    const dh = shortestAngle(h0, this.headings[segNi]);
    const h1 = h0 + dh;
    const f0 = (x - x0) * Math.cos(h0) + (y - y0) * Math.sin(h0);
    const f1 = (x - x1) * Math.cos(h1) + (y - y1) * Math.sin(h1);
    if (f0 >= 0 && f1 <= 0 && f0 - f1 > 1e-9) {
      let t = f0 / (f0 - f1);
      const px = x0 + vx * t, py = y0 + vy * t, ht = h0 + dh * t;
      const tx = Math.cos(ht), ty = Math.sin(ht);
      const rx = x - px, ry = y - py;
      const ft = rx * tx + ry * ty;
      const dtVal = tx * ry - ty * rx;
      const denom = (vx * tx + vy * ty) - dh * dtVal;
      if (denom > 1e-4) t = Math.max(0, Math.min(1, t + ft / denom));
      const fx = x0 + vx * t, fy = y0 + vy * t, fh = h0 + dh * t;
      const ftx = Math.cos(fh), fty = Math.sin(fh);
      const d = ftx * (y - fy) - fty * (x - fx);
      return { s: mod(this.ss[segI] + segLen * t, this.length), d, index: bestI };
    }

    // Fallback far outside the road's radius of curvature (e.g., corner centers).
    const tx = Math.cos(hBest);
    const ty = Math.sin(hBest);
    const rx = x - this.xs[bestI];
    const ry = y - this.ys[bestI];
    const d = tx * ry - ty * rx; // left-positive
    const along = tx * rx + ty * ry;
    return { s: mod(this.ss[bestI] + along, this.length), d, index: bestI };
  }
}

function catmullRom(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

/** Signed shortest angular delta from a to b, in (-pi, pi]. */
function shortestAngle(a: number, b: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff <= -Math.PI) diff += Math.PI * 2;
  return diff;
}
