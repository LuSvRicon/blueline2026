// Sensor — Perception front-ends for BlueLine:
//   1. `Sensor`: baseline isotropic single-channel perception model used by
//      classical/ML modes (preserving exact deterministic PRNG draws).
//   2. `DualChannelSensorSuite`: physical 2-channel ADAS sensor suite modelling:
//      - 77 GHz Dual-Lobe Radar (LRR 180 m ±11° + MRR 76 m ±45° + rear/BSM sector),
//        accurate radial range & direct Doppler velocity, wider cross-range azimuth
//        spread at distance, under-body vehicle multi-bounce, weather resilience in
//        fog/night, and weaker stationary-pedestrian RCS at range.
//      - Windshield Optical Camera (118 m ±43° + close surround), sharp 0.20° angular
//        bearing, strong VRU/pedestrian semantic confidence, monocular range-growing
//        depth uncertainty, severe fog/rain/night optical attenuation, and chassis
//        pitch (`bodyPitch`) horizon foreshortening & uncalibrated depth shift.
//      - Exact 2x2 Inverse-Covariance (Information Filter) Radar+Camera Fusion:
//        R_fused = (R_radar⁻¹ + R_cam⁻¹)⁻¹, z_fused = R_fused (R_radar⁻¹ z_r + R_cam⁻¹ z_c).

import { ObstacleKind } from "../planner/Trajectory.ts";
import { Rng } from "../core/rng.ts";
import { clamp, wrapAngle } from "../core/math.ts";
import { inv2 } from "../core/mat.ts";

export type SensorModality = "radar" | "camera" | "fused" | "legacy";

export interface SensableObject {
  roadBoundary?: { d: number; width: number };
  x: number;
  y: number;
  length: number;
  width: number;
  kind: ObstacleKind;
  /** Actual planar body for visibility; reported tracking dimensions may be
   * road-aligned extents instead. +X is along yaw. */
  yaw?: number;
  occlusionLength?: number;
  occlusionWidth?: number;
  vx?: number;
  vy?: number;
}

export interface Detection {
  roadBoundary?: { d: number; width: number };
  x: number;
  y: number;
  length: number;
  width: number;
  kind: ObstacleKind;
  /** 0..1 measurement quality, useful for downstream confidence displays. */
  confidence: number;
  /** Simulation timestamp (s) when the physical scene was sampled. */
  timestamp?: number;
  /** Simulated sensor processing latency (s) at delivery. */
  latencySec?: number;
  /** Current simulation timestamp when this genuinely delayed measurement was
   * delivered. Omitted for the instantaneous standalone sensor APIs. */
  deliveredAt?: number;
  vx?: number;
  vy?: number;
  velocityVariance?: number;
  /** Anisotropic 2x2 Cartesian position covariance [[r00, r01], [r01, r11]] (m²). */
  measCov?: [[number, number], [number, number]];
  /** Physical sensing channel that generated this detection. */
  sensorChannel?: SensorModality;
  radarDetected?: boolean;
  cameraDetected?: boolean;
}

export type OcclusionMode = "full" | "pedestrians-only" | "off";

export interface SensorConfig {
  range: number;
  posNoise: number;
  sizeNoise: number;
  occlusion: boolean;
  /** Optional explicit occlusion policy when `occlusion` is true:
   * - "full": closer solid vehicles occlude both pedestrians and fully hidden vehicles
   * - "pedestrians-only": radar multi-bounce sees vehicles, while pedestrians stay occluded
   * - "off": equivalent to `occlusion: false` */
  occlusionMode?: OcclusionMode;
  dropout: number; // probability [0,1] a given in-range detection is missed
  /** Half-angle of the forward field of view (radians); Math.PI = all-round. */
  fov: number;
  /** Heading the sensor is pointing (radians, world frame). */
  heading: number;
  velocityNoise: number;
  /** Optional measurement latency (s) stamped onto detections. */
  latencySec?: number;
}

export const DEFAULT_SENSOR: SensorConfig = {
  range: 95,
  posNoise: 0.35,
  sizeNoise: 0.15,
  occlusion: true,
  dropout: 0.04,
  fov: Math.PI, // 360° surround perception suite (camera + radar)
  heading: 0,
  velocityNoise: 0.25,
};

/** Surround / long-range radar: vehicles only, little occlusion, 360° coverage for BSM. */
export const DEFAULT_RADAR: SensorConfig = {
  range: 160,
  posNoise: 0.55,
  sizeNoise: 0.25,
  occlusion: false,
  dropout: 0.02,
  fov: Math.PI,
  heading: 0,
  velocityNoise: 0.25,
};

