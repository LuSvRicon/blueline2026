// src/core/math.ts
var TWO_PI = Math.PI * 2;
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function wrapAngle(a) {
  let x = a % TWO_PI;
  if (x <= -Math.PI) x += TWO_PI;
  else if (x > Math.PI) x -= TWO_PI;
  return x;
}
function wrapDiff(a, b, len) {
  let d = (a - b) % len;
  if (d < -len / 2) d += len;
  else if (d > len / 2) d -= len;
  return d;
}
function mod(a, n) {
  return (a % n + n) % n;
}
function smoothTowards(current, target, rate, dt2) {
  const t = 1 - Math.exp(-rate * dt2);
  return current + (target - current) * t;
}

// src/world/ReferencePath.ts
var ReferencePath = class {
  xs = [];
  ys = [];
  ss = [];
  // cumulative arc length at each sample
  headings = [];
  length;
  // total loop length
  count;
  constructor(controlPoints, samplesPerSegment = 60) {
    const n = controlPoints.length;
    for (let i = 0; i < n; i++) {
      const p0 = controlPoints[mod(i - 1, n)];
      const p1 = controlPoints[i];
      const p2 = controlPoints[mod(i + 1, n)];
      const p3 = controlPoints[mod(i + 2, n)];
      for (let j = 0; j < samplesPerSegment; j++) {
        const t = j / samplesPerSegment;
        const [x, y] = catmullRom(p0, p1, p2, p3, t);
        this.xs.push(x);
        this.ys.push(y);
      }
    }
    this.count = this.xs.length;
    let acc = 0;
    for (let i = 0; i < this.count; i++) {
      this.ss.push(acc);
      const ni = (i + 1) % this.count;
      const dx = this.xs[ni] - this.xs[i];
      const dy = this.ys[ni] - this.ys[i];
      acc += Math.hypot(dx, dy);
    }
    this.length = acc;
    for (let i = 0; i < this.count; i++) {
      const pi = (i - 1 + this.count) % this.count;
      const ni = (i + 1) % this.count;
      const dx = this.xs[ni] - this.xs[pi];
      const dy = this.ys[ni] - this.ys[pi];
      this.headings.push(Math.atan2(dy, dx));
    }
  }
  /** Interpolated world pose (x, y, heading) at a given station s. */
  cartesianAt(s) {
    const sw = mod(s, this.length);
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = lo + hi + 1 >> 1;
      if (this.ss[mid] <= sw) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const ni = (i + 1) % this.count;
    const segLen = (ni === 0 ? this.length : this.ss[ni]) - this.ss[i];
    const t = segLen > 1e-9 ? (sw - this.ss[i]) / segLen : 0;
    const x = this.xs[i] + (this.xs[ni] - this.xs[i]) * t;
    const y = this.ys[i] + (this.ys[ni] - this.ys[i]) * t;
    const heading = this.headings[i] + shortestAngle(this.headings[i], this.headings[ni]) * t;
    return { x, y, heading };
  }
  /** Absolute road curvature |dθ/ds| at station s (1/m). Higher = tighter bend. */
  curvatureAt(s) {
    const ds = 4;
    const h1 = this.cartesianAt(mod(s - ds, this.length)).heading;
    const h2 = this.cartesianAt(mod(s + ds, this.length)).heading;
    let dh = h2 - h1;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh <= -Math.PI) dh += Math.PI * 2;
    return Math.abs(dh) / (2 * ds);
  }
  /** Signed road curvature dθ/ds at station s (left turn positive). */
  signedCurvatureAt(s) {
    const ds = 4;
    const h1 = this.cartesianAt(mod(s - ds, this.length)).heading;
    const h2 = this.cartesianAt(mod(s + ds, this.length)).heading;
    let dh = h2 - h1;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh <= -Math.PI) dh += Math.PI * 2;
    return dh / (2 * ds);
  }
  /** Max curvature over the next `dist` metres from s (for speed planning). */
  maxCurvatureAhead(s, dist) {
    let k = 0;
    for (let d = 0; d <= dist; d += 4) k = Math.max(k, this.curvatureAt(s + d));
    return k;
  }
  /** World point offset laterally by d from the centerline at station s. */
  toCartesian(s, d) {
    const { x, y, heading } = this.cartesianAt(s);
    const nx = -Math.sin(heading);
    const ny = Math.cos(heading);
    return { x: x + nx * d, y: y + ny * d, heading };
  }
  /**
   * Project a world point to Frenet (s, d). `hint` is a sample index near the
   * expected answer (e.g. last frame's index) to keep the search local & cheap;
   * pass -1 to search the whole loop.
   */
  toFrenet(x, y, hint = -1) {
    let bestI = 0;
    let bestDist = Infinity;
    if (hint >= 0) {
      const window = 90;
      for (let k = -window; k <= window; k++) {
        const i = mod(hint + k, this.count);
        const dx = x - this.xs[i];
        const dy = y - this.ys[i];
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestI = i;
        }
      }
    } else {
      for (let i = 0; i < this.count; i++) {
        const dx = x - this.xs[i];
        const dy = y - this.ys[i];
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestI = i;
        }
      }
    }
    const h = this.headings[bestI];
    const tx = Math.cos(h);
    const ty = Math.sin(h);
    const rx = x - this.xs[bestI];
    const ry = y - this.ys[bestI];
    const d = tx * ry - ty * rx;
    const along = tx * rx + ty * ry;
    return { s: mod(this.ss[bestI] + along, this.length), d, index: bestI };
  }
};
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}
function shortestAngle(a, b) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff <= -Math.PI) diff += Math.PI * 2;
  return diff;
}

// src/world/Road.ts
var Road = class {
  path;
  numLanes;
  laneWidth;
  constructor(path, numLanes = 3, laneWidth = 3.7) {
    this.path = path;
    this.numLanes = numLanes;
    this.laneWidth = laneWidth;
  }
  get totalWidth() {
    return this.numLanes * this.laneWidth;
  }
  /** Signed lateral offset (d) of the centre of lane `i`. Right lanes are -d. */
  laneCenter(i) {
    return (i - (this.numLanes - 1) / 2) * this.laneWidth;
  }
  /** Which lane index a given lateral offset falls into (clamped to the road). */
  laneOf(d) {
    const raw = Math.round(d / this.laneWidth + (this.numLanes - 1) / 2);
    return Math.max(0, Math.min(this.numLanes - 1, raw));
  }
  /** d of the left/right paint edge of the drivable surface. */
  get leftEdge() {
    return this.totalWidth / 2;
  }
  get rightEdge() {
    return -this.totalWidth / 2;
  }
};

// src/world/track.ts
function cityLoop(halfW, halfH, r) {
  const pts = [];
  const corners = [];
  const step = 9;
  const emitStraight = (x0, y0, x1, y1) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  };
  const emitArc = (cx, cy, a0, a1) => {
    const n = Math.max(3, Math.round(Math.abs(a1 - a0) * r / step));
    for (let i = 0; i < n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    corners.push([cx, cy]);
  };
  const C = [
    { cx: halfW - r, cy: -halfH + r, a0: -Math.PI / 2, a1: 0 },
    { cx: halfW - r, cy: halfH - r, a0: 0, a1: Math.PI / 2 },
    { cx: -halfW + r, cy: halfH - r, a0: Math.PI / 2, a1: Math.PI },
    { cx: -halfW + r, cy: -halfH + r, a0: Math.PI, a1: 1.5 * Math.PI }
  ];
  for (let i = 0; i < 4; i++) {
    emitArc(C[i].cx, C[i].cy, C[i].a0, C[i].a1);
    const ex = C[i].cx + r * Math.cos(C[i].a1);
    const ey = C[i].cy + r * Math.sin(C[i].a1);
    const next = C[(i + 1) % 4];
    const sx = next.cx + r * Math.cos(next.a0);
    const sy = next.cy + r * Math.sin(next.a0);
    emitStraight(ex, ey, sx, sy);
  }
  return { pts, corners };
}
var loop = cityLoop(360, 250, 40);
var CIRCUIT = {
  id: "city",
  name: "City Loop",
  controlPoints: loop.pts,
  junctions: loop.corners
};
var DEFAULT_TRACK = CIRCUIT;

