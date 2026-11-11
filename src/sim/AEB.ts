// AEB.ts — Modular Autonomous Emergency Braking (AEB) pipeline for BlueLine:
//   1. AEBCalibration: documented parameters (units, physical meaning, provenance)
//   2. assessAEBAvailability: explicit available / degraded / unavailable health
//   3. CollisionPredictor: 2D oriented footprint rollout & deterministic risk ranking
//   4. AEBStateMachine: MONITOR, WARN, PARTIAL, EMERGENCY, HOLD, RELEASE + hysteresis
//   5. BrakeArbiter: single-point m/s² arbitration (driver, ACC, ISA, AEB, HOLD)
//   6. BrakeActuator: command delay queue + finite hydraulic build/release dynamics
//   7. AEBDiagnosticLogger: toggleable ring-buffer telemetry & CSV/JSON export
//
// Engineering note: BlueLine does NOT claim 100% equivalence to a specific OEM ECU.
// Parameters below distinguish [SOURCE] (published protocol/hardware scale),
// [SIMULATION_ASSUMPTION] (simplified physical model), and [TUNABLE] (calibration).

import { Body2D, bodyContact, sweepBodies } from "../core/collision.ts";
import { clamp, wrapAngle, wrapDiff } from "../core/math.ts";
import { Obstacle, ObstacleKind } from "../planner/Trajectory.ts";
import { Vehicle } from "../vehicle/Vehicle.ts";
import { ReferencePath } from "../world/ReferencePath.ts";
import { Road } from "../world/Road.ts";
import { AvailabilityFrame, SensorAvailability, assistanceAvailability } from "./AssistancePolicy.ts";

export type AEBState = "MONITOR" | "WARN" | "PARTIAL" | "EMERGENCY" | "HOLD" | "RELEASE";
export type AEBAvailability = "available" | "degraded" | "unavailable";
export type PerceptionMode = "sensor" | "ground-truth-debug";
export type BrakeArbiterSource =
  | "none"
  | "driver"
  | "acc"
  | "isa"
  | "aeb-partial"
  | "aeb-emergency"
  | "aeb-brake-assist"
  | "aeb-hold"
  | "override";

export interface AEBOverridePolicy {
  /** Accelerator threshold [0..1] that overrides active AEB, or null if accelerator
   *  alone does not cancel AEB. [TUNABLE — vehicle-specific policy; e.g. Tesla Model 3
   *  manual notes heavy throttle can cancel, whereas BlueLine default is null]. */
  throttleOverrideThreshold: number | null;
  /** Allow active driver steering onto a collision-free path to release AEB latch
   *  so tyres retain cornering grip. [TUNABLE] */
  steeringOverrideRelease: boolean;
}

export interface AEBCalibration {
  /** Hydraulic/electronic brake command dead-time when calipers are unpressurised (s).
   *  [SIMULATION_ASSUMPTION / TUNABLE] */
  actuatorDelaySec: number;
  /** Reduced dead-time when WARN brake prefill has already closed pad clearance (s).
   *  [SIMULATION_ASSUMPTION / TUNABLE — qualitative concept from Bosch prefill] */
  prefillActuatorDelaySec: number;
  /** Maximum hydraulic deceleration build-up rate during emergency braking (m/s³).
   *  At 48 m/s³, 0 -> 7.0 m/s² takes ~0.146 s (comparable in order of magnitude to
   *  Bosch IPB ~0.15 s time-to-lock hardware metric [SOURCE: Bosch IPB], [TUNABLE]). */
  emergencyBuildRate: number;
  /** Hydraulic deceleration build-up rate during Stage-1 partial braking (m/s³).
   *  [SIMULATION_ASSUMPTION / TUNABLE] */
  partialBuildRate: number;
  /** Hydraulic brake pressure release rate when exiting intervention (m/s³).
   *  [SIMULATION_ASSUMPTION / TUNABLE] */
  releaseRate: number;
  /** Target front-bumper standstill clearance to obstacle after an AEB stop (m).
   *  [TUNABLE] */
  standstillClearance: number;
  /** Extra longitudinal clearance added for vulnerable road users / pedestrians (m).
   *  [TUNABLE] */
  pedestrianExtraClearance: number;
  /** Lateral half-corridor safety margin around ego body for vehicles (m).
   *  Kept well below adjacent-lane mirror clearance (~1.55 m). [TUNABLE] */
  lateralMarginCar: number;
  /** Lateral half-corridor safety margin around ego body for pedestrians (m).
   *  [TUNABLE] */
  lateralMarginPed: number;
  /** Stage-1 partial braking deceleration as fraction of estimated max brake capability.
   *  [SIMULATION_ASSUMPTION / TUNABLE — cascaded braking concept per Bosch / UN ECE R152] */
  partialDecelFraction: number;
  /** FCW warning Time-To-Impact threshold on valid collision courses (s). [TUNABLE] */
  warnTtiSec: number;
  /** FCW warning Time-To-Brake margin threshold (s). [TUNABLE] */
  warnTtbSec: number;
  /** Stage-1 partial braking Time-To-Brake margin threshold (s). [TUNABLE] */
  partialTtbSec: number;
  /** Stage-1 partial braking Time-To-Impact cap for closing moving leads (s). [TUNABLE] */
  partialMovingTtiSec: number;
  /** Dynamic headway time buffer at speed-match for Stage-1 partial braking (s). [TUNABLE] */
  partialDynamicHeadwaySec: number;
  /** Full emergency braking Time-To-Brake threshold (s). [TUNABLE] */
  emergencyTtbSec: number;
  /** Immediate full emergency braking Time-To-Impact floor (s). [TUNABLE] */
  emergencyTtiFloorSec: number;
  /** Minimum ego speed (m/s) required to initiate a NEW forward AEB event from MONITOR/WARN.
   *  Prevents stationary-pair false triggers while preserving active stops into HOLD. [TUNABLE] */
  minActivationSpeed: number;
  /** Hysteresis margin (s) added to TTB/TTI before stepping down an active intervention. [TUNABLE] */
  exitHysteresisSec: number;
  /** Exit confirmation time (s) when threat metrics ease slightly near boundary. [TUNABLE] */
  exitConfirmSec: number;
  /** Bounded hold duration (s) when a tracked target drops out mid-braking. [TUNABLE] */
  dropoutHoldSec: number;
  /** Bounded ramp-out hold duration (s) if forward sensors fault mid-braking. [TUNABLE] */
  faultHoldSec: number;
  /** Maximum post-stop HOLD duration (s) before automatic release; Infinity keeps hold
   *  until driver foot-brake takeover, hazard departure, or explicit release. [TUNABLE] */
  holdMaxSeconds: number;
  /** Minimum rollout horizon (s). [SIMULATION_ASSUMPTION] */
  minHorizonSec: number;
  /** Maximum rollout horizon (s). [SIMULATION_ASSUMPTION] */
  maxHorizonSec: number;
  /** Rollout integration time step (s) for swept 2D footprint checks. [SIMULATION_ASSUMPTION] */
  rolloutStepSec: number;
  /** Vehicle-specific driver override policy. [TUNABLE] */
  overridePolicy: AEBOverridePolicy;
}

export const DEFAULT_AEB_CALIBRATION: AEBCalibration = {
  actuatorDelaySec: 0.035,
  prefillActuatorDelaySec: 0.015,
  emergencyBuildRate: 48.0,
  partialBuildRate: 28.0,
  releaseRate: 36.0,
  standstillClearance: 1.75,
  pedestrianExtraClearance: 0.55,
  lateralMarginCar: 0.16,
  lateralMarginPed: 0.48,
  partialDecelFraction: 0.55,
  warnTtiSec: 2.6,
  warnTtbSec: 1.15,
  partialTtbSec: 0.35,
  partialMovingTtiSec: 2.4,
  partialDynamicHeadwaySec: 0.5,
  emergencyTtbSec: 0.18,
  emergencyTtiFloorSec: 0.78,
  minActivationSpeed: 0.12,
  exitHysteresisSec: 0.24,
  exitConfirmSec: 0.06,
  dropoutHoldSec: 0.2,
  faultHoldSec: 0.2,
  holdMaxSeconds: Infinity,
  minHorizonSec: 3.0,
  maxHorizonSec: 9.0,
  rolloutStepSec: 0.05,
  overridePolicy: {
    throttleOverrideThreshold: null,
    steeringOverrideRelease: true,
  },
};

export interface AEBAvailabilityReport {
  availability: AEBAvailability;
  reason: string;
  sensors: SensorAvailability;
  radarOnly: boolean;
  cameraOnly: boolean;
}

/** Evaluate AEB operational health independently of comfort ACC interlocks
 *  (e.g. unfastened seatbelt inhibits ACC but MUST NOT disable AEB). */
export function assessAEBAvailability(
  aebEnabled: boolean,
  frame: AvailabilityFrame,
  hasCoastingTarget = false,
): AEBAvailabilityReport {
  const base = assistanceAvailability(frame);
  const { sensors, conditions } = base;
  if (!aebEnabled) {
    return { availability: "unavailable", reason: "AEB đã tắt trong cấu hình", sensors, radarOnly: false, cameraOnly: false };
  }
  if (!conditions.engineOn) {
    return { availability: "unavailable", reason: "Động cơ chưa khởi động", sensors, radarOnly: false, cameraOnly: false };
  }
  if (conditions.gear !== "D") {
    return { availability: "unavailable", reason: "AEB tiến chỉ hoạt động ở số D", sensors, radarOnly: false, cameraOnly: false };
  }
  if (conditions.epb) {
    return { availability: "unavailable", reason: "Phanh đỗ điện tử đang giữ", sensors, radarOnly: false, cameraOnly: false };
  }
  if (!conditions.escAvailable) {
    return { availability: "unavailable", reason: "ESC/phanh điện tử không sẵn sàng", sensors, radarOnly: false, cameraOnly: false };
  }
  if (frame.sensorsAvailable === false || (!sensors.camera && !sensors.frontRadar)) {
    return { availability: "unavailable", reason: "Mất hoàn toàn cảm biến phía trước", sensors, radarOnly: false, cameraOnly: false };
  }
  if (!sensors.camera && sensors.frontRadar) {
    return {
      availability: "degraded",
      reason: "Mất camera trước · chỉ còn radar (suy giảm nhận diện người đi bộ)",
      sensors,
      radarOnly: true,
      cameraOnly: false,
    };
  }
  if (sensors.camera && !sensors.frontRadar) {
    return {
      availability: "degraded",
      reason: "Mất radar trước · chỉ còn camera (giảm độ chính xác khoảng cách/vận tốc)",
      sensors,
      radarOnly: false,
      cameraOnly: true,
    };
  }
  if (hasCoastingTarget) {
    return {
      availability: "degraded",
      reason: "Mục tiêu đang dự báo quán tính ngắn hạn do rớt mẫu cảm biến",
      sensors,
      radarOnly: false,
      cameraOnly: false,
    };
  }
  return { availability: "available", reason: "Sẵn sàng", sensors, radarOnly: false, cameraOnly: false };
}

