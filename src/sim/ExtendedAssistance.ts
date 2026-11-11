import { clamp, wrapAngle, wrapDiff } from "../core/math.ts";
import { stanleyControl } from "../control/Stanley.ts";
import type { ADASConfig, ADASFrame } from "./ADAS.ts";
import { proximitySafety } from "./ProximitySafety.ts";
import { assistanceAvailability, ASSISTANCE_REFERENCE as REF } from './AssistancePolicy.ts';

export interface AssistanceStatus {
  blindSpotIntervention: boolean;
  blindSpotBraking: boolean;
  emergencyLaneKeeping: boolean;
  evasiveSteering: boolean;
  pedalMitigation: boolean;
  leadDeparture: boolean;
  safeExitLeft: boolean;
  safeExitRight: boolean;
  driverWarning: "none" | "attention" | "hands" | "fatigue" | "takeover";
  minimalRiskBraking: boolean;
  highBeam: boolean;
  emergencyStopState: 'off' | 'warning' | 'takeover' | 'braking' | 'hold';
  hazardRequest: boolean;
  driverResponded: boolean;
}
export const emptyAssistanceStatus = (): AssistanceStatus => ({ blindSpotIntervention: false, blindSpotBraking: false, emergencyLaneKeeping: false,
  evasiveSteering: false, pedalMitigation: false, leadDeparture: false, safeExitLeft: false, safeExitRight: false, driverWarning: "none", minimalRiskBraking: false, highBeam: false, emergencyStopState: 'off', hazardRequest: false, driverResponded:false });

export interface ExtendedRuntimeState {
  inattentiveTime: number; handsOffTime: number; stoppedTime: number; stoppedGap: number | null;
  departureTime: number; beamClearTime: number; monitorStop: boolean; beamOn: boolean;
  evadeTargetLane?: number | null; evadeTimer?: number;
  previousInput: { steer: number; throttle: number; brake: number; steeringOverride?: boolean };
}

/** Behaviour models with explicit inputs. Driver attention is injected by the
 * scenario operator; it is NOT webcam/face/eye recognition. */