// src/vehicle/Vehicle.ts
var EGO_DIMS = { length: 4.7, width: 2, wheelbase: 2.8 };
var Vehicle = class {
  x;
  y;
  yaw;
  v;
  a = 0;
  // last applied acceleration (for telemetry / planner seeding)
  delta = 0;
  // last applied steering angle
  dims;
  maxSteer;
  maxAccel;
  maxDecel;
  maxSpeed;
  /** Road-surface friction multiplier (1 = dry, <1 rain/fog). */
  surfaceMu = 1;
  constructor(x, y, yaw, v, dims = EGO_DIMS, opts = {}) {
    this.x = x;
    this.y = y;
    this.yaw = yaw;
    this.v = v;
    this.dims = dims;
    this.maxSteer = opts.maxSteer ?? 35 * Math.PI / 180;
    this.maxAccel = opts.maxAccel ?? 3.5;
    this.maxDecel = opts.maxDecel ?? 7;
    this.maxSpeed = opts.maxSpeed ?? 40;
  }
  /** Integrate one step. `steer` and `accel` are clamped to physical limits. */
  step(steer, accel, dt2) {
    this.delta = clamp(steer, -this.maxSteer, this.maxSteer);
    this.a = clamp(accel, -this.maxDecel, this.maxAccel);
    const mu = clamp(this.surfaceMu, 0.35, 1);
    const applied = clamp(this.a, -this.maxDecel * mu, this.maxAccel * mu);
    this.v = clamp(this.v + applied * dt2, 0, this.maxSpeed);
    this.x += this.v * Math.cos(this.yaw) * dt2;
    this.y += this.v * Math.sin(this.yaw) * dt2;
    this.yaw += this.v / this.dims.wheelbase * Math.tan(this.delta) * dt2;
    if (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
    else if (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;
  }
};

// src/control/PID.ts
var PID = class {
  constructor(kp, ki, kd, outMin = -Infinity, outMax = Infinity) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
    this.outMin = outMin;
    this.outMax = outMax;
  }
  integral = 0;
  prevError = 0;
  initialized = false;
  reset() {
    this.integral = 0;
    this.prevError = 0;
    this.initialized = false;
  }
  update(error, dt2) {
    if (dt2 <= 0) return 0;
    this.integral += error * dt2;
    const iLimit = 5;
    this.integral = clamp(this.integral, -iLimit, iLimit);
    const derivative = this.initialized ? (error - this.prevError) / dt2 : 0;
    this.prevError = error;
    this.initialized = true;
    const out = this.kp * error + this.ki * this.integral + this.kd * derivative;
    return clamp(out, this.outMin, this.outMax);
  }
};

// src/control/Stanley.ts
function stanleyControl(headingErr, crossTrack, v, cfg) {
  const crossSteer = Math.atan2(-cfg.k * crossTrack, v + cfg.kSoft);
  return clamp(headingErr + crossSteer, -cfg.maxSteer, cfg.maxSteer);
}

// src/core/rng.ts
var Rng = class {
  state;
  initial;
  constructor(seed = 1) {
    this.initial = seed >>> 0;
    this.state = this.initial;
  }
  get seed() {
    return this.initial;
  }
  reset(seed = this.initial) {
    this.state = seed >>> 0;
  }
  /** Uniform [0, 1). */
  next() {
    let t = this.state = this.state + 1831565813 >>> 0;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  /** Uniform [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }
  /** Integer in [0, n). */
  int(n) {
    return Math.floor(this.next() * n);
  }
  /** Box–Muller normal sample (mean 0, std-dev 1). */
  normal() {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  pick(items) {
    return items[this.int(items.length)];
  }
  /** Snapshot/restore support for deterministic replay. */
  getState() {
    return this.state >>> 0;
  }
  setState(state) {
    this.state = state >>> 0;
  }
};

// src/traffic/IDM.ts
var DEFAULT_IDM = {
  v0: 22,
  T: 1.5,
  a: 1.2,
  b: 1.8,
  s0: 2.5,
  delta: 4
};
var MOTORCYCLE_IDM = {
  v0: 18,
  T: 0.7,
  a: 2.2,
  b: 2.6,
  s0: 1.1,
  delta: 4
};
function idmAcceleration(v, gap, dv, p) {
  const g = Math.max(gap, 0.1);
  const sStar = p.s0 + Math.max(0, v * p.T + v * dv / (2 * Math.sqrt(p.a * p.b)));
  const freeRoad = 1 - Math.pow(v / p.v0, p.delta);
  const interaction = (sStar / g) ** 2;
  const accel = p.a * (freeRoad - interaction);
  return Math.max(accel, -8);
}

// src/traffic/MOBIL.ts
var DEFAULT_MOBIL = {
  politeness: 0.2,
  threshold: 0.2,
  bSafe: 4,
  bias: 0.1
};
var MOTORCYCLE_MOBIL = {
  politeness: 0.04,
  threshold: 0.06,
  bSafe: 5.5,
  bias: 0.04
};
var BIG_GAP = 1e3;
function mobilShouldChange(subjectV, curLead, curFollower, newLead, newFollower, idm, mob, laneBias = 0) {
  const aOld = idmAcceleration(subjectV, curLead?.gap ?? BIG_GAP, curLead?.dv ?? 0, idm);
  const aNew = idmAcceleration(subjectV, newLead?.gap ?? BIG_GAP, newLead?.dv ?? 0, idm);
  const newFollowerAfter = newFollower ? idmAcceleration(newFollower.v, newFollower.gap, newFollower.dv, idm) : 0;
  if (newFollower && newFollowerAfter < -mob.bSafe) return false;
  const newFollowerBefore = newFollower ? idmAcceleration(newFollower.v, BIG_GAP, 0, idm) : 0;
  const oldFollowerBefore = curFollower ? idmAcceleration(curFollower.v, curFollower.gap, curFollower.dv, idm) : 0;
  const oldFollowerAfter = curFollower ? idmAcceleration(curFollower.v, BIG_GAP, 0, idm) : 0;
  const selfGain = aNew - aOld;
  const othersImpact = newFollowerAfter - newFollowerBefore + (oldFollowerAfter - oldFollowerBefore);
  const incentive = selfGain + mob.politeness * othersImpact + laneBias;
  return incentive > mob.threshold;
}

// src/traffic/TrafficManager.ts
function trafficDimensions(kind) {
  if (kind === "motorcycle") return { length: 1.9, width: 0.82 };
  if (kind === "bus") return { length: 12, width: 2.55 };
  if (kind === "truck") return { length: 10, width: 2.4 };
  return { length: 4.6, width: 1.9 };
}
var TrafficManager = class {
  constructor(road, rng = new Rng(1)) {
    this.road = road;
    this.rng = rng;
  }
  cars = [];
  profile = "international";
  nextId = 1;
  idm = { ...DEFAULT_IDM };
  mobil = { ...DEFAULT_MOBIL };
  /** When true, red signals can spawn perpendicular crossing traffic. */
  junctionTraffic = false;
  junctionTimer = 0;
  get count() {
    return this.cars.length;
  }
  clear() {
    this.cars = [];
    this.junctionTimer = 0;
  }
  /** Populate the loop with `n` cars spaced out and given varied target speeds. */
  spawn(n, rand = () => this.rng.next(), profile = this.profile) {
    this.clear();
    const L2 = this.road.path.length;
    const minSpacing = 14;
    const attempts = n * 20;
    let placed = 0;
    for (let i = 0; i < attempts && placed < n; i++) {
      const lane = Math.floor(rand() * this.road.numLanes);
      const s = rand() * L2;
      if (s < 22 || s > L2 - 10) continue;
      let ok = true;
      for (const c of this.cars) {
        if (c.lane === lane && Math.abs(mod(c.s - s + L2 / 2, L2) - L2 / 2) < minSpacing) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      let kind = "car";
      if (profile === "vietnam") {
        const typeRoll = rand();
        kind = typeRoll < 0.62 ? "motorcycle" : typeRoll < 0.73 ? "bus" : typeRoll < 0.8 ? "truck" : "car";
      }
      const dimensions = trafficDimensions(kind);
      const desired = kind === "motorcycle" ? 10 + rand() * 9 : kind === "bus" ? 9 + rand() * 9 : kind === "truck" ? 13 + rand() * 8 : 15 + rand() * 12;
      this.cars.push(
        this.make(
          lane,
          s,
          desired * (0.6 + 0.4 * rand()),
          desired,
          kind === "car" ? 4.4 + rand() * 0.8 : dimensions.length,
          dimensions.width,
          kind
        )
      );
      placed++;
    }
  }
  make(lane, s, v, desiredSpeed, length, width, kind) {
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
      shareOffset: kind === "motorcycle" ? this.rng.range(-0.65, 0.65) : 0
    };
  }
  addTestVehicle(kind, lane, s, speed, desiredSpeed = speed) {
    const dims = trafficDimensions(kind);
    const car = this.make(lane, mod(s, this.road.path.length), speed, desiredSpeed, dims.length, dims.width, kind);
    car.changeCooldown = 30;
    this.cars.push(car);
    return car;
  }
  addCrossingVehicle(kind, s, speed = 3.2) {
    const lane = Math.floor(this.road.numLanes / 2);
    const car = this.addTestVehicle(kind, lane, s, 0, 0);
    car.d = this.road.rightEdge - 2.5;
    car.crossing = true;
    car.crossingToD = this.road.leftEdge + 2.5;
    car.crossingSpeed = speed;
    car.changeCooldown = 30;
    return car;
  }
  addWeavingMotorcycle(laneA, laneB, s, speed = 12) {
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
  addStoppedBus(lane, s, stopDuration = 8) {
    const bus = this.addTestVehicle("bus", lane, s, 0, 8);
    bus.stopTimer = stopDuration;
    return bus;
  }
  /** Set up a named demo scenario. `egoLane` is the ego's starting lane. */
  spawnScenario(name, egoLane) {
    const L2 = this.road.path.length;
    switch (name) {
      case "highway":
        this.spawn(16);
        break;
      case "dense":
        this.spawn(30);
        break;
      case "trucks": {
        this.spawn(8);
        for (let i = 0; i < 4; i++) {
          const s = 70 + i * 60;
          this.cars.push(this.make(egoLane, s % L2, 12, 13, 9 + i, 2.4, "truck"));
        }
        break;
      }
      case "stalled": {
        this.spawn(12);
        this.cars.push(this.make(egoLane, 95, 0, 0, 4.6, 1.95, "stalled"));
        break;
      }
      case "cutin": {
        this.spawn(12);
        const from = egoLane + 1 < this.road.numLanes ? egoLane + 1 : egoLane - 1;
        const kind = this.profile === "vietnam" ? "motorcycle" : "car";
        const dims = trafficDimensions(kind);
        const car = kind === "motorcycle" ? this.make(from, 42, 16, 19, dims.length, dims.width, kind) : this.make(from, 42, 20, 22, 4.6, 1.95, kind);
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
        const sideVehicle = this.make(sideLane, mod(-5, L2), 14, 18, dims.length, dims.width, kind);
        sideVehicle.changeCooldown = 30;
        this.cars.push(sideVehicle);
        break;
      }
      case "motorcycle-weave": {
        this.spawn(10, void 0, "vietnam");
        const sideLane = egoLane + 1 < this.road.numLanes ? egoLane + 1 : egoLane - 1;
        for (let i = 0; i < 3; i++) {
          this.addWeavingMotorcycle(sideLane, egoLane, 24 + i * 20, 11 + i * 1.2);
        }
        break;
      }
      case "bus-stop": {
        this.spawn(8, void 0, "vietnam");
        this.addStoppedBus(egoLane, 68, 10);
        break;
      }
      case "traffic-jam": {
        this.clear();
        for (let i = 0; i < 9; i++) {
          const lane = i % this.road.numLanes;
          const queue = Math.floor(i / this.road.numLanes);
          const kind = this.profile === "vietnam" && i % 2 === 0 ? "motorcycle" : "car";
          const vehicle = this.addTestVehicle(kind, lane, 20 + queue * 8, 0, 3.2);
          vehicle.stopTimer = 5 + queue * 1.5;
        }
        break;
      }
      case "truck-breakdown": {
        this.spawn(8, void 0, "vietnam");
        const truck = this.addTestVehicle("truck", egoLane, 86, 0, 0);
        truck.disabled = true;
        break;
      }
      case "vietnam-rush":
        this.spawn(28, void 0, "vietnam");
        for (let i = 0; i < 2; i++) {
          const sideLane = egoLane + 1 < this.road.numLanes ? egoLane + 1 : egoLane - 1;
          this.addWeavingMotorcycle(sideLane, egoLane, 30 + i * 24, 12 + i);
        }
        break;
    }
  }
  setDensity(n) {
    if (n === this.cars.length) return;
    this.spawn(n);
  }
  /** Advance all ambient cars by dt, reacting to each other and to the ego. */
  /**
   * Advance all ambient cars by dt, reacting to each other, the ego, the
   * signalised stop lines and pedestrians crossing the road.
   */
  update(dt2, ego, ignoreEgoForLaneChangeIncentive = false, lights = [], peds = []) {
    const L2 = this.road.path.length;
    const finishedCrossings = /* @__PURE__ */ new Set();
    const lanes = Array.from({ length: this.road.numLanes }, () => []);
    for (const c of this.cars) {
      if (c.crossing) continue;
      lanes[clamp(c.lane, 0, this.road.numLanes - 1)].push({
        s: c.s,
        v: c.v,
        length: c.length,
        car: c
      });
    }
    const egoLane = this.road.laneOf(ego.d);
    lanes[egoLane].push({ s: ego.s, v: ego.v, length: ego.length, car: null });
    for (const lane of lanes) lane.sort((a, b) => a.s - b.s);
    for (const c of this.cars) {
      if (c.crossing) {
        const dir = Math.sign(c.crossingToD - c.d);
        c.d += dir * c.crossingSpeed * dt2;
        if (dir > 0 && c.d >= c.crossingToD || dir < 0 && c.d <= c.crossingToD) {
          c.d = c.crossingToD;
          c.crossing = false;
          finishedCrossings.add(c.id);
        }
        continue;
      }
      if (c.kind === "stalled" || c.disabled) {
        c.v = 0;
        continue;
      }
      if (c.stopTimer > 0) {
        c.stopTimer = Math.max(0, c.stopTimer - dt2);
        c.v = 0;
        continue;
      }
      if (c.cutInTimer > 0) {
        c.cutInTimer -= dt2;
        if (c.cutInTimer <= 0) {
          c.lane = c.cutInLane;
          c.changeCooldown = 5;
        }
      }
      if (c.weaveRemaining > 0) {
        c.weaveTimer -= dt2;
        if (c.weaveTimer <= 0) {
          c.lane = c.lane === c.weaveLaneA ? c.weaveLaneB : c.weaveLaneA;
          c.weaveRemaining--;
          c.weaveTimer = 0.85;
          c.changeCooldown = 30;
        }
      }
      const bike = c.kind === "motorcycle";
      if (c.shareOffset === void 0) c.shareOffset = 0;
      const idmForCar = { ...bike ? MOTORCYCLE_IDM : this.idm, v0: c.desiredSpeed };
      const mobilForCar = bike ? MOTORCYCLE_MOBIL : this.mobil;
      const lead = this.lead(lanes[c.lane], c.s, c.length);
      let gap = lead ? lead.gap : 1e3;
      let leadV = lead ? lead.v : c.v;
      for (const lt of lights) {
        const fwd = mod(lt.s - c.s, L2);
        if (fwd <= 0 || fwd > 70) continue;
        const mustStop = lt.state === "red" || lt.state === "yellow" && fwd > 10;
        if (!mustStop) continue;
        const stopGap = Math.max(fwd - 2 - c.length / 2, 0.5);
        if (stopGap < gap) {
          gap = stopGap;
          leadV = 0;
        }
      }
      for (const p of peds) {
        if (p.state === "done") continue;
        const fwd = mod(p.s - c.s, L2);
        if (fwd <= 0 || fwd > 28) continue;
        const lateral = Math.abs(p.d - c.d);
        if (lateral > (c.width + p.radius * 2) / 2 + 1.2) continue;
        const pedGap = Math.max(fwd - c.length / 2 - 1.5, 0.5);
        if (pedGap < gap) {
          gap = pedGap;
          leadV = 0;
        }
      }
      const accel = idmAcceleration(c.v, Math.max(gap, 0.1), c.v - leadV, idmForCar);
      c.changeCooldown -= dt2;
      const settled = Math.abs(c.d - (this.road.laneCenter(c.lane) + c.shareOffset)) < (bike ? 0.55 : 0.3);
      if (c.changeCooldown <= 0 && settled) {
        const options = [];
        if (c.lane + 1 < this.road.numLanes) options.push(c.lane + 1);
        if (c.lane - 1 >= 0) options.push(c.lane - 1);
        for (const target of options) {
          const curLead = this.leadNeighbor(lanes[c.lane], c.s, c.length, c.v);
          const curFollower = this.followerNeighbor(
            lanes[c.lane],
            c.s,
            c.length,
            c.v,
            ignoreEgoForLaneChangeIncentive
          );
          const newLead = this.leadNeighbor(lanes[target], c.s, c.length, c.v);
          const newFollower = this.followerNeighbor(lanes[target], c.s, c.length, c.v);
          const bias = (c.lane - target) * mobilForCar.bias;
          if (mobilShouldChange(c.v, curLead, curFollower, newLead, newFollower, idmForCar, mobilForCar, bias)) {
            c.lane = target;
            c.changeCooldown = bike ? 1.1 + this.rng.next() * 1.4 : 4 + this.rng.next() * 2;
            break;
          }
        }
      }
      c.v = clamp(c.v + accel * dt2, 0, c.desiredSpeed * 1.15);
      c.s = mod(c.s + c.v * dt2, L2);
      const targetD = this.road.laneCenter(c.lane) + (bike ? c.shareOffset : 0);
      c.d = smoothTowards(c.d, targetD, bike ? 3.2 : 2.5, dt2);
    }
    if (finishedCrossings.size > 0) {
      this.cars = this.cars.filter((car) => !finishedCrossings.has(car.id));
    }
  }
  /**
   * When the loop's signal is red, treat the painted cross-street as having
   * green and occasionally send a vehicle across the junction.
   */
  spawnJunctionCrossings(dt2, lights, egoS) {
    if (!this.junctionTraffic) return;
    this.junctionTimer += dt2;
    if (this.junctionTimer < 3.2) return;
    this.junctionTimer = 0;
    const L2 = this.road.path.length;
    const crossingCount = this.cars.filter((car) => car.crossing).length;
    if (crossingCount >= 2) return;
    for (const light of lights) {
      if (light.state !== "red") continue;
      const fromEgo = mod(light.s - egoS, L2);
      if (fromEgo < 28 || fromEgo > 90) continue;
      if (this.cars.some((car) => car.crossing && Math.abs(mod(car.s - light.s + L2 / 2, L2) - L2 / 2) < 12)) continue;
      if (this.rng.next() > 0.55) continue;
      const kind = this.profile === "vietnam" ? "motorcycle" : "car";
      this.addCrossingVehicle(kind, light.s + this.rng.range(-2, 2), kind === "motorcycle" ? 4.4 : 3.4);
      break;
    }
  }
  // ---- neighbour queries -------------------------------------------------
  /** Nearest vehicle AHEAD of station `s` in a sorted lane; gap is bumper-to-bumper. */
  lead(list, s, selfLen) {
    const L2 = this.road.path.length;
    let best = null;
    let bestFwd = Infinity;
    for (const e of list) {
      const fwd = mod(e.s - s, L2);
      if (fwd > 1e-3 && fwd < bestFwd) {
        bestFwd = fwd;
        best = e;
      }
    }
    if (!best) return null;
    return { v: best.v, gap: bestFwd - (selfLen / 2 + best.length / 2) };
  }
  follower(list, s, selfLen) {
    const L2 = this.road.path.length;
    let best = null;
    let bestBack = Infinity;
    for (const e of list) {
      const back = mod(s - e.s, L2);
      if (back > 1e-3 && back < bestBack) {
        bestBack = back;
        best = e;
      }
    }
    if (!best) return null;
    return { v: best.v, gap: bestBack - (selfLen / 2 + best.length / 2) };
  }
  leadNeighbor(list, s, selfLen, selfV) {
    const l = this.lead(list, s, selfLen);
    return l ? { v: l.v, gap: Math.max(l.gap, 0.1), dv: selfV - l.v } : null;
  }
  followerNeighbor(list, s, selfLen, selfV, ignoreVirtualEgo = false) {
    const candidates = ignoreVirtualEgo ? list.filter((entry) => entry.car !== null) : list;
    const f = this.follower(candidates, s, selfLen);
    return f ? { v: f.v, gap: Math.max(f.gap, 0.1), dv: f.v - selfV } : null;
  }
};

// src/core/linalg.ts
function solve2(A, b) {
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  if (Math.abs(det) < 1e-12) return [0, 0];
  const x0 = (b[0] * A[1][1] - A[0][1] * b[1]) / det;
  const x1 = (A[0][0] * b[1] - b[0] * A[1][0]) / det;
  return [x0, x1];
}
function solve3(A, b) {
  const m = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]]
  ];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) continue;
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    for (let r = col + 1; r < 3; r++) {
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let sum = m[r][3];
    for (let c = r + 1; c < 3; c++) sum -= m[r][c] * x[c];
    x[r] = Math.abs(m[r][r]) < 1e-12 ? 0 : sum / m[r][r];
  }
  return [x[0], x[1], x[2]];
}

