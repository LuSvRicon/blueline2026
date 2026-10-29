// ADASController — simulation-only driver assistance for Manual Drive.
//
// The suite mirrors the feature set of a modern passenger car:
//   ACC   adaptive cruise with stop & go and a selectable headway
//   LKA   lane centring + lane-keeping assist torque
//   LDW   lane-departure warning (left/right)
//   FCW   two-stage forward-collision warning
//   AEB   automatic emergency braking (vehicles + pedestrians)
//   BSM   blind-spot monitoring (left/right)
//   ALC   assisted lane change on the turn signal, gated by the blind spot
//   TSR   traffic-sign recognition (posted limit)
//   ISA   intelligent speed assist (caps the set speed to the sign)
//   USS   low-speed parking sensors
//
// Everything here is a simplified educational model with idealised sensors. It
// is NOT validated for, and must not be used on, a real vehicle.

import { clamp, wrapAngle, wrapDiff } from "../core/math.ts";
import { coastDeceleration } from "../vehicle/Powertrain.ts";
import { stanleyControl } from "../control/Stanley.ts";
import { Obstacle } from "../planner/Trajectory.ts";
import { ReferencePath } from "../world/ReferencePath.ts";
import { Road } from "../world/Road.ts";
import { Vehicle } from "../vehicle/Vehicle.ts";
import { AssistanceStatus, emptyAssistanceStatus } from "./ExtendedAssistance.ts";

export type LaneDeparture = "none" | "left" | "right";
export type AlcState = "off" | "armed" | "active" | "blocked";

export interface TrafficLightSighting {
  state: "green" | "yellow" | "red";
  distance: number;
}

export interface ADASConfig {
  acc: boolean;
  laneCentering: boolean;
  lda: boolean;
  fcw: boolean;
  aeb: boolean;
  bsm: boolean;
  alc: boolean;
  tsr: boolean;
  isa: boolean;
  parking: boolean;
  rcta: boolean;
  rearAeb: boolean;
  blindSpotAvoidance: boolean;
  emergencyLaneKeeping: boolean;
  pedalMitigation: boolean;
  leadDeparture: boolean;
  safeExit: boolean;
  driverMonitoring: boolean;
  highBeamAssist: boolean;
  trafficLightAssist: boolean; // brake for a red/amber signal (TLA)
  timeGap: number; // seconds of headway (1..3 notches in the UI)
  warningTtc: number;
  brakingTtc: number;
}

export interface ADASStatus {
  extra: AssistanceStatus;
  active: boolean;
  engaged: boolean;
  accActive: boolean;
  accHolding: boolean;
  accState: "active" | "cancelled" | "hold" | "resume-required" | "off";
  sensorsAvailable: boolean;
  laneAvailable: boolean;
  takeoverRequired: boolean;
  aebHolding: boolean;
  laneCenteringActive: boolean;
  laneKeepAssist: boolean;
  laneDeparture: LaneDeparture;
  fcw: boolean;
  fcwLevel: 0 | 1 | 2;
  aeb: boolean;
  /** Simulated brake-pressure request from the assistance controller, [0, 1]. */
  adasBrakeForce: number;
  rctaActive: boolean;
  rctaLeft: boolean;
  rctaRight: boolean;
  rearAeb: boolean;
  blindSpotLeft: boolean;
  blindSpotRight: boolean;
  leadGap: number | null;
  leadTtc: number | null;
  headway: number | null;
  targetSpeed: number;
  setSpeed: number;
  tsrLimitKph: number | null;
  tsrNew: boolean;
  trafficLight: "green" | "yellow" | "red" | "none";
  trafficLightDistance: number | null;
  redLightWarning: boolean;
  alc: AlcState;
  alcTargetLane: number | null;
  alcComplete: boolean;
  alcAborted: boolean;
  alcReason: string;
  parkingFront: number | null;
  parkingRear: number | null;
  parkingLeft: number | null;
  parkingRight: number | null;
  indicatorLeft: boolean;
  indicatorRight: boolean;
  speedLimited: boolean;
  isaOverride: boolean;
  driverOverride: boolean;
}

