import { clamp, wrapAngle, wrapDiff } from "../core/math.ts";
import type { ADASConfig, ADASFrame } from "./ADAS.ts";
import { proximitySafety } from "./ProximitySafety.ts";

export interface AssistanceStatus {
  blindSpotIntervention: boolean;
  emergencyLaneKeeping: boolean;
  pedalMitigation: boolean;
  leadDeparture: boolean;
  safeExitLeft: boolean;
  safeExitRight: boolean;
  driverWarning: "none" | "attention" | "hands" | "fatigue" | "takeover";
  minimalRiskBraking: boolean;
  highBeam: boolean;
}
export const emptyAssistanceStatus = (): AssistanceStatus => ({ blindSpotIntervention: false, emergencyLaneKeeping: false,
  pedalMitigation: false, leadDeparture: false, safeExitLeft: false, safeExitRight: false, driverWarning: "none", minimalRiskBraking: false, highBeam: false });

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
  reset(): void {
    this.inattentiveTime = this.handsOffTime = this.stoppedTime = this.departureTime = this.beamClearTime = 0;
    this.stoppedGap = null;
    this.monitorStop = false;
  }
  update(frame: ADASFrame, config: ADASConfig, steer: number, accel: number,
    options: { gear: string; night: boolean; weather: string; attentive: boolean; handsOn: boolean; fatigued: boolean }) {
    const status = emptyAssistanceStatus();
    const { ego, egoS, egoD, obstacles, road, path, input, dt } = frame;
    const available = frame.sensorsAvailable !== false;
    const laneAvailable = available && (frame.laneConfidence ?? 1) >= .6;
    const direction = options.gear === "R" ? -1 : 1;
    let nearest: { gap: number; v: number } | null = null;
    let beamBlocked = false;
    for (const o of available ? obstacles : []) {
      const ds = wrapDiff(o.s, egoS, path.length), dd = o.d - egoD;
      const halfWidth = (ego.dims.width + o.width) / 2;
      const gap = ds - (ego.dims.length + o.length) / 2;
      if (ds > 0 && Math.abs(dd) < halfWidth && (!nearest || gap < nearest.gap)) nearest = { gap, v: o.v };
      if (o.kind !== "ped" && ds > 0 && ds < 150 && Math.abs(dd) < road.totalWidth + 4) beamBlocked = true;
      const rearGap = -ds - (ego.dims.length + o.length) / 2;
      const rearTtc = o.v > .2 ? rearGap / o.v : Infinity;
      const sideThreat = Math.abs(dd) > halfWidth - .2 && Math.abs(dd) < halfWidth + 4 &&
        ((ds >= -8 && ds < 4) || (rearTtc >= 0 && rearTtc < 5));
      if (config.safeExit && sideThreat && ego.v < .3) {
        if (dd < 0) status.safeExitLeft = true; else status.safeExitRight = true;
      }
      const sideClosing = o.v - ego.v;
      const conflict = ds > -8 && ds < 5 || (ds < 0 && sideClosing > .2 && rearGap / sideClosing < 3);
      const steeringToward = Math.sign(input.steer) === Math.sign(dd) && Math.abs(input.steer) > .05;
      const lateralThreat = Math.abs(dd) < halfWidth + .8 || Math.abs(dd + (o.vd ?? 0)) < halfWidth + .3;
      if (config.blindSpotAvoidance && ego.v > 3 && direction > 0 && conflict && lateralThreat && steeringToward) {
        status.blindSpotIntervention = true;
        // Simulated limited steering assistance; a strong driver input still
        // wins. Never initiates an autonomous swerve into the opposite lane.
        if (Math.abs(input.steer) < .7) steer = -Math.sign(dd) * Math.min(.12, Math.atan(3 * ego.dims.wheelbase / Math.max(ego.v ** 2, 1)));
      }
    }
    const heading = path.cartesianAt(egoS).heading;
    const outwardRate = ego.v * Math.sin(wrapAngle(ego.yaw - heading));
    const edge = road.totalWidth / 2 - ego.dims.width / 2;
    if (config.emergencyLaneKeeping && laneAvailable && direction > 0 && ego.v > 5 && Math.abs(egoD + outwardRate * .8) > edge && egoD * outwardRate > 0) {
      status.emergencyLaneKeeping = true;
      if (Math.abs(input.steer) < .7) steer = -Math.sign(egoD) * Math.min(.15, Math.atan(3 * ego.dims.wheelbase / Math.max(ego.v ** 2, 1)));
    }
    const proximity = proximitySafety(ego, path, available ? obstacles : [], direction < 0);
    const bumper = direction > 0 ? proximity.front : proximity.rear;
    if (config.pedalMitigation && available && (options.gear === "D" || options.gear === "R") && ego.v < 2 && input.throttle > .85 && bumper !== null && bumper < 2.5) {
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

    this.inattentiveTime = config.driverMonitoring && !options.attentive && ego.v > 1 ? this.inattentiveTime + dt : 0;
    this.handsOffTime = config.driverMonitoring && !options.handsOn && ego.v > 5 ? this.handsOffTime + dt : 0;
    if (!config.driverMonitoring || (options.attentive && options.handsOn)) this.monitorStop = false;
    if (config.driverMonitoring && (this.inattentiveTime > 15 || this.handsOffTime > 20)) this.monitorStop = true;
    status.driverWarning = !config.driverMonitoring ? "none" : this.monitorStop || this.inattentiveTime > 10 || this.handsOffTime > 15 ? "takeover" :
      this.inattentiveTime > 2 ? "attention" : this.handsOffTime > 5 ? "hands" : options.fatigued ? "fatigue" : "none";
    status.minimalRiskBraking = this.monitorStop;
    // Keep available lane support during the warning/controlled stop. Driver
    // override has already been applied by ADASController before this layer.
    if (status.minimalRiskBraking) accel = Math.min(accel, -2);
    this.beamClearTime = available && !beamBlocked && options.night && options.weather === "clear" && ego.v > 11 ? this.beamClearTime + dt : 0;
    status.highBeam = config.highBeamAssist && this.beamClearTime >= 2;
    return { status, steer: clamp(steer, -ego.maxSteer, ego.maxSteer), accel };
  }
}