function computeAngularSpan(
  egoX: number,
  egoY: number,
  bearing: number,
  o: SensableObject,
): { min: number; max: number } {
  const yaw = o.yaw ?? bearing;
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  let min = Infinity;
  let max = -Infinity;
  const halfL = (o.occlusionLength ?? o.length) * 0.5;
  const halfW = (o.occlusionWidth ?? o.width) * 0.5;
  for (const along of [-1, 1]) {
    for (const side of [-1, 1]) {
      const x = o.x + along * halfL * cs - side * halfW * sn;
      const y = o.y + along * halfL * sn + side * halfW * cs;
      const angle = wrapAngle(Math.atan2(y - egoY, x - egoX) - bearing);
      if (angle < min) min = angle;
      if (angle > max) max = angle;
    }
  }
  return { min, max };
}

function polarToCartesianCov(
  theta: number,
  varRadial: number,
  varCross: number,
): [[number, number], [number, number]] {
  const vr = Math.max(varRadial, 1e-5);
  const vc = Math.max(varCross, 1e-5);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const r00 = c * c * vr + s * s * vc;
  const r01 = c * s * (vr - vc);
  const r11 = s * s * vr + c * c * vc;
  return [
    [r00, r01],
    [r01, r11],
  ];
}

export class Sensor {
  config: SensorConfig;
  readonly rng: Rng;

  constructor(config: Partial<SensorConfig> = {}, rng: Rng = new Rng(1)) {
    this.config = { ...DEFAULT_SENSOR, ...config };
    this.rng = rng;
  }

  /** Produce noisy detections of the objects the ego can currently perceive. */
  sense(
    egoX: number,
    egoY: number,
    objects: SensableObject[],
    heading = this.config.heading,
    simTime?: number,
  ): Detection[] {
    const cfg = this.config;
    const occlusionMode: OcclusionMode = !cfg.occlusion ? "off" : (cfg.occlusionMode ?? "full");

    const cand = objects
      .map((o) => {
        const dx = o.x - egoX;
        const dy = o.y - egoY;
        return { o, dist: Math.hypot(dx, dy), bearing: Math.atan2(dy, dx) };
      })
      .filter((c) => c.dist <= cfg.range)
      .filter((c) => {
        if (cfg.fov >= Math.PI - 0.01) return true;
        let off = c.bearing - heading;
        while (off > Math.PI) off -= Math.PI * 2;
        while (off < -Math.PI) off += Math.PI * 2;
        return Math.abs(off) <= cfg.fov;
      })
      .sort((a, b) => a.dist - b.dist);

    const detections: Detection[] = [];
    const blockers: { bearing: number; min: number; max: number }[] = [];

    for (const c of cand) {
      const o = c.o;
      const { min, max } = computeAngularSpan(egoX, egoY, c.bearing, o);

      if (occlusionMode !== "off") {
        const subjectToOcclusion = occlusionMode === "full" || o.kind === "ped";
        let occluded = false;
        if (subjectToOcclusion) {
          for (const b of blockers) {
            const db = wrapAngle(c.bearing - b.bearing);
            if (db + min > b.min + 0.005 && db + max < b.max - 0.005) {
              occluded = true;
              break;
            }
          }
        }
        // Only solid, wide objects (vehicles) meaningfully occlude.
        if (o.kind === "car") blockers.push({ bearing: c.bearing, min, max });
        if (occluded) continue;
      }

      // Random dropout of an otherwise-visible object.
      if (this.rng.next() < cfg.dropout) continue;

      // Confidence falls with range and grows with apparent size.
      const sizeScore = Math.min(1, Math.max(o.width, o.length) / 4.5);
      const rangeScore = 1 - c.dist / Math.max(cfg.range, 1);
      const confidence = Math.min(1, 0.35 + 0.45 * sizeScore + 0.2 * rangeScore + this.rng.normal() * 0.03);

      detections.push({
        x: o.x + this.rng.normal() * cfg.posNoise,
        y: o.y + this.rng.normal() * cfg.posNoise,
        length: Math.max(0.5, o.length + this.rng.normal() * cfg.sizeNoise),
        width: Math.max(0.5, o.width + this.rng.normal() * cfg.sizeNoise),
        kind: o.kind,
        ...(o.roadBoundary ? { roadBoundary: { ...o.roadBoundary } } : {}),
        confidence: Math.min(1, Math.max(0.05, confidence)),
        ...(simTime !== undefined ? { timestamp: simTime } : {}),
        ...(cfg.latencySec !== undefined ? { latencySec: cfg.latencySec } : {}),
        ...(o.vx !== undefined && o.vy !== undefined
          ? {
              vx: o.vx + this.rng.normal() * cfg.velocityNoise,
              vy: o.vy + this.rng.normal() * cfg.velocityNoise,
              velocityVariance: Math.max(cfg.velocityNoise ** 2, 0.0001),
            }
          : {}),
      });
    }
    return detections;
  }
}

