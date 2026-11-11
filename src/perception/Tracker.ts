// Tracker — a multi-object tracker built on constant-velocity Kalman filters.
//
// This is the bridge from raw perception to prediction: noisy, unlabelled
// detections come in each frame; the tracker associates them to persistent
// tracks (nearest-neighbour gating), runs a Kalman filter per track to smooth
// position AND estimate velocity, coasts through brief occlusions, and only
// promotes a track to "confirmed" after a few consistent hits. The planner then
// predicts each confirmed track forward using its estimated velocity.

import { Mat, Vec, add, identity, inv2, mul, mulVec, sub, transpose } from "../core/mat.ts";
import { Detection, SensorModality } from "./Sensor.ts";
import { ObstacleKind } from "../planner/Trajectory.ts";

const H: Mat = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
];
const HT = transpose(H);

/** Only the timed runtime pipeline marks a measurement as actually delayed.
 * Legacy direct sensor fixtures may carry timestamps/latency metadata without
 * delayed delivery, and must retain their established instantaneous contract. */
function measurementAge(det: Detection, simTime?: number): number {
  if (det.deliveredAt === undefined || det.timestamp === undefined || simTime === undefined) return 0;
  return Math.min(1, Math.max(0, simTime - det.timestamp));
}

function observationMatrix(age: number): Mat {
  // z(sample time) = p(now) - age * v(now) under the CV model. Updating this
  // delayed observation model avoids pretending the old measured pose is now,
  // or re-projecting a camera measurement with its own prior as fake new data.
  return age > 0 ? [[1, 0, -age, 0], [0, 1, 0, -age]] : H;
}

export class Track {
  id: number;
  x: Vec; // [px, py, vx, vy]
  P: Mat;
  hits = 1;
  misses = 0;
  age = 0;
  /** Simulation-time age of this track since creation (s). */
  ageSec = 0;
  /** Simulation time elapsed since the last matched sensor detection (s). */
  coastingSec = 0;
  /** Simulation timestamp (s) of the last matched detection. */
  lastTimestamp = 0;
  /** Measurement latency (s) reported by the last matched detection. */
  latencySec = 0;
  /** Smoothed existence/measurement confidence in [0, 1]. */
  confidence: number;
  /** Estimated world acceleration components (m/s²) from dual-EMA velocity trend. */
  ax = 0;
  ay = 0;
  confirmed = false;
  length: number;
  width: number;
  kind: ObstacleKind;
  roadBoundary?: { d: number; width: number };
  sensorChannel: SensorModality = "legacy";
  radarMatched = false;
  cameraMatched = false;

  private sigmaA = 3.0; // process (acceleration) noise (m/s²)
  private measVar: number;
  private vxFast: number;
  private vyFast: number;
  private vxSlow: number;
  private vySlow: number;
  private timedDelivery: boolean;

  constructor(id: number, det: Detection, measNoise: number, simTime = 0) {
    this.id = id;
    this.timedDelivery = det.deliveredAt !== undefined;
    const vx0 = det.vx ?? 0;
    const vy0 = det.vy ?? 0;
    this.x = [det.x, det.y, vx0, vy0];
    let p00 = 1;
    let p01 = 0;
    let p11 = 1;
    if (det.measCov) {
      const covScale = Math.min(1, 2.5 / Math.max(det.measCov[0][0], det.measCov[1][1], 1e-6));
      p00 = Math.max(0.05, det.measCov[0][0] * covScale);
      p11 = Math.max(0.05, det.measCov[1][1] * covScale);
      p01 = det.measCov[0][1] * covScale;
    }
    this.P = [
      [p00, p01, 0, 0],
      [p01, p11, 0, 0],
      [0, 0, det.velocityVariance ?? 25, 0],
      [0, 0, 0, det.velocityVariance ?? 25],
    ];
    this.length = det.length;
    this.width = det.width;
    this.kind = det.kind;
    this.roadBoundary = det.roadBoundary ? { ...det.roadBoundary } : undefined;
    this.sensorChannel = det.sensorChannel ?? "legacy";
    this.radarMatched = Boolean(det.radarDetected);
    this.cameraMatched = Boolean(det.cameraDetected);
    this.measVar = measNoise * measNoise;
    this.lastTimestamp = det.timestamp ?? simTime;
    this.latencySec = det.latencySec ?? 0;
    this.confidence = Math.min(0.72, Math.max(0.25, det.confidence * 0.75));
    this.vxFast = vx0;
    this.vyFast = vy0;
    this.vxSlow = vx0;
    this.vySlow = vy0;
    const delayAge = measurementAge(det, simTime);
    if (delayAge > 0) this.predict(delayAge);
  }