export interface TargetRisk {
  targetId: number;
  obstacle: Obstacle;
  /** True 2D surface-to-surface clearance at t = 0 (m). */
  gap: number;
  /** Longitudinal gap along road Frenet coordinate at t = 0 (m). */
  longitudinalGap: number;
  /** Closing speed along ego travel corridor (m/s, >0 approaching). */
  closingSpeed: number;
  /** Simple bumper TTC (s); finite ONLY when ttcValid === true, else Infinity. */
  ttc: number;
  /** True iff target currently overlaps lateral corridor and closingSpeed > 0.05 m/s. */
  ttcValid: boolean;
  /** Synchronized 2D swept-footprint Time-To-Impact under maintain control (s). */
  tti: number;
  /** Remaining Time-To-Brake before full emergency braking cannot keep clearance (s). */
  ttb: number;
  /** Minimum 2D corridor clearance over [0, horizon] under Maintain control (m). */
  minGapMaintain: number;
  /** Minimum 2D corridor clearance over [0, horizon] under Partial braking (m). */
  minGapPartial: number;
  /** Minimum 2D corridor clearance over [0, horizon] under Full braking (m). */
  minGapFull: number;
  /** Minimum 2D corridor clearance over [0, horizon] under current Driver brake (m). */
  minGapDriver: number;
  /** Required longitudinal deceleration (m/s²) to stop outside requiredClearance. */
  requiredDecel: number;
  /** Required longitudinal clearance at stop/closest-approach (m). */
  requiredClearance: number;
  /** Dynamic clearance including speed-match buffer for partial stage (m). */
  dynamicClearance: number;
  /** True when trajectory conflict exists within horizon under Maintain control. */
  hasCollisionCourse: boolean;
  /** True when even immediate full braking cannot prevent physical contact (minGapFull < 0). */
  unavoidable: boolean;
  /** Cause label in Vietnamese for HUD / diagnostics. */
  cause: string;
  /** Urgency score used for deterministic critical-target selection. */
  urgencyScore: number;
}

export interface EgoPathSample {
  u: number;
  x: number;
  y: number;
  yaw: number;
}

export interface PredictorContext {
  ego: Vehicle;
  egoS: number;
  egoD: number;
  path: ReferencePath;
  road: Road;
  obstacles: readonly Obstacle[];
  steerCmd: number;
  driverSteerInput: number;
  driverThrottle: number;
  driverBrake: number;
  laneAssistActive: boolean;
  targetLaneD: number;
  estimatedMu: number;
  prefillReady: boolean;
  availability: AEBAvailabilityReport;
  calibration: AEBCalibration;
  /** Turn signal indicator (-1 left, +1 right, 0 off) for junction turn-across-path context. */
  indicator?: number;
}

/** Exact 2D surface-to-surface clearance between two oriented rectangles (m).
 *  Returns <= 0 (-penetrationDepth) when overlapping, > 0 when disjoint. */
export function obbClearance(a: Body2D, b: Body2D): number {
  const hit = bodyContact(a, b, 0);
  if (hit) return -hit.depth;

  const minCornerDistSq = (src: Body2D, dst: Body2D): number => {
    const csS = Math.cos(src.yaw);
    const snS = Math.sin(src.yaw);
    const csD = Math.cos(dst.yaw);
    const snD = Math.sin(dst.yaw);
    const hlS = src.length * 0.5;
    const hwS = src.width * 0.5;
    const hlD = dst.length * 0.5;
    const hwD = dst.width * 0.5;
    let best = Infinity;
    for (const sx of [-hlS, hlS]) {
      for (const sy of [-hwS, hwS]) {
        const wx = src.x + sx * csS - sy * snS - dst.x;
        const wy = src.y + sx * snS + sy * csS - dst.y;
        const lx = wx * csD + wy * snD;
        const ly = -wx * snD + wy * csD;
        const dx = Math.max(0, Math.abs(lx) - hlD);
        const dy = Math.max(0, Math.abs(ly) - hwD);
        const d2 = dx * dx + dy * dy;
        if (d2 < best) best = d2;
      }
    }
    return best;
  };

  return Math.sqrt(Math.min(minCornerDistSq(a, b), minCornerDistSq(b, a)));
}

/** Construct ego's anisotropic safety-buffered Body2D:
 *  - Rear stays at ego rear bumper (-length/2) so followers behind never trigger front AEB
 *  - Sides expand by `latMargin`
 *  - Front bumper extends forward by `frontBuffer` */
function egoCorridorBody(pose: { x: number; y: number; yaw: number }, dims: { length: number; width: number }, frontBuffer: number, latMargin: number): Body2D {
  const shift = frontBuffer * 0.5;
  return {
    x: pose.x + Math.cos(pose.yaw) * shift,
    y: pose.y + Math.sin(pose.yaw) * shift,
    yaw: pose.yaw,
    length: dims.length + frontBuffer,
    width: dims.width + 2 * latMargin,
  };
}

/** Forward bumper-to-target clearance in ego's local corridor frame (m), or Infinity
 *  if the target lies completely outside ego's lateral corridor (`dims.width/2 + latMargin`)
 *  or completely behind ego's rear bumper. */
function forwardCorridorClearance(
  egoPose: { x: number; y: number; yaw: number },
  egoDims: { length: number; width: number },
  target: Body2D,
  latMargin: number,
): number {
  const overlap = bodyContact(
    egoCorridorBody(egoPose, egoDims, 0, latMargin),
    target,
    0,
  );
  if (overlap) return -overlap.depth;

  const csE = Math.cos(egoPose.yaw);
  const snE = Math.sin(egoPose.yaw);
  const csT = Math.cos(target.yaw);
  const snT = Math.sin(target.yaw);
  const hlT = target.length * 0.5;
  const hwT = target.width * 0.5;
  const latHalf = egoDims.width * 0.5 + latMargin;
  const rearX = -egoDims.length * 0.5;
  const frontX = egoDims.length * 0.5;

  let minLx = Infinity;
  let maxLx = -Infinity;
  let minLy = Infinity;
  let maxLy = -Infinity;
  const corners: [number, number][] = [];
  for (const sx of [-hlT, hlT]) {
    for (const sy of [-hwT, hwT]) {
      const wx = target.x + sx * csT - sy * snT - egoPose.x;
      const wy = target.y + sx * snT + sy * csT - egoPose.y;
      const lx = wx * csE + wy * snE;
      const ly = -wx * snE + wy * csE;
      corners.push([lx, ly]);
      if (lx < minLx) minLx = lx;
      if (lx > maxLx) maxLx = lx;
      if (ly < minLy) minLy = ly;
      if (ly > maxLy) maxLy = ly;
    }
  }
  if (maxLx < rearX || maxLy < -latHalf || minLy > latHalf) return Infinity;

  // Check minimal forward x of any point on target's 4 edges lying within [-latHalf, +latHalf].
  let minForwardInBand = Infinity;
  const order = [0, 1, 3, 2];
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = corners[order[i]];
    const [x2, y2] = corners[order[(i + 1) % 4]];
    if (Math.abs(y1) <= latHalf) minForwardInBand = Math.min(minForwardInBand, x1);
    if (Math.abs(y2) <= latHalf) minForwardInBand = Math.min(minForwardInBand, x2);
    const dy = y2 - y1;
    if (Math.abs(dy) > 1e-8) {
      for (const boundY of [-latHalf, latHalf]) {
        const alpha = (boundY - y1) / dy;
        if (alpha >= 0 && alpha <= 1) {
          minForwardInBand = Math.min(minForwardInBand, x1 + alpha * (x2 - x1));
        }
      }
    }
  }
  if (!Number.isFinite(minForwardInBand)) return Infinity;
  if (minForwardInBand < rearX) return Infinity;
  return minForwardInBand - frontX;
}

/** Exact 1D forward travel distance u(t) >= 0 of ego along its predicted spatial path:
 *  - [0, waitSec]: maintain acceleration `aMaintain`
 *  - [waitSec, waitSec + delaySec]: actuator command dead-time at `aMaintain`
 *  - [waitSec + delaySec, ...]: linear ramp at `-buildRate` to `-bTarget`, clamped at v >= 0. */
export function egoDisplacementAt(
  v0: number,
  aMaintain: number,
  bTarget: number,
  waitSec: number,
  delaySec: number,
  buildRate: number,
  t: number,
): { u: number; v: number } {
  if (t <= 0 || v0 <= 1e-6 && aMaintain <= 0) return { u: 0, v: 0 };

  // Phase 1: Maintain + command dead-time [0, tHold]
  const tHold = Math.max(0, waitSec + (bTarget > 0 ? delaySec : 0));
  const dt1 = Math.min(t, tHold);
  let u = 0;
  let v = v0;
  if (dt1 > 0) {
    if (aMaintain < -1e-6 && v + aMaintain * dt1 <= 0) {
      const tStop1 = v / -aMaintain;
      return { u: 0.5 * v * tStop1, v: 0 };
    }
    u += v * dt1 + 0.5 * aMaintain * dt1 * dt1;
    v = Math.max(0, v + aMaintain * dt1);
  }
  if (t <= tHold || bTarget <= 0 || v <= 1e-6) {
    if (bTarget <= 0 && t > tHold && v > 1e-6) {
      const dtRem = t - tHold;
      if (aMaintain < -1e-6 && v + aMaintain * dtRem <= 0) {
        const ts = v / -aMaintain;
        return { u: u + 0.5 * v * ts, v: 0 };
      }
      return { u: u + v * dtRem + 0.5 * aMaintain * dtRem * dtRem, v: Math.max(0, v + aMaintain * dtRem) };
    }
    return { u, v };
  }

  // Phase 2: Linear ramp from aStart down to -bTarget at rate `buildRate`
  const aStart = Math.min(aMaintain, 0);
  const deltaA = aStart - (-bTarget); // >= 0 when -bTarget < aStart
  let tRem = t - tHold;
  if (deltaA > 1e-6 && buildRate > 1e-3) {
    const tRampFull = deltaA / buildRate;
    // Check if v hits 0 during ramp: v(tau) = v + aStart*tau - 0.5*buildRate*tau^2 = 0
    const disc = aStart * aStart + 2 * buildRate * v;
    const tZeroInRamp = (aStart + Math.sqrt(Math.max(0, disc))) / buildRate;
    if (tZeroInRamp <= Math.min(tRem, tRampFull)) {
      const tau = Math.max(0, tZeroInRamp);
      u += v * tau + 0.5 * aStart * tau * tau - (1 / 6) * buildRate * tau * tau * tau;
      return { u, v: 0 };
    }
    const dt2 = Math.min(tRem, tRampFull);
    u += v * dt2 + 0.5 * aStart * dt2 * dt2 - (1 / 6) * buildRate * dt2 * dt2 * dt2;
    v = Math.max(0, v + aStart * dt2 - 0.5 * buildRate * dt2 * dt2);
    tRem -= dt2;
  }
  if (tRem <= 0 || v <= 1e-6) return { u, v };

  // Phase 3: Constant braking at -bTarget until v = 0
  const tStop3 = v / bTarget;
  const dt3 = Math.min(tRem, tStop3);
  u += v * dt3 - 0.5 * bTarget * dt3 * dt3;
  v = dt3 >= tStop3 ? 0 : Math.max(0, v - bTarget * dt3);
  return { u, v };
}

