// Shared trajectory types produced by the Frenet planner and consumed by the
// controller and the renderer.

export interface TrajPoint {
  t: number; // time from now (s)
  s: number; // station
  d: number; // lateral offset
  x: number; // world x
  y: number; // world y
  v: number; // speed at this point (m/s)
}

export interface Trajectory {
  points: TrajPoint[];
  targetSpeed: number; // terminal speed this trajectory aims for
  targetLane: number;
  cost: number;
  colliding: boolean;
  feasible: boolean;
}

export interface FrenetState {
  s: number;
  d: number;
  sDot: number; // ds/dt  (≈ speed along the road)
  sDdot: number; // d²s/dt²
  dDot: number; // dd/dt  (lateral velocity)
  dDdot: number; // d²d/dt²
  index: number; // nearest reference-sample hint
}

export type ObstacleKind = "car" | "ped";

// Lightweight obstacle used for the planner's forward collision prediction
// and AEB risk assessment.
export interface Obstacle {
  s: number;
  d: number;
  v: number; // along-road velocity (m/s)
  vd: number; // lateral velocity in Frenet d (m/s)
  length: number;
  width: number;
  kind: ObstacleKind;
  /** Dimensions measured as an envelope aligned with the road tangent must not
   * be rotated again from velocity. AEB treats omitted as physical dimensions
   * for legacy standalone inputs; proximity sensors retain their historical
   * road-envelope default, and rotate only explicit "body" inputs. */
  footprintFrame?: "body" | "road";
  /** Classified continuous road boundary, associated with the simulator map.
   * Its mapped lateral extent is not a moving-vehicle measurement. */
  roadBoundary?: { d: number; width: number };
  /** Stable tracker ID (or deterministic synthetic ID in ground-truth debug mode). */
  id?: number;
  /** Simulation timestamp (s) when this target state was measured or propagated. */
  timestamp?: number;
  /** Sensor latency (s) of the last measurement, if simulated. */
  latencySec?: number;
  /** True when the supplied position has already been propagated to the
   * current simulation time. Retain latencySec as measurement metadata, but
   * do not advance this pose by that delay a second time during prediction. */
  latencyCompensated?: boolean;
  /** Total track age in simulation time (s). */
  ageSec?: number;
  /** Simulation time elapsed since the last matched sensor detection (s). */
  coastingSec?: number;
  /** Consecutive missed sensor sweeps. */
  misses?: number;
  /** Track confirmation state (false while tentative, true once confirmed). */
  confirmed?: boolean;
  /** Track quality / existence confidence in [0, 1]. */
  confidence?: number;
  /** 1-sigma positional uncertainty (m) from tracker covariance. */
  posStd?: number;
  /** 1-sigma velocity uncertainty (m/s) from tracker covariance. */
  velStd?: number;
  /** Estimated tangential acceleration along road direction (m/s²). */
  accel?: number;
  /** Explicit provenance tag: sensor tracks vs debug ground truth. */
  source?: "sensor" | "ground-truth-debug";
  /** Active physical sensing modality that produced/updated this track. */
  sensorChannel?: "radar" | "camera" | "fused" | "legacy";
}
