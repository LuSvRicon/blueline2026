// Simulation — the headless core that ties the AV stack together. It owns the
// world, the ego vehicle, the traffic, the planner and the controllers, and
// advances everything on a fixed timestep. It deliberately imports NOTHING from
// the renderer, so the full autonomy pipeline can be unit-/smoke-tested without
// a browser or a GPU.
//
//   perception  -> ego Frenet state + obstacle list (ground-truth here)
//   prediction  -> constant-velocity forward roll of traffic (inside planner)
//   planning    -> FrenetPlanner picks the blue line (10 Hz)
//   control     -> Pure Pursuit (steer) + PID (speed) track it (60 Hz)

import { ReferencePath, FrenetPose } from "../world/ReferencePath.ts";
import { Road } from "../world/Road.ts";
import { DEFAULT_TRACK } from "../world/track.ts";
import { Vehicle, EGO_DIMS } from "../vehicle/Vehicle.ts";
import { PID } from "../control/PID.ts";
import { stanleyControl, StanleyConfig } from "../control/Stanley.ts";
import { TrafficManager, ScenarioName, TrafficProfile, TrafficCar } from "../traffic/TrafficManager.ts";
import { FrenetPlanner } from "../planner/FrenetPlanner.ts";
import { FrenetState, Obstacle, Trajectory } from "../planner/Trajectory.ts";
import { Sensor, SensableObject } from "../perception/Sensor.ts";
import { Tracker, Track } from "../perception/Tracker.ts";
import { OccupancyGrid } from "../perception/OccupancyGrid.ts";
import { Pedestrian, PedestrianManager } from "../pedestrian/PedestrianManager.ts";
import { TrafficLight } from "../world/TrafficLight.ts";
import { RoadSign } from "../world/RoadSign.ts";
import { BehaviorPlanner, BehaviorState } from "../behavior/BehaviorPlanner.ts";
import { ImitationAgent } from "../learn/ImitationAgent.ts";
import { DriveContext, extractFeatures } from "../learn/features.ts";
import { MLP } from "../learn/NN.ts";
import { Metrics, MetricsSnapshot } from "./Metrics.ts";
import { ADASController, ADASStatus, DriverInput } from "./ADAS.ts";
import { SessionRecorder } from "./SessionRecorder.ts";
import { clamp, wrapAngle, mod, wrapDiff, smoothTowards } from "../core/math.ts";
import { Rng } from "../core/rng.ts";

export type ControlMode = "classical" | "learned" | "external" | "manual" | "adas";
export type Gear = "P" | "R" | "N" | "D";
export type ScenarioEventName =
  | "stopped-lead"
  | "motorcycle-cutin"
  | "pedestrian-crossing"
  | "vehicle-crossing"
  | "motorcycle-weave"
  | "bus-stop";
export type Policy = (features: number[]) => { steer: number; accel: number };
export type Weather = "clear" | "rain" | "fog";
import { DEFAULT_SIM, SimConfig } from "./config.ts";

/** Game-side counters used by missions, the summary and the ADAS log. */
export interface DriveStats {
  lightsGreen: number;
  redRuns: number;
  yields: number;
  aebEvents: number;
  overtakes: number;
  laneChanges: number;
  hardBrakes: number;
  distanceAdas: number;
  timeAdas: number;
  maxSpeed: number;
}

function emptyStats(): DriveStats {
  return {
    lightsGreen: 0,
    redRuns: 0,
    yields: 0,
    aebEvents: 0,
    overtakes: 0,
    laneChanges: 0,
    hardBrakes: 0,
    distanceAdas: 0,
    timeAdas: 0,
    maxSpeed: 0,
  };
}

export interface Telemetry {
  speed: number; // m/s
  targetSpeed: number;
  desiredSpeed: number;
  lane: number;
  planCost: number;
  candidateCount: number;
  planMs: number;
  colliding: boolean;
  steer: number;
  accel: number;
  distanceTravelled: number; // m
  trackedCount: number; // confirmed Kalman tracks
  sensorRange: number;
  usePerception: boolean;
  behaviorState: BehaviorState;
  pedCount: number; // active pedestrians
  controlMode: ControlMode;
  adas: ADASStatus;
  laneOffset: number; // signed metres from the lane centre (+ = left)
  speedLimitKph: number | null; // nearest posted limit (TSR)
  indicator: number; // turn signal: -1 left, +1 right, 0 off
  headway: number | null; // seconds to the lead vehicle
  trafficLight: TrafficLightInfo | null; // nearest signal ahead (TLR)
  seed: number;
  gear: Gear;
  engineOn: boolean;
  epbEngaged: boolean;
  userBrakeForce: number;
  userThrottle: number;
  adasBrakeForce: number;
  finalBrakeForce: number;
  rctaActive: boolean;
  rctaLeft: boolean;
  rctaRight: boolean;
  rearAeb: boolean;
}

export interface TrafficLightInfo {
  state: "green" | "yellow" | "red";
  distance: number; // metres to the stop line
}

interface SimulationFrame {
  scenario: ScenarioName;
  profile: TrafficProfile;
  weather: Weather;
  controlMode: ControlMode;
  gear: Gear;
  engineOn: boolean;
  epbEngaged: boolean;
  ego: { x: number; y: number; yaw: number; v: number; a: number; delta: number };
  driverInput: DriverInput;
  traffic: TrafficCar[];
  pedestrians: Pedestrian[];
  lightTimes: number[];
  telemetry: Telemetry;
  metrics: MetricsSnapshot;
  stats: DriveStats;
}

export class Simulation {
  readonly config: SimConfig;
  readonly path: ReferencePath;
  readonly road: Road;
  readonly ego: Vehicle;
  readonly traffic: TrafficManager;
  /** Deterministic source for every stochastic decision in the simulation. */
  readonly rng: Rng;
  readonly planner: FrenetPlanner;
  readonly sensor: Sensor;
  readonly tracker: Tracker;
  readonly occupancy: OccupancyGrid;
  readonly pedestrians: PedestrianManager;
  trafficLights: TrafficLight[] = [];
  roadSigns: RoadSign[] = [];
  readonly behavior: BehaviorPlanner;
  readonly imitation: ImitationAgent;
  readonly adas = new ADASController();
  readonly metrics = new Metrics();
  readonly recorder = new SessionRecorder<SimulationFrame>();
  private prevDelta = 0;
  behaviorState: BehaviorState = "CRUISE";
  controlMode: ControlMode = "classical";
  driverInput: DriverInput = { steer: 0, throttle: 0, brake: 0 };
  gear: Gear = "D";
  engineOn = true;
  epbEngaged = false;
  /** Turn signal state: -1 left, +1 right, 0 off. */
  indicator = 0;
  /** Game/mission counters for the current run. */
  readonly stats: DriveStats = emptyStats();
  private prevBehavior: BehaviorState = "CRUISE";
  private prevAeb = false;
  private prevHardBrake = false;
  private prevLane = 0;
  private prevStation = 0;
  private yieldPedIds = new Set<number>();
  externalPolicy: Policy | null = null;
  evolvedChampion: MLP | null = null; // set by the UI after neuroevolution
  safetyShieldEnabled = true; // AEB + LKA for learned drivers (off during evolution)
  collecting = false;
  weather: Weather = "clear";
  private weatherSpeedFactor = 1;
  private baseDesiredSpeed: number;
  private lastObstacles: Obstacle[] = [];
  private junctionStations: number[] = [];
  private trackLaneD = 0; // smoothly-eased lane-centre the controller tracks