function buildEgoSpatialPath(ctx: PredictorContext, maxDist: number): EgoPathSample[] {
  const { ego, egoS, egoD, path, steerCmd, laneAssistActive, estimatedMu } = ctx;
  const stepM = 1.0;
  const totalDist = Math.max(4, Math.ceil(maxDist));
  const samples: EgoPathSample[] = [{ u: 0, x: ego.x, y: ego.y, yaw: ego.yaw }];

  if (laneAssistActive) {
    const w0 = path.toCartesian(egoS, egoD);
    const resX = ego.x - w0.x;
    const resY = ego.y - w0.y;
    const resYaw = wrapAngle(ego.yaw - w0.heading);
    const relaxLen = Math.max(14, ego.v * 1.15);
    for (let u = stepM; u <= totalDist; u += stepM) {
      const decay = Math.exp(-u / relaxLen);
      const dAtU = ctx.targetLaneD + (egoD - ctx.targetLaneD) * decay;
      const slopeD = -(egoD - ctx.targetLaneD) / relaxLen * decay;
      const w = path.toCartesian(egoS + u, dAtU);
      const anchorBlend = Math.exp(-u / 2.5);
      samples.push({
        u,
        x: w.x + resX * anchorBlend,
        y: w.y + resY * anchorBlend,
        yaw: wrapAngle(w.heading + Math.atan(slopeD) + resYaw * anchorBlend),
      });
    }
    return samples;
  }

  // Bicycle kinematic arc when lane assistance is inactive or driver overrides steering.
  const grip = clamp(estimatedMu, 0.2, 1.2) * 9.81;
  const rawCurvature = Math.tan(clamp(steerCmd, -ego.maxSteer, ego.maxSteer)) / ego.dims.wheelbase;
  const maxCurvature = ego.limitLateralGrip ? grip / Math.max(ego.v * ego.v, 2.0) : Infinity;
  const curvature = clamp(rawCurvature, -maxCurvature, maxCurvature);
  let x = ego.x;
  let y = ego.y;
  let yaw = ego.yaw;
  for (let u = stepM; u <= totalDist; u += stepM) {
    const midYaw = yaw + 0.5 * curvature * stepM;
    x += Math.cos(midYaw) * stepM;
    y += Math.sin(midYaw) * stepM;
    yaw = wrapAngle(yaw + curvature * stepM);
    samples.push({ u, x, y, yaw });
  }
  return samples;
}

function sampleEgoPath(samples: readonly EgoPathSample[], u: number): { x: number; y: number; yaw: number } {
  if (u <= 0 || samples.length === 1) return samples[0];
  const idx = Math.min(Math.floor(u), samples.length - 2);
  const frac = clamp(u - idx, 0, 1);
  const a = samples[idx];
  const b = samples[idx + 1];
  return {
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
    yaw: wrapAngle(a.yaw + wrapAngle(b.yaw - a.yaw) * frac),
  };
}

function predictTargetPoseAt(
  obs: Obstacle,
  path: ReferencePath,
  road: Road,
  t: number,
): { body: Body2D; vAlong: number } {
  if (obs.roadBoundary) {
    const w = path.toCartesian(obs.s, obs.roadBoundary.d);
    return {
      body: { x: w.x, y: w.y, yaw: w.heading, length: obs.length, width: obs.roadBoundary.width },
      vAlong: 0,
    };
  }

  // Only raw delayed poses need latency propagation. The live tracker already
  // predicts its state to the current simulation clock between scans; adding
  // measurement latency again would move a lead away (or a crossing actor out
  // of the lane) and overstate our available braking distance.
  const remainingLatency = obs.latencyCompensated ? 0 : clamp(obs.latencySec ?? 0, 0, 0.2);
  const totalT = Math.max(0, t + remainingLatency);
  const v0 = obs.v;
  const measuredAccel = obs.accel ?? 0;
  // A genuinely delayed sensor track can already be at the current position
  // while its acceleration estimate is still catching a hard-braking onset.
  // Bound FUTURE braking, rather than advancing that position twice. The
  // 30 m/s^3 onset-jerk bound is an explicit simulation assumption; apply it
  // only to a measured braking trend, never to an unbraking adjacent/lead car.
  // Blend continuously with the observed braking trend. A hard -1.5 m/s²
  // switch made small measurement noise jump the forecast by 1.65 m/s²,
  // repeatedly starting/stopping FCW behind a gently braking motorcycle.
  const brakingOnsetAllowance = obs.source === 'sensor'
    ? 30 * clamp((obs.latencySec ?? 0) + (obs.coastingSec ?? 0), 0, .2) * clamp(-measuredAccel / 3, 0, 1) : 0;
  const a0 = clamp(measuredAccel - brakingOnsetAllowance, -9.5, 4.5);
  let ds = 0;
  let vNow = v0;
  if (v0 >= 0) {
    if (a0 < -0.05) {
      const tStop = v0 / -a0;
      const tb = Math.min(totalT, tStop);
      ds = v0 * tb + 0.5 * a0 * tb * tb;
      vNow = totalT >= tStop ? 0 : v0 + a0 * totalT;
    } else {
      const tAcc = Math.min(totalT, 1.2);
      const aPos = Math.max(0, a0);
      ds = v0 * totalT + 0.5 * aPos * tAcc * tAcc + aPos * tAcc * Math.max(0, totalT - tAcc);
      vNow = v0 + aPos * tAcc;
    }
  } else {
    // Oncoming / reversing velocity
    ds = v0 * totalT;
    vNow = v0;
  }

  const vd = obs.vd ?? 0;
  let dNow = obs.d;
  let yawOffset = 0;
  if (obs.kind === "ped" || Math.abs(vd) >= 2.1) {
    // Pedestrian or perpendicular junction-crossing vehicle traverses continuously across road.
    dNow = obs.d + vd * totalT;
    yawOffset = obs.kind === "ped" ? 0 : Math.atan2(vd, Math.max(Math.abs(vNow), 0.1));
  } else if (v0 >= -0.5 && Math.abs(vd) > 0.05) {
    // Lane-changing vehicle settles once reaching the target adjacent lane centre
    // rather than flying across multiple lanes forever.
    const currentLane = road.laneOf(obs.d);
    const ownLaneCenter = road.laneCenter(currentLane);
    let targetD = obs.d + Math.sign(vd) * road.laneWidth;
    for (let l = 0; l < road.numLanes; l++) {
      const lc = road.laneCenter(l);
      if ((lc - obs.d) * vd > 0.2 && Math.abs(lc - obs.d) <= road.laneWidth * 1.35) {
        if (Math.abs(lc - obs.d) < Math.abs(targetD - obs.d) || l !== currentLane) {
          targetD = lc;
        }
      }
    }
    const maxShift = Math.max(0.4, Math.abs(targetD - obs.d));
    const shiftFromOwnCenter = (obs.d - ownLaneCenter) * Math.sign(vd);
    const noisyUnencroached =
      obs.source === "sensor" &&
      Math.abs(vd) < 0.95 &&
      shiftFromOwnCenter < 0.42;
    const tLatEnd = Math.min(maxShift / Math.abs(vd), noisyUnencroached ? 0.85 : Infinity);
    const tLat = Math.min(totalT, tLatEnd);
    dNow = obs.d + vd * tLat;
    yawOffset = !noisyUnencroached && totalT < tLatEnd ? Math.atan2(vd, Math.max(Math.abs(vNow), 1.0)) : 0;
  } else if (v0 < -0.5) {
    yawOffset = Math.PI;
  }

  const w = path.toCartesian(obs.s + ds, dNow);
  // Live perception supplies dimensions already projected onto the road
  // tangent (including the full lateral span of a perpendicular bus/truck).
  // Its velocity still predicts motion, but rotating that envelope a second
  // time swaps its long side back into the road and hides an occupied lane.
  if (obs.footprintFrame === "road") yawOffset = 0;
  return {
    body: {
      x: w.x,
      y: w.y,
      yaw: wrapAngle(w.heading + yawOffset),
      length: obs.length,
      width: obs.width,
    },
    vAlong: vNow,
  };
}

function classifyCause(obs: Obstacle, egoD: number, laneWidth: number, egoTurning = false, egoWidth = 2.0): string {
  if (obs.roadBoundary) return "Lan can / dải phân cách phía trước";
  if (obs.kind === "ped") {
    return egoTurning ? "Người đi bộ cắt ngang hướng rẽ" : "Người đi bộ băng qua đường";
  }
  const dd = Math.abs(obs.d - egoD);
  if (obs.v < -1.0) {
    return egoTurning || dd > (obs.width + egoWidth) * 0.5 + 0.25
      ? "Xe ngược chiều khi rẽ qua giao lộ"
      : "Phương tiện ngược chiều trong làn";
  }
  if (Math.abs(obs.vd ?? 0) >= 2.1) return "Phương tiện cắt ngang giao lộ";
  if (dd > laneWidth * 0.42 && Math.abs(obs.vd ?? 0) > 0.2) return "Phương tiện tạt đầu vào làn";
  if (obs.v < 0.8) return "Chướng ngại vật dừng trong làn";
  return "Xe phía trước giảm tốc gấp";
}

