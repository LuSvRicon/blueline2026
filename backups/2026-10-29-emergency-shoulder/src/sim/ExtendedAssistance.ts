import { clamp, wrapAngle, wrapDiff } from "../core/math.ts";
import type { ADASConfig, ADASFrame } from "./ADAS.ts";
import { proximitySafety } from "./ProximitySafety.ts";
import { assistanceAvailability, ASSISTANCE_REFERENCE as REF } from './AssistancePolicy.ts';

export interface AssistanceStatus {
  blindSpotIntervention: boolean;
  blindSpotBraking: boolean;
  emergencyLaneKeeping: boolean;
  pedalMitigation: boolean;
  leadDeparture: boolean;
  safeExitLeft: boolean;
  safeExitRight: boolean;
  driverWarning: "none" | "attention" | "hands" | "fatigue" | "takeover";
  minimalRiskBraking: boolean;
  highBeam: boolean;
  emergencyStopState: 'off' | 'warning' | 'takeover' | 'braking' | 'hold';
  hazardRequest: boolean;
}
export const emptyAssistanceStatus = (): AssistanceStatus => ({ blindSpotIntervention: false, blindSpotBraking: false, emergencyLaneKeeping: false,
  pedalMitigation: false, leadDeparture: false, safeExitLeft: false, safeExitRight: false, driverWarning: "none", minimalRiskBraking: false, highBeam: false, emergencyStopState: 'off', hazardRequest: false });