  plan: Trajectory | null = null;
  candidates: Trajectory[] = [];
  tracks: Track[] = [];
  telemetry: Telemetry;
  paused = false;
  showCandidates = true;
  /** When true the planner drives off Kalman tracks; when false, ground truth. */
  usePerception = true;
  scenario: ScenarioName = "highway";

  private speedPID: PID;
  /** Separate longitudinal loop for the assistance layer: sharing one PID with
   *  the planner's controller makes two unrelated errors alternate inside a
   *  single timestep and produces a huge derivative spike. */
  private adasSpeedPID: PID;
  private steerConfig: StanleyConfig;
  private planTimer = 0;
  private lastEgoIndex = -1;
  private lastPlanMs = 0;
  private distance = 0;

  constructor(config: Partial<SimConfig> = {}) {
    this.config = { ...DEFAULT_SIM, ...config };
    this.rng = new Rng(this.config.seed);

    this.path = new ReferencePath(DEFAULT_TRACK.controlPoints, 6);
    this.road = new Road(this.path, this.config.numLanes, this.config.laneWidth);

    // A traffic light on the approach to each city junction (corner).
    this.junctionStations = DEFAULT_TRACK.junctions.map(([cx, cy]) =>
      mod(this.path.toFrenet(cx, cy).s - 24, this.path.length),
    );
    this.roadSigns = this.junctionStations.map((s, i) => ({
      id: `speed-limit-${i + 1}`,
      s: mod(s - 45, this.path.length),
      kind: "speed-limit",
      valueKph: 50,
    }));

    // Place the ego on the centre lane, aligned with the road.
    const start = this.path.toCartesian(0, this.road.laneCenter(Math.floor(this.config.numLanes / 2)));
    this.ego = new Vehicle(start.x, start.y, start.heading, 14, EGO_DIMS, {
      maxSpeed: 42,
    });

    this.traffic = new TrafficManager(this.road, this.rng);
    this.traffic.spawn(this.config.trafficCount);
    this.trafficLights = this.makeJunctionLights();

    this.planner = new FrenetPlanner(this.road, {
      desiredSpeed: this.config.egoDesiredSpeed,
    });

    this.sensor = new Sensor({}, this.rng);
    this.tracker = new Tracker();
    this.occupancy = new OccupancyGrid(50, 2);
    this.pedestrians = new PedestrianManager(this.road);
    this.behavior = new BehaviorPlanner(this.road);
    this.imitation = new ImitationAgent();
    this.baseDesiredSpeed = this.config.egoDesiredSpeed;

    this.speedPID = new PID(1.2, 0.15, 0.05, -this.ego.maxDecel, this.ego.maxAccel);
    this.adasSpeedPID = new PID(1.0, 0.08, 0.0, -this.ego.maxDecel, this.ego.maxAccel);
    this.steerConfig = {
      k: 3.0, // cross-track gain
      kSoft: 1.2,
      maxSteer: this.ego.maxSteer,
    };

    this.telemetry = {
      speed: this.ego.v,
      targetSpeed: this.config.egoDesiredSpeed,
      desiredSpeed: this.config.egoDesiredSpeed,
      lane: this.road.laneOf(0),
      planCost: 0,
      candidateCount: 0,
      planMs: 0,
      colliding: false,
      steer: 0,
      accel: 0,
      distanceTravelled: 0,
      trackedCount: 0,
      sensorRange: this.sensor.config.range,
      usePerception: this.usePerception,
      behaviorState: "CRUISE",
      pedCount: 0,
      controlMode: "classical",
      adas: this.adas.status,
      laneOffset: 0,
      speedLimitKph: null,
      indicator: 0,
      headway: null,
      trafficLight: null,
      seed: this.config.seed,
      gear: this.gear,
      engineOn: this.engineOn,
      epbEngaged: this.epbEngaged,
      userBrakeForce: 0,
      userThrottle: 0,
      adasBrakeForce: 0,
      finalBrakeForce: 0,
      rctaActive: false,
      rctaLeft: false,
      rctaRight: false,
      rearAeb: false,
    };

    // Prime perception + the first plan so control has something on frame 1.
    this.perceive(this.config.fixedDt);
    this.replan();
  }

  setDesiredSpeed(v: number): void {
    this.baseDesiredSpeed = v;
    this.telemetry.desiredSpeed = v;
  }

  setTrafficCount(n: number): void {
    this.traffic.setDensity(n);
  }

  setTrafficProfile(profile: TrafficProfile): void {
    if (profile === this.traffic.profile) return;
    this.traffic.profile = profile;
    this.reset();
  }

  addScenarioEvent(event: ScenarioEventName): void {
    const ego = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
    const lane = this.road.laneOf(ego.d);
    const half = this.road.totalWidth / 2;
    // User-created challenges should activate in the near field so a driver
    // can observe the event immediately, while retaining extra lead room at
    // highway speed.
    const speedDist = Math.max(42, this.ego.v * 3.0);

    if (event === "stopped-lead") {
      // This is a driver-created challenge, so put the obstacle inside the
      // AEB response window instead of at the distant setup point used by the
      // longer scripted crossing scenarios.
      this.traffic.addTestVehicle("stalled", lane, ego.s + 42, 0, 0);
    } else if (event === "motorcycle-cutin") {
      const sideLane = lane + 1 < this.road.numLanes ? lane + 1 : lane - 1;
      const cutinDist = speedDist * 0.9;
      const bike = this.traffic.addTestVehicle("motorcycle", sideLane, ego.s + cutinDist, Math.max(15, this.ego.v * 0.85), Math.max(18, this.ego.v));
      // Triggers cut-in when ego approaches closer
      bike.cutInTimer = Math.max(4.0, (cutinDist - 45) / Math.max(this.ego.v - bike.v, 7));
      bike.cutInLane = lane;
    } else if (event === "vehicle-crossing") {
      const kind = this.traffic.profile === "vietnam" ? "motorcycle" : "car";
      const crossDist = speedDist;
      // Vehicle waits at shoulder and only starts crossing when ego is within 85m - 110m
      this.traffic.addCrossingVehicle(kind, ego.s + crossDist, kind === "motorcycle" ? 4.5 : 3.5, Math.max(85, this.ego.v * 3.2));
    } else if (event === "motorcycle-weave") {
      const sideLane = lane + 1 < this.road.numLanes ? lane + 1 : lane - 1;
      const weaveBase = speedDist * 0.95;
      this.traffic.addWeavingMotorcycle(sideLane, lane, ego.s + weaveBase, Math.max(12, this.ego.v * 0.8));
      this.traffic.addWeavingMotorcycle(sideLane, lane, ego.s + weaveBase + 35, Math.max(14, this.ego.v * 0.9));
    } else if (event === "bus-stop") {
      const busDist = speedDist * 1.05;
      this.traffic.addStoppedBus(lane, ego.s + busDist, 18);
      this.pedestrians.add({
        s: mod(ego.s + busDist + 10, this.path.length),
        fromD: half + 2.5,
        toD: -half - 2.5,
        speed: 1.3,
        wait: 0,
        triggerDist: Math.max(85, this.ego.v * 3.0),
      });
    } else {
      // pedestrian-crossing: spawn far ahead (160m - 260m), wait until ego is within approach trigger
      const pedDist = speedDist;
      this.pedestrians.add({
        s: mod(ego.s + pedDist, this.path.length),
        fromD: half + 2.5,
        toD: -half - 2.5,
        speed: 1.5,
        wait: 0,
        triggerDist: Math.max(90, this.ego.v * 3.2),
      });
    }
  }