export interface DriverInput {
  steer: number; // -1 left, +1 right
  throttle: number; // [0, 1]
  brake: number; // [0, 1]
}

export interface ADASFrame {
  ego: Vehicle;
  egoS: number;
  egoD: number;
  path: ReferencePath;
  road: Road;
  obstacles: Obstacle[];
  desiredSpeed: number;
  input: DriverInput;
  dt: number;
  speedControl: (error: number, dt: number) => number;
  /** Nearest posted limit in the TSR window (km/h), if any. */
  speedLimitKph?: number | null;
  /** Turn signal: -1 left, +1 right, 0 off. */
  indicator?: number;
  /** Nearest signalised stop line ahead (traffic-light recognition). */
  trafficLight?: TrafficLightSighting | null;
  sensorsAvailable?: boolean;
  laneConfidence?: number;
}

export interface ADASOutput {
  steer: number;
  accel: number;
  targetSpeed: number;
  status: ADASStatus;
}

export const DEFAULT_ADAS_CONFIG: ADASConfig = {
  acc: true,
  laneCentering: true,
  lda: true,
  fcw: true,
  aeb: true,
  bsm: true,
  alc: true,
  tsr: true,
  isa: true,
  parking: true,
  rcta: true,
  rearAeb: true,
  blindSpotAvoidance: true, emergencyLaneKeeping: true, pedalMitigation: true,
  leadDeparture: true, safeExit: true, driverMonitoring: true, highBeamAssist: true,
  trafficLightAssist: true,
  timeGap: 1.6,
  warningTtc: 3.0,
  brakingTtc: 2.0,
};

/** Headway notches offered by the UI, in seconds. */
export const ADAS_GAP_NOTCHES = [1.0, 1.3, 1.6, 2.0, 2.5] as const;

export class ADASController {
  readonly config: ADASConfig = { ...DEFAULT_ADAS_CONFIG };
  status: ADASStatus = emptyStatus();
  private aebLatched = false;
  private alcTargetLane: number | null = null;
  private alcTimer = 0;
  private alcComplete = false;
  private alcArmTimer = 0;
  private alcRequestedDir = 0;
  private alcBlocked = false;
  private alcAborted = false;
  private alcStartD = 0;
  private lastTsr: number | null = null;
  private cruiseCancelled = false;
  private cruiseHoldTime = 0;
  private alcCancelledSignal = 0;
  private alcReason = "";

  cancelCruise(): void { this.cruiseCancelled = true; }
  resumeCruise(): void { this.cruiseCancelled = false; this.cruiseHoldTime = 0; }