// src/core/poly.ts
var QuinticPolynomial = class {
  a0;
  a1;
  a2;
  a3;
  a4;
  a5;
  constructor(xs, vs, as, xe, ve, ae, T) {
    this.a0 = xs;
    this.a1 = vs;
    this.a2 = as / 2;
    const T2 = T * T;
    const T3 = T2 * T;
    const T4 = T3 * T;
    const T5 = T4 * T;
    const A = [
      [T3, T4, T5],
      [3 * T2, 4 * T3, 5 * T4],
      [6 * T, 12 * T2, 20 * T3]
    ];
    const b = [
      xe - (this.a0 + this.a1 * T + this.a2 * T2),
      ve - (this.a1 + 2 * this.a2 * T),
      ae - 2 * this.a2
    ];
    const [a3, a4, a5] = solve3(A, b);
    this.a3 = a3;
    this.a4 = a4;
    this.a5 = a5;
  }
  pos(t) {
    const t2 = t * t, t3 = t2 * t, t4 = t3 * t, t5 = t4 * t;
    return this.a0 + this.a1 * t + this.a2 * t2 + this.a3 * t3 + this.a4 * t4 + this.a5 * t5;
  }
  vel(t) {
    const t2 = t * t, t3 = t2 * t, t4 = t3 * t;
    return this.a1 + 2 * this.a2 * t + 3 * this.a3 * t2 + 4 * this.a4 * t3 + 5 * this.a5 * t4;
  }
  acc(t) {
    const t2 = t * t, t3 = t2 * t;
    return 2 * this.a2 + 6 * this.a3 * t + 12 * this.a4 * t2 + 20 * this.a5 * t3;
  }
  jerk(t) {
    const t2 = t * t;
    return 6 * this.a3 + 24 * this.a4 * t + 60 * this.a5 * t2;
  }
};
var QuarticPolynomial = class {
  a0;
  a1;
  a2;
  a3;
  a4;
  constructor(xs, vs, as, ve, ae, T) {
    this.a0 = xs;
    this.a1 = vs;
    this.a2 = as / 2;
    const T2 = T * T;
    const T3 = T2 * T;
    const A = [
      [3 * T2, 4 * T3],
      [6 * T, 12 * T2]
    ];
    const b = [ve - (this.a1 + 2 * this.a2 * T), ae - 2 * this.a2];
    const [a3, a4] = solve2(A, b);
    this.a3 = a3;
    this.a4 = a4;
  }
  pos(t) {
    const t2 = t * t, t3 = t2 * t, t4 = t3 * t;
    return this.a0 + this.a1 * t + this.a2 * t2 + this.a3 * t3 + this.a4 * t4;
  }
  vel(t) {
    const t2 = t * t, t3 = t2 * t;
    return this.a1 + 2 * this.a2 * t + 3 * this.a3 * t2 + 4 * this.a4 * t3;
  }
  acc(t) {
    const t2 = t * t;
    return 2 * this.a2 + 6 * this.a3 * t + 12 * this.a4 * t2;
  }
  jerk(t) {
    return 6 * this.a3 + 24 * this.a4 * t;
  }
};

// src/planner/FrenetPlanner.ts
var DEFAULT_PLANNER = {
  dt: 0.2,
  horizons: [3, 4.5],
  speedSamples: 6,
  desiredSpeed: 24,
  maxSpeed: 40,
  maxAccel: 6.5,
  maxCurvature: 0.25,
  kJerk: 0.08,
  kTime: 0.5,
  kSpeed: 0.8,
  kLaneChange: 2,
  kBias: 6,
  kProximity: 40,
  kOffCenter: 0.4,
  lonMargin: 4,
  latMargin: 1.1
};
var COLLISION_COST = 1e6;
var INFEASIBLE_COST = 1e5;
var FrenetPlanner = class {
  constructor(road, config = {}) {
    this.road = road;
    this.config = { ...DEFAULT_PLANNER, ...config };
  }
  config;
  plan(state, obstacles, currentLane, biasLane, occupancy = null) {
    const cfg = this.config;
    const L2 = this.road.path.length;
    const candidates = [];
    const targetLanes = [];
    for (let i = currentLane - 1; i <= currentLane + 1; i++) {
      if (i >= 0 && i < this.road.numLanes) targetLanes.push(i);
    }
    for (const lane of targetLanes) {
      const dTarget = this.road.laneCenter(lane);
      for (const T of cfg.horizons) {
        const lat = new QuinticPolynomial(
          state.d,
          state.dDot,
          state.dDdot,
          dTarget,
          0,
          0,
          T
        );
        for (let k = 0; k < cfg.speedSamples; k++) {
          const frac = k / Math.max(1, cfg.speedSamples - 1);
          const vTarget = cfg.desiredSpeed * (1 - frac);
          const lon = new QuarticPolynomial(state.s, state.sDot, state.sDdot, vTarget, 0, T);
          const traj = this.build(lat, lon, T, lane, currentLane, biasLane, dTarget, vTarget, obstacles, L2, occupancy);
          candidates.push(traj);
        }
      }
    }
    let best = null;
    for (const c of candidates) {
      if (!best || c.cost < best.cost) best = c;
    }
    return { best, candidates };
  }
  build(lat, lon, T, lane, currentLane, biasLane, dTarget, vTarget, obstacles, L2, occupancy) {
    const cfg = this.config;
    const points = [];
    let jerkSq = 0;
    let feasible = true;
    let colliding = false;
    let proximityCost = 0;
    let maxV = 0;
    const steps = Math.max(2, Math.ceil(T / cfg.dt));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps * T;
      const s = lon.pos(t);
      const d = lat.pos(t);
      const sDot = lon.vel(t);
      const dDot = lat.vel(t);
      const sDdot = lon.acc(t);
      const latJerk = lat.jerk(t);
      const lonJerk = lon.jerk(t);
      const speed = Math.hypot(sDot, dDot);
      maxV = Math.max(maxV, speed);
      jerkSq += (latJerk * latJerk + lonJerk * lonJerk) * cfg.dt;
      const accel = Math.hypot(sDdot, lat.acc(t));
      if (accel > cfg.maxAccel) feasible = false;
      if (speed > cfg.maxSpeed + 1) feasible = false;
      const curvature = speed > 0.5 ? Math.abs(lat.acc(t)) / (speed * speed) : 0;
      if (curvature > cfg.maxCurvature) feasible = false;
      const world = this.road.path.toCartesian(s, d);
      points.push({ t, s, d, x: world.x, y: world.y, v: sDot });
      if (occupancy && t > 0.4 && occupancy.isOccupied(world.x, world.y)) colliding = true;
      for (const ob of obstacles) {
        const obS = ob.s + ob.v * t;
        const obD = ob.kind === "ped" ? ob.d + ob.vd * t : ob.d;
        const ds = wrapDiff(s, obS, L2);
        const dd = d - obD;
        const extra = ob.kind === "ped" ? 1.5 : 0;
        const lonReach = 2.35 + ob.length / 2 + cfg.lonMargin + extra;
        const latReach = 1 + ob.width / 2 + cfg.latMargin + extra;
        if (Math.abs(ds) < lonReach && Math.abs(dd) < latReach) {
          colliding = true;
        }
        const proxLat = ob.kind === "ped" ? 4 : 3;
        if (ds > -6 && ds < 40 && Math.abs(dd) < proxLat) {
          const gap = Math.max(Math.abs(ds) - lonReach, 0.5);
          proximityCost += (ob.kind === "ped" ? 2.5 : 1) / gap;
        }
      }
    }
    const laneChangeCost = cfg.kLaneChange * Math.abs(lane - currentLane) + cfg.kBias * Math.abs(lane - biasLane);
    const speedCost = cfg.kSpeed * (cfg.desiredSpeed - vTarget) ** 2;
    const offCenterCost = cfg.kOffCenter * dTarget * dTarget * 0;
    const comfort = cfg.kJerk * jerkSq + cfg.kTime * T;
    let cost = comfort + speedCost + laneChangeCost + offCenterCost + cfg.kProximity * proximityCost;
    if (!feasible) cost += INFEASIBLE_COST;
    if (colliding) cost += COLLISION_COST;
    return { points, targetSpeed: vTarget, targetLane: lane, cost, colliding, feasible };
  }
};

// src/perception/Sensor.ts
var DEFAULT_SENSOR = {
  range: 95,
  posNoise: 0.35,
  sizeNoise: 0.15,
  occlusion: true,
  dropout: 0.04,
  fov: Math.PI,
  // 360° surround perception suite (camera + radar)
  heading: 0
};
var Sensor = class {
  config;
  rng;
  constructor(config = {}, rng = new Rng(1)) {
    this.config = { ...DEFAULT_SENSOR, ...config };
    this.rng = rng;
  }
  /** Produce noisy detections of the objects the ego can currently perceive. */
  sense(egoX, egoY, objects, heading = this.config.heading) {
    const cfg = this.config;
    const cand = objects.map((o) => {
      const dx = o.x - egoX;
      const dy = o.y - egoY;
      return { o, dist: Math.hypot(dx, dy), bearing: Math.atan2(dy, dx) };
    }).filter((c) => c.dist <= cfg.range).filter((c) => {
      if (cfg.fov >= Math.PI - 0.01) return true;
      let off = c.bearing - heading;
      while (off > Math.PI) off -= Math.PI * 2;
      while (off < -Math.PI) off += Math.PI * 2;
      return Math.abs(off) <= cfg.fov;
    }).sort((a, b) => a.dist - b.dist);
    const detections = [];
    const blockers = [];
    for (const c of cand) {
      const o = c.o;
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
        if (o.kind === "car") blockers.push({ bearing: c.bearing, halfAngle: half });
        if (occluded) continue;
      }
      if (this.rng.next() < cfg.dropout) continue;
      const sizeScore = Math.min(1, Math.max(o.width, o.length) / 4.5);
      const rangeScore = 1 - c.dist / Math.max(cfg.range, 1);
      const confidence = Math.min(1, 0.35 + 0.45 * sizeScore + 0.2 * rangeScore + this.rng.normal() * 0.03);
      detections.push({
        x: o.x + this.rng.normal() * cfg.posNoise,
        y: o.y + this.rng.normal() * cfg.posNoise,
        length: Math.max(0.5, o.length + this.rng.normal() * cfg.sizeNoise),
        width: Math.max(0.5, o.width + this.rng.normal() * cfg.sizeNoise),
        kind: o.kind,
        confidence: Math.min(1, Math.max(0.05, confidence))
      });
    }
    return detections;
  }
};

// src/core/mat.ts
function zeros(r, c) {
  return Array.from({ length: r }, () => new Array(c).fill(0));
}
function identity(n) {
  const m = zeros(n, n);
  for (let i = 0; i < n; i++) m[i][i] = 1;
  return m;
}
function mul(a, b) {
  const r = a.length;
  const k = b.length;
  const c = b[0].length;
  const out = zeros(r, c);
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      let s = 0;
      for (let x = 0; x < k; x++) s += a[i][x] * b[x][j];
      out[i][j] = s;
    }
  }
  return out;
}
function mulVec(a, v) {
  const out = new Array(a.length).fill(0);
  for (let i = 0; i < a.length; i++) {
    let s = 0;
    for (let j = 0; j < v.length; j++) s += a[i][j] * v[j];
    out[i] = s;
  }
  return out;
}
function transpose(a) {
  const r = a.length;
  const c = a[0].length;
  const out = zeros(c, r);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[j][i] = a[i][j];
  return out;
}
function add(a, b) {
  return a.map((row, i) => row.map((v, j) => v + b[i][j]));
}
function sub(a, b) {
  return a.map((row, i) => row.map((v, j) => v - b[i][j]));
}
function inv2(m) {
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  const inv = Math.abs(det) < 1e-12 ? 0 : 1 / det;
  return [
    [m[1][1] * inv, -m[0][1] * inv],
    [-m[1][0] * inv, m[0][0] * inv]
  ];
}

// src/perception/Tracker.ts
var H = [
  [1, 0, 0, 0],
  [0, 1, 0, 0]
];
var HT = transpose(H);
var Track = class {
  id;
  x;
  // [px, py, vx, vy]
  P;
  hits = 1;
  misses = 0;
  age = 0;
  confirmed = false;
  length;
  width;
  kind;
  sigmaA = 3;
  // process (acceleration) noise
  measVar;
  constructor(id, det, measNoise) {
    this.id = id;
    this.x = [det.x, det.y, 0, 0];
    this.P = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 25, 0],
      [0, 0, 0, 25]
    ];
    this.length = det.length;
    this.width = det.width;
    this.kind = det.kind;
    this.measVar = measNoise * measNoise;
  }
  predict(dt2) {
    const F = [
      [1, 0, dt2, 0],
      [0, 1, 0, dt2],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];
    this.x = mulVec(F, this.x);
    const q = this.sigmaA * this.sigmaA;
    const dt22 = dt2 * dt2;
    const dt3 = dt22 * dt2;
    const dt4 = dt3 * dt2;
    const Q = [
      [dt4 / 4 * q, 0, dt3 / 2 * q, 0],
      [0, dt4 / 4 * q, 0, dt3 / 2 * q],
      [dt3 / 2 * q, 0, dt22 * q, 0],
      [0, dt3 / 2 * q, 0, dt22 * q]
    ];
    this.P = add(mul(mul(F, this.P), transpose(F)), Q);
    this.age++;
  }
  update(det) {
    const z = [det.x, det.y];
    const Hx = mulVec(H, this.x);
    const y = [z[0] - Hx[0], z[1] - Hx[1]];
    const S = mul(mul(H, this.P), HT);
    S[0][0] += this.measVar;
    S[1][1] += this.measVar;
    const K = mul(mul(this.P, HT), inv2(S));
    const Ky = mulVec(K, y);
    this.x = this.x.map((v, i) => v + Ky[i]);
    const KH = mul(K, H);
    this.P = mul(sub(identity(4), KH), this.P);
    this.length += (det.length - this.length) * 0.3;
    this.width += (det.width - this.width) * 0.3;
    this.kind = det.kind;
    this.hits++;
    this.misses = 0;
  }
  get px() {
    return this.x[0];
  }
  get py() {
    return this.x[1];
  }
  get vx() {
    return this.x[2];
  }
  get vy() {
    return this.x[3];
  }
  get speed() {
    return Math.hypot(this.x[2], this.x[3]);
  }
};
var DEFAULT_TRACKER = {
  gate: 5,
  confirmHits: 3,
  maxMisses: 10,
  measNoise: 0.35
};
var Tracker = class {
  tracks = [];
  config;
  nextId = 1;
  constructor(config = {}) {
    this.config = { ...DEFAULT_TRACKER, ...config };
  }
  update(detections, dt2) {
    const cfg = this.config;
    for (const t of this.tracks) t.predict(dt2);
    const pairs = [];
    for (let ti = 0; ti < this.tracks.length; ti++) {
      for (let di = 0; di < detections.length; di++) {
        const dx = this.tracks[ti].px - detections[di].x;
        const dy = this.tracks[ti].py - detections[di].y;
        const dist = Math.hypot(dx, dy);
        if (dist <= cfg.gate) pairs.push({ ti, di, dist });
      }
    }
    pairs.sort((a, b) => a.dist - b.dist);
    const trackUsed = new Array(this.tracks.length).fill(false);
    const detUsed = new Array(detections.length).fill(false);
    for (const p of pairs) {
      if (trackUsed[p.ti] || detUsed[p.di]) continue;
      trackUsed[p.ti] = true;
      detUsed[p.di] = true;
      const t = this.tracks[p.ti];
      t.update(detections[p.di]);
      if (!t.confirmed && t.hits >= cfg.confirmHits) t.confirmed = true;
    }
    for (let ti = 0; ti < this.tracks.length; ti++) {
      if (!trackUsed[ti]) this.tracks[ti].misses++;
    }
    this.tracks = this.tracks.filter((t) => t.misses <= cfg.maxMisses);
    for (let di = 0; di < detections.length; di++) {
      if (!detUsed[di]) {
        const nt = new Track(this.nextId++, detections[di], cfg.measNoise);
        nt.hits = Math.max(nt.hits, cfg.confirmHits);
        nt.confirmed = true;
        this.tracks.push(nt);
      }
    }
    return this.confirmed();
  }
  confirmed() {
    return this.tracks.filter((t) => t.confirmed);
  }
  reset() {
    this.tracks = [];
    this.nextId = 1;
  }
};