  reset(): void {
    // Every stochastic decision restarts from the run's seed, so a reset (or a
    // replay from the same seed) reproduces the exact same world.
    this.rng.reset(this.config.seed);
    const mid = Math.floor(this.config.numLanes / 2);
    const start = this.path.toCartesian(0, this.road.laneCenter(mid));
    this.ego.x = start.x;
    this.ego.y = start.y;
    this.ego.yaw = start.heading;
    this.ego.v = this.controlMode === "manual" || this.controlMode === "adas" ? 0 : 14;
    this.ego.a = 0;
    this.ego.delta = 0;
    this.gear = "D";
    this.engineOn = true;
    this.epbEngaged = false;
    this.speedPID.reset();
    this.adasSpeedPID.reset();
    this.driverInput = { steer: 0, throttle: 0, brake: 0 };
    this.indicator = 0;
    this.adas.clearStatus();
    this.distance = 0;
    this.lastEgoIndex = -1;
    this.trackLaneD = this.road.laneCenter(mid);
    this.configureScenario(mid);
    this.tracker.reset();
    this.tracks = [];
    this.metrics.reset();
    this.resetStats();
    this.prevDelta = 0;
    this.perceive(this.config.fixedDt);
    this.replan();
  }

  /** Change the seed and start a fresh run from it. */
  setSeed(seed: number): void {
    this.config.seed = seed >>> 0;
    this.reset();
  }

  /** Traffic lights guarding each city junction (mostly green, staggered). */
  private makeJunctionLights(): TrafficLight[] {
    return this.junctionStations.map(
      (s, i) => new TrafficLight(s, { green: 13, yellow: 2, red: 6, offset: i * 6 }),
    );
  }

  /** Set up traffic AND pedestrians for the current scenario. */
  private configureScenario(mid: number): void {
    const half = this.road.totalWidth / 2;
    this.pedestrians.clear();
    this.trafficLights = this.makeJunctionLights();
    switch (this.scenario) {
      case "crossing": {
        // A pedestrian using a crosswalk ahead — the ego must stop and yield.
        this.traffic.spawn(8);
        this.pedestrians.add({ s: 115, fromD: half + 3, toD: -half - 3, speed: 1.4, wait: 1.5 });
        // Keep the ego's lane clear on the approach so the crosswalk is never
        // occluded by (or blocked behind) another vehicle.
        const L = this.path.length;
        const start = mod(115 - 70, L);
        this.traffic.cars = this.traffic.cars.filter((c) => !(mod(c.s - start, L) < 80 && c.lane === mid));
        break;
      }
      case "occluded":
        // A pedestrian steps out from behind a stalled car — seen late. THE
        // textbook hard case for perception + emergency braking.
        this.traffic.spawnScenario("stalled", mid);
        this.pedestrians.add({ s: 104, fromD: -(half + 3), toD: half + 3, speed: 1.7, wait: 0.6 });
        break;
      case "jaywalker":
        // Someone darts across right in front of the ego with no warning.
        this.traffic.spawn(8);
        this.pedestrians.add({ s: 135, fromD: half + 3, toD: -half - 3, speed: 2.6, triggerDist: 76 });
        break;
      case "lights":
        // A signalised intersection: the ego must stop on red, go on green.
        this.traffic.spawn(8);
        this.trafficLights.push(new TrafficLight(150, { green: 7, yellow: 2, red: 12, offset: 8 }));
        break;
      case "rush": {
        // Rush hour — everything at once: dense traffic, a pedestrian crossing,
        // and a signalised intersection further on.
        this.traffic.spawn(26);
        this.pedestrians.add({ s: 95, fromD: half + 3, toD: -half - 3, speed: 1.4, wait: 2 });
        this.trafficLights.push(new TrafficLight(210, { green: 8, yellow: 2, red: 10, offset: 6 }));
        // Keep the ego's lane clear at the crosswalk so the yield is unobstructed.
        const L = this.path.length;
        const start = mod(95 - 65, L);
        this.traffic.cars = this.traffic.cars.filter((c) => !(mod(c.s - start, L) < 75 && c.lane === mid));
        break;
      }
      case "bus-stop": {
        this.traffic.spawnScenario("bus-stop", mid);
        const bus = this.traffic.cars.find((car) => car.kind === "bus" && car.stopTimer > 0);
        this.traffic.cars = this.traffic.cars.filter((car) =>
          car === bus || car.lane !== mid || car.s < 20 || car.s > 110,
        );
        this.pedestrians.add({ s: 84, fromD: half + 2.5, toD: -half - 2.5, speed: 1.3, wait: 1.2 });
        break;
      }
      case "vietnam-rush": {
        this.traffic.spawnScenario("vietnam-rush", mid);
        this.pedestrians.add({ s: 98, fromD: half + 3, toD: -half - 3, speed: 1.5, wait: 1.5 });
        this.trafficLights.push(new TrafficLight(205, { green: 7, yellow: 2, red: 12, offset: 5 }));
        const L = this.path.length;
        const start = mod(98 - 62, L);
        this.traffic.cars = this.traffic.cars.filter((c) => !(mod(c.s - start, L) < 72 && c.lane === mid));
        break;
      }
      case "stalled": {
        this.traffic.spawnScenario("stalled", mid);
        // Guarantee a clear overtaking corridor beside the stalled car so the
        // ego can reliably go around it (not get randomly boxed in).
        const L = this.path.length;
        const start = mod(95 - 22, L); // just behind the stalled car (~s=95)
        this.traffic.cars = this.traffic.cars.filter(
          (c) => c.kind === "stalled" || !(mod(c.s - start, L) < 70 && c.lane !== mid),
        );
        break;
      }
      case "trucks": {
        this.traffic.spawnScenario("trucks", mid);
        // Keep the lanes beside the convoy clear so the ego can pass reliably.
        const L = this.path.length;
        const start = mod(60, L);
        this.traffic.cars = this.traffic.cars.filter(
          (c) => c.kind === "truck" || !(mod(c.s - start, L) < 220 && c.lane !== mid),
        );
        break;
      }
      default:
        this.traffic.spawnScenario(this.scenario, mid);
    }
  }

