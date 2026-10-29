// TrafficManager — spawns and updates the ambient traffic that the ego has to
// share the road with. Every car runs IDM longitudinally and MOBIL laterally,
// all in the Frenet frame of the road, on a closed loop (so station `s` wraps).
//
// The ego is injected into the neighbour queries as a virtual vehicle, so
// ambient cars slow for it and never drive through it — without the ego itself
// being controlled by IDM (it has its own planner).

import { Road } from "../world/Road.ts";
import { mod, smoothTowards, clamp } from "../core/math.ts";
import { Rng } from "../core/rng.ts";
import { DEFAULT_IDM, MOTORCYCLE_IDM, IDMParams, idmAcceleration } from "./IDM.ts";
import { DEFAULT_MOBIL, MOTORCYCLE_MOBIL, MobilParams, mobilShouldChange, Neighbor } from "./MOBIL.ts";
import { TrafficLight } from "../world/TrafficLight.ts";
import { Pedestrian } from "../pedestrian/PedestrianManager.ts";

export type CarKind = "car" | "truck" | "stalled" | "motorcycle" | "bus";
export type TrafficProfile = "international" | "vietnam";

export interface TrafficCar {
  id: number;
  s: number; // station along the loop
  d: number; // continuous lateral offset (eases toward the target lane centre)
  v: number;
  lane: number; // logical lane index it is committed to
  desiredSpeed: number;
  length: number;
  width: number;
  changeCooldown: number; // seconds until it may consider another lane change
  hue: number; // stable per-car colour seed for the renderer
  kind: CarKind;
  variant?: number; // 0 sedan, 1 SUV/crossover, 2 hatchback (rendering only)
  cutInTimer: number; // >0: a scripted cut-in is pending (scenario use)
  cutInLane: number; // lane the cut-in car will swerve into
  crossing: boolean;
  crossingToD: number;
  crossingSpeed: number;
  crossingTriggerDist?: number;
  stopTimer: number;
  disabled: boolean;
  weaveTimer: number;
  weaveRemaining: number;
  weaveLaneA: number;
  weaveLaneB: number;
  /** Lateral bias inside the lane (motorcycles filter toward a wheel track). */
  shareOffset: number;
  headingOffset?: number;
  signalS?: number;
  crossingStarted?: boolean;
  activationGear?: "R";
  brakeTestDelay?: number;
  /** Negative v is signed along-road velocity; body heading faces backwards. */
  oncoming?: boolean;
}

export type ScenarioName =
  | "highway"
  | "dense"
  | "trucks"
  | "stalled"
  | "cutin"
  | "crossing"
  | "occluded"
  | "jaywalker"
  | "blindspot"
  | "lights"
  | "rush"
  | "motorcycle-weave"
  | "bus-stop"
  | "traffic-jam"
  | "truck-breakdown"
  | "vietnam-rush"
  | "school-zone"
  | "market-street"
  | "roadworks"
  | "reverse-crossing";

export interface EgoSnapshot {
  s: number;
  d: number;
  v: number;
  length: number;
  width?: number;
  gear?: string;
}

export function trafficFootprint(car: TrafficCar): { length: number; width: number } {
  const angle = car.crossing ? Math.PI / 2 : car.headingOffset ?? 0;
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  return { length: c * car.length + s * car.width, width: s * car.length + c * car.width };
}

interface LaneEntry {
  s: number;
  v: number;
  length: number;
  car: TrafficCar | null; // null == the ego virtual vehicle
}

function trafficDimensions(kind: CarKind): { length: number; width: number } {
  if (kind === "motorcycle") return { length: 1.9, width: 0.82 };
  if (kind === "bus") return { length: 12, width: 2.55 };
  if (kind === "truck") return { length: 15.3, width: 2.5 };
  return { length: 4.6, width: 1.9 };
}

export class TrafficManager {
  cars: TrafficCar[] = [];
  profile: TrafficProfile = "international";
  districtDensity?:number;
  private nextId = 1;
  private idm: IDMParams = { ...DEFAULT_IDM };
  private mobil: MobilParams = { ...DEFAULT_MOBIL };
  /** When true, red signals can spawn perpendicular crossing traffic. */
  junctionTraffic = false;
  private junctionTimer = 0;

