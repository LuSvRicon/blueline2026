// WheelDynamics — 4-Wheel dynamic normal load transfer, Pacejka Magic Formula
// longitudinal/combined tire-slip model, and 4-channel cyclic electro-hydraulic
// ABS modulator.
//
// Physical Scope & Provenance:
//   - [SOURCE]: Standard planar 4-wheel quasi-steady load transfer equations,
//     coupled wheel-chassis Newton-Euler longitudinal dynamics, and Pacejka
//     3-parameter Magic Formula F_x(κ) = D · sin(C · atan(B · κ)).
//   - [SIMULATION_ASSUMPTION]: Micro-stepped at ~1200 Hz inside each outer
//     physics step so low-inertia wheel spin dynamics (τ_ω ~ 1.5-3 ms) remain
//     numerically A-stable and dt-convergent across 30/60/120/240 Hz loops.
//   - [TUNABLE]: Per-wheel cyclic ABS pressure thresholds (APPLY / HOLD / DUMP)
//     calibrated to cycle at ~10-14 Hz when requested brake torque exceeds
//     available road-tire friction μ · F_z.

import { clamp } from "../core/math.ts";
import { VEHICLE_PHYSICS_PROFILES, type VehiclePhysicsProfile } from "./VehicleProfiles.ts";

/** Wheel order: [Front-Left, Front-Right, Rear-Left, Rear-Right]. */
export type WheelTuple<T = number> = [T, T, T, T];
export type AbsValvePhase = "APPLY" | "HOLD" | "DUMP";

export interface PacejkaCoefficients {
  readonly B: number;
  readonly C: number;
  readonly peakSlip: number;
  readonly slideRatio: number;
}

/**
 * Calibrate Pacejka Magic Formula coefficients (B, C) so that:
 *   1) Normalized friction μ_norm(κ) = sin(C · atan(B · |κ|)) peaks at EXACTLY
 *      1.000 when |κ| = peakSlip.
 *   2) Locked-wheel sliding friction at |κ| = 1.0 equals `slideRatio` (e.g. 0.77).
 */
export function calibratePacejka(peakSlip: number, slideRatio: number): PacejkaCoefficients {
  const kp = clamp(peakSlip, 0.06, 0.25);
  const sr = clamp(slideRatio, 0.55, 0.94);

  // Solve sin(C · atan(tan(π / (2C)) / kp)) = sr on C ∈ [1.15, 1.85] by bisection.
  let lo = 1.12;
  let hi = 1.88;
  for (let i = 0; i < 28; i++) {
    const mid = 0.5 * (lo + hi);
    const bMid = Math.tan(Math.PI / (2 * mid)) / kp;
    const valAtOne = Math.sin(mid * Math.atan(bMid));
    // Larger C lowers the tail sin(C · atan(B)) toward 0.
    if (valAtOne > sr) lo = mid;
    else hi = mid;
  }
  const C = 0.5 * (lo + hi);
  const B = Math.tan(Math.PI / (2 * C)) / kp;
  return { B, C, peakSlip: kp, slideRatio: sr };
}

/**
 * Normalized longitudinal tire friction coefficient μ(κ) / μ_peak ∈ [-1, 1].
 * Strictly bounded in [-1, 1] and attains ±1 at κ = ±peakSlip.
 */
export function pacejkaNormalizedMu(slipRatio: number, coeff: PacejkaCoefficients): number {
  const k = clamp(slipRatio, -1.0, 1.0);
  if (Math.abs(k) < 1e-9) return 0;
  const sgn = k >= 0 ? 1 : -1;
  const x = coeff.B * Math.abs(k);
  return sgn * Math.sin(coeff.C * Math.atan(x));
}

/**
 * Compute 4-wheel normal vertical tire loads [FL, FR, RL, RR] (Newtons),
 * accounting for road grade, longitudinal inertial pitch transfer, and lateral roll transfer.
 */