export class CollisionPredictor {
  /** Evaluate per-target collision risk independently and aggregate deterministically.
   *  Invariant to permutations of `ctx.obstacles`. */
  evaluate(ctx: PredictorContext): {
    risks: TargetRisk[];
    critical: TargetRisk | null;
    estimatedBrakeCap: number;
  } {
    const { ego, egoS, egoD, path, road, calibration, availability } = ctx;

    // 1. Estimate physical brake capability using controller's mu estimate, cornering demand, and grade.
    const muEst = clamp(ctx.estimatedMu, 0.2, 1.1);
    const gripEst = muEst * 9.81;
    let maxBrakeEst = Math.min(ego.maxDecel * muEst, gripEst);
    if (ego.v > 0.5 && Math.abs(ctx.steerCmd) > 1e-3) {
      const latDemand = (ego.v * ego.v / ego.dims.wheelbase) * Math.abs(Math.tan(clamp(ctx.steerCmd, -ego.maxSteer, ego.maxSteer)));
      const reservedLat = Math.min(latDemand, 0.78 * gripEst);
      maxBrakeEst = Math.min(maxBrakeEst, Math.sqrt(Math.max(gripEst * gripEst - reservedLat * reservedLat, (0.35 * gripEst) ** 2)));
    }
    const gradeLoss = 9.81 * Math.sin(ego.roadGrade); // <0 on downhill reduces effective deceleration
    // A fixed comfort floor overstates the available net deceleration on a
    // slippery downhill (e.g. mu=.2 and -0.1rad grade leaves only ~.42m/s²).
    // Retain just a numerical floor for rollout division, not a claimed
    // physical brake capability of 1.2m/s² when the tyres cannot supply it.
    const estimatedBrakeCap = Math.max(0.05, maxBrakeEst + gradeLoss);

    const horizon = clamp(ego.v / estimatedBrakeCap + 1.5, calibration.minHorizonSec, calibration.maxHorizonSec);
    const aMaintain = ctx.driverBrake > 0
      ? -ctx.driverBrake * estimatedBrakeCap
      : ctx.driverThrottle > 0
        ? ctx.driverThrottle * ego.maxAccel * muEst
        : 0;
    const maxMaintainDist = ego.v * horizon + 0.5 * Math.max(0, aMaintain) * Math.min(horizon, 3.0) ** 2 + 12;
    const spatialPath = buildEgoSpatialPath(ctx, maxMaintainDist);

    // 2. Canonical immutable snapshot sorted deterministically so array order NEVER affects output.
    const snapshot = ctx.obstacles.map((o, idx) => ({
      obs: { ...o, ...(o.roadBoundary ? { roadBoundary: { ...o.roadBoundary } } : {}) },
      stableId: o.id ?? (1_000_000 + idx),
    }));
    snapshot.sort((a, b) =>
      ((a.obs.id ?? Infinity) - (b.obs.id ?? Infinity)) ||
      (a.obs.s - b.obs.s) ||
      (a.obs.d - b.obs.d) ||
      (a.obs.v - b.obs.v) ||
      (a.obs.length - b.obs.length) ||
      a.obs.kind.localeCompare(b.obs.kind),
    );
    // Assign deterministic synthetic IDs when raw ground-truth/unit-test obstacles omit `id`
    // AFTER canonical geometric sorting so permutations produce identical IDs!
    for (let i = 0; i < snapshot.length; i++) {
      if (snapshot[i].obs.id === undefined) {
        snapshot[i].stableId = 10_000 + i + 1;
      } else {
        snapshot[i].stableId = snapshot[i].obs.id!;
      }
    }

    const delaySec = ctx.prefillReady ? calibration.prefillActuatorDelaySec : calibration.actuatorDelaySec;
    const stepDt = calibration.rolloutStepSec;
    const nSteps = Math.max(8, Math.ceil(horizon / stepDt));
    const egoStartPose = spatialPath[0];
    const egoStartBody: Body2D = { ...egoStartPose, length: ego.dims.length, width: ego.dims.width };
    const egoHeading = path.cartesianAt(egoS).heading;
    const egoYawErr = wrapAngle(ego.yaw - egoHeading);
    const egoTurning =
      !ctx.laneAssistActive &&
      (Math.abs(ctx.steerCmd) >= 0.04 || Math.abs(egoYawErr) >= 0.09);
    const steeringTowardEdge = Math.abs(ctx.driverSteerInput) >= 0.05 || Math.abs(egoD - road.forwardOffset) > (road.numLanes * road.laneWidth) * 0.5 - 0.3;

    const risks: TargetRisk[] = [];
    for (const item of snapshot) {
      const obs = item.obs;
      // Radar-only degraded mode has severely reduced pedestrian classification range.
      if (availability.radarOnly && obs.kind === "ped") {
        const fwd = wrapDiff(obs.s, egoS, path.length);
        if (fwd > 18) continue;
      }
      // Tentative 1-hit detections far ahead wait for confirmation; in particular, a single
      // monocular camera frame (`sensorChannel === "camera"`) has no Doppler velocity (`vx=vy=0` prior).
      if (obs.confirmed === false) {
        const fwd = wrapDiff(obs.s, egoS, path.length);
        if (obs.sensorChannel === "camera" && fwd > 18) continue;
        if ((obs.confidence ?? 1) < 0.55 && fwd > 24) continue;
      }
      if (obs.roadBoundary && !steeringTowardEdge) continue;

      const fwdS = wrapDiff(obs.s, egoS, path.length);
      const halfSum = (ego.dims.length + obs.length) * 0.5;
      if (fwdS < -halfSum * 0.65) continue;

      // Junction Turn-Across-Path (`CCFtap`) ODD guard for oncoming vehicles in opposing lanes:
      // Straight/lane-keeping driving past opposing-lane traffic must have 0% false triggers;
      // oncoming vehicles outside ego's current lane are evaluated ONLY when ego is actively
      // turning across toward the opposing lane within urban/suburban turn speeds.
      const latSepNow = Math.abs(obs.d - egoD);
      const inOpposingCarriageway =
        road.opposingLanes > 0
          ? (road.rightHandMotorway ? obs.d < road.centerDivider + 0.55 : obs.d > road.centerDivider - 0.55)
          : latSepNow > (ego.dims.width + obs.width) * 0.5 + 0.10;
      if (!obs.roadBoundary && obs.v < -1.0 && inOpposingCarriageway) {
        const turnDirToObs = Math.sign(obs.d - egoD);
        const turningAcrossToOpposing =
          !ctx.laneAssistActive &&
          ego.v <= 15.5 &&
          (ctx.steerCmd * turnDirToObs >= 0.035 || egoYawErr * turnDirToObs >= 0.085);
        if (!turningAcrossToOpposing) {
          continue;
        }
      }

      // If ego's front bumper is already alongside an adjacent-lane vehicle (longGap < -0.15 m
      // while laterally clear in an adjacent lane), longitudinal forward AEB must not slam
      // brakes (which traps ego alongside the vehicle rather than avoiding a front impact).
      if (
        !obs.roadBoundary &&
        obs.kind === "car" &&
        fwdS - halfSum < -0.15 &&
        Math.abs(obs.d - egoD) > (ego.dims.width + obs.width) * 0.5 + 0.25 &&
        Math.abs(obs.vd ?? 0) < 2.1
      ) {
        continue;
      }
      if (fwdS > maxMaintainDist + Math.max(0, -obs.v) * horizon + 12) continue;

      const latMargin = obs.kind === "ped" ? calibration.lateralMarginPed : calibration.lateralMarginCar;
      if (
        !obs.roadBoundary &&
        Math.abs(ctx.driverSteerInput) < 0.08 &&
        Math.abs(ctx.steerCmd) < 0.035 &&
        Math.abs(egoYawErr) < 0.085 &&
        Math.abs(obs.d - egoD) > Math.abs(obs.vd ?? 0) * horizon + road.laneWidth * 1.4 + 3.5
      ) {
        continue;
      }

      // Pre-sample target 2D footprints along synchronized timestamps [0..horizon].
      const targetFrames: { body: Body2D; vAlong: number }[] = new Array(nSteps + 1);
      for (let k = 0; k <= nSteps; k++) {
        targetFrames[k] = predictTargetPoseAt(obs, path, road, k * stepDt);
      }

      const gap0 = obbClearance(egoStartBody, targetFrames[0].body);
      const longGap0 = fwdS - halfSum;
      const egoAlong = ego.v * Math.cos(egoYawErr);
      const closingSpeed = egoAlong - obs.v;

      // Simple TTC is ONLY valid when currently overlapping lateral corridor & closingSpeed > 0.05 m/s.
      const initCorridorGap = forwardCorridorClearance(egoStartPose, ego.dims, targetFrames[0].body, latMargin);
      const laterallyAlignedNow = Number.isFinite(initCorridorGap) && Math.abs(obs.d - egoD) <= (ego.dims.width + obs.width) * 0.5 + latMargin + 0.15;
      const ttcValid = laterallyAlignedNow && longGap0 >= -0.5 && closingSpeed > 0.05;
      const ttc = ttcValid ? Math.max(0, longGap0) / closingSpeed : Infinity;

      // The filtered mean is already propagated to NOW. Do not shift it by
      // processing latency again. Reserve a bounded two-sigma longitudinal
      // error envelope instead: range error plus velocity error accumulated
      // over the next two seconds (or the shorter braking time). The old
      // 0.35-sigma range-only buffer ignored velocity uncertainty and could
      // leave almost no clearance behind a braking lead in rain.
      // This is a simulation calibration, not an OEM safety guarantee; the
      // separate 2D corridor check still excludes adjacent-lane targets.
      const uncertaintyHorizon = Math.min(2, Math.max(0, ego.v) / Math.max(estimatedBrakeCap, 0.5));
      const uncertaintyExtra = Math.min(3,
        2 * Math.max(0, obs.posStd ?? 0) +
        2 * Math.max(0, obs.velStd ?? 0) * uncertaintyHorizon +
        Math.max(0, obs.coastingSec ?? 0) * Math.max(0, closingSpeed));
      const lowMuBuffer = muEst < 0.92 ? (0.92 - muEst) * 2.5 : 0;
      const requiredClearance =
        calibration.standstillClearance +
        lowMuBuffer +
        (obs.kind === "ped" ? calibration.pedestrianExtraClearance : 0) +
        uncertaintyExtra;

      // Helper to rollout any braking profile and measure minimum corridor clearance & first contact time.
      const rolloutProfile = (
        bTarget: number,
        waitSec: number,
        delay: number,
        rate: number,
      ): { minGap: number; hitTime: number; endTargetSpeed: number } => {
        let minGap = Infinity;
        let hitTime = Infinity;
        let prevPose: { x: number; y: number; yaw: number } = egoStartPose;
        let prevCorridor = egoCorridorBody(prevPose, ego.dims, 0, latMargin);
        let endTargetSpeed = targetFrames[nSteps].vAlong;

        for (let k = 1; k <= nSteps; k++) {
          const tPrev = (k - 1) * stepDt;
          const tNow = k * stepDt;
          const { u, v: vEgoNow } = egoDisplacementAt(ego.v, aMaintain, bTarget, waitSec, delay, rate, tNow);
          const poseNow = sampleEgoPath(spatialPath, u);
          const corridorNow = egoCorridorBody(poseNow, ego.dims, 0, latMargin);
          const tStart = targetFrames[k - 1].body;
          const tEnd = targetFrames[k].body;

          // Continuous swept 2D OBB check prevents high-speed inter-step tunneling!
          const sweptHit = sweepBodies(prevCorridor, corridorNow, tStart, tEnd, 0);
          if (sweptHit) {
            const exactT = tPrev + sweptHit.time * stepDt;
            if (exactT < hitTime) hitTime = exactT;
            const overlapNow = bodyContact(corridorNow, tEnd, 0);
            minGap = Math.min(minGap, overlapNow ? -overlapNow.depth : -0.02);
          } else {
            let cGap = forwardCorridorClearance(poseNow, ego.dims, tEnd, latMargin);
            // When ego has stopped short of an intersection/opposing-lane conflict (`CCFtap` / `CPTA`),
            // evaluate exact 2D OBB clearance between the stopped ego envelope and the passing actor.
            if (
              vEgoNow <= 1e-4 &&
              (obs.v < -0.5 || Math.abs(obs.vd ?? 0) > 0.35 || obs.kind === "ped")
            ) {
              cGap = Math.min(cGap, obbClearance(corridorNow, tEnd));
            }
            if (cGap < minGap) {
              minGap = cGap;
              endTargetSpeed = targetFrames[k].vAlong;
            }
          }

          prevPose = poseNow;
          prevCorridor = corridorNow;
          // Once BOTH ego and target have come to a complete stop, static separation cannot shrink further.
          if (bTarget > 0 && tNow > waitSec + delay && vEgoNow <= 1e-5 && Math.abs(targetFrames[k].vAlong) <= 1e-4 && Math.abs(obs.vd ?? 0) <= 1e-4) {
            break;
          }
        }
        return { minGap, hitTime, endTargetSpeed };
      };

      // Maintain control baseline (no new AEB braking; uses aMaintain = 0 when throttle/coast to test pure threat)
      const baselineMaintainAccel = ctx.driverThrottle > 0 ? Math.min(ctx.driverThrottle * ego.maxAccel * muEst, 2.0) : 0;
      const savedMaintain = aMaintain;
      // Evaluate unbraked trajectory conflict (would ego collide or violate safe clearance without braking?)
      let minGapMaintain = Infinity;
      let tti = Infinity;
      {
        let prevPose: { x: number; y: number; yaw: number } = egoStartPose;
        let prevCorridor = egoCorridorBody(prevPose, ego.dims, 0, latMargin);
        for (let k = 1; k <= nSteps; k++) {
          const tPrev = (k - 1) * stepDt;
          const tNow = k * stepDt;
          const { u } = egoDisplacementAt(ego.v, baselineMaintainAccel, 0, 0, 0, 0, tNow);
          const poseNow = sampleEgoPath(spatialPath, u);
          const corridorNow = egoCorridorBody(poseNow, ego.dims, 0, latMargin);
          const sweptHit = sweepBodies(prevCorridor, corridorNow, targetFrames[k - 1].body, targetFrames[k].body, 0);
          if (sweptHit) {
            const exactT = tPrev + sweptHit.time * stepDt;
            if (exactT < tti) tti = exactT;
            const overlapNow = bodyContact(corridorNow, targetFrames[k].body, 0);
            minGapMaintain = Math.min(minGapMaintain, overlapNow ? -overlapNow.depth : -0.02);
          } else {
            const cGap = forwardCorridorClearance(poseNow, ego.dims, targetFrames[k].body, latMargin);
            if (cGap < minGapMaintain) minGapMaintain = cGap;
          }
          prevPose = poseNow;
          prevCorridor = corridorNow;
        }
      }
      void savedMaintain;

      // Moving-away & stationary-clearance check: if unbraked trajectory never hits and keeps safe clearance, no collision course!
      const approachingOrEncroaching =
        tti < Infinity ||
        (minGapMaintain < requiredClearance && (closingSpeed > 0.15 || (obs.accel ?? 0) < -1.0 || Math.abs(obs.vd ?? 0) > 0.2));
      const hasCollisionCourse = ego.v >= calibration.minActivationSpeed && approachingOrEncroaching;

      const bPartial = estimatedBrakeCap * calibration.partialDecelFraction;
      const fullRes = rolloutProfile(estimatedBrakeCap, 0, delaySec, calibration.emergencyBuildRate);
      const partialRes = rolloutProfile(bPartial, 0, delaySec, calibration.partialBuildRate);
      const driverBrakeDecel = ctx.driverBrake * estimatedBrakeCap;
      const driverRes = ctx.driverBrake > 0.02
        ? rolloutProfile(driverBrakeDecel, 0, 0, calibration.emergencyBuildRate)
        : { minGap: minGapMaintain, hitTime: tti, endTargetSpeed: fullRes.endTargetSpeed };

      const dynamicClearance =
        requiredClearance + Math.max(0, partialRes.endTargetSpeed) * calibration.partialDynamicHeadwaySec;
      const unavoidable = hasCollisionCourse && fullRes.minGap < 0;

      // Exact bisection for Time-To-Brake (ttb) when threat exists and full brake currently succeeds.
      let ttb = Infinity;
      if (hasCollisionCourse) {
        if (fullRes.minGap <= requiredClearance) {
          ttb = 0;
        } else {
          let lo = 0;
          let hi = Math.min(Number.isFinite(tti) ? tti : horizon, 1.8);
          const hiRes = rolloutProfile(estimatedBrakeCap, hi, delaySec, calibration.emergencyBuildRate);
          if (hiRes.minGap <= requiredClearance) {
            for (let iter = 0; iter < 5; iter++) {
              const mid = 0.5 * (lo + hi);
              const midRes = rolloutProfile(estimatedBrakeCap, mid, delaySec, calibration.emergencyBuildRate);
              if (midRes.minGap <= requiredClearance) hi = mid;
              else lo = mid;
            }
            ttb = 0.5 * (lo + hi);
          }
        }
      }

      // Estimate required deceleration (m/s²) to stop outside requiredClearance (for Brake Assist & Partial scaling).
      let requiredDecel = 0;
      if (hasCollisionCourse) {
        if (fullRes.minGap <= requiredClearance) {
          requiredDecel = ego.maxDecel;
        } else if (partialRes.minGap <= dynamicClearance || (ctx.driverBrake >= 0.05 && driverRes.minGap <= requiredClearance)) {
          let loB = 0.5;
          let hiB = estimatedBrakeCap;
          for (let iter = 0; iter < 5; iter++) {
            const midB = 0.5 * (loB + hiB);
            const r = rolloutProfile(midB, 0, ctx.driverBrake >= 0.05 ? 0 : delaySec, calibration.partialBuildRate);
            if (r.minGap >= requiredClearance) hiB = midB;
            else loB = midB;
          }
          // Convert physical road deceleration demand to nominal brake command scale (relative to muEst)
          requiredDecel = clamp(hiB / Math.max(muEst, 0.35), bPartial / Math.max(muEst, 0.35), ego.maxDecel);
        }
      }

      const urgencyScore = !hasCollisionCourse
        ? -1_000 - Math.min(gap0, 200)
        : (unavoidable ? 10_000 : 1_000) - Math.min(ttb, 10) * 100 - Math.min(tti, 10) * 15 - Math.min(Math.max(gap0, -5), 200) * 0.1;

      risks.push({
        targetId: item.stableId,
        obstacle: obs,
        gap: gap0,
        longitudinalGap: longGap0,
        closingSpeed,
        ttc,
        ttcValid,
        tti,
        ttb,
        minGapMaintain,
        minGapPartial: partialRes.minGap,
        minGapFull: fullRes.minGap,
        minGapDriver: driverRes.minGap,
        requiredDecel,
        requiredClearance,
        dynamicClearance,
        hasCollisionCourse,
        unavoidable,
        cause: classifyCause(obs, egoD, road.laneWidth, egoTurning, ego.dims.width),
        urgencyScore,
      });
    }

    // 3. Deterministic critical-target aggregation (tie-broken strictly by stable targetId).
    let critical: TargetRisk | null = null;
    for (const r of risks) {
      if (!r.hasCollisionCourse && critical?.hasCollisionCourse) continue;
      if (
        critical === null ||
        (r.hasCollisionCourse && !critical.hasCollisionCourse) ||
        Math.abs(r.urgencyScore - critical.urgencyScore) > 1e-6 && r.urgencyScore > critical.urgencyScore ||
        Math.abs(r.urgencyScore - critical.urgencyScore) <= 1e-6 && r.targetId < critical.targetId
      ) {
        critical = r;
      }
    }

    return { risks, critical, estimatedBrakeCap };
  }
}