  predict(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // A timed-delivery track lives at the current physics epoch, including
    // between completed scans. Established measured acceleration must advance
    // that state too; otherwise delayed Doppler repeatedly restores an old
    // braking speed and the tracker adds a second, unintended processing lag.
    const halfDt2 = 0.5 * dt * dt;
    const F: Mat = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    this.x = mulVec(F, this.x);
    if ((this.timedDelivery || this.coastingSec > 0) && (this.ax !== 0 || this.ay !== 0)) {
      const prevSpeed = Math.hypot(this.x[2], this.x[3]);
      const nextVx = this.x[2] + this.ax * dt;
      const nextVy = this.x[3] + this.ay * dt;
      // Do not extrapolate braking through standstill into reverse travel.
      if (prevSpeed >= 0.05 && nextVx * this.x[2] + nextVy * this.x[3] > 0) {
        this.x[0] += this.ax * halfDt2;
        this.x[1] += this.ay * halfDt2;
        this.x[2] = nextVx;
        this.x[3] = nextVy;
      } else {
        this.x[2] = 0;
        this.x[3] = 0;
        this.ax = 0;
        this.ay = 0;
      }
    }
    const q = this.sigmaA * this.sigmaA;
    const dt2 = dt * dt;
    const dt3 = dt2 * dt;
    const dt4 = dt3 * dt;
    const Q: Mat = [
      [(dt4 / 4) * q, 0, (dt3 / 2) * q, 0],
      [0, (dt4 / 4) * q, 0, (dt3 / 2) * q],
      [(dt3 / 2) * q, 0, dt2 * q, 0],
      [0, (dt3 / 2) * q, 0, dt2 * q],
    ];
    this.P = add(mul(mul(F, this.P), transpose(F)), Q);
    this.age++;
    this.ageSec += dt;
  }

