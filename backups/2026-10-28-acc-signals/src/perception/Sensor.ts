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

export interface SensableObject {
  x: number;
  y: number;
  length: number;
  width: number;
  kind: ObstacleKind;
}

export interface Detection {
  x: number;
  y: number;
  length: number;
  width: number;
  kind: ObstacleKind;
  /** 0..1 measurement quality, useful for downstream confidence displays. */
  confidence: number;
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
}

export const DEFAULT_SENSOR: SensorConfig = {
  range: 95,
  posNoise: 0.35,
  sizeNoise: 0.15,
  occlusion: true,
  dropout: 0.04,
  fov: Math.PI, // 360° surround perception suite (camera + radar)
  heading: 0,
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
    const blockers: { bearing: number; halfAngle: number }[] = [];

    for (const c of cand) {
      const o = c.o;
      // Angular half-width this object subtends at its range.
      const half = Math.atan2(Math.max(o.width, o.length) / 2, Math.max(c.dist, 1));

      if (cfg.occlusion) {
        let occluded = false;
        for (const b of blockers) {
          let db = Math.abs(c.bearing - b.bearing);
          if (db > Math.PI) db = 2 * Math.PI - db;
          if (db < b.halfAngle * 0.8) {
            occluded = true;
            break;
          }
        }
        // Only solid, wide objects (vehicles) meaningfully occlude.
        if (o.kind === "car") blockers.push({ bearing: c.bearing, halfAngle: half });
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
        confidence: Math.min(1, Math.max(0.05, confidence)),
      });
    }
    return detections;
  }
}