export interface AEBDecisionOutput {
  state: AEBState;
  fcw: boolean;
  fcwLevel: 0 | 1 | 2;
  /** Active moving AEB intervention (PARTIAL or EMERGENCY). False in MONITOR, WARN, HOLD, RELEASE. */
  aebActive: boolean;
  /** Post-AEB standstill hold active (HOLD state). */
  holdActive: boolean;
  /** Brake prefill armed (WARN, PARTIAL, EMERGENCY). */
  prefill: boolean;
  /** Requested nominal deceleration in controller command domain (m/s², 0..ego.maxDecel). */
  decelDemand: number;
  /** Normalized AEB brake force [0..1]. */
  brakeForce: number;
  /** Critical target ID if any. */
  targetId: number | null;
  /** Selected TargetRisk if any. */
  targetRisk: TargetRisk | null;
  /** Vietnamese reason / cause string for HUD & logger. */
  cause: string;
  /** Machine-readable transition/intervention reason. */
  reasonCode: string;
  /** True when Hydraulic Brake Assist boosted insufficient driver pedal pressure. */
  brakeAssistActive: boolean;
}

export interface AEBStateMachineSnapshot {
  state: AEBState;
  activeTargetId: number | null;
  lastCause: string;
  lastDecelDemand: number;
  exitTimerSec: number;
  dropoutTimerSec: number;
  faultTimerSec: number;
  holdTimerSec: number;
  holdClearTimerSec?: number;
}

export class AEBStateMachine {
  state: AEBState = "MONITOR";
  activeTargetId: number | null = null;
  lastCause = "";
  lastDecelDemand = 0;
  private exitTimerSec = 0;
  private dropoutTimerSec = 0;
  private faultTimerSec = 0;
  private holdTimerSec = 0;
  private holdClearTimerSec = 0;

  reset(): void {
    this.state = "MONITOR";
    this.activeTargetId = null;
    this.lastCause = "";
    this.lastDecelDemand = 0;
    this.exitTimerSec = 0;
    this.dropoutTimerSec = 0;
    this.faultTimerSec = 0;
    this.holdTimerSec = 0;
    this.holdClearTimerSec = 0;
  }

  releaseLatch(): void {
    if (this.state === "EMERGENCY" || this.state === "PARTIAL" || this.state === "HOLD") {
      this.state = "RELEASE";
      this.lastDecelDemand = 0;
      this.activeTargetId = null;
    }
  }

  captureState(): AEBStateMachineSnapshot {
    return {
      state: this.state,
      activeTargetId: this.activeTargetId,
      lastCause: this.lastCause,
      lastDecelDemand: this.lastDecelDemand,
      exitTimerSec: this.exitTimerSec,
      dropoutTimerSec: this.dropoutTimerSec,
      faultTimerSec: this.faultTimerSec,
      holdTimerSec: this.holdTimerSec,
      holdClearTimerSec: this.holdClearTimerSec,
    };
  }