export function computeWheelNormalLoads(
  profile: VehiclePhysicsProfile,
  inertialLongAccel: number,
  lateralAccel: number,
  roadGradeRad: number,
): WheelTuple<number> {
  const g = 9.81;
  const m = profile.massKg;
  const L = Math.max(profile.wheelbaseM, 1.5);
  const tw = Math.max(profile.trackWidthM, 1.1);
  const hCg = profile.cgHeightM;

  const fzTotal = m * g * Math.cos(roadGradeRad);
  const staticFront = fzTotal * profile.frontStaticWeightFrac;
  const staticRear = fzTotal * (1 - profile.frontStaticWeightFrac);

  // Braking (inertialLongAccel < 0) or downhill grade shifts normal load to the front axle.
  const dFzLong = (-m * inertialLongAccel - m * g * Math.sin(roadGradeRad)) * (hCg / L);
  const maxTransferLong = 0.42 * fzTotal;
  const clampedLong = clamp(dFzLong, -maxTransferLong, maxTransferLong);

  const fzFrontAxle = clamp(staticFront + clampedLong, 0.12 * fzTotal, 0.88 * fzTotal);
  const fzRearAxle = Math.max(0.12 * fzTotal, fzTotal - fzFrontAxle);

  // Lateral load transfer: positive lateralAccel (+yawRate * v, left turn in math 2D) unloads inner (+y) and loads outer (-y).
  const dFzLatTotal = (m * lateralAccel * hCg) / tw;
  const dFzLatFront = clamp(dFzLatTotal * 0.55, -0.42 * fzFrontAxle, 0.42 * fzFrontAxle);
  const dFzLatRear = clamp(dFzLatTotal * 0.45, -0.42 * fzRearAxle, 0.42 * fzRearAxle);

  const minWheelLoad = 0.04 * fzTotal;
  const fl = Math.max(minWheelLoad, 0.5 * fzFrontAxle - dFzLatFront);
  const fr = Math.max(minWheelLoad, 0.5 * fzFrontAxle + dFzLatFront);
  const rl = Math.max(minWheelLoad, 0.5 * fzRearAxle - dFzLatRear);
  const rr = Math.max(minWheelLoad, 0.5 * fzRearAxle + dFzLatRear);
  return [fl, fr, rl, rr];
}

export interface WheelDynamicsStepInput {
  prevV: number;
  requestedAccel: number;
  steerAngleRad: number;
  surfaceMu: number;
  roadGradeRad: number;
  direction: -1 | 1;
  dt: number;
  absEnabled: boolean;
  corneringBrakeCoupling: boolean;
  maxSpeed: number;
}

export interface WheelDynamicsStepResult {
  nextV: number;
  appliedAccel: number;
  moveDt: number;
  vMid: number;
  frontLoadFraction: number;
  wheelSpeeds: WheelTuple<number>;
  wheelSlips: WheelTuple<number>;
  wheelLoadsN: WheelTuple<number>;
  wheelAbsActive: boolean;
  absPhases: WheelTuple<AbsValvePhase>;
  absCycleCount: number;
}

/**
 * Stateful 4-wheel rotational dynamics + Pacejka slip + 4-channel cyclic ABS.
 */
export class WheelDynamicsModel {
  private profile: VehiclePhysicsProfile;
  private pacejka: PacejkaCoefficients;

  /** Wheel angular speeds ω_i >= 0 (rad/s) along current travel direction. */
  wheelSpeeds: WheelTuple<number> = [0, 0, 0, 0];
  /** Instantaneous longitudinal braking slip ratios κ_i ∈ [-1, 1] (+ = braking slip). */
  wheelSlips: WheelTuple<number> = [0, 0, 0, 0];
  /** Instantaneous normal loads F_z,i (N) on [FL, FR, RL, RR]. */
  wheelLoadsN: WheelTuple<number> = [0, 0, 0, 0];
  /** Per-wheel modulated hydraulic brake torque T_b,i (N·m). */
  brakeTorquesNm: WheelTuple<number> = [0, 0, 0, 0];
  /** Per-wheel cyclic ABS valve state. */
  absPhases: WheelTuple<AbsValvePhase> = ["APPLY", "APPLY", "APPLY", "APPLY"];
  /** Hold-phase dwell timers (s) per wheel. */
  private holdTimers: WheelTuple<number> = [0, 0, 0, 0];
  /** True when at least one wheel is actively modulated by ABS (DUMP/HOLD or post-dump reapply). */
  wheelAbsActive = false;
  private absEngagedLatch: WheelTuple<boolean> = [false, false, false, false];
  /** Cumulative number of ABS pressure dump cycles (for telemetry & verification). */
  absCycleCount = 0;

  private lastExpectedV: number | null = null;
  private lastInertialAccel = 0;
  private lastLatAccel = 0;

  constructor(profile: VehiclePhysicsProfile = VEHICLE_PHYSICS_PROFILES.composite) {
    this.profile = profile;
    this.pacejka = calibratePacejka(profile.tirePeakSlip, profile.tireSlideRatio);
    this.wheelLoadsN = computeWheelNormalLoads(profile, 0, 0, 0);
  }