  /** Step the headway setting up/down one notch (used by the dashboard). */
  adjustGap(direction: -1 | 1): number {
    const current = this.config.timeGap;
    let best = 2;
    let bestDelta = Infinity;
    ADAS_GAP_NOTCHES.forEach((notch, index) => {
      const delta = Math.abs(notch - current);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = index;
      }
    });
    this.config.timeGap = ADAS_GAP_NOTCHES[clamp(best + direction, 0, ADAS_GAP_NOTCHES.length - 1)];
    return this.config.timeGap;
  }

  /** Current headway notch index (0 = closest). */
  get gapNotch(): number {
    let best = 2;
    let bestDelta = Infinity;
    ADAS_GAP_NOTCHES.forEach((notch, index) => {
      const delta = Math.abs(notch - this.config.timeGap);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = index;
      }
    });
    return best;
  }

  update(frame: ADASFrame): ADASOutput {
    const { ego, egoS, egoD, path, road, obstacles, desiredSpeed, input, dt } = frame;
    const indicator = frame.indicator ?? 0;
    const laneWidth = road.laneWidth;
    const sensorsAvailable = frame.sensorsAvailable !== false;
    const laneAvailable = sensorsAvailable && (frame.laneConfidence ?? 1) >= .6;
    if (input.brake > .02 || !sensorsAvailable) this.cancelCruise();
    let cruiseActive = this.config.acc && !this.cruiseCancelled && sensorsAvailable;
    const brakingHorizon = Math.max(
      80,
      (ego.v * ego.v) / (2 * Math.max(ego.maxDecel * 0.8, 1)) + ego.v * 0.25 + 10,
    );
    let lead: { obstacle: Obstacle; gap: number; ahead: number } | null = null;
    let fcw = false;
    let fcwLevel: 0 | 1 | 2 = 0;
    let aebRequested = false;
    let requestedBrakeForce = 0;
    let blindSpotLeft = false;
    let blindSpotRight = false;
    let parkingFront: number | null = null;

    for (const obstacle of sensorsAvailable ? obstacles : []) {
      const ds = wrapDiff(obstacle.s, egoS, path.length);
      const dd = obstacle.d - egoD;
      const gap = ds - (ego.dims.length + obstacle.length) / 2;
      const closingSpeed = ego.v - obstacle.v;
      const ttc = closingSpeed > 0.1 ? gap / closingSpeed : Infinity;
      const rawLateralReach = (ego.dims.width + obstacle.width) / 2 + 0.25;
      // For crossing pedestrians (or merging vehicles), predict lateral position at arrival time (ttc)
      let inPath = Math.abs(dd) <= rawLateralReach;
      if (!inPath && obstacle.vd && Math.abs(obstacle.vd) > 0.1 && ttc > 0 && ttc < 4.0) {
        const predictedDd = dd + obstacle.vd * ttc;
        // If they will cross into our path, or are currently crossing through
        if (Math.abs(predictedDd) <= rawLateralReach || (dd * predictedDd <= 0)) {
          inPath = true;
        }
      }

      if (ds > 0 && ds <= brakingHorizon && inPath) {
        // Evaluate every hazard independently. ACC's nearest target must not
        // make emergency braking depend on obstacle-array ordering.
        if (!lead || ds < lead.ahead) lead = { obstacle, gap, ahead: ds };
        const approaching = closingSpeed > .2 || (ego.v > .3 && gap < 6);
        const gapWarn = Math.max(8, ego.v * 0.8);
        if (this.config.fcw && approaching && (ttc <= this.config.warningTtc || gap <= gapWarn)) {
          fcw = true;
          fcwLevel = Math.max(fcwLevel, 1) as 1 | 2;
        }
        // Trigger from stopping distance, not TTC alone. TTC can still look
        // comfortable after the remaining distance is already too short to stop.
        const closing = Math.max(closingSpeed, 0);
        // Add a safety buffer for pedestrians or high speeds
        const reactionMargin = (obstacle.kind === "ped" ? 1.4 : 1.0) * (ego.v * 0.35 + 4);
        const stoppingGap = (closing * closing) / (2 * Math.max(ego.maxDecel * ego.surfaceMu * 0.8, 1)) + reactionMargin;
        const urgent = gap <= stoppingGap * 1.15 || ttc <= this.config.brakingTtc * 1.25 || gap <= 6;
        if (urgent && approaching && this.config.fcw) fcwLevel = 2;
        if (this.config.aeb && approaching && (gap <= stoppingGap * 1.08 || gap <= 6.0 || ttc < this.config.brakingTtc)) {
          aebRequested = true;
          // Brake to the estimated stopping demand when the driver is already
          // braking; if there is no pedal input, apply full emergency pressure.
          const availableGap = Math.max(gap - reactionMargin, 0.5);
          const requestedDecel = (closing * closing) / (2 * availableGap);
          const demand = input.brake > 0
            ? clamp(requestedDecel / Math.max(ego.maxDecel * ego.surfaceMu, 0.1), 0, 1)
            : 1;
          requestedBrakeForce = Math.max(requestedBrakeForce, demand);
        }
      }

      // Positive d is the driver's right in the rendered road convention.
      if (this.config.bsm && ds >= -8 && ds <= 3) {
        const lateral = Math.abs(dd);
        const nearSide = (ego.dims.width + obstacle.width) / 2 + 0.15;
        const outerEdge = nearSide + laneWidth * 0.75;
        if (lateral >= nearSide && lateral <= outerEdge) {
          if (dd > 0) blindSpotRight = true;
          else blindSpotLeft = true;
        }
      }

      // Low-speed parking sensors: front bumper distance to the nearest object.
      if (this.config.parking && ego.v < 3 && ds > 0 && ds <= 8 && Math.abs(dd) < (ego.dims.width + obstacle.width) / 2 + 0.4) {
        const front = Math.max(0, ds - (ego.dims.length + obstacle.length) / 2);
        if (parkingFront === null || front < parkingFront) parkingFront = front;
      }
    }

    // Keep the brake applied if the driver continues to request acceleration.
    // Without this hold, throttle resumes as soon as speed reaches zero, causing
    // repeated brake/re-acceleration pulses into the same stationary obstacle.
    if (aebRequested) this.aebLatched = true;
    if (aebRequested) { this.cancelCruise(); cruiseActive = false; }
    if (!this.config.aeb || !lead || input.throttle <= 0) this.aebLatched = false;
    const adasBrakeForce = aebRequested ? Math.max(requestedBrakeForce, input.brake) : 0;
    const aebHolding = this.config.aeb && this.aebLatched && ego.v < .3 && lead !== null;
    const aeb = !aebHolding && this.config.aeb && (
      (aebRequested && adasBrakeForce > input.brake + 0.02) ||
      (this.aebLatched && input.throttle > 0 && lead !== null)
    );
    if (aeb) this.aebLatched = true;
    const appliedAebForce = aebHolding ? 1 : aeb
      ? Math.max(adasBrakeForce, aebRequested ? 0 : 1)
      : 0;

    // ---- traffic-sign recognition / intelligent speed assist --------------
    const tsrLimitKph = this.config.tsr && sensorsAvailable ? frame.speedLimitKph ?? null : null;
    const tsrNew = tsrLimitKph !== null && tsrLimitKph !== this.lastTsr;
    this.lastTsr = tsrLimitKph;
    const signCapMps = tsrLimitKph !== null ? tsrLimitKph / 3.6 : Infinity;
    const speedCap = this.config.isa ? Math.min(desiredSpeed, signCapMps) : desiredSpeed;
    const isaOverride = this.config.isa && tsrLimitKph !== null && input.throttle >= .95;
    const speedLimited = this.config.isa && tsrLimitKph !== null && !isaOverride && (speedCap < desiredSpeed - 0.1 || ego.v > signCapMps);

    // ---- traffic-light recognition (TLR) ----------------------------------
    const light = sensorsAvailable && (this.config.tsr || this.config.trafficLightAssist) ? frame.trafficLight ?? null : null;
    const trafficLight = light ? light.state : "none";
    const trafficLightDistance = light ? light.distance : null;
    const redLightWarning =
      light !== null && light.state !== "green" && light.distance < 70 && ego.v > 8;

    // ---- adaptive cruise --------------------------------------------------
    let targetSpeed = speedCap;
    let accHolding = false;
    if (cruiseActive && lead) {
      const desiredGap = 4 + ego.v * this.config.timeGap;
      const gapCorrection = clamp((lead.gap - desiredGap) * 0.45, -12, 6);
      targetSpeed = clamp(lead.obstacle.v + gapCorrection, 0, speedCap);
      if (lead.gap < 6 && ego.v < 0.4 && lead.obstacle.v < 0.4) {
        targetSpeed = 0;
        accHolding = true;
      }
    }
    this.cruiseHoldTime = accHolding ? this.cruiseHoldTime + dt : this.cruiseHoldTime >= 3 ? this.cruiseHoldTime : 0;
    if (cruiseActive && this.cruiseHoldTime >= 3) { targetSpeed = 0; accHolding = true; }

    // Optional traffic-light assist: stop at the line on red/amber.
    if (this.config.trafficLightAssist && light && light.state !== "green") {
      const stopDistance = Math.max(light.distance - 5, 0);
      const cap = Math.sqrt(2 * 2.3 * stopDistance) + 0.4;
      targetSpeed = Math.min(targetSpeed, cap);
      if (light.state === "red" && light.distance < 4) targetSpeed = 0;
    }

    // ---- assisted lane change --------------------------------------------
    const currentLane = road.laneOf(egoD);
    const laneOffset = egoD - road.laneCenter(currentLane);
    this.alcComplete = false;
    this.alcAborted = false;
    const steeringOverride = Math.abs(input.steer) > .05;
    if (!indicator) this.alcCancelledSignal = 0;
    if (steeringOverride || !laneAvailable || input.brake > .02) {
      if (this.alcTargetLane !== null) this.alcAborted = true;
      this.alcTargetLane = null;
      this.alcBlocked = false;
      this.alcCancelledSignal = indicator;
      this.alcReason = steeringOverride ? "Người lái tiếp quản" : !laneAvailable ? "Không nhận diện được làn" : "Người lái phanh";
    }
    if (!steeringOverride && laneAvailable && input.brake <= .02 && (!indicator || indicator !== this.alcCancelledSignal)) {
      this.stepLaneChange(indicator, ego, egoS, egoD, currentLane, path, road, obstacles, dt);
    }
    const alcActive = this.alcTargetLane !== null;
    const alcBlocked = !alcActive && indicator !== 0 && this.config.alc && this.alcBlocked;
    const centerLane = alcActive ? this.alcTargetLane! : currentLane;

    // ---- steering: manual torque + lane assist ---------------------------
    const manualSteer = clamp(input.steer, -1, 1) * ego.maxSteer;
    let steer = manualSteer;
    let laneKeepAssist = false;
    const assistSteering = laneAvailable && !steeringOverride && (this.config.laneCentering || alcActive);
    if (assistSteering) {
      const frontX = ego.x + (ego.dims.wheelbase / 2) * Math.cos(ego.yaw);
      const frontY = ego.y + (ego.dims.wheelbase / 2) * Math.sin(ego.yaw);
      const front = path.toFrenet(frontX, frontY);
      const pathHeading = path.cartesianAt(front.s).heading;
      const laneChangePhase = clamp(this.alcTimer / 3.6, 0, 1);
      const blend = laneChangePhase ** 3 * (10 - 15 * laneChangePhase + 6 * laneChangePhase ** 2);
      // Move the reference across the lane over time, instead of instantly
      // requesting the adjacent centre and saturating the steering wheel.
      const centerD = alcActive ? this.alcStartD + (road.laneCenter(centerLane) - this.alcStartD) * blend : road.laneCenter(centerLane);
      const correction = stanleyControl(
        wrapAngle(pathHeading - ego.yaw),
        front.d - centerD,
        ego.v,
        { k: 3, kSoft: 1.2, maxSteer: ego.maxSteer },
      );
      laneKeepAssist = Math.abs(correction) > 0.008 && Math.abs(front.d - centerD) > 0.18;
      // An assisted lane change owns the wheel; otherwise the driver can always
      // add torque on top of the lane-centring assist.
      steer = alcActive
        ? correction
        : clamp(manualSteer + correction * 0.7, -ego.maxSteer, ego.maxSteer);
    }

    let laneDeparture: LaneDeparture = "none";
    if (this.config.lda && laneAvailable && !alcActive && indicator !== Math.sign(laneOffset) && Math.abs(laneOffset) > laneWidth * 0.42) {
      laneDeparture = laneOffset > 0 ? "right" : "left";
    }

    // ---- longitudinal control --------------------------------------------
    let accel: number;
    if (cruiseActive) {
      // ACC controls speed until the driver presses the accelerator. Brake input
      // always has priority and remains available to the driver.
      accel = input.throttle > 0
        ? input.throttle * ego.maxAccel
        : frame.speedControl(targetSpeed - ego.v, dt);
      if (input.brake > 0) accel = -input.brake * ego.maxDecel;
    } else {
      accel = input.brake > 0 ? -input.brake * ego.maxDecel : input.throttle * ego.maxAccel;
      if (input.throttle === 0 && input.brake === 0) accel = -coastDeceleration(ego.v) - .07;
    }

    let isaBrakeForce = 0;
    if (this.config.isa && tsrLimitKph !== null && !isaOverride && ego.v >= signCapMps && input.brake === 0) {
      accel = Math.min(accel, clamp((signCapMps - ego.v) * 1.4, -2.5, 0));
      isaBrakeForce = clamp(-accel / ego.maxDecel, 0, 1);
    }
    if (aeb || aebHolding) accel = Math.min(accel, -appliedAebForce * ego.maxDecel);

    const headway = lead ? lead.gap / Math.max(ego.v, 0.1) : null;
    this.status = {
      extra: emptyAssistanceStatus(),
      active: true,
      engaged: true,
      accActive: cruiseActive,
      accHolding,
      accState: !this.config.acc ? "off" : !cruiseActive ? "cancelled" : this.cruiseHoldTime >= 3 ? "resume-required" : accHolding ? "hold" : "active",
      sensorsAvailable, laneAvailable, takeoverRequired: !sensorsAvailable || (this.config.laneCentering && !laneAvailable), aebHolding,
      laneCenteringActive: this.config.laneCentering && laneAvailable && !steeringOverride,
      laneKeepAssist,
      laneDeparture,
      fcw,
      fcwLevel,
      aeb,
      adasBrakeForce: Math.max(appliedAebForce, isaBrakeForce, cruiseActive && input.throttle === 0 && input.brake === 0 ? clamp(-accel / ego.maxDecel, 0, 1) : 0),
      rctaActive: false,
      rctaLeft: false,
      rctaRight: false,
      rearAeb: false,
      blindSpotLeft,
      blindSpotRight,
      leadGap: lead ? lead.gap : null,
      leadTtc:
        lead && ego.v > lead.obstacle.v + 0.1 ? lead.gap / (ego.v - lead.obstacle.v) : null,
      headway,
      targetSpeed,
      setSpeed: desiredSpeed,
      tsrLimitKph,
      tsrNew,
      trafficLight,
      trafficLightDistance,
      redLightWarning,
      alc: alcActive ? "active" : alcBlocked ? "blocked" : indicator !== 0 && this.config.alc && laneAvailable && !steeringOverride && indicator !== this.alcCancelledSignal ? "armed" : "off",
      alcTargetLane: this.alcTargetLane,
      alcComplete: this.alcComplete,
      alcAborted: this.alcAborted,
      alcReason: this.alcReason,
      parkingFront,
      parkingRear: null, parkingLeft: null, parkingRight: null,
      indicatorLeft: indicator < 0,
      indicatorRight: indicator > 0,
      speedLimited,
      isaOverride,
      driverOverride: steeringOverride || input.throttle > 0 || input.brake > 0,
    };

    return { steer, accel, targetSpeed, status: this.status };
  }

  /**
   * Turn-signal-driven lane change: arm on the signal, verify the target lane is
   * clear, steer across, then auto-cancel the signal. If the target lane is
   * occupied (blind-spot monitoring), the manoeuvre stays blocked and warns.
   */
  private stepLaneChange(
    indicator: number,
    ego: Vehicle,
    egoS: number,
    egoD: number,
    currentLane: number,
    path: ReferencePath,
    road: Road,
    obstacles: Obstacle[],
    dt: number,
  ): void {
    this.alcBlocked = false;
    if (!this.config.alc || ego.v < 4) {
      this.alcTargetLane = null;
      this.alcRequestedDir = 0;
      return;
    }

    if (this.alcTargetLane !== null) {
      if (indicator === 0) {
        // Driver cancelled the manoeuvre.
        this.alcTargetLane = null;
        this.alcRequestedDir = 0;
        return;
      }
      this.alcTimer += dt;
      const targetD = road.laneCenter(this.alcTargetLane);
      if (!this.laneClear(ego, egoS, egoD, this.alcTargetLane, path, road, obstacles) || this.alcTimer > 9) {
        this.alcTargetLane = null;
        this.alcBlocked = true;
        this.alcAborted = true;
        this.alcCancelledSignal = indicator;
        this.alcReason = this.alcTimer > 9 ? "Quá thời gian chuyển làn" : "Khoảng trống phía trước/sau không còn an toàn";
        return;
      }
      if (Math.abs(egoD - targetD) < 0.3) {
        this.alcTargetLane = null;
        this.alcRequestedDir = 0;
        this.alcComplete = true;
      }
      return;
    }

    if (indicator === 0) {
      this.alcRequestedDir = 0;
      this.alcArmTimer = 0;
      return;
    }
    if (indicator !== this.alcRequestedDir) {
      this.alcRequestedDir = indicator;
      this.alcArmTimer = 0;
    }
    // Brief arming delay: the signal must be on long enough for perception to
    // confirm (or clear) the target lane before the car commits to the move.
    this.alcArmTimer += dt;
    if (this.alcArmTimer < 0.45) return;

    const target = currentLane + (indicator > 0 ? 1 : -1);
    if (target < 0 || target >= road.numLanes) {
      this.alcBlocked = true;
      this.alcReason = "Không có làn bên cạnh";
      return;
    }
    if (!this.laneClear(ego, egoS, egoD, target, path, road, obstacles)) {
      this.alcBlocked = true;
      this.alcReason = "Xe trước/sau chưa đủ khoảng trống trong 5 giây";
      return;
    }
    this.alcTargetLane = target;
    this.alcReason = "";
    this.alcTimer = 0;
    this.alcStartD = egoD;
  }

  /** True when the target lane has a comfortable front and rear gap. */
  private laneClear(
    ego: Vehicle,
    egoS: number,
    egoD: number,
    targetLane: number,
    path: ReferencePath,
    road: Road,
    obstacles: Obstacle[],
  ): boolean {
    const targetD = road.laneCenter(targetLane);
    for (const o of obstacles) {
      const ds = wrapDiff(o.s, egoS, path.length);
      const clearance = (ego.dims.length + o.length) / 2;
      // Check a five-second constant-velocity envelope, including fast rear
      // approaches and motorcycles moving laterally into the target lane.
      for (let t = 0; t <= 5; t += .2) {
        if (Math.abs(o.d + o.vd * t - targetD) > (o.width + ego.dims.width) / 2 + .45) continue;
        const predicted = ds + (o.v - ego.v) * t;
        const margin = predicted >= 0 ? Math.max(18, ego.v * .7) : Math.max(15, o.v * .6);
        if (Math.abs(predicted) - clearance < margin) return false;
      }
    }
    return true;
  }

  clearStatus(): void {
    this.aebLatched = false;
    this.alcTargetLane = null;
    this.alcBlocked = false;
    this.alcComplete = false;
    this.alcAborted = false;
    this.alcArmTimer = 0;
    this.alcRequestedDir = 0;
    this.alcCancelledSignal = 0;
    this.alcReason = "";
    this.cruiseHoldTime = 0;
    this.lastTsr = null;
    this.status = emptyStatus();
  }
}