  restoreState(snap?: AEBStateMachineSnapshot, fallbackHolding = false): void {
    if (!snap) {
      this.reset();
      if (fallbackHolding) {
        this.state = "HOLD";
        this.lastCause = "Đang giữ dừng trước vật cản";
      }
      return;
    }
    this.state = snap.state;
    this.activeTargetId = snap.activeTargetId;
    this.lastCause = snap.lastCause;
    this.lastDecelDemand = snap.lastDecelDemand;
    this.exitTimerSec = snap.exitTimerSec;
    this.dropoutTimerSec = snap.dropoutTimerSec;
    this.faultTimerSec = snap.faultTimerSec;
    this.holdTimerSec = snap.holdTimerSec;
    this.holdClearTimerSec = snap.holdClearTimerSec ?? 0;
  }

  step(params: {
    ego: Vehicle;
    risks: readonly TargetRisk[];
    critical: TargetRisk | null;
    availability: AEBAvailabilityReport;
    driverThrottle: number;
    driverBrake: number;
    driverSteer: number;
    steeringOverride: boolean;
    usePerception: boolean;
    calibration: AEBCalibration;
    dt: number;
  }): AEBDecisionOutput {
    const { ego, risks, critical, availability, driverThrottle, driverBrake, driverSteer, steeringOverride, calibration } = params;
    const dt = Math.max(0, params.dt);

    // 1. Handle total unavailability (`unavailable`):
    //    - If NOT currently intervening (MONITOR / WARN / RELEASE): stay MONITOR, zero brake.
    //    - If mid-braking (PARTIAL / EMERGENCY): bounded fault hold (`faultHoldSec`) when a real
    //      sensor fault occurs mid-stop, except if AEB was explicitly switched off in config.
    if (availability.availability === "unavailable") {
      const aebDisabled = availability.reason.includes("đã tắt");
      if (!aebDisabled && (this.state === "EMERGENCY" || this.state === "PARTIAL") && this.faultTimerSec < calibration.faultHoldSec) {
        this.faultTimerSec += dt;
        const heldDecel = this.lastDecelDemand * Math.max(0.4, 1 - this.faultTimerSec / Math.max(calibration.faultHoldSec, 0.05));
        return {
          state: this.state,
          fcw: true,
          fcwLevel: this.state === "EMERGENCY" ? 2 : 1,
          aebActive: true,
          holdActive: false,
          prefill: true,
          decelDemand: heldDecel,
          brakeForce: clamp(heldDecel / ego.maxDecel, 0, 1),
          targetId: this.activeTargetId,
          targetRisk: null,
          cause: this.lastCause || availability.reason,
          reasonCode: "sensor-fault-bounded-hold",
          brakeAssistActive: false,
        };
      }
      this.reset();
      return {
        state: "MONITOR",
        fcw: false,
        fcwLevel: 0,
        aebActive: false,
        holdActive: false,
        prefill: false,
        decelDemand: 0,
        brakeForce: 0,
        targetId: null,
        targetRisk: null,
        cause: "",
        reasonCode: "unavailable",
        brakeAssistActive: false,
      };
    }
    this.faultTimerSec = 0;

    // 2. Check driver override policy (configurable per vehicle profile).
    const kickdownOverride =
      calibration.overridePolicy.throttleOverrideThreshold !== null &&
      driverThrottle >= calibration.overridePolicy.throttleOverrideThreshold;
    const evasiveClearOverride =
      calibration.overridePolicy.steeringOverrideRelease &&
      ego.v > 1.2 &&
      (steeringOverride || Math.abs(driverSteer) > 0.12) &&
      (!critical || !critical.hasCollisionCourse);

    if (kickdownOverride || evasiveClearOverride) {
      if (this.state === "PARTIAL" || this.state === "EMERGENCY" || this.state === "HOLD") {
        this.state = "RELEASE";
      } else {
        this.state = "MONITOR";
      }
      this.lastDecelDemand = 0;
      this.activeTargetId = null;
      return {
        state: this.state,
        fcw: false,
        fcwLevel: 0,
        aebActive: false,
        holdActive: false,
        prefill: false,
        decelDemand: 0,
        brakeForce: 0,
        targetId: null,
        targetRisk: critical,
        cause: "",
        reasonCode: kickdownOverride ? "driver-throttle-override" : "driver-steering-override-clear",
        brakeAssistActive: false,
      };
    }

    // 3. Post-AEB Standstill HOLD state handling:
    //    HOLD is ONLY entered from an active AEB braking event (PARTIAL / EMERGENCY) that brings ego to rest.
    //    Two cars already stationary at initialization NEVER enter HOLD!
    const wasBrakingOrHolding = this.state === "EMERGENCY" || this.state === "PARTIAL" || this.state === "HOLD";
    if (wasBrakingOrHolding && ego.v < 0.35) {
      let closeObstacleAhead: TargetRisk | null = null;
      for (const r of risks) {
        const isActiveJunctionTarget =
          this.activeTargetId !== null &&
          r.targetId === this.activeTargetId &&
          ((r.obstacle.v < -1.0 &&
            r.longitudinalGap >= -2.5 &&
            r.longitudinalGap < Math.max(10.0, -r.obstacle.v * 1.6)) ||
            ((r.obstacle.kind === "ped" || Math.abs(r.obstacle.vd ?? 0) > 0.35) &&
              r.longitudinalGap >= -1.2 &&
              r.longitudinalGap < 8.5 &&
              r.gap < 4.8));
        if (isActiveJunctionTarget) {
          if (!closeObstacleAhead || r.gap < closeObstacleAhead.gap) {
            closeObstacleAhead = r;
          }
          continue;
        }
        // Only consider obstacles occupying ego's forward corridor (never adjacent-lane traffic!).
        const inForwardCorridor = Number.isFinite(r.minGapMaintain) && r.longitudinalGap >= -0.6;
        if (!inForwardCorridor) continue;
        // Match the 12m complete-to-standstill latch below for the target that
        // actually caused this stop. A stop ending at (say) 10m must not lose
        // HOLD at the old 9.5m gate and restore a still-held accelerator.
        const activeStoppedTarget = this.activeTargetId !== null &&
          r.targetId === this.activeTargetId && r.longitudinalGap < 12 &&
          r.obstacle.v < 0.9 && r.closingSpeed >= -0.5;
        const holdingThreat =
          activeStoppedTarget ||
          (r.longitudinalGap < 9.5 && r.obstacle.v < 0.9 && r.closingSpeed >= -0.5) ||
          (r.longitudinalGap < calibration.standstillClearance + 1.5 && r.closingSpeed >= -0.4);
        if (holdingThreat && (!closeObstacleAhead || r.longitudinalGap < closeObstacleAhead.longitudinalGap)) {
          closeObstacleAhead = r;
        }
      }
      const driverFootBrakeTakeover = driverBrake > 0.15 && driverThrottle <= 0;
      const holdTimedOut = this.holdTimerSec >= calibration.holdMaxSeconds;
      if (closeObstacleAhead !== null) {
        this.holdClearTimerSec = 0;
      } else {
        this.holdClearTimerSec += dt;
      }
      const clearConfirmed = this.holdClearTimerSec >= 0.18;
      const keepHolding =
        !driverFootBrakeTakeover &&
        !holdTimedOut &&
        !clearConfirmed;

      if (keepHolding) {
        this.state = "HOLD";
        this.holdTimerSec += dt;
        this.lastDecelDemand = ego.maxDecel;
        const throttleHeld = driverThrottle > 0;
        return {
          state: "HOLD",
          fcw: throttleHeld,
          fcwLevel: throttleHeld ? 2 : 0,
          aebActive: false,
          holdActive: true,
          prefill: true,
          decelDemand: ego.maxDecel,
          brakeForce: 1,
          targetId: closeObstacleAhead?.targetId ?? this.activeTargetId,
          targetRisk: closeObstacleAhead,
          cause: "Đang giữ dừng trước vật cản",
          reasonCode: "post-aeb-hold",
          brakeAssistActive: false,
        };
      } else {
        this.state = "RELEASE";
        this.holdTimerSec = 0;
        this.holdClearTimerSec = 0;
        this.lastDecelDemand = 0;
        this.activeTargetId = null;
        return {
          state: "RELEASE",
          fcw: false,
          fcwLevel: 0,
          aebActive: false,
          holdActive: false,
          prefill: false,
          decelDemand: 0,
          brakeForce: 0,
          targetId: null,
          targetRisk: critical,
          cause: "",
          reasonCode: driverFootBrakeTakeover
            ? "hold-driver-brake-takeover"
            : holdTimedOut
              ? "hold-timeout-release"
              : "hold-target-cleared-release",
          brakeAssistActive: false,
        };
      }
    } else {
      this.holdTimerSec = 0;
      this.holdClearTimerSec = 0;
    }

    // 4. Evaluate active dynamic threat levels from `critical` TargetRisk.
    const hasThreat = critical !== null && critical.hasCollisionCourse && ego.v >= calibration.minActivationSpeed;

    let wantEmergency = false;
    let wantPartial = false;
    let wantBrakeAssist = false;
    let wantWarn = false;

    if (hasThreat && critical) {
      const hardDecelBoost = (critical.obstacle.accel ?? 0) < -2.5 ? 0.40 : (critical.obstacle.accel ?? 0) < -1.5 ? 0.20 : 0;
      wantEmergency =
        critical.unavoidable ||
        critical.ttb <= calibration.emergencyTtbSec + hardDecelBoost ||
        critical.minGapFull <= critical.requiredClearance ||
        critical.tti <= calibration.emergencyTtiFloorSec;

      wantBrakeAssist =
        !wantEmergency &&
        driverBrake >= 0.05 &&
        (critical.ttb <= calibration.warnTtbSec || critical.tti <= calibration.warnTtiSec) &&
        critical.minGapDriver <= critical.requiredClearance;

      wantPartial =
        !wantEmergency &&
        (wantBrakeAssist ||
          critical.ttb <= calibration.partialTtbSec ||
          (critical.obstacle.v > 1.0 &&
            critical.tti <= calibration.partialMovingTtiSec &&
            critical.minGapPartial <= critical.dynamicClearance));

      wantWarn =
        wantEmergency ||
        wantPartial ||
        critical.ttb <= calibration.warnTtbSec ||
        critical.tti <= calibration.warnTtiSec;
    }

    // 5. State transitions with immediate escalation & hysteresis/dropout-hold on de-escalation.
    //    MONITOR -> EMERGENCY direct jump is ALWAYS allowed without waiting for WARN or PARTIAL!
    if (wantEmergency && critical) {
      this.state = "EMERGENCY";
      this.activeTargetId = critical.targetId;
      this.lastCause = critical.cause;
      this.lastDecelDemand = ego.maxDecel;
      this.exitTimerSec = 0;
      this.dropoutTimerSec = 0;
      return {
        state: "EMERGENCY",
        fcw: true,
        fcwLevel: 2,
        aebActive: true,
        holdActive: false,
        prefill: true,
        decelDemand: ego.maxDecel,
        brakeForce: 1,
        targetId: critical.targetId,
        targetRisk: critical,
        cause: critical.cause,
        reasonCode: critical.unavoidable ? "emergency-mitigation-unavoidable" : "emergency-last-point-to-brake",
        brakeAssistActive: false,
      };
    }

    // Hysteresis & complete-to-standstill latch if already in EMERGENCY:
    // - Against a moving target, stay in EMERGENCY until TTB recovers past `emergencyTtb + exitHysteresis`.
    // - Against a stopped/stopping target in ego's lane (`v < 1.0 m/s`, `gap < 12 m`), complete the stop
    //   all the way to `ego.v < 0.25` -> `HOLD` rather than releasing brakes prematurely at ~1-2 m/s.
    if (this.state === "EMERGENCY") {
      const stoppingTargetAhead = risks.find(
        (r) =>
          (Number.isFinite(r.minGapMaintain) &&
            r.longitudinalGap >= -0.5 &&
            r.longitudinalGap < 12.0 &&
            r.obstacle.v < 1.0 &&
            r.closingSpeed >= -0.2) ||
          (this.activeTargetId !== null &&
            r.targetId === this.activeTargetId &&
            (r.obstacle.v < -1.0 || r.obstacle.kind === "ped") &&
            r.longitudinalGap >= -1.5 &&
            r.longitudinalGap < Math.max(14.0, -r.obstacle.v * 1.8) &&
            r.gap < Math.max(12.0, -r.obstacle.v * 1.5)),
      );
      const activeLatchTarget =
        critical &&
        critical.hasCollisionCourse &&
        (critical.ttb <= calibration.emergencyTtbSec + calibration.exitHysteresisSec ||
          critical.minGapFull <= critical.requiredClearance + 1.2)
          ? critical
          : stoppingTargetAhead ?? null;
      if (activeLatchTarget) {
        this.exitTimerSec = 0;
        this.dropoutTimerSec = 0;
        this.lastDecelDemand = ego.maxDecel;
        return {
          state: "EMERGENCY",
          fcw: true,
          fcwLevel: 2,
          aebActive: true,
          holdActive: false,
          prefill: true,
          decelDemand: ego.maxDecel,
          brakeForce: 1,
          targetId: activeLatchTarget.targetId,
          targetRisk: activeLatchTarget,
          cause: activeLatchTarget.cause,
          reasonCode: "emergency-hysteresis-hold",
          brakeAssistActive: false,
        };
      }

      // Short track dropout protection during active emergency braking (only in sensor perception mode
      // when the previously tracked target vanished completely rather than being observed outside corridor).
      const prevStillObserved = this.activeTargetId !== null && risks.some((r) => r.targetId === this.activeTargetId);
      if (
        params.usePerception &&
        !prevStillObserved &&
        !critical &&
        ego.v > 0.5 &&
        this.dropoutTimerSec < calibration.dropoutHoldSec
      ) {
        this.dropoutTimerSec += dt;
        return {
          state: "EMERGENCY",
          fcw: true,
          fcwLevel: 2,
          aebActive: true,
          holdActive: false,
          prefill: true,
          decelDemand: this.lastDecelDemand,
          brakeForce: clamp(this.lastDecelDemand / ego.maxDecel, 0, 1),
          targetId: this.activeTargetId,
          targetRisk: null,
          cause: this.lastCause,
          reasonCode: "track-dropout-short-hold",
          brakeAssistActive: false,
        };
      }
    }

    if (wantPartial && critical) {
      this.state = "PARTIAL";
      this.activeTargetId = critical.targetId;
      this.lastCause = critical.cause;
      const basePartial = ego.maxDecel * calibration.partialDecelFraction;
      const decel = wantBrakeAssist
        ? clamp(Math.max(basePartial, critical.requiredDecel), basePartial, ego.maxDecel * 0.92)
        : basePartial;
      this.lastDecelDemand = decel;
      this.exitTimerSec = 0;
      this.dropoutTimerSec = 0;
      return {
        state: "PARTIAL",
        fcw: true,
        fcwLevel: 2,
        aebActive: true,
        holdActive: false,
        prefill: true,
        decelDemand: decel,
        brakeForce: clamp(decel / ego.maxDecel, 0, 1),
        targetId: critical.targetId,
        targetRisk: critical,
        cause: critical.cause,
        reasonCode: wantBrakeAssist ? "hydraulic-brake-assist" : "partial-braking",
        brakeAssistActive: wantBrakeAssist,
      };
    }

    // Hysteresis & complete-to-standstill when already in PARTIAL
    if (this.state === "PARTIAL") {
      const stoppingTargetAhead = risks.find(
        (r) =>
          Number.isFinite(r.minGapMaintain) &&
          r.longitudinalGap >= -0.5 &&
          ((r.longitudinalGap < 10.0 && r.obstacle.v < 1.0 && r.closingSpeed >= -0.2) ||
            (r.hasCollisionCourse && r.obstacle.v < 0.8 && r.closingSpeed > 0.2)),
      );
      if (stoppingTargetAhead) {
        this.exitTimerSec = 0;
        return {
          state: "PARTIAL",
          fcw: true,
          fcwLevel: 2,
          aebActive: true,
          holdActive: false,
          prefill: true,
          decelDemand: this.lastDecelDemand,
          brakeForce: clamp(this.lastDecelDemand / ego.maxDecel, 0, 1),
          targetId: stoppingTargetAhead.targetId,
          targetRisk: stoppingTargetAhead,
          cause: stoppingTargetAhead.cause,
          reasonCode: "partial-hysteresis-hold",
          brakeAssistActive: false,
        };
      }
      if (critical && critical.hasCollisionCourse) {
        const withinHysteresis =
          critical.ttb <= calibration.partialTtbSec + calibration.exitHysteresisSec ||
          (critical.tti <= calibration.partialMovingTtiSec + calibration.exitHysteresisSec &&
            critical.minGapPartial <= critical.dynamicClearance + 1.5);
        if (withinHysteresis && this.exitTimerSec < calibration.exitConfirmSec) {
          this.exitTimerSec += dt;
          return {
            state: "PARTIAL",
            fcw: true,
            fcwLevel: 2,
            aebActive: true,
            holdActive: false,
            prefill: true,
            decelDemand: this.lastDecelDemand,
            brakeForce: clamp(this.lastDecelDemand / ego.maxDecel, 0, 1),
            targetId: critical.targetId,
            targetRisk: critical,
            cause: critical.cause,
            reasonCode: "partial-hysteresis-hold",
            brakeAssistActive: false,
          };
        }
      }
    }

    if (wantWarn && critical) {
      this.state = "WARN";
      this.activeTargetId = critical.targetId;
      this.lastCause = critical.cause;
      this.lastDecelDemand = 0;
      this.exitTimerSec = 0;
      this.dropoutTimerSec = 0;
      const urgentWarn = critical.ttb <= 0.7 || critical.tti <= 1.6;
      return {
        state: "WARN",
        fcw: true,
        fcwLevel: urgentWarn ? 2 : 1,
        aebActive: false,
        holdActive: false,
        prefill: true,
        decelDemand: 0,
        brakeForce: 0,
        targetId: critical.targetId,
        targetRisk: critical,
        cause: critical.cause,
        reasonCode: "fcw-prefill",
        brakeAssistActive: false,
      };
    }

    // Hysteresis & short sensor-dropout hold for WARN (FCW) so noisy rain/radar TTI
    // around `warnTtiSec` does not chatter on/off at 10 Hz, while clearing immediately
    // whenever the target is observed outside the collision corridor.
    if (this.state === "WARN" && ego.v >= calibration.minActivationSpeed) {
      if (
        critical &&
        critical.hasCollisionCourse &&
        (critical.ttb <= calibration.warnTtbSec + 0.55 || critical.tti <= calibration.warnTtiSec + 0.65) &&
        this.exitTimerSec < 0.55
      ) {
        this.exitTimerSec += dt;
        return {
          state: "WARN",
          fcw: true,
          fcwLevel: 1,
          aebActive: false,
          holdActive: false,
          prefill: true,
          decelDemand: 0,
          brakeForce: 0,
          targetId: critical.targetId,
          targetRisk: critical,
          cause: critical.cause,
          reasonCode: "fcw-hysteresis-hold",
          brakeAssistActive: false,
        };
      }
      const prevWarnObserved = this.activeTargetId !== null && risks.some((r) => r.targetId === this.activeTargetId);
      if (
        params.usePerception &&
        !prevWarnObserved &&
        !critical &&
        ego.v > 1.5 &&
        this.dropoutTimerSec < 0.25
      ) {
        this.dropoutTimerSec += dt;
        return {
          state: "WARN",
          fcw: true,
          fcwLevel: 1,
          aebActive: false,
          holdActive: false,
          prefill: true,
          decelDemand: 0,
          brakeForce: 0,
          targetId: this.activeTargetId,
          targetRisk: null,
          cause: this.lastCause,
          reasonCode: "fcw-dropout-short-hold",
          brakeAssistActive: false,
        };
      }
    }

    // Transition through RELEASE for 1 step when stepping down from active braking/hold, then MONITOR.
    const nextState: AEBState =
      this.state === "EMERGENCY" || this.state === "PARTIAL" || this.state === "HOLD" ? "RELEASE" : "MONITOR";
    this.state = nextState;
    this.activeTargetId = null;
    this.lastCause = "";
    this.lastDecelDemand = 0;
    this.exitTimerSec = 0;
    this.dropoutTimerSec = 0;
    return {
      state: nextState,
      fcw: false,
      fcwLevel: 0,
      aebActive: false,
      holdActive: false,
      prefill: false,
      decelDemand: 0,
      brakeForce: 0,
      targetId: null,
      targetRisk: critical,
      reasonCode: nextState === "RELEASE" ? "threat-cleared-release" : "monitoring",
      cause: "",
      brakeAssistActive: false,
    };
  }
}

