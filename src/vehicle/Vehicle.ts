// Kinematic + 4-Wheel Dynamic Tire-Slip Vehicle Model.
//
// Modes:
//   1. Baseline mode (`enableWheelSlipDynamics = false`): kinematic bicycle with
//      friction-circle lateral/longitudinal grip, road grade, and chassis pitch/roll
//      — used by classical/ML planner suites for deterministic parity.
//   2. 4-Wheel Tire-Slip & Cyclic ABS mode (`enableWheelSlipDynamics = true`):
//      per-wheel normal load transfer [FL, FR, RL, RR], Pacejka Magic Formula
//      longitudinal slip ratio κ_i, EBD proportioning, and ~10-14 Hz 4-channel
//      cyclic electro-hydraulic ABS modulation — active in ADAS and Manual modes.

import { clamp } from "../core/math.ts";
import {
  VEHICLE_PHYSICS_PROFILES,
  VehiclePhysicsProfile,
  VehicleProfileId,
  getVehiclePhysicsProfile,
} from "./VehicleProfiles.ts";
import { AbsValvePhase, WheelDynamicsModel, WheelTuple } from "./WheelDynamics.ts";

export interface VehicleDims {
  length: number;
  width: number;
  wheelbase: number;
}

export const EGO_DIMS: VehicleDims = { length: 4.7, width: 2.0, wheelbase: 2.8 };

/** Nominal body rectangle shared by physics, parking, sensors and the GLB fit. */
export function vehicleProfileDimensions(profile: VehiclePhysicsProfile): VehicleDims {
  return { length: profile.realLengthM, width: profile.realWidthM, wheelbase: profile.wheelbaseM };
}

export class Vehicle {
  x: number;
  y: number;
  yaw: number;
  v: number;
  a = 0; // last applied acceleration (for telemetry / planner seeding)
  delta = 0; // last applied steering angle

  dims: VehicleDims;
  /** Preserve caller-supplied geometry when returning to the reference profile. */
  private readonly referenceDims: VehicleDims;
  maxSteer: number;
  maxAccel: number;
  maxDecel: number;
  maxSpeed: number;
  /** Active vehicle physics profile identifier ("composite" | "vf9" | "santafe" | "everest" | "civic"). */
  profileId: VehicleProfileId = "composite";
  physicsProfile: VehiclePhysicsProfile = VEHICLE_PHYSICS_PROFILES.composite;
  /** Extra off-throttle deceleration from profile (m/s², e.g. EV regenerative drag). */
  extraCoastDecel = 0;

  /** Road-surface peak friction coefficient μ_peak (1 = dry, <1 rain/ice). */
  surfaceMu = 1;
  /** Road longitudinal slope angle (rad, >0 uphill against +direction, <0 downhill). */
  roadGrade = 0;
  /** Raw longitudinal acceleration requested before tire/grade physics (m/s²). */
  requestedAccel = 0;
  /** Instantaneous longitudinal jerk da/dt (m/s³). */
  jerk = 0;
  /** Low-pass filtered longitudinal jerk (15 Hz cutoff, m/s³) for comfort/AEB analysis. */
  jerkFiltered = 0;
  lateralAccel = 0;
  tractionLimited = false;
  /** Dynamic front-axle normal load fraction Fz_front / Fz_total ∈ [0.1, 0.9]. */
  frontLoadFraction = 0.5;
  bodyRoll = 0;
  bodyPitch = 0;
  /** Simulation enables this for every driving mode. False is retained only
   * for isolated kinematic controller comparisons and legacy research tests. */
  limitLateralGrip = false;
  /** When enabled, active steering cornering demand shares tire grip with
   * longitudinal braking on the friction circle (lengthening stops on bends). */
  corneringBrakeCoupling = false;