export interface DualChannelEnvironment {
  weather: "clear" | "rain" | "fog";
  night: boolean;
  /** Ego chassis pitch angle (rad; negative = nose-dive under braking). */
  bodyPitchRad: number;
  cameraAvailable: boolean;
  frontRadarAvailable: boolean;
  rearRadarAvailable: boolean;
  /** Reference SensorConfig to honor explicit test overrides (posNoise, dropout, range, occlusion). */
  referenceConfig?: SensorConfig;
  simTime?: number;
}

export interface DeliveredSensorScan {
  sampledAt: number;
  availableAt: number;
  deliveredAt: number;
  sampleIntervalSec: number;
  detections: Detection[];
}

interface PendingSensorScan extends Omit<DeliveredSensorScan, "deliveredAt"> {
  availability: Pick<DualChannelEnvironment, "cameraAvailable" | "frontRadarAvailable" | "rearRadarAvailable">;
}

function copyDetection(detection: Detection): Detection {
  return { ...detection,
    ...(detection.roadBoundary ? { roadBoundary: { ...detection.roadBoundary } } : {}),
    ...(detection.measCov ? { measCov: detection.measCov.map(row => [...row]) as [[number, number], [number, number]] } : {}),
  };
}

/**
 * Optimal 2x2 Inverse-Covariance (Information Filter) fusion of Radar and Camera detections.
 * Preserves Radar radial accuracy + Doppler velocity while sharpening lateral lane position
 * and semantic VRU classification with Camera optical bearings.
 */
export function fuseRadarCameraDetections(
  radarDets: readonly Detection[],
  cameraDets: readonly Detection[],
): Detection[] {
  if (radarDets.length === 0) return cameraDets.map((d) => ({ ...d }));
  if (cameraDets.length === 0) return radarDets.map((d) => ({ ...d }));

  const pairs: { ri: number; ci: number; maha2: number; euclid: number }[] = [];
  for (let ri = 0; ri < radarDets.length; ri++) {
    const r = radarDets[ri];
    const covR = r.measCov ?? [
      [0.25, 0],
      [0, 0.25],
    ];
    for (let ci = 0; ci < cameraDets.length; ci++) {
      const c = cameraDets[ci];
      if (r.kind !== c.kind || !!r.roadBoundary !== !!c.roadBoundary) continue;
      const dx = r.x - c.x;
      const dy = r.y - c.y;
      const euclid = Math.hypot(dx, dy);
      const covC = c.measCov ?? [
        [0.25, 0],
        [0, 0.25],
      ];
      const maxPreGate = Math.min(
        13.0,
        Math.max(5.5, 4.0 * Math.sqrt(Math.max(covR[0][0] + covC[0][0], covR[1][1] + covC[1][1], 0.25))),
      );
      if (euclid > maxPreGate) continue;
      const sumCov: number[][] = [
        [covR[0][0] + covC[0][0] + 1e-4, covR[0][1] + covC[0][1]],
        [covR[1][0] + covC[1][0], covR[1][1] + covC[1][1] + 1e-4],
      ];
      const invSum = inv2(sumCov);
      const maha2 =
        dx * (invSum[0][0] * dx + invSum[0][1] * dy) +
        dy * (invSum[1][0] * dx + invSum[1][1] * dy);
      const maxEuclidGate = r.kind === "car" ? 4.2 : 2.4;
      if (maha2 <= 25.0 || euclid <= maxEuclidGate) {
        pairs.push({ ri, ci, maha2, euclid });
      }
    }
  }
  pairs.sort((a, b) => (a.maha2 - b.maha2) || (a.euclid - b.euclid) || (a.ri - b.ri) || (a.ci - b.ci));

  const usedR = new Array(radarDets.length).fill(false);
  const usedC = new Array(cameraDets.length).fill(false);
  const fused: Detection[] = [];

  for (const p of pairs) {
    if (usedR[p.ri] || usedC[p.ci]) continue;
    usedR[p.ri] = true;
    usedC[p.ci] = true;
    const r = radarDets[p.ri];
    const c = cameraDets[p.ci];

    const covR = r.measCov ?? [
      [0.2, 0],
      [0, 0.2],
    ];
    const covC = c.measCov ?? [
      [0.2, 0],
      [0, 0.2],
    ];
    const infR = inv2(covR);
    const infC = inv2(covC);
    const infSum: number[][] = [
      [infR[0][0] + infC[0][0], infR[0][1] + infC[0][1]],
      [infR[1][0] + infC[1][0], infR[1][1] + infC[1][1]],
    ];
    const covF = inv2(infSum);
    const rhsX = infR[0][0] * r.x + infR[0][1] * r.y + infC[0][0] * c.x + infC[0][1] * c.y;
    const rhsY = infR[1][0] * r.x + infR[1][1] * r.y + infC[1][0] * c.x + infC[1][1] * c.y;
    const fx = covF[0][0] * rhsX + covF[0][1] * rhsY;
    const fy = covF[1][0] * rhsX + covF[1][1] * rhsY;

    const confFused = Math.min(0.995, 1 - (1 - r.confidence) * (1 - c.confidence));
    fused.push({
      x: fx,
      y: fy,
      // Camera excels at bounding-box width; blend length & width with higher camera weight
      length: 0.35 * r.length + 0.65 * c.length,
      width: 0.25 * r.width + 0.75 * c.width,
      kind: c.kind,
      ...(r.roadBoundary || c.roadBoundary
        ? { roadBoundary: { ...(c.roadBoundary ?? r.roadBoundary)! } }
        : {}),
      confidence: confFused,
      ...(r.timestamp !== undefined || c.timestamp !== undefined
        ? { timestamp: Math.max(r.timestamp ?? 0, c.timestamp ?? 0) }
        : {}),
      // Effective latency weighted toward faster Radar Doppler trigger
      latencySec: Math.min(r.latencySec ?? 0.035, c.latencySec ?? 0.055),
      ...(r.vx !== undefined && r.vy !== undefined
        ? { vx: r.vx, vy: r.vy, velocityVariance: r.velocityVariance }
        : {}),
      measCov: [
        [Math.max(covF[0][0], 1e-5), covF[0][1]],
        [covF[1][0], Math.max(covF[1][1], 1e-5)],
      ],
      sensorChannel: "fused",
      radarDetected: true,
      cameraDetected: true,
    });
  }

  for (let ri = 0; ri < radarDets.length; ri++) {
    if (!usedR[ri]) fused.push({ ...radarDets[ri] });
  }
  for (let ci = 0; ci < cameraDets.length; ci++) {
    if (!usedC[ci]) fused.push({ ...cameraDets[ci] });
  }
  return fused;
}