  setProfile(profile: VehiclePhysicsProfile, currentSpeedMps = 0): void {
    this.profile = profile;
    this.pacejka = calibratePacejka(profile.tirePeakSlip, profile.tireSlideRatio);
    this.syncToSpeed(currentSpeedMps);
  }

  getProfile(): VehiclePhysicsProfile {
    return this.profile;
  }

  getPacejka(): PacejkaCoefficients {
    return this.pacejka;
  }

  syncToSpeed(speedMps: number): void {
    const r = Math.max(this.profile.wheelRadiusM, 0.2);
    const omega = Math.max(0, speedMps) / r;
    this.wheelSpeeds = [omega, omega, omega, omega];
    this.wheelSlips = [0, 0, 0, 0];
    this.brakeTorquesNm = [0, 0, 0, 0];
    this.absPhases = ["APPLY", "APPLY", "APPLY", "APPLY"];
    this.holdTimers = [0, 0, 0, 0];
    this.absEngagedLatch = [false, false, false, false];
    this.wheelAbsActive = false;
    this.lastExpectedV = Math.max(0, speedMps);
    this.lastInertialAccel = 0;
    this.lastLatAccel = 0;
    this.wheelLoadsN = computeWheelNormalLoads(this.profile, 0, 0, 0);
  }

  updateLateralAccelHint(latAccel: number): void {
    this.lastLatAccel = latAccel;
  }