  setScenario(name: ScenarioName): void {
    this.scenario = name;
    this.reset();
  }

  setSensorRange(r: number): void {
    this.sensor.config.range = r;
  }

  /** Current ego state expressed in the road's Frenet frame. */
  private egoFrenet(): FrenetState {
    // Full search (no hint) — cheap at 10 Hz and immune to hint drift on curves.
    const f = this.path.toFrenet(this.ego.x, this.ego.y, -1);
    this.lastEgoIndex = f.index;
    const pathHeading = this.path.cartesianAt(f.s).heading;
    const yawErr = wrapAngle(this.ego.yaw - pathHeading);
    const sDot = this.ego.v * Math.cos(yawErr);
    const dDot = this.ego.v * Math.sin(yawErr);
    return {
      s: f.s,
      d: f.d,
      sDot,
      sDdot: this.ego.a * Math.cos(yawErr),
      dDot,
      dDdot: 0,
      index: f.index,
    };
  }

  /** Obstacles the planner reasons about — perceived tracks or ground truth. */
  private obstacles(): Obstacle[] {
    if (!this.usePerception) {
      const obs: Obstacle[] = this.traffic.cars.map((c) => ({
        s: c.s, d: c.d, v: c.v,
        vd: c.crossing ? Math.sign(c.crossingToD - c.d) * c.crossingSpeed : 0,
        length: c.length, width: c.width, kind: "car" as const,
      }));
      for (const p of this.pedestrians.peds) {
        if (p.state === "done") continue;
        obs.push({
          s: p.s, d: p.d, v: 0, vd: this.pedestrians.lateralVel(p),
          length: p.radius * 2, width: p.radius * 2, kind: "ped",
        });
      }
      return obs;
    }
    // Project each confirmed Kalman track into the road's Frenet frame, using
    // its ESTIMATED velocity for both along-road and lateral (crossing) speed.
    const confirmed = this.tracks.filter((t: any) => t.confirmed);
    const sources = confirmed.length > 0 ? confirmed : this.tracks;
    if (sources.length > 0) {
      return sources.map((t: any) => {
        const f = this.path.toFrenet(t.px, t.py);
        const h = this.path.cartesianAt(f.s).heading;
        const tx = Math.cos(h);
        const ty = Math.sin(h);
        const vAlong = t.vx * tx + t.vy * ty;
        const vLat = -t.vx * ty + t.vy * tx; // component along the left normal
        return { s: f.s, d: f.d, v: vAlong, vd: vLat, length: t.length, width: t.width, kind: t.kind };
      });
    }
    // Fallback to ground truth if no tracks yet (initial frames)
    const obs: Obstacle[] = this.traffic.cars.map((c) => ({
      s: c.s, d: c.d, v: c.v,
      vd: c.crossing ? Math.sign(c.crossingToD - c.d) * c.crossingSpeed : 0,
      length: c.length, width: c.width, kind: "car" as const,
    }));
    for (const p of this.pedestrians.peds) {
      if (p.state === "done") continue;
      obs.push({
        s: p.s, d: p.d, v: 0, vd: this.pedestrians.lateralVel(p),
        length: p.radius * 2, width: p.radius * 2, kind: "ped",
      });
    }
    return obs;
  }

  /** Run the perception pipeline: sensor → tracker → occupancy grid. */
  private perceive(dt: number): void {
    const objects: SensableObject[] = [];
    for (const c of this.traffic.cars) {
      const w = this.path.toCartesian(c.s, c.d);
      objects.push({ x: w.x, y: w.y, length: c.length, width: c.width, kind: "car" });
    }
    for (const p of this.pedestrians.peds) {
      if (p.state === "done") continue;
      const w = this.path.toCartesian(p.s, p.d);
      objects.push({ x: w.x, y: w.y, length: p.radius * 2, width: p.radius * 2, kind: "ped" });
    }
    const detections = this.sensor.sense(this.ego.x, this.ego.y, objects, this.ego.yaw);
    this.tracker.update(detections, dt);
    // Use all tracks for safety/ADAS; confirmed still preferred by others
    this.tracks = this.tracker.tracks.length > 0 ? this.tracker.tracks : [];
    this.occupancy.build(this.ego.x, this.ego.y, this.tracks.filter((t: any) => t.confirmed));
  }

  private replan(): void {
    const state = this.egoFrenet();
    const currentLane = this.road.laneOf(state.d);
    const obstacles = this.obstacles();

    // Behaviour FSM decides the manoeuvre; it modulates the motion planner.
    const decision = this.behavior.decide(
      { s: state.s, d: state.d, v: this.ego.v, lane: currentLane },
      obstacles,
      this.baseDesiredSpeed,
    );
    this.behaviorState = decision.state;
    // Slow for road curvature (lateral-acceleration limit) so the car can
    // actually hold its lane through bends instead of understeering wide.
    const aLatMax = 2.2;
    const k = this.path.maxCurvatureAhead(state.s, 100);
    const curveCap = k > 1e-4 ? Math.sqrt(aLatMax / k) : Infinity;
    let target = Math.min(decision.targetSpeed * this.weatherSpeedFactor, curveCap);

    // The classical stack reads posted speed-limit signs near junction zones.
    for (const sign of this.roadSigns) {
      const relative = wrapDiff(sign.s, state.s, this.path.length);
      if (relative <= 75 && relative >= -110) target = Math.min(target, sign.valueKph / 3.6);
    }

    // Traffic-light stop-line: stop at the line on red (and yellow if we can).
    for (const lt of this.trafficLights) {
      const fwd = mod(lt.s - state.s, this.path.length);
      if (fwd <= 0 || fwd > 90) continue;
      const stopForLight = lt.state === "red" || (lt.state === "yellow" && fwd > 14);
      if (stopForLight) {
        const stopSpeed = Math.sqrt(2 * 2.3 * Math.max(fwd - 5, 0)); // brake early, stop ~5 m before line
        if (stopSpeed < target) {
          target = stopSpeed;
          this.behaviorState = "STOP";
        }
      }
    }
    this.planner.config.desiredSpeed = Math.max(0, target);

    const t0 = performance.now();
    const result = this.planner.plan(state, obstacles, currentLane, decision.biasLane);
    this.lastPlanMs = performance.now() - t0;
    this.plan = result.best;
    this.candidates = result.candidates;
    this.lastObstacles = obstacles;
  }

  /** Build the normalised feature vector the learned agents see. */
  private buildFeatures(): number[] {
    const f = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
    const pathHeading = this.path.cartesianAt(f.s).heading;
    const ctx: DriveContext = {
      v: this.ego.v,
      d: f.d,
      headingErr: wrapAngle(this.ego.yaw - pathHeading),
      curvature: this.path.signedCurvatureAt(f.s),
      laneIndex: this.road.laneOf(f.d),
      numLanes: this.road.numLanes,
      laneWidth: this.road.laneWidth,
      roadHalf: this.road.totalWidth / 2,
      egoS: f.s,
      L: this.path.length,
      desiredSpeed: this.baseDesiredSpeed,
      obstacles: this.lastObstacles.map((o) => ({ s: o.s, d: o.d, v: o.v, kind: o.kind, length: o.length })),
    };
    return extractFeatures(ctx);
  }