/**
 * Physical 2-channel ADAS perception front-end (77 GHz Radar + Windshield Camera).
 */
export class DualChannelSensorSuite {
  readonly rng: Rng;
  lastRadarDetections: Detection[] = [];
  lastCameraDetections: Detection[] = [];
  lastFusedDetections: Detection[] = [];
  private pendingScans: PendingSensorScan[] = [];
  private lastCaptureTime: number | null = null;
  private lastDeliveryTime: number | null = null;
  private lastDeliveredSampleTime: number | null = null;

  /** [SOURCE / SIMULATION_ASSUMPTION] 77 GHz LRR/MRR automotive radar envelope. */
  readonly radarSpec = {
    lrrRangeM: 180,
    lrrHalfFovRad: (11 * Math.PI) / 180,
    mrrRangeM: 76,
    mrrHalfFovRad: (45 * Math.PI) / 180,
    surroundRangeM: 105,
    movingPedMaxRangeM: 44,
    staticPedMaxRangeM: 22,
    rangeNoiseStdM: 0.18,
    azimuthNoiseStdRad: (0.72 * Math.PI) / 180,
    radialVelNoiseStdMps: 0.12,
    crossVelNoiseStdMps: 0.24,
    latencySec: 0.035,
  };

  /** [SOURCE / SIMULATION_ASSUMPTION] Forward windshield ADAS camera + surround fisheye. */
  readonly cameraSpec = {
    nominalRangeM: 118,
    forwardHalfFovRad: (43 * Math.PI) / 180,
    surroundCloseRangeM: 26,
    azimuthNoiseStdRad: (0.20 * Math.PI) / 180,
    baseDepthNoiseM: 0.12,
    depthNoisePerMetre: 0.022,
    pitchHorizonSlope: 6.8,
    latencySec: 0.055,
  };

  constructor(rng: Rng = new Rng(0x9e3779b9)) {
    this.rng = rng;
  }