// src/perception/OccupancyGrid.ts
var OccupancyGrid = class {
  cols;
  rows;
  cell;
  halfExtent;
  occupied;
  originX = 0;
  originY = 0;
  constructor(extent = 50, cell = 2) {
    this.cell = cell;
    this.halfExtent = extent;
    this.cols = Math.ceil(extent * 2 / cell);
    this.rows = this.cols;
    this.occupied = new Uint8Array(this.cols * this.rows);
  }
  /** Rebuild the grid centred on the ego from the current tracks. */
  build(egoX, egoY, tracks) {
    this.occupied.fill(0);
    this.originX = egoX - this.halfExtent;
    this.originY = egoY - this.halfExtent;
    for (const t of tracks) {
      const half = Math.max(t.length, t.width) / 2 + 1;
      const minX = t.px - half;
      const maxX = t.px + half;
      const minY = t.py - half;
      const maxY = t.py + half;
      const ci0 = Math.floor((minX - this.originX) / this.cell);
      const ci1 = Math.floor((maxX - this.originX) / this.cell);
      const ri0 = Math.floor((minY - this.originY) / this.cell);
      const ri1 = Math.floor((maxY - this.originY) / this.cell);
      for (let r = ri0; r <= ri1; r++) {
        for (let c = ci0; c <= ci1; c++) {
          if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) continue;
          this.occupied[r * this.cols + c] = 1;
        }
      }
    }
  }
  /** World-space centre of a cell. */
  cellCenter(c, r) {
    return [this.originX + (c + 0.5) * this.cell, this.originY + (r + 0.5) * this.cell];
  }
  countOccupied() {
    let n = 0;
    for (let i = 0; i < this.occupied.length; i++) n += this.occupied[i];
    return n;
  }
  /** True when the world point falls in a blocked cell. */
  isOccupied(x, y) {
    const c = Math.floor((x - this.originX) / this.cell);
    const r = Math.floor((y - this.originY) / this.cell);
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return false;
    return this.occupied[r * this.cols + c] === 1;
  }
};

// src/pedestrian/PedestrianManager.ts
var PedestrianManager = class {
  constructor(road) {
    this.road = road;
  }
  peds = [];
  nextId = 1;
  clear() {
    this.peds = [];
    this.nextId = 1;
  }
  get count() {
    return this.peds.length;
  }
  add(opts) {
    const ped = {
      id: this.nextId++,
      s: opts.s,
      d: opts.fromD,
      fromD: opts.fromD,
      toD: opts.toD,
      speed: opts.speed ?? 1.4,
      state: "waiting",
      waitTimer: opts.wait ?? 0,
      triggerDist: opts.triggerDist ?? 0,
      radius: 0.4
    };
    this.peds.push(ped);
    return ped;
  }
  /**
   * Advance all pedestrians. `egoS` lets ego-triggered (jaywalker) crossings
   * fire. `vehicles` lets ordinary pedestrians wait for a safe gap in traffic
   * instead of stepping out in front of a moving car.
   */
  update(dt2, egoS, L2, vehicles = [], lights = []) {
    for (const p of this.peds) {
      if (p.state === "waiting") {
        const egoAhead = mod(p.s - egoS, L2);
        const triggered = p.triggerDist > 0 && egoAhead < p.triggerDist && egoAhead > 2;
        p.waitTimer -= dt2;
        if (triggered) {
          p.state = "crossing";
          continue;
        }
        if (p.triggerDist === 0 && p.waitTimer <= 0) {
          const carsHeld = lights.some((lt) => Math.abs(wrapDiff(lt.s, p.s, L2)) < 10 && lt.state === "red");
          if (carsHeld || p.waitTimer < -3 || this.gapClear(p, L2, vehicles)) p.state = "crossing";
        }
        continue;
      }
      if (p.state === "crossing") {
        const dir = Math.sign(p.toD - p.fromD) || 1;
        p.d += dir * p.speed * dt2;
        if (dir > 0 && p.d >= p.toD || dir < 0 && p.d <= p.toD) {
          p.d = p.toD;
          p.state = "done";
        }
      }
    }
  }
  /** True when no moving vehicle is close to the crossing station. */
  gapClear(p, L2, vehicles) {
    for (const v of vehicles) {
      if (v.v < 3) continue;
      if (Math.abs(wrapDiff(v.s, p.s, L2)) < 13) return false;
    }
    return true;
  }
  /** Lateral velocity (d/dt of d) — used by the planner to predict the crossing. */
  lateralVel(p) {
    if (p.state !== "crossing") return 0;
    return Math.sign(p.toD - p.fromD) * p.speed;
  }
};

// src/world/TrafficLight.ts
var TrafficLight = class {
  s;
  // station of the stop line
  greenT;
  yellowT;
  redT;
  timer;
  constructor(s, opts = {}) {
    this.s = s;
    this.greenT = opts.green ?? 9;
    this.yellowT = opts.yellow ?? 2;
    this.redT = opts.red ?? 7;
    this.timer = opts.offset ?? 0;
  }
  update(dt2) {
    this.timer = (this.timer + dt2) % (this.greenT + this.yellowT + this.redT);
  }
  get elapsedTime() {
    return this.timer;
  }
  restoreTime(seconds) {
    const cycle = this.greenT + this.yellowT + this.redT;
    this.timer = (seconds % cycle + cycle) % cycle;
  }
  get state() {
    if (this.timer < this.greenT) return "green";
    if (this.timer < this.greenT + this.yellowT) return "yellow";
    return "red";
  }
  /** Seconds remaining in the current phase (for a countdown display). */
  get remaining() {
    const cycle = this.greenT + this.yellowT + this.redT;
    if (this.timer < this.greenT) return this.greenT - this.timer;
    if (this.timer < this.greenT + this.yellowT) return this.greenT + this.yellowT - this.timer;
    return cycle - this.timer;
  }
};

// src/behavior/BehaviorPlanner.ts
var EGO_HALF_LEN = 2.35;
var BehaviorPlanner = class {
  constructor(road) {
    this.road = road;
  }
  decide(ego, obstacles, baseSpeed) {
    const L2 = this.road.path.length;
    const laneHalf = this.road.laneWidth * 0.6;
    const yieldSpeed = this.pedestrianYield(ego, obstacles, L2, laneHalf);
    if (yieldSpeed < baseSpeed) {
      return { state: "YIELD", targetSpeed: Math.max(0, yieldSpeed), biasLane: ego.lane };
    }
    let lead = null;
    let bestFwd = Infinity;
    for (const o of obstacles) {
      if (Math.abs(o.d - ego.d) > laneHalf) continue;
      const fwd = ((o.s - ego.s) % L2 + L2) % L2;
      if (fwd > 0 && fwd < bestFwd) {
        bestFwd = fwd;
        lead = { gap: fwd - (EGO_HALF_LEN + o.length / 2), v: o.v };
      }
    }
    const leftClear = ego.lane + 1 < this.road.numLanes && this.laneClear(ego, obstacles, ego.lane + 1, L2);
    const rightClear = ego.lane - 1 >= 0 && this.laneClear(ego, obstacles, ego.lane - 1, L2);
    if (!lead) {
      return { state: "CRUISE", targetSpeed: baseSpeed, biasLane: ego.lane };
    }
    const gap = Math.max(lead.gap, 0);
    const closing = ego.v - lead.v;
    const ttc = closing > 0.1 ? gap / closing : Infinity;
    const leadIsSlow = lead.v < baseSpeed - 2;
    const withinFollow = gap < Math.max(45, ego.v * 1.9);
    if (leadIsSlow && withinFollow) {
      if (leftClear) return { state: "OVERTAKE", targetSpeed: baseSpeed, biasLane: ego.lane + 1 };
      if (rightClear) return { state: "OVERTAKE", targetSpeed: baseSpeed, biasLane: ego.lane - 1 };
    }
    if (gap < 5 || ttc < 1.8) {
      return { state: "EMERGENCY", targetSpeed: 0, biasLane: ego.lane };
    }
    if (leadIsSlow && withinFollow) {
      return { state: "FOLLOW", targetSpeed: this.accSpeed(gap, lead.v, ego.v, baseSpeed), biasLane: ego.lane };
    }
    const target = withinFollow ? Math.min(baseSpeed, this.accSpeed(gap, lead.v, ego.v, baseSpeed)) : baseSpeed;
    return { state: "CRUISE", targetSpeed: target, biasLane: ego.lane };
  }
  /**
   * Speed the ego should slow to for pedestrians ahead — Infinity if none are a
   * concern. Predicts each pedestrian's crossing so the ego stops in time, and
   * is cautious about any pedestrian on the road surface ahead.
   */
  pedestrianYield(ego, obstacles, L2, laneHalf) {
    const roadHalf = this.road.totalWidth / 2;
    const brake = 3;
    let best = Infinity;
    for (const o of obstacles) {
      if (o.kind !== "ped") continue;
      const fwd = mod(o.s - ego.s, L2);
      if (fwd <= 0 || fwd > 80) continue;
      const tReach = ego.v > 0.5 ? fwd / ego.v : 3;
      const predD = o.d + o.vd * tReach;
      const inLaneNow = Math.abs(o.d - ego.d) < laneHalf + 1;
      const inLaneSoon = Math.abs(predD - ego.d) < laneHalf + 1;
      const onRoadAhead = Math.abs(o.d) < roadHalf + 1.5 && fwd < 40;
      if (inLaneNow || inLaneSoon || onRoadAhead) {
        const stopDist = Math.max(fwd - 12, 0);
        best = Math.min(best, Math.sqrt(2 * brake * stopDist));
      }
    }
    return best;
  }
  /** Is `lane` free of obstacles in a window around the ego (behind → ahead)? */
  laneClear(ego, obstacles, lane, L2) {
    const dT = this.road.laneCenter(lane);
    const laneHalf = this.road.laneWidth * 0.6;
    for (const o of obstacles) {
      if (Math.abs(o.d - dT) > laneHalf) continue;
      const ds = wrapDiff(o.s, ego.s, L2);
      if (ds > -14 && ds < 40) return false;
    }
    return true;
  }
  /** Adaptive-cruise target speed for a given gap to a lead. */
  accSpeed(gap, leadV, egoV, baseSpeed) {
    const desiredGap = 6 + 1.2 * egoV;
    const target = leadV + (gap - desiredGap) * 0.4;
    return clamp(target, 0, baseSpeed);
  }
};

