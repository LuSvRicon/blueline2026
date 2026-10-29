// Sensor — a simplified perception front-end. Instead of ground-truth objects,
// the ego only "sees" what is within range, inside its field of view and not
// occluded by a nearer object; every measurement is corrupted by Gaussian noise,
// and a fraction of detections randomly drop out. Cars AND pedestrians flow
// through the same sensor, so the downstream tracker/planner must cope with
// small, slow, laterally-moving, sometimes-late (occluded) objects.
//
// All randomness is drawn from the simulation RNG, so a run is reproducible.

import { ObstacleKind } from "../planner/Trajectory.ts";
import { Rng } from "../core/rng.ts";
import {wrapAngle} from '../core/math.ts';

export interface SensableObject {
  roadBoundary?: { d: number; width: number };
  x: number;
  y: number;
  length: number;
  width: number;
  kind: ObstacleKind;
  /** Actual planar body for visibility; reported tracking dimensions may be
   * road-aligned extents instead. +X is along yaw. */
  yaw?:number;
  occlusionLength?:number;
  occlusionWidth?:number;
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
  vx?: number;
  vy?: number;
  velocityVariance?: number;
}

export interface SensorConfig {
  range: number;
  posNoise: number;
  sizeNoise: number;
  occlusion: boolean;
  dropout: number; // probability [0,1] a given in-range detection is missed
  /** Half-angle of the forward field of view (radians); Math.PI = all-round. */
  fov: number;
  /** Heading the sensor is pointing (radians, world frame). */
  heading: number;
  velocityNoise: number;
}

export const DEFAULT_SENSOR: SensorConfig = {
  range: 95,
  posNoise: 0.35,
  sizeNoise: 0.15,
  occlusion: true,
  dropout: 0.04,
  fov: Math.PI, // 360° surround perception suite (camera + radar)
  heading: 0,
  velocityNoise: .25,
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
  velocityNoise: .25,
};

export class Sensor {
  config: SensorConfig;
  readonly rng: Rng;

  constructor(config: Partial<SensorConfig> = {}, rng: Rng = new Rng(1)) {
    this.config = { ...DEFAULT_SENSOR, ...config };
    this.rng = rng;
  }

  /** Produce noisy detections of the objects the ego can currently perceive. */
  sense(egoX: number, egoY: number, objects: SensableObject[], heading = this.config.heading): Detection[] {
    const cfg = this.config;

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
      // Project the four actual corners. A long truck's LENGTH is not its
      // angular half-width when seen from behind. Preserve partial visibility
      // of an adjacent target rather than testing just its centre bearing.
      const yaw=o.yaw??c.bearing,cs=Math.cos(yaw),sn=Math.sin(yaw);
      let min=Infinity,max=-Infinity;
      for(const along of [-1,1])for(const side of [-1,1]){
        const x=o.x+along*(o.occlusionLength??o.length)/2*cs-side*(o.occlusionWidth??o.width)/2*sn;
        const y=o.y+along*(o.occlusionLength??o.length)/2*sn+side*(o.occlusionWidth??o.width)/2*cs;
        const angle=wrapAngle(Math.atan2(y-egoY,x-egoX)-c.bearing);
        min=Math.min(min,angle);max=Math.max(max,angle);
      }

      if (cfg.occlusion) {
        let occluded = false;
        for (const b of blockers) {
          const db=wrapAngle(c.bearing-b.bearing);
          if (db+min>b.min+.005&&db+max<b.max-.005) {
            occluded = true;
            break;
          }
        }
        // Only solid, wide objects (vehicles) meaningfully occlude.
        if (o.kind === "car") blockers.push({ bearing: c.bearing, min,max });
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
        // Optional simulated radar velocity measurement. It is subject to the
        // same range/FOV/dropout channel and its own noise before Kalman fusion.
        ...(o.vx !== undefined && o.vy !== undefined ? {
          vx: o.vx + this.rng.normal() * cfg.velocityNoise,
          vy: o.vy + this.rng.normal() * cfg.velocityNoise,
          velocityVariance: Math.max(cfg.velocityNoise ** 2, .0001),
        } : {}),
      });
    }
    return detections;
  }
}
