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
import { assistanceAvailability, ASSISTANCE_REFERENCE, AvailabilityFrame } from './AssistancePolicy.ts';
import {
  AEBAvailability,
  AEBCalibration,
  AEBDecisionOutput,
  AEBState,
  AEBStateMachine,
  AEBStateMachineSnapshot,
  BrakeArbiter,
  BrakeArbiterSource,
  CollisionPredictor,
  DEFAULT_AEB_CALIBRATION,
  PerceptionMode,
  TargetRisk,
  assessAEBAvailability,
} from "./AEB.ts";

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
  shoulderLaneChange:boolean;
  curveSpeedAssist: boolean;
  emergencyShoulderStop: boolean;
  /** Optional explicit road-friction estimate override for controller [0.2..1.1];
   *  null uses weather/wiper prior + online ABS slip adaptation (never ground-truth cheat). */
  estimatedMu?: number | null;
  /** Detailed AEB calibration & override policy parameters. */
  aebCalibration?: Partial<AEBCalibration>;
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
  laneSupportLimitCause?: 'curve' | 'lateral-grip' | null;
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
  /** Explicit AEB state machine state. */
  aebState?: AEBState;
  /** Independent AEB availability status. */
  aebAvailability?: AEBAvailability;
  /** Explicit reason when AEB is degraded or unavailable. */
  aebAvailabilityReason?: string;
  /** Selected critical target ID for AEB/FCW, if any. */
  aebTargetId?: number | null;
  /** Remaining Time-To-Brake margin (s) before full braking limit, if valid. */
  aebTtb?: number | null;
  /** Minimum predicted 2D corridor gap under full braking (m), if valid. */
  aebMinGap?: number | null;
  /** Winning longitudinal brake arbiter source. */
  arbiterSource?: BrakeArbiterSource;
  /** Active perception input mode ("sensor" vs "ground-truth-debug"). */
  perceptionMode?: PerceptionMode;
}

export interface DriverInput {
  steer: number; // -1 left, +1 right
  throttle: number; // [0, 1]
  brake: number; // [0, 1]
  /** Raw driver intent before speed-dependent keyboard steering limits. */
  steeringOverride?: boolean;
  /** True while the driver holds the vehicle horn. */
  horn?: boolean;
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
  /** Controller prior for road friction (e.g. from weather/wipers), kept distinct from true world `ego.surfaceMu`. */
  estimatedMu?: number;
  /** True when obstacles come from sensor/tracker pipeline; false in explicit ground-truth debug mode. */
  usePerception?: boolean;
  /** Current simulation clock (s). */
  simTime?: number;
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
  isaMode: 'limit', signalMode: 'standard', alcHighwayOnly: false, shoulderLaneChange:true, curveSpeedAssist: true, emergencyShoulderStop: true,
};

/** Headway notches offered by the UI, in seconds. */
export const ADAS_GAP_NOTCHES = [1.0, 1.3, 1.6, 2.0, 2.5, 3.0] as const;

/** Controller memory is separate from the cluster's display status. Replay
 * must preserve both, especially driver cancellation and emergency brake hold. */
export interface ADASRuntimeState {
  config: ADASConfig;
  aebLatched: boolean;
  aebStateSnapshot?: AEBStateMachineSnapshot;
  adaptedMu?: number | null;
  alcTargetLane: number | null;
  alcTimer: number;
  /** Distance-aware progress; absent in legacy time-only recordings. */
  alcProgress?: number;
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
  isaDecel?: number;
  cruiseWasActive?: boolean;
  cruisePedalOverride?:boolean;
  yellowDecision: { id: number; stop: boolean } | null;
  laneTarget: number | null;
  confirmedSignal?: number | null;
}

export class ADASController {
  readonly config: ADASConfig = { ...DEFAULT_ADAS_CONFIG };
  status: ADASStatus = emptyStatus();
  readonly predictor = new CollisionPredictor();
  readonly aebStateMachine = new AEBStateMachine();
  readonly brakeArbiter = new BrakeArbiter();
  lastAebDecision: AEBDecisionOutput | null = null;
  lastAebRisk: TargetRisk | null = null;
  lastAccDecelReq = 0;
  lastNonAebDecelReq = 0;
  lastDriverDecelReq = 0;
  private aebLatched = false;
  private adaptedMu: number | null = null;
  private brakingSaturationTimer = 0;
  private alcTargetLane: number | null = null;
  private alcTimer = 0;
  private alcProgress = 0;
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
  private isaDecel = 0;
  private cruiseWasActive = false;
  private cruisePedalOverride=false;
  private yellowDecision: { id: number; stop: boolean } | null = null;
  private laneTarget: number | null = null;
  private confirmedSignal: number | null = null;
  private vehicleProfileOverrides: Partial<AEBCalibration> = {};

  constructor(initialConfig: Partial<ADASConfig> = {}) {
    Object.assign(this.config, initialConfig);
  }

  setVehicleProfileOverrides(overrides: Partial<AEBCalibration> = {}): void {
    this.vehicleProfileOverrides = { ...overrides };
  }

  resolvedCalibration(): AEBCalibration {
    const custom = this.config.aebCalibration;
    const veh = this.vehicleProfileOverrides;
    if (!custom && Object.keys(veh).length === 0) return DEFAULT_AEB_CALIBRATION;
    return {
      ...DEFAULT_AEB_CALIBRATION,
      ...veh,
      ...(custom ?? {}),
      overridePolicy: {
        ...DEFAULT_AEB_CALIBRATION.overridePolicy,
        ...(veh.overridePolicy ?? {}),
        ...(custom?.overridePolicy ?? {}),
      },
    };
  }