// src/learn/NN.ts
function tanh(x) {
  if (x > 20) return 1;
  if (x < -20) return -1;
  const e = Math.exp(2 * x);
  return (e - 1) / (e + 1);
}
var MLP = class _MLP {
  sizes;
  W;
  // W[l][j][i]  (layer l, output j, input i)
  b;
  // b[l][j]
  // Adam moment estimates.
  mW;
  vW;
  mb;
  vb;
  t = 0;
  constructor(sizes, rng = Math.random) {
    this.sizes = sizes.slice();
    this.W = [];
    this.b = [];
    this.mW = [];
    this.vW = [];
    this.mb = [];
    this.vb = [];
    for (let l = 1; l < sizes.length; l++) {
      const nin = sizes[l - 1];
      const nout = sizes[l];
      const scale = Math.sqrt(2 / (nin + nout));
      const Wl = [];
      const mWl = [];
      const vWl = [];
      const bl = [];
      const mbl = [];
      const vbl = [];
      for (let j = 0; j < nout; j++) {
        const row = [];
        const mrow = [];
        const vrow = [];
        for (let i = 0; i < nin; i++) {
          row.push((rng() * 2 - 1) * scale);
          mrow.push(0);
          vrow.push(0);
        }
        Wl.push(row);
        mWl.push(mrow);
        vWl.push(vrow);
        bl.push(0);
        mbl.push(0);
        vbl.push(0);
      }
      this.W.push(Wl);
      this.mW.push(mWl);
      this.vW.push(vWl);
      this.b.push(bl);
      this.mb.push(mbl);
      this.vb.push(vbl);
    }
  }
  /** Forward pass returning per-layer activations (index 0 = input). */
  forward(x) {
    const acts = [x];
    let a = x;
    for (let l = 0; l < this.W.length; l++) {
      const Wl = this.W[l];
      const bl = this.b[l];
      const out = new Array(Wl.length);
      const last = l === this.W.length - 1;
      for (let j = 0; j < Wl.length; j++) {
        let z = bl[j];
        const row = Wl[j];
        for (let i = 0; i < row.length; i++) z += row[i] * a[i];
        out[j] = last ? z : tanh(z);
      }
      acts.push(out);
      a = out;
    }
    return acts;
  }
  predict(x) {
    const acts = this.forward(x);
    return acts[acts.length - 1];
  }
  /** One Adam step over a mini-batch. Returns the batch MSE loss. */
  trainBatch(xs, ys, lr = 0.01) {
    const L2 = this.W.length;
    const gW = this.W.map((Wl) => Wl.map((row) => row.map(() => 0)));
    const gb = this.b.map((bl) => bl.map(() => 0));
    let loss = 0;
    for (let n = 0; n < xs.length; n++) {
      const acts = this.forward(xs[n]);
      const y = ys[n];
      const aL = acts[L2];
      let delta = new Array(aL.length);
      for (let j = 0; j < aL.length; j++) {
        const e = aL[j] - y[j];
        delta[j] = e;
        loss += 0.5 * e * e;
      }
      for (let l = L2 - 1; l >= 0; l--) {
        const aPrev = acts[l];
        for (let j = 0; j < this.W[l].length; j++) {
          const d = delta[j];
          gb[l][j] += d;
          const gRow = gW[l][j];
          for (let i = 0; i < aPrev.length; i++) gRow[i] += d * aPrev[i];
        }
        if (l > 0) {
          const nPrev = acts[l].length;
          const nd = new Array(nPrev).fill(0);
          for (let j = 0; j < this.W[l].length; j++) {
            const row = this.W[l][j];
            const d = delta[j];
            for (let i = 0; i < nPrev; i++) nd[i] += row[i] * d;
          }
          const aPrevAct = acts[l];
          for (let i = 0; i < nPrev; i++) nd[i] *= 1 - aPrevAct[i] * aPrevAct[i];
          delta = nd;
        }
      }
    }
    const invN = 1 / xs.length;
    this.t++;
    const b1 = 0.9;
    const b2 = 0.999;
    const eps = 1e-8;
    const b1c = 1 - Math.pow(b1, this.t);
    const b2c = 1 - Math.pow(b2, this.t);
    for (let l = 0; l < L2; l++) {
      for (let j = 0; j < this.W[l].length; j++) {
        for (let i = 0; i < this.W[l][j].length; i++) {
          const g2 = gW[l][j][i] * invN;
          this.mW[l][j][i] = b1 * this.mW[l][j][i] + (1 - b1) * g2;
          this.vW[l][j][i] = b2 * this.vW[l][j][i] + (1 - b2) * g2 * g2;
          const mh2 = this.mW[l][j][i] / b1c;
          const vh2 = this.vW[l][j][i] / b2c;
          this.W[l][j][i] -= lr * mh2 / (Math.sqrt(vh2) + eps);
        }
        const g = gb[l][j] * invN;
        this.mb[l][j] = b1 * this.mb[l][j] + (1 - b1) * g;
        this.vb[l][j] = b2 * this.vb[l][j] + (1 - b2) * g * g;
        const mh = this.mb[l][j] / b1c;
        const vh = this.vb[l][j] / b2c;
        this.b[l][j] -= lr * mh / (Math.sqrt(vh) + eps);
      }
    }
    return loss * invN;
  }
  toJSON() {
    return { sizes: this.sizes, W: this.W, b: this.b };
  }
  static fromJSON(s) {
    const net = new _MLP(s.sizes);
    net.W = s.W.map((Wl) => Wl.map((r) => r.slice()));
    net.b = s.b.map((bl) => bl.slice());
    return net;
  }
  /** Flat weight vector (for neuroevolution). */
  flat() {
    const out = [];
    for (let l = 0; l < this.W.length; l++) {
      for (let j = 0; j < this.W[l].length; j++) {
        for (let i = 0; i < this.W[l][j].length; i++) out.push(this.W[l][j][i]);
        out.push(this.b[l][j]);
      }
    }
    return out;
  }
  setFlat(v) {
    let k = 0;
    for (let l = 0; l < this.W.length; l++) {
      for (let j = 0; j < this.W[l].length; j++) {
        for (let i = 0; i < this.W[l][j].length; i++) this.W[l][j][i] = v[k++];
        this.b[l][j] = v[k++];
      }
    }
  }
};

// src/learn/features.ts
var STEER_NORM = 0.6;
var ACCEL_NORM = 7;
var FEATURE_SIZE = 18;
function decodeAction(out) {
  return {
    steer: clamp(out[0], -1.2, 1.2) * STEER_NORM,
    accel: clamp(out[1], -1.2, 1.2) * ACCEL_NORM
  };
}
function laneLead(ctx, laneCenterD) {
  const laneHalf = ctx.laneWidth * 0.6;
  let bestFwd = Infinity;
  let leadV = ctx.v;
  for (const o of ctx.obstacles) {
    if (Math.abs(o.d - laneCenterD) > laneHalf) continue;
    const fwd = mod(o.s - ctx.egoS, ctx.L);
    if (fwd > 0 && fwd < bestFwd) {
      bestFwd = fwd;
      leadV = o.v;
    }
  }
  if (bestFwd === Infinity) return { gap: 80, dv: 0 };
  return { gap: clamp(bestFwd - 5, 0, 80), dv: ctx.v - leadV };
}
function laneCenter(ctx, i) {
  return (i - (ctx.numLanes - 1) / 2) * ctx.laneWidth;
}
function extractFeatures(ctx) {
  const cur = laneLead(ctx, laneCenter(ctx, ctx.laneIndex));
  const leftExists = ctx.laneIndex + 1 < ctx.numLanes;
  const rightExists = ctx.laneIndex - 1 >= 0;
  const left = leftExists ? laneLead(ctx, laneCenter(ctx, ctx.laneIndex + 1)) : { gap: 0, dv: 0 };
  const right = rightExists ? laneLead(ctx, laneCenter(ctx, ctx.laneIndex - 1)) : { gap: 0, dv: 0 };
  let pedDist = 80;
  let pedInPath = 0;
  const laneHalf = ctx.laneWidth * 0.7;
  for (const o of ctx.obstacles) {
    if (o.kind !== "ped") continue;
    const fwd = mod(o.s - ctx.egoS, ctx.L);
    if (fwd > 0 && fwd < pedDist) {
      pedDist = fwd;
      pedInPath = Math.abs(o.d - ctx.d) < laneHalf + 1.5 ? 1 : 0;
    }
  }
  return [
    clamp(ctx.v / 30, 0, 1.5),
    clamp(ctx.d / ctx.roadHalf, -1.5, 1.5),
    clamp(ctx.headingErr / (Math.PI / 4), -1.5, 1.5),
    clamp(ctx.curvature * 60, -1.5, 1.5),
    ctx.numLanes > 1 ? ctx.laneIndex / (ctx.numLanes - 1) : 0,
    cur.gap / 80,
    clamp(cur.dv / 20, -1.5, 1.5),
    left.gap / 80,
    clamp(left.dv / 20, -1.5, 1.5),
    right.gap / 80,
    clamp(right.dv / 20, -1.5, 1.5),
    leftExists ? 1 : 0,
    rightExists ? 1 : 0,
    pedDist / 80,
    pedInPath,
    clamp(ctx.desiredSpeed / 30, 0, 1.5),
    clamp(ctx.lightSignal ?? 0, -1, 1),
    clamp((ctx.speedLimitMps ?? 0) / 30, 0, 1.5)
  ];
}

// src/learn/ImitationAgent.ts
var ImitationAgent = class {
  net;
  trained = false;
  lastLoss = 0;
  losses = [];
  X = [];
  Y = [];
  maxSamples = 6e4;
  constructor() {
    this.net = new MLP([FEATURE_SIZE, 32, 32, 2]);
  }
  get sampleCount() {
    return this.X.length;
  }
  clearData() {
    this.X = [];
    this.Y = [];
  }
  /** Record one expert demonstration (raw steering in rad, accel in m/s²). */
  addSample(features, steer, accel) {
    this.X.push(features.slice());
    this.Y.push([steer / STEER_NORM, accel / ACCEL_NORM]);
    if (this.X.length > this.maxSamples) {
      this.X.shift();
      this.Y.shift();
    }
  }
  /** Train the network on the collected demonstrations. */
  train(epochs = 60, batchSize = 64, lr = 0.01) {
    const n = this.X.length;
    this.losses = [];
    if (n === 0) return { epochs: 0, finalLoss: 0, samples: 0, losses: [] };
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let e = 0; e < epochs; e++) {
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = idx[i];
        idx[i] = idx[j];
        idx[j] = t;
      }
      let epochLoss = 0;
      let batches = 0;
      for (let b = 0; b < n; b += batchSize) {
        const xs = [];
        const ys = [];
        for (let k = b; k < Math.min(b + batchSize, n); k++) {
          xs.push(this.X[idx[k]]);
          ys.push(this.Y[idx[k]]);
        }
        epochLoss += this.net.trainBatch(xs, ys, lr);
        batches++;
      }
      this.losses.push(epochLoss / Math.max(1, batches));
    }
    this.lastLoss = this.losses[this.losses.length - 1];
    this.trained = true;
    return { epochs, finalLoss: this.lastLoss, samples: n, losses: this.losses };
  }
  /** Load pre-trained weights (e.g. produced by the background Trainer). */
  loadState(s) {
    this.net = MLP.fromJSON(s);
    this.trained = true;
  }
  /** Predict a driving action from features. */
  act(features) {
    return decodeAction(this.net.predict(features));
  }
};

// src/sim/Metrics.ts
var Metrics = class {
  time = 0;
  distance = 0;
  collisions = 0;
  collidingPrev = false;
  offRoadTime = 0;
  minGap = Infinity;
  sumAbsAccel = 0;
  maxAbsAccel = 0;
  sumAbsJerk = 0;
  sumSpeed = 0;
  sumDesired = 0;
  samples = 0;
  prevAccel = 0;
  reset() {
    this.time = 0;
    this.distance = 0;
    this.collisions = 0;
    this.collidingPrev = false;
    this.offRoadTime = 0;
    this.minGap = Infinity;
    this.sumAbsAccel = 0;
    this.maxAbsAccel = 0;
    this.sumAbsJerk = 0;
    this.sumSpeed = 0;
    this.sumDesired = 0;
    this.samples = 0;
    this.prevAccel = 0;
  }
  snapshot() {
    return {
      time: this.time,
      distance: this.distance,
      collisions: this.collisions,
      collidingPrev: this.collidingPrev,
      offRoadTime: this.offRoadTime,
      minGap: this.minGap,
      sumAbsAccel: this.sumAbsAccel,
      maxAbsAccel: this.maxAbsAccel,
      sumAbsJerk: this.sumAbsJerk,
      sumSpeed: this.sumSpeed,
      sumDesired: this.sumDesired,
      samples: this.samples,
      prevAccel: this.prevAccel
    };
  }
  restore(snapshot) {
    this.time = snapshot.time;
    this.distance = snapshot.distance;
    this.collisions = snapshot.collisions;
    this.collidingPrev = snapshot.collidingPrev;
    this.offRoadTime = snapshot.offRoadTime;
    this.minGap = snapshot.minGap;
    this.sumAbsAccel = snapshot.sumAbsAccel;
    this.maxAbsAccel = snapshot.maxAbsAccel;
    this.sumAbsJerk = snapshot.sumAbsJerk;
    this.sumSpeed = snapshot.sumSpeed;
    this.sumDesired = snapshot.sumDesired;
    this.samples = snapshot.samples;
    this.prevAccel = snapshot.prevAccel;
  }
  update(s) {
    this.time += s.dt;
    this.distance += s.v * s.dt;
    this.samples++;
    this.sumSpeed += s.v;
    this.sumDesired += s.desiredSpeed;
    const a = Math.abs(s.accel);
    this.sumAbsAccel += a;
    this.maxAbsAccel = Math.max(this.maxAbsAccel, a);
    this.sumAbsJerk += Math.abs((s.accel - this.prevAccel) / Math.max(s.dt, 1e-3));
    this.prevAccel = s.accel;
    if (s.offRoad) this.offRoadTime += s.dt;
    if (Number.isFinite(s.gap)) this.minGap = Math.min(this.minGap, s.gap);
    if (s.collided && !this.collidingPrev) this.collisions++;
    this.collidingPrev = s.collided;
  }
  get meanSpeed() {
    return this.samples ? this.sumSpeed / this.samples : 0;
  }
  get meanAccel() {
    return this.samples ? this.sumAbsAccel / this.samples : 0;
  }
  get meanJerk() {
    return this.samples ? this.sumAbsJerk / this.samples : 0;
  }
  scores() {
    const offRoadFrac = this.time > 0 ? this.offRoadTime / this.time : 0;
    const gapPenalty = Number.isFinite(this.minGap) && this.minGap < 6 ? (6 - this.minGap) * 5 : 0;
    const safety = clamp(100 - this.collisions * 30 - offRoadFrac * 120 - gapPenalty, 0, 100);
    const comfort = clamp(100 - this.meanAccel * 14 - this.meanJerk * 5, 0, 100);
    const targetRef = this.samples ? this.sumDesired / this.samples : 26;
    const efficiency = clamp(this.meanSpeed / Math.max(targetRef, 1) * 100, 0, 100);
    const overall = 0.5 * safety + 0.25 * comfort + 0.25 * efficiency;
    return { safety, comfort, efficiency, overall };
  }
};

