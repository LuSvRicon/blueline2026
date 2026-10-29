// PedestrianManager — vulnerable road users (pedestrians) that cross the road.
//
// A pedestrian is anchored at a crossing station `s` and walks laterally across
// the road: its lateral offset `d` sweeps from one sidewalk to the other. This
// is what turns the sim from "highway cruise" into genuine hard-case territory:
// the ego must perceive a small, slow, laterally-moving object and yield/stop —
// including when it emerges late from behind a parked car, or darts out.

import { Road } from "../world/Road.ts";
import { TrafficLight } from "../world/TrafficLight.ts";
import { mod, wrapDiff } from "../core/math.ts";

export type PedState = "waiting" | "crossing" | "done";

export interface Pedestrian {
  id: number;
  s: number; // station of the crossing
  d: number; // current lateral offset (sweeps across the road)
  fromD: number;
  toD: number;
  speed: number; // m/s
  state: PedState;
  waitTimer: number; // seconds until it starts crossing (if no ego trigger)
  triggerDist: number; // if > 0, start crossing when the ego is within this many m
  radius: number;
}

export class PedestrianManager {
  peds: Pedestrian[] = [];
  private nextId = 1;

  constructor(private road: Road) {}

  clear(): void {
    this.peds = [];
    this.nextId = 1;
  }

  get count(): number {
    return this.peds.length;
  }

  add(opts: {
    s: number;
    fromD: number;
    toD: number;
    speed?: number;
    wait?: number;
    triggerDist?: number;
  }): Pedestrian {
    const ped: Pedestrian = {
      id: this.nextId++,
      s: opts.s,
      d: opts.fromD,
      fromD: opts.fromD,
      toD: opts.toD,
      speed: opts.speed ?? 1.4,
      state: "waiting",
      waitTimer: opts.wait ?? 0,
      triggerDist: opts.triggerDist ?? 0,
      radius: 0.4,
    };
    this.peds.push(ped);
    return ped;
  }

  /**
   * Advance all pedestrians. `egoS` lets ego-triggered (jaywalker) crossings
   * fire. `vehicles` lets ordinary pedestrians wait for a safe gap in traffic
   * instead of stepping out in front of a moving car.
   */
  update(
    dt: number,
    egoS: number,
    L: number,
    vehicles: { s: number; d: number; v: number }[] = [],
    lights: TrafficLight[] = [],
  ): void {
    for (const p of this.peds) {
      if (p.state === "waiting") {
        const egoAhead = mod(p.s - egoS, L); // how far the ego is behind the ped
        const triggered = p.triggerDist > 0 && egoAhead < p.triggerDist && egoAhead > 2;
        p.waitTimer -= dt;
        if (triggered) {
          p.state = "crossing";
          continue;
        }
        // Ordinary crosswalk users look for a gap; jaywalkers just go.
        if (p.triggerDist === 0 && p.waitTimer <= 0) {
          const carsHeld = lights.some((lt) => Math.abs(wrapDiff(lt.s, p.s, L)) < 10 && lt.state === "red");
          // Waited too long at a busy curb — take the gap rather than freeze.
          // A red for vehicles is a walk signal at these painted junctions.
          if (carsHeld || p.waitTimer < -3 || this.gapClear(p, L, vehicles)) p.state = "crossing";
        }
        continue;
      }
      if (p.state === "crossing") {
        const dir = Math.sign(p.toD - p.fromD) || 1;
        p.d += dir * p.speed * dt;
        if ((dir > 0 && p.d >= p.toD) || (dir < 0 && p.d <= p.toD)) {
          p.d = p.toD;
          p.state = "done";
        }
      }
    }
  }

  /** True when no moving vehicle is close to the crossing station. */
  private gapClear(p: Pedestrian, L: number, vehicles: { s: number; v: number }[]): boolean {
    for (const v of vehicles) {
      if (v.v < 3) continue;
      if (Math.abs(wrapDiff(v.s, p.s, L)) < 13) return false;
    }
    return true;
  }

  /** Lateral velocity (d/dt of d) — used by the planner to predict the crossing. */
  lateralVel(p: Pedestrian): number {
    if (p.state !== "crossing") return 0;
    return Math.sign(p.toD - p.fromD) * p.speed;
  }
}