  update(det: Detection, dt = 1 / 60, simTime?: number): void {
    this.timedDelivery = det.deliveredAt !== undefined;
    const delayAge = measurementAge(det, simTime);
    const observationH = observationMatrix(delayAge), observationHT = delayAge > 0 ? transpose(observationH) : HT;
    const z: Vec = [det.x, det.y];
    const Hx = mulVec(observationH, this.x);
    // The current acceleration estimate is not a new observation, but it
    // removes the known second-order offset when rewinding the CV position
    // model to an exposure taken during an established braking manoeuvre.
    Hx[0] += .5 * this.ax * delayAge ** 2;
    Hx[1] += .5 * this.ay * delayAge ** 2;
    const y = [z[0] - Hx[0], z[1] - Hx[1]];
    // S = H P Hᵀ + R (anisotropic 2x2 polar-rotated covariance when supplied by Radar/Camera/Fusion)
    const S = mul(mul(observationH, this.P), observationHT);
    if (det.measCov) {
      S[0][0] += det.measCov[0][0];
      S[0][1] += det.measCov[0][1];
      S[1][0] += det.measCov[1][0];
      S[1][1] += det.measCov[1][1];
    } else {
      S[0][0] += this.measVar;
      S[1][1] += this.measVar;
    }
    // Acceleration during processing is unobserved; include bounded model
    // uncertainty rather than attributing perfect motion to delayed samples.
    const delayedProcessVariance = .25 * this.sigmaA ** 2 * delayAge ** 4;
    S[0][0] += delayedProcessVariance; S[1][1] += delayedProcessVariance;
    const K = mul(mul(this.P, observationHT), inv2(S)); // 4×2 Kalman gain
    // x = x + K y
    const Ky = mulVec(K, y);
    this.x = this.x.map((v, i) => v + Ky[i]);
    // P = (I − K H) P
    const KH = mul(K, observationH);
    this.P = mul(sub(identity(4), KH), this.P);

    if (det.vx !== undefined && det.vy !== undefined) {
      // Sequential scalar velocity updates preserve the established position
      // tracker and also support older position-only detections.
      // Adaptive longitudinal braking gating: only inflate velocity covariance when scalar
      // Doppler speed drops sharply (e.g. sudden -8 m/s² CCRb emergency stop), never on
      // constant-speed road curves where Cartesian (vx, vy) merely rotates.
      const predSpeed = Math.hypot(this.x[2], this.x[3]);
      const measSpeed = Math.hypot(det.vx, det.vy);
      const suddenSpeedDrop = predSpeed > 2.0 && predSpeed - measSpeed > 1.25;
      // Doppler also describes the PAST exposure. Treating that old speed as
      // the current speed understates closing rate behind a braking lead.
      let currentMeasuredVx = det.vx + this.ax * delayAge;
      let currentMeasuredVy = det.vy + this.ay * delayAge;
      if (delayAge > 0 && (measSpeed < .05 || currentMeasuredVx * det.vx + currentMeasuredVy * det.vy <= 0)) {
        currentMeasuredVx = 0; currentMeasuredVy = 0;
      }
      for (const [axis, measured] of [[2, currentMeasuredVx], [3, currentMeasuredVy]]) {
        const oldP = this.P.map(row => [...row]);
        const rVel = (det.velocityVariance ?? .0625) + this.sigmaA ** 2 * delayAge ** 2;
        if (suddenSpeedDrop) {
          oldP[axis][axis] = Math.max(oldP[axis][axis], 0.24);
        }
        const variance = oldP[axis][axis] + rVel;
        const gain = oldP.map(row => row[axis] / variance);
        const innovation = measured - this.x[axis];
        this.x = this.x.map((value, i) => value + gain[i] * innovation);
        this.P = oldP.map((row, i) => row.map((value, j) => value - gain[i] * oldP[axis][j]));
      }
    }

    // Continuous-time dual-EMA velocity-trend acceleration estimator (dt-invariant).
    // Uses direct Doppler velocity when available so position noise in rain/fog does not lag emergency braking detection.
    const velSampleX = det.vx ?? this.x[2];
    const velSampleY = det.vy ?? this.x[3];
    const stepDt = Math.max(dt, 1e-4);
    const tauFast = 0.04;
    const tauSlow = 0.16;
    const alphaFast = 1 - Math.exp(-stepDt / tauFast);
    const alphaSlow = 1 - Math.exp(-stepDt / tauSlow);
    this.vxFast += (velSampleX - this.vxFast) * alphaFast;
    this.vyFast += (velSampleY - this.vyFast) * alphaFast;
    this.vxSlow += (velSampleX - this.vxSlow) * alphaSlow;
    this.vySlow += (velSampleY - this.vySlow) * alphaSlow;
    if (this.ageSec >= 0.05 && !det.roadBoundary) {
      const denom = Math.max(
        0.075,
        tauSlow * (1 - Math.exp(-this.ageSec / tauSlow)) - tauFast * (1 - Math.exp(-this.ageSec / tauFast)),
      );
      const rawAx = (this.vxFast - this.vxSlow) / denom;
      const rawAy = (this.vyFast - this.vySlow) / denom;
      const rawMag = Math.hypot(rawAx, rawAy);
      const deadband = 1.05;
      if (rawMag <= deadband) {
        const decay = Math.exp(-stepDt / 0.10);
        this.ax *= decay;
        this.ay *= decay;
      } else {
        const scale = Math.min(10, rawMag - deadband * 0.45) / rawMag;
        const targetAx = rawAx * scale;
        const targetAy = rawAy * scale;
        const smooth = 1 - Math.exp(-stepDt / 0.045);
        this.ax += (targetAx - this.ax) * smooth;
        this.ay += (targetAy - this.ay) * smooth;
      }
    } else {
      this.ax = 0;
      this.ay = 0;
    }

    // Smooth the reported extent a touch.
    this.length += (det.length - this.length) * 0.3;
    this.width += (det.width - this.width) * 0.3;
    this.kind = det.kind;
    this.roadBoundary = det.roadBoundary ? { ...det.roadBoundary } : undefined;
    this.sensorChannel = det.sensorChannel ?? "legacy";
    this.radarMatched = Boolean(det.radarDetected);
    this.cameraMatched = Boolean(det.cameraDetected);
    this.hits++;
    this.misses = 0;
    this.coastingSec = 0;
    if (det.timestamp !== undefined) this.lastTimestamp = Math.max(this.lastTimestamp, det.timestamp);
    else if (simTime !== undefined) this.lastTimestamp = simTime;
    this.latencySec = det.latencySec ?? 0;
    const hitMaturity = Math.min(1, this.hits / 3);
    const targetConf = Math.min(0.99, det.confidence * (0.65 + 0.35 * hitMaturity));
    this.confidence += (targetConf - this.confidence) * 0.45;
  }