function emptyStatus(): ADASStatus {
  return {
    extra: emptyAssistanceStatus(),
    active: false,
    engaged: false,
    accActive: false,
    accHolding: false,
    accState: "off", sensorsAvailable: true, laneAvailable: true, takeoverRequired: false, aebHolding: false,
    laneCenteringActive: false,
    laneKeepAssist: false,
    laneDeparture: "none",
    fcw: false,
    fcwLevel: 0,
    aeb: false,
    adasBrakeForce: 0,
    rctaActive: false,
    rctaLeft: false,
    rctaRight: false,
    rearAeb: false,
    blindSpotLeft: false,
    blindSpotRight: false,
    leadGap: null,
    leadTtc: null,
    headway: null,
    targetSpeed: 0,
    setSpeed: 0,
    tsrLimitKph: null,
    tsrNew: false,
    trafficLight: "none",
    trafficLightDistance: null,
    redLightWarning: false,
    alc: "off",
    alcTargetLane: null,
    alcComplete: false,
    alcAborted: false,
    alcReason: "",
    parkingFront: null,
    parkingRear: null, parkingLeft: null, parkingRight: null,
    indicatorLeft: false,
    indicatorRight: false,
    speedLimited: false,
    isaOverride: false,
    driverOverride: false,
  };
}
