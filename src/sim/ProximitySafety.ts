import { ReferencePath } from "../world/ReferencePath.ts";
import { Vehicle } from "../vehicle/Vehicle.ts";
import { Obstacle } from "../planner/Trajectory.ts";
import { ASSISTANCE_REFERENCE as REF } from './AssistancePolicy.ts';

/** Idealised short-range radar/ultrasonic model; distances are body clearances. */
export function proximitySafety(ego: Vehicle, path: ReferencePath, obstacles: Obstacle[], reverse: boolean) {
  let front: number | null = null, rear: number | null = null;
  let left: number | null = null, right: number | null = null;
  let rctaLeft = false, rctaRight = false, rearAeb = false, crossBrake = false, parkingBrake = false;
  const c = Math.cos(ego.yaw), s = Math.sin(ego.yaw);
  for (const o of obstacles) {
    const w = path.toCartesian(o.s, o.d);
    const x = (w.x - ego.x) * c + (w.y - ego.y) * s;
    const y = -(w.x - ego.x) * s + (w.y - ego.y) * c;
    const angle = w.heading - ego.yaw;
    const hx = (Math.abs(Math.cos(angle)) * o.length + Math.abs(Math.sin(angle)) * o.width) / 2;
    const hy = (Math.abs(Math.sin(angle)) * o.length + Math.abs(Math.cos(angle)) * o.width) / 2;
    const gx = Math.max(0, Math.abs(x) - ego.dims.length / 2 - hx);
    const gy = Math.max(0, Math.abs(y) - ego.dims.width / 2 - hy);
    if (Math.abs(y) < hy + ego.dims.width / 2 + .3 && gx <= 5) {
      if (x > 0) front = Math.min(front ?? Infinity, gx);
      else rear = Math.min(rear ?? Infinity, gx);
    }
    if (Math.abs(x) < hx + ego.dims.length / 2 + .3 && gy <= 3) {
      if (y > 0) right = Math.min(right ?? Infinity, gy);
      else left = Math.min(left ?? Infinity, gy);
    }
    if (!reverse || x > .2 || x < -15) continue;
    const vx = Math.cos(angle) * o.v - Math.sin(angle) * o.vd;
    const vy = Math.sin(angle) * o.v + Math.cos(angle) * o.vd;
    const closing = ego.v + vx;
    const ttc = closing > .1 ? gx / closing : Infinity;
    const stopDistance = Math.max(2.5, ego.v ** 2 / (2 * Math.max(ego.maxDecel * ego.surfaceMu, 1)) + ego.v * .4 + 1.2);
    const predictionTime = Math.min(3, Number.isFinite(ttc) ? Math.max(.3, ttc) : 2);
    const predictedY = y + vy * predictionTime;
    const entersCorridor = Math.abs(predictedY) < hy + ego.dims.width / 2 + .6 || y * predictedY <= 0;
    const crossing = Math.abs(vy) > .25 && (y * vy < 0 || Math.abs(y) < hy + ego.dims.width / 2);
    const crossTime = Math.max(0, Math.abs(y) - hy - ego.dims.width / 2) / Math.max(Math.abs(vy), .01);
    const rctaEligible = ego.v * 3.6 < REF.rctaMaxKph && Math.hypot(vx, vy) * 3.6 > REF.rctaTargetMinKph;
    if (rctaEligible && crossing && crossTime < 3 && Math.abs(y) < REF.rctaRange) {
      if (y < -.15) rctaLeft = true;
      if (y > .15) rctaRight = true;
    }
    const overlapsNow = Math.abs(y) < hy + ego.dims.width / 2 + .3;
    // A target pulling away faster than our reverse motion is not approaching
    // the rear bumper, even when it remains within the near sensor zone.
    if (closing >= -.1 && gx < stopDistance) {
      // Cross-traffic braking and low-speed obstacle braking are separate:
      // a parked wall does not become a moving cross-traffic alert.
      crossBrake ||= rctaEligible && crossing && ((entersCorridor && ttc < 2) || crossTime < 1);
      // BlueLine obstacle-braking extension covers the simulator's entire
      // reverse envelope (capped at 16.2 km/h). Do not gate it at RCTA's 8 km/h:
      // doing so would let the car accelerate past the gate before reaching a wall.
      parkingBrake ||= overlapsNow;
    }
  }
  rearAeb = crossBrake || parkingBrake;
  return { front, rear, left, right, rctaLeft, rctaRight, rearAeb, crossBrake, parkingBrake };
}