// src/sim/ADAS.ts
var DEFAULT_ADAS_CONFIG = {
  acc: true,
  laneCentering: true,
  lda: true,
  fcw: true,
  aeb: true,
  bsm: true,
  alc: true,
  tsr: true,
  isa: true,
  parking: true,
  trafficLightAssist: true,
  timeGap: 1.6,
  warningTtc: 3,
  brakingTtc: 1.7
};
var ADAS_GAP_NOTCHES = [1, 1.3, 1.6, 2, 2.5];
var ADASController = class {
  config = { ...DEFAULT_ADAS_CONFIG };
  status = emptyStatus();
  aebLatched = false;
  alcTargetLane = null;
  alcTimer = 0;
  alcComplete = false;
  alcArmTimer = 0;
  alcRequestedDir = 0;
  alcBlocked = false;
  alcAborted = false;
  alcStartD = 0;
  lastTsr = null;
  /** Step the headway setting up/down one notch (used by the dashboard). */
  adjustGap(direction) {
    const current = this.config.timeGap;
    let best = 2;
    let bestDelta = Infinity;
    ADAS_GAP_NOTCHES.forEach((notch, index) => {
      const delta = Math.abs(notch - current);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = index;
      }
    });
    this.config.timeGap = ADAS_GAP_NOTCHES[clamp(best + direction, 0, ADAS_GAP_NOTCHES.length - 1)];
    return this.config.timeGap;
  }
  /** Current headway notch index (0 = closest). */
  get gapNotch() {
    let best = 2;
    let bestDelta = Infinity;
    ADAS_GAP_NOTCHES.forEach((notch, index) => {
      const delta = Math.abs(notch - this.config.timeGap);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = index;
      }
    });
    return best;
  }
  update(frame) {
    const { ego, egoS, egoD, path, road, obstacles, desiredSpeed, input, dt: dt2 } = frame;
    const indicator = frame.indicator ?? 0;
    const laneWidth = road.laneWidth;
    const brakingHorizon = Math.max(
      80,
      ego.v * ego.v / (2 * Math.max(ego.maxDecel * 0.8, 1)) + ego.v * 0.25 + 10
    );
    let lead = null;
    let fcw = false;
    let fcwLevel = 0;
    let aebRequested = false;
    let blindSpotLeft = false;
    let blindSpotRight = false;
    let parkingFront = null;
    for (const obstacle of obstacles) {
      const ds = wrapDiff(obstacle.s, egoS, path.length);
      const dd = obstacle.d - egoD;
      const gap = ds - (ego.dims.length + obstacle.length) / 2;
      const closingSpeed = ego.v - obstacle.v;
      const ttc = closingSpeed > 0.1 ? gap / closingSpeed : Infinity;
      const lateralReach = (ego.dims.width + obstacle.width) / 2 + 0.25;
      if (ds > 0 && ds <= brakingHorizon && Math.abs(dd) <= lateralReach && (!lead || ds < lead.ahead)) {
        lead = { obstacle, gap, ahead: ds };
        const gapWarn = Math.max(8, ego.v * 0.8);
        if (this.config.fcw && (ttc <= this.config.warningTtc || gap <= gapWarn)) {
          fcw = true;
          fcwLevel = 1;
        }
        const closing = Math.max(closingSpeed, 0);
        const stoppingGap = closing * closing / (2 * Math.max(ego.maxDecel * 0.8, 1)) + ego.v * 0.25 + 4;
        const urgent = gap <= stoppingGap * 1.1 || ttc <= this.config.brakingTtc * 1.15 || gap <= 6;
        if (urgent && fcw) fcwLevel = 2;
        if (this.config.aeb && (gap <= stoppingGap * 1.05 || gap <= 5.5 || ttc <= this.config.brakingTtc * 1.1)) {
          aebRequested = true;
        }
      }
      if (this.config.bsm && ds >= -8 && ds <= 3) {
        const lateral = Math.abs(dd);
        const nearSide = (ego.dims.width + obstacle.width) / 2 + 0.15;
        const outerEdge = nearSide + laneWidth * 0.75;
        if (lateral >= nearSide && lateral <= outerEdge) {
          if (dd > 0) blindSpotLeft = true;
          else blindSpotRight = true;
        }
      }
      if (this.config.parking && ego.v < 3 && ds > 0 && ds <= 8 && Math.abs(dd) < (ego.dims.width + obstacle.width) / 2 + 0.4) {
        const front = Math.max(0, ds - (ego.dims.length + obstacle.length) / 2);
        if (parkingFront === null || front < parkingFront) parkingFront = front;
      }
    }
    if (aebRequested) this.aebLatched = true;
    if (!this.config.aeb || !lead || input.throttle <= 0) this.aebLatched = false;
    const aeb = this.config.aeb && (aebRequested || this.aebLatched && input.throttle > 0 && lead !== null);
    const tsrLimitKph = this.config.tsr ? frame.speedLimitKph ?? null : null;
    const tsrNew = tsrLimitKph !== null && tsrLimitKph !== this.lastTsr;
    this.lastTsr = tsrLimitKph;
    const signCapMps = tsrLimitKph !== null ? tsrLimitKph / 3.6 : Infinity;
    const speedCap = this.config.isa ? Math.min(desiredSpeed, signCapMps) : desiredSpeed;
    const speedLimited = this.config.isa && tsrLimitKph !== null && speedCap < desiredSpeed - 0.1;
    const light = this.config.tsr || this.config.trafficLightAssist ? frame.trafficLight ?? null : null;
    const trafficLight = light ? light.state : "none";
    const trafficLightDistance = light ? light.distance : null;
    const redLightWarning = light !== null && light.state !== "green" && light.distance < 70 && ego.v > 8;
    let targetSpeed = speedCap;
    let accHolding = false;
    if (this.config.acc && lead) {
      const desiredGap = 4 + ego.v * this.config.timeGap;
      const gapCorrection = clamp((lead.gap - desiredGap) * 0.45, -12, 6);
      targetSpeed = clamp(lead.obstacle.v + gapCorrection, 0, speedCap);
      if (lead.gap < 4 && ego.v < 0.4 && lead.obstacle.v < 0.4) {
        targetSpeed = 0;
        accHolding = true;
      }
    }
    if (this.config.trafficLightAssist && light && light.state !== "green") {
      const stopDistance = Math.max(light.distance - 5, 0);
      const cap = Math.sqrt(2 * 2.3 * stopDistance) + 0.4;
      targetSpeed = Math.min(targetSpeed, cap);
      if (light.state === "red" && light.distance < 4) targetSpeed = 0;
    }
    const currentLane = road.laneOf(egoD);
    const laneOffset = egoD - road.laneCenter(currentLane);
    this.alcComplete = false;
    this.alcAborted = false;
    this.stepLaneChange(indicator, ego, egoS, egoD, currentLane, path, road, obstacles, dt2);
    const alcActive = this.alcTargetLane !== null;
    const alcBlocked = !alcActive && indicator !== 0 && this.config.alc && this.alcBlocked;
    const centerLane = alcActive ? this.alcTargetLane : currentLane;
    const manualSteer = clamp(input.steer, -1, 1) * ego.maxSteer;
    let steer = manualSteer;
    let laneKeepAssist = false;
    const assistSteering = this.config.laneCentering || alcActive;
    if (assistSteering) {
      const frontX = ego.x + ego.dims.wheelbase / 2 * Math.cos(ego.yaw);
      const frontY = ego.y + ego.dims.wheelbase / 2 * Math.sin(ego.yaw);
      const front = path.toFrenet(frontX, frontY);
      const pathHeading = path.cartesianAt(front.s).heading;
      const centerD = road.laneCenter(centerLane);
      const correction = stanleyControl(
        wrapAngle(pathHeading - ego.yaw),
        front.d - centerD,
        ego.v,
        { k: 3, kSoft: 1.2, maxSteer: ego.maxSteer }
      );
      laneKeepAssist = Math.abs(correction) > 8e-3 && Math.abs(front.d - centerD) > 0.18;
      steer = alcActive ? correction : clamp(manualSteer + correction * 0.7, -ego.maxSteer, ego.maxSteer);
    }
    let laneDeparture = "none";
    if (this.config.lda && !alcActive && Math.abs(laneOffset) > laneWidth * 0.42) {
      laneDeparture = laneOffset > 0 ? "left" : "right";
    }
    let accel;
    if (this.config.acc) {
      accel = input.throttle > 0 ? input.throttle * ego.maxAccel : frame.speedControl(targetSpeed - ego.v, dt2);
      if (input.brake > 0) accel = -input.brake * ego.maxDecel;
    } else {
      accel = input.throttle * ego.maxAccel - input.brake * ego.maxDecel;
      if (input.throttle === 0 && input.brake === 0) accel -= Math.min(0.25, ego.v * 0.025);
    }
    if (aeb) accel = Math.min(accel, -ego.maxDecel);
    const headway = lead ? lead.gap / Math.max(ego.v, 0.1) : null;
    this.status = {
      active: true,
      engaged: true,
      accActive: this.config.acc,
      accHolding,
      laneCenteringActive: this.config.laneCentering,
      laneKeepAssist,
      laneDeparture,
      fcw,
      fcwLevel,
      aeb,
      blindSpotLeft,
      blindSpotRight,
      leadGap: lead ? lead.gap : null,
      leadTtc: lead && ego.v > lead.obstacle.v + 0.1 ? lead.gap / (ego.v - lead.obstacle.v) : null,
      headway,
      targetSpeed,
      setSpeed: desiredSpeed,
      tsrLimitKph,
      tsrNew,
      trafficLight,
      trafficLightDistance,
      redLightWarning,
      alc: alcActive ? "active" : alcBlocked ? "blocked" : indicator !== 0 && this.config.alc ? "armed" : "off",
      alcTargetLane: this.alcTargetLane,
      alcComplete: this.alcComplete,
      alcAborted: this.alcAborted,
      parkingFront,
      indicatorLeft: indicator < 0,
      indicatorRight: indicator > 0,
      speedLimited,
      driverOverride: input.throttle > 0 || input.brake > 0
    };
    return { steer, accel, targetSpeed, status: this.status };
  }
  /**
   * Turn-signal-driven lane change: arm on the signal, verify the target lane is
   * clear, steer across, then auto-cancel the signal. If the target lane is
   * occupied (blind-spot monitoring), the manoeuvre stays blocked and warns.
   */
  stepLaneChange(indicator, ego, egoS, egoD, currentLane, path, road, obstacles, dt2) {
    this.alcBlocked = false;
    if (!this.config.alc || ego.v < 4) {
      this.alcTargetLane = null;
      this.alcRequestedDir = 0;
      return;
    }
    if (this.alcTargetLane !== null) {
      if (indicator === 0) {
        this.alcTargetLane = null;
        this.alcRequestedDir = 0;
        return;
      }
      this.alcTimer += dt2;
      const targetD = road.laneCenter(this.alcTargetLane);
      const progress = Math.abs(egoD - this.alcStartD) / Math.max(road.laneWidth, 1);
      if (progress < 0.45) {
        for (const o of obstacles) {
          const ds = wrapDiff(o.s, egoS, path.length);
          if (ds < 2 || ds > 16) continue;
          if (Math.abs(o.d - targetD) > road.laneWidth * 0.5 + (o.width + ego.dims.width) / 2 - 0.6) {
            continue;
          }
          this.alcTargetLane = null;
          this.alcBlocked = true;
          this.alcAborted = true;
          this.alcRequestedDir = 0;
          return;
        }
      }
      if (Math.abs(egoD - targetD) < 0.3 || this.alcTimer > 9) {
        this.alcTargetLane = null;
        this.alcRequestedDir = 0;
        this.alcComplete = true;
      }
      return;
    }
    if (indicator === 0) {
      this.alcRequestedDir = 0;
      this.alcArmTimer = 0;
      return;
    }
    if (indicator !== this.alcRequestedDir) {
      this.alcRequestedDir = indicator;
      this.alcArmTimer = 0;
    }
    this.alcArmTimer += dt2;
    if (this.alcArmTimer < 0.45) return;
    const target = currentLane + (indicator < 0 ? 1 : -1);
    if (target < 0 || target >= road.numLanes) {
      this.alcBlocked = true;
      return;
    }
    if (!this.laneClear(ego, egoS, egoD, target, path, road, obstacles)) {
      this.alcBlocked = true;
      return;
    }
    this.alcTargetLane = target;
    this.alcTimer = 0;
    this.alcStartD = egoD;
  }
  /** True when the target lane has a comfortable front and rear gap. */
  laneClear(ego, egoS, egoD, targetLane, path, road, obstacles) {
    const targetD = road.laneCenter(targetLane);
    for (const o of obstacles) {
      const ds = wrapDiff(o.s, egoS, path.length);
      if (ds < -18 || ds > 30) continue;
      const lateral = Math.abs(o.d - targetD);
      if (lateral > road.laneWidth * 0.5 + (o.width + ego.dims.width) / 2 - 0.4) continue;
      const clearance = (ego.dims.length + o.length) / 2;
      const frontGap = ds - clearance;
      const rearGap = -ds - clearance;
      if (ds >= 0 && frontGap < 18) return false;
      if (ds < 0 && rearGap < 15) return false;
    }
    return true;
  }
  clearStatus() {
    this.aebLatched = false;
    this.alcTargetLane = null;
    this.alcBlocked = false;
    this.alcComplete = false;
    this.alcAborted = false;
    this.alcArmTimer = 0;
    this.alcRequestedDir = 0;
    this.lastTsr = null;
    this.status = emptyStatus();
  }
};
function emptyStatus() {
  return {
    active: false,
    engaged: false,
    accActive: false,
    accHolding: false,
    laneCenteringActive: false,
    laneKeepAssist: false,
    laneDeparture: "none",
    fcw: false,
    fcwLevel: 0,
    aeb: false,
    blindSpotLeft: false,
    blindSpotRight: false,
    leadGap: null,
    leadTtc: null,
    headway: null,
    targetSpeed: 0,
    setSpeed: 0,
    tsrLimitKph: null,
    tsrNew: false,
    trafficLight: "none",
    trafficLightDistance: null,
    redLightWarning: false,
    alc: "off",
    alcTargetLane: null,
    alcComplete: false,
    alcAborted: false,
    parkingFront: null,
    indicatorLeft: false,
    indicatorRight: false,
    speedLimited: false,
    driverOverride: false
  };
}

// src/sim/SessionRecorder.ts
var SessionRecorder = class {
  constructor(maxFrames = 18e3) {
    this.maxFrames = maxFrames;
  }
  frames = [];
  recording = false;
  playing = false;
  elapsed = 0;
  playhead = 0;
  startRecording() {
    this.frames.length = 0;
    this.elapsed = 0;
    this.playhead = 0;
    this.playing = false;
    this.recording = true;
  }
  stopRecording() {
    this.recording = false;
  }
  record(value, dt2) {
    if (!this.recording || this.playing) return;
    if (this.frames.length >= this.maxFrames) {
      this.recording = false;
      return;
    }
    this.elapsed += dt2;
    this.frames.push({ time: this.elapsed, value });
  }
  startPlayback() {
    if (this.frames.length === 0) return false;
    this.recording = false;
    this.playing = true;
    this.playhead = 0;
    return true;
  }
  stopPlayback() {
    this.playing = false;
  }
  advance(dt2) {
    if (!this.playing || this.frames.length === 0) return null;
    const duration = this.frames[this.frames.length - 1].time;
    this.playhead = Math.min(this.playhead + dt2, duration);
    const index = Math.min(this.frames.length - 1, Math.floor(this.playhead / Math.max(duration, 1e-9) * (this.frames.length - 1)));
    const finished = this.playhead >= duration;
    if (finished) this.playing = false;
    return { frame: this.frames[index], finished };
  }
  serialize() {
    return JSON.stringify({ version: 1, frames: this.frames });
  }
  load(json) {
    try {
      const parsed = JSON.parse(json);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.frames) || parsed.frames.length === 0) {
        return false;
      }
      this.frames.length = 0;
      for (const frame of parsed.frames) {
        if (typeof frame?.time !== "number" || frame.value === void 0) return false;
        this.frames.push({ time: frame.time, value: frame.value });
      }
      this.recording = false;
      this.playing = false;
      this.elapsed = this.frames[this.frames.length - 1].time;
      this.playhead = 0;
      return true;
    } catch {
      return false;
    }
  }
};

// src/sim/config.ts
var DEFAULT_SIM = {
  numLanes: 3,
  laneWidth: 3.7,
  trafficCount: 16,
  egoDesiredSpeed: 16,
  // ~58 km/h urban default; highway scenarios raise this
  planIntervalSec: 0.1,
  // 10 Hz planning, 60 Hz control
  fixedDt: 1 / 60,
  seed: 1
};