  step(input: WheelDynamicsStepInput): WheelDynamicsStepResult {
    const {
      prevV,
      requestedAccel,
      steerAngleRad,
      surfaceMu,
      roadGradeRad,
      direction,
      dt,
      absEnabled,
      corneringBrakeCoupling,
      maxSpeed,
    } = input;

    const p = this.profile;
    const m = p.massKg;
    const rEff = Math.max(p.wheelRadiusM, 0.2);
    const jW = Math.max(p.wheelInertiaKgM2, 0.3);
    // Effective translational + 4-wheel rotational mass for brake-by-wire torque mapping.
    const mEff = m + (4 * jW) / (rEff * rEff);

    // Detect external speed reset/teleport (e.g. test fixture assigning `sim.ego.v = 20`)
    // so rolling wheels start matched to ground speed rather than artificially locked at 0 rad/s.
    if (this.lastExpectedV === null || Math.abs(prevV - this.lastExpectedV) > 0.75) {
      this.syncToSpeed(prevV);
    }

    const mu = clamp(surfaceMu, 0.15, 1.2);
    const gradeAccel = -direction * 9.81 * Math.sin(roadGradeRad);

    // Combined-slip lateral grip reservation when steering while braking.
    let combinedLongFactor = 1.0;
    if (corneringBrakeCoupling && prevV > 0.5 && Math.abs(steerAngleRad) > 1e-4) {
      const grip = mu * 9.81;
      const reqLatAccel = ((prevV * prevV) / p.wheelbaseM) * Math.abs(Math.tan(steerAngleRad));
      const etaY = clamp(reqLatAccel / Math.max(grip, 0.5), 0, 0.78);
      combinedLongFactor = Math.max(0.35, Math.sqrt(Math.max(0, 1 - etaY * etaY)));
    }

    // Case A: Propulsion / positive acceleration request
    if (requestedAccel >= 0) {
      this.absPhases = ["APPLY", "APPLY", "APPLY", "APPLY"];
      this.holdTimers = [0, 0, 0, 0];
      this.absEngagedLatch = [false, false, false, false];
      this.brakeTorquesNm = [0, 0, 0, 0];
      this.wheelAbsActive = false;

      const driveCap = Math.min(requestedAccel, p.maxAccel * mu, mu * 9.81);
      const netAccel = driveCap + gradeAccel;
      const nextV = clamp(prevV + netAccel * dt, 0, maxSpeed);
      const appliedAccel = prevV <= 1e-6 && nextV === 0 ? 0 : netAccel;
      const inertialA = direction * (appliedAccel - gradeAccel);
      this.lastInertialAccel = inertialA;
      this.wheelLoadsN = computeWheelNormalLoads(p, inertialA, this.lastLatAccel, direction * roadGradeRad);
      const fzSum = this.wheelLoadsN[0] + this.wheelLoadsN[1] + this.wheelLoadsN[2] + this.wheelLoadsN[3];
      const frontFrac = clamp((this.wheelLoadsN[0] + this.wheelLoadsN[1]) / Math.max(fzSum, 1), 0.1, 0.9);

      // Modest negative (driving) slip proportional to traction utilization
      const driveUtil = clamp(driveCap / Math.max(mu * 9.81, 0.5), 0, 0.95);
      const driveSlip = nextV > 0.1 ? -driveUtil * this.pacejka.peakSlip * 0.65 : 0;
      const omegaDrive = (nextV / rEff) * (1 - driveSlip);
      this.wheelSpeeds = [omegaDrive, omegaDrive, omegaDrive, omegaDrive];
      this.wheelSlips = [driveSlip, driveSlip, driveSlip, driveSlip];
      this.lastExpectedV = nextV;

      return {
        nextV,
        appliedAccel,
        moveDt: dt,
        vMid: 0.5 * (prevV + nextV),
        frontLoadFraction: frontFrac,
        wheelSpeeds: [...this.wheelSpeeds],
        wheelSlips: [...this.wheelSlips],
        wheelLoadsN: [...this.wheelLoadsN],
        wheelAbsActive: false,
        absPhases: [...this.absPhases],
        absCycleCount: this.absCycleCount,
      };
    }

    // Case B: Already stationary and brakes hold against grade
    const reqBrakeDecel = Math.min(-requestedAccel, p.maxDecel);
    if (prevV <= 1e-6 && -Math.min(reqBrakeDecel, mu * 9.81) + gradeAccel <= 0) {
      this.syncToSpeed(0);
      const fzSum = this.wheelLoadsN[0] + this.wheelLoadsN[1] + this.wheelLoadsN[2] + this.wheelLoadsN[3];
      return {
        nextV: 0,
        appliedAccel: 0,
        moveDt: dt,
        vMid: 0,
        frontLoadFraction: clamp((this.wheelLoadsN[0] + this.wheelLoadsN[1]) / Math.max(fzSum, 1), 0.1, 0.9),
        wheelSpeeds: [0, 0, 0, 0],
        wheelSlips: [0, 0, 0, 0],
        wheelLoadsN: [...this.wheelLoadsN],
        wheelAbsActive: false,
        absPhases: [...this.absPhases],
        absCycleCount: this.absCycleCount,
      };
    }

    // Case C: Dynamic 4-wheel braking with ~1200 Hz sub-stepping (exact divisor of 60/120/240 Hz!)
    const nSub = Math.max(1, Math.ceil(dt * 1200 - 1e-9));
    const h = dt / nSub;

    // Total requested brake caliper torque across all 4 wheels (N·m)
    const totalReqTorqueNm = rEff * mEff * reqBrakeDecel;

    // ABS slip & peripheral deceleration thresholds
    const kPeak = this.pacejka.peakSlip;
    const kUpper = kPeak + 0.032; // ~0.162 -> enter DUMP before deep lockup
    const kLower = Math.max(0.065, kPeak - 0.028); // ~0.102 -> recover wheel spin, enter HOLD
    const absMinSpeedMps = 1.6; // ~5.8 km/h low-speed ABS cutout

    let v = prevV;
    let posDisp = 0;
    let stopElapsed = dt;
    let stoppedMidStep = false;
    let lastStepNetAccel = 0;

    // Hydraulic pressure valve rates (N·m/s per wheel) tuned for ~11-14 Hz ABS cycling.
    // Note: upstream `BrakeActuator` in `Simulation.ts` already models master-cylinder / ESP
    // hydraulic dead-time and ramp rate, so unmodulated `APPLY` tracks requested torque directly
    // without double-counting pressure build-up delay.
    const maxWheelTorqueRef = Math.max(600, 0.35 * rEff * mEff * p.maxDecel);
    const dumpRateNmPerS = maxWheelTorqueRef * 28.0;
    const reapplyRateNmPerS = maxWheelTorqueRef * 9.5;
    const holdDurationSec = 0.032;
    const lowSpeedCoulombMps = 0.45; // Smooth Besselink/MF-Swift transition to static Coulomb brake force as v -> 0

    for (let stepIdx = 0; stepIdx < nSub; stepIdx++) {
      // 1. Dynamic normal loads on [FL, FR, RL, RR]
      const loads = computeWheelNormalLoads(p, this.lastInertialAccel, this.lastLatAccel, direction * roadGradeRad);
      this.wheelLoadsN = loads;
      const fzFront = loads[0] + loads[1];
      const fzRear = loads[2] + loads[3];
      const fzTotal = fzFront + fzRear;

      // Electronic Brakeforce Distribution (EBD): blends nominal hydraulic bias toward dynamic axle load
      // under heavy braking so unloaded rear wheels do not prematurely lock before front wheels.
      const dynFrontShare = fzFront / Math.max(fzTotal, 1);
      const ebdBlend = clamp(reqBrakeDecel / 5.5, 0, 0.75);
      const effFrontBias = clamp(p.brakeBiasFront * (1 - ebdBlend) + dynFrontShare * ebdBlend, 0.50, 0.85);
      const wheelReqTorques: WheelTuple<number> = [
        totalReqTorqueNm * effFrontBias * (loads[0] / Math.max(fzFront, 1)),
        totalReqTorqueNm * effFrontBias * (loads[1] / Math.max(fzFront, 1)),
        totalReqTorqueNm * (1 - effFrontBias) * (loads[2] / Math.max(fzRear, 1)),
        totalReqTorqueNm * (1 - effFrontBias) * (loads[3] / Math.max(fzRear, 1)),
      ];

      let totalTireBrakeForceN = 0;
      const vRef = Math.max(v, 0.35);
      const alphaLow = clamp(v / lowSpeedCoulombMps, 0, 1);

      for (let i = 0; i < 4; i++) {
        const omega = this.wheelSpeeds[i];
        const vWheel = omega * rEff;
        const slip = v > 1e-6 ? clamp((v - vWheel) / vRef, -1.0, 1.0) : 0;
        this.wheelSlips[i] = slip;

        // Current tire braking force before updating torque
        const peakWheelForceN = mu * combinedLongFactor * loads[i];
        const tireForcePre = Math.max(0, pacejkaNormalizedMu(slip, this.pacejka) * peakWheelForceN);
        const wheelPeriphDecelPre = (this.brakeTorquesNm[i] - rEff * tireForcePre) / jW * rEff;

        // 2. Per-wheel cyclic ABS valve state machine
        if (absEnabled && v > absMinSpeedMps) {
          let phase = this.absPhases[i];
          const reqT = wheelReqTorques[i];
          const torqueExceedsPeak = Math.max(this.brakeTorquesNm[i], reqT) > rEff * peakWheelForceN * 0.98;
          if (phase === "APPLY") {
            if (slip > kUpper || (torqueExceedsPeak && slip > kPeak * 0.90 && wheelPeriphDecelPre > 45.0)) {
              phase = "DUMP";
              this.absEngagedLatch[i] = true;
              this.absCycleCount++;
            }
          } else if (phase === "DUMP") {
            if (slip <= kLower) {
              phase = "HOLD";
              this.holdTimers[i] = holdDurationSec;
            }
          } else if (phase === "HOLD") {
            this.holdTimers[i] -= h;
            if (slip > kUpper + 0.015) {
              phase = "DUMP";
              this.absCycleCount++;
            } else if (this.holdTimers[i] <= 0) {
              phase = "APPLY";
            }
          }
          this.absPhases[i] = phase;

          if (phase === "DUMP") {
            const floorTorque = 0.32 * rEff * peakWheelForceN;
            this.brakeTorquesNm[i] = Math.max(floorTorque, this.brakeTorquesNm[i] - dumpRateNmPerS * h);
          } else if (phase === "HOLD") {
            const targetHoldTorque = Math.min(reqT, 0.94 * rEff * peakWheelForceN);
            this.brakeTorquesNm[i] += clamp(targetHoldTorque - this.brakeTorquesNm[i], -dumpRateNmPerS * 0.4 * h, reapplyRateNmPerS * 0.5 * h);
          } else {
            // APPLY: direct hydraulic tracking before ABS engages; stepped reapply during active ABS cycling
            if (!this.absEngagedLatch[i] || reqT < this.brakeTorquesNm[i]) {
              this.brakeTorquesNm[i] = reqT;
            } else {
              this.brakeTorquesNm[i] = Math.min(reqT, this.brakeTorquesNm[i] + reapplyRateNmPerS * h);
            }
            if (reqT <= 0.88 * rEff * peakWheelForceN && slip < kPeak * 0.8) {
              this.absEngagedLatch[i] = false;
            }
          }
        } else {
          // ABS disabled OR below low-speed cutout (< 1.6 m/s): direct unmodulated brake pressure
          this.absPhases[i] = "APPLY";
          this.absEngagedLatch[i] = false;
          this.holdTimers[i] = 0;
          this.brakeTorquesNm[i] = wheelReqTorques[i];
        }

        // 3. Integrate wheel angular speed: J_w · dω/dt = R_eff · F_tire(ω) - T_brake
        // Implicit Rosenbrock linearization on the stiff elastic tire slope (|κ| < κ_peak)
        // guarantees unconditional L-stability down to v -> 0 without artificial damping post-peak.
        const bx = this.pacejka.B * Math.abs(slip);
        const dMuDk =
          (this.pacejka.B * this.pacejka.C * Math.cos(this.pacejka.C * Math.atan(bx))) /
          (1 + bx * bx);
        const kStiff = Math.max(0, dMuDk) * peakWheelForceN; // >= 0 on elastic slope, 0 post-peak
        const denomJw = jW + ((rEff * rEff * kStiff) / vRef) * h;
        const dOmega = ((rEff * tireForcePre - this.brakeTorquesNm[i]) * h) / denomJw;
        const omegaNextRaw = omega + dOmega;
        const omegaFreeRoll = v / rEff;
        const omegaNext = this.brakeTorquesNm[i] <= 1e-3
          ? omegaFreeRoll
          : clamp(omegaNextRaw, 0, Math.max(omegaFreeRoll, omega));
        this.wheelSpeeds[i] = omegaNext;

        const slipPost = v > 1e-6 ? clamp((v - omegaNext * rEff) / vRef, 0, 1.0) : 0;
        this.wheelSlips[i] = slipPost;
        const tireForcePost = Math.max(0, pacejkaNormalizedMu(slipPost, this.pacejka) * peakWheelForceN);
        const dynForceAvg = 0.5 * (tireForcePre + tireForcePost);
        // Below 0.45 m/s, blend smoothly into static/Coulomb caliper-to-road friction so the vehicle
        // comes to a crisp, exact 0.000 m/s standstill in finite time without an exponential Zeno tail.
        const coulombCap = peakWheelForceN * (absEnabled || omegaNext > 1e-3 ? 1.0 : this.pacejka.slideRatio);
        const coulombForce = Math.min(this.brakeTorquesNm[i] / rEff, coulombCap);
        totalTireBrakeForceN += alphaLow * dynForceAvg + (1 - alphaLow) * coulombForce;
      }

      // 4. Integrate chassis longitudinal speed v
      const tireDecel = totalTireBrakeForceN / m;
      const netAccel = -tireDecel + gradeAccel;
      const vNext = v + netAccel * h;
      this.lastInertialAccel = -direction * tireDecel;

      if (vNext <= 0 && netAccel < 0) {
        const subStopDt = v > 1e-7 ? clamp(v / -netAccel, 0, h) : 0;
        posDisp += 0.5 * v * subStopDt;
        stopElapsed = stepIdx * h + subStopDt;
        v = 0;
        lastStepNetAccel = prevV > 1e-4 ? netAccel : 0;
        stoppedMidStep = true;
        this.wheelSpeeds = [0, 0, 0, 0];
        this.wheelSlips = [0, 0, 0, 0];
        this.absPhases = ["APPLY", "APPLY", "APPLY", "APPLY"];
        this.absEngagedLatch = [false, false, false, false];
        break;
      } else {
        const vClamped = clamp(vNext, 0, maxSpeed);
        posDisp += 0.5 * (v + vClamped) * h;
        v = vClamped;
        lastStepNetAccel = netAccel;
      }
    }

    this.wheelAbsActive =
      !stoppedMidStep &&
      v > absMinSpeedMps &&
      absEnabled &&
      (this.absEngagedLatch.some(Boolean) || this.absPhases.some((ph) => ph !== "APPLY"));

    this.lastExpectedV = v;
    const fzSum = this.wheelLoadsN[0] + this.wheelLoadsN[1] + this.wheelLoadsN[2] + this.wheelLoadsN[3];
    const frontFrac = clamp((this.wheelLoadsN[0] + this.wheelLoadsN[1]) / Math.max(fzSum, 1), 0.1, 0.9);
    const moveDt = stoppedMidStep ? Math.max(stopElapsed, 1e-6) : dt;
    const vMid = moveDt > 1e-7 ? posDisp / moveDt : 0;

    return {
      nextV: v,
      appliedAccel: lastStepNetAccel,
      moveDt: stoppedMidStep ? stopElapsed : dt,
      vMid,
      frontLoadFraction: frontFrac,
      wheelSpeeds: [...this.wheelSpeeds],
      wheelSlips: [...this.wheelSlips],
      wheelLoadsN: [...this.wheelLoadsN],
      wheelAbsActive: this.wheelAbsActive,
      absPhases: [...this.absPhases],
      absCycleCount: this.absCycleCount,
    };
  }
}