  /**
   * Automatic emergency braking. Returns a hard-braking acceleration if any
   * obstacle is imminently in the ego's path, else null. Used to shield the
   * learned drivers from collisions.
   */
  private safetyShield(f: FrenetPose): number | null {
    const L = this.path.length;
    const laneHalf = this.road.laneWidth * 0.6;
    let brake: number | null = null;
    for (const o of this.lastObstacles) {
      const fwd = mod(o.s - f.s, L);
      if (fwd <= 0 || fwd > 60) continue;
      const latTol = laneHalf + (o.kind === "ped" ? 1.6 : 0.4);
      const gap = fwd - (2.35 + o.length / 2);
      const closing = this.ego.v - o.v;
      const ttc = closing > 0.1 ? gap / closing : Infinity;

      let inPath = Math.abs(o.d - f.d) <= latTol;
      if (!inPath && o.vd && Math.abs(o.vd) > 0.1 && ttc > 0 && ttc < 3.5) {
        const predD = o.d + o.vd * ttc;
        if (Math.abs(predD - f.d) <= latTol || ((o.d - f.d) * (predD - f.d) <= 0)) {
          inPath = true;
        }
      }

      if (!inPath) continue;
      const stoppingDist = (Math.max(closing, 0) ** 2) / (2 * Math.max(this.ego.maxDecel * 0.8, 1)) + this.ego.v * 0.3 + 4;
      if (gap < stoppingDist || gap < 6.0 || ttc < 2.0) brake = -this.ego.maxDecel;
    }
    return brake;
  }

  setControlMode(m: ControlMode): void {
    if (m !== this.controlMode) {
      this.metrics.reset(); // fresh scorecard per driver
      this.speedPID.reset();
      this.adasSpeedPID.reset();
      this.driverInput = { steer: 0, throttle: 0, brake: 0 };
      this.indicator = 0;
    }
    this.controlMode = m;
    this.updateSensorRangeForMode();
    if (m !== "adas") this.adas.clearStatus();
  }

  /** Change the simulated automatic transmission only while stationary. */
  setGear(gear: Gear): boolean {
    if (gear === this.gear) return true;
    if (!this.engineOn || this.ego.v > 0.45) return false;
    this.gear = gear;
    if (gear === "P") {
      this.epbEngaged = true;
      this.ego.v = 0;
    }
    this.speedPID.reset();
    this.adasSpeedPID.reset();
    return true;
  }

  /** The starter is interlocked with Park to avoid shifting a stopped car by accident. */
  setEngineRunning(running: boolean): boolean {
    if (running === this.engineOn) return true;
    if (this.ego.v > 0.2) return false;
    if (running && this.gear !== "P") return false;
    if (!running && this.gear !== "P") return false;
    this.engineOn = running;
    if (!running) {
      this.epbEngaged = true;
      this.driverInput = { ...this.driverInput, throttle: 0 };
    }
    return true;
  }

  /** Electronic parking brake; it can only be applied after the car stops. */
  setParkingBrake(engaged: boolean): boolean {
    if (engaged && this.ego.v > 0.45) return false;
    this.epbEngaged = engaged;
    if (engaged) this.ego.v = 0;
    return true;
  }

  /** Toggle (or cancel) the turn signal — the assisted lane change reads it. */
  toggleIndicator(direction: -1 | 1): void {
    if (this.controlMode !== "manual" && this.controlMode !== "adas") {
      this.indicator = 0;
      return;
    }
    this.indicator = this.indicator === direction ? 0 : direction;
  }

  clearIndicator(): void {
    this.indicator = 0;
  }

  /** Current seed — identical seeds reproduce the same world. */
  get seed(): number {
    return this.config.seed;
  }

  /** Posted limit the ADAS traffic-sign recognition can read right now. */
  nearestSpeedLimit(s: number): number | null {
    let best: number | null = null;
    for (const sign of this.roadSigns) {
      const relative = wrapDiff(sign.s, s, this.path.length);
      if (relative < -14 || relative > 85) continue;
      if (best === null || sign.valueKph < best) best = sign.valueKph;
    }
    return best;
  }

  /** Nearest signalised stop line ahead (for ADAS traffic-light recognition). */
  nearestTrafficLight(s: number): TrafficLightInfo | null {
    let best: TrafficLight | null = null;
    let bestDistance = Infinity;
    for (const light of this.trafficLights) {
      const forward = mod(light.s - s, this.path.length);
      if (forward > 115) continue;
      if (forward < bestDistance) {
        bestDistance = forward;
        best = light;
      }
    }
    return best ? { state: best.state, distance: bestDistance } : null;
  }

  private resetStats(): void {
    Object.assign(this.stats, emptyStats());
    this.prevBehavior = "CRUISE";
    this.prevAeb = false;
    this.prevHardBrake = false;
    this.prevStation = 0;
    this.prevLane = Math.floor(this.config.numLanes / 2);
    this.yieldPedIds.clear();
  }

  /** Update the game/mission counters for one simulation step. */
  private updateStats(dt: number, ef: FrenetPose, prevX: number, prevY: number): void {
    const L = this.path.length;
    const moved = Math.hypot(this.ego.x - prevX, this.ego.y - prevY);
    const s = this.stats;
    s.maxSpeed = Math.max(s.maxSpeed, this.ego.v);
    if (this.controlMode === "adas") {
      s.distanceAdas += moved;
      s.timeAdas += dt;
    }

    // Signalised stop-line crossings.
    for (const lt of this.trafficLights) {
      const before = wrapDiff(lt.s, this.prevStation, L);
      const after = wrapDiff(lt.s, ef.s, L);
      if (before > 0 && after <= 0) {
        if (lt.state === "green") s.lightsGreen++;
        else if (lt.state === "red") s.redRuns++;
      }
    }
    this.prevStation = ef.s;

    // Behaviour transitions.
    if (this.behaviorState === "OVERTAKE" && this.prevBehavior !== "OVERTAKE") s.overtakes++;
    if (this.behaviorState === "YIELD") {
      if (this.ego.v < 0.8) {
        for (const p of this.pedestrians.peds) {
          if (p.state === "done" || this.yieldPedIds.has(p.id)) continue;
          const forward = mod(p.s - ef.s, L);
          if (forward > 0 && forward < 26) {
            this.yieldPedIds.add(p.id);
            s.yields++;
          }
        }
      }
    } else {
      this.yieldPedIds.clear();
    }
    this.prevBehavior = this.behaviorState;

    if (this.adas.status.aeb && !this.prevAeb) s.aebEvents++;
    this.prevAeb = this.adas.status.aeb;

    const hardBrake = this.ego.a < -4;
    if (hardBrake && !this.prevHardBrake) s.hardBrakes++;
    this.prevHardBrake = hardBrake;

    const lane = this.road.laneOf(ef.d);
    if (lane !== this.prevLane) {
      if (this.ego.v > 2) s.laneChanges++;
      this.prevLane = lane;
    }
  }