  /** Enables 4-wheel rotational inertia, Pacejka slip ratio, and cyclic ABS modulation. */
  enableWheelSlipDynamics = false;
  /** Enables cyclic electro-hydraulic ABS valve modulation when `enableWheelSlipDynamics` is active. */
  wheelAbsEnabled = true;
  /** Per-wheel angular speeds [FL, FR, RL, RR] (rad/s). */
  wheelSpeeds: WheelTuple<number> = [0, 0, 0, 0];
  /** Per-wheel longitudinal slip ratios [FL, FR, RL, RR] ∈ [-1, 1]. */
  wheelSlips: WheelTuple<number> = [0, 0, 0, 0];
  /** Per-wheel vertical normal loads [FL, FR, RL, RR] (N). */
  wheelLoadsN: WheelTuple<number> = [0, 0, 0, 0];
  /** Per-wheel ABS valve phase ("APPLY" | "HOLD" | "DUMP"). */
  absPhases: WheelTuple<AbsValvePhase> = ["APPLY", "APPLY", "APPLY", "APPLY"];
  /** True when the physical 4-wheel ABS controller is actively cycling brake pressure. */
  wheelAbsActive = false;

  readonly wheelDynamics: WheelDynamicsModel;

  constructor(
    x: number,
    y: number,
    yaw: number,
    v: number,
    dims: VehicleDims = EGO_DIMS,
    opts: Partial<{
      maxSteer: number;
      maxAccel: number;
      maxDecel: number;
      maxSpeed: number;
      profileId: VehicleProfileId;
    }> = {},
  ) {
    this.x = x;
    this.y = y;
    this.yaw = yaw;
    this.v = v;
    const baseProfile = getVehiclePhysicsProfile(opts.profileId ?? "composite");
    this.profileId = baseProfile.id;
    this.referenceDims = { ...dims };
    this.dims = baseProfile.id === "composite" ? { ...dims } : vehicleProfileDimensions(baseProfile);
    this.maxSteer = opts.maxSteer ?? (baseProfile.maxSteerDeg * Math.PI) / 180;
    this.maxAccel = opts.maxAccel ?? baseProfile.maxAccel;
    this.maxDecel = opts.maxDecel ?? baseProfile.maxDecel;
    this.maxSpeed = opts.maxSpeed ?? 40;
    this.extraCoastDecel = baseProfile.extraCoastDecel;
    this.physicsProfile = {
      ...baseProfile,
      wheelbaseM: this.dims.wheelbase,
      maxAccel: this.maxAccel,
      maxDecel: this.maxDecel,
    };
    this.wheelDynamics = new WheelDynamicsModel(this.physicsProfile);
    this.wheelDynamics.syncToSpeed(v);
    this.wheelSpeeds = [...this.wheelDynamics.wheelSpeeds];
    this.wheelLoadsN = [...this.wheelDynamics.wheelLoadsN];
    this.frontLoadFraction = this.physicsProfile.frontStaticWeightFrac;
  }

  /** Switch to a named vehicle physics profile while preserving world pose & speed. */
  applyPhysicsProfile(profileOrId: VehiclePhysicsProfile | VehicleProfileId): VehiclePhysicsProfile {
    const profile = typeof profileOrId === "string" ? getVehiclePhysicsProfile(profileOrId) : profileOrId;
    this.profileId = profile.id;
    this.dims = profile.id === "composite" ? { ...this.referenceDims } : vehicleProfileDimensions(profile);
    this.physicsProfile = this.dims.wheelbase === profile.wheelbaseM
      ? profile : { ...profile, wheelbaseM: this.dims.wheelbase };
    this.maxSteer = (profile.maxSteerDeg * Math.PI) / 180;
    this.maxAccel = profile.maxAccel;
    this.maxDecel = profile.maxDecel;
    this.extraCoastDecel = profile.extraCoastDecel;
    this.delta = clamp(this.delta, -this.maxSteer, this.maxSteer);
    this.wheelDynamics.setProfile(this.physicsProfile, this.v);
    this.wheelSpeeds = [...this.wheelDynamics.wheelSpeeds];
    this.wheelSlips = [...this.wheelDynamics.wheelSlips];
    this.wheelLoadsN = [...this.wheelDynamics.wheelLoadsN];
    this.absPhases = [...this.wheelDynamics.absPhases];
    this.wheelAbsActive = false;
    this.frontLoadFraction = profile.frontStaticWeightFrac;
    return profile;
  }