  /** Runtime scan acquisition. The standalone `sense` APIs intentionally stay
   * instantaneous for optical/radar calibration tests. Runtime fusion waits for
   * the slowest enabled channel in the SAME exposure: 55ms for camera+radar,
   * 35ms for radar only by default. This is an explicit BlueLine fusion-deadline
   * policy, not asynchronous OEM sensor fusion or a hardware calibration. */
  capture(
    egoX: number, egoY: number, egoYaw: number, objects: SensableObject[],
    env: DualChannelEnvironment & { simTime: number },
  ): void {
    if (!Number.isFinite(env.simTime)) throw new Error("Sensor capture requires a finite simulation timestamp");
    if (this.lastCaptureTime !== null && env.simTime < this.lastCaptureTime - 1e-9) this.reset();
    // An accidental repeated acquisition in one physics tick must not mature
    // tracks from multiple copies of the same exposure.
    if (this.lastCaptureTime !== null && Math.abs(env.simTime - this.lastCaptureTime) < 1e-9) return;
    const interval = this.lastCaptureTime === null ? 0 : env.simTime - this.lastCaptureTime;
    this.lastCaptureTime = env.simTime;
    const delay = clamp(Math.max(
      env.cameraAvailable ? this.cameraSpec.latencySec : 0,
      env.frontRadarAvailable || env.rearRadarAvailable ? this.radarSpec.latencySec : 0,
    ), 0, 1);
    const detections = this.sense(egoX, egoY, egoYaw, objects, env)
      .map(detection => ({ ...copyDetection(detection), timestamp: env.simTime, latencySec: delay }));
    this.pendingScans.push({ sampledAt: env.simTime, availableAt: env.simTime + delay,
      sampleIntervalSec: interval, detections,
      availability: { cameraAvailable: env.cameraAvailable, frontRadarAvailable: env.frontRadarAvailable, rearRadarAvailable: env.rearRadarAvailable } });
    // Bound memory if a caller stops polling. Normal runtime holds four scans.
    if (this.pendingScans.length > 256) this.pendingScans.splice(0, this.pendingScans.length - 256);
  }

  /** Deliver completed immutable scans, including EMPTY sweeps, so the tracker
   * can distinguish real missed detections from processing that is still in
   * flight. Data sampled before a failed channel is conservatively discarded. */
  poll(
    simTime: number,
    availability?: Pick<DualChannelEnvironment, "cameraAvailable" | "frontRadarAvailable" | "rearRadarAvailable">,
  ): DeliveredSensorScan[] {
    if (!Number.isFinite(simTime)) throw new Error("Sensor delivery requires a finite simulation timestamp");
    if (this.lastDeliveryTime !== null && simTime < this.lastDeliveryTime - 1e-9) this.reset();
    this.lastDeliveryTime = simTime;
    const delivered: DeliveredSensorScan[] = [], pending: PendingSensorScan[] = [];
    for (const scan of this.pendingScans) {
      if (this.lastDeliveredSampleTime !== null && scan.sampledAt <= this.lastDeliveredSampleTime + 1e-9) continue;
      if (availability && ((scan.availability.cameraAvailable && !availability.cameraAvailable) ||
        (scan.availability.frontRadarAvailable && !availability.frontRadarAvailable) ||
        (scan.availability.rearRadarAvailable && !availability.rearRadarAvailable))) continue;
      if (scan.availableAt > simTime + 1e-9) { pending.push(scan); continue; }
      delivered.push({ sampledAt: scan.sampledAt, availableAt: scan.availableAt, deliveredAt: simTime,
        sampleIntervalSec: scan.sampleIntervalSec,
        detections: scan.detections.map(detection => ({ ...copyDetection(detection), deliveredAt: simTime })) });
    }
    this.pendingScans = pending;
    // Acquisition order prevents a newly faster configuration from applying an
    // older observation after a newer one in the same delivery tick.
    delivered.sort((a, b) => a.sampledAt - b.sampledAt);
    if (delivered.length) this.lastDeliveredSampleTime = delivered[delivered.length - 1].sampledAt;
    return delivered;
  }

  reset(): void {
    this.pendingScans = [];
    this.lastCaptureTime = this.lastDeliveryTime = this.lastDeliveredSampleTime = null;
    this.lastRadarDetections = []; this.lastCameraDetections = []; this.lastFusedDetections = [];
  }

  sense(
    egoX: number,
    egoY: number,
    egoYaw: number,
    objects: SensableObject[],
    env: DualChannelEnvironment,
  ): Detection[] {
    const radarDets =
      env.frontRadarAvailable || env.rearRadarAvailable
        ? this.senseRadar(egoX, egoY, egoYaw, objects, env)
        : [];
    const cameraDets = env.cameraAvailable
      ? this.senseCamera(egoX, egoY, egoYaw, objects, env)
      : [];
    const fused = fuseRadarCameraDetections(radarDets, cameraDets);
    this.lastRadarDetections = radarDets;
    this.lastCameraDetections = cameraDets;
    this.lastFusedDetections = fused;
    return fused;
  }

