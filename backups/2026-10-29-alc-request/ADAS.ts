// ADASController — simulation-only driver assistance for Manual Drive.
//
// The suite mirrors the feature set of a modern passenger car:
//   ACC   adaptive cruise with stop & go and a selectable headway
//   LFA   continuous lane centring; LKA is departure-only support
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
import {bodyContact} from '../core/collision.ts';
import { assistanceAvailability, ASSISTANCE_REFERENCE, AvailabilityFrame } from './AssistancePolicy.ts';

export type LaneDeparture = "none" | "left" | "right";
export type AlcState = "off" | "armed" | "active" | "blocked";

export interface TrafficLightSighting {
  state: "green" | "yellow" | "red";
  distance: number;
  id?: number;
}

export interface ADASConfig {
  acc: boolean;
  laneCentering: boolean;
  laneKeeping: boolean;
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
  standstillGap: number;
  warningTtc: number;
  brakingTtc: number;
  isaMode: 'limit' | 'warning' | 'suggest';
  signalMode: 'standard' | 'confirmation';
  alcHighwayOnly: boolean;
  curveSpeedAssist: boolean;
  emergencyShoulderStop: boolean;
}

export interface ADASStatus {
  extra: AssistanceStatus;
  active: boolean;
  engaged: boolean;
  accActive: boolean;
  accHolding: boolean;
  desiredGap: number;
  timeGap: number;
  trafficLightStopping: boolean;
  brakeReason: "none" | "driver" | "acc-speed" | "acc-gap" | "curve" | "signal" | "aeb" | "aeb-hold" | "isa" | 'emergency-stop';
  curveSpeedLimited: boolean;
  laneSupportLimited: boolean;
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
  rctaArmed: boolean;
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
  availabilityReason: string;
  signalConfirmationRequired: boolean;
  speedWarning: boolean;
  highwayAssistActive: boolean;
  trafficJamAssistActive: boolean;
  aebCause?:string;
}

export interface DriverInput {
  steer: number; // -1 left, +1 right
  throttle: number; // [0, 1]
  brake: number; // [0, 1]
  /** Raw driver intent before speed-dependent keyboard steering limits. */
  steeringOverride?: boolean;
}

export interface ADASFrame extends AvailabilityFrame {
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
  laneKeeping: true,
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
  standstillGap: 3,
  warningTtc: 3.0,
  brakingTtc: 2.0,
  isaMode: 'limit', signalMode: 'standard', alcHighwayOnly: true, curveSpeedAssist: true, emergencyShoulderStop: true,
};

/** Headway notches offered by the UI, in seconds. */
export const ADAS_GAP_NOTCHES = [1.0, 1.3, 1.6, 2.0, 2.5, 3.0] as const;

/** Controller memory is separate from the cluster's display status. Replay
 * must preserve both, especially driver cancellation and emergency brake hold. */