  private updateSensorRangeForMode(): void {
    const assistedRange = this.controlMode === "adas";
    // The simplified ADAS safety channel represents long-range radar, which is
    // not blocked by the visual occlusion rule used for the general perception demo.
    this.sensor.config.occlusion = !assistedRange;
    if (this.weather === "rain") this.sensor.config.range = assistedRange ? 165 : 68;
    else if (this.weather === "fog") this.sensor.config.range = assistedRange ? 150 : 46;
    else this.sensor.config.range = assistedRange ? 180 : 95;
  }

  setDriverInput(input: DriverInput): void {
    this.driverInput = {
      steer: clamp(input.steer, -1, 1),
      throttle: clamp(input.throttle, 0, 1),
      brake: clamp(input.brake, 0, 1),
    };
  }

  private rearCrossTraffic(egoS: number, egoD: number): { active: boolean; left: boolean; right: boolean; rearAeb: boolean } {
    if (this.gear !== "R") return { active: false, left: false, right: false, rearAeb: false };
    let active = false;
    let left = false;
    let right = false;
    let rearAeb = false;
    for (const obstacle of this.lastObstacles) {
      const ds = wrapDiff(obstacle.s, egoS, this.path.length);
      const rearDistance = -ds;
      const lateral = obstacle.d - egoD;
      const crossing = Math.abs(obstacle.vd) > 0.25;
      if (!crossing || rearDistance < -1.5 || rearDistance > 12 || Math.abs(lateral) > 8) continue;
      active = true;
      if (lateral > 0.15) left = true;
      if (lateral < -0.15) right = true;
      const rearClearance = rearDistance - (this.ego.dims.length + obstacle.length) / 2;
      const lateralClearance = Math.abs(lateral) - (this.ego.dims.width + obstacle.width) / 2;
      // A rear brake is reserved for a predicted overlap directly in the
      // reversing path; cross-traffic warnings outside that swept corridor do
      // not stop the vehicle.
      if (rearClearance < 2.2 && lateralClearance < 1.1 && rearDistance > -0.2) rearAeb = true;
    }
    return { active, left, right, rearAeb };
  }

  startRecording(): void {
    this.stopReplay();
    this.recorder.startRecording();
    this.paused = false;
  }

  stopRecording(): void {
    this.recorder.stopRecording();
  }

  startReplay(): boolean {
    this.stopRecording();
    if (!this.recorder.startPlayback()) return false;
    this.paused = false;
    this.restoreFrame(this.recorder.frames[0].value);
    return true;
  }

  stopReplay(): void {
    this.recorder.stopPlayback();
  }

  exportRecordedSession(): string {
    return this.recorder.serialize();
  }

  /** Adverse weather degrades the sensor AND makes the ego drive more cautiously. */
  setWeather(w: Weather): void {
    this.weather = w;
    const s = this.sensor.config;
    if (w === "rain") {
      s.dropout = 0.1;
      s.posNoise = 0.6;
      this.weatherSpeedFactor = 0.8;
    } else if (w === "fog") {
      s.dropout = 0.07;
      s.posNoise = 0.5;
      this.weatherSpeedFactor = 0.62;
    } else {
      s.dropout = 0.04;
      s.posNoise = 0.35;
      this.weatherSpeedFactor = 1;
    }
    this.updateSensorRangeForMode();
  }
  setCollecting(on: boolean): void {
    this.collecting = on;
  }
  trainImitation(epochs = 60) {
    return this.imitation.train(epochs);
  }