  /** Synchronise wheel angular velocities to current ground speed `this.v` (e.g. on reset). */
  syncWheelSpeeds(): void {
    this.wheelDynamics.syncToSpeed(this.v);
    this.wheelSpeeds = [...this.wheelDynamics.wheelSpeeds];
    this.wheelSlips = [0, 0, 0, 0];
    this.wheelLoadsN = [...this.wheelDynamics.wheelLoadsN];
    this.absPhases = ["APPLY", "APPLY", "APPLY", "APPLY"];
    this.wheelAbsActive = false;
  }

  get maxWheelSlip(): number {
    return Math.max(
      Math.abs(this.wheelSlips[0]),
      Math.abs(this.wheelSlips[1]),
      Math.abs(this.wheelSlips[2]),
      Math.abs(this.wheelSlips[3]),
    );
  }

  /** Integrate one step. Direction is -1 for reverse while speed stays unsigned. */
  step(steer: number, accel: number, dt: number, direction: -1 | 1 = 1): void {
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(steer) || !Number.isFinite(accel)) return;
    this.requestedAccel = accel;
    const prevA = this.a;
    const prevV = this.v;
    const requestedSteer = clamp(steer, -this.maxSteer, this.maxSteer);
    this.delta = this.limitLateralGrip
      ? this.delta + clamp(requestedSteer - this.delta, -1.2 * dt, 1.2 * dt)
      : requestedSteer;
    const mu = clamp(this.surfaceMu, 0.15, 1.2);
    const grip = mu * 9.81;
    const gradeAccel = -direction * 9.81 * Math.sin(this.roadGrade);

    let applied: number;
    let moveDt: number;
    let vMid: number;

    if (this.enableWheelSlipDynamics) {
      // Keep WheelDynamics synced if caller mutated `maxDecel`/`maxAccel`/`wheelbase` directly
      if (
        this.physicsProfile.maxDecel !== this.maxDecel ||
        this.physicsProfile.maxAccel !== this.maxAccel ||
        this.physicsProfile.wheelbaseM !== this.dims.wheelbase
      ) {
        this.physicsProfile = {
          ...this.physicsProfile,
          maxDecel: this.maxDecel,
          maxAccel: this.maxAccel,
          wheelbaseM: this.dims.wheelbase,
        };
        this.wheelDynamics.setProfile(this.physicsProfile, prevV);
      }

      const wd = this.wheelDynamics.step({
        prevV,
        requestedAccel: accel,
        steerAngleRad: this.delta,
        surfaceMu: mu,
        roadGradeRad: this.roadGrade,
        direction,
        dt,
        absEnabled: this.wheelAbsEnabled,
        corneringBrakeCoupling: this.corneringBrakeCoupling,
        maxSpeed: this.maxSpeed,
      });
      this.v = wd.nextV;
      applied = wd.appliedAccel;
      moveDt = wd.moveDt;
      vMid = wd.vMid;
      this.frontLoadFraction = wd.frontLoadFraction;
      this.wheelSpeeds = wd.wheelSpeeds;
      this.wheelSlips = wd.wheelSlips;
      this.wheelLoadsN = wd.wheelLoadsN;
      this.wheelAbsActive = wd.wheelAbsActive;
      this.absPhases = wd.absPhases;
    } else {
      let maxBrakeGrip = Math.min(this.maxDecel * mu, grip);
      if (this.corneringBrakeCoupling && prevV > 0.5 && Math.abs(this.delta) > 1e-4) {
        const requestedLatAccel = ((prevV * prevV) / this.dims.wheelbase) * Math.abs(Math.tan(this.delta));
        const reservedLat = Math.min(requestedLatAccel, 0.78 * grip);
        const longFromCircle = Math.sqrt(Math.max(grip * grip - reservedLat * reservedLat, (0.35 * grip) ** 2));
        maxBrakeGrip = Math.min(maxBrakeGrip, longFromCircle);
      }

      if (accel < 0) {
        // Service brakes are dissipative: they oppose motion and downhill roll,
        // and never integrate a stopped vehicle into reverse motion.
        const brakeCap = Math.min(-accel, maxBrakeGrip);
        const netMovingAccel = -brakeCap + gradeAccel;
        if (prevV <= 1e-6 && netMovingAccel <= 0) {
          applied = 0;
          this.v = 0;
        } else {
          const nextV = prevV + netMovingAccel * dt;
          if (nextV <= 0) {
            applied = prevV > 1e-4 ? netMovingAccel : 0;
            this.v = 0;
          } else {
            applied = netMovingAccel;
            this.v = Math.min(nextV, this.maxSpeed);
          }
        }
      } else {
        const driveAccel = Math.min(accel, this.maxAccel * mu, grip);
        const netAccel = driveAccel + gradeAccel;
        this.v = clamp(prevV + netAccel * dt, 0, this.maxSpeed);
        applied = prevV <= 1e-6 && this.v === 0 ? 0 : netAccel;
      }

      this.frontLoadFraction = clamp(0.5 - (direction * applied * 0.55) / (9.81 * this.dims.wheelbase), 0.1, 0.9);
      this.wheelAbsActive = false;
      const rEff = Math.max(this.physicsProfile.wheelRadiusM, 0.2);
      const om = this.v / rEff;
      this.wheelSpeeds = [om, om, om, om];
      this.wheelSlips = [0, 0, 0, 0];
      moveDt = prevV > 1e-6 && this.v === 0 && applied < -1e-4 ? Math.min(dt, prevV / -applied) : dt;
      vMid = 0.5 * (prevV + this.v);
    }

