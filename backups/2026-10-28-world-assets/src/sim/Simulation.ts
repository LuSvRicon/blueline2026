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
import { getTrack, TrackDef } from "../world/track.ts";
import { Vehicle, EGO_DIMS } from "../vehicle/Vehicle.ts";
import { PID } from "../control/PID.ts";
import { stanleyControl, StanleyConfig } from "../control/Stanley.ts";
import { TrafficManager, ScenarioName, TrafficProfile, TrafficCar, trafficFootprint } from "../traffic/TrafficManager.ts";
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
import { Body2D, bodyContact, sweepBodies, interpolateBody } from "../core/collision.ts";
import { proximitySafety } from "./ProximitySafety.ts";
import { ExtendedAssistance } from "./ExtendedAssistance.ts";
import { ParkingAssist, ParkingBay, ParkingMode, ParkingStatus } from "./ParkingAssist.ts";
import { indicatorOn } from "../vehicle/Signals.ts";
import { coastDeceleration, engineRpm } from "../vehicle/Powertrain.ts";

export type ControlMode = "classical" | "learned" | "external" | "manual" | "adas";
export type Gear = "P" | "R" | "N" | "D";
export type ScenarioEventName =
  | "stopped-lead"
  | "lead-hard-brake"
  | "motorcycle-cutin"
  | "pedestrian-crossing"
  | "vehicle-crossing"
  | "motorcycle-weave"
  | "bus-stop"
  | "rear-crossing-left"
  | "rear-crossing-right";
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
  parkingAssist: ParkingStatus;
  doorLeftOpen: boolean;
  doorRightOpen: boolean;
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
  indicatorOn?: boolean;
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
  rpm: number;
  tractionLimited: boolean;
}

export interface TrafficLightInfo {
  state: "green" | "yellow" | "red";
  distance: number; // metres to the stop line
  id?: number;
}

interface SimulationFrame {
  parkingBays?: ParkingBay[];
  trackId?: TrackDef["id"];
  scenario: ScenarioName;
  profile: TrafficProfile;
  weather: Weather;
  controlMode: ControlMode;
  gear: Gear;
  engineOn: boolean;
  epbEngaged: boolean;
  motionDirection?: -1 | 1;
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
  readonly track: TrackDef;
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
  readonly extendedAssistance = new ExtendedAssistance();
  readonly parkingAssist = new ParkingAssist();
  parkingBays: ParkingBay[] = [];
  night = false;
  driverAttentive = true;
  driverHandsOn = true;
  driverFatigued = false;
  doorLeftOpen = false;
  doorRightOpen = false;
  readonly metrics = new Metrics();
  readonly recorder = new SessionRecorder<SimulationFrame>();
  private prevDelta = 0;
  behaviorState: BehaviorState = "CRUISE";
  controlMode: ControlMode = "classical";
  driverInput: DriverInput = { steer: 0, throttle: 0, brake: 0 };
  gear: Gear = "D";
  engineOn = true;
  epbEngaged = false;
  private motionDirection: -1 | 1 = 1;
  /** Turn signal state: -1 left, +1 right, 0 off. */
  indicator = 0;
  private signalStartLane = 0;
  private signalSettledTime = 0;
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
  sensorFault = false;
  laneMarkingConfidence = 1;
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

    this.track = getTrack(this.config.trackId);
    this.path = new ReferencePath(this.track.controlPoints, 6);
    this.road = new Road(this.path, this.config.numLanes, this.config.laneWidth);