  senseRadar(
    egoX: number,
    egoY: number,
    egoYaw: number,
    objects: SensableObject[],
    env: DualChannelEnvironment,
  ): Detection[] {
    const ref = env.referenceConfig;
    const basePosNoise = env.weather === "rain" ? 0.6 : env.weather === "fog" ? 0.5 : 0.35;
    const noiseScale = ref ? clamp(ref.posNoise / Math.max(basePosNoise, 1e-4), 0, 4) : 1;
    const velNoiseScale = ref ? clamp(ref.velocityNoise / 0.25, 0, 4) : 1;
    const nominalRefRange = env.weather === "rain" ? 165 : env.weather === "fog" ? 150 : 180;
    const rangeScale = ref ? clamp(ref.range / nominalRefRange, 0.05, 2.0) : 1;
    const occlusionEnabled = ref ? ref.occlusion : true;

    let dropoutProb = env.weather === "rain" ? 0.035 : 0.018;
    if (ref) {
      if (ref.dropout === 0) dropoutProb = 0;
      else if (ref.dropout >= 0.99) dropoutProb = 1;
      else dropoutProb = clamp(dropoutProb * (ref.dropout / 0.04), 0, 1);
    }

    // 77 GHz millimeter-wave is virtually unaffected by darkness and fog, mildly attenuated by heavy rain.
    const weatherRangeFactor = env.weather === "rain" ? 0.91 : env.weather === "fog" ? 0.98 : 1.0;

    const cand = objects
      .map((o) => {
        const dx = o.x - egoX;
        const dy = o.y - egoY;
        const dist = Math.hypot(dx, dy);
        const bearing = Math.atan2(dy, dx);
        const relAngle = Math.abs(wrapAngle(bearing - egoYaw));
        return { o, dist, bearing, relAngle };
      })
      .filter((c) => {
        let maxR = 0;
        if (env.frontRadarAvailable && c.relAngle <= this.radarSpec.lrrHalfFovRad) {
          maxR = this.radarSpec.lrrRangeM;
        } else if (env.frontRadarAvailable && c.relAngle <= this.radarSpec.mrrHalfFovRad) {
          maxR = this.radarSpec.mrrRangeM;
        } else if (env.rearRadarAvailable && c.o.kind === "car") {
          maxR = this.radarSpec.surroundRangeM;
        }
        maxR *= weatherRangeFactor * rangeScale;
        if (c.o.kind === "ped") {
          const speed = Math.hypot(c.o.vx ?? 0, c.o.vy ?? 0);
          const pedCap =
            (speed >= 0.25 ? this.radarSpec.movingPedMaxRangeM : this.radarSpec.staticPedMaxRangeM) *
            rangeScale;
          maxR = Math.min(maxR, pedCap);
        }
        return maxR > 0 && c.dist <= maxR;
      })
      .sort((a, b) => a.dist - b.dist);

    const detections: Detection[] = [];
    const blockers: { bearing: number; min: number; max: number }[] = [];

    for (const c of cand) {
      const o = c.o;
      const { min, max } = computeAngularSpan(egoX, egoY, c.bearing, o);

      if (occlusionEnabled) {
        let shadowCount = 0;
        for (const b of blockers) {
          const db = wrapAngle(c.bearing - b.bearing);
          if (db + min > b.min + 0.005 && db + max < b.max - 0.005) {
            shadowCount++;
          }
        }
        if (o.kind === "car") blockers.push({ bearing: c.bearing, min, max });
        // Pedestrians have zero under-body multi-bounce; metal vehicles tolerate 1 intervening car via ground bounce
        const occluded = o.kind === "ped" ? shadowCount >= 1 : shadowCount >= 2;
        if (occluded) continue;
      }

      if (dropoutProb >= 1 || (dropoutProb > 0 && this.rng.next() < dropoutProb)) continue;

      const sigmaR = this.radarSpec.rangeNoiseStdM * noiseScale * (env.weather === "rain" ? 1.2 : 1.0);
      const sigmaTheta = this.radarSpec.azimuthNoiseStdRad * noiseScale;
      const sigmaCross = Math.max(0.08 * noiseScale, c.dist * sigmaTheta);

      const rMeas = Math.max(0.15, c.dist + this.rng.normal() * sigmaR);
      const thetaMeas = c.bearing + this.rng.normal() * sigmaTheta;
      const xMeas = noiseScale === 0 ? o.x : egoX + rMeas * Math.cos(thetaMeas);
      const yMeas = noiseScale === 0 ? o.y : egoY + rMeas * Math.sin(thetaMeas);

      const measCov = polarToCartesianCov(thetaMeas, sigmaR * sigmaR, sigmaCross * sigmaCross);

      const speed = Math.hypot(o.vx ?? 0, o.vy ?? 0);
      const rcsScore = o.kind === "car" ? 0.92 : speed >= 0.25 ? 0.58 : 0.42;
      const rangeScore = clamp(1 - c.dist / this.radarSpec.lrrRangeM, 0, 1);
      const conf = clamp(0.28 + 0.52 * rcsScore + 0.20 * rangeScore + this.rng.normal() * 0.025 * noiseScale, 0.1, 0.98);

      let vxMeas: number | undefined;
      let vyMeas: number | undefined;
      let velVar: number | undefined;
      if (o.vx !== undefined && o.vy !== undefined) {
        const cr = Math.cos(c.bearing);
        const sr = Math.sin(c.bearing);
        const vrTrue = o.vx * cr + o.vy * sr;
        const vtTrue = -o.vx * sr + o.vy * cr;
        const sigmaVr = this.radarSpec.radialVelNoiseStdMps * velNoiseScale;
        const sigmaVt = this.radarSpec.crossVelNoiseStdMps * velNoiseScale;
        const vrMeas = vrTrue + this.rng.normal() * sigmaVr;
        const vtMeas = vtTrue + this.rng.normal() * sigmaVt;
        vxMeas = velNoiseScale === 0 ? o.vx : vrMeas * cr - vtMeas * sr;
        vyMeas = velNoiseScale === 0 ? o.vy : vrMeas * sr + vtMeas * cr;
        velVar = Math.max(0.5 * (sigmaVr * sigmaVr + sigmaVt * sigmaVt), 1e-4);
      }

      detections.push({
        x: xMeas,
        y: yMeas,
        length: Math.max(0.45, o.length + this.rng.normal() * 0.22 * noiseScale),
        width: Math.max(0.45, o.width + this.rng.normal() * 0.22 * noiseScale),
        kind: o.kind,
        ...(o.roadBoundary ? { roadBoundary: { ...o.roadBoundary } } : {}),
        confidence: conf,
        ...(env.simTime !== undefined ? { timestamp: env.simTime } : {}),
        latencySec: this.radarSpec.latencySec,
        ...(vxMeas !== undefined && vyMeas !== undefined
          ? { vx: vxMeas, vy: vyMeas, velocityVariance: velVar }
          : {}),
        measCov,
        sensorChannel: "radar",
        radarDetected: true,
        cameraDetected: false,
      });
    }
    return detections;
  }