  /** Advance the simulation by one fixed step. */
  step(dt: number): void {
    if (this.paused) return;

    if (this.recorder.playing) {
      const playback = this.recorder.advance(dt);
      if (playback) {
        this.restoreFrame(playback.frame.value);
        if (playback.finished) this.paused = true;
      }
      return;
    }

    // --- perception (every step: sensor → Kalman tracks → occupancy) -------
    this.perceive(dt);
    // Refresh the hazard list each fixed step so AEB does not act on the last
    // planner cycle's older obstacle snapshot (planning itself remains rate-limited).
    this.lastObstacles = this.obstacles();
    const driverPose = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
    const rearAlert = this.rearCrossTraffic(driverPose.s, driverPose.d);

    // --- planning (rate-limited) -------------------------------------------
    this.planTimer += dt;
    if (this.planTimer >= this.config.planIntervalSec || !this.plan) {
      this.planTimer = 0;
      this.replan();
    }

    // --- control (every step) ----------------------------------------------
    // 1) The classical controller always runs — it's both a fallback and the
    //    expert whose actions the learned agent imitates.
    let classicalSteer = 0;
    let targetSpeed = this.planner.config.desiredSpeed;
    if (this.plan && this.plan.points.length >= 2) {
      // Stanley lateral control tracking the TARGET LANE CENTRE in the road's
      // Frenet frame (the plan chooses which lane + the speed; this holds it).
      const wb = EGO_DIMS.wheelbase;
      const fx = this.ego.x + (wb / 2) * Math.cos(this.ego.yaw);
      const fy = this.ego.y + (wb / 2) * Math.sin(this.ego.yaw);
      const ff = this.path.toFrenet(fx, fy, -1);
      // Ease the tracked lane centre toward the planner's target lane, so a lane
      // change glides over ~2 s instead of jerking the wheel a full lane width.
      const goalLaneD = this.road.laneCenter(this.plan.targetLane);
      this.trackLaneD = smoothTowards(this.trackLaneD, goalLaneD, 1.6, dt);
      const roadHeading = this.path.cartesianAt(ff.s).heading;
      const headingErr = wrapAngle(roadHeading - this.ego.yaw);
      const crossTrack = ff.d - this.trackLaneD; // +ve when ego is left of tracked centre
      classicalSteer = stanleyControl(headingErr, crossTrack, this.ego.v, this.steerConfig);
      // Never target above the current desired-speed cap, so a stop command
      // (red light / yield / emergency) takes effect without the look-ahead lag.
      // Never target above the current desired-speed cap, so a stop command
      // (red light / yield / emergency) takes effect without the look-ahead lag.
      targetSpeed = Math.min(speedAtTime(this.plan, 0.8), this.planner.config.desiredSpeed);
    }
    const classicalAccel = this.speedPID.update(targetSpeed - this.ego.v, dt);

    // 2) Features + optional imitation data collection.
    const feat = this.buildFeatures();
    if (this.collecting) this.imitation.addSample(feat, classicalSteer, classicalAccel);

    // 3) Choose who drives.
    let steer = classicalSteer;
    let accel = classicalAccel;
    if (this.controlMode === "learned" && this.imitation.trained) {
      const a = this.imitation.act(feat);
      steer = a.steer;
      accel = a.accel;
    } else if (this.controlMode === "external" && this.externalPolicy) {
      const a = this.externalPolicy(feat);
      steer = a.steer;
      accel = a.accel;
    }

    if (this.controlMode === "manual") {
      this.adas.clearStatus();
      targetSpeed = this.baseDesiredSpeed;
      steer = this.driverInput.steer * this.ego.maxSteer;
      const pedalThrottle = this.gear === "D" || this.gear === "R" ? this.driverInput.throttle : 0;
      accel = this.driverInput.brake > 0
        ? -this.driverInput.brake * this.ego.maxDecel
        : pedalThrottle * this.ego.maxAccel;
      if (pedalThrottle === 0 && this.driverInput.brake === 0) {
        accel -= Math.min(0.25, this.ego.v * 0.025);
      }
    } else if (this.controlMode === "adas") {
      if (this.gear === "R") {
        this.adas.clearStatus();
        steer = this.driverInput.steer * this.ego.maxSteer;
        const pedalThrottle = this.driverInput.throttle;
        accel = this.driverInput.brake > 0
          ? -this.driverInput.brake * this.ego.maxDecel
          : pedalThrottle * this.ego.maxAccel;
        if (rearAlert.rearAeb && this.adas.config.aeb && (pedalThrottle > 0 || this.ego.v > 0.15)) {
          accel = -this.ego.maxDecel;
        }
        targetSpeed = 0;
      } else {
        const assisted = this.adas.update({
          ego: this.ego,
          egoS: driverPose.s,
          egoD: driverPose.d,
          path: this.path,
          road: this.road,
          obstacles: this.lastObstacles,
          desiredSpeed: this.baseDesiredSpeed,
          input: this.driverInput,
          dt,
          speedControl: (error, stepDt) => this.adasSpeedPID.update(error, stepDt),
          speedLimitKph: this.nearestSpeedLimit(driverPose.s),
          indicator: this.indicator,
          trafficLight: this.nearestTrafficLight(driverPose.s),
        });
        steer = assisted.steer;
        accel = assisted.accel;
        targetSpeed = assisted.targetSpeed;
        if (assisted.status.alcComplete) this.indicator = 0;
      }
    } else {
      this.adas.clearStatus();
    }

    // PRND and EPB are real simulation interlocks: P/N, engine-off or a set
    // parking brake cannot propel the vehicle. Reverse remains speed-limited.
    if (!this.engineOn || this.epbEngaged || this.gear === "P" || this.gear === "N") {
      accel = this.driverInput.brake > 0 ? -this.driverInput.brake * this.ego.maxDecel : 0;
      this.ego.v = 0;
    } else if (this.gear === "R" && this.ego.v >= 4.5) {
      accel = Math.min(accel, 0);
    }

    const rearAebActive = this.controlMode === "adas" && this.gear === "R" &&
      rearAlert.rearAeb && this.adas.config.aeb &&
      (this.driverInput.throttle > 0 || this.ego.v > 0.15) && !this.epbEngaged;
    this.adas.status = {
      ...this.adas.status,
      rctaActive: rearAlert.active,
      rctaLeft: rearAlert.left,
      rctaRight: rearAlert.right,
      rearAeb: rearAebActive,
      aeb: rearAebActive || this.adas.status.aeb,
      adasBrakeForce: rearAebActive ? 1 : this.adas.status.adasBrakeForce,
    };
    if (rearAebActive) accel = Math.min(accel, -this.ego.maxDecel);

    // Safety shield for the learned drivers — a real AV's independent monitor:
    //   • Lane-keeping assist: blend toward the classical steer near the edge.
    //   • Automatic emergency braking: hard-brake if a collision is imminent.
    // A rough policy drives its own style but is never allowed to leave the road
    // or hit anything.
    const learnedDriver = this.controlMode === "learned" || this.controlMode === "external";
    if (learnedDriver && this.safetyShieldEnabled) {
      const f = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
      const roadHalf = this.road.totalWidth / 2;
      const over = Math.abs(f.d) - (roadHalf - 2.2);
      if (over > 0) {
        // Blend strongly toward the classical steer, and ease off the throttle
        // (coast, don't hard-brake) near the edge so the correction can catch it.
        const blend = clamp(over / 1.6, 0, 1);
        steer = steer * (1 - blend) + classicalSteer * blend;
        if (Math.abs(f.d) > roadHalf - 0.8) accel = Math.min(accel, 0);
      }
      const shield = this.safetyShield(f);
      if (shield !== null) accel = Math.min(accel, shield);
    } else if (this.controlMode === "classical") {
      // The trajectory scorer can run out of collision-free candidates when a
      // long truck or a late cut-in occupies the ego's current envelope. Keep
      // the independent collision monitor in the classical auto mode too; it
      // brakes while the lane change clears the full vehicle width.
      const f = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
      const shield = this.safetyShield(f);
      if (shield !== null) accel = Math.min(accel, shield);
    }

    const prevX = this.ego.x;
    const prevY = this.ego.y;
    if (this.gear === "P" || this.epbEngaged || !this.engineOn) {
      this.ego.a = 0;
    } else {
      this.ego.step(steer, accel, dt, this.gear === "R" ? -1 : 1);
    }
    this.distance += Math.hypot(this.ego.x - prevX, this.ego.y - prevY);

    // Virtual guardrail for the learned drivers: keep them physically on the
    // road (a scrappy evolved policy is never allowed to end up in the grass).
    if (learnedDriver && this.safetyShieldEnabled) {
      const fg = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
      const lim = this.road.totalWidth / 2 - 0.3;
      if (Math.abs(fg.d) > lim) {
        const w = this.path.toCartesian(fg.s, Math.sign(fg.d) * lim);
        this.ego.x = w.x;
        this.ego.y = w.y;
        this.ego.v *= 0.9; // scrub speed against the barrier
      }
    }

    // --- traffic ------------------------------------------------------------
    let ef = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
    this.traffic.update(
      dt,
      { s: ef.s, d: ef.d, v: this.ego.v, length: EGO_DIMS.length },
      this.controlMode === "adas" || this.controlMode === "manual",
      this.trafficLights,
      this.pedestrians.peds,
    );
    this.pedestrians.update(dt, ef.s, this.path.length, this.traffic.cars);
    for (const lt of this.trafficLights) lt.update(dt);

    // --- live metrics (safety / comfort / efficiency) -----------------------
    const Lm = this.path.length;
    let collided = false;
    let minGap = Infinity;
    const laneHalf = this.road.laneWidth * 0.6;
    for (const c of this.traffic.cars) {
      const ds = wrapDiff(c.s, ef.s, Lm);
      const dd = c.d - ef.d;
      // Use the full vehicle footprints plus a small body-clearance margin.
      // The old 0.8/0.75 multipliers let rendered meshes visibly overlap before
      // collision response ran.
      const minS = (EGO_DIMS.length + c.length) / 2 + 0.12;
      const minD = (EGO_DIMS.width + c.width) / 2 + 0.12;
      if (Math.abs(ds) < minS - 1e-3 && Math.abs(dd) < minD - 1e-3) {
        collided = true;
        // Resolve penetration to the nearest longitudinal contact plane and
        // stop both actors. This keeps bodies from passing through one another
        // when a crossing vehicle or pedestrian reaches the ego between frames.
        this.ego.v = 0;
        c.v = 0;
        const sign = Math.sign(ds) || (this.gear === "R" ? -1 : 1);
        const bounceS = c.s - sign * minS;
        const resolved = this.path.toCartesian(bounceS, ef.d);
        this.ego.x = resolved.x;
        this.ego.y = resolved.y;
        ef = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
      }
      if (Math.abs(dd) < laneHalf && ds > 0) minGap = Math.min(minGap, ds - (2.35 + c.length / 2));
    }
    for (const p of this.pedestrians.peds) {
      if (p.state === "done") continue;
      const ds = wrapDiff(p.s, ef.s, Lm);
      const dd = p.d - ef.d;
      const minS = EGO_DIMS.length / 2 + p.radius + 0.1;
      const minD = EGO_DIMS.width / 2 + p.radius + 0.1;
      if (Math.abs(ds) < minS - 1e-3 && Math.abs(dd) < minD - 1e-3) {
        collided = true;
        // Collision with pedestrian: stop and restore non-overlapping spacing.
        this.ego.v = 0;
        const sign = Math.sign(ds) || (this.gear === "R" ? -1 : 1);
        const bounceS = p.s - sign * minS;
        const resolved = this.path.toCartesian(bounceS, ef.d);
        this.ego.x = resolved.x;
        this.ego.y = resolved.y;
        ef = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
      }
    }
    const steerRate = (this.ego.delta - this.prevDelta) / dt;
    this.prevDelta = this.ego.delta;
    this.metrics.update({
      v: this.ego.v,
      accel: this.ego.a,
      steerRate,
      offRoad: Math.abs(ef.d) > this.road.totalWidth / 2,
      gap: minGap,
      collided,
      desiredSpeed: this.baseDesiredSpeed,
      dt,
    });

    // --- game/mission counters ----------------------------------------------
    this.updateStats(dt, ef, prevX, prevY);

    // --- telemetry ----------------------------------------------------------
    this.telemetry.speed = this.ego.v;
    this.telemetry.targetSpeed = targetSpeed;
    this.telemetry.lane = this.road.laneOf(ef.d);
    this.telemetry.planCost = this.plan ? this.plan.cost : 0;
    this.telemetry.candidateCount = this.candidates.length;
    this.telemetry.planMs = this.lastPlanMs;
    this.telemetry.colliding = this.plan ? this.plan.colliding : false;
    this.telemetry.steer = this.ego.delta;
    this.telemetry.accel = this.ego.a;
    this.telemetry.distanceTravelled = this.distance;
    this.telemetry.trackedCount = this.tracks.length;
    this.telemetry.sensorRange = this.sensor.config.range;
    this.telemetry.usePerception = this.usePerception;
    this.telemetry.behaviorState = this.behaviorState;
    this.telemetry.pedCount = this.pedestrians.peds.filter((p) => p.state !== "done").length;
    this.telemetry.controlMode = this.controlMode;
    this.telemetry.adas = this.adas.status;
    const laneCenter = this.road.laneCenter(this.telemetry.lane);
    this.telemetry.laneOffset = ef.d - laneCenter;
    this.telemetry.speedLimitKph = this.nearestSpeedLimit(ef.s);
    this.telemetry.indicator = this.indicator;
    this.telemetry.headway = this.adas.status.headway;
    this.telemetry.trafficLight = this.nearestTrafficLight(ef.s);
    this.telemetry.seed = this.config.seed;
    this.telemetry.gear = this.gear;
    this.telemetry.engineOn = this.engineOn;
    this.telemetry.epbEngaged = this.epbEngaged;
    this.telemetry.userBrakeForce = this.driverInput.brake;
    this.telemetry.userThrottle = this.driverInput.throttle;
    this.telemetry.adasBrakeForce = this.adas.status.adasBrakeForce;
    this.telemetry.finalBrakeForce = Math.max(this.driverInput.brake, this.adas.status.adasBrakeForce);
    this.telemetry.rctaActive = this.adas.status.rctaActive;
    this.telemetry.rctaLeft = this.adas.status.rctaLeft;
    this.telemetry.rctaRight = this.adas.status.rctaRight;
    this.telemetry.rearAeb = this.adas.status.rearAeb;
    this.recorder.record(this.captureFrame(), dt);
  }