    // A traffic light on the approach to each city junction (corner).
    this.junctionStations = this.track.junctions.map(([cx, cy]) =>
      mod(this.path.toFrenet(cx, cy).s - 24, this.path.length),
    );
    this.roadSigns = this.makeRoadSigns();

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
      parkingAssist: { ...this.parkingAssist.status }, doorLeftOpen: false, doorRightOpen: false,
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
      rpm: 800,
      tractionLimited: false,
    };

    // Prime perception + the first plan so control has something on frame 1.
    this.perceive(this.config.fixedDt);
    this.replan();
  }

  setDesiredSpeed(v: number): void {
    this.baseDesiredSpeed = v;
    this.telemetry.desiredSpeed = v;
  }

  get accSetSpeedKph(): number { return this.adas.getSetSpeed(this.baseDesiredSpeed) * 3.6; }

  setAccSpeedKph(kph: number): void {
    this.adas.setCruiseSpeedKph(kph);
    this.adasSpeedPID.reset();
  }

  engageAcc(captureCurrentSpeed = false): boolean {
    if (this.controlMode !== "adas" || this.gear !== "D" || !this.engineOn || this.epbEngaged || this.sensorFault || this.driverInput.brake > 0 || this.parkingAssist.controlling) return false;
    if (captureCurrentSpeed) this.setAccSpeedKph(Math.max(10, this.ego.v * 3.6));
    this.adas.config.acc = true; this.adasSpeedPID.reset(); this.adas.resumeCruise();
    return true;
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

    if (event === "rear-crossing-left" || event === "rear-crossing-right") {
      const side = event === "rear-crossing-left" ? -1 : 1;
      const bike = this.traffic.addCrossingVehicle("motorcycle", ego.s - 5.5, 3.5);
      bike.d = ego.d + side * 6; bike.crossingToD = ego.d - side * 6;
      bike.activationGear = "R";
    } else if (event === "stopped-lead") {
      // This is a driver-created challenge, so put the obstacle inside the
      // AEB response window instead of at the distant setup point used by the
      // longer scripted crossing scenarios.
      const distance=Math.max(42,this.ego.v**2/(2*Math.max(this.ego.maxDecel*this.ego.surfaceMu*.9,1))+this.ego.v*.7+15);
      this.traffic.addTestVehicle("stalled", lane, ego.s + distance, 0, 0);
    } else if(event==="lead-hard-brake"){
      const gap=Math.max(12,this.ego.v+3);
      const lead=this.traffic.addTestVehicle("car",lane,ego.s+gap+this.ego.dims.length,this.ego.v,Math.max(this.ego.v,1));
      lead.d=ego.d;lead.brakeTestDelay=1;lead.changeCooldown=9999;
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
    this.ego.v = this.controlMode === "manual" || this.controlMode === "adas" || ["traffic-jam", "school-zone", "market-street", "reverse-crossing"].includes(this.scenario) ? 0 : 14;
    this.ego.a = 0;
    this.ego.delta = 0;
    this.gear = "D";
    this.engineOn = true;
    this.epbEngaged = false;
    this.motionDirection = 1;
    this.speedPID.reset();
    this.adasSpeedPID.reset();
    this.driverInput = { steer: 0, throttle: 0, brake: 0 };
    this.indicator = 0;
    this.adas.clearStatus();
    this.adas.resumeCruise();
    this.extendedAssistance.reset(); this.parkingAssist.reset(); this.parkingBays = [];
    this.doorLeftOpen = this.doorRightOpen = false;
    this.driverAttentive = this.driverHandsOn = true; this.driverFatigued = false;
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

  private makeRoadSigns(): RoadSign[] {
    const signs: RoadSign[] = this.junctionStations.map((s, i) => ({ id: `speed-limit-${i + 1}`, s: mod(s - 45, this.path.length), kind: "speed-limit", valueKph: this.track.id === "boulevard" ? 70 : 50 }));
    if (this.track.id === "ring-road") signs.push({ id: "ring-limit", s: 20, kind: "speed-limit", valueKph: 90 });
    return signs;
  }

  /** Set up traffic AND pedestrians for the current scenario. */
  private configureScenario(mid: number): void {
    const half = this.road.totalWidth / 2;
    this.pedestrians.clear();
    this.roadSigns = this.makeRoadSigns();
    this.trafficLights = this.makeJunctionLights();
    this.traffic.junctionTraffic = ["lights", "rush", "vietnam-rush"].includes(this.scenario);
    switch (this.scenario) {
      case "school-zone": {
        this.traffic.spawn(12, undefined, "vietnam");
        this.traffic.addStoppedBus(0, 82, 12);
        this.roadSigns.push({ id: "school-limit", s: 12, kind: "speed-limit", valueKph: 30 });
        for (const [s, wait] of [[98, 1.2], [104, 4]]) this.pedestrians.add({ s, fromD: half + 2, toD: -half - 2, speed: 1.2, wait });
        break;
      }
      case "market-street": {
        this.traffic.spawn(18, undefined, "vietnam");
        for (const car of this.traffic.cars) car.desiredSpeed = Math.min(car.desiredSpeed, 8);
        this.roadSigns.push({ id: "market-limit", s: 12, kind: "speed-limit", valueKph: 30 });
        this.traffic.addCrossingVehicle("motorcycle", 110, 3.2, 75);
        this.pedestrians.add({ s: 145, fromD: -half - 2, toD: half + 2, speed: 1.3, wait: 2 });
        break;
      }
      case "roadworks": {
        this.traffic.spawn(10);
        this.traffic.cars = this.traffic.cars.filter(car => car.s < 35 || car.s > 145);
        const truck = this.traffic.addTestVehicle("truck", mid, 100, 0, 0); truck.disabled = true;
        this.roadSigns.push({ id: "works-limit", s: 15, kind: "speed-limit", valueKph: 30 });
        break;
      }
      case "reverse-crossing": {
        this.traffic.clear();
        this.gear = "P"; this.epbEngaged = true; this.ego.v = 0;
        this.addScenarioEvent("rear-crossing-left");
        break;
      }
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
        vd: this.trafficLateralSpeed(c),
        ...trafficFootprint(c), kind: "car" as const,
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
    // New hazards must not disappear simply because an older track is confirmed.
    const sources = this.tracks;
    if (sources.length > 0) {
      return sources.map((t: any) => {
        const f = this.path.toFrenet(t.px, t.py);
        const h = this.path.cartesianAt(f.s).heading;
        const tx = Math.cos(h);
        const ty = Math.sin(h);
        const vAlong = t.vx * tx + t.vy * ty;
        const vLat = -t.vx * ty + t.vy * tx;
        const lateralSigma = Math.sqrt(Math.max(0, ty * ty * t.P[2][2] - 2 * tx * ty * t.P[2][3] + tx * tx * t.P[3][3]));
        const vd = this.controlMode === "adas" ? Math.abs(vLat) > Math.max(.35, lateralSigma * 2) ? vLat : 0 : vLat;
        return { s: f.s, d: f.d, v: vAlong, vd, length: t.length, width: t.width, kind: t.kind };
      });
    }
    // Empty sensor observations are never replaced by perfect world state.
    return [];
  }

  /** Run the perception pipeline: sensor → tracker → occupancy grid. */
  private trafficLateralSpeed(car: TrafficCar): number {
    if (car.disabled || car.kind === "stalled" || car.stopTimer > 0) return 0;
    if (car.crossing) return !car.activationGear || this.gear === car.activationGear || car.crossingStarted ? Math.sign(car.crossingToD - car.d) * car.crossingSpeed : 0;
    if (this.controlMode !== "adas") return 0;
    // Derivative of the same exponential lane transition used by traffic.
    const bike = car.kind === "motorcycle";
    return (this.road.laneCenter(car.lane) + (bike ? car.shareOffset ?? 0 : 0) - car.d) * (bike ? 3.2 : 2.5);
  }

  private perceive(dt: number): void {
    if (this.sensorFault) { this.tracker.reset(); this.tracks = []; this.occupancy.build(this.ego.x, this.ego.y, []); return; }
    const objects: SensableObject[] = [];
    for (const c of this.traffic.cars) {
      const w = this.path.toCartesian(c.s, c.d);
      const vd = this.trafficLateralSpeed(c);
      const velocity = this.controlMode === "adas" ? { vx: c.v * Math.cos(w.heading) - vd * Math.sin(w.heading), vy: c.v * Math.sin(w.heading) + vd * Math.cos(w.heading) } : {};
      objects.push({ x: w.x, y: w.y, ...trafficFootprint(c), kind: "car", ...velocity });
    }
    for (const p of this.pedestrians.peds) {
      if (p.state === "done") continue;
      const w = this.path.toCartesian(p.s, p.d);
      const vd = this.pedestrians.lateralVel(p);
      const velocity = this.controlMode === "adas" ? { vx: -vd * Math.sin(w.heading), vy: vd * Math.cos(w.heading) } : {};
      objects.push({ x: w.x, y: w.y, length: p.radius * 2, width: p.radius * 2, kind: "ped", ...velocity });
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
      const fwd = wrapDiff(o.s, f.s, L);
      if (fwd < -(this.ego.dims.length + o.length) / 2 - 3 || fwd > 60) continue;
      const yawOffset = this.ego.yaw - this.path.cartesianAt(f.s).heading;
      const bodyWidth = Math.abs(Math.cos(yawOffset)) * this.ego.dims.width + Math.abs(Math.sin(yawOffset)) * this.ego.dims.length;
      const latTol = Math.max(laneHalf + (o.kind === "ped" ? 1.6 : .4), (bodyWidth + o.width) / 2 + 1.0);
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
      const stoppingDist = (Math.max(closing, 0) ** 2) / (2 * Math.max(this.ego.maxDecel * this.ego.surfaceMu * 0.8, 1)) + this.ego.v * 0.3 + 4;
      if (gap < stoppingDist || gap < 6.0 || ttc < 2.0) brake = -this.ego.maxDecel;
    }
    return brake;
  }

  setControlMode(m: ControlMode): void {
    if (m !== this.controlMode) {
      this.parkingAssist.cancel("Đổi chế độ lái · đã hủy đỗ");
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

  /** Neutral disconnects propulsion while preserving the current travel direction.
   * Park and direction reversals are locked out while the car is rolling. */
  setGear(gear: Gear): boolean {
    if (gear === this.gear) return true;
    if (!this.engineOn) return false;
    if ((gear === "D" || gear === "R") && (this.doorLeftOpen || this.doorRightOpen)) return false;
    if (this.ego.v > .45 && (gear === "P" || (gear === "R" && this.motionDirection !== -1) || (gear === "D" && this.motionDirection !== 1))) return false;
    this.gear = gear;
    if (gear !== "D") this.adas.cancelCruise();
    if (gear === "D") this.motionDirection = 1;
    if (gear === "R") this.motionDirection = -1;
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
    this.signalStartLane = this.road.laneOf(this.path.toFrenet(this.ego.x, this.ego.y).d);
    this.signalSettledTime = 0;
  }

  clearIndicator(): void {
    this.indicator = 0;
    this.signalSettledTime = 0;
  }

  private updateManualIndicator(dt: number, pose: FrenetPose): void {
    if (this.indicator === 0) { this.signalSettledTime = 0; return; }
    const lane = this.road.laneOf(pose.d);
    const changedInDirection = (lane - this.signalStartLane) * this.indicator > 0;
    const centred = Math.abs(pose.d - this.road.laneCenter(lane)) < .35;
    const aligned = Math.abs(wrapAngle(this.ego.yaw - this.path.cartesianAt(pose.s).heading)) < .08;
    this.signalSettledTime = changedInDirection && centred && aligned && this.ego.v > .5 ? this.signalSettledTime + dt : 0;
    if (this.signalSettledTime > .2) this.clearIndicator();
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
    return best ? { state: best.state, distance: bestDistance, id: best.s } : null;
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
    if (input.brake > 0 && this.controlMode === "adas") { this.adas.cancelCruise(); this.adasSpeedPID.reset(); }
    this.driverInput = {
      steer: clamp(input.steer, -1, 1),
      throttle: clamp(input.throttle, 0, 1),
      brake: clamp(input.brake, 0, 1),
      steeringOverride: input.steeringOverride,
    };
  }

  get signedSpeed(): number { return this.ego.v * this.motionDirection; }

  /** Explicit, repeatable training area. No active drive is silently relocated. */
  prepareParkingLab(): void {
    this.setControlMode("adas");
    this.reset(); this.traffic.clear(); this.pedestrians.clear();
    const s = 150, d = this.road.laneCenter(this.road.numLanes - 1);
    const w = this.path.toCartesian(s, d);
    this.ego.x = w.x; this.ego.y = w.y; this.ego.yaw = w.heading; this.ego.v = 0;
    this.gear = "D"; this.engineOn = true; this.epbEngaged = false; this.motionDirection = 1;
    this.adas.cancelCruise(); this.driverInput = { steer: 0, throttle: 0, brake: 0 };
    this.parkingBays = [0, 1, 2].map(i => ({ id: `P${i + 1}`, s: s - 6 + i * 32, d: d + 3.7, length: 10, width: 3.2 }));
    const occupied = this.traffic.addTestVehicle("stalled", this.road.numLanes - 1, s + 26, 0, 0);
    occupied.d = d + 3.7;
    this.tracker.reset(); this.perceive(this.config.fixedDt); this.lastObstacles = this.obstacles();
    this.paused = false;
  }

  private assistanceFrame(dt: number) {
    const f = this.path.toFrenet(this.ego.x, this.ego.y);
    return { ego: this.ego, egoS: f.s, egoD: f.d, path: this.path, road: this.road, obstacles: this.lastObstacles,
      desiredSpeed: this.baseDesiredSpeed, input: this.driverInput, dt, speedControl: (error: number) => error,
      sensorsAvailable: !this.sensorFault, laneConfidence: this.laneMarkingConfidence };
  }

  requestParking(mode: ParkingMode): boolean {
    if (this.controlMode !== "adas" || this.doorLeftOpen || this.doorRightOpen || this.recorder.playing || this.parkingAssist.controlling || this.ego.v > .2) {
      this.parkingAssist.status.message = "Cần Hỗ trợ ADAS, xe đã dừng, cửa đóng và không có lượt đỗ/phát lại đang chạy"; return false;
    }
    this.adas.cancelCruise();
    return mode === "apa" ? this.engineOn && this.parkingAssist.find(this.assistanceFrame(0), this.parkingBays) :
      this.parkingAssist.prepareRemote(this.assistanceFrame(0), mode === "remote-forward" ? 1 : -1);
  }

  requestDoor(side: "left" | "right"): boolean {
    if (this.ego.v > .1 || this.gear !== "P" || this.parkingAssist.controlling) return false;
    const key = side === "left" ? "doorLeftOpen" : "doorRightOpen";
    const blocked = side === "left" ? this.adas.status.extra.safeExitLeft : this.adas.status.extra.safeExitRight;
    if (!this[key] && (blocked || this.sensorFault)) return false;
    this[key] = !this[key]; return true;
  }

  private rearCrossTraffic(egoS: number, egoD: number): { active: boolean; left: boolean; right: boolean; rearAeb: boolean } {
    const p = proximitySafety(this.ego, this.path, this.lastObstacles, this.gear === "R");
    const enabled = this.controlMode === "adas" && this.adas.config.rcta && !this.sensorFault;
    return { active: enabled && (p.rctaLeft || p.rctaRight), left: enabled && p.rctaLeft, right: enabled && p.rctaRight, rearAeb: !this.sensorFault && p.rearAeb };
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
    // Fog reduces visibility; it does not by itself make a dry road wet.
    this.ego.surfaceMu = w === "rain" ? .72 : 1;
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
      const occupiedLane = this.road.laneOf(driverPose.d);
      const requestedLane = this.plan.targetLane;
      const laneClear = requestedLane === occupiedLane || this.traffic.cars.every(car => {
        if (Math.abs(car.d - this.road.laneCenter(requestedLane)) > (car.width + EGO_DIMS.width) / 2 + .45) return true;
        const ahead = wrapDiff(car.s, driverPose.s, this.path.length);
        const clearance = Math.abs(ahead) - (car.length + EGO_DIMS.length) / 2;
        return clearance > 6 + (ahead > 0 ? this.ego.v : car.v) * 1.2;
      });
      const goalLaneD = this.road.laneCenter(laneClear ? requestedLane : occupiedLane);
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
        accel = -coastDeceleration(this.ego.v) - .07;
      }
    } else if (this.controlMode === "adas") {
      if (this.gear === "R") {
        this.adas.clearStatus();
        this.adas.cancelCruise();
        steer = this.driverInput.steer * this.ego.maxSteer;
        const pedalThrottle = this.driverInput.throttle;
        accel = this.driverInput.brake > 0
          ? -this.driverInput.brake * this.ego.maxDecel
          : pedalThrottle * this.ego.maxAccel;
        if (pedalThrottle === 0 && this.driverInput.brake === 0) accel = -coastDeceleration(this.ego.v);
        if (rearAlert.rearAeb && this.adas.config.aeb && this.adas.config.rearAeb && (pedalThrottle > 0 || this.ego.v > 0.15)) {
          accel = -this.ego.maxDecel;
        }
        targetSpeed = 0;
      } else if (this.gear === "D" && this.engineOn && !this.epbEngaged) {
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
          sensorsAvailable: !this.sensorFault,
          laneConfidence: this.laneMarkingConfidence,
        });
        steer = assisted.steer;
        accel = assisted.accel;
        targetSpeed = assisted.targetSpeed;
        if (assisted.status.alcComplete) this.indicator = 0;
      } else {
        this.adas.clearStatus();
        steer = this.driverInput.steer * this.ego.maxSteer;
        accel = -this.driverInput.brake * this.ego.maxDecel;
      }
    } else {
      this.adas.clearStatus();
    }

    if (this.controlMode === "adas") {
      const extra = this.extendedAssistance.update(this.assistanceFrame(dt), this.adas.config, steer, accel, {
        gear: this.gear, night: this.night, weather: this.weather, attentive: this.driverAttentive, handsOn: this.driverHandsOn, fatigued: this.driverFatigued,
      });
      this.adas.status.extra = extra.status; steer = extra.steer; accel = extra.accel;
      if (extra.status.driverWarning === "takeover") { this.adas.status.takeoverRequired = true; this.adas.cancelCruise(); }
      if (extra.status.pedalMitigation) this.adas.status.adasBrakeForce = 1;
      if (extra.status.minimalRiskBraking) this.adas.status.adasBrakeForce = Math.max(this.adas.status.adasBrakeForce, 2 / this.ego.maxDecel);
    } else this.extendedAssistance.reset();

    const parkingCommand = this.parkingAssist.update(this.assistanceFrame(dt));
    if (parkingCommand) {
      this.adas.cancelCruise();
      if (parkingCommand.startEngine && !this.engineOn && this.gear === "P") this.setEngineRunning(true);
      if (parkingCommand.gear) this.setGear(parkingCommand.gear);
      if (parkingCommand.releaseEpb) this.setParkingBrake(false);
      steer = parkingCommand.steer; accel = parkingCommand.accel;
      targetSpeed = 0;
      if (accel < 0) this.adas.status.adasBrakeForce = Math.max(this.adas.status.adasBrakeForce, -accel / this.ego.maxDecel);
    }

    // N coasts; P/EPB hold the car. Selecting N never erases momentum.
    if (!this.engineOn || this.epbEngaged || this.gear === "P") {
      accel = this.driverInput.brake > 0 ? -this.driverInput.brake * this.ego.maxDecel : 0;
      this.ego.v = 0;
    } else if (this.gear === "N") {
      accel = this.driverInput.brake > 0 ? -this.driverInput.brake * this.ego.maxDecel : -coastDeceleration(this.ego.v);
      steer = this.driverInput.steer * this.ego.maxSteer;
    } else if (this.gear === "R" && this.ego.v >= 4.5) {
      accel = Math.min(accel, 0);
    }

    const rearAebActive = this.controlMode === "adas" && this.gear === "R" &&
      rearAlert.rearAeb && this.adas.config.aeb && this.adas.config.rearAeb &&
      (this.driverInput.throttle > 0 || this.ego.v > 0.15) && !this.epbEngaged;
    const parking = proximitySafety(this.ego, this.path, this.lastObstacles, this.gear === "R");
    const parkingEnabled = this.controlMode === "adas" && (this.gear === "D" || this.gear === "R") && this.adas.config.parking && this.ego.v < 3 && !this.sensorFault;
    this.adas.status = {
      ...this.adas.status,
      sensorsAvailable: !this.sensorFault,
      takeoverRequired: this.controlMode === "adas" && (this.sensorFault || this.adas.status.takeoverRequired),
      parkingFront: parkingEnabled ? parking.front : null,
      parkingRear: parkingEnabled ? parking.rear : null,
      parkingLeft: parkingEnabled ? parking.left : null,
      parkingRight: parkingEnabled ? parking.right : null,
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
    const egoBefore = this.egoBody();
    this.traffic.spawnJunctionCrossings(dt, this.trafficLights, driverPose.s);
    const previousCars = this.traffic.cars.map(car => ({ car, body: this.carBody(car) }));
    const previousPeds = this.pedestrians.peds.filter(ped => ped.state !== "done").map(ped => ({ ped, body: this.pedBody(ped) }));
    if (this.gear === "P" || this.epbEngaged || !this.engineOn) {
      this.ego.a = 0;
    } else {
      this.ego.limitLateralGrip = this.controlMode === "manual";
      this.ego.step(steer, accel, dt, this.motionDirection);
    }

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
      { s: ef.s, d: ef.d, v: this.ego.v * this.motionDirection, length: EGO_DIMS.length,
        width: Math.abs(Math.cos(this.ego.yaw - this.path.cartesianAt(ef.s).heading)) * EGO_DIMS.width + Math.abs(Math.sin(this.ego.yaw - this.path.cartesianAt(ef.s).heading)) * EGO_DIMS.length, gear: this.gear },
      this.controlMode === "adas" || this.controlMode === "manual",
      this.trafficLights,
      this.pedestrians.peds,
    );
    this.pedestrians.update(dt, ef.s, this.path.length,
      [...this.traffic.cars, { s: ef.s, d: ef.d, v: this.ego.v, length: this.ego.dims.length, width: this.ego.dims.width }], this.trafficLights);
    for (const lt of this.trafficLights) lt.update(dt);

    // --- live metrics (safety / comfort / efficiency) -----------------------
    const Lm = this.path.length;
    const collided = this.resolveContacts(egoBefore, [
      ...previousCars.map(({ car, body }) => ({ start: body, end: this.carBody(car), car })),
      ...previousPeds.map(({ ped, body }) => ({ start: body, end: this.pedBody(ped), ped })),
    ]);
    ef = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
    this.distance += Math.hypot(this.ego.x - prevX, this.ego.y - prevY);
    let minGap = Infinity;
    const laneHalf = this.road.laneWidth * 0.6;
    for (const c of this.traffic.cars) {
      const ds = wrapDiff(c.s, ef.s, Lm);
      const dd = c.d - ef.d;
      if (Math.abs(dd) < laneHalf && ds > 0) minGap = Math.min(minGap, ds - (2.35 + c.length / 2));
    }
    const steerRate = (this.ego.delta - this.prevDelta) / dt;
    this.prevDelta = this.ego.delta;
    this.metrics.update({
      v: this.ego.v,
      accel: this.ego.a,
      steerRate,
      offRoad: Math.abs(ef.d) > this.road.totalWidth / 2 && !this.parkingBays.some(bay =>
        Math.abs(wrapDiff(ef.s, bay.s, this.path.length)) < bay.length / 2 + 18 &&
        ef.d >= Math.min(bay.d - bay.width / 2, this.road.totalWidth / 2 - this.road.laneWidth) && ef.d <= bay.d + bay.width / 2),
      gap: minGap,
      collided,
      desiredSpeed: this.baseDesiredSpeed,
      dt,
    });

    // --- game/mission counters ----------------------------------------------
    this.updateManualIndicator(dt, ef);
    this.updateStats(dt, ef, prevX, prevY);

    // --- telemetry ----------------------------------------------------------
    this.telemetry.speed = this.ego.v;
    this.telemetry.targetSpeed = targetSpeed;
    this.telemetry.lane = this.road.laneOf(ef.d);
    this.telemetry.planCost = this.plan ? this.plan.cost : 0;
    this.telemetry.candidateCount = this.candidates.length;
    this.telemetry.planMs = this.lastPlanMs;
    this.telemetry.colliding = collided;
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
    this.telemetry.indicatorOn = indicatorOn(this.metrics.time);
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
    this.telemetry.rpm = engineRpm(this.ego.v, this.driverInput.throttle, this.gear, this.engineOn);
    this.telemetry.tractionLimited = this.ego.tractionLimited;
    this.telemetry.parkingAssist = { ...this.parkingAssist.status };
    this.telemetry.doorLeftOpen = this.doorLeftOpen; this.telemetry.doorRightOpen = this.doorRightOpen;
    this.recorder.record(this.captureFrame(), dt);
  }

  private egoBody(): Body2D { return { x: this.ego.x, y: this.ego.y, yaw: this.ego.yaw, ...this.ego.dims }; }

  private carBody(car: TrafficCar): Body2D {
    const pose = this.path.toCartesian(car.s, car.d);
    const offset = car.crossing ? (Math.sign(car.crossingToD - car.d) || 1) * Math.PI / 2 : car.headingOffset ?? 0;
    return { x: pose.x, y: pose.y, yaw: pose.heading + offset, length: car.length, width: car.width };
  }

  private pedBody(ped: Pedestrian): Body2D {
    const pose = this.path.toCartesian(ped.s, ped.d);
    return { x: pose.x, y: pose.y, yaw: pose.heading, length: ped.radius * 2, width: ped.radius * 2 };
  }

  private resolveContacts(before: Body2D, actors: { start: Body2D; end: Body2D; car?: TrafficCar; ped?: Pedestrian }[]): boolean {
    const after = this.egoBody();
    let first: { actor: typeof actors[number]; time: number } | null = null;
    for (const actor of actors) {
      const motion = Math.hypot(after.x - before.x, after.y - before.y) + Math.hypot(actor.end.x - actor.start.x, actor.end.y - actor.start.y);
      const reach = (Math.hypot(after.length, after.width) + Math.hypot(actor.start.length, actor.start.width)) / 2 + motion + .15;
      if (Math.hypot(before.x - actor.start.x, before.y - actor.start.y) > reach) continue;
      const hit = sweepBodies(before, after, actor.start, actor.end, .12);
      if (hit && (!first || hit.time < first.time)) first = { actor, time: hit.time };
    }
    if (!first) return false;
    const egoAtContact = interpolateBody(before, after, Math.max(0, first.time - .0001));
    this.ego.x = egoAtContact.x; this.ego.y = egoAtContact.y; this.ego.yaw = egoAtContact.yaw;
    this.ego.v = 0; this.ego.a = 0;
    const stop = (actor: typeof actors[number], time?: number) => {
      if (time !== undefined) {
        const position = interpolateBody(actor.start, actor.end, time);
        const f = this.path.toFrenet(position.x, position.y);
        if (actor.car) { actor.car.s = f.s; actor.car.d = f.d; }
        if (actor.ped) { actor.ped.s = f.s; actor.ped.d = f.d; }
      }
      if (actor.car) {
        actor.car.v = 0; actor.car.disabled = true;
        if (!this.traffic.cars.includes(actor.car)) this.traffic.cars.push(actor.car);
      }
      if (actor.ped) actor.ped.collided = true;
    };
    stop(first.actor, first.time);
    for (let pass = 0; pass < 12; pass++) {
      let overlap = false;
      for (const actor of actors) {
        const body = actor.car ? this.carBody(actor.car) : this.pedBody(actor.ped!);
        if (Math.hypot(this.ego.x - body.x, this.ego.y - body.y) > (Math.hypot(body.length, body.width) + 6) / 2 + .2) continue;
        const contact = bodyContact(this.egoBody(), body, .12);
        if (!contact) continue;
        overlap = true;
        this.ego.x += contact.nx * (contact.depth + .001);
        this.ego.y += contact.ny * (contact.depth + .001);
        stop(actor);
      }
      if (!overlap) break;
    }
    const free = (body: Body2D) => actors.every(actor => !bodyContact(body, actor.car ? this.carBody(actor.car) : this.pedBody(actor.ped!), .12));
    if (!free(this.egoBody())) {
      // A manually injected actor can start inside several bodies at once.
      // Alternating minimum translations can oscillate between those bodies;
      // repair this invalid starting state at the nearest verified free pose.
      let repaired = false;
      for (let radius = .25; radius <= 32 && !repaired; radius += .25) {
        for (let sample = 0; sample < 16; sample++) {
          const angle = before.yaw + Math.PI + sample * Math.PI / 8;
          const candidate = { ...egoAtContact, x: egoAtContact.x + Math.cos(angle) * radius, y: egoAtContact.y + Math.sin(angle) * radius };
          if (!free(candidate)) continue;
          this.ego.x = candidate.x; this.ego.y = candidate.y; repaired = true; break;
        }
      }
    }
    return true;
  }

  private captureFrame(): SimulationFrame {
    return {
      parkingBays: this.parkingBays.map(bay => ({ ...bay })),
      trackId: this.track.id,
      scenario: this.scenario,
      profile: this.traffic.profile,
      weather: this.weather,
      controlMode: this.controlMode,
      gear: this.gear,
      engineOn: this.engineOn,
      epbEngaged: this.epbEngaged,
      motionDirection: this.motionDirection,
      ego: { x: this.ego.x, y: this.ego.y, yaw: this.ego.yaw, v: this.ego.v, a: this.ego.a, delta: this.ego.delta },
      driverInput: { ...this.driverInput },
      traffic: this.traffic.cars.map((car) => ({ ...car })),
      pedestrians: this.pedestrians.peds.map((ped) => ({ ...ped })),
      lightTimes: this.trafficLights.map((light) => light.elapsedTime),
      telemetry: { ...this.telemetry, adas: { ...this.telemetry.adas, extra: { ...this.telemetry.adas.extra } }, parkingAssist: { ...this.parkingAssist.status } },
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
    this.motionDirection = frame.motionDirection ?? (this.gear === "R" ? -1 : 1);

    Object.assign(this.ego, frame.ego);
    this.driverInput = { ...frame.driverInput };
    this.traffic.cars = frame.traffic.map((car) => ({ ...car }));
    this.pedestrians.peds = frame.pedestrians.map((ped) => ({ ...ped }));
    for (let i = 0; i < Math.min(this.trafficLights.length, frame.lightTimes.length); i++) {
      this.trafficLights[i].restoreTime(frame.lightTimes[i]);
    }
    this.adas.clearStatus();
    this.adas.status = { ...this.adas.status, ...frame.telemetry.adas, extra: { ...this.adas.status.extra, ...frame.telemetry.adas.extra } };
    this.parkingAssist.reset();
    this.parkingBays = (frame.parkingBays ?? []).map(bay => ({ ...bay }));
    if (frame.telemetry.parkingAssist) this.parkingAssist.status = { ...frame.telemetry.parkingAssist };
    this.doorLeftOpen = frame.telemetry.doorLeftOpen ?? false; this.doorRightOpen = frame.telemetry.doorRightOpen ?? false;
    this.telemetry = { ...frame.telemetry, adas: this.adas.status, parkingAssist: { ...this.parkingAssist.status }, doorLeftOpen: this.doorLeftOpen, doorRightOpen: this.doorRightOpen };
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