export interface ADASRuntimeState {
  config: ADASConfig;
  aebLatched: boolean;
  alcTargetLane: number | null;
  alcTimer: number;
  alcComplete: boolean;
  alcArmTimer: number;
  alcRequestedDir: number;
  alcBlocked: boolean;
  alcAborted: boolean;
  alcStartD: number;
  lastTsr: number | null;
  cruiseCancelled: boolean;
  cruiseHoldTime: number;
  alcCancelledSignal: number;
  alcReason: string;
  steeringReleaseTime: number;
  cruiseSetSpeed: number | null;
  normalAccel: number;
  yellowDecision: { id: number; stop: boolean } | null;
  laneTarget: number | null;
  confirmedSignal?: number | null;
}

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
  private steeringReleaseTime = 0;
  private cruiseSetSpeed: number | null = null;
  private normalAccel = 0;
  private yellowDecision: { id: number; stop: boolean } | null = null;
  private laneTarget: number | null = null;
  private confirmedSignal: number | null = null;

  getSetSpeed(fallback: number): number { return this.cruiseSetSpeed ?? fallback; }
  setCruiseSpeedKph(kph: number): void {
    if (Number.isFinite(kph)) this.cruiseSetSpeed = clamp(kph, ASSISTANCE_REFERENCE.accMinSetKph, ASSISTANCE_REFERENCE.accMaxKph) / 3.6;
  }

  cancelCruise(): void { this.cruiseCancelled = true; }
  releaseLaneOwnership():void { this.laneTarget=null;this.alcTargetLane=null;this.alcRequestedDir=0;this.alcArmTimer=0; }
  resumeCruise(): void { this.cruiseCancelled = false; this.cruiseHoldTime = 0; }

  captureState(): ADASRuntimeState {
    return {
      config: { ...this.config }, aebLatched: this.aebLatched,
      alcTargetLane: this.alcTargetLane, alcTimer: this.alcTimer, alcComplete: this.alcComplete,
      alcArmTimer: this.alcArmTimer, alcRequestedDir: this.alcRequestedDir,
      alcBlocked: this.alcBlocked, alcAborted: this.alcAborted, alcStartD: this.alcStartD,
      lastTsr: this.lastTsr, cruiseCancelled: this.cruiseCancelled, cruiseHoldTime: this.cruiseHoldTime,
      alcCancelledSignal: this.alcCancelledSignal, alcReason: this.alcReason,
      steeringReleaseTime: this.steeringReleaseTime, cruiseSetSpeed: this.cruiseSetSpeed,
      normalAccel: this.normalAccel, yellowDecision: this.yellowDecision ? { ...this.yellowDecision } : null,
      laneTarget: this.laneTarget,
      confirmedSignal: this.confirmedSignal,
    };
  }

  restoreState(state: ADASRuntimeState | undefined, status: ADASStatus): void {
    this.clearStatus();
    if (!state) {
      // Older recordings have display telemetry only. Preserve explicit safety
      // cancellations/holds rather than inheriting another live run's memory.
      this.cruiseCancelled = status.accState === 'cancelled' || status.accState === 'off';
      this.cruiseHoldTime = status.accState === 'resume-required' ? 3 : 0;
      this.cruiseSetSpeed = status.setSpeed > 0 ? status.setSpeed : null;
      this.aebLatched = status.aeb || status.aebHolding;
      if (status.timeGap > 0) this.config.timeGap = status.timeGap;
      return;
    }
    for (const key of Object.keys(DEFAULT_ADAS_CONFIG) as (keyof ADASConfig)[]) {
      const value = state.config[key];
      if (typeof value === typeof DEFAULT_ADAS_CONFIG[key] && (typeof value !== 'number' || Number.isFinite(value))) {
        (this.config[key] as boolean | number | string) = value;
      }
    }
    this.aebLatched = state.aebLatched;
    this.alcTargetLane = state.alcTargetLane;
    this.alcTimer = state.alcTimer;
    this.alcComplete = state.alcComplete;
    this.alcArmTimer = state.alcArmTimer;
    this.alcRequestedDir = state.alcRequestedDir;
    this.alcBlocked = state.alcBlocked;
    this.alcAborted = state.alcAborted;
    this.alcStartD = state.alcStartD;
    this.lastTsr = state.lastTsr;
    this.cruiseCancelled = state.cruiseCancelled;
    this.cruiseHoldTime = state.cruiseHoldTime;
    this.alcCancelledSignal = state.alcCancelledSignal;
    this.alcReason = state.alcReason;
    this.steeringReleaseTime = state.steeringReleaseTime;
    this.cruiseSetSpeed = state.cruiseSetSpeed;
    this.normalAccel = state.normalAccel;
    this.yellowDecision = state.yellowDecision ? { ...state.yellowDecision } : null;
    this.laneTarget = state.laneTarget;
    this.confirmedSignal = state.confirmedSignal ?? null;
  }

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
    const availability = assistanceAvailability(frame);
    const sensorsAvailable = availability.forward;
    const laneAvailable = availability.lane;
    if (input.brake > 0 || !availability.cruise) this.cancelCruise();
    let cruiseActive = this.config.acc && !this.cruiseCancelled && availability.cruise;
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
    let aebCause='';

    for (const obstacle of obstacles) {
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

      // When the driver owns steering, inspect the bicycle path in world space
      // rather than assuming the car will follow the road centre around a bend.
      // Lane-centred driving keeps the established Frenet sensor corridor.
      if(!this.config.laneCentering||input.steeringOverride||Math.abs(input.steer)>.05){
        inPath=false;
        const curvature=Math.tan(clamp(input.steer,-1,1)*ego.maxSteer)/ego.dims.wheelbase;
        const horizon=Math.min(4,Math.max(2,ego.v/Math.max(ego.maxDecel*ego.surfaceMu,1)+.5));
        for(let t=0;t<=horizon;t+=.1){
          const angle=ego.yaw+ego.v*curvature*t;
          const x=Math.abs(curvature)<1e-5?ego.x+ego.v*Math.cos(ego.yaw)*t:ego.x+(Math.sin(angle)-Math.sin(ego.yaw))/curvature;
          const y=Math.abs(curvature)<1e-5?ego.y+ego.v*Math.sin(ego.yaw)*t:ego.y-(Math.cos(angle)-Math.cos(ego.yaw))/curvature;
          const o=path.toCartesian(obstacle.s+obstacle.v*t,obstacle.d+obstacle.vd*t);
          if(bodyContact({x,y,yaw:angle,...ego.dims},{x:o.x,y:o.y,yaw:o.heading,length:obstacle.length,width:obstacle.width},.3)){inPath=true;break;}
        }
      }
      if (sensorsAvailable && ds > 0 && ds <= brakingHorizon && inPath) {
        // Evaluate every hazard independently. ACC's nearest target must not
        // make emergency braking depend on obstacle-array ordering.
        if (!lead || ds < lead.ahead) lead = { obstacle, gap, ahead: ds };
        const approaching = closingSpeed > .2 || (ego.v > .3 && gap < this.config.standstillGap);
        const gapWarn = Math.max(8, ego.v * 0.8);
        if (this.config.fcw && approaching && (ttc <= this.config.warningTtc || gap <= gapWarn)) {
          fcw = true;
          fcwLevel = Math.max(fcwLevel, 1) as 1 | 2;
        }
        // Trigger from stopping distance, not TTC alone. TTC can still look
        // comfortable after the remaining distance is already too short to stop.
        const closing = Math.max(closingSpeed, 0);
        // Add a safety buffer for pedestrians or high speeds
        const reactionMargin = (obstacle.kind === "ped" ? 3.5 : 2.5) + ego.v * .25 + closing * .10;
        // A moving lead can keep braking after we start braking. Squaring only
        // relative speed assumes it will maintain its current speed, and can
        // trigger too late even though both cars could have stopped safely.
        const availableDecel=Math.max(ego.maxDecel*ego.surfaceMu*.95,1);
        const leadStoppingDistance=Math.max(0,obstacle.v)**2/(2*8);
        const stoppingGap=Math.max(closing**2/(2*availableDecel),ego.v**2/(2*availableDecel)-leadStoppingDistance)+reactionMargin;
        const urgent = gap <= stoppingGap * 1.15 || ttc <= this.config.brakingTtc;
        if (urgent && approaching && this.config.fcw) fcwLevel = 2;
        const availableGap = Math.max(gap - reactionMargin+leadStoppingDistance, .5);
        const requestedDecel = ego.v**2 / (2 * availableGap);
        const requiredPressure = clamp(requestedDecel / Math.max(ego.maxDecel * ego.surfaceMu, .1), 0, 1);
        const needsBrakeAssist = input.brake > 0 && requiredPressure > input.brake + .04 && ttc < this.config.warningTtc;
        if (this.config.aeb && approaching && (gap <= stoppingGap || ttc <= this.config.brakingTtc || gap < 2 || needsBrakeAssist)) {
          aebRequested = true;
          // Brake to the estimated stopping demand when the driver is already
          // braking; if there is no pedal input, apply full emergency pressure.
          const demand = input.brake > 0
            ? requiredPressure
            : 1;
          requestedBrakeForce = Math.max(requestedBrakeForce, demand);
          const cause=Math.abs(obstacle.vd)>.35?'Vật cắt vào đường xe chạy':'Không đủ khoảng cách dừng an toàn';
          if(!aebCause||cause<aebCause)aebCause=cause;
        }
      }

      // Positive d is the driver's right in the rendered road convention.
      const rearClosing=obstacle.v-ego.v;
      const rearApproach=ds<0&&rearClosing>.5&&(-ds-(ego.dims.length+obstacle.length)/2)/rearClosing<4.5;
      if (!obstacle.roadBoundary && availability.sensors.rearRadar && this.config.bsm && ds >= -100 && (ds >= -8 || rearApproach) && ds <= 3) {
        const lateral = Math.abs(dd);
        const nearSide = (ego.dims.width + obstacle.width) / 2 + 0.15;
        const outerEdge = nearSide + laneWidth * 0.75;
        if (lateral >= nearSide && lateral <= outerEdge) {
          if (dd > 0) blindSpotRight = true;
          else blindSpotLeft = true;
        }
      }

      // Low-speed parking sensors: front bumper distance to the nearest object.
      if (availability.sensors.ultrasonic && this.config.parking && ego.v < 3 && ds > 0 && ds <= 8 && Math.abs(dd) < (ego.dims.width + obstacle.width) / 2 + 0.4) {
        const front = Math.max(0, ds - (ego.dims.length + obstacle.length) / 2);
        if (parkingFront === null || front < parkingFront) parkingFront = front;
      }
    }

    // Keep the brake applied if the driver continues to request acceleration.
    // Without this hold, throttle resumes as soon as speed reaches zero, causing
    // repeated brake/re-acceleration pulses into the same stationary obstacle.
    if (aebRequested) this.aebLatched = true;
    if (aebRequested) { this.cancelCruise(); cruiseActive = false; }
    const leadPullingAway=lead!==null&&lead.obstacle.v>.8&&lead.gap>this.config.standstillGap+1&&lead.obstacle.v>ego.v;
    if (!this.config.aeb || !sensorsAvailable || leadPullingAway || (!lead&&ego.v<.3&&input.throttle<=0)) this.aebLatched = false;
    const adasBrakeForce = aebRequested ? Math.max(requestedBrakeForce, input.brake) : 0;
    const aebHolding = this.config.aeb && this.aebLatched && ego.v < .3;
    const aeb = !aebHolding && this.config.aeb && (
      (aebRequested && adasBrakeForce > input.brake + 0.02) ||
      (this.aebLatched && (input.throttle > 0 || ego.v >= .3))
    );
    if (aeb) this.aebLatched = true;
    const appliedAebForce = aebHolding ? 1 : aeb
      ? Math.max(adasBrakeForce, aebRequested ? 0 : 1)
      : 0;

    // ---- traffic-sign recognition / intelligent speed assist --------------
    const tsrLimitKph = this.config.tsr && availability.sensors.camera ? frame.speedLimitKph ?? null : null;
    const tsrNew = tsrLimitKph !== null && tsrLimitKph !== this.lastTsr;
    this.lastTsr = tsrLimitKph;
    const signCapMps = tsrLimitKph !== null ? tsrLimitKph / 3.6 : Infinity;
    const setSpeed = this.getSetSpeed(desiredSpeed);
    const isaLimiting = this.config.isa && this.config.isaMode === 'limit';
    const speedCap = isaLimiting ? Math.min(setSpeed, signCapMps) : setSpeed;
    const isaOverride = this.config.isa && tsrLimitKph !== null && input.throttle >= .95;
    const speedLimited = isaLimiting && tsrLimitKph !== null && !isaOverride && (speedCap < setSpeed - 0.1 || ego.v > signCapMps);
    const speedWarning = this.config.isa && tsrLimitKph !== null && ego.v > signCapMps + .5;

    // ---- traffic-light recognition (TLR) ----------------------------------
    const light = availability.sensors.camera && (this.config.tsr || this.config.trafficLightAssist) ? frame.trafficLight ?? null : null;
    const trafficLight = light ? light.state : "none";
    const trafficLightDistance = light ? light.distance : null;
    const redLightWarning =
      light !== null && light.state !== "green" && light.distance < 70 && ego.v > 8;

    // ---- adaptive cruise --------------------------------------------------
    let targetSpeed = cruiseActive ? speedCap : 0;
    let accHolding = false;
    const desiredGap = this.config.standstillGap + ego.v * this.config.timeGap;
    const comfortDecel = Math.min(2.8, ego.maxDecel * ego.surfaceMu * .55);
    if (cruiseActive && lead) {
      const gapError = lead.gap - desiredGap;
      const gapCorrection = gapError >= 0 ? Math.sqrt(2 * comfortDecel * gapError) : gapError * .5;
      targetSpeed = clamp(lead.obstacle.v + gapCorrection, 0, speedCap);
      if (lead.gap < this.config.standstillGap + .8 && ego.v < 0.4 && lead.obstacle.v < 0.4) {
        targetSpeed = 0;
        accHolding = true;
      }
    }
    const resumeSeconds = ASSISTANCE_REFERENCE.stopGoResumeSeconds;
    this.cruiseHoldTime = accHolding ? this.cruiseHoldTime + dt : this.cruiseHoldTime >= resumeSeconds ? this.cruiseHoldTime : 0;
    if (cruiseActive && this.cruiseHoldTime >= resumeSeconds) { targetSpeed = 0; accHolding = true; }

    // Stop relative to the front bumper and the painted line (1.2m before the
    // mast). Latch a yellow dilemma-zone decision until that phase ends.
    const stopCentreGap = ego.dims.length / 2 + 1.2 + .8;
    if (!light || light.state !== "yellow") this.yellowDecision = null;
    if (light?.state === "yellow" && (!this.yellowDecision || this.yellowDecision.id !== (light.id ?? 0))) {
      this.yellowDecision = { id: light.id ?? 0, stop: light.distance - stopCentreGap > ego.v * .25 + ego.v ** 2 / (2 * comfortDecel) };
    }
    if (!light || light.distance < 0 || light.state !== 'green') this.confirmedSignal = null;
    const signalId = light?.id ?? 0;
    const followsThroughGreen = !!lead && lead.obstacle.v > 1 && lead.gap < 35 && availability.conditions.handsOn;
    if (light?.state === 'green' && input.throttle > .05) this.confirmedSignal = signalId;
    const signalConfirmationRequired = cruiseActive && this.config.trafficLightAssist && this.config.signalMode === 'confirmation' &&
      light?.state === 'green' && this.confirmedSignal !== signalId && !followsThroughGreen;
    const trafficLightStopping = cruiseActive && this.config.trafficLightAssist && !!light &&
      (light.state === "red" || (light.state === "yellow" && this.yellowDecision?.stop === true) || signalConfirmationRequired);
    if (trafficLightStopping && light) {
      const stopDistance = Math.max(light.distance - stopCentreGap, 0);
      // Reserve the approach distance consumed while normal braking pressure
      // ramps up; a pure sqrt(2*a*d) profile assumes instant full deceleration.
      const cap = Math.sqrt(2 * comfortDecel * Math.max(0, stopDistance - ego.v * .8));
      targetSpeed = Math.min(targetSpeed, cap);
      if (stopDistance < .8) targetSpeed = 0;
    }

    // Preview the braking distance, not just the curve under the front wheels.
    // This cap belongs to ACC: pedals still override cruise, and lane support
    // must request takeover if the driver enters a bend too fast for grip.
    const roadCurvature = path.signedCurvatureAt(egoS);
    const laneCurvature = roadCurvature / Math.max(.25, 1 - roadCurvature * egoD);
    const corneringBudget = 3.5 * clamp(ego.surfaceMu, .35, 1);
    let laneSupportLimited = laneAvailable && this.config.laneCentering &&
      (ego.tractionLimited || ego.v ** 2 * Math.abs(laneCurvature) > 9.81 * clamp(ego.surfaceMu, .35, 1) * .85);
    // Warn before reaching the bend, including when pedals override ACC.
    // Lane assistance cannot manufacture tyre grip at an impossible speed.
    if(laneAvailable&&this.config.laneCentering){
      for(let distance=4;distance<=Math.max(8,ego.v*1.5);distance+=4){
        const k=path.signedCurvatureAt(egoS+distance);
        const laneK=Math.abs(k/Math.max(.25,1-k*egoD));
        if(ego.v**2*laneK>9.81*clamp(ego.surfaceMu,.35,1)*.85)laneSupportLimited=true;
      }
    }
    let curveSpeedLimited = false;
    let curveBrakeDemand = 0;
    if (cruiseActive && laneAvailable && this.config.curveSpeedAssist) {
      let curveCap = Infinity;
      const preview = Math.max(80, ego.v ** 2 / (2 * comfortDecel) + ego.v * 1.2);
      for (let distance = 0; distance <= preview; distance += 4) {
        const k = path.signedCurvatureAt(egoS + distance);
        const laneK = Math.abs(k / Math.max(.25, 1 - k * egoD));
        if (laneK < 1e-5) continue;
        const curveV2 = corneringBudget / laneK;
        const brakingDistance = Math.max(0, distance - ego.v * 1.2);
        curveCap = Math.min(curveCap, Math.sqrt(curveV2 + 2 * comfortDecel * brakingDistance));
        // Joining ACC at high speed can leave less distance than a comfort
        // stop requires. Request stronger braking while it is still physically
        // possible, rather than obeying a 2.8 m/s² cap until leaving the lane.
        if(distance>0&&ego.v**2>curveV2){
          const available=Math.max(1,distance-ego.v*.35);
          curveBrakeDemand=Math.max(curveBrakeDemand,(ego.v**2-curveV2)/(2*available));
        }
      }
      curveSpeedLimited = curveCap < targetSpeed - .1;
      targetSpeed = Math.min(targetSpeed, curveCap);
    }

    // ---- assisted lane change --------------------------------------------
    const currentLane = road.laneOf(egoD);
    const laneOffset = egoD - road.laneCenter(currentLane);
    this.alcComplete = false;
    this.alcAborted = false;
    const steeringOverride = input.steeringOverride ?? Math.abs(input.steer) > .05;
    const alcUnavailable = !availability.cruise ? availability.cruiseReason : !laneAvailable ? 'Không nhận diện được làn' :
      !this.config.laneCentering ? 'Cần bật giữ giữa làn LFA' : !cruiseActive ? 'Cần ACC hoạt động' :
      !availability.sensors.rearRadar ? 'Radar sau không sẵn sàng' : !availability.conditions.handsOn ? 'Cần đặt tay lên vô-lăng' :
      availability.conditions.hazards ? 'Đèn khẩn cấp đang bật' :
      fcw ? 'Đang có cảnh báo va chạm phía trước' :
      frame.trafficLight && frame.trafficLight.distance < Math.max(80, ego.v * 5) ? 'Đang đến giao lộ có đèn tín hiệu' :
      obstacles.some(o => o.kind === 'ped' && wrapDiff(o.s, egoS, path.length) > 0 && wrapDiff(o.s, egoS, path.length) < 80 &&
        Math.abs(o.d - road.forwardOffset) < road.numLanes * road.laneWidth / 2) ? 'Có người đi bộ trên phần đường phía trước' :
      this.config.alcHighwayOnly && !(frame.conditions?.motorway ?? road.profile?.motorway) ? 'ALC chỉ hỗ trợ trên cao tốc trong cấu hình này' :
      ego.v * 3.6 < ASSISTANCE_REFERENCE.alcMinKph && this.config.alcHighwayOnly ? 'ALC cần từ 80 km/h; tốc độ thấp chưa được hiệu chỉnh' : '';
    this.steeringReleaseTime = steeringOverride ? 1 : Math.max(0, this.steeringReleaseTime - dt);
    if (!laneAvailable || !this.config.laneCentering || steeringOverride) this.laneTarget = null;
    if (laneAvailable && this.config.laneCentering && this.steeringReleaseTime === 0 && this.laneTarget === null) this.laneTarget = currentLane;
    if (!indicator) this.alcCancelledSignal = 0;
    if (steeringOverride || !laneAvailable || input.brake > .02 || alcUnavailable) {
      if (this.alcTargetLane !== null) this.alcAborted = true;
      this.alcTargetLane = null;
      this.alcBlocked = !!indicator && !!alcUnavailable;
      this.alcCancelledSignal = indicator;
      this.alcReason = steeringOverride ? "Người lái tiếp quản" : input.brake > .02 ? 'Người lái phanh' : alcUnavailable;
    }
    if (!alcUnavailable && !steeringOverride && laneAvailable && input.brake <= .02 && (!indicator || indicator !== this.alcCancelledSignal)) {
      this.stepLaneChange(indicator, ego, egoS, egoD, currentLane, path, road, obstacles, dt);
    }
    const alcActive = this.alcTargetLane !== null;
    const alcBlocked = !alcActive && indicator !== 0 && this.config.alc && this.alcBlocked;
    if (this.alcComplete) this.laneTarget = currentLane;
    const centerLane = alcActive ? this.alcTargetLane! : this.laneTarget ?? currentLane;

    // ---- steering: manual torque + lane assist ---------------------------
    const manualSteer = clamp(input.steer, -1, 1) * ego.maxSteer;
    let steer = manualSteer;
    let laneKeepAssist = false;
    const outward = ego.v * Math.sin(wrapAngle(ego.yaw - path.cartesianAt(egoS).heading));
    const laneMargin = laneWidth / 2 - ego.dims.width / 2;
    const departureImminent = Math.abs(laneOffset + outward * .5) > laneMargin - .12 && laneOffset * outward > 0;
    const departureAssist = this.config.laneKeeping && ego.v * 3.6 >= ASSISTANCE_REFERENCE.laneDepartureMinKph &&
      !indicator && departureImminent && !steeringOverride;
    const inCarriageway=egoD>=road.forwardLeftEdge-.1 && egoD<=road.forwardRightEdge+.1;
    const assistSteering = inCarriageway && laneAvailable && this.steeringReleaseTime === 0 && (this.config.laneCentering || alcActive || departureAssist);
    if (assistSteering) {
      const pathHeading = path.cartesianAt(egoS).heading;
      const laneChangePhase = clamp(this.alcTimer / 3.6, 0, 1);
      const blend = laneChangePhase ** 3 * (10 - 15 * laneChangePhase + 6 * laneChangePhase ** 2);
      // Move the reference across the lane over time, instead of instantly
      // requesting the adjacent centre and saturating the steering wheel.
      const centerD = alcActive ? this.alcStartD + (road.laneCenter(centerLane) - this.alcStartD) * blend : road.laneCenter(centerLane);
      // Vehicle integrates translation at its centre. Track that same point,
      // and supply the lane curvature explicitly instead of relying on a
      // heading error at the half-wheelbase point to create the whole turn.
      const targetCurvature = roadCurvature / Math.max(.25, 1 - roadCurvature * centerD);
      const feedForward = Math.atan(ego.dims.wheelbase * targetCurvature);
      const correction = clamp(feedForward + stanleyControl(
        wrapAngle(pathHeading - ego.yaw),
        egoD - centerD,
        ego.v,
        { k: 3, kSoft: 1.2, maxSteer: ego.maxSteer },
      ), -ego.maxSteer, ego.maxSteer);
      laneKeepAssist = departureAssist && Math.abs(correction) > 0.008;
      // An assisted lane change owns the wheel; otherwise the driver can always
      // add torque on top of the lane-centring assist.
      steer = alcActive
        ? correction
        : clamp(manualSteer + correction, -ego.maxSteer, ego.maxSteer);
    }

    let laneDeparture: LaneDeparture = "none";
    if (this.config.lda && laneAvailable && ego.v * 3.6 >= ASSISTANCE_REFERENCE.laneDepartureMinKph && !alcActive && indicator !== Math.sign(laneOffset) && Math.abs(laneOffset) > laneMargin - .1) {
      laneDeparture = laneOffset > 0 ? "right" : "left";
    }

    // ---- longitudinal control --------------------------------------------
    let accel: number;
    if (cruiseActive) {
      // ACC controls speed until the driver presses the accelerator. Brake input
      // always has priority and remains available to the driver.
      if (input.throttle > 0) {
        accel = input.throttle * ego.maxAccel;
        this.normalAccel = 0;
      } else {
        const demand = clamp(frame.speedControl(targetSpeed - ego.v, dt), -comfortDecel, Math.min(ego.maxAccel, 2));
        this.normalAccel += clamp(demand - this.normalAccel, -2.5 * dt, 1.8 * dt);
        accel = this.normalAccel;
        if (targetSpeed < .05 && ego.v < .2) { accel = -1; this.normalAccel = 0; }
      }
      if (input.brake > 0) accel = -input.brake * ego.maxDecel;
    } else {
      this.normalAccel = 0;
      accel = input.brake > 0 ? -input.brake * ego.maxDecel : input.throttle * ego.maxAccel;
      if (input.throttle === 0 && input.brake === 0) accel = -coastDeceleration(ego.v) - .07;
    }

    let isaBrakeForce = 0;
    if (isaLimiting && tsrLimitKph !== null && !isaOverride && ego.v >= signCapMps && input.brake === 0) {
      accel = Math.min(accel, clamp((signCapMps - ego.v) * 1.4, -2.5, 0));
      isaBrakeForce = clamp(-accel / ego.maxDecel, 0, 1);
    }
    if(cruiseActive&&input.throttle===0&&input.brake===0&&curveBrakeDemand>comfortDecel){
      const demand=Math.min(curveBrakeDemand,ego.maxDecel*ego.surfaceMu*.9);
      accel=Math.min(accel,-demand);this.normalAccel=Math.min(this.normalAccel,accel);
      curveSpeedLimited=true;
    }
    if (aeb || aebHolding) accel = Math.min(accel, -appliedAebForce * ego.maxDecel);

    const headway = lead && ego.v > .3 ? lead.gap / ego.v : null;
    const brakeReason = input.brake > 0 ? "driver" : aebHolding ? "aeb-hold" : aeb ? "aeb" : isaBrakeForce > 0 ? "isa" :
      cruiseActive && accel < -.05 ? trafficLightStopping ? "signal" : curveSpeedLimited ? "curve" : lead && targetSpeed < speedCap - .1 ? "acc-gap" : "acc-speed" : "none";
    this.status = {
      extra: emptyAssistanceStatus(),
      availabilityReason: availability.cruiseReason, signalConfirmationRequired, speedWarning,
      highwayAssistActive: cruiseActive && laneAvailable && this.config.laneCentering && availability.conditions.motorway,
      trafficJamAssistActive: cruiseActive && laneAvailable && this.config.laneCentering && ego.v < 40 / 3.6 && !!lead,
      active: true,
      engaged: true,
      accActive: cruiseActive,
      accHolding,
      desiredGap, timeGap: this.config.timeGap, trafficLightStopping, brakeReason, curveSpeedLimited, laneSupportLimited,
      aebCause:aebHolding?'Đang giữ dừng trước vật cản':aebCause,
      accState: !this.config.acc ? "off" : !cruiseActive ? "cancelled" : this.cruiseHoldTime >= 3 ? "resume-required" : accHolding ? "hold" : "active",
      sensorsAvailable, laneAvailable, takeoverRequired: !sensorsAvailable || (this.config.laneCentering && !laneAvailable) || laneSupportLimited, aebHolding,
      laneCenteringActive: inCarriageway && this.config.laneCentering && laneAvailable && this.steeringReleaseTime === 0,
      laneKeepAssist,
      laneDeparture,
      fcw,
      fcwLevel,
      aeb,
      adasBrakeForce: Math.max(appliedAebForce, isaBrakeForce, cruiseActive && input.throttle === 0 && input.brake === 0 ? clamp(-accel / ego.maxDecel, 0, 1) : 0),
      rctaActive: false,
      rctaArmed: false,
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
      setSpeed,
      tsrLimitKph,
      tsrNew,
      trafficLight,
      trafficLightDistance,
      redLightWarning,
      alc: alcActive ? "active" : alcBlocked ? "blocked" : indicator !== 0 && this.config.alc && !alcUnavailable && laneAvailable && !steeringOverride && indicator !== this.alcCancelledSignal ? "armed" : "off",
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
      if (indicator === 0 || indicator !== this.alcRequestedDir) {
        // Driver cancelled the manoeuvre.
        this.alcTargetLane = null;
        this.alcRequestedDir = 0;
        this.alcArmTimer = 0;
        this.alcAborted = true;
        this.alcReason = indicator === 0 ? "Người lái tắt xi-nhan" : "Người lái đổi hướng xi-nhan";
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
    this.steeringReleaseTime = 0;
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
    this.steeringReleaseTime = 0;
    this.normalAccel = 0;
    this.yellowDecision = null;
    this.laneTarget = null;
    this.confirmedSignal = null;
    this.lastTsr = null;
    this.status = emptyStatus();
  }
}

function emptyStatus(): ADASStatus {
  return {
    extra: emptyAssistanceStatus(),
    availabilityReason: '', signalConfirmationRequired: false, speedWarning: false,
    highwayAssistActive: false, trafficJamAssistActive: false,
    active: false,
    engaged: false,
    accActive: false,
    accHolding: false,
    desiredGap: 3, timeGap: 1.6, trafficLightStopping: false, brakeReason: "none", curveSpeedLimited: false, laneSupportLimited: false,
    accState: "off", sensorsAvailable: true, laneAvailable: true, takeoverRequired: false, aebHolding: false,
    laneCenteringActive: false,
    laneKeepAssist: false,
    laneDeparture: "none",
    fcw: false,
    fcwLevel: 0,
    aeb: false,
    adasBrakeForce: 0,
    rctaActive: false,
    rctaArmed: false,
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
