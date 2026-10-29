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
  lateralAccel = 0;
  tractionLimited = false;
  /** Simplified chassis response, not a calibrated suspension/tire model. */
  frontLoadFraction = .5;
  bodyRoll = 0;
  bodyPitch = 0;
  /** Simulation enables this for every driving mode. False is retained only
   * for isolated kinematic controller comparisons and legacy research tests. */
  limitLateralGrip = false;

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
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(steer) || !Number.isFinite(accel)) return;
    const requestedSteer = clamp(steer, -this.maxSteer, this.maxSteer);
    this.delta = this.limitLateralGrip ? this.delta + clamp(requestedSteer-this.delta,-1.2*dt,1.2*dt) : requestedSteer;
    const mu = clamp(this.surfaceMu, 0.35, 1);
    const grip = mu * 9.81;
    const applied = clamp(accel, -Math.min(this.maxDecel * mu,grip), Math.min(this.maxAccel * mu,grip));
    this.a = applied;

    this.v = clamp(this.v + applied * dt, 0, this.maxSpeed);
    const requestedYawRate = (direction * this.v / this.dims.wheelbase) * Math.tan(this.delta);
    // A friction-circle approximation limits the available cornering force.
    // It preserves the bicycle controller while avoiding unlimited cornering.
    const lateralBudget = Math.sqrt(Math.max(grip * grip - applied * applied, 0));
    const yawLimit = lateralBudget / Math.max(this.v, .5);
    const yawRate = this.limitLateralGrip ? clamp(requestedYawRate, -yawLimit, yawLimit) : requestedYawRate;
    this.tractionLimited = this.limitLateralGrip && Math.abs(requestedYawRate) > yawLimit + .001;
    this.lateralAccel = direction * this.v * yawRate;
    this.frontLoadFraction = clamp(.5-direction*applied*.55/(9.81*this.dims.wheelbase),.1,.9);
    const response=1-Math.exp(-dt/.2);
    this.bodyRoll += (clamp(-this.lateralAccel*.006,-.08,.08)-this.bodyRoll)*response;
    this.bodyPitch += (clamp(direction*applied*.009,-.06,.06)-this.bodyPitch)*response;
    const midYaw = this.yaw + (this.limitLateralGrip ? yawRate * dt / 2 : 0);
    this.x += direction * this.v * Math.cos(midYaw) * dt;
    this.y += direction * this.v * Math.sin(midYaw) * dt;
    this.yaw += yawRate * dt;

    // Normalise yaw to keep it bounded.
    if (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
    else if (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;
  }
}