  private captureFrame(): SimulationFrame {
    return {
      scenario: this.scenario,
      profile: this.traffic.profile,
      weather: this.weather,
      controlMode: this.controlMode,
      gear: this.gear,
      engineOn: this.engineOn,
      epbEngaged: this.epbEngaged,
      ego: { x: this.ego.x, y: this.ego.y, yaw: this.ego.yaw, v: this.ego.v, a: this.ego.a, delta: this.ego.delta },
      driverInput: { ...this.driverInput },
      traffic: this.traffic.cars.map((car) => ({ ...car })),
      pedestrians: this.pedestrians.peds.map((ped) => ({ ...ped })),
      lightTimes: this.trafficLights.map((light) => light.elapsedTime),
      telemetry: { ...this.telemetry, adas: { ...this.telemetry.adas } },
      metrics: this.metrics.snapshot(),
      stats: { ...this.stats },
    };
  }

  private restoreFrame(frame: SimulationFrame): void {
    const needsScenarioSetup = frame.scenario !== this.scenario || frame.profile !== this.traffic.profile;
    if (needsScenarioSetup) {
      this.scenario = frame.scenario;
      this.traffic.profile = frame.profile;
      const lane = this.road.laneOf(this.path.toFrenet(frame.ego.x, frame.ego.y).d);
      this.configureScenario(lane);
    }
    if (frame.weather !== this.weather) this.setWeather(frame.weather);
    if (frame.controlMode !== this.controlMode) this.setControlMode(frame.controlMode);

    this.gear = frame.gear ?? "D";
    this.engineOn = frame.engineOn ?? true;
    this.epbEngaged = frame.epbEngaged ?? false;

    Object.assign(this.ego, frame.ego);
    this.driverInput = { ...frame.driverInput };
    this.traffic.cars = frame.traffic.map((car) => ({ ...car }));
    this.pedestrians.peds = frame.pedestrians.map((ped) => ({ ...ped }));
    for (let i = 0; i < Math.min(this.trafficLights.length, frame.lightTimes.length); i++) {
      this.trafficLights[i].restoreTime(frame.lightTimes[i]);
    }
    this.telemetry = { ...frame.telemetry, adas: { ...frame.telemetry.adas } };
    this.adas.status = { ...frame.telemetry.adas };
    this.indicator = frame.telemetry.indicator ?? 0;
    this.behaviorState = frame.telemetry.behaviorState;
    this.distance = frame.telemetry.distanceTravelled;
    this.metrics.restore(frame.metrics);
    if (frame.stats) Object.assign(this.stats, frame.stats);
    this.plan = null;
    this.candidates = [];
    this.tracks = [];
    this.occupancy.build(this.ego.x, this.ego.y, this.tracks);
  }
}

/** Sample a trajectory's speed at a given time offset (clamped to its horizon). */
function speedAtTime(traj: Trajectory, t: number): number {
  const pts = traj.points;
  if (pts.length === 0) return 0;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].t >= t) return clamp(pts[i].v, 0, 60);
  }
  return clamp(pts[pts.length - 1].v, 0, 60);
}