  markCoasting(dt: number, missedSweep: boolean): void {
    if (missedSweep) {
      this.misses++;
      this.coastingSec += Math.max(0, dt);
      const decay = dt > 0 ? Math.exp(-dt / 0.24) : 0.85;
      this.confidence = Math.max(0.05, this.confidence * decay);
      this.ax *= decay;
      this.ay *= decay;
    }
  }

  get px(): number { return this.x[0]; }
  get py(): number { return this.x[1]; }
  get vx(): number { return this.x[2]; }
  get vy(): number { return this.x[3]; }
  get speed(): number { return Math.hypot(this.x[2], this.x[3]); }
  get posStd(): number { return Math.sqrt(Math.max(0, 0.5 * (this.P[0][0] + this.P[1][1]))); }
  get velStd(): number { return Math.sqrt(Math.max(0, 0.5 * (this.P[2][2] + this.P[3][3]))); }
}

export interface TrackerConfig {
  gate: number; // max association distance (m)
  confirmHits: number; // hits before a track is "confirmed"
  maxMisses: number; // fallback miss limit when dt === 0
  /** Maximum simulation-time coasting duration (s) without matched detections before track deletion. */
  maxCoastSec: number;
  measNoise: number; // measurement std-dev (should match sensor)
}

export const DEFAULT_TRACKER: TrackerConfig = {
  gate: 5.0,
  confirmHits: 3,
  maxMisses: 10,
  maxCoastSec: 0.35,
  measNoise: 0.35,
};

export interface TrackerUpdateOptions {
  /** Current simulation timestamp (s). */
  simTime?: number;
  /** True when a sensor scan completed on this tick; false between lower-rate scans
   *  ("no new sample this tick" -> propagate tracks without penalising misses). */
  hasNewSample?: boolean;
  /** Time between acquisitions, distinct from state propagation dt when a
   * completed lower-rate/delayed scan is delivered during a physics tick. */
  sampleIntervalSec?: number;
}

export class Tracker {
  tracks: Track[] = [];
  config: TrackerConfig;
  private nextId = 1;
  private clockSec = 0;

  constructor(config: Partial<TrackerConfig> = {}) {
    this.config = { ...DEFAULT_TRACKER, ...config };
  }

