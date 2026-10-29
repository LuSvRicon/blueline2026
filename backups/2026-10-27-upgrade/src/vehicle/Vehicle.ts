// Kinematic bicycle model — the standard low-speed vehicle model used across
// autonomous-driving research and teaching. State is (x, y, yaw, v); inputs are
// steering angle `delta` and longitudinal acceleration `a`.
//
//   x'   = v cos(yaw)
//   y'   = v sin(yaw)
//   yaw' = v / L * tan(delta)      (L = wheelbase)
//   v'   = a
//
// It captures the nonholonomic "can't move sideways" constraint that makes
// steering feel real, while staying simple enough to integrate at 60 Hz.

import { clamp } from "../core/math.ts";

export interface VehicleDims {
  length: number;
  width: number;
  wheelbase: number;
}

export const EGO_DIMS: VehicleDims = { length: 4.7, width: 2.0, wheelbase: 2.8 };

export class Vehicle {
  x: number;
  y: number;
  yaw: number;
  v: number;
  a = 0; // last applied acceleration (for telemetry / planner seeding)
  delta = 0; // last applied steering angle

  readonly dims: VehicleDims;
  readonly maxSteer: number;
  readonly maxAccel: number;
  readonly maxDecel: number;
  readonly maxSpeed: number;
  /** Road-surface friction multiplier (1 = dry, <1 rain/fog). */
  surfaceMu = 1;

  constructor(
    x: number,
    y: number,
    yaw: number,
    v: number,
    dims: VehicleDims = EGO_DIMS,
    opts: Partial<{ maxSteer: number; maxAccel: number; maxDecel: number; maxSpeed: number }> = {},
  ) {
    this.x = x;
    this.y = y;
    this.yaw = yaw;
    this.v = v;
    this.dims = dims;
    this.maxSteer = opts.maxSteer ?? (35 * Math.PI) / 180;
    this.maxAccel = opts.maxAccel ?? 3.5;
    this.maxDecel = opts.maxDecel ?? 7.0;
    this.maxSpeed = opts.maxSpeed ?? 40;
  }

  /** Integrate one step. Direction is -1 for reverse while speed stays unsigned. */
  step(steer: number, accel: number, dt: number, direction: -1 | 1 = 1): void {
    this.delta = clamp(steer, -this.maxSteer, this.maxSteer);
    this.a = clamp(accel, -this.maxDecel, this.maxAccel);
    const mu = clamp(this.surfaceMu, 0.35, 1);
    const applied = clamp(this.a, -this.maxDecel * mu, this.maxAccel * mu);

    this.v = clamp(this.v + applied * dt, 0, this.maxSpeed);
    this.x += direction * this.v * Math.cos(this.yaw) * dt;
    this.y += direction * this.v * Math.sin(this.yaw) * dt;
    this.yaw += (direction * this.v / this.dims.wheelbase) * Math.tan(this.delta) * dt;

    // Normalise yaw to keep it bounded.
    if (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
    else if (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;
  }
}