export interface BrakeArbitrationInput {
  maxDecel: number;
  maxAccel: number;
  /** Raw propulsion acceleration request (>0) or coast drag (<=0) when unbraked (m/s²). */
  propulsionOrCoastAccel: number;
  /** Normalized driver brake pedal [0..1]. */
  driverBrakePedal: number;
  /** ACC deceleration request (>= 0, m/s²). */
  accDecelReq: number;
  /** ISA speed-limiter deceleration request (>= 0, m/s²). */
  isaDecelReq: number;
  /** AEB decision output for this step. */
  aeb: AEBDecisionOutput;
  /** True when driver override policy suppressed AEB. */
  overrideActive: boolean;
}

export interface BrakeArbitrationResult {
  /** Final longitudinal acceleration command in m/s² (<0 braking, >0 propulsion). */
  finalAccelCmd: number;
  /** Winning brake deceleration magnitude in m/s² (>= 0). */
  winningDecel: number;
  /** Normalized ADAS-contributed brake force [0..1] (excludes driver-only braking). */
  adasBrakeForce: number;
  /** Normalized total brake force [0..1] (includes driver pedal & ADAS). */
  finalBrakeForce: number;
  /** Attribution of the winning longitudinal braking authority. */
  source: BrakeArbiterSource;
  /** Driver decel demand in m/s². */
  driverDecelReq: number;
  /** AEB/Hold decel demand in m/s². */
  aebOrHoldDecelReq: number;
}