    this.a = applied;
    this.jerk = (this.a - prevA) / dt;
    const jerkAlpha = 1 - Math.exp(-dt * 2 * Math.PI * 15);
    this.jerkFiltered += (this.jerk - this.jerkFiltered) * jerkAlpha;

    const requestedYawRate = ((direction * this.v) / this.dims.wheelbase) * Math.tan(this.delta);
    // Combined-slip friction circle limits available cornering force; locked front wheels
    // (`wheelAbsEnabled = false`, front slip -> 1) additionally lose directional steer authority.
    const tireLongUsed = clamp(applied - gradeAccel, -grip, grip);
    let lateralBudget = Math.sqrt(Math.max(grip * grip - tireLongUsed * tireLongUsed, 0));
    if (this.enableWheelSlipDynamics) {
      const frontSlip = 0.5 * (Math.abs(this.wheelSlips[0]) + Math.abs(this.wheelSlips[1]));
      if (frontSlip > 0.45) {
        const lockFactor = clamp(1 - (frontSlip - 0.45) * 1.45, 0.12, 1.0);
        lateralBudget *= lockFactor;
      }
    }
    const yawLimit = lateralBudget / Math.max(this.v, 0.5);
    const yawRate = this.limitLateralGrip ? clamp(requestedYawRate, -yawLimit, yawLimit) : requestedYawRate;
    this.tractionLimited = this.limitLateralGrip && Math.abs(requestedYawRate) > yawLimit + 0.001;
    this.lateralAccel = direction * this.v * yawRate;
    if (this.enableWheelSlipDynamics) {
      this.wheelDynamics.updateLateralAccelHint(this.lateralAccel);
    }

    const tauSusp = Math.max(this.physicsProfile.suspensionTauSec, 0.05);
    const response = 1 - Math.exp(-dt / tauSusp);
    const rollGain = this.physicsProfile.rollGainRadPerMps2;
    const pitchGain = this.physicsProfile.pitchGainRadPerMps2;
    this.bodyRoll += (clamp(-this.lateralAccel * rollGain, -0.09, 0.09) - this.bodyRoll) * response;
    this.bodyPitch += (clamp(direction * (applied - gradeAccel) * pitchGain, -0.075, 0.075) - this.bodyPitch) * response;

    const midYaw = this.yaw + (this.limitLateralGrip ? (yawRate * moveDt) / 2 : 0);
    this.x += direction * vMid * Math.cos(midYaw) * moveDt;
    this.y += direction * vMid * Math.sin(midYaw) * moveDt;
    this.yaw += yawRate * moveDt;

    // Normalise yaw to keep it bounded.
    if (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
    else if (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;
  }
}