  constructor(
    private road: Road,
    readonly rng: Rng = new Rng(1),
  ) {}

  get count(): number {
    return this.cars.length;
  }

  clear(): void {
    this.cars = [];
    this.junctionTimer = 0;
  }

  /** Populate the loop with `n` cars spaced out and given varied target speeds. */
  spawn(n: number, rand: () => number = () => this.rng.next(), profile: TrafficProfile = this.profile): void {
    this.clear();
    const L = this.road.path.length;
    const minSpacing = 14;
    const attempts = n * 20;
    let placed = 0;
    for (let i = 0; i < attempts && placed < n; i++) {
      const lane = Math.floor(rand() * this.road.numLanes);
      const s = rand() * L;
      // Keep the ego's start box (s ≈ 0) clear so nothing spawns on top of it.
      if (s < 30 || s > L - 75) continue;
      // Reject if too close to an existing car in the same lane.
      let ok = true;
      for (const c of this.cars) {
        if (c.lane === lane && Math.abs(mod(c.s - s + L / 2, L) - L / 2) < minSpacing) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      let kind: CarKind = "car";
      if (profile === "vietnam") {
        const typeRoll = rand();
        kind = typeRoll < 0.62 ? "motorcycle" : typeRoll < 0.73 ? "bus" : typeRoll < 0.8 ? "truck" : "car";
      }
      if(this.road.profile?.motorway&&kind==='motorcycle')kind='car';
      if(this.road.profile?.speedKph===30&&(kind==='bus'||kind==='truck'))kind='car';
      const dimensions = trafficDimensions(kind);
      const desired = kind === "motorcycle"
        ? 10 + rand() * 9
        : kind === "bus"
          ? 9 + rand() * 9
          : kind === "truck"
            ? 13 + rand() * 8
            : 15 + rand() * 12;
      this.cars.push(
        this.make(
          lane,
          s,
          desired * (0.6 + 0.4 * rand()),
          desired,
          kind === "car" ? 4.4 + rand() * 0.8 : dimensions.length,
          dimensions.width,
          kind,
        ),
      );
      placed++;
    }
    this.applyRoadRules();this.spawnOncoming();
  }

  applyRoadRules():void{
    const profile=this.road.profile;if(!profile)return;
    this.cars=this.cars.filter(c=>!profile.motorway||c.kind!=='motorcycle'||c.crossing);
    if(profile.speedKph<=30)this.cars=this.cars.filter(c=>c.kind!=='truck'&&c.kind!=='bus');
    for(const c of this.cars)c.desiredSpeed=Math.min(c.desiredSpeed,profile.speedKph/3.6);
  }

  spawnOncoming():void{
    if(!this.road.opposingLanes||this.cars.some(c=>c.oncoming))return;
    const candidates=this.cars.filter(c=>!c.crossing&&!c.disabled&&c.kind!=='stalled'&&c.cutInTimer<0&&c.stopTimer<=0);
    const count=Math.floor(candidates.length*.35),L=this.road.path.length;
    for(let i=0;i<count;i++){
      const car=candidates[candidates.length-1-i];car.oncoming=true;car.lane=i%this.road.opposingLanes;
      car.d=this.road.oncomingCenter(car.lane);car.s=mod(65+i*L/Math.max(count,1),L);
      car.v=-Math.max(3,car.desiredSpeed*.75);car.headingOffset=Math.PI;car.shareOffset=0;car.changeCooldown=9999;
    }
  }

  private make(
    lane: number,
    s: number,
    v: number,
    desiredSpeed: number,
    length: number,
    width: number,
    kind: CarKind,
  ): TrafficCar {
    return {
      id: this.nextId++,
      s,
      d: this.road.laneCenter(lane),
      v,
      lane,
      desiredSpeed,
      length,
      width,
      changeCooldown: this.rng.range(0, 3),
      hue: this.rng.next(),
      kind,
      variant: kind === "car" ? this.rng.int(3) : 0,
      cutInTimer: -1,
      cutInLane: lane,
      crossing: false,
      crossingToD: 0,
      crossingSpeed: 0,
      stopTimer: 0,
      disabled: false,
      weaveTimer: 0,
      weaveRemaining: 0,
      weaveLaneA: lane,
      weaveLaneB: lane,
      shareOffset: kind === "motorcycle" ? this.rng.range(-0.65, 0.65) : 0,
    };
  }

  addTestVehicle(kind: CarKind, lane: number, s: number, speed: number, desiredSpeed = speed): TrafficCar {
    const dims = trafficDimensions(kind);
    const car = this.make(lane, mod(s, this.road.path.length), speed, desiredSpeed, dims.length, dims.width, kind);
    car.changeCooldown = 30;
    this.cars.push(car);
    return car;
  }

  addCrossingVehicle(kind: "car" | "motorcycle", s: number, speed = 3.2, triggerDist = 0): TrafficCar {
    const lane = Math.floor(this.road.numLanes / 2);
    const car = this.addTestVehicle(kind, lane, s, 0, 0);
    car.d = this.road.rightEdge - 2.5;
    car.crossing = true;
    car.headingOffset = Math.PI / 2;
    car.crossingToD = this.road.leftEdge + 2.5;
    car.crossingSpeed = speed;
    car.crossingTriggerDist = triggerDist;
    car.changeCooldown = 30;
    return car;
  }

  addWeavingMotorcycle(laneA: number, laneB: number, s: number, speed = 12): TrafficCar {
    const laneLeft = clamp(laneA, 0, this.road.numLanes - 1);
    const laneRight = clamp(laneB, 0, this.road.numLanes - 1);
    const bike = this.addTestVehicle("motorcycle", laneLeft, s, speed, speed + 2);
    bike.weaveLaneA = laneLeft;
    bike.weaveLaneB = laneRight;
    bike.weaveRemaining = 4;
    bike.weaveTimer = 0.7;
    bike.changeCooldown = 30;
    return bike;
  }

  addStoppedBus(lane: number, s: number, stopDuration = 8): TrafficCar {
    const bus = this.addTestVehicle("bus", lane, s, 0, 8);
    bus.stopTimer = stopDuration;
    return bus;
  }

  /** Set up a named demo scenario. `egoLane` is the ego's starting lane. */
  spawnScenario(name: ScenarioName, egoLane: number): void {
    const L = this.road.path.length;
    switch (name) {
      case "highway":
        if(this.districtDensity!==undefined){this.populateDistrict(0,this.districtDensity);break;}
        this.spawn(this.road.profile?.traffic??16);
        break;
      case "dense":
        this.spawn(30);
        break;
      case "trucks": {
        this.spawn(8);
        // A convoy of slow trucks IN THE EGO'S LANE, so it must overtake them.
        for (let i = 0; i < 4; i++) {
          const s = 70 + i * 60;
          const truck=this.make(egoLane, s % L, 12, 13, 9 + i, 2.4, "truck");
          truck.changeCooldown=9999; // Stable convoy: ego must perform the pass.
          this.cars.push(truck);
        }
        break;
      }
      case "stalled": {
        this.spawn(12);
        // A dead-stopped car directly in the ego's path — must be perceived & avoided.
        this.cars.push(this.make(egoLane, 95, 0, 0, 4.6, 1.95, "stalled"));
        break;
      }
      case "cutin": {
        this.spawn(12);
        // An adjacent car, or a motorcycle in the Vietnam profile, cuts into the ego's lane.
        const from = egoLane + 1 < this.road.numLanes ? egoLane + 1 : egoLane - 1;
        const kind = this.profile === "vietnam" ? "motorcycle" : "car";
        const dims = trafficDimensions(kind);
        const car = kind === "motorcycle"
          ? this.make(from, 42, 16, 19, dims.length, dims.width, kind)
          : this.make(from, 42, 20, 22, 4.6, 1.95, kind);
        car.cutInTimer = 2.6;
        car.cutInLane = egoLane;
        this.cars.push(car);
        break;
      }
      case "blindspot": {
        this.spawn(10);
        const sideLane = egoLane + 1 < this.road.numLanes ? egoLane + 1 : egoLane - 1;
        const kind = this.profile === "vietnam" ? "motorcycle" : "car";
        const dims = trafficDimensions(kind);
        const sideVehicle = this.make(sideLane, mod(-5, L), 14, 18, dims.length, dims.width, kind);
        sideVehicle.changeCooldown = 30;
        this.cars.push(sideVehicle);
        break;
      }
      case "motorcycle-weave": {
        this.spawn(10, undefined, "vietnam");
        const sideLane = egoLane + 1 < this.road.numLanes ? egoLane + 1 : egoLane - 1;
        for (let i = 0; i < 3; i++) {
          this.addWeavingMotorcycle(sideLane, egoLane, 24 + i * 20, 11 + i * 1.2);
        }
        break;
      }
      case "bus-stop": {
        this.spawn(8, undefined, "vietnam");
        this.addStoppedBus(egoLane, 68, 10);
        break;
      }
      case "traffic-jam": {
        this.clear();
        for (let i = 0; i < 9; i++) {
          const lane = i % this.road.numLanes;
          const queue = Math.floor(i / this.road.numLanes);
          const kind: CarKind = this.profile === "vietnam" && i % 2 === 0 ? "motorcycle" : "car";
          const vehicle = this.addTestVehicle(kind, lane, 20 + queue * 8, 0, 3.2);
          vehicle.stopTimer = 5 + queue * 1.5;
        }
        break;
      }
      case "truck-breakdown": {
        this.spawn(8, undefined, "vietnam");
        const truck = this.addTestVehicle("truck", egoLane, 86, 0, 0);
        truck.disabled = true;
        break;
      }
      case "vietnam-rush":
        this.spawn(28, undefined, "vietnam");
        for (let i = 0; i < 2; i++) {
          const sideLane = egoLane + 1 < this.road.numLanes ? egoLane + 1 : egoLane - 1;
          this.addWeavingMotorcycle(sideLane, egoLane, 30 + i * 24, 12 + i);
        }
        break;
    }
  }

  setDensity(n: number): void {
    if (n === this.cars.length) return;
    this.spawn(n);
  }
  /** Distribute the interactive city's traffic over the visible district, with
   * enough headway per lane. Laboratory scenarios retain their seeded layout. */
  populateDistrict(egoS:number,count=48):void{
    this.districtDensity=count;
    this.spawn(count);const L=this.road.path.length;
    const slots=Array.from({length:this.road.numLanes},()=>0);
    for(const car of this.cars){
      if(car.oncoming)continue;
      const row=slots[car.lane]++;
      car.s=mod(egoS+65+row*29+car.lane*9,L);car.v=Math.min(car.v,10);
    }
  }

  /** Advance all ambient cars by dt, reacting to each other and to the ego. */
  /**
   * Advance all ambient cars by dt, reacting to each other, the ego, the
   * signalised stop lines and pedestrians crossing the road.
   */
  update(
    dt: number,
    ego: EgoSnapshot,
    ignoreEgoForLaneChangeIncentive = false,
    lights: TrafficLight[] = [],
    peds: Pedestrian[] = [],
  ): void {
    const L = this.road.path.length;
    const finishedCrossings = new Set<number>();

    // Build per-lane, station-sorted lists including the ego virtual vehicle.
    const lanes: LaneEntry[][] = Array.from({ length: this.road.numLanes }, () => []);
    for (const c of this.cars) {
      if (c.crossing || c.oncoming) continue;
      for (let lane = 0; lane < this.road.numLanes; lane++) {
        if (Math.abs(c.d - this.road.laneCenter(lane)) > (trafficFootprint(c).width + 1.9) / 2 + .2) continue;
        lanes[lane].push({ s: c.s, v: c.v, length: trafficFootprint(c).length, car: c });
      }
    }
    for (let lane = 0; lane < this.road.numLanes; lane++) {
      if (Math.abs(ego.d - this.road.laneCenter(lane)) < ((ego.width ?? 2) + 2.4) / 2 + .2) lanes[lane].push({ s: ego.s, v: ego.v, length: ego.length, car: null });
    }
    for (const lane of lanes) lane.sort((a, b) => a.s - b.s);

    // --- Longitudinal (IDM) + lane-change (MOBIL) decisions -----------------
    for (const c of this.cars) {
      if(c.oncoming){
        if(c.disabled){c.v=0;continue;}
        let gap=1000,leadV=Math.abs(c.v);
        for(const other of [...this.cars,ego]){
          if(other===c||Math.abs(other.d-c.d)>((other.width??2)+c.width)/2+.2)continue;
          const ds=mod(c.s-other.s,L),candidate=ds-(c.length+other.length)/2;
          if(ds>1e-3&&candidate<gap){gap=candidate;leadV=Math.max(0,-other.v);}
        }
        for(const ped of peds){
          if(ped.state!=='crossing'||Math.abs(ped.d-c.d)>c.width/2+ped.radius+1)continue;
          const ds=mod(c.s-ped.s,L);if(ds<40&&ds-c.length/2-1<gap){gap=ds-c.length/2-1;leadV=0;}
        }
        const speed=Math.abs(c.v),accel=idmAcceleration(speed,Math.max(gap,.1),speed-leadV,{...this.idm,v0:c.desiredSpeed});
        c.v=-clamp(speed+accel*dt,0,c.desiredSpeed);c.s=mod(c.s+c.v*dt,L);c.headingOffset=Math.PI;
        continue;
      }
      if (c.crossing) {
        if (c.disabled) { c.v = 0; continue; }
        if (!c.crossingStarted && c.activationGear && ego.gear !== c.activationGear) continue;
        if (!c.crossingStarted && c.signalS !== undefined) {
          const signal = lights.find(light => light.s === c.signalS);
          if (!signal || signal.state !== "red" || signal.remaining < 2) continue;
          const trafficInJunction = [...this.cars.filter(other => !other.crossing), ego].some(other => Math.abs(mod(other.s - c.s + L / 2, L) - L / 2) < (other.length + c.width) / 2 + .3);
          if (trafficInJunction) continue;
        }
        if (c.crossingTriggerDist && c.crossingTriggerDist > 0) {
          const egoDist = mod(c.s - ego.s, L);
          if (egoDist > c.crossingTriggerDist || egoDist < -5) {
            // Wait for ego vehicle to get within trigger distance
            continue;
          }
        }
        const dir = Math.sign(c.crossingToD - c.d);
        c.crossingStarted = true;
        c.headingOffset = dir * Math.PI / 2;
        c.d += dir * c.crossingSpeed * dt;
        if ((dir > 0 && c.d >= c.crossingToD) || (dir < 0 && c.d <= c.crossingToD)) {
          c.d = c.crossingToD;
          c.crossing = false;
          finishedCrossings.add(c.id);
        }
        continue;
      }
      // Stalled cars are inert obstacles.
      if (c.kind === "stalled" || c.disabled) {
        c.v = 0;
        continue;
      }
      if(c.brakeTestDelay!==undefined){
        c.brakeTestDelay=Math.max(0,c.brakeTestDelay-dt);
        if(c.brakeTestDelay===0)c.v=Math.max(0,c.v-8*dt);
        c.s=mod(c.s+c.v*dt,L);
        if(c.v===0){c.kind="stalled";delete c.brakeTestDelay;}
        continue;
      }
      if (c.stopTimer > 0) {
        c.stopTimer = Math.max(0, c.stopTimer - dt);
        c.v = 0;
        continue;
      }
      // Scripted cut-in: after the timer expires, force the swerve.
      if (c.cutInTimer > 0) {
        c.cutInTimer -= dt;
        if (c.cutInTimer <= 0) {
          c.lane = c.cutInLane;
          c.changeCooldown = 5;
        }
      }
      if (c.weaveRemaining > 0) {
        c.weaveTimer -= dt;
        if (c.weaveTimer <= 0) {
          c.lane = c.lane === c.weaveLaneA ? c.weaveLaneB : c.weaveLaneA;
          c.weaveRemaining--;
          c.weaveTimer = 0.85;
          c.changeCooldown = 30;
        }
      }

      const bike = c.kind === "motorcycle";
      if (c.shareOffset === undefined) c.shareOffset = 0;
      const idmForCar: IDMParams = { ...(bike ? MOTORCYCLE_IDM : this.idm), v0: c.desiredSpeed };
      const mobilForCar: MobilParams = bike ? MOTORCYCLE_MOBIL : this.mobil;

      const lead = this.lead(lanes[c.lane], c.s, c.length);
      let gap = lead ? lead.gap : 1000;
      let leadV = lead ? lead.v : c.v;

      // Signalised stop lines: brake for red (and for yellow when there is still
      // room to stop), then queue behind the line. A car already past the line
      // is unaffected because the wrapped station becomes a long way behind.
      for (const lt of lights) {
        const fwd = mod(lt.s - c.s, L);
        if (fwd <= 0 || fwd > 70) continue;
        const mustStop = lt.state === "red" || (lt.state === "yellow" && fwd > 10);
        if (!mustStop) continue;
        const stopGap = Math.max(fwd - 2 - c.length / 2, 0.5);
        if (stopGap < gap) {
          gap = stopGap;
          leadV = 0;
        }
      }

      // Pedestrians on the carriageway ahead: treat them as a stopped obstacle
      // so ambient traffic yields instead of driving through the crosswalk.
      for (const p of peds) {
        if (p.state === "done") continue;
        const fwd = mod(p.s - c.s, L);
        if (fwd <= 0 || fwd > 28) continue;
        const lateral = Math.abs(p.d - c.d);
        if (lateral > (c.width + p.radius * 2) / 2 + 1.2) continue;
        const pedGap = Math.max(fwd - c.length / 2 - 1.5, 0.5);
        if (pedGap < gap) {
          gap = pedGap;
          leadV = 0;
        }
      }

      // Perpendicular traffic has a body spanning the lane even though it is
      // not in a lane-following neighbour list. Predict its lateral arrival.
      for (const other of this.cars) {
        if (!other.crossing || other.id === c.id) continue;
        const fwd = mod(other.s - c.s, L);
        if (fwd <= 0 || fwd > 65) continue;
        const arrival = fwd / Math.max(c.v, 1);
        const predicted = other.d + Math.sign(other.crossingToD - other.d) * other.crossingSpeed * Math.min(arrival, 3);
        const reach = (other.length + c.width) / 2 + .5;
        if (Math.abs(other.d - c.d) > reach && Math.abs(predicted - c.d) > reach && (other.d - c.d) * (predicted - c.d) > 0) continue;
        const crossGap = Math.max(fwd - c.length / 2 - other.width / 2 - 1.2, .1);
        if (crossGap < gap) { gap = crossGap; leadV = 0; }
      }

      const accel = idmAcceleration(c.v, Math.max(gap, 0.1), c.v - leadV, idmForCar);

      // Lane-change consideration (rate-limited).
      c.changeCooldown -= dt;
      const settled = Math.abs(c.d - (this.road.laneCenter(c.lane) + c.shareOffset)) < (bike ? 0.55 : 0.3);
      if (c.changeCooldown <= 0 && settled) {
        const options: number[] = [];
        if (c.lane + 1 < this.road.numLanes) options.push(c.lane + 1);
        if (c.lane - 1 >= 0) options.push(c.lane - 1);
        for (const target of options) {
          const curLead = this.leadNeighbor(lanes[c.lane], c.s, c.length, c.v);
          // Human-controlled brake tests can disable ego-induced yielding, so a
          // lead actor stays in place and exposes the AEB stopping behavior.
          // Keep the ego in the target-lane safety gate in either mode.
          const curFollower = this.followerNeighbor(
            lanes[c.lane], c.s, c.length, c.v, ignoreEgoForLaneChangeIncentive,
          );
          const newLead = this.leadNeighbor(lanes[target], c.s, c.length, c.v);
          const newFollower = this.followerNeighbor(lanes[target], c.s, c.length, c.v);
          // Slight bias toward the right-most lanes (lower index) for realism.
          const bias = (c.lane - target) * mobilForCar.bias;
          if (
            mobilShouldChange(c.v, curLead, curFollower, newLead, newFollower, idmForCar, mobilForCar, bias)
          ) {
            c.lane = target;
            c.changeCooldown = bike ? 1.1 + this.rng.next() * 1.4 : 4 + this.rng.next() * 2;
            break;
          }
        }
      }

      // Integrate longitudinal motion.
      c.v = clamp(c.v + accel * dt, 0, c.desiredSpeed * 1.15);
      c.s = mod(c.s + c.v * dt, L);
      // Ease lateral offset toward the committed lane centre (smooth changes).
      const targetD = this.road.laneCenter(c.lane) + (bike ? c.shareOffset : 0);
      const previousD = c.d;
      c.d = smoothTowards(c.d, targetD, bike ? 3.2 : 2.5, dt);
      c.headingOffset = clamp(Math.atan2((c.d - previousD) / Math.max(dt, .0001), Math.max(c.v, .5)), -.5, .5);
    }
    // A perpendicular actor exits the roadway after traversing it; it must not
    // turn into an ordinary lane-following vehicle at the far shoulder.
    if (finishedCrossings.size > 0) {
      this.cars = this.cars.filter((car) => !finishedCrossings.has(car.id));
    }
  }

  /**
   * When the loop's signal is red, treat the painted cross-street as having
   * green and occasionally send a vehicle across the junction.
   */
  spawnJunctionCrossings(dt: number, lights: TrafficLight[], egoS: number): void {
    if (!this.junctionTraffic) return;
    this.junctionTimer += dt;
    if (this.junctionTimer < 3.2) return;
    this.junctionTimer = 0;
    const L = this.road.path.length;
    const crossingCount = this.cars.filter((car) => car.crossing).length;
    if (crossingCount >= 2) return;
    for (const light of lights) {
      if (light.state !== "red") continue;
      const kind = this.profile === "vietnam" ? "motorcycle" : "car";
      const speed = kind === "motorcycle" ? 4.4 : 3.4;
      if (light.remaining < (this.road.totalWidth + 5) / speed + .8) continue;
      const fromEgo = mod(light.s - egoS, L);
      if (fromEgo < 28 || fromEgo > 90) continue;
      if (this.cars.some((car) => car.crossing && Math.abs(mod(car.s - light.s + L / 2, L) - L / 2) < 12)) continue;
      if (this.rng.next() > 0.55) continue;
      const actor = this.addCrossingVehicle(kind, light.s + 8 + this.rng.range(-1, 1), speed);
      actor.signalS = light.s;
      break;
    }
  }

  // ---- neighbour queries -------------------------------------------------

  /** Nearest vehicle AHEAD of station `s` in a sorted lane; gap is bumper-to-bumper. */
  private lead(list: LaneEntry[], s: number, selfLen: number): { v: number; gap: number } | null {
    const L = this.road.path.length;
    let best: LaneEntry | null = null;
    let bestFwd = Infinity;
    for (const e of list) {
      const fwd = mod(e.s - s, L);
      if (fwd > 1e-3 && fwd < bestFwd) {
        bestFwd = fwd;
        best = e;
      }
    }
    if (!best) return null;
    return { v: best.v, gap: bestFwd - (selfLen / 2 + best.length / 2) };
  }

  private follower(list: LaneEntry[], s: number, selfLen: number): { v: number; gap: number } | null {
    const L = this.road.path.length;
    let best: LaneEntry | null = null;
    let bestBack = Infinity;
    for (const e of list) {
      const back = mod(s - e.s, L);
      if (back > 1e-3 && back < bestBack) {
        bestBack = back;
        best = e;
      }
    }
    if (!best) return null;
    return { v: best.v, gap: bestBack - (selfLen / 2 + best.length / 2) };
  }

  private leadNeighbor(list: LaneEntry[], s: number, selfLen: number, selfV: number): Neighbor | null {
    const l = this.lead(list, s, selfLen);
    return l ? { v: l.v, gap: Math.max(l.gap, 0.1), dv: selfV - l.v } : null;
  }

  private followerNeighbor(
    list: LaneEntry[],
    s: number,
    selfLen: number,
    selfV: number,
    ignoreVirtualEgo = false,
  ): Neighbor | null {
    const candidates = ignoreVirtualEgo ? list.filter((entry) => entry.car !== null) : list;
    const f = this.follower(candidates, s, selfLen);
    return f ? { v: f.v, gap: Math.max(f.gap, 0.1), dv: f.v - selfV } : null;
  }
}