export class ExtendedAssistance {
  private inattentiveTime = 0;
  private handsOffTime = 0;
  private stoppedTime = 0;
  private stoppedGap: number | null = null;
  private departureTime = 0;
  private beamClearTime = 0;
  private monitorStop = false;
  private beamOn = false;
  private evadeTargetLane: number | null = null;
  private lastCommandedEvadeLane: number | null = null;
  private evadeTimer = 0;
  private evadeAutoTriggered = false;
  private previousInput: ExtendedRuntimeState['previousInput'] = { steer: 0, throttle: 0, brake: 0 };
  get activeEvadeLane(): number | null { return this.evadeTargetLane ?? this.lastCommandedEvadeLane; }
  /** Explicit laboratory injection, not a diagnosis from a camera. */
  triggerEmergencyStop():void { this.monitorStop=true; }
  captureState(): ExtendedRuntimeState {
    return { inattentiveTime: this.inattentiveTime, handsOffTime: this.handsOffTime, stoppedTime: this.stoppedTime,
      stoppedGap: this.stoppedGap, departureTime: this.departureTime, beamClearTime: this.beamClearTime,
      monitorStop: this.monitorStop, beamOn: this.beamOn, evadeTargetLane: this.evadeTargetLane, evadeTimer: this.evadeTimer,
      previousInput: { ...this.previousInput } };
  }
  restoreState(state?: ExtendedRuntimeState): void {
    this.reset();
    if (!state) return;
    this.inattentiveTime = state.inattentiveTime; this.handsOffTime = state.handsOffTime;
    this.stoppedTime = state.stoppedTime; this.stoppedGap = state.stoppedGap;
    this.departureTime = state.departureTime; this.beamClearTime = state.beamClearTime;
    this.monitorStop = state.monitorStop; this.beamOn = state.beamOn;
    this.evadeTargetLane = state.evadeTargetLane ?? null; this.evadeTimer = state.evadeTimer ?? 0;
    this.previousInput = { ...state.previousInput };
  }
  reset(): void {
    this.inattentiveTime = this.handsOffTime = this.stoppedTime = this.departureTime = this.beamClearTime = this.evadeTimer = 0;
    this.stoppedGap = null;
    this.evadeTargetLane = null;
    this.lastCommandedEvadeLane = null;
    this.evadeAutoTriggered = false;
    this.monitorStop = false;
    this.beamOn = false; this.previousInput = { steer: 0, throttle: 0, brake: 0 };
  }
  update(frame: ADASFrame, config: ADASConfig, steer: number, accel: number,
    options: { gear: string; night: boolean; weather: string; attentive: boolean; handsOn: boolean; fatigued: boolean }) {
    const status = emptyAssistanceStatus();
    const { ego, egoS, egoD, obstacles, road, path, input, dt } = frame;
    const availability = assistanceAvailability(frame);
    const available = availability.forward;
    const laneAvailable = availability.lane;
    const muEst = clamp(frame.estimatedMu ?? ego.surfaceMu, 0.2, 1.1);
    const laneHeading = path.cartesianAt(egoS).heading;
    const k = path.signedCurvatureAt(egoS);
    const feedForward = Math.atan(ego.dims.wheelbase * k / Math.max(.25, 1 - k * egoD));
    const direction = options.gear === "R" ? -1 : 1;
    this.lastCommandedEvadeLane = null;
    let nearest: { gap: number; v: number } | null = null;
    let beamBlocked = false;
    for (const o of obstacles) {
      // Road geometry is handled by lane/edge support and proximity braking,
      // not by vehicle-only departure, blind-spot or headlamp detection.
      if (o.roadBoundary) continue;
      const confirmed = o.confirmed !== false;
      const ds = wrapDiff(o.s, egoS, path.length), dd = o.d - egoD;
      const halfWidth = (ego.dims.width + o.width) / 2;
      const gap = ds - (ego.dims.length + o.length) / 2;
      const inSameDirection = o.v >= -0.5 && o.d >= road.forwardLeftEdge - 0.5 && o.d <= road.forwardRightEdge + road.shoulderWidth + 0.5;
      if (confirmed && available && o.kind !== 'ped' && inSameDirection && ds > 0 && Math.abs(dd) < halfWidth && (!nearest || gap < nearest.gap)) nearest = { gap, v: o.v };
      if (confirmed && availability.sensors.camera && o.kind !== "ped" && ds > 0 && ds < 150 && Math.abs(dd) < road.totalWidth + 4) beamBlocked = true;
      const rearGap = -ds - (ego.dims.length + o.length) / 2;
      // Side/door threats are body occupancies, not just centre positions.
      // A long bus can have its centre ahead while its rear still covers us.
      const alongside = Math.abs(ds) < (ego.dims.length + o.length) / 2 + .5;
      const sideClosing = o.v - ego.v;
      const rearTtc = sideClosing > .2 ? rearGap / sideClosing : Infinity;
      const sideThreat = confirmed && o.v > .5 && Math.abs(dd) > halfWidth - .2 && Math.abs(dd) < halfWidth + 4 &&
        (alongside || (ds >= -8 && ds < 4) || (rearTtc >= 0 && rearTtc < 5));
      if (availability.sensors.rearRadar && config.safeExit && sideThreat && ego.v < .3) {
        if (dd < 0) status.safeExitLeft = true; else status.safeExitRight = true;
      }
      const conflict = confirmed && inSameDirection && (alongside || ds > -8 && ds < 5 || (ds < 0 && sideClosing > .2 && rearGap / sideClosing < 3));
      const steeringToward = Math.sign(input.steer) === Math.sign(dd) && Math.abs(input.steer) > .05;
      const lateralThreat = Math.abs(dd) < halfWidth + .8 || Math.abs(dd + (o.vd ?? 0)) < halfWidth + .3;
      // Separate from steering support: brake when leaving a stopped position
      // towards a rapidly approaching blind-spot vehicle (EV9 departure BCA).
      const departureIntent = steeringToward || (frame.indicator !== undefined && frame.indicator !== 0 && Math.sign(frame.indicator) === Math.sign(dd));
      const departureThreat = confirmed && inSameDirection && ds < 0 && sideClosing * 3.6 > 5 && rearGap >= -2 && rearGap / Math.max(sideClosing, .1) < 3 &&
        Math.abs(dd) > halfWidth - .2 && Math.abs(dd) < halfWidth + road.laneWidth;
      if (config.blindSpotAvoidance && availability.sensors.rearRadar && availability.conditions.escAvailable && options.gear === 'D' &&
        ego.v * 3.6 < 3 && departureIntent && departureThreat && (ego.v > .05 || input.throttle > .05)) {
        status.blindSpotIntervention = status.blindSpotBraking = true;
        accel = Math.min(accel, -ego.maxDecel);
      }
      if (availability.sensors.rearRadar && config.blindSpotAvoidance && laneAvailable && ego.v > 3 && options.gear === 'D' && conflict && lateralThreat && steeringToward) {
        status.blindSpotIntervention = true;
        // Cooperative directional arbitration: never weakens a stronger inward
        // correction from LFA/ESA, while a strong driver input (>=0.7) still wins.
        if (Math.abs(input.steer) < .7) {
          const bcaSteer = clamp(
            feedForward + wrapAngle(laneHeading - ego.yaw) * 0.65 - Math.sign(dd) * Math.min(.12, Math.atan(3 * ego.dims.wheelbase / Math.max(ego.v ** 2, 1))),
            -ego.maxSteer * 0.5,
            ego.maxSteer * 0.5,
          );
          steer = dd > 0 ? Math.min(steer, bcaSteer) : Math.max(steer, bcaSteer);
        }
      }
    }
    const outwardRate = ego.v * Math.sin(wrapAngle(ego.yaw - laneHeading));
    const left = road.laneCenter(0) - road.laneWidth / 2 + ego.dims.width / 2;
    const right = road.forwardRightEdge + road.shoulderWidth - ego.dims.width / 2;
    const signalledInLane = !!frame.indicator && Math.sign(frame.indicator) === Math.sign(outwardRate) &&
      egoD >= road.laneCenter(0) - 0.1 && egoD <= road.laneCenter(road.numLanes - 1) + 0.1;
    const predictedD = egoD + outwardRate * (this.evadeTargetLane !== null || signalledInLane ? .32 : .8);
    const edgeDirection = predictedD < left && outwardRate < -0.08 ? -1 : predictedD > right && outwardRate > 0.08 ? 1 : 0;
    if (config.emergencyLaneKeeping && laneAvailable && options.gear === 'D' && ego.v > 5 && edgeDirection) {
      status.emergencyLaneKeeping = true;
      if (Math.abs(input.steer) < .7) {
        const elkHeadingErr = wrapAngle(laneHeading - ego.yaw);
        const elkInward = Math.min(.18, Math.atan(3.5 * ego.dims.wheelbase / Math.max(ego.v ** 2, 1)));
        const elkSteer = clamp(feedForward + elkHeadingErr - edgeDirection * elkInward, -ego.maxSteer * 0.65, ego.maxSteer * 0.65);
        steer = edgeDirection < 0 ? Math.max(steer, elkSteer) : Math.min(steer, elkSteer);
      }
    }
    // Evasive Steering Assist (ESA / Kia EV9 FCA2 Evasive Steering Assist):
    // 1. Driver-initiated ESA (>= 30 km/h): when a forward collision is imminent and
    //    the driver steers toward a clear adjacent same-direction lane, assist with
    //    Stanley lateral stabilization and modulate braking to preserve tire grip.
    // 2. Automatic High-Speed Evasive Steering (>= 85 km/h): when the driver is NOT
    //    overriding with throttle/brake and the remaining gap is physically shorter
    //    than the pure-braking stopping distance (`nearest.gap < pureStopDist * 0.92`),
    //    automatically steer into a verified clear same-direction adjacent lane and
    //    hold that target lane until the vehicle settles safely inside it.
    const currentLane = road.laneOf(egoD);
    const availableDecel = Math.max(ego.maxDecel * muEst * .95, 1);
    const closingFront = nearest ? Math.max(ego.v - nearest.v, 0) : 0;
    const pureStopDist = nearest ? closingFront ** 2 / (2 * availableDecel) : 0;
    const frontStopGap = pureStopDist + ego.v * .2 + 2.5;
    const frontCritical = nearest !== null && (nearest.gap <= frontStopGap * 1.15 || (closingFront > .5 && nearest.gap / closingFront <= config.warningTtc));
    const cannotBrakeInTime = nearest !== null && closingFront > 4 && nearest.gap > 2 && nearest.gap < pureStopDist * 0.92;
    const isLaneClearForEvade = (laneIdx: number) => {
      if (laneIdx < 0 || laneIdx >= road.numLanes) return false;
      const targetD = road.laneCenter(laneIdx);
      if (targetD < road.forwardLeftEdge || targetD > road.forwardRightEdge) return false;
      return obstacles.every(o => {
        if (o.roadBoundary) return Math.abs(o.d - targetD) > (ego.dims.width + o.width) / 2 + .25;
        const ds = wrapDiff(o.s, egoS, path.length);
        const lat = Math.abs(o.d - targetD);
        if (lat > (ego.dims.width + o.width) / 2 + .45) return true;
        const clearance = Math.abs(ds) - (ego.dims.length + o.length) / 2;
        if (ds >= -4 && ds <= Math.max(18, ego.v * 1.4)) return false;
        if (ds < -4 && o.v > ego.v + .5 && clearance / (o.v - ego.v) < 3.0) return false;
        return true;
      });
    };

    if (this.evadeTargetLane !== null) {
      this.evadeTimer += dt;
      const targetD = road.laneCenter(this.evadeTargetLane);
      const settled = Math.abs(egoD - targetD) < 0.25 && Math.abs(wrapAngle(ego.yaw - laneHeading)) < 0.04;
      const driverCounterSteer = Math.abs(input.steer) > 0.12 && Math.sign(input.steer) !== Math.sign(targetD - egoD);
      const laneCleared = this.evadeTimer < 0.35 || isLaneClearForEvade(this.evadeTargetLane);
      if (!available || !laneAvailable || !availability.sensors.rearRadar || !availability.conditions.escAvailable ||
        !(config.laneCentering || config.laneKeeping) || options.gear !== 'D' || settled || driverCounterSteer || this.evadeTimer > 3.5 || !laneCleared) {
        this.evadeTargetLane = null;
        this.evadeTimer = 0;
        this.evadeAutoTriggered = false;
      }
    }

    const driverSteerDir = Math.abs(input.steer) > .06 ? Math.sign(input.steer) : 0;
    let targetEvadeLane: number | null = null;
    if (available && laneAvailable && availability.conditions.escAvailable && options.gear === 'D' &&
      !status.blindSpotIntervention) {
      if (config.aeb && ego.v * 3.6 >= 30 && driverSteerDir !== 0 && frontCritical && isLaneClearForEvade(currentLane + driverSteerDir)) {
        targetEvadeLane = currentLane + driverSteerDir;
        this.evadeTargetLane = null;
        this.evadeTimer = 0;
        this.evadeAutoTriggered = false;
      } else if (this.evadeTargetLane !== null) {
        targetEvadeLane = this.evadeTargetLane;
      } else if (!status.emergencyLaneKeeping && availability.sensors.rearRadar && (config.laneCentering || config.laneKeeping) &&
        ego.v * 3.6 >= 85 && input.throttle <= 0.05 && cannotBrakeInTime) {
        for (const candidate of [currentLane - 1, currentLane + 1]) {
          if (isLaneClearForEvade(candidate)) {
            targetEvadeLane = candidate;
            this.evadeTargetLane = candidate;
            this.evadeTimer = 0;
            this.evadeAutoTriggered = true;
            break;
          }
        }
      }
    }

    if (targetEvadeLane !== null) {
      this.lastCommandedEvadeLane = targetEvadeLane;
      const targetD = road.laneCenter(targetEvadeLane);
      const evasiveDir = Math.sign(targetD - egoD) || driverSteerDir || 1;
      status.evasiveSteering = true;
      const esaHeadingErr = wrapAngle(laneHeading - ego.yaw);
      const esaFrontCross = (egoD - targetD) + (ego.dims.wheelbase * 0.5) * Math.sin(-esaHeadingErr);
      const esaSteer = clamp(
        feedForward + stanleyControl(
          esaHeadingErr,
          esaFrontCross,
          ego.v,
          { k: 2.0, kSoft: 1.4, maxSteer: ego.maxSteer },
        ),
        -ego.maxSteer * 0.55,
        ego.maxSteer * 0.55,
      );
      const candidateSteer = driverSteerDir !== 0
        ? (evasiveDir > 0 ? Math.max(steer, esaSteer) : Math.min(steer, esaSteer))
        : esaSteer;
      steer = status.emergencyLaneKeeping
        ? (edgeDirection < 0 ? Math.max(steer, candidateSteer) : Math.min(steer, candidateSteer))
        : candidateSteer;
      // Modulate automatic braking during the evasive swerve so longitudinal
      // deceleration does not saturate the tire friction circle, without
      // cancelling natural passive coasting once the original lane clears.
      if (input.brake < .8) {
        accel = Math.max(accel, -ego.maxDecel * muEst * .55);
      }
    }
    const proximity = proximitySafety(ego, path, availability.sensors.ultrasonic ? obstacles : [], direction < 0, muEst);
    const bumper = direction > 0 ? proximity.front : proximity.rear;
    if (config.pedalMitigation && availability.sensors.ultrasonic && (options.gear === "D" || options.gear === "R") && ego.v < 2 && input.throttle > .85 && bumper !== null && bumper < 2.5) {
      status.pedalMitigation = true; accel = Math.min(accel, -ego.maxDecel);
    }
    if (config.leadDeparture && nearest && ego.v < .3 && options.gear === "D") {
      if (nearest.v < .3 && nearest.gap < 20) {
        this.stoppedTime += dt;
        if (this.stoppedTime > 1) this.stoppedGap = nearest.gap;
      } else if (this.stoppedGap !== null && this.stoppedTime > 1 && nearest.v > .8 && nearest.gap > this.stoppedGap + 1.5) {
        this.departureTime = 3; this.stoppedGap = null; this.stoppedTime = 0;
      }
    } else { this.stoppedTime = 0; this.stoppedGap = null; }
    this.departureTime = Math.max(0, this.departureTime - dt);
    status.leadDeparture = config.leadDeparture && this.departureTime > 0;

    // Only a NEW deliberate action acknowledges/overrides warnings and stop.
    // A smoothed keyboard wheel or slowly squeezed analogue pedal may never
    // exceed a per-frame delta. Detect fresh intent/threshold crossings too,
    // while a pedal held before incapacitation cannot repeatedly acknowledge.
    const acknowledge = !!input.steeringOverride && !this.previousInput.steeringOverride ||
      Math.abs(input.steer) > .08 && Math.abs(this.previousInput.steer) <= .08 ||
      input.brake > .05 && this.previousInput.brake <= .05 ||
      input.throttle > .12 && this.previousInput.throttle <= .12 ||
      Math.abs(input.steer - this.previousInput.steer) > .08 || input.brake - this.previousInput.brake > .05 || input.throttle - this.previousInput.throttle > .12;
    status.driverResponded=this.monitorStop && acknowledge;
    this.previousInput = { steer: input.steer, throttle: input.throttle, brake: input.brake, steeringOverride: input.steeringOverride };
    if (acknowledge) { this.inattentiveTime = this.handsOffTime = 0; this.monitorStop = false; }
    this.inattentiveTime = config.driverMonitoring && !options.attentive && ego.v > 1 && !acknowledge ? this.inattentiveTime + dt : 0;
    this.handsOffTime = config.driverMonitoring && !options.handsOn && ego.v > 5 ? this.handsOffTime + dt : 0;
    if (!config.driverMonitoring || (options.attentive && options.handsOn)) this.monitorStop = false;
    if (config.driverMonitoring && options.gear === 'D' && (this.inattentiveTime > REF.stopAttentionSeconds || this.handsOffTime > REF.stopHandsSeconds)) this.monitorStop = true;
    status.driverWarning = !config.driverMonitoring ? "none" : this.monitorStop || this.inattentiveTime > REF.takeoverAttentionSeconds || this.handsOffTime > REF.takeoverHandsSeconds ? "takeover" :
      this.inattentiveTime > REF.attentionWarningSeconds ? "attention" : this.handsOffTime > REF.handsWarningSeconds ? "hands" : options.fatigued ? "fatigue" : "none";
    status.minimalRiskBraking = this.monitorStop;
    // Keep available lane support during the warning/controlled stop. Driver
    // override has already been applied by ADASController before this layer.
    if (status.minimalRiskBraking) accel = Math.min(accel, -2);
    status.emergencyStopState = this.monitorStop ? ego.v < .1 ? 'hold' : 'braking' : status.driverWarning === 'takeover' ? 'takeover' : status.driverWarning !== 'none' ? 'warning' : 'off';
    status.hazardRequest = status.minimalRiskBraking;
    const beamAllowed = config.highBeamAssist && availability.sensors.camera && !beamBlocked && options.night && options.weather === 'clear';
    if (!beamAllowed || ego.v * 3.6 < REF.highBeamOffKph) { this.beamOn = false; this.beamClearTime = 0; }
    else if (ego.v * 3.6 > REF.highBeamOnKph) {
      this.beamClearTime += dt;
      if (this.beamClearTime >= 2) this.beamOn = true;
    } else if (!this.beamOn) this.beamClearTime = 0;
    status.highBeam = this.beamOn;
    return { status, steer: clamp(steer, -ego.maxSteer, ego.maxSteer), accel };
  }
}