// src/sim/Simulation.ts
function emptyStats() {
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
    maxSpeed: 0
  };
}
var Simulation = class {
  config;
  path;
  road;
  ego;
  traffic;
  /** Deterministic source for every stochastic decision in the simulation. */
  rng;
  planner;
  sensor;
  tracker;
  occupancy;
  pedestrians;
  trafficLights = [];
  roadSigns = [];
  behavior;
  imitation;
  adas = new ADASController();
  metrics = new Metrics();
  recorder = new SessionRecorder();
  prevDelta = 0;
  behaviorState = "CRUISE";
  controlMode = "classical";
  driverInput = { steer: 0, throttle: 0, brake: 0 };
  /** Turn signal state: -1 left, +1 right, 0 off. */
  indicator = 0;
  /** Game/mission counters for the current run. */
  stats = emptyStats();
  prevBehavior = "CRUISE";
  prevAeb = false;
  prevHardBrake = false;
  prevLane = 0;
  prevStation = 0;
  yieldPedIds = /* @__PURE__ */ new Set();
  externalPolicy = null;
  evolvedChampion = null;
  // set by the UI after neuroevolution
  safetyShieldEnabled = true;
  // AEB + LKA for learned drivers (off during evolution)
  collecting = false;
  weather = "clear";
  weatherSpeedFactor = 1;
  baseDesiredSpeed;
  lastObstacles = [];
  junctionStations = [];
  trackLaneD = 0;
  // smoothly-eased lane-centre the controller tracks
  plan = null;
  candidates = [];
  tracks = [];
  telemetry;
  paused = false;
  showCandidates = true;
  /** When true the planner drives off Kalman tracks; when false, ground truth. */
  usePerception = true;
  scenario = "highway";
  speedPID;
  /** Separate longitudinal loop for the assistance layer: sharing one PID with
   *  the planner's controller makes two unrelated errors alternate inside a
   *  single timestep and produces a huge derivative spike. */
  adasSpeedPID;
  steerConfig;
  planTimer = 0;
  lastEgoIndex = -1;
  lastPlanMs = 0;
  distance = 0;
  constructor(config = {}) {
    this.config = { ...DEFAULT_SIM, ...config };
    this.rng = new Rng(this.config.seed);
    this.path = new ReferencePath(DEFAULT_TRACK.controlPoints, 6);
    this.road = new Road(this.path, this.config.numLanes, this.config.laneWidth);
    this.junctionStations = DEFAULT_TRACK.junctions.map(
      ([cx, cy]) => mod(this.path.toFrenet(cx, cy).s - 24, this.path.length)
    );
    this.roadSigns = this.junctionStations.map((s, i) => ({
      id: `speed-limit-${i + 1}`,
      s: mod(s - 45, this.path.length),
      kind: "speed-limit",
      valueKph: 50
    }));
    const start = this.path.toCartesian(0, this.road.laneCenter(Math.floor(this.config.numLanes / 2)));
    this.ego = new Vehicle(start.x, start.y, start.heading, 14, EGO_DIMS, {
      maxSpeed: 42
    });
    this.traffic = new TrafficManager(this.road, this.rng);
    this.traffic.spawn(this.config.trafficCount);
    this.trafficLights = this.makeJunctionLights();
    this.planner = new FrenetPlanner(this.road, {
      desiredSpeed: this.config.egoDesiredSpeed
    });
    this.sensor = new Sensor({}, this.rng);
    this.tracker = new Tracker();
    this.occupancy = new OccupancyGrid(50, 2);
    this.pedestrians = new PedestrianManager(this.road);
    this.behavior = new BehaviorPlanner(this.road);
    this.imitation = new ImitationAgent();
    this.baseDesiredSpeed = this.config.egoDesiredSpeed;
    this.speedPID = new PID(1.2, 0.15, 0.05, -this.ego.maxDecel, this.ego.maxAccel);
    this.adasSpeedPID = new PID(1, 0.08, 0, -this.ego.maxDecel, this.ego.maxAccel);
    this.steerConfig = {
      k: 3,
      // cross-track gain
      kSoft: 1.2,
      maxSteer: this.ego.maxSteer
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
      seed: this.config.seed
    };
    this.perceive(this.config.fixedDt);
    this.replan();
  }
  setDesiredSpeed(v) {
    this.baseDesiredSpeed = v;
    this.telemetry.desiredSpeed = v;
  }
  setTrafficCount(n) {
    this.traffic.setDensity(n);
  }
  setTrafficProfile(profile) {
    if (profile === this.traffic.profile) return;
    this.traffic.profile = profile;
    this.reset();
  }
  addScenarioEvent(event) {
    const ego = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
    const lane = this.road.laneOf(ego.d);
    const half = this.road.totalWidth / 2;
    if (event === "stopped-lead") {
      this.traffic.addTestVehicle("stalled", lane, ego.s + 42, 0, 0);
    } else if (event === "motorcycle-cutin") {
      const sideLane = lane + 1 < this.road.numLanes ? lane + 1 : lane - 1;
      const bike = this.traffic.addTestVehicle("motorcycle", sideLane, ego.s + 27, 14, 18);
      bike.cutInTimer = 1.4;
      bike.cutInLane = lane;
    } else if (event === "vehicle-crossing") {
      const kind = this.traffic.profile === "vietnam" ? "motorcycle" : "car";
      this.traffic.addCrossingVehicle(kind, ego.s + 34, kind === "motorcycle" ? 4.2 : 3.2);
    } else if (event === "motorcycle-weave") {
      const sideLane = lane + 1 < this.road.numLanes ? lane + 1 : lane - 1;
      this.traffic.addWeavingMotorcycle(sideLane, lane, ego.s + 27, 12);
      this.traffic.addWeavingMotorcycle(sideLane, lane, ego.s + 42, 13.5);
    } else if (event === "bus-stop") {
      this.traffic.addStoppedBus(lane, ego.s + 48, 8);
      this.pedestrians.add({
        s: mod(ego.s + 56, this.path.length),
        fromD: half + 2.5,
        toD: -half - 2.5,
        speed: 1.3,
        wait: 1
      });
    } else {
      this.pedestrians.add({
        s: mod(ego.s + 38, this.path.length),
        fromD: half + 2.5,
        toD: -half - 2.5,
        speed: 1.5,
        wait: 0,
        triggerDist: 45
      });
    }
  }
  reset() {
    this.rng.reset(this.config.seed);
    const mid = Math.floor(this.config.numLanes / 2);
    const start = this.path.toCartesian(0, this.road.laneCenter(mid));
    this.ego.x = start.x;
    this.ego.y = start.y;
    this.ego.yaw = start.heading;
    this.ego.v = 14;
    this.ego.a = 0;
    this.ego.delta = 0;
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
  setSeed(seed) {
    this.config.seed = seed >>> 0;
    this.reset();
  }
  /** Traffic lights guarding each city junction (mostly green, staggered). */
  makeJunctionLights() {
    return this.junctionStations.map(
      (s, i) => new TrafficLight(s, { green: 13, yellow: 2, red: 6, offset: i * 6 })
    );
  }
  /** Set up traffic AND pedestrians for the current scenario. */
  configureScenario(mid) {
    const half = this.road.totalWidth / 2;
    this.pedestrians.clear();
    this.trafficLights = this.makeJunctionLights();
    switch (this.scenario) {
      case "crossing": {
        this.traffic.spawn(8);
        this.pedestrians.add({ s: 115, fromD: half + 3, toD: -half - 3, speed: 1.4, wait: 1.5 });
        const L2 = this.path.length;
        const start = mod(115 - 70, L2);
        this.traffic.cars = this.traffic.cars.filter((c) => !(mod(c.s - start, L2) < 80 && c.lane === mid));
        break;
      }
      case "occluded":
        this.traffic.spawnScenario("stalled", mid);
        this.pedestrians.add({ s: 104, fromD: -(half + 3), toD: half + 3, speed: 1.7, wait: 0.6 });
        break;
      case "jaywalker":
        this.traffic.spawn(8);
        this.pedestrians.add({ s: 135, fromD: half + 3, toD: -half - 3, speed: 2.6, triggerDist: 76 });
        break;
      case "lights":
        this.traffic.spawn(8);
        this.trafficLights.push(new TrafficLight(150, { green: 7, yellow: 2, red: 12, offset: 8 }));
        break;
      case "rush": {
        this.traffic.spawn(26);
        this.pedestrians.add({ s: 95, fromD: half + 3, toD: -half - 3, speed: 1.4, wait: 2 });
        this.trafficLights.push(new TrafficLight(210, { green: 8, yellow: 2, red: 10, offset: 6 }));
        const L2 = this.path.length;
        const start = mod(95 - 65, L2);
        this.traffic.cars = this.traffic.cars.filter((c) => !(mod(c.s - start, L2) < 75 && c.lane === mid));
        break;
      }
      case "bus-stop": {
        this.traffic.spawnScenario("bus-stop", mid);
        const bus = this.traffic.cars.find((car) => car.kind === "bus" && car.stopTimer > 0);
        this.traffic.cars = this.traffic.cars.filter(
          (car) => car === bus || car.lane !== mid || car.s < 20 || car.s > 110
        );
        this.pedestrians.add({ s: 84, fromD: half + 2.5, toD: -half - 2.5, speed: 1.3, wait: 1.2 });
        break;
      }
      case "vietnam-rush": {
        this.traffic.spawnScenario("vietnam-rush", mid);
        this.pedestrians.add({ s: 98, fromD: half + 3, toD: -half - 3, speed: 1.5, wait: 1.5 });
        this.trafficLights.push(new TrafficLight(205, { green: 7, yellow: 2, red: 12, offset: 5 }));
        const L2 = this.path.length;
        const start = mod(98 - 62, L2);
        this.traffic.cars = this.traffic.cars.filter((c) => !(mod(c.s - start, L2) < 72 && c.lane === mid));
        break;
      }
      case "stalled": {
        this.traffic.spawnScenario("stalled", mid);
        const L2 = this.path.length;
        const start = mod(95 - 22, L2);
        this.traffic.cars = this.traffic.cars.filter(
          (c) => c.kind === "stalled" || !(mod(c.s - start, L2) < 70 && c.lane !== mid)
        );
        break;
      }
      case "trucks": {
        this.traffic.spawnScenario("trucks", mid);
        const L2 = this.path.length;
        const start = mod(60, L2);
        this.traffic.cars = this.traffic.cars.filter(
          (c) => c.kind === "truck" || !(mod(c.s - start, L2) < 220 && c.lane !== mid)
        );
        break;
      }
      default:
        this.traffic.spawnScenario(this.scenario, mid);
    }
  }
  setScenario(name) {
    this.scenario = name;
    this.reset();
  }
  setSensorRange(r) {
    this.sensor.config.range = r;
  }
  /** Current ego state expressed in the road's Frenet frame. */
  egoFrenet() {
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
      index: f.index
    };
  }
  /** Obstacles the planner reasons about — perceived tracks or ground truth. */
  obstacles() {
    if (!this.usePerception) {
      const obs2 = this.traffic.cars.map((c) => ({
        s: c.s,
        d: c.d,
        v: c.v,
        vd: c.crossing ? c.crossingSpeed : 0,
        length: c.length,
        width: c.width,
        kind: "car"
      }));
      for (const p of this.pedestrians.peds) {
        if (p.state === "done") continue;
        obs2.push({
          s: p.s,
          d: p.d,
          v: 0,
          vd: this.pedestrians.lateralVel(p),
          length: p.radius * 2,
          width: p.radius * 2,
          kind: "ped"
        });
      }
      return obs2;
    }
    const confirmed = this.tracks.filter((t) => t.confirmed);
    const sources = confirmed.length > 0 ? confirmed : this.tracks;
    if (sources.length > 0) {
      return sources.map((t) => {
        const f = this.path.toFrenet(t.px, t.py);
        const h = this.path.cartesianAt(f.s).heading;
        const tx = Math.cos(h);
        const ty = Math.sin(h);
        const vAlong = t.vx * tx + t.vy * ty;
        const vLat = -t.vx * ty + t.vy * tx;
        return { s: f.s, d: f.d, v: vAlong, vd: vLat, length: t.length, width: t.width, kind: t.kind };
      });
    }
    const obs = this.traffic.cars.map((c) => ({
      s: c.s,
      d: c.d,
      v: c.v,
      vd: c.crossing ? c.crossingSpeed : 0,
      length: c.length,
      width: c.width,
      kind: "car"
    }));
    for (const p of this.pedestrians.peds) {
      if (p.state === "done") continue;
      obs.push({
        s: p.s,
        d: p.d,
        v: 0,
        vd: this.pedestrians.lateralVel(p),
        length: p.radius * 2,
        width: p.radius * 2,
        kind: "ped"
      });
    }
    return obs;
  }
  /** Run the perception pipeline: sensor → tracker → occupancy grid. */
  perceive(dt2) {
    const objects = [];
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
    this.tracker.update(detections, dt2);
    this.tracks = this.tracker.tracks.length > 0 ? this.tracker.tracks : [];
    this.occupancy.build(this.ego.x, this.ego.y, this.tracks.filter((t) => t.confirmed));
  }
  replan() {
    const state = this.egoFrenet();
    const currentLane = this.road.laneOf(state.d);
    const obstacles = this.obstacles();
    const decision = this.behavior.decide(
      { s: state.s, d: state.d, v: this.ego.v, lane: currentLane },
      obstacles,
      this.baseDesiredSpeed
    );
    this.behaviorState = decision.state;
    const aLatMax = 2.2;
    const k = this.path.maxCurvatureAhead(state.s, 100);
    const curveCap = k > 1e-4 ? Math.sqrt(aLatMax / k) : Infinity;
    let target = Math.min(decision.targetSpeed * this.weatherSpeedFactor, curveCap);
    for (const sign of this.roadSigns) {
      const relative = wrapDiff(sign.s, state.s, this.path.length);
      if (relative <= 75 && relative >= -110) target = Math.min(target, sign.valueKph / 3.6);
    }
    for (const lt of this.trafficLights) {
      const fwd = mod(lt.s - state.s, this.path.length);
      if (fwd <= 0 || fwd > 90) continue;
      const stopForLight = lt.state === "red" || lt.state === "yellow" && fwd > 14;
      if (stopForLight) {
        const stopSpeed = Math.sqrt(2 * 2.3 * Math.max(fwd - 5, 0));
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
  buildFeatures() {
    const f = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
    const pathHeading = this.path.cartesianAt(f.s).heading;
    const ctx = {
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
      obstacles: this.lastObstacles.map((o) => ({ s: o.s, d: o.d, v: o.v, kind: o.kind, length: o.length }))
    };
    return extractFeatures(ctx);
  }
  /**
   * Automatic emergency braking. Returns a hard-braking acceleration if any
   * obstacle is imminently in the ego's path, else null. Used to shield the
   * learned drivers from collisions.
   */
  safetyShield(f) {
    const L2 = this.path.length;
    const laneHalf = this.road.laneWidth * 0.6;
    let brake = null;
    for (const o of this.lastObstacles) {
      const fwd = mod(o.s - f.s, L2);
      if (fwd <= 0 || fwd > 42) continue;
      const latTol = laneHalf + (o.kind === "ped" ? 1.6 : 0.4);
      if (Math.abs(o.d - f.d) > latTol) continue;
      const gap = fwd - (2.35 + o.length / 2);
      const closing = this.ego.v - o.v;
      const ttc = closing > 0.1 ? gap / closing : Infinity;
      if (gap < 4.5 || ttc < 1.7) brake = -this.ego.maxDecel;
    }
    return brake;
  }
  setControlMode(m) {
    if (m !== this.controlMode) {
      this.metrics.reset();
      this.speedPID.reset();
      this.adasSpeedPID.reset();
      this.driverInput = { steer: 0, throttle: 0, brake: 0 };
      this.indicator = 0;
    }
    this.controlMode = m;
    this.updateSensorRangeForMode();
    if (m !== "adas") this.adas.clearStatus();
  }
  /** Toggle (or cancel) the turn signal — the assisted lane change reads it. */
  toggleIndicator(direction) {
    if (this.controlMode !== "manual" && this.controlMode !== "adas") {
      this.indicator = 0;
      return;
    }
    this.indicator = this.indicator === direction ? 0 : direction;
  }
  clearIndicator() {
    this.indicator = 0;
  }
  /** Current seed — identical seeds reproduce the same world. */
  get seed() {
    return this.config.seed;
  }
  /** Posted limit the ADAS traffic-sign recognition can read right now. */
  nearestSpeedLimit(s) {
    let best = null;
    for (const sign of this.roadSigns) {
      const relative = wrapDiff(sign.s, s, this.path.length);
      if (relative < -14 || relative > 85) continue;
      if (best === null || sign.valueKph < best) best = sign.valueKph;
    }
    return best;
  }
  /** Nearest signalised stop line ahead (for ADAS traffic-light recognition). */
  nearestTrafficLight(s) {
    let best = null;
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
  resetStats() {
    Object.assign(this.stats, emptyStats());
    this.prevBehavior = "CRUISE";
    this.prevAeb = false;
    this.prevHardBrake = false;
    this.prevStation = 0;
    this.prevLane = Math.floor(this.config.numLanes / 2);
    this.yieldPedIds.clear();
  }
  /** Update the game/mission counters for one simulation step. */
  updateStats(dt2, ef, prevX, prevY) {
    const L2 = this.path.length;
    const moved = Math.hypot(this.ego.x - prevX, this.ego.y - prevY);
    const s = this.stats;
    s.maxSpeed = Math.max(s.maxSpeed, this.ego.v);
    if (this.controlMode === "adas") {
      s.distanceAdas += moved;
      s.timeAdas += dt2;
    }
    for (const lt of this.trafficLights) {
      const before = wrapDiff(lt.s, this.prevStation, L2);
      const after = wrapDiff(lt.s, ef.s, L2);
      if (before > 0 && after <= 0) {
        if (lt.state === "green") s.lightsGreen++;
        else if (lt.state === "red") s.redRuns++;
      }
    }
    this.prevStation = ef.s;
    if (this.behaviorState === "OVERTAKE" && this.prevBehavior !== "OVERTAKE") s.overtakes++;
    if (this.behaviorState === "YIELD") {
      if (this.ego.v < 0.8) {
        for (const p of this.pedestrians.peds) {
          if (p.state === "done" || this.yieldPedIds.has(p.id)) continue;
          const forward = mod(p.s - ef.s, L2);
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
  updateSensorRangeForMode() {
    const assistedRange = this.controlMode === "adas";
    this.sensor.config.occlusion = !assistedRange;
    if (this.weather === "rain") this.sensor.config.range = assistedRange ? 165 : 68;
    else if (this.weather === "fog") this.sensor.config.range = assistedRange ? 150 : 46;
    else this.sensor.config.range = assistedRange ? 180 : 95;
  }
  setDriverInput(input) {
    this.driverInput = {
      steer: clamp(input.steer, -1, 1),
      throttle: clamp(input.throttle, 0, 1),
      brake: clamp(input.brake, 0, 1)
    };
  }
  startRecording() {
    this.stopReplay();
    this.recorder.startRecording();
    this.paused = false;
  }
  stopRecording() {
    this.recorder.stopRecording();
  }
  startReplay() {
    this.stopRecording();
    if (!this.recorder.startPlayback()) return false;
    this.paused = false;
    this.restoreFrame(this.recorder.frames[0].value);
    return true;
  }
  stopReplay() {
    this.recorder.stopPlayback();
  }
  exportRecordedSession() {
    return this.recorder.serialize();
  }
  /** Adverse weather degrades the sensor AND makes the ego drive more cautiously. */
  setWeather(w) {
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
  setCollecting(on) {
    this.collecting = on;
  }
  trainImitation(epochs = 60) {
    return this.imitation.train(epochs);
  }
  /** Advance the simulation by one fixed step. */
  step(dt2) {
    if (this.paused) return;
    if (this.recorder.playing) {
      const playback = this.recorder.advance(dt2);
      if (playback) {
        this.restoreFrame(playback.frame.value);
        if (playback.finished) this.paused = true;
      }
      return;
    }
    this.perceive(dt2);
    if (this.controlMode === "adas") this.lastObstacles = this.obstacles();
    else this.lastObstacles = this.obstacles();
    this.planTimer += dt2;
    if (this.planTimer >= this.config.planIntervalSec || !this.plan) {
      this.planTimer = 0;
      this.replan();
    }
    let classicalSteer = 0;
    let targetSpeed = this.planner.config.desiredSpeed;
    if (this.plan && this.plan.points.length >= 2) {
      const wb = EGO_DIMS.wheelbase;
      const fx = this.ego.x + wb / 2 * Math.cos(this.ego.yaw);
      const fy = this.ego.y + wb / 2 * Math.sin(this.ego.yaw);
      const ff = this.path.toFrenet(fx, fy, -1);
      const goalLaneD = this.road.laneCenter(this.plan.targetLane);
      this.trackLaneD = smoothTowards(this.trackLaneD, goalLaneD, 1.6, dt2);
      const roadHeading = this.path.cartesianAt(ff.s).heading;
      const headingErr = wrapAngle(roadHeading - this.ego.yaw);
      const crossTrack = ff.d - this.trackLaneD;
      classicalSteer = stanleyControl(headingErr, crossTrack, this.ego.v, this.steerConfig);
      targetSpeed = Math.min(speedAtTime(this.plan, 0.8), this.planner.config.desiredSpeed);
    }
    const classicalAccel = this.speedPID.update(targetSpeed - this.ego.v, dt2);
    const feat = this.buildFeatures();
    if (this.collecting) this.imitation.addSample(feat, classicalSteer, classicalAccel);
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
      accel = this.driverInput.throttle * this.ego.maxAccel - this.driverInput.brake * this.ego.maxDecel;
      if (this.driverInput.throttle === 0 && this.driverInput.brake === 0) {
        accel -= Math.min(0.25, this.ego.v * 0.025);
      }
    } else if (this.controlMode === "adas") {
      const driverPose = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
      const assisted = this.adas.update({
        ego: this.ego,
        egoS: driverPose.s,
        egoD: driverPose.d,
        path: this.path,
        road: this.road,
        obstacles: this.lastObstacles,
        desiredSpeed: this.baseDesiredSpeed,
        input: this.driverInput,
        dt: dt2,
        speedControl: (error, stepDt) => this.adasSpeedPID.update(error, stepDt),
        speedLimitKph: this.nearestSpeedLimit(driverPose.s),
        indicator: this.indicator
      });
      steer = assisted.steer;
      accel = assisted.accel;
      targetSpeed = assisted.targetSpeed;
      if (assisted.status.alcComplete) this.indicator = 0;
    } else {
      this.adas.clearStatus();
    }
    const learnedDriver = this.controlMode === "learned" || this.controlMode === "external";
    if (learnedDriver && this.safetyShieldEnabled) {
      const f = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
      const roadHalf = this.road.totalWidth / 2;
      const over = Math.abs(f.d) - (roadHalf - 2.2);
      if (over > 0) {
        const blend = clamp(over / 1.6, 0, 1);
        steer = steer * (1 - blend) + classicalSteer * blend;
        if (Math.abs(f.d) > roadHalf - 0.8) accel = Math.min(accel, 0);
      }
      const shield = this.safetyShield(f);
      if (shield !== null) accel = Math.min(accel, shield);
    }
    const prevX = this.ego.x;
    const prevY = this.ego.y;
    this.ego.step(steer, accel, dt2);
    this.distance += Math.hypot(this.ego.x - prevX, this.ego.y - prevY);
    if (learnedDriver && this.safetyShieldEnabled) {
      const fg = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
      const lim = this.road.totalWidth / 2 - 0.3;
      if (Math.abs(fg.d) > lim) {
        const w = this.path.toCartesian(fg.s, Math.sign(fg.d) * lim);
        this.ego.x = w.x;
        this.ego.y = w.y;
        this.ego.v *= 0.9;
      }
    }
    const ef = this.path.toFrenet(this.ego.x, this.ego.y, this.lastEgoIndex);
    this.traffic.update(
      dt2,
      { s: ef.s, d: ef.d, v: this.ego.v, length: EGO_DIMS.length },
      this.controlMode === "adas" || this.controlMode === "manual",
      this.trafficLights,
      this.pedestrians.peds
    );
    this.pedestrians.update(dt2, ef.s, this.path.length, this.traffic.cars);
    for (const lt of this.trafficLights) lt.update(dt2);
    const Lm = this.path.length;
    let collided = false;
    let minGap = Infinity;
    const laneHalf = this.road.laneWidth * 0.6;
    for (const c of this.traffic.cars) {
      const ds = wrapDiff(c.s, ef.s, Lm);
      const dd = c.d - ef.d;
      if (Math.abs(ds) < (2.35 + c.length / 2) * 0.8 && Math.abs(dd) < (1 + c.width / 2) * 0.75) collided = true;
      if (Math.abs(dd) < laneHalf && ds > 0) minGap = Math.min(minGap, ds - (2.35 + c.length / 2));
    }
    for (const p of this.pedestrians.peds) {
      if (p.state === "done") continue;
      if (Math.abs(wrapDiff(p.s, ef.s, Lm)) < 2.35 + p.radius && Math.abs(p.d - ef.d) < 1 + p.radius) collided = true;
    }
    const steerRate = (this.ego.delta - this.prevDelta) / dt2;
    this.prevDelta = this.ego.delta;
    this.metrics.update({
      v: this.ego.v,
      accel: this.ego.a,
      steerRate,
      offRoad: Math.abs(ef.d) > this.road.totalWidth / 2,
      gap: minGap,
      collided,
      desiredSpeed: this.baseDesiredSpeed,
      dt: dt2
    });
    this.updateStats(dt2, ef, prevX, prevY);
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
    const laneCenter2 = this.road.laneCenter(this.telemetry.lane);
    this.telemetry.laneOffset = ef.d - laneCenter2;
    this.telemetry.speedLimitKph = this.nearestSpeedLimit(ef.s);
    this.telemetry.indicator = this.indicator;
    this.telemetry.headway = this.adas.status.headway;
    this.telemetry.trafficLight = this.nearestTrafficLight(ef.s);
    this.telemetry.seed = this.config.seed;
    this.recorder.record(this.captureFrame(), dt2);
  }
  captureFrame() {
    return {
      scenario: this.scenario,
      profile: this.traffic.profile,
      weather: this.weather,
      controlMode: this.controlMode,
      ego: { x: this.ego.x, y: this.ego.y, yaw: this.ego.yaw, v: this.ego.v, a: this.ego.a, delta: this.ego.delta },
      driverInput: { ...this.driverInput },
      traffic: this.traffic.cars.map((car) => ({ ...car })),
      pedestrians: this.pedestrians.peds.map((ped) => ({ ...ped })),
      lightTimes: this.trafficLights.map((light) => light.elapsedTime),
      telemetry: { ...this.telemetry, adas: { ...this.telemetry.adas } },
      metrics: this.metrics.snapshot(),
      stats: { ...this.stats }
    };
  }
  restoreFrame(frame) {
    const needsScenarioSetup = frame.scenario !== this.scenario || frame.profile !== this.traffic.profile;
    if (needsScenarioSetup) {
      this.scenario = frame.scenario;
      this.traffic.profile = frame.profile;
      const lane = this.road.laneOf(this.path.toFrenet(frame.ego.x, frame.ego.y).d);
      this.configureScenario(lane);
    }
    if (frame.weather !== this.weather) this.setWeather(frame.weather);
    if (frame.controlMode !== this.controlMode) this.setControlMode(frame.controlMode);
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
};
function speedAtTime(traj, t) {
  const pts = traj.points;
  if (pts.length === 0) return 0;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].t >= t) return clamp(pts[i].v, 0, 60);
  }
  return clamp(pts[pts.length - 1].v, 0, 60);
}

// scripts/lights-test.ts
var _seed = 55;
Math.random = () => {
  _seed = _seed * 1664525 + 1013904223 >>> 0;
  return _seed / 4294967296;
};
function fail(m) {
  console.error("LIGHTS-TEST FAIL:", m);
  process.exit(1);
}
var sim = new Simulation();
sim.setScenario("lights");
sim.setDesiredSpeed(24);
sim.trafficLights.push(new TrafficLight(120, { green: 14, yellow: 2, red: 10, offset: 16 }));
var dt = 1 / 60;
var L = sim.path.length;
var stoppedAtRed = false;
var ranRed = 0;
var prevFwd = sim.trafficLights.map(() => 999);
var minVnearLine = Infinity;
for (let i = 0; i < 4e3; i++) {
  sim.step(dt);
  const ef = sim.path.toFrenet(sim.ego.x, sim.ego.y);
  for (let li = 0; li < sim.trafficLights.length; li++) {
    const light = sim.trafficLights[li];
    const fwd = ((light.s - ef.s) % L + L) % L;
    if (light.state === "red") {
      if (fwd < 18) minVnearLine = Math.min(minVnearLine, sim.ego.v);
      if (fwd < 18 && sim.ego.v < 0.8) stoppedAtRed = true;
      if (prevFwd[li] < 6 && fwd > L - 6) ranRed++;
    }
    prevFwd[li] = fwd;
  }
}
var km = sim.telemetry.distanceTravelled / 1e3;
console.log(`distance ${km.toFixed(2)} km | stopped at red: ${stoppedAtRed} | ran red: ${ranRed} | min speed near red line: ${minVnearLine === Infinity ? "n/a" : minVnearLine.toFixed(1)}`);
if (ranRed > 0) fail(`ego ran the red light ${ranRed} times`);
if (!stoppedAtRed) fail("ego never stopped at a red light");
if (km < 0.4) fail("ego did not progress through greens");
console.log("\nLIGHTS-TEST PASS \u2014 ego obeys the traffic light (stops on red, goes on green).");
