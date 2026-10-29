// Central tunables for the simulation. Anything the UI can change lives here.
import { TrackId } from "../world/track.ts";

export interface SimConfig {
  numLanes: number;
  laneWidth: number;
  trafficCount: number;
  egoDesiredSpeed: number; // m/s
  planIntervalSec: number; // how often the Frenet planner re-plans
  fixedDt: number; // physics/control step (s)
  /** Seed for every stochastic decision; the same seed yields the same run. */
  seed: number;
  trackId: TrackId;
}

export const DEFAULT_SIM: SimConfig = {
  numLanes: 3,
  laneWidth: 3.7,
  trafficCount: 16,
  egoDesiredSpeed: 16, // ~58 km/h urban default; highway scenarios raise this
  planIntervalSec: 0.1, // 10 Hz planning, 60 Hz control
  fixedDt: 1 / 60,
  seed: 1,
  trackId: "city",
};
