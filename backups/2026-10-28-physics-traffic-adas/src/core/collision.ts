/** Axis-aligned overlap in the road Frenet frame (station `s`, offset `d`). */

export function frenetBoxesOverlap(
  ds: number,
  dd: number,
  lengthA: number,
  widthA: number,
  lengthB: number,
  widthB: number,
  margin = 0.05,
): boolean {
  return Math.abs(ds) < (lengthA + lengthB) / 2 + margin && Math.abs(dd) < (widthA + widthB) / 2 + margin;
}

export function bumperGap(ds: number, lengthA: number, lengthB: number): number {
  return Math.abs(ds) - (lengthA + lengthB) / 2;
}

export interface Body2D {
  x: number; y: number; yaw: number; length: number; width: number;
}
export interface BodyContact { nx: number; ny: number; depth: number }
export interface SweptContact { time: number; nx: number; ny: number }

function axes(body: Body2D): [number, number][] {
  const c = Math.cos(body.yaw), s = Math.sin(body.yaw);
  return [[c, s], [-s, c]];
}
function radius(body: Body2D, nx: number, ny: number): number {
  const c = Math.cos(body.yaw), s = Math.sin(body.yaw);
  return Math.abs(nx * c + ny * s) * body.length / 2 + Math.abs(-nx * s + ny * c) * body.width / 2;
}

/** Separating-axis test; the normal points from B toward A. */
export function bodyContact(a: Body2D, b: Body2D, margin = .025): BodyContact | null {
  let result: BodyContact | null = null;
  for (const [nx, ny] of [...axes(a), ...axes(b)]) {
    const projection = (a.x - b.x) * nx + (a.y - b.y) * ny;
    const depth = radius(a, nx, ny) + radius(b, nx, ny) + margin - Math.abs(projection);
    if (depth <= 1e-7) return null;
    if (!result || depth < result.depth) {
      const sign = projection < 0 ? -1 : 1;
      result = { nx: nx * sign, ny: ny * sign, depth };
    }
  }
  return result;
}

function angleDelta(a: number, b: number): number { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); }
export function interpolateBody(a: Body2D, b: Body2D, time: number): Body2D {
  return { ...a, x: a.x + (b.x - a.x) * time, y: a.y + (b.y - a.y) * time, yaw: a.yaw + angleDelta(a.yaw, b.yaw) * time };
}

/** Continuous translation SAT with short angular segments and conservative
 * rotation bounds. Tests the motion between poses, so a fast crossing actor
 * cannot pass through a body just because the two end poses do not overlap. */
export function sweepBodies(a0: Body2D, a1: Body2D, b0: Body2D, b1: Body2D, margin = .025): SweptContact | null {
  const angle = Math.max(Math.abs(angleDelta(a0.yaw, a1.yaw)), Math.abs(angleDelta(b0.yaw, b1.yaw)));
  const segments = Math.max(1, Math.ceil(angle / .025));
  for (let i = 0; i < segments; i++) {
    const start = i / segments, end = (i + 1) / segments;
    const a = interpolateBody(a0, a1, start), b = interpolateBody(b0, b1, start);
    const am = interpolateBody(a0, a1, (start + end) / 2), bm = interpolateBody(b0, b1, (start + end) / 2);
    const rotationMargin = (Math.hypot(a.length, a.width) + Math.hypot(b.length, b.width)) * Math.sin(angle / segments / 2) / 2;
    let enter = 0, exit = 1, normalX = 0, normalY = 0;
    const vx = ((a1.x - a0.x) - (b1.x - b0.x)) / segments;
    const vy = ((a1.y - a0.y) - (b1.y - b0.y)) / segments;
    for (const [nx, ny] of [...axes(am), ...axes(bm)]) {
      const distance = (a.x - b.x) * nx + (a.y - b.y) * ny;
      const velocity = vx * nx + vy * ny;
      const extent = radius(am, nx, ny) + radius(bm, nx, ny) + margin + rotationMargin;
      if (Math.abs(velocity) < 1e-10) {
        if (Math.abs(distance) > extent) { exit = -1; break; }
        continue;
      }
      let near = (-extent - distance) / velocity, far = (extent - distance) / velocity;
      if (near > far) [near, far] = [far, near];
      if (near > enter) { enter = near; const sign = distance + velocity * near < 0 ? -1 : 1; normalX = nx * sign; normalY = ny * sign; }
      exit = Math.min(exit, far);
      if (enter > exit) break;
    }
    if (enter <= exit && exit >= 0 && enter <= 1) {
      const penetration = bodyContact(a, b, margin);
      if (exit <= 1e-8 && !penetration) continue;
      const haveNormal = Math.hypot(normalX, normalY) > .5;
      return { time: start + Math.max(0, enter) / segments, nx: haveNormal ? normalX : penetration?.nx ?? 0, ny: haveNormal ? normalY : penetration?.ny ?? 0 };
    }
  }
  return null;
}