export interface ExtendedRuntimeState {
  inattentiveTime: number; handsOffTime: number; stoppedTime: number; stoppedGap: number | null;
  departureTime: number; beamClearTime: number; monitorStop: boolean; beamOn: boolean;
  previousInput: { steer: number; throttle: number; brake: number };
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
  private previousInput = { steer: 0, throttle: 0, brake: 0 };
  captureState(): ExtendedRuntimeState {
    return { inattentiveTime: this.inattentiveTime, handsOffTime: this.handsOffTime, stoppedTime: this.stoppedTime,
      stoppedGap: this.stoppedGap, departureTime: this.departureTime, beamClearTime: this.beamClearTime,
      monitorStop: this.monitorStop, beamOn: this.beamOn, previousInput: { ...this.previousInput } };
  }
  restoreState(state?: ExtendedRuntimeState): void {
    this.reset();
    if (!state) return;
    this.inattentiveTime = state.inattentiveTime; this.handsOffTime = state.handsOffTime;
    this.stoppedTime = state.stoppedTime; this.stoppedGap = state.stoppedGap;
    this.departureTime = state.departureTime; this.beamClearTime = state.beamClearTime;
    this.monitorStop = state.monitorStop; this.beamOn = state.beamOn;
    this.previousInput = { ...state.previousInput };
  }
  reset(): void {
    this.inattentiveTime = this.handsOffTime = this.stoppedTime = this.departureTime = this.beamClearTime = 0;
    this.stoppedGap = null;
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
    const laneHeading = path.cartesianAt(egoS).heading;
    const k = path.signedCurvatureAt(egoS);
    const feedForward = Math.atan(ego.dims.wheelbase * k / Math.max(.25, 1 - k * egoD));
    const direction = options.gear === "R" ? -1 : 1;
    let nearest: { gap: number; v: number } | null = null;
    let beamBlocked = false;
    for (const o of obstacles) {
      // Road geometry is handled by lane/edge support and proximity braking,
      // not by vehicle-only departure, blind-spot or headlamp detection.
      if (o.roadBoundary) continue;
      const ds = wrapDiff(o.s, egoS, path.length), dd = o.d - egoD;
      const halfWidth = (ego.dims.width + o.width) / 2;
      const gap = ds - (ego.dims.length + o.length) / 2;
      if (available && o.kind !== 'ped' && ds > 0 && Math.abs(dd) < halfWidth && (!nearest || gap < nearest.gap)) nearest = { gap, v: o.v };
      if (availability.sensors.camera && o.kind !== "ped" && ds > 0 && ds < 150 && Math.abs(dd) < road.totalWidth + 4) beamBlocked = true;
      const rearGap = -ds - (ego.dims.length + o.length) / 2;
      const rearTtc = o.v > .2 ? rearGap / o.v : Infinity;
      const sideThreat = Math.abs(dd) > halfWidth - .2 && Math.abs(dd) < halfWidth + 4 &&
        ((ds >= -8 && ds < 4) || (rearTtc >= 0 && rearTtc < 5));
      if (availability.sensors.rearRadar && config.safeExit && sideThreat && ego.v < .3) {
        if (dd < 0) status.safeExitLeft = true; else status.safeExitRight = true;
      }
      const sideClosing = o.v - ego.v;
      const conflict = ds > -8 && ds < 5 || (ds < 0 && sideClosing > .2 && rearGap / sideClosing < 3);
      const steeringToward = Math.sign(input.steer) === Math.sign(dd) && Math.abs(input.steer) > .05;
      const lateralThreat = Math.abs(dd) < halfWidth + .8 || Math.abs(dd + (o.vd ?? 0)) < halfWidth + .3;
      // Separate from steering support: brake when leaving a stopped position
      // towards a rapidly approaching blind-spot vehicle (EV9 departure BCA).
      const departureIntent = steeringToward || (frame.indicator !== undefined && frame.indicator !== 0 && Math.sign(frame.indicator) === Math.sign(dd));
      const departureThreat = ds < 0 && sideClosing * 3.6 > 5 && rearGap >= -2 && rearGap / Math.max(sideClosing, .1) < 3 &&
        Math.abs(dd) > halfWidth - .2 && Math.abs(dd) < halfWidth + road.laneWidth;
      if (config.blindSpotAvoidance && availability.sensors.rearRadar && availability.conditions.escAvailable && options.gear === 'D' &&
        ego.v * 3.6 < 3 && departureIntent && departureThreat && (ego.v > .05 || input.throttle > .05)) {
        status.blindSpotIntervention = status.blindSpotBraking = true;
        accel = Math.min(accel, -ego.maxDecel);
      }
      if (availability.sensors.rearRadar && config.blindSpotAvoidance && laneAvailable && ego.v > 3 && options.gear === 'D' && conflict && lateralThreat && steeringToward) {
        status.blindSpotIntervention = true;
        // Simulated limited steering assistance; a strong driver input still
        // wins. Never initiates an autonomous swerve into the opposite lane.
        if (Math.abs(input.steer) < .7) steer = feedForward - Math.sign(dd) * Math.min(.12, Math.atan(3 * ego.dims.wheelbase / Math.max(ego.v ** 2, 1)));
      }
    }
    const outwardRate = ego.v * Math.sin(wrapAngle(ego.yaw - laneHeading));
    const left = road.laneCenter(0) - road.laneWidth / 2 + ego.dims.width / 2;
    const right = road.laneCenter(road.numLanes - 1) + road.laneWidth / 2 - ego.dims.width / 2;
    const predictedD = egoD + outwardRate * .8;
    const edgeDirection = predictedD < left && outwardRate < 0 ? -1 : predictedD > right && outwardRate > 0 ? 1 : 0;
    if (config.emergencyLaneKeeping && laneAvailable && options.gear === 'D' && ego.v > 5 && edgeDirection) {
      status.emergencyLaneKeeping = true;
      if (Math.abs(input.steer) < .7) steer = feedForward - edgeDirection * Math.min(.15, Math.atan(3 * ego.dims.wheelbase / Math.max(ego.v ** 2, 1)));
    }
    const proximity = proximitySafety(ego, path, availability.sensors.ultrasonic ? obstacles : [], direction < 0);
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
    const acknowledge = Math.abs(input.steer - this.previousInput.steer) > .08 || input.brake - this.previousInput.brake > .05 || input.throttle - this.previousInput.throttle > .12;
    this.previousInput = { steer: input.steer, throttle: input.throttle, brake: input.brake };
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