  senseCamera(
    egoX: number,
    egoY: number,
    egoYaw: number,
    objects: SensableObject[],
    env: DualChannelEnvironment,
  ): Detection[] {
    const ref = env.referenceConfig;
    const basePosNoise = env.weather === "rain" ? 0.6 : env.weather === "fog" ? 0.5 : 0.35;
    const noiseScale = ref ? clamp(ref.posNoise / Math.max(basePosNoise, 1e-4), 0, 4) : 1;
    const nominalRefRange = env.weather === "rain" ? 165 : env.weather === "fog" ? 150 : 180;
    const rangeScale = ref ? clamp(ref.range / nominalRefRange, 0.05, 2.0) : 1;
    const occlusionEnabled = ref ? ref.occlusion : true;

    // Optical Beer-Lambert visibility attenuation in rain, fog, and night
    const wxRangeFactor = env.weather === "fog" ? 0.34 : env.weather === "rain" ? 0.62 : 1.0;
    const nightRangeFactor = env.night ? 0.56 : 1.0;

    // Chassis pitch (`bodyPitchRad < 0` during heavy braking nose-dive) depresses the optical
    // sightline toward the asphalt, foreshortening far-field camera horizon range.
    const noseDiveRad = Math.max(0, -env.bodyPitchRad - 0.005);
    const pitchRangeFactor = clamp(1 - this.cameraSpec.pitchHorizonSlope * noseDiveRad, 0.54, 1.0);

    const maxForwardRange =
      this.cameraSpec.nominalRangeM * wxRangeFactor * nightRangeFactor * pitchRangeFactor * rangeScale;
    const maxSurroundRange =
      this.cameraSpec.surroundCloseRangeM * Math.max(0.5, wxRangeFactor) * (env.night ? 0.72 : 1.0) * rangeScale;

    let dropoutProb =
      env.weather === "fog" ? 0.11 : env.weather === "rain" ? 0.065 : env.night ? 0.05 : 0.022;
    if (ref) {
      if (ref.dropout === 0) dropoutProb = 0;
      else if (ref.dropout >= 0.99) dropoutProb = 1;
      else dropoutProb = clamp(dropoutProb * (ref.dropout / 0.04), 0, 1);
    }

    const cand = objects
      .map((o) => {
        const dx = o.x - egoX;
        const dy = o.y - egoY;
        const dist = Math.hypot(dx, dy);
        const bearing = Math.atan2(dy, dx);
        const relAngle = Math.abs(wrapAngle(bearing - egoYaw));
        return { o, dist, bearing, relAngle };
      })
      .filter((c) => {
        const limit =
          c.relAngle <= this.cameraSpec.forwardHalfFovRad ? maxForwardRange : maxSurroundRange;
        return c.dist <= limit;
      })
      .sort((a, b) => a.dist - b.dist);

    const detections: Detection[] = [];
    const blockers: { bearing: number; min: number; max: number }[] = [];

    for (const c of cand) {
      const o = c.o;
      const { min, max } = computeAngularSpan(egoX, egoY, c.bearing, o);

      // Strict optical line-of-sight occlusion: solid vehicles block all behind-silhouette objects
      if (occlusionEnabled) {
        let occluded = false;
        for (const b of blockers) {
          const db = wrapAngle(c.bearing - b.bearing);
          if (db + min > b.min + 0.005 && db + max < b.max - 0.005) {
            occluded = true;
            break;
          }
        }
        if (o.kind === "car") blockers.push({ bearing: c.bearing, min, max });
        if (occluded) continue;
      }

      if (dropoutProb >= 1 || (dropoutProb > 0 && this.rng.next() < dropoutProb)) continue;

      const opticalDegrade = (env.weather === "clear" ? 1.0 : 1.4) * (env.night ? 1.25 : 1.0);
      const sigmaTheta = this.cameraSpec.azimuthNoiseStdRad * noiseScale * opticalDegrade;
      const sigmaCross = Math.max(0.03 * noiseScale, c.dist * sigmaTheta);
      const pitchDepthSpread = 0.35 * c.dist * Math.abs(env.bodyPitchRad);
      const sigmaR =
        (this.cameraSpec.baseDepthNoiseM + this.cameraSpec.depthNoisePerMetre * c.dist + pitchDepthSpread) *
        noiseScale *
        opticalDegrade;

      // Physical monocular Inverse-Perspective-Mapping (IPM) range foreshortening under nose-dive:
      // Camera height H_cam ≈ 1.35 m; residual uncompensated pitch δθ ≈ 0.045 * noseDiveRad shifts
      // ground-plane contact ray r_ipm = d / (1 + d * δθ / H_cam) (tiny at 10m, significant at >45m).
      const residualPitchRad = 0.045 * noseDiveRad;
      const ipmShift = c.dist / (1 + (c.dist * residualPitchRad) / 1.35) - c.dist;
      const pitchRangeBias =
        noiseScale > 0 ? clamp(ipmShift, -4.5, 0) * Math.min(noiseScale, 1) : 0;

      const rMeas = Math.max(0.15, c.dist + pitchRangeBias + this.rng.normal() * sigmaR);
      const thetaMeas = c.bearing + this.rng.normal() * sigmaTheta;
      const xMeas = noiseScale === 0 ? o.x : egoX + rMeas * Math.cos(thetaMeas);
      const yMeas = noiseScale === 0 ? o.y : egoY + rMeas * Math.sin(thetaMeas);

      const measCov = polarToCartesianCov(
        thetaMeas,
        sigmaR * sigmaR + pitchRangeBias * pitchRangeBias,
        sigmaCross * sigmaCross,
      );

      // Camera has strong VRU/pedestrian semantic recognition in clear line-of-sight
      const classScore = o.kind === "ped" ? 0.90 : 0.88;
      const rangeScore = clamp(1 - c.dist / Math.max(maxForwardRange, 1), 0, 1);
      const conf = clamp(
        (0.32 + 0.46 * classScore + 0.22 * rangeScore) * (env.weather === "fog" ? 0.82 : 1.0) +
          this.rng.normal() * 0.025 * noiseScale,
        0.1,
        0.99,
      );

      detections.push({
        x: xMeas,
        y: yMeas,
        length: Math.max(0.42, o.length + this.rng.normal() * 0.09 * noiseScale),
        width: Math.max(0.42, o.width + this.rng.normal() * 0.07 * noiseScale),
        kind: o.kind,
        ...(o.roadBoundary ? { roadBoundary: { ...o.roadBoundary } } : {}),
        confidence: conf,
        ...(env.simTime !== undefined ? { timestamp: env.simTime } : {}),
        latencySec: this.cameraSpec.latencySec,
        // Camera has no direct Doppler velocity (`vx`, `vy` omitted -> estimated by Kalman over frames unless fused with Radar)
        measCov,
        sensorChannel: "camera",
        radarDetected: false,
        cameraDetected: true,
      });
    }
    return detections;
  }
}