  private resolveEstimatedMu(frame: ADASFrame): number {
    if (typeof this.config.estimatedMu === "number" && Number.isFinite(this.config.estimatedMu)) {
      return clamp(this.config.estimatedMu, 0.2, 1.1);
    }
    const prior = clamp(frame.estimatedMu ?? frame.ego.surfaceMu, 0.2, 1.1);
    const ego = frame.ego;
    const prevBrakeReq = Math.max(this.lastDriverDecelReq, this.lastAebDecision?.decelDemand ?? 0);
    if (prevBrakeReq > 2.2 && ego.v > 1.2 && ego.a < -0.5) {
      this.brakingSaturationTimer += Math.max(0, frame.dt);
      if (this.brakingSaturationTimer >= 0.22) {
        const gradeEst = 9.81 * Math.sin(ego.roadGrade);
        const achievedTireDecel = Math.max(0.5, -ego.a - gradeEst);
        const capAtPrior = ego.enableWheelSlipDynamics
          ? Math.min(ego.maxDecel, 9.81 * prior)
          : ego.maxDecel * prior;
        const expectedDecel = Math.min(prevBrakeReq, capAtPrior);
        if (achievedTireDecel < expectedDecel * 0.88 || ego.wheelAbsActive) {
          const measuredMu = ego.wheelAbsActive
            ? clamp(achievedTireDecel / (9.81 * 0.94), 0.2, prior)
            : clamp(achievedTireDecel / Math.max(ego.maxDecel, 1), 0.2, prior);
          this.adaptedMu = this.adaptedMu === null ? measuredMu : this.adaptedMu + (measuredMu - this.adaptedMu) * 0.35;
        }
      }
    } else {
      this.brakingSaturationTimer = 0;
      if (this.adaptedMu !== null && this.adaptedMu > prior) {
        this.adaptedMu = prior;
      }
    }
    return this.adaptedMu !== null ? Math.min(prior, this.adaptedMu) : prior;
  }

  resetFrictionAdaptation(): void {
    this.adaptedMu = null;
    this.brakingSaturationTimer = 0;
  }

  getSetSpeed(fallback: number): number { return this.cruiseSetSpeed ?? fallback; }
  get laneChangeInProgress():boolean { return this.alcTargetLane!==null; }
  setCruiseSpeedKph(kph: number): void {
    if (Number.isFinite(kph)) this.cruiseSetSpeed = clamp(kph, ASSISTANCE_REFERENCE.accMinSetKph, ASSISTANCE_REFERENCE.accMaxKph) / 3.6;
  }

  cancelCruise(): void { this.cruiseCancelled = true; }
  setLaneTarget(lane: number): void { this.laneTarget = lane; }
  releaseAebLatch(): void {
    this.aebLatched = false;
    this.aebStateMachine.releaseLatch();
    this.status.aeb = false;
    this.status.aebHolding = false;
    this.status.aebState = this.aebStateMachine.state;
  }
  releaseLaneOwnership():void { this.laneTarget=null;this.alcTargetLane=null;this.alcRequestedDir=0;this.alcArmTimer=0;this.alcProgress=0; }
  resumeCruise(): void { this.cruiseCancelled = false; this.cruiseHoldTime = 0; }