  update(detections: Detection[], dt: number, options: TrackerUpdateOptions = {}): Track[] {
    const cfg = this.config;
    const targetTime = options.simTime ?? (this.clockSec + Math.max(0, dt));
    if (targetTime < this.clockSec - 1e-9) this.reset();
    const stateDt = Math.max(0, targetTime - this.clockSec);
    this.clockSec = targetTime;
    const hasNewSample = options.hasNewSample ?? true;
    const sampleDt = Math.max(0, options.sampleIntervalSec ?? dt);

    // 1. Predict every existing track forward to the current simulation timestamp.
    for (const t of this.tracks) t.predict(stateDt);

    // Distinguish "no new sensor sample on this tick" from "sensor swept and saw nothing".
    if (!hasNewSample) {
      return this.confirmed();
    }

    // 2. Greedy nearest-neighbour association within the gate (deterministic tie-break by track id).
    const pairs: { ti: number; di: number; dist: number; trackId: number }[] = [];
    for (let ti = 0; ti < this.tracks.length; ti++) {
      for (let di = 0; di < detections.length; di++) {
        // A wall/guardrail cannot become a car or absorb a pedestrian simply
        // because their noisy positions fall inside the same distance gate.
        if (this.tracks[ti].kind !== detections[di].kind || !!this.tracks[ti].roadBoundary !== !!detections[di].roadBoundary) continue;
        const age = measurementAge(detections[di], this.clockSec);
        const dx = this.tracks[ti].px - this.tracks[ti].vx * age + .5 * this.tracks[ti].ax * age ** 2 - detections[di].x;
        const dy = this.tracks[ti].py - this.tracks[ti].vy * age + .5 * this.tracks[ti].ay * age ** 2 - detections[di].y;
        const dist = Math.hypot(dx, dy);
        if (dist <= cfg.gate) {
          pairs.push({ ti, di, dist, trackId: this.tracks[ti].id });
        } else if (detections[di].measCov && dist <= cfg.gate * 2.4) {
          const h = observationMatrix(age);
          const tp = age > 0 ? mul(mul(h, this.tracks[ti].P), transpose(h)) : this.tracks[ti].P;
          const dc = detections[di].measCov!;
          const s00 = tp[0][0] + dc[0][0] + 1e-4;
          const s01 = tp[0][1] + dc[0][1];
          const s10 = tp[1][0] + dc[1][0];
          const s11 = tp[1][1] + dc[1][1] + 1e-4;
          const invS = inv2([[s00, s01], [s10, s11]]);
          const maha2 = dx * (invS[0][0] * dx + invS[0][1] * dy) + dy * (invS[1][0] * dx + invS[1][1] * dy);
          if (maha2 <= 16.0) {
            pairs.push({ ti, di, dist, trackId: this.tracks[ti].id });
          }
        }
      }
    }
    pairs.sort((a, b) => (a.dist - b.dist) || (a.trackId - b.trackId) || (a.di - b.di));

    const trackUsed = new Array(this.tracks.length).fill(false);
    const detUsed = new Array(detections.length).fill(false);
    for (const p of pairs) {
      if (trackUsed[p.ti] || detUsed[p.di]) continue;
      trackUsed[p.ti] = true;
      detUsed[p.di] = true;
      const t = this.tracks[p.ti];
      const detection = detections[p.di];
      // A late older exposure must not pull a current track backwards or
      // spawn a duplicate when processing configuration changes mid-drive.
      if (detection.deliveredAt !== undefined && detection.timestamp !== undefined && detection.timestamp <= t.lastTimestamp + 1e-9) continue;
      t.update(detection, sampleDt || stateDt, this.clockSec);
      if (!t.confirmed && t.hits >= cfg.confirmHits) t.confirmed = true;
    }

    // 3. Unmatched tracks coast with bounded simulation-time lifetime; delete stale ones.
    for (let ti = 0; ti < this.tracks.length; ti++) {
      if (!trackUsed[ti]) this.tracks[ti].markCoasting(sampleDt, true);
    }
    this.tracks = this.tracks.filter((t) =>
      sampleDt > 0 ? t.coastingSec <= cfg.maxCoastSec + 1e-6 : t.misses <= cfg.maxMisses,
    );

    // 4. Unmatched detections spawn tentative tracks with honest hit count (hits = 1).
    // Close urgent hazards can still be acted upon via confidence/distance gating in AEB,
    // while confirmation matures cleanly at `confirmHits`.
    for (let di = 0; di < detections.length; di++) {
      if (!detUsed[di]) {
        const nt = new Track(this.nextId++, detections[di], cfg.measNoise, this.clockSec);
        nt.confirmed = nt.hits >= cfg.confirmHits;
        this.tracks.push(nt);
      }
    }

    return this.confirmed();
  }

  confirmed(): Track[] {
    return this.tracks.filter((t) => t.confirmed);
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 1;
    this.clockSec = 0;
  }
}