/** Single-point longitudinal brake arbiter: converts all requests into m/s² deceleration,
 *  never sums brake demands blindly, never weakens stronger driver braking, and suppresses
 *  propulsion torque whenever any brake authority wins. */
export class BrakeArbiter {
  resolve(input: BrakeArbitrationInput): BrakeArbitrationResult {
    const driverDecel = clamp(input.driverBrakePedal, 0, 1) * input.maxDecel;
    const accDecel = Math.max(0, input.accDecelReq);
    const isaDecel = Math.max(0, input.isaDecelReq);
    const aebDecel = input.aeb.aebActive ? Math.max(0, input.aeb.decelDemand) : 0;
    const holdDecel = input.aeb.holdActive ? Math.max(0, input.aeb.decelDemand) : 0;
    const aebOrHold = Math.max(aebDecel, holdDecel);

    const winningDecel = Math.max(driverDecel, accDecel, isaDecel, aebOrHold);

    let source: BrakeArbiterSource = "none";
    if (input.overrideActive && driverDecel <= 0) {
      source = "override";
    } else if (winningDecel > 1e-4) {
      if (driverDecel >= winningDecel - 1e-4 && driverDecel > 0) {
        source = "driver";
      } else if (holdDecel >= winningDecel - 1e-4 && holdDecel > 0) {
        source = "aeb-hold";
      } else if (aebDecel >= winningDecel - 1e-4 && aebDecel > 0) {
        source = input.aeb.brakeAssistActive
          ? "aeb-brake-assist"
          : input.aeb.state === "EMERGENCY"
            ? "aeb-emergency"
            : "aeb-partial";
      } else if (isaDecel >= winningDecel - 1e-4 && isaDecel > 0) {
        source = "isa";
      } else if (accDecel > 0) {
        source = "acc";
      }
    }

    // Suppress positive propulsion torque whenever ANY braking authority is active!
    const finalAccelCmd =
      winningDecel > 1e-4
        ? -Math.min(winningDecel, input.maxDecel)
        : Math.min(input.propulsionOrCoastAccel, input.maxAccel);

    const adasDecel = Math.max(aebOrHold, isaDecel, driverDecel > 0 ? 0 : accDecel);
    const adasBrakeForce = clamp(adasDecel / Math.max(input.maxDecel, 1e-3), 0, 1);
    const finalBrakeForce = clamp(winningDecel / Math.max(input.maxDecel, 1e-3), 0, 1);

    return {
      finalAccelCmd,
      winningDecel,
      adasBrakeForce,
      finalBrakeForce,
      source,
      driverDecelReq: driverDecel,
      aebOrHoldDecelReq: aebOrHold,
    };
  }
}

interface QueuedBrakeCommand {
  dueTime: number;
  decelTarget: number;
  buildRate: number;
}

/** Electro-hydraulic brake actuator for automatic ADAS/AEB braking:
 *  models command transport/valve dead-time (`delaySec`) and finite pressure build/release
 *  rates (`m/s³`) in simulation time, independent of render FPS. */
export class BrakeActuator {
  private currentAutoDecel = 0;
  private queue: QueuedBrakeCommand[] = [];
  private activeTarget = 0;
  private activeBuildRate = DEFAULT_AEB_CALIBRATION.emergencyBuildRate;

  reset(): void {
    this.currentAutoDecel = 0;
    this.queue = [];
    this.activeTarget = 0;
  }

  get appliedAutoDecel(): number {
    return this.currentAutoDecel;
  }

  /** Submit automatic brake demand for `simTime` and advance hydraulic state by `dt`.
   *  Driver direct pedal hydraulic pressure `driverDecel` is already in the master cylinder
   *  and acts as an immediate hydraulic floor when EBA boosts pressure. */
  step(params: {
    simTime: number;
    dt: number;
    requestedAccelCmd: number;
    driverDecel: number;
    driverThrottle?: number;
    baselineHydraulicDecel?: number;
    passiveCoastDecel?: number;
    aebActiveOrHold: boolean;
    aebState?: AEBState;
    prefillReady: boolean;
    calibration: AEBCalibration;
  }): number {
    const {
      simTime,
      dt,
      requestedAccelCmd,
      driverDecel,
      driverThrottle = 0,
      baselineHydraulicDecel = 0,
      passiveCoastDecel = 0,
      aebActiveOrHold,
      aebState,
      prefillReady,
      calibration,
    } = params;
    if (!Number.isFinite(dt) || dt <= 0) return requestedAccelCmd;

    // Comfort ACC / coasting / propulsion passes through directly (ACC already applies its own 2.5 m/s³ comfort limiter).
    if (!aebActiveOrHold && this.currentAutoDecel <= 1e-4 && this.queue.length === 0) {
      return requestedAccelCmd;
    }

    const totalBrakeDecelReq = requestedAccelCmd < 0 ? -requestedAccelCmd : 0;
    const autoDecelReq = aebActiveOrHold ? totalBrakeDecelReq : 0;
    const existingLineDecel = Math.max(driverDecel, baselineHydraulicDecel);
    const delay = driverDecel > 0.05
      ? 0 // Master cylinder already pressurized by driver's foot -> immediate EBA boost ramp
      : prefillReady
        ? calibration.prefillActuatorDelaySec
        : calibration.actuatorDelaySec;

    const effectiveReleaseRate = driverThrottle > 0.05
      ? calibration.releaseRate
      : Math.min(calibration.releaseRate, 8.5);

    const buildRate = autoDecelReq > 0
      ? (aebState === "PARTIAL" ? calibration.partialBuildRate : calibration.emergencyBuildRate)
      : effectiveReleaseRate;

    // Enqueue command with due timestamp `simTime + delay`; release commands take effect immediately (no artificial hold lag).
    if (autoDecelReq <= 0) {
      this.queue = [];
      this.activeTarget = 0;
    } else {
      this.queue.push({ dueTime: simTime + delay, decelTarget: autoDecelReq, buildRate });
    }

    while (this.queue.length > 0 && this.queue[0].dueTime <= simTime + 1e-7) {
      const due = this.queue.shift()!;
      this.activeTarget = due.decelTarget;
      this.activeBuildRate = due.buildRate;
    }
    // If driver foot or ACC/ISA already pressurized lines, actuator pressure starts at least at `existingLineDecel`.
    if (existingLineDecel > this.currentAutoDecel) {
      this.currentAutoDecel = existingLineDecel;
    }
    if (driverDecel > 0.05 && autoDecelReq > this.activeTarget) {
      this.activeTarget = autoDecelReq;
      this.activeBuildRate = buildRate;
    }

    const delta = this.activeTarget - this.currentAutoDecel;
    const maxRise = this.activeBuildRate * dt;
    const maxDrop = effectiveReleaseRate * dt;
    if (delta > 0) {
      this.currentAutoDecel += Math.min(delta, maxRise);
    } else if (delta < 0) {
      this.currentAutoDecel += Math.max(delta, -maxDrop);
    }
    const coastFloor = !aebActiveOrHold && driverThrottle <= 0.05 ? Math.max(0, passiveCoastDecel) : 0;
    if (this.currentAutoDecel <= coastFloor + 1e-4 && this.activeTarget === 0) {
      this.currentAutoDecel = 0;
    }

    if (aebActiveOrHold) {
      const effectiveBrake = Math.max(existingLineDecel, this.currentAutoDecel, passiveCoastDecel);
      return -effectiveBrake;
    }
    if (this.currentAutoDecel > 1e-4) {
      const otherBrake = requestedAccelCmd < 0 ? -requestedAccelCmd : 0;
      return -Math.max(otherBrake, this.currentAutoDecel);
    }
    return requestedAccelCmd;
  }
}

export interface AEBLogEntry {
  simTime: number;
  dt: number;
  perceptionMode: PerceptionMode;
  availability: AEBAvailability;
  availabilityReason: string;
  targetId: number | null;
  targetKind: ObstacleKind | null;
  trackAgeSec: number | null;
  coastingSec: number | null;
  confidence: number | null;
  gap: number | null;
  closingSpeed: number | null;
  targetAccel: number | null;
  ttc: number | null;
  ttcValid: boolean;
  tti: number | null;
  ttb: number | null;
  minPredictedGap: number | null;
  aebState: AEBState;
  reason: string;
  cause: string;
  driverDecelReq: number;
  accDecelReq: number;
  aebDecelReq: number;
  arbiterSource: BrakeArbiterSource;
  finalAccelCmd: number;
  actuatorAccelCmd: number;
  egoSpeed: number;
  actualAccel: number;
  actualLatAccel: number;
  jerk: number;
  jerkFiltered: number;
  collided: boolean;
  impactSpeed: number | null;
  vehicleProfile?: string;
  sensorChannel?: string | null;
  wheelAbsActive?: boolean;
  maxWheelSlip?: number;
}

export class AEBDiagnosticLogger {
  enabled = false;
  maxEntries = 12_000;
  readonly entries: AEBLogEntry[] = [];

  clear(): void {
    this.entries.length = 0;
  }

  record(entry: AEBLogEntry): void {
    if (!this.enabled) return;
    if (this.entries.length >= this.maxEntries) {
      this.entries.shift();
    }
    this.entries.push(entry);
  }

  toJSON(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  toCSV(): string {
    const cols: (keyof AEBLogEntry)[] = [
      "simTime", "dt", "perceptionMode", "availability", "availabilityReason",
      "targetId", "targetKind", "trackAgeSec", "coastingSec", "confidence",
      "gap", "closingSpeed", "targetAccel", "ttc", "ttcValid", "tti", "ttb", "minPredictedGap",
      "aebState", "reason", "cause", "driverDecelReq", "accDecelReq", "aebDecelReq",
      "arbiterSource", "finalAccelCmd", "actuatorAccelCmd", "egoSpeed",
      "actualAccel", "actualLatAccel", "jerk", "jerkFiltered", "collided", "impactSpeed",
      "vehicleProfile", "sensorChannel", "wheelAbsActive", "maxWheelSlip",
    ];
    const esc = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const s = typeof v === "number" ? (Number.isFinite(v) ? Number(v.toFixed(5)).toString() : "") : String(v);
      return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(",")];
    for (const row of this.entries) {
      lines.push(cols.map((c) => esc(row[c])).join(","));
    }
    return lines.join("\n");
  }
}