  captureState(): ADASRuntimeState {
    return {
      config: { ...this.config }, aebLatched: this.aebLatched,
      aebStateSnapshot: this.aebStateMachine.captureState(),
      adaptedMu: this.adaptedMu,
      alcTargetLane: this.alcTargetLane, alcTimer: this.alcTimer, alcProgress:this.alcProgress, alcComplete: this.alcComplete,
      alcArmTimer: this.alcArmTimer, alcRequestedDir: this.alcRequestedDir,
      alcBlocked: this.alcBlocked, alcAborted: this.alcAborted, alcStartD: this.alcStartD,
      lastTsr: this.lastTsr, cruiseCancelled: this.cruiseCancelled, cruiseHoldTime: this.cruiseHoldTime,
      alcCancelledSignal: this.alcCancelledSignal, alcReason: this.alcReason,
      steeringReleaseTime: this.steeringReleaseTime, cruiseSetSpeed: this.cruiseSetSpeed,
      normalAccel: this.normalAccel, isaDecel: this.isaDecel, cruiseWasActive: this.cruiseWasActive,
      yellowDecision: this.yellowDecision ? { ...this.yellowDecision } : null,
      cruisePedalOverride:this.cruisePedalOverride,
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
      this.cruiseWasActive = status.accActive;
      this.cruiseHoldTime = status.accState === 'resume-required' ? 3 : 0;
      this.cruiseSetSpeed = status.setSpeed > 0 ? status.setSpeed : null;
      this.aebLatched = status.aeb || status.aebHolding;
      this.aebStateMachine.restoreState(undefined, status.aeb || status.aebHolding);
      if (status.timeGap > 0) this.config.timeGap = status.timeGap;
      return;
    }
    for (const key of Object.keys(DEFAULT_ADAS_CONFIG) as (keyof ADASConfig)[]) {
      if (key === "estimatedMu" || key === "aebCalibration") continue;
      const value = state.config[key];
      if (typeof value === typeof DEFAULT_ADAS_CONFIG[key] && (typeof value !== 'number' || Number.isFinite(value))) {
        (this.config as unknown as Record<string, unknown>)[key] = value;
      }
    }
    if (state.config.estimatedMu !== undefined) this.config.estimatedMu = state.config.estimatedMu;
    if (state.config.aebCalibration !== undefined) this.config.aebCalibration = { ...state.config.aebCalibration };
    this.aebLatched = state.aebLatched;
    this.aebStateMachine.restoreState(state.aebStateSnapshot, state.aebLatched);
    this.adaptedMu = state.adaptedMu ?? null;
    this.alcTargetLane = state.alcTargetLane;
    this.alcTimer = state.alcTimer;
    this.alcProgress = state.alcProgress ?? state.alcTimer / ASSISTANCE_REFERENCE.alcNominalSeconds;
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
    this.isaDecel = state.isaDecel ?? 0;
    this.cruiseWasActive = state.cruiseWasActive ?? false;
    this.cruisePedalOverride=state.cruisePedalOverride??false;
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
    const muEst = this.resolveEstimatedMu(frame);
    const calibration = this.resolvedCalibration();
    const perceptionMode: PerceptionMode = (frame.usePerception ?? true) ? "sensor" : "ground-truth-debug";

    if (input.brake > 0 || !availability.cruise) this.cancelCruise();
    let cruiseActive = this.config.acc && !this.cruiseCancelled && availability.cruise;
    const brakingHorizon = Math.max(
      80,
      (ego.v * ego.v) / (2 * Math.max(ego.maxDecel * 0.8, 1)) + ego.v * 0.25 + 10,
    );
    let lead: { obstacle: Obstacle; gap: number; ahead: number; id: number } | null = null;
    let blindSpotLeft = false;
    let blindSpotRight = false;
    let parkingFront: number | null = null;

    // Canonical obstacle ordering for ACC lead / BSM / USS so every output is array-order invariant.
    const orderedObstacles = [...obstacles].sort((a, b) =>
      ((a.id ?? Infinity) - (b.id ?? Infinity)) ||
      (a.s - b.s) ||
      (a.d - b.d) ||
      (a.v - b.v),
    );

    const inForwardCarriageway = (o: Obstacle) =>
      o.kind === "ped" ||
      (o.v >= -1.0 && o.d >= road.forwardLeftEdge - 0.5 && o.d <= road.forwardRightEdge + road.shoulderWidth + 0.5);

    for (const obstacle of orderedObstacles) {
      const ds = wrapDiff(obstacle.s, egoS, path.length);
      const dd = obstacle.d - egoD;
      const gap = ds - (ego.dims.length + obstacle.length) / 2;
      const rawLateralReach = (ego.dims.width + obstacle.width) / 2 + 0.25;
      const confirmedTrack = obstacle.confirmed !== false;
      const inAccCorridor = confirmedTrack && !obstacle.roadBoundary && inForwardCarriageway(obstacle) && Math.abs(dd) <= rawLateralReach;

      if (sensorsAvailable && ds > 0 && ds <= brakingHorizon && inAccCorridor) {
        const obsId = obstacle.id ?? Infinity;
        if (!lead || ds < lead.ahead - 1e-6 || (Math.abs(ds - lead.ahead) <= 1e-6 && obsId < lead.id)) {
          lead = { obstacle, gap, ahead: ds, id: obsId };
        }
      }

      // Positive d is the driver's right in the rendered road convention.
      // Exclude oncoming traffic in opposing lanes and parked/receding objects far behind.
      const rearClosing = obstacle.v - ego.v;
      const rearApproach = ds < 0 && rearClosing > .5 && (-ds - (ego.dims.length + obstacle.length) / 2) / rearClosing < 4.5;
      const inSameDirectionCorridor = obstacle.v >= -0.5 && obstacle.d >= road.forwardLeftEdge - 0.5 && obstacle.d <= road.forwardRightEdge + road.shoulderWidth + 0.5;
      const recedingBehind = ds < -4 && ds + obstacle.length / 2 < -ego.dims.length / 2 && ego.v - obstacle.v > 6;
      const wasActiveSide = dd > 0 ? this.status.blindSpotRight : this.status.blindSpotLeft;
      const bsmMaxDs = wasActiveSide ? 4.2 : 3.0;
      const bsmMinDs = wasActiveSide ? -9.5 : -8.0;
      // A bus/trailer can have its centre outside the radar's calibrated
      // centre window while its body still occupies the space beside us.
      const alongside = Math.abs(ds) < (ego.dims.length + obstacle.length) / 2 + .5;
      const inBlindSpot = alongside || ((ds >= bsmMinDs || rearApproach) && ds <= bsmMaxDs);
      if (confirmedTrack && !obstacle.roadBoundary && inSameDirectionCorridor && !recedingBehind && availability.sensors.rearRadar && this.config.bsm && ds >= -100 && inBlindSpot) {
        const lateral = Math.abs(dd);
        const nearSide = (ego.dims.width + obstacle.width) / 2 + (wasActiveSide ? 0.05 : 0.15);
        const outerEdge = nearSide + laneWidth * (wasActiveSide ? 0.92 : 0.78);
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

    // Preliminary lateral state for 2D ego trajectory prediction in CollisionPredictor.
    const onShoulder = road.shoulderWidth > 0 && egoD > road.forwardRightEdge && egoD + ego.dims.width / 2 <= road.pavedHalfWidth + .05;
    const currentLane = onShoulder ? road.numLanes : road.laneOf(egoD);
    const steeringOverride = input.steeringOverride ?? Math.abs(input.steer) > .05;
    const inCarriageway = egoD >= road.forwardLeftEdge - .1 && egoD <= road.forwardRightEdge + .1;
    const prelimCenterLane = this.alcTargetLane ?? this.laneTarget ?? currentLane;
    const prelimTargetLaneD = this.laneCenter(road, prelimCenterLane);
    const prelimLaneAssist = (inCarriageway || onShoulder && (this.alcTargetLane !== null || this.config.shoulderLaneChange)) &&
      laneAvailable && !steeringOverride && this.steeringReleaseTime === 0 && (this.config.laneCentering || this.alcTargetLane !== null);
    const manualSteer = clamp(input.steer, -1, 1) * ego.maxSteer;
    const predictedSteerCmd = prelimLaneAssist
      ? ego.delta
      : (Math.abs(manualSteer) > 1e-4 || steeringOverride ? manualSteer : ego.delta);

    // ---- modular collision prediction & AEB state machine -----------------
    const hasCoastingTarget = orderedObstacles.some((o) => (o.coastingSec ?? 0) > 0.02);
    const aebAvail = assessAEBAvailability(this.config.aeb, frame, hasCoastingTarget);
    const evalAvail = !this.config.aeb && this.config.fcw
      ? assessAEBAvailability(true, frame, hasCoastingTarget)
      : aebAvail;
    const prefillReady =
      this.aebStateMachine.state === "WARN" ||
      this.aebStateMachine.state === "PARTIAL" ||
      this.aebStateMachine.state === "EMERGENCY";

    const pred = evalAvail.availability !== "unavailable"
      ? this.predictor.evaluate({
          ego,
          egoS,
          egoD,
          path,
          road,
          obstacles: orderedObstacles,
          steerCmd: predictedSteerCmd,
          driverSteerInput: input.steer,
          driverThrottle: input.throttle,
          driverBrake: input.brake,
          laneAssistActive: prelimLaneAssist,
          targetLaneD: prelimTargetLaneD,
          estimatedMu: muEst,
          prefillReady,
          availability: evalAvail,
          calibration,
          indicator,
        })
      : { risks: [] as TargetRisk[], critical: null, estimatedBrakeCap: ego.maxDecel * muEst };

    const wasHoldingBeforeStep = this.aebStateMachine.state === "HOLD";
    const aebOut = this.aebStateMachine.step({
      ego,
      risks: pred.risks,
      critical: pred.critical,
      availability: aebAvail,
      driverThrottle: input.throttle,
      driverBrake: input.brake,
      driverSteer: input.steer,
      steeringOverride,
      usePerception: frame.usePerception ?? true,
      calibration,
      dt,
    });
    this.lastAebDecision = aebOut;
    this.lastAebRisk = aebOut.targetRisk ?? pred.critical;

    // FCW warning (remains operational when FCW=true even if AEB=false).
    let fcw = false;
    let fcwLevel: 0 | 1 | 2 = 0;
    if (this.config.fcw) {
      if (this.config.aeb) {
        fcw = aebOut.fcw;
        fcwLevel = aebOut.fcwLevel;
      } else if (pred.critical && pred.critical.hasCollisionCourse) {
        const fcwHyst = this.status.fcw ? 0.55 : 0;
        if (pred.critical.ttb <= 0.7 || pred.critical.tti <= 1.6) {
          fcw = true;
          fcwLevel = 2;
        } else if (pred.critical.ttb <= calibration.warnTtbSec + fcwHyst || pred.critical.tti <= calibration.warnTtiSec + fcwHyst) {
          fcw = true;
          fcwLevel = 1;
        }
      }
    }

    if (
      aebOut.state === "EMERGENCY" ||
      (aebOut.holdActive && !wasHoldingBeforeStep) ||
      (aebOut.aebActive && (ego.v < 2.0 || input.brake > 0 || (aebOut.targetRisk && aebOut.targetRisk.obstacle.v < 0.8)))
    ) {
      this.cancelCruise();
      cruiseActive = false;
    } else if (aebOut.holdActive) {
      cruiseActive = false;
    }

    const driverDecelNominal = clamp(input.brake, 0, 1) * ego.maxDecel;
    const aebHolding = aebOut.holdActive;
    const aeb = aebOut.aebActive && (input.brake <= 0 || aebOut.decelDemand > driverDecelNominal + 0.05);
    this.aebLatched = aeb || aebHolding;
    const aebCause = aebHolding ? "Đang giữ dừng trước vật cản" : aebOut.cause;

    // ---- traffic-sign recognition / intelligent speed assist --------------
    // Passing a sign does not end its restriction. Retain the recognised limit
    // until a replacement sign, explicit TSR disable, or session reset. Camera
    // loss suspends the output without erasing the last recognised sign.
    if (!this.config.tsr) this.lastTsr = null;
    const tsrLimitKph = this.config.tsr && availability.sensors.camera ? frame.speedLimitKph ?? this.lastTsr : null;
    const tsrNew = tsrLimitKph !== null && tsrLimitKph !== this.lastTsr;
    if (tsrLimitKph !== null) this.lastTsr = tsrLimitKph;
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
    const comfortDecel = Math.min(2.8, ego.maxDecel * muEst * .55);
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
    if (input.throttle > 0.05 && (!accHolding || !lead || lead.gap > this.config.standstillGap * 0.5)) {
      this.cruiseHoldTime = 0;
      accHolding = false;
    }
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
      const cap = Math.sqrt(2 * comfortDecel * Math.max(0, stopDistance - ego.v * .8));
      targetSpeed = Math.min(targetSpeed, cap);
      if (stopDistance < .8) targetSpeed = 0;
    }

    const roadCurvature = path.signedCurvatureAt(egoS);
    const laneCurvature = roadCurvature / Math.max(.25, 1 - roadCurvature * egoD);
    const corneringBudget = 3.5 * clamp(muEst, .35, 1);
    let curveGripLimited = ego.v ** 2 * Math.abs(laneCurvature) > 9.81 * clamp(muEst, .35, 1) * .85;
    if(laneAvailable&&this.config.laneCentering){
      for(let distance=4;distance<=Math.max(8,ego.v*1.5);distance+=4){
        const k=path.signedCurvatureAt(egoS+distance);
        const laneK=Math.abs(k/Math.max(.25,1-k*egoD));
        if(ego.v**2*laneK>9.81*clamp(muEst,.35,1)*.85)curveGripLimited=true;
      }
    }
    const laneSupportLimited=laneAvailable && this.config.laneCentering && (curveGripLimited||ego.tractionLimited);
    const laneSupportLimitCause=laneSupportLimited?curveGripLimited?'curve':'lateral-grip':null;
    let curveSpeedLimited = false;
    let curveBrakeDemand = 0;
    let curveCap = Infinity;
    const csaEnabled = this.config.acc && laneAvailable && this.config.curveSpeedAssist && availability.cruise;
    if (csaEnabled) {
      const effectiveCornerBudget = (this.alcTargetLane !== null || indicator !== 0) ? corneringBudget * 0.85 : corneringBudget;
      const preview = Math.max(85, ego.v ** 2 / (2 * comfortDecel) + ego.v * 1.55);
      for (let distance = 0; distance <= preview; distance += 2) {
        const k = path.signedCurvatureAt(egoS + distance);
        const laneK = Math.abs(k / Math.max(.25, 1 - k * egoD));
        if (laneK < 1e-5) continue;
        const curveV2 = effectiveCornerBudget / laneK;
        const brakingDistance = Math.max(0, distance - ego.v * 1.48);
        curveCap = Math.min(curveCap, Math.sqrt(curveV2 + 2 * comfortDecel * brakingDistance));
        const overspeedFloor = curveV2 + Math.max(1.1, 0.07 * curveV2);
        if (distance > 0 && ego.v ** 2 > overspeedFloor) {
          const available = Math.max(3.5, distance - ego.v * .38);
          curveBrakeDemand = Math.max(curveBrakeDemand, (ego.v ** 2 - curveV2) / (2 * available));
        }
      }
      if (cruiseActive) {
        curveSpeedLimited = curveCap < targetSpeed - .1;
        targetSpeed = Math.min(targetSpeed, curveCap);
      } else if (input.brake === 0 && (curveBrakeDemand > comfortDecel || (input.throttle > 0 && ego.v > curveCap - 0.15))) {
        curveSpeedLimited = true;
        targetSpeed = Math.min(speedCap, curveCap);
      }
    }

    // ---- assisted lane change --------------------------------------------
    const laneOffset = egoD - this.laneCenter(road,currentLane);
    this.alcComplete = false;
    this.alcAborted = false;
    const alcInProgress = this.alcTargetLane !== null;
    const alcUnavailable = !availability.cruise ? availability.cruiseReason : !laneAvailable ? 'Không nhận diện được làn' :
      !inCarriageway && !(onShoulder&&(this.config.shoulderLaneChange||indicator<0)) ? onShoulder?'Từ làn khẩn cấp: bật xi-nhan trái để nhập lại làn chạy':'Xe cần nằm trong phần đường cùng chiều để yêu cầu ALC' :
      !this.config.laneCentering ? 'Cần bật giữ giữa làn LFA' : !this.config.acc ? 'Cần ACC hoạt động' :
      !availability.sensors.rearRadar ? 'Radar sau không sẵn sàng' : !availability.conditions.handsOn ? 'Cần đặt tay lên vô-lăng' :
      availability.conditions.hazards ? 'Đèn khẩn cấp đang bật' :
      this.config.alcHighwayOnly && !(frame.conditions?.motorway ?? road.profile?.motorway) ? 'ALC chỉ hỗ trợ trên cao tốc trong cấu hình này' :
      fcw ? 'Đang có cảnh báo va chạm phía trước' :
      frame.trafficLight && ((!alcInProgress && frame.trafficLight.distance < Math.max(60, ego.v * 3.2)) || (trafficLightStopping && frame.trafficLight.distance < 22)) ? 'Đang đến giao lộ có đèn tín hiệu' :
      orderedObstacles.some(o => o.kind === 'ped' && wrapDiff(o.s, egoS, path.length) > 0 && wrapDiff(o.s, egoS, path.length) < (alcInProgress ? 32 : 70) &&
        Math.abs(o.d - road.forwardOffset) < road.numLanes * road.laneWidth / 2) ? 'Có người đi bộ trên phần đường phía trước' : '';
    this.steeringReleaseTime = steeringOverride ? 0.18 : Math.max(0, this.steeringReleaseTime - dt);
    if (!laneAvailable || !this.config.laneCentering || steeringOverride) this.laneTarget = null;
    if (laneAvailable && this.config.laneCentering && this.steeringReleaseTime === 0 && this.laneTarget === null) this.laneTarget = currentLane;
    if (!indicator) this.alcCancelledSignal = 0;
    if (steeringOverride || !laneAvailable || input.brake > .02 || alcUnavailable) {
      const wasActive=this.alcTargetLane!==null;
      if (wasActive) this.alcAborted = true;
      if(wasActive&&!steeringOverride&&laneAvailable&&this.config.laneCentering)this.laneTarget=currentLane;
      this.alcTargetLane = null;
      this.alcBlocked = !!indicator && this.config.alc;
      if(wasActive || steeringOverride || input.brake>.02)this.alcCancelledSignal=indicator;
      this.alcArmTimer=0;this.alcRequestedDir=0;
      this.alcReason = steeringOverride ? "Người lái tiếp quản" : input.brake > .02 ? 'Người lái phanh' : alcUnavailable;
    } else if(indicator!==0 && indicator===this.alcCancelledSignal){
      this.alcBlocked=this.config.alc;
      this.alcReason='Yêu cầu đã hủy · tắt rồi bật lại xi-nhan để chuyển làn';
    } else {
      this.stepLaneChange(indicator, ego, egoS, egoD, onShoulder?road.numLanes:currentLane, path, road, orderedObstacles, dt);
    }
    const alcActive = this.alcTargetLane !== null;
    const alcBlocked = !alcActive && indicator !== 0 && this.config.alc && this.alcBlocked;
    if (this.alcComplete) this.laneTarget = currentLane;
    const centerLane = alcActive ? this.alcTargetLane! : this.laneTarget ?? currentLane;

    // ---- steering: manual torque + lane assist ---------------------------
    // Note: AEB NEVER modifies steering (`steer` is strictly lateral LFA/LKA/ALC + manual).
    let steer = manualSteer;
    let laneKeepAssist = false;
    const outward = ego.v * Math.sin(wrapAngle(ego.yaw - path.cartesianAt(egoS).heading));
    const laneMargin = laneWidth / 2 - ego.dims.width / 2;
    const departureImminent = Math.abs(laneOffset + outward * .5) > laneMargin - .12 && laneOffset * outward > 0;
    const departureAssist = this.config.laneKeeping && ego.v * 3.6 >= ASSISTANCE_REFERENCE.laneDepartureMinKph &&
      !indicator && departureImminent && !steeringOverride;
    const assistSteering = (inCarriageway||onShoulder&&(alcActive||this.config.shoulderLaneChange)) && laneAvailable && this.steeringReleaseTime === 0 && (this.config.laneCentering || alcActive || departureAssist);
    if (assistSteering) {
      const pathHeading = path.cartesianAt(egoS).heading;
      const laneChangePhase = clamp(this.alcProgress, 0, 1);
      const blend = laneChangePhase ** 3 * (10 - 15 * laneChangePhase + 6 * laneChangePhase ** 2);
      const centerD = alcActive ? this.alcStartD + (this.laneCenter(road,centerLane) - this.alcStartD) * blend : this.laneCenter(road,centerLane);
      const p=laneChangePhase, deltaD=alcActive?this.laneCenter(road,centerLane)-this.alcStartD:0;
      const progressPerMetre=Math.min(1/(ASSISTANCE_REFERENCE.alcNominalSeconds*Math.max(ego.v,.01)),1/ASSISTANCE_REFERENCE.alcMinPathMetres);
      const slope=deltaD*30*p*p*(1-p)**2*progressPerMetre;
      const lateralCurvature=deltaD*60*p*(1-p)*(1-2*p)*progressPerMetre**2/Math.pow(1+slope*slope,1.5);
      const steerLead = clamp(ego.v * 0.12, 0, 3.6);
      const leadRoadCurvature = steerLead > 0.2
        ? 0.65 * roadCurvature + 0.35 * path.signedCurvatureAt(egoS + steerLead)
        : roadCurvature;
      const targetCurvature = leadRoadCurvature / Math.max(.25, 1 - leadRoadCurvature * centerD);
      const feedForward = Math.atan(ego.dims.wheelbase * (targetCurvature+lateralCurvature));
      const headingErr = wrapAngle(pathHeading + Math.atan(slope) - ego.yaw);
      const frontCrossTrack = (egoD - centerD) + (ego.dims.wheelbase * 0.5) * Math.sin(-headingErr);
      const stanleyK = 2.2 + clamp((ego.v - 16) * 0.035, 0, 0.75) + (alcActive && p > 0.7 ? 0.45 : 0);
      const correction = clamp(feedForward + stanleyControl(
        headingErr,
        frontCrossTrack,
        ego.v,
        { k: stanleyK, kSoft: 1.4, maxSteer: ego.maxSteer },
      ), -ego.maxSteer, ego.maxSteer);
      laneKeepAssist = departureAssist && Math.abs(correction) > 0.008;
      steer = alcActive
        ? correction
        : clamp(manualSteer + correction, -ego.maxSteer, ego.maxSteer);
    }

    let laneDeparture: LaneDeparture = "none";
    if (this.config.lda && laneAvailable && ego.v * 3.6 >= ASSISTANCE_REFERENCE.laneDepartureMinKph && !alcActive && indicator !== Math.sign(laneOffset) && Math.abs(laneOffset) > laneMargin - .1) {
      laneDeparture = laneOffset > 0 ? "right" : "left";
    }

    // ---- longitudinal control & single-point BrakeArbiter ----------------
    let propulsionOrCoastAccel = 0;
    let accDecelReq = 0;
    const passiveCoast = -coastDeceleration(ego.v) - .07 - ego.extraCoastDecel;
    const csaIntervention = csaEnabled && input.brake === 0 &&
      (curveBrakeDemand > comfortDecel || (input.throttle > 0 && Number.isFinite(curveCap) && ego.v > curveCap - 0.25));
    if (cruiseActive) {
      if (!this.cruiseWasActive && Math.abs(ego.a) > 1e-4) {
        this.normalAccel = clamp(ego.a, -comfortDecel, Math.min(ego.maxAccel, 2));
      }
      if (input.throttle > 0 && !csaIntervention) {
        propulsionOrCoastAccel = input.throttle * ego.maxAccel;
        this.cruisePedalOverride = true;
      } else if (input.brake === 0) {
        // Comfort handback limiter applies ONLY to ACC, never to AEB!
        if (input.throttle === 0 && this.cruisePedalOverride) {
          this.normalAccel = ego.a;
          this.cruisePedalOverride = false;
        }
        // Soft-stop brake feathering near rest prevents a step jump in chassis
        // acceleration (and pitch rebound jerk) when v reaches 0.
        const stoppingToRest = targetSpeed < .05 && ego.v < .45;
        const gradeHold = Math.max(0, -9.81 * Math.sin(ego.roadGrade));
        const softStopTarget = -(Math.max(0.14, Math.min(0.85, ego.v * 2.1)) + gradeHold);
        const demand = stoppingToRest
          ? softStopTarget
          : clamp(frame.speedControl(targetSpeed - ego.v, dt), -comfortDecel, Math.min(ego.maxAccel, 2));
        const riseRate = stoppingToRest ? 3.6 : 1.8;
        this.normalAccel += clamp(demand - this.normalAccel, -2.5 * dt, riseRate * dt);
        if (aebOut.aebActive) {
          this.normalAccel = Math.min(this.normalAccel, clamp(ego.a, -comfortDecel, 0));
        }
        let accCmd = this.normalAccel;
        if (targetSpeed < .05 && ego.v <= 1e-6) {
          accCmd = Math.min(accCmd, -0.8);
        }
        if (curveBrakeDemand > comfortDecel) {
          const curveDemand = Math.min(curveBrakeDemand, ego.maxDecel * muEst * .9);
          const urgentRate = curveDemand > comfortDecel * 1.35 ? 28 : 8.5;
          this.normalAccel += clamp(-curveDemand - this.normalAccel, -urgentRate * dt, 2.5 * dt);
          accCmd = Math.min(accCmd, this.normalAccel);
          curveSpeedLimited = true;
        }
        if (accCmd < 0) accDecelReq = -accCmd;
        else propulsionOrCoastAccel = accCmd;
      }
      this.cruiseWasActive = true;
    } else {
      this.cruisePedalOverride = false;
      if (csaIntervention) {
        curveSpeedLimited = true;
        const capDemand = clamp(frame.speedControl(curveCap - ego.v, dt), -comfortDecel, Math.min(Math.max(input.throttle * ego.maxAccel, 0), 2));
        this.normalAccel += clamp(capDemand - this.normalAccel, -2.5 * dt, 1.8 * dt);
        let csaCmd = this.normalAccel;
        if (curveBrakeDemand > comfortDecel) {
          const curveDemand = Math.min(curveBrakeDemand, ego.maxDecel * muEst * .9);
          const urgentRate = curveDemand > comfortDecel * 1.35 ? 28 : 8.5;
          this.normalAccel += clamp(-curveDemand - this.normalAccel, -urgentRate * dt, 2.5 * dt);
          csaCmd = Math.min(csaCmd, this.normalAccel);
        }
        if (csaCmd < 0) {
          accDecelReq = -csaCmd;
          propulsionOrCoastAccel = input.throttle > 0 ? 0 : passiveCoast;
        } else {
          propulsionOrCoastAccel = input.throttle > 0 ? Math.min(input.throttle * ego.maxAccel, csaCmd) : passiveCoast;
        }
      } else if (input.throttle > 0) {
        this.normalAccel = 0;
        this.cruiseWasActive = false;
        propulsionOrCoastAccel = input.throttle * ego.maxAccel;
      } else if (input.brake > 0 || aebOut.aebActive || aebOut.holdActive || !this.cruiseWasActive) {
        this.normalAccel = 0;
        this.cruiseWasActive = false;
        propulsionOrCoastAccel = passiveCoast;
      } else {
        // Smooth transition from ACC propulsion into passive/EV-regen coasting on manual cancel.
        this.normalAccel += clamp(passiveCoast - this.normalAccel, -3.5 * dt, 3.5 * dt);
        if (Math.abs(this.normalAccel - passiveCoast) < 0.02) {
          this.normalAccel = 0;
          this.cruiseWasActive = false;
          propulsionOrCoastAccel = passiveCoast;
        } else if (this.normalAccel < 0) {
          accDecelReq = -this.normalAccel;
          propulsionOrCoastAccel = passiveCoast;
        } else {
          propulsionOrCoastAccel = this.normalAccel;
        }
      }
    }

    // Limiting is primarily a smooth propulsion cap. Braking alone starts
    // only after overspeed, creating a throttle/brake sawtooth at the boundary.
    if (isaLimiting && tsrLimitKph !== null && !isaOverride && input.brake === 0 && propulsionOrCoastAccel > 0) {
      propulsionOrCoastAccel = Math.min(propulsionOrCoastAccel, Math.max(0, (signCapMps - ego.v) * 1.4));
    }
    let isaDecelReq = 0;
    if (isaLimiting && tsrLimitKph !== null && !isaOverride && ego.v >= signCapMps && input.brake === 0) {
      const rawIsaDecel = clamp((ego.v - signCapMps) * 1.4, 0, 2.5);
      this.isaDecel = rawIsaDecel > 0
        ? Math.min(rawIsaDecel, Math.max(0.25, this.isaDecel + 3.0 * dt))
        : 0;
      isaDecelReq = this.isaDecel;
    } else if (isaOverride || input.brake > 0 || !isaLimiting) {
      this.isaDecel = 0;
    } else if (this.isaDecel > 0) {
      this.isaDecel = Math.max(0, this.isaDecel - 3.0 * dt);
      isaDecelReq = this.isaDecel;
    }

    const arbitrated = this.brakeArbiter.resolve({
      maxDecel: ego.maxDecel,
      maxAccel: ego.maxAccel,
      propulsionOrCoastAccel,
      driverBrakePedal: input.brake,
      accDecelReq,
      isaDecelReq,
      aeb: aebOut,
      overrideActive: aebOut.reasonCode.startsWith("driver-"),
    });
    this.lastAccDecelReq = accDecelReq;
    this.lastNonAebDecelReq = Math.max(accDecelReq, isaDecelReq);
    this.lastDriverDecelReq = arbitrated.driverDecelReq;
    const accel = arbitrated.finalAccelCmd;

    const headway = lead && ego.v > .3 ? lead.gap / ego.v : null;
    const brakeReason: ADASStatus["brakeReason"] =
      arbitrated.source === "driver" ? "driver" :
      arbitrated.source === "aeb-hold" ? "aeb-hold" :
      arbitrated.source === "aeb-emergency" || arbitrated.source === "aeb-partial" || arbitrated.source === "aeb-brake-assist" ? "aeb" :
      arbitrated.source === "isa" ? "isa" :
      arbitrated.source === "acc" && accel < -.05
        ? (trafficLightStopping ? "signal" : curveSpeedLimited ? "curve" : lead && targetSpeed < speedCap - .1 ? "acc-gap" : "acc-speed")
        : "none";

    const activeRisk = aebOut.targetRisk ?? pred.critical;
    this.status = {
      extra: emptyAssistanceStatus(),
      availabilityReason: availability.cruiseReason, signalConfirmationRequired, speedWarning,
      highwayAssistActive: cruiseActive && laneAvailable && this.config.laneCentering && availability.conditions.motorway,
      trafficJamAssistActive: cruiseActive && laneAvailable && this.config.laneCentering && ego.v < 40 / 3.6 && !!lead,
      active: true,
      engaged: true,
      accActive: cruiseActive,
      accHolding,
      desiredGap, timeGap: this.config.timeGap, trafficLightStopping, brakeReason, curveSpeedLimited, laneSupportLimited, laneSupportLimitCause,
      aebCause,
      aebState: aebOut.state,
      aebAvailability: aebAvail.availability,
      aebAvailabilityReason: aebAvail.reason,
      aebTargetId: aebOut.targetId,
      aebTtb: activeRisk && Number.isFinite(activeRisk.ttb) ? activeRisk.ttb : null,
      aebMinGap: activeRisk && Number.isFinite(activeRisk.minGapFull) ? activeRisk.minGapFull : null,
      arbiterSource: arbitrated.source,
      perceptionMode,
      accState: !this.config.acc ? "off" : !cruiseActive ? "cancelled" : this.cruiseHoldTime >= 3 ? "resume-required" : accHolding ? "hold" : "active",
      sensorsAvailable, laneAvailable, takeoverRequired: !sensorsAvailable || (!availability.conditions.escAvailable && this.config.aeb) || (this.config.laneCentering && !laneAvailable) || laneSupportLimited, aebHolding,
      laneCenteringActive: inCarriageway && this.config.laneCentering && laneAvailable && this.steeringReleaseTime === 0,
      laneKeepAssist,
      laneDeparture,
      fcw,
      fcwLevel,
      aeb,
      adasBrakeForce: arbitrated.adasBrakeForce,
      rctaActive: false,
      rctaArmed: false,
      rctaLeft: false,
      rctaRight: false,
      rearAeb: false,
      blindSpotLeft,
      blindSpotRight,
      leadGap: lead ? lead.gap : null,
      leadTtc:
        lead && lead.gap >= 0 && ego.v > lead.obstacle.v + 0.05 ? lead.gap / (ego.v - lead.obstacle.v) : null,
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
    if (!this.config.alc) {
      if(this.alcTargetLane!==null){this.laneTarget=currentLane;this.alcAborted=true;this.alcReason='Đã tắt hỗ trợ chuyển làn';}
      this.alcTargetLane = null;
      this.alcRequestedDir = 0;
      return;
    }

    if (this.alcTargetLane !== null) {
      if (indicator === 0 || indicator !== this.alcRequestedDir) {
        // Driver cancelled the manoeuvre.
        this.laneTarget=currentLane;
        this.alcTargetLane = null;
        this.alcRequestedDir = 0;
        this.alcArmTimer = 0;
        this.alcAborted = true;
        this.alcReason = indicator === 0 ? "Người lái tắt xi-nhan" : "Người lái đổi hướng xi-nhan";
        return;
      }
      this.alcTimer += dt;
      // Freeze progress while stopped. Moving-time budget scales with the
      // manoeuvre's geometry, so a legitimate crawl cannot time out at 9s.
      if(ego.v>.01)this.alcProgress+=dt*Math.min(1/ASSISTANCE_REFERENCE.alcNominalSeconds,ego.v/ASSISTANCE_REFERENCE.alcMinPathMetres);
      const targetD = this.laneCenter(road,this.alcTargetLane);
      if (!this.laneClear(ego, egoS, egoD, this.alcTargetLane, path, road, obstacles) || this.alcProgress > 2.5) {
        this.laneTarget=currentLane;
        this.alcTargetLane = null;
        this.alcBlocked = true;
        this.alcAborted = true;
        this.alcCancelledSignal = indicator;
        this.alcReason = this.alcProgress > 2.5 ? "Không bám được quỹ đạo chuyển làn" : "Khoảng trống phía trước/sau không còn an toàn";
        return;
      }
      this.alcReason=ego.v<=.01?'Xe đang dừng · tiếp tục chuyển làn khi xe di chuyển':'';
      if (this.alcProgress>=.9 && Math.abs(egoD - targetD) < 0.3 && Math.abs(wrapAngle(ego.yaw-path.cartesianAt(egoS).heading))<.08) {
        this.alcTargetLane = null;
        this.alcRequestedDir = 0;
        this.alcComplete = true;
      }
      return;
    }

    if (indicator === 0) {
      this.alcRequestedDir = 0;
      this.alcArmTimer = 0;
      this.alcReason = '';
      return;
    }
    if (indicator !== this.alcRequestedDir) {
      this.alcRequestedDir = indicator;
      this.alcArmTimer = 0;
    }
    // Brief arming delay: the signal must be on long enough for perception to
    // confirm (or clear) the target lane before the car commits to the move.
    this.alcReason='';
    if(ego.v<=.01){this.alcArmTimer=0;this.alcReason='Xe đang đứng yên · chờ xe di chuyển';return;}
    this.alcArmTimer += dt;
    if (this.alcArmTimer < 0.45) return;

    const target = currentLane + (indicator > 0 ? 1 : -1);
    if (target < 0 || target > road.numLanes || target===road.numLanes&&(!road.shoulderWidth||!this.config.shoulderLaneChange)) {
      this.alcBlocked = true;
      this.alcReason = "Không có làn bên cạnh";
      return;
    }
    if (!this.laneClear(ego, egoS, egoD, target, path, road, obstacles)) {
      this.alcBlocked = true;
      this.alcReason = "Xe trước/sau chưa đủ khoảng trống theo dự báo chuyển làn";
      return;
    }
    this.alcTargetLane = target;
    this.alcReason = "";
    this.steeringReleaseTime = 0;
    this.alcTimer = 0;
    this.alcProgress = 0;
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
    const targetD = this.laneCenter(road,targetLane);
    for (const o of obstacles) {
      const ds = wrapDiff(o.s, egoS, path.length);
      const clearance = (ego.dims.length + o.length) / 2;
      // Longer observation envelope at crawl speed; continuously reassessed.
      const horizon=Math.max(5,Math.min(12,ASSISTANCE_REFERENCE.alcMinPathMetres/Math.max(ego.v,.1)));
      for (let t = 0; t <= horizon; t += .2) {
        if (Math.abs(o.d + o.vd * t - targetD) > (o.width + ego.dims.width) / 2 + .45) continue;
        const predicted = ds + (o.v - ego.v) * t;
        const margin = predicted >= 0 ? Math.max(3, ego.v * .8) : Math.max(3, Math.max(o.v,0) * .8);
        if (Math.abs(predicted) - clearance < margin) return false;
      }
    }
    return true;
  }

  private laneCenter(road:Road,lane:number):number {return lane===road.numLanes&&road.shoulderWidth>0?road.shoulderCenter:road.laneCenter(lane);}

  clearStatus(): void {
    this.aebLatched = false;
    this.aebStateMachine.reset();
    this.lastAebDecision = null;
    this.lastAebRisk = null;
    this.lastAccDecelReq = 0;
    this.lastDriverDecelReq = 0;
    this.adaptedMu = null;
    this.brakingSaturationTimer = 0;
    this.alcTargetLane = null;
    this.alcBlocked = false;
    this.alcComplete = false;
    this.alcAborted = false;
    this.alcArmTimer = 0;
    this.alcProgress = 0;
    this.alcRequestedDir = 0;
    this.alcCancelledSignal = 0;
    this.alcReason = "";
    this.cruiseHoldTime = 0;
    this.steeringReleaseTime = 0;
    this.normalAccel = 0;
    this.isaDecel = 0;
    this.cruiseWasActive = false;
    this.cruisePedalOverride=false;
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
    aebState: "MONITOR", aebAvailability: "available", aebAvailabilityReason: "Sẵn sàng",
    aebTargetId: null, aebTtb: null, aebMinGap: null, arbiterSource: "none", perceptionMode: "sensor",
    active: false,
    engaged: false,
    accActive: false,
    accHolding: false,
    desiredGap: 3, timeGap: 1.6, trafficLightStopping: false, brakeReason: "none", curveSpeedLimited: false, laneSupportLimited: false, laneSupportLimitCause:null,
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
