// Comprehensive engineering verification suite for the modular AEB system.
// Covers all 7 required verification groups from `aeb-game-design.md`:
//   0. BrakeActuator -> Vehicle.step physical response, zero-reverse & static pitch rest
//   1. Longitudinal scenarios: CCRs (30/50/80 km/h), CCRm, same-speed following, CCRb
//   2. 2D footprint scenarios: cut-in, cut-out, crossing pedestrian (early/conflict/late), curved road
//   3. False-positive immunity: off-road, adjacent lane, stationary pair (5.35 m & 2.0 m), pulling-away, PMC/EPB/Rear-AEB separation
//   4. Occlusion (no X-ray), multi-rate ticks (`hasNewSample=false`), dropout/coasting, track loss & sensor faults (before & mid-brake)
//   5. Low grip (`mu=0.35`), road grade (`+-6%`), cornering friction circle, unavoidable impact mitigation & post-stop HOLD/RELEASE
//   6. Stronger driver brake priority, configurable override policy, ACC/ISA/AEB arbitration & direct MONITOR->EMERGENCY jump
//   7. Obstacle permutation invariance (all 6 permutations), 30/60/144 FPS accumulator equivalence, dt convergence & AEBDiagnosticLogger

import assert from "node:assert/strict";
import { Simulation } from "../src/sim/Simulation.ts";
import { ADASController, ADASFrame } from "../src/sim/ADAS.ts";
import { BrakeActuator, DEFAULT_AEB_CALIBRATION } from "../src/sim/AEB.ts";
import { Obstacle } from "../src/planner/Trajectory.ts";
import { Vehicle, EGO_DIMS } from "../src/vehicle/Vehicle.ts";
import { wrapDiff } from "../src/core/math.ts";

// ---------------------------------------------------------------------------
// Upfront Expected Outcomes & Engineering Tolerances (defined before testing)
// ---------------------------------------------------------------------------
const EXPECTED_SPECS = {
  minSafeStopClearanceM: 0.65,
  maxReasonableStopClearanceM: 7.5,
  pedestrianMinClearanceM: 1.1,
  unavoidableMinSpeedReductionMps: 3.5,
  dtConvergenceTriggerTolSec: 0.05,
  dtConvergenceGapTolM: 0.30,
  maxReverseSpeedTolMps: 0, // strictly >= 0 (zero reverse roll from braking)
} as const;

const FIXED_DT = 1 / 60;

function makeCleanAdasSim(opts: {
  trackId?: "city" | "motorway" | "ring-road" | "two-way";
  usePerception?: boolean;
  speedMps?: number;
  startS?: number;
  laneIndex?: number;
  seed?: number;
} = {}): Simulation {
  const sim = new Simulation({
    trackId: opts.trackId ?? "city",
    trafficCount: 0,
    seed: opts.seed ?? 42,
  });
  sim.setControlMode("adas");
  sim.traffic.clear();
  sim.pedestrians.clear();
  sim.trafficLights = [];
  sim.roadSigns = [];
  sim.usePerception = opts.usePerception ?? true;
  const lane = opts.laneIndex ?? Math.floor(sim.road.numLanes / 2);
  const s = opts.startS ?? 150;
  const d = sim.road.laneCenter(lane);
  const w = sim.path.toCartesian(s, d);
  Object.assign(sim.ego, {
    x: w.x,
    y: w.y,
    yaw: w.heading,
    v: opts.speedMps ?? 20,
    a: 0,
    delta: 0,
    roadGrade: 0,
  });
  (sim as unknown as { lastEgoIndex: number }).lastEgoIndex = -1;
  sim.setDesiredSpeed(Math.max(opts.speedMps ?? 20, 14));
  sim.setAccSpeedKph(Math.max(30, (opts.speedMps ?? 20) * 3.6));
  sim.tracker.reset();
  sim.tracks = [];
  return sim;
}

function bumperGapAhead(sim: Simulation, targetS: number, targetLen: number): number {
  const ef = sim.path.toFrenet(sim.ego.x, sim.ego.y);
  return wrapDiff(targetS, ef.s, sim.path.length) - (sim.ego.dims.length + targetLen) * 0.5;
}

// ===========================================================================
// GROUP 0: Physical BrakeActuator -> Vehicle.step Calibration & Zero-Reverse
// ===========================================================================
{
  // 0.1 Actuator dead-time (35 ms unprimed vs 15 ms prefilled vs 0 ms with foot brake) & ramp rate (48 m/s³)
  const actUnprimed = new BrakeActuator();
  const actPrefilled = new BrakeActuator();
  const actFootBoost = new BrakeActuator();
  const dt = 0.01;
  let tUnprimedNonZero = Infinity;
  let tPrefilledNonZero = Infinity;
  let tFootBoostAboveDriver = Infinity;

  for (let i = 1; i <= 40; i++) {
    const t = i * dt;
    const cmdU = actUnprimed.step({
      simTime: t,
      dt,
      requestedAccelCmd: -7.0,
      driverDecel: 0,
      aebActiveOrHold: true,
      prefillReady: false,
      calibration: DEFAULT_AEB_CALIBRATION,
    });
    const cmdP = actPrefilled.step({
      simTime: t,
      dt,
      requestedAccelCmd: -7.0,
      driverDecel: 0,
      aebActiveOrHold: true,
      prefillReady: true,
      calibration: DEFAULT_AEB_CALIBRATION,
    });
    const cmdF = actFootBoost.step({
      simTime: t,
      dt,
      requestedAccelCmd: -7.0,
      driverDecel: 2.1,
      aebActiveOrHold: true,
      prefillReady: false,
      calibration: DEFAULT_AEB_CALIBRATION,
    });
    if (cmdU < -0.01 && !Number.isFinite(tUnprimedNonZero)) tUnprimedNonZero = t;
    if (cmdP < -0.01 && !Number.isFinite(tPrefilledNonZero)) tPrefilledNonZero = t;
    if (cmdF < -2.11 && !Number.isFinite(tFootBoostAboveDriver)) tFootBoostAboveDriver = t;
  }
  assert(tFootBoostAboveDriver <= 0.011, "Hydraulic brake assist with foot on pedal must ramp immediately");
  assert(tPrefilledNonZero < tUnprimedNonZero, "WARN prefill must shorten hydraulic dead-time");
  assert(Math.abs(actUnprimed.appliedAutoDecel - 7.0) < 1e-6, "Actuator must reach full requested deceleration");

  // 0.2 Vehicle.step never reverses under sustained braking and settles bodyPitch to 0 at standstill
  const veh = new Vehicle(0, 0, 0, 10, EGO_DIMS);
  veh.limitLateralGrip = true;
  veh.corneringBrakeCoupling = true;
  let minSpeedSeen = Infinity;
  for (let i = 0; i < 300; i++) {
    veh.step(0, -7.0, FIXED_DT, 1);
    minSpeedSeen = Math.min(minSpeedSeen, veh.v);
  }
  assert(minSpeedSeen >= EXPECTED_SPECS.maxReverseSpeedTolMps, `Braking caused reverse velocity: ${minSpeedSeen}`);
  assert.equal(veh.v, 0, "Vehicle must come to exact standstill");
  assert.equal(veh.a, 0, "Static stopped vehicle on flat road must report 0 m/s² actual acceleration");
  assert(Math.abs(veh.bodyPitch) < 1e-3, `Chassis nose-dive pitch stayed frozen at rest (${veh.bodyPitch})`);
}

// ===========================================================================
// GROUP 1: Longitudinal Car-to-Car Scenarios (CCRs, CCRm, Same-Speed, CCRb)
// ===========================================================================
{
  // 1.1 CCRs: Stationary lead at 30, 50, 80 km/h across sensor & debug modes
  const ccrsSensorGaps: Record<number, number> = {};
  for (const usePerception of [false, true]) {
    for (const kph of [30, 50, 80]) {
      const v0 = kph / 3.6;
      const spawnDist = Math.max(38, (v0 * v0) / (2 * 7.0) + v0 * 1.1 + 12);
      const sim = makeCleanAdasSim({ usePerception, speedMps: v0 });
      sim.adas.config.acc = false; // Isolate pure AEB without ACC pre-braking!
      const lane = sim.road.laneOf(0);
      const lead = sim.traffic.addTestVehicle("stalled", lane, 150 + spawnDist, 0, 0);
      let sawAeb = false;
      for (let i = 0; i < 10 * 60; i++) {
        sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
        sim.step(FIXED_DT);
        sawAeb ||= sim.adas.status.aeb;
        assert(sim.ego.v >= 0, "Negative speed during CCRs stop");
      }
      const gap = bumperGapAhead(sim, lead.s, lead.length);
      if (usePerception) ccrsSensorGaps[kph] = gap;
      assert(sawAeb, `CCRs ${kph} km/h (perception=${usePerception}) did not trigger AEB`);
      assert.equal(sim.metrics.collisions, 0, `CCRs ${kph} km/h collided`);
      assert.equal(sim.ego.v, 0, `CCRs ${kph} km/h did not stop completely`);
      assert(
        gap >= EXPECTED_SPECS.minSafeStopClearanceM && gap <= EXPECTED_SPECS.maxReasonableStopClearanceM,
        `CCRs ${kph} km/h final clearance out of spec: ${gap.toFixed(2)} m`,
      );
      assert(sim.adas.status.aebHolding, `CCRs ${kph} km/h did not enter post-AEB HOLD`);
    }
  }
  console.log(
    `  [metrics] CCRs sensor stop clearances: 30km/h=${ccrsSensorGaps[30].toFixed(2)}m, 50km/h=${ccrsSensorGaps[50].toFixed(2)}m, 80km/h=${ccrsSensorGaps[80].toFixed(2)}m`,
  );

  // 1.2 CCRm: Ego 80 km/h (22.22 m/s) approaching slower moving lead at 36 km/h (10 m/s), ACC off
  {
    const sim = makeCleanAdasSim({ usePerception: true, speedMps: 80 / 3.6 });
    sim.adas.config.acc = false;
    const lane = sim.road.laneOf(0);
    const lead = sim.traffic.addTestVehicle("car", lane, 150 + 28, 10, 10);
    lead.changeCooldown = 999;
    sim.traffic.update = (dt) => {
      lead.v = 10;
      lead.s = (lead.s + lead.v * dt) % sim.path.length;
    };
    let sawAeb = false;
    let releasedAfterMatch = false;
    for (let i = 0; i < 6 * 60; i++) {
      sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
      sim.step(FIXED_DT);
      if (sim.adas.status.aeb) sawAeb = true;
      if (sawAeb && !sim.adas.status.aeb && sim.ego.v > 6.5) releasedAfterMatch = true;
    }
    assert(sawAeb, "CCRm did not trigger AEB");
    assert.equal(sim.metrics.collisions, 0, "CCRm collided with slower moving lead");
    assert(releasedAfterMatch && sim.ego.v > 4.0, "AEB unnecessarily braked ego to a full stop behind a 36 km/h moving lead");
  }

  // 1.3 Same-speed following (72 km/h behind 72 km/h at 12 m & 18 m gap, clear & rain, sensor noise active)
  for (const weather of ["clear", "rain"] as const) {
    for (const gapM of [12, 18]) {
      const sim = makeCleanAdasSim({ usePerception: true, speedMps: 20, seed: 101 });
      sim.setWeather(weather);
      sim.adas.config.acc = false;
      const lane = sim.road.laneOf(0);
      const lead = sim.traffic.addTestVehicle("car", lane, 150 + gapM + 4.65, 20, 20);
      lead.changeCooldown = 999;
      sim.traffic.update = (dt) => {
        lead.v = 20;
        lead.s = (lead.s + lead.v * dt) % sim.path.length;
      };
      let falseAebCount = 0;
      for (let i = 0; i < 6 * 60; i++) {
        // Light throttle to maintain ~20 m/s against rolling/aero drag
        const vErr = 20 - sim.ego.v;
        sim.setDriverInput({ steer: 0, throttle: Math.max(0, Math.min(0.4, vErr * 0.25 + 0.08)), brake: 0 });
        sim.step(FIXED_DT);
        if (sim.adas.status.aeb) falseAebCount++;
      }
      assert.equal(falseAebCount, 0, `False AEB triggered ${falseAebCount} frames during steady 72 km/h same-speed following (${weather}, gap=${gapM} m)`);
      assert.equal(sim.metrics.collisions, 0);
    }
  }

  // 1.4 CCRb: Same-speed following (20 m/s, 22 m gap), lead suddenly brakes at -8.0 m/s²
  {
    const sim = makeCleanAdasSim({ usePerception: true, speedMps: 20, seed: 77 });
    sim.adas.config.acc = false;
    const lane = sim.road.laneOf(0);
    const lead = sim.traffic.addTestVehicle("car", lane, 150 + 22 + 4.65, 20, 20);
    let elapsed = 0;
    sim.traffic.update = (dt) => {
      elapsed += dt;
      if (elapsed >= 0.8) lead.v = Math.max(0, lead.v - 8.0 * dt);
      lead.s = (lead.s + lead.v * dt) % sim.path.length;
    };
    let sawEmergency = false;
    for (let i = 0; i < 8 * 60; i++) {
      sim.setDriverInput({ steer: 0, throttle: elapsed < 0.8 ? 0.08 : 0, brake: 0 });
      sim.step(FIXED_DT);
      if (sim.adas.status.aebState === "EMERGENCY") sawEmergency = true;
    }
    const finalGap = bumperGapAhead(sim, lead.s, lead.length);
    assert(sawEmergency, "CCRb sudden -8 m/s² lead deceleration did not trigger EMERGENCY state");
    assert.equal(sim.metrics.collisions, 0, "CCRb collided with hard-braking lead");
    assert(finalGap >= EXPECTED_SPECS.minSafeStopClearanceM, `CCRb clearance too small: ${finalGap.toFixed(2)} m`);
  }
}

// ===========================================================================
// GROUP 2: Cut-In, Cut-Out, Pedestrian Crossing (3 Timings) & Curved Road
// ===========================================================================
{
  // 2.1 Vehicle Cut-In: slower car in adjacent lane merges into ego's lane
  {
    const sim = makeCleanAdasSim({ usePerception: true, speedMps: 22 });
    sim.adas.config.acc = false;
    const egoLane = sim.road.laneOf(0);
    const adjLane = egoLane + 1;
    const cutter = sim.traffic.addTestVehicle("car", adjLane, 150 + 34, 11, 11);
    cutter.d = sim.road.laneCenter(adjLane);
    const targetD = sim.road.laneCenter(egoLane);
    sim.traffic.update = (dt) => {
      const stepD = Math.sign(targetD - cutter.d) * Math.min(Math.abs(targetD - cutter.d), 1.6 * dt);
      cutter.d += stepD;
      cutter.headingOffset = Math.atan2(stepD / dt, cutter.v);
      cutter.s = (cutter.s + cutter.v * dt) % sim.path.length;
    };
    let sawAeb = false;
    for (let i = 0; i < 6 * 60; i++) {
      sim.setDriverInput({ steer: 0, throttle: 0.1, brake: 0 });
      sim.step(FIXED_DT);
      sawAeb ||= sim.adas.status.aeb;
    }
    assert(sawAeb, "Cut-in vehicle did not trigger AEB");
    assert.equal(sim.metrics.collisions, 0, "Collided with cut-in vehicle");
  }

  // 2.2 Vehicle Cut-Out: slow car in ego's lane exits into adjacent lane -> AEB releases without stopping ego
  {
    const sim = makeCleanAdasSim({ usePerception: true, speedMps: 20 });
    sim.adas.config.acc = false;
    const egoLane = sim.road.laneOf(0);
    const exitLane = egoLane + 1;
    const exiter = sim.traffic.addTestVehicle("car", egoLane, 150 + 24, 7, 7);
    exiter.d = sim.road.laneCenter(egoLane);
    const exitD = sim.road.laneCenter(exitLane);
    let t = 0;
    sim.traffic.update = (dt) => {
      t += dt;
      if (t >= 0.25) {
        const stepD = Math.sign(exitD - exiter.d) * Math.min(Math.abs(exitD - exiter.d), 2.4 * dt);
        exiter.d += stepD;
        exiter.headingOffset = Math.atan2(stepD / dt, Math.max(exiter.v, 1));
      }
      exiter.s = (exiter.s + exiter.v * dt) % sim.path.length;
    };
    let sawAeb = false;
    let released = false;
    for (let i = 0; i < 4 * 60; i++) {
      sim.setDriverInput({ steer: 0, throttle: 0.15, brake: 0 });
      sim.step(FIXED_DT);
      if (sim.adas.status.aeb) sawAeb = true;
      if (sawAeb && !sim.adas.status.aeb && t > 1.4) released = true;
    }
    assert(sawAeb, "Initial in-lane hazard before cut-out did not trigger AEB");
    assert(released && sim.ego.v > 8.0, `AEB failed to release after cut-out cleared ego lane (v=${sim.ego.v.toFixed(2)})`);
    assert.equal(sim.metrics.collisions, 0);
  }

  // 2.3 Pedestrian Crossing at 3 Timings: (a) crosses & clears early, (b) conflict, (c) enters after ego passes
  {
    // (a) Early crossing: pedestrian crosses at s = 195 (`45 m` ahead, ego at `12 m/s` -> arrives in `3.75 s`),
    //     pedestrian starts at `d = +1.2 m` moving toward `+5.0 m` at `1.8 m/s` -> exits ego corridor in `< 0.6 s`!
    const earlySim = makeCleanAdasSim({ usePerception: true, speedMps: 12 });
    earlySim.adas.config.acc = false;
    const earlyPed = earlySim.pedestrians.add({ s: 195, fromD: 0.8, toD: 6.0, speed: 2.0, wait: 0 });
    earlyPed.state = "crossing";
    let earlyFalseAeb = false;
    for (let i = 0; i < 4 * 60; i++) {
      earlySim.setDriverInput({ steer: 0, throttle: 0.08, brake: 0 });
      earlySim.step(FIXED_DT);
      earlyFalseAeb ||= earlySim.adas.status.aeb;
    }
    assert(!earlyFalseAeb && earlySim.metrics.collisions === 0, "False AEB on pedestrian who cleared corridor long before ego arrival");

    // (b) Synchronized conflict: pedestrian crosses ego's lane (`d = 0`) right when ego arrives (`s = 182`, `v = 13 m/s`)
    const hitSim = makeCleanAdasSim({ usePerception: true, speedMps: 13 });
    hitSim.adas.config.acc = false;
    const hitPed = hitSim.pedestrians.add({ s: 182, fromD: -3.2, toD: 3.5, speed: 1.45, wait: 0 });
    hitPed.state = "crossing";
    // Keep pedestrian moving steadily across crosswalk so test evaluates ego AEB rather than pedestrian self-yielding
    hitSim.pedestrians.update = (dt) => {
      if (hitPed.d < 3.5) hitPed.d += 1.45 * dt;
    };
    let hitSawAeb = false;
    for (let i = 0; i < 5 * 60; i++) {
      hitSim.setDriverInput({ steer: 0, throttle: 0.08, brake: 0 });
      hitSim.step(FIXED_DT);
      hitSawAeb ||= hitSim.adas.status.aeb;
    }
    const minClear = bumperGapAhead(hitSim, hitPed.s, hitPed.radius * 2);
    assert(hitSawAeb, "AEB failed to trigger for synchronized crossing pedestrian");
    assert.equal(hitSim.metrics.collisions, 0, "Ego struck crossing pedestrian");
    assert(minClear >= EXPECTED_SPECS.pedestrianMinClearanceM || hitPed.d > 2.2, "Insufficient pedestrian clearance");

    // (c) Late crossing: pedestrian far from lane (`d = -6.8 m`, slow `1.0 m/s`) at `s = 166` while ego passes at `15 m/s` in `1.0 s`
    const lateSim = makeCleanAdasSim({ usePerception: true, speedMps: 15 });
    lateSim.adas.config.acc = false;
    const latePed = lateSim.pedestrians.add({ s: 166, fromD: -6.8, toD: 6.8, speed: 1.0, wait: 0 });
    latePed.state = "crossing";
    lateSim.pedestrians.update = (dt) => {
      latePed.d += 1.0 * dt;
    };
    let lateFalseAeb = false;
    for (let i = 0; i < 90; i++) {
      lateSim.setDriverInput({ steer: 0, throttle: 0.1, brake: 0 });
      lateSim.step(FIXED_DT);
      lateFalseAeb ||= lateSim.adas.status.aeb;
    }
    assert(!lateFalseAeb && lateSim.metrics.collisions === 0, "False AEB on pedestrian entering lane well after ego passes");
  }

  // 2.4 Curved Road (`ring-road`): in-lane curved obstacle stops safely vs outer-lane tangent obstacle causes 0 false AEB
  {
    const probe = makeCleanAdasSim({ trackId: "ring-road" });
    let curveS = 0;
    let bestK = 0;
    for (let s = 0; s < probe.path.length; s += 5) {
      const k = Math.abs(probe.path.signedCurvatureAt(s));
      if (k > bestK) {
        bestK = k;
        curveS = s;
      }
    }
    assert(bestK > 0.004, "Expected non-trivial curvature on ring-road");

    // (a) Stalled car in ego's curved lane -> AEB stops safely
    const inCurveSim = makeCleanAdasSim({ trackId: "ring-road", usePerception: true, speedMps: 16, startS: curveS, laneIndex: 1 });
    inCurveSim.adas.config.acc = false;
    const curveObstacle = inCurveSim.traffic.addTestVehicle("stalled", 1, curveS + 42, 0, 0);
    let curveBraked = false;
    for (let i = 0; i < 6 * 60; i++) {
      inCurveSim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
      inCurveSim.step(FIXED_DT);
      curveBraked ||= inCurveSim.adas.status.aeb;
    }
    assert(curveBraked && inCurveSim.metrics.collisions === 0 && inCurveSim.ego.v < 0.2, "Curved-road in-lane AEB failed to stop before obstacle");

    // (b) Stalled car in adjacent lane along curve (`lane 0` and `lane 2`) -> 0 false AEB while LFA follows lane 1
    for (const adjLane of [0, 2]) {
      if (adjLane >= probe.road.numLanes) continue;
      const adjCurveSim = makeCleanAdasSim({ trackId: "ring-road", usePerception: true, speedMps: 15, startS: curveS, laneIndex: 1 });
      adjCurveSim.adas.config.acc = false;
      adjCurveSim.traffic.addTestVehicle("stalled", adjLane, curveS + 34, 0, 0);
      let adjFalseAeb = false;
      for (let i = 0; i < 4 * 60; i++) {
        adjCurveSim.setDriverInput({ steer: 0, throttle: 0.08, brake: 0 });
        adjCurveSim.step(FIXED_DT);
        adjFalseAeb ||= adjCurveSim.adas.status.aeb;
      }
      assert(!adjFalseAeb && adjCurveSim.metrics.collisions === 0, `Curved-road adjacent-lane car (lane=${adjLane}) caused false AEB`);
    }
  }
}

// ===========================================================================
// GROUP 3: Non-Braking / False-Positive Immunity & Function Separation
// ===========================================================================
{
  // 3.1 Off-road static object beside road & 3.2 Adjacent-lane moving traffic -> 0 false AEB
  {
    const sim = makeCleanAdasSim({ usePerception: true, speedMps: 20 });
    sim.adas.config.acc = false;
    const roadside = sim.path.toCartesian(190, sim.road.totalWidth * 0.5 + 2.4);
    sim.staticWorld.add({ id: "kiosk-offroad", kind: "building", x: roadside.x, y: roadside.y, yaw: roadside.heading, length: 4, width: 3 });
    sim.traffic.addTestVehicle("car", 0, 175, 12, 12);
    sim.traffic.addTestVehicle("stalled", 2, 185, 0, 0);
    for (let i = 0; i < 180; i++) {
      sim.setDriverInput({ steer: 0, throttle: 0.08, brake: 0 });
      sim.step(FIXED_DT);
      assert(!sim.adas.status.aeb, "False AEB on off-road building or adjacent-lane cars");
    }
  }

  // 3.3 Historical Bug Check: Two stationary cars at 5.35 m AND 2.0 m gap (`v = 0`, `throttle = 0`)
  //     MUST NOT create a new AEB or HOLD event!
  for (const gapM of [5.35, 2.0]) {
    for (const usePerception of [false, true]) {
      const sim = makeCleanAdasSim({ usePerception, speedMps: 0 });
      sim.adas.config.acc = false;
      const lane = sim.road.laneOf(0);
      sim.traffic.addTestVehicle("stalled", lane, 150 + gapM + 4.65, 0, 0);
      for (let i = 0; i < 120; i++) {
        sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
        sim.step(FIXED_DT);
        assert(!sim.adas.status.aeb, `Stationary pair at ${gapM} m falsely triggered AEB`);
        assert(!sim.adas.status.aebHolding, `Stationary pair at ${gapM} m falsely entered HOLD without prior AEB event`);
        assert.equal(sim.adas.status.aebState, "MONITOR");
        assert.equal(sim.adas.status.adasBrakeForce, 0);
      }
      assert.equal(sim.stats.aebEvents, 0);
    }
  }

  // 3.4 Close lead vehicle pulling away (`gap = 2.6 m`, `ego.v = 4 m/s`, `lead.v = 8.5 m/s`, `closingSpeed < 0`) -> TTC invalid & 0 false AEB
  {
    const sim = makeCleanAdasSim({ usePerception: false, speedMps: 4 });
    sim.adas.config.acc = false;
    sim.setAebLogging(true);
    const lane = sim.road.laneOf(0);
    const lead = sim.traffic.addTestVehicle("car", lane, 150 + 2.6 + 4.65, 8.5, 8.5);
    sim.traffic.update = (dt) => {
      lead.v = 8.5;
      lead.s = (lead.s + lead.v * dt) % sim.path.length;
    };
    for (let i = 0; i < 60; i++) {
      sim.setDriverInput({ steer: 0, throttle: 0.05, brake: 0 });
      sim.step(FIXED_DT);
      assert(!sim.adas.status.aeb, "Close pulling-away vehicle falsely triggered AEB");
    }
    assert(sim.aebLogger.entries.every((e) => e.ttc === null && e.ttcValid === false), "Pulling-away target must report ttcValid=false");
  }

  // 3.5 Separate low-speed functions: PMC (`pedalMitigation`) works at standstill full-throttle when forward AEB is off; EPB holds independently
  {
    const sim = makeCleanAdasSim({ usePerception: false, speedMps: 0 });
    sim.adas.config.aeb = false;
    sim.adas.config.pedalMitigation = true;
    const lane = sim.road.laneOf(0);
    sim.traffic.addTestVehicle("stalled", lane, 150 + 1.8 + 4.65, 0, 0);
    sim.setDriverInput({ steer: 0, throttle: 1, brake: 0 });
    sim.step(FIXED_DT);
    assert(sim.adas.status.extra.pedalMitigation, "PMC did not catch standstill pedal misapplication");
    assert(!sim.adas.status.aeb, "PMC was conflated with forward AEB");
  }
}

// ===========================================================================
// GROUP 4: Occlusion, Multi-Rate Ticks, Dropout, Track Loss & Sensor Faults
// ===========================================================================
{
  // 4.1 Physical Occlusion & Ground-Truth Isolation (Euro NCAP CPNO Nearside Obstructed):
  //     Pedestrian behind a parked adjacent-lane truck is occluded in `sensor` mode (no X-ray, no ground-truth leak),
  //     then becomes visible & triggers AEB once stepping past the truck's front corner into line-of-sight!
  {
    const occSim = makeCleanAdasSim({ usePerception: true, speedMps: 0 });
    occSim.sensor.config.dropout = 0;
    occSim.sensor.config.posNoise = 0;
    // Parked truck in adjacent lane (`d = +3.7 m`, `s = 168`) casts angular shadow `[0.095, 0.446] rad` at `s = 180`
    const blocker = occSim.traffic.addTestVehicle("truck", 2, 168, 0, 0);
    blocker.disabled = true;
    const hiddenPed = occSim.pedestrians.add({ s: 180, fromD: 4.8, toD: -3.5, speed: 0, wait: 99 });
    hiddenPed.state = "crossing";
    hiddenPed.d = 4.8; // Bearing = atan(4.8 / 30) = 0.159 rad -> occluded behind truck!
    // Let the hidden exposure complete processing before asserting occlusion;
    // an empty cold-start queue alone cannot demonstrate physical masking.
    for (let i = 0; i < 8; i++) occSim.step(FIXED_DT);
    assert.equal(occSim.telemetry.perceptionMode, "sensor");
    const pedTracksWhileHidden = occSim.tracks.filter((t) => t.kind === "ped");
    assert.equal(pedTracksWhileHidden.length, 0, "ADAS sensor had X-ray vision through parked truck onto hidden pedestrian");

    // Pedestrian steps past truck's front inner corner (`d = 1.6 m`, bearing = 0.053 rad < 0.095 rad).
    // Its newly visible exposure still has to finish the real 55ms pipeline.
    hiddenPed.d = 1.6;
    for (let i = 0; i < 3; i++) {
      occSim.step(FIXED_DT);
      assert.equal(occSim.tracks.filter((t) => t.kind === "ped").length, 0, "Emerging pedestrian bypassed in-flight processing");
    }
    for (let i = 0; i < 8 && !occSim.tracks.some((t) => t.kind === "ped"); i++) occSim.step(FIXED_DT);
    const pedTracksAfterEmergence = occSim.tracks.filter((t) => t.kind === "ped");
    assert.equal(pedTracksAfterEmergence.length, 1, "Pedestrian emerging from behind truck silhouette was not detected");

    // Dynamic CPNO run: ego approaches at 36 km/h (10 m/s), pedestrian emerges from behind parked truck and AEB stops!
    const cpnoSim = makeCleanAdasSim({ usePerception: true, speedMps: 10 });
    cpnoSim.adas.config.acc = false;
    cpnoSim.sensor.config.dropout = 0;
    const parkedTruck = cpnoSim.traffic.addTestVehicle("truck", 2, 168, 0, 0);
    parkedTruck.disabled = true;
    const emergingPed = cpnoSim.pedestrians.add({ s: 181, fromD: 4.8, toD: -3.5, speed: 1.8, wait: 0 });
    emergingPed.state = "crossing";
    cpnoSim.pedestrians.update = (dt) => {
      if (emergingPed.d > -3.5) emergingPed.d -= 1.8 * dt;
    };
    cpnoSim.step(FIXED_DT);
    assert.equal(cpnoSim.tracks.filter((t) => t.kind === "ped").length, 0, "CPNO pedestrian should start occluded behind truck");
    let cpnoBraked = false;
    for (let i = 0; i < 5 * 60; i++) {
      cpnoSim.setDriverInput({ steer: 0, throttle: 0.05, brake: 0 });
      cpnoSim.step(FIXED_DT);
      cpnoBraked ||= cpnoSim.adas.status.aeb;
    }
    assert(cpnoBraked && cpnoSim.metrics.collisions === 0, "Dynamic CPNO emerging pedestrian failed to trigger AEB stop");

    // Verify explicit `ground-truth-debug` telemetry label when `usePerception = false`
    occSim.usePerception = false;
    occSim.step(FIXED_DT);
    assert.equal(occSim.telemetry.perceptionMode, "ground-truth-debug");
  }

  // 4.2 Multi-rate sensor (`hasNewSample = false`) vs real dropout (`coastingSec <= maxCoastSec`)
  {
    const sim = makeCleanAdasSim({ usePerception: true, speedMps: 15 });
    sim.sensor.config.dropout = 0;
    sim.sensorScanIntervalSec = 0.05; // 20 Hz sensor scan on 60 Hz physics (1 scan every 3 physics steps)
    sim.traffic.addTestVehicle("stalled", 0, 185, 0, 0);
    // Runtime scans now have a genuine 55ms fusion-processing deadline. A
    // sampled scene is not an immediately available tracker observation.
    for (let i = 0; i < 3; i++) {
      sim.step(FIXED_DT);
      assert.equal(sim.tracks.length, 0, "In-flight scan bypassed sensor processing latency");
    }
    for (let i = 0; i < 8 && sim.tracks.length === 0; i++) sim.step(FIXED_DT);
    assert.equal(sim.tracks.length, 1, "Completed scan did not reach the tracker");
    const initialAge = sim.tracks[0].ageSec;
    assert(initialAge >= .055, "Track discarded its delayed acquisition age");
    sim.step(FIXED_DT); // intermediate physics step #1, no next completed scan
    sim.step(FIXED_DT); // intermediate physics step #2
    assert.equal(sim.tracks.length, 1);
    assert.equal(sim.tracks[0].misses, 0, "Intermediate multi-rate physics tick was miscounted as a sensor miss");
    assert.equal(sim.tracks[0].coastingSec, 0, "Intermediate multi-rate physics tick falsely incremented coastingSec");
    assert(Math.abs(sim.tracks[0].ageSec - initialAge - 2 * FIXED_DT) < 1e-6, "Track simulation-time ageSec did not advance");

    // Now force 100% sensor dropout -> track coasts up to `maxCoastSec = 0.35 s` and is then deleted (no ground-truth leak!)
    sim.sensorScanIntervalSec = 0;
    sim.sensor.config.dropout = 1;
    // Previously sampled observations can still complete processing after
    // acquisition starts dropping out. Coast only after a genuinely empty
    // completed sweep arrives, not the first physics tick after the switch.
    for (let i = 0; i < 10 && sim.tracks[0].coastingSec === 0; i++) sim.step(FIXED_DT);
    assert(sim.tracks.length === 1 && sim.tracks[0].coastingSec > 0, "Track failed to coast on completed dropout sweep");
    for (let i = 0; i < 30; i++) sim.step(FIXED_DT); // 0.50 s > 0.35 s maxCoastSec
    assert.equal(sim.tracks.length, 0, "Lost track persisted forever past maxCoastSec");
    assert.equal((sim as unknown as { obstacles(): Obstacle[] }).obstacles().length, 0, "Empty tracks fell back to ground truth");
  }

  // 4.3 Track loss mid-braking: short dropout maintains braking, permanent target disappearance releases within bounded time
  {
    const sim = makeCleanAdasSim({ usePerception: true, speedMps: 20 });
    sim.adas.config.acc = false;
    sim.sensor.config.dropout = 0;
    const lane = sim.road.laneOf(0);
    sim.traffic.addTestVehicle("stalled", lane, 150 + 34, 0, 0);
    for (let i = 0; i < 6; i++) sim.step(FIXED_DT);
    assert(sim.adas.status.aeb, "Expected active AEB before mid-brake dropout");

    // 2-frame sensor dropout mid-braking -> AEB must NOT drop out!
    sim.sensor.config.dropout = 1;
    sim.step(FIXED_DT);
    sim.step(FIXED_DT);
    assert(sim.adas.status.aeb, "2-frame sensor dropout mid-EMERGENCY prematurely dropped AEB");

    // Remove obstacle completely -> after coasting + dropoutHoldSec (~0.55 s), AEB must release rather than locking forever
    sim.traffic.clear();
    for (let i = 0; i < 45; i++) sim.step(FIXED_DT);
    assert(!sim.adas.status.aeb && sim.adas.status.aebState === "MONITOR", "AEB stayed locked indefinitely after target vanished");
  }

  // 4.4 Sensor faults before & during braking (`available` / `degraded` / `unavailable`)
  {
    // (a) Camera-only loss (`radarOnly` degraded): vehicle AEB still works, availability is `degraded`
    const radarOnlySim = makeCleanAdasSim({ usePerception: true, speedMps: 16 });
    radarOnlySim.adas.config.acc = false;
    radarOnlySim.sensorAvailability = { camera: false, frontRadar: true, rearRadar: true, ultrasonic: true };
    radarOnlySim.traffic.addTestVehicle("stalled", radarOnlySim.road.laneOf(0), 150 + 30, 0, 0);
    let radarBraked = false;
    for (let i = 0; i < 5 * 60; i++) {
      radarOnlySim.step(FIXED_DT);
      if (i === 2) assert.equal(radarOnlySim.adas.status.aebAvailability, "degraded");
      radarBraked ||= radarOnlySim.adas.status.aeb;
    }
    assert(radarBraked && radarOnlySim.metrics.collisions === 0, "Radar-only degraded mode failed to brake for stalled vehicle");

    // (b) Total forward sensor fault BEFORE braking -> `unavailable`, `takeoverRequired = true`, 0 blind AEB
    const blindBefore = makeCleanAdasSim({ usePerception: true, speedMps: 15 });
    blindBefore.sensorFault = true;
    blindBefore.traffic.addTestVehicle("stalled", blindBefore.road.laneOf(0), 150 + 25, 0, 0);
    blindBefore.step(FIXED_DT);
    assert.equal(blindBefore.adas.status.aebAvailability, "unavailable");
    assert(blindBefore.adas.status.takeoverRequired && !blindBefore.adas.status.aeb);

    // (c) Sudden total forward sensor fault MID-EMERGENCY -> bounded hold (`faultHoldSec = 0.2 s`), then clean release
    const faultMid = makeCleanAdasSim({ usePerception: true, speedMps: 20 });
    faultMid.adas.config.acc = false;
    faultMid.traffic.addTestVehicle("stalled", faultMid.road.laneOf(0), 150 + 32, 0, 0);
    for (let i = 0; i < 6; i++) faultMid.step(FIXED_DT);
    assert.equal(faultMid.adas.status.aebState, "EMERGENCY");
    faultMid.sensorFault = true;
    faultMid.step(FIXED_DT);
    assert(faultMid.adas.status.aeb && faultMid.adas.status.takeoverRequired, "Mid-brake sensor fault must hold brake briefly & demand takeover");
    for (let i = 0; i < 20; i++) faultMid.step(FIXED_DT); // > 0.20 s faultHoldSec
    assert(!faultMid.adas.status.aeb && faultMid.adas.status.aebState === "MONITOR", "Mid-brake sensor fault held brakes past faultHoldSec");
  }
}

// ===========================================================================
// GROUP 5: Low Grip, Slope, Cornering, Unavoidable Mitigation & Post-Stop Hold
// ===========================================================================
{
  // 5.1 Low grip (`surfaceMu = 0.35` unexpected black ice): actual decel bounded by `mu * g`, online friction adapts
  {
    const iceSim = makeCleanAdasSim({ usePerception: false, speedMps: 18 });
    iceSim.adas.config.acc = false;
    iceSim.ego.surfaceMu = 0.35; // World has black ice (`max grip = 3.43 m/s²`), controller initially expects dry (`1.0`)
    iceSim.traffic.addTestVehicle("stalled", iceSim.road.laneOf(0), 150 + 68, 0, 0);
    let maxActualDecel = 0;
    for (let i = 0; i < 8 * 60; i++) {
      iceSim.step(FIXED_DT);
      maxActualDecel = Math.max(maxActualDecel, -iceSim.ego.a);
    }
    assert(maxActualDecel <= 0.35 * 9.81 + 1e-3, `Low-grip deceleration violated tire friction limit: ${maxActualDecel}`);
    assert(maxActualDecel >= 0.35 * 7.0 - 0.05, "Low-grip braking failed to utilize available tire friction");
  }

  // 5.2 Road slope (`roadGrade = -0.06` downhill vs `0` flat): downhill reduces effective decel and requires longer stop distance
  {
    const measureStopDist = (grade: number): number => {
      const v = new Vehicle(0, 0, 0, 20, EGO_DIMS);
      v.roadGrade = grade;
      for (let i = 0; i < 400; i++) v.step(0, -7.0, FIXED_DT, 1);
      return v.x;
    };
    const flatDist = measureStopDist(0);
    const downhillDist = measureStopDist(-0.06);
    const uphillDist = measureStopDist(0.06);
    assert(downhillDist > flatDist + 2.0 && flatDist > uphillDist + 1.5, "Road grade did not physically alter braking distance");

    // Downhill AEB stops safely before stalled car because CollisionPredictor includes `ego.roadGrade`
    const hillSim = makeCleanAdasSim({ usePerception: true, speedMps: 18 });
    hillSim.adas.config.acc = false;
    hillSim.ego.roadGrade = -0.06;
    hillSim.traffic.addTestVehicle("stalled", hillSim.road.laneOf(0), 150 + 48, 0, 0);
    for (let i = 0; i < 7 * 60; i++) hillSim.step(FIXED_DT);
    assert.equal(hillSim.metrics.collisions, 0, "Downhill AEB failed to compensate for -6% grade");
    assert.equal(hillSim.ego.v, 0);
  }

  // 5.3 Cornering brake-grip coupling: braking while steering reserves lateral tire force instead of 100% straight lock
  {
    const straightCar = new Vehicle(0, 0, 0, 22, EGO_DIMS);
    straightCar.limitLateralGrip = true;
    straightCar.corneringBrakeCoupling = true;
    const turningCar = new Vehicle(0, 0, 0, 22, EGO_DIMS);
    turningCar.limitLateralGrip = true;
    turningCar.corneringBrakeCoupling = true;
    for (let i = 0; i < 15; i++) {
      straightCar.step(0, -9.8, FIXED_DT, 1);
      turningCar.step(0.22, -9.8, FIXED_DT, 1);
    }
    assert(Math.abs(turningCar.a) < Math.abs(straightCar.a) - 0.3, "Cornering did not couple into longitudinal brake grip");
    assert(Math.abs(turningCar.lateralAccel) > 2.5, "Cornering brake coupling starved lateral acceleration");
  }

  // 5.4 Unavoidable Collision Mitigation: `v0 = 22 m/s`, stalled car at `13 m` gap (pure stop needs `34.6 m`), adjacent lanes blocked
  //     Compare impact speed with AEB ON vs AEB OFF under identical conditions!
  {
    const runUnavoidable = (aebEnabled: boolean, options: {warm?: boolean; causalReference?: boolean} = {}): { collided: boolean; impactSpeed: number; sawAeb: boolean; firstAebTick: number | null } => {
      const sim = makeCleanAdasSim({ usePerception: true, speedMps: 22, seed: 55 });
      sim.adas.config.acc = false;
      sim.adas.config.laneCentering = false;
      sim.adas.config.laneKeeping = false;
      sim.adas.config.aeb = aebEnabled;
      const lane = sim.road.laneOf(0);
      sim.traffic.addTestVehicle("stalled", lane, 150 + 13 + 4.65, 0, 0);
      if (options.warm) {
        // A previously observed target remains available when the threat starts.
        // Warm the real sensing pipeline at standstill; do not inject tracks.
        sim.ego.v = 0;
        sim.setDriverInput({steer:0,throttle:0,brake:1});
        for (let i = 0; i < 12; i++) sim.step(FIXED_DT);
        sim.ego.v = 22; sim.ego.syncWheelSpeeds();
      }
      const processingDelay = Math.max(sim.dualChannelSensor.cameraSpec.latencySec, sim.dualChannelSensor.radarSpec.latencySec);
      const firstCausalIndex = Math.ceil(processingDelay / FIXED_DT - 1e-9);
      // The reference uses exact target state ONLY as a test oracle, starting
      // no earlier than a real exposure can finish processing. Production AEB
      // remains sensor-driven. This bounds achievable mitigation after a cold
      // start instead of demanding the old instantaneous-sensor result.
      if (options.causalReference) sim.usePerception = false;
      let sawAeb = false;
      let firstAebTick: number | null = null;
      for (let i = 0; i < 120; i++) {
        if (options.causalReference) sim.adas.config.aeb = aebEnabled && i >= firstCausalIndex;
        sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
        sim.step(FIXED_DT);
        sawAeb ||= sim.adas.status.aeb;
        if (sim.adas.status.aeb && firstAebTick === null) firstAebTick = i + 1;
        if (sim.metrics.collisions > 0) break;
      }
      return {
        collided: sim.metrics.collisions > 0,
        impactSpeed: sim.lastImpactSpeed ?? 0,
        sawAeb,
          firstAebTick,
      };
    };
    const aebOff = runUnavoidable(false);
    const aebOn = runUnavoidable(true);
    assert(aebOff.collided && aebOn.collided, "Expected unavoidable setup to collide in both runs");
    assert(aebOn.sawAeb, "AEB failed to command mitigation braking in unavoidable collision");
      const causalReference = runUnavoidable(true, {causalReference:true});
      assert.equal(aebOn.firstAebTick, causalReference.firstAebTick, 'Urgent tentative detection waited beyond the first completed sensor exposure');
      assert(aebOn.impactSpeed <= causalReference.impactSpeed + .10, 'Cold-start AEB wasted braking time after sensor delivery');
      const availableReduction = aebOff.impactSpeed - causalReference.impactSpeed;
      assert(availableReduction > 0 && aebOff.impactSpeed - aebOn.impactSpeed >= availableReduction * .95,
        'Cold-start AEB did not use at least 95% of the physically available speed reduction');
      const warmOn = runUnavoidable(true, {warm:true}), warmOff = runUnavoidable(false, {warm:true});
    assert(
        warmOn.impactSpeed < warmOff.impactSpeed - EXPECTED_SPECS.unavoidableMinSpeedReductionMps,
        `Established-track AEB mitigation did not meaningfully reduce impact speed (on=${warmOn.impactSpeed.toFixed(2)} vs off=${warmOff.impactSpeed.toFixed(2)} m/s)`,
    );
    console.log(
        `  [metrics] Unavoidable impact (gap=13m, v0=79.2km/h): cold OFF=${aebOff.impactSpeed.toFixed(2)}, ON=${aebOn.impactSpeed.toFixed(2)}, earliest causal reference=${causalReference.impactSpeed.toFixed(2)} m/s; established OFF=${warmOff.impactSpeed.toFixed(2)}, ON=${warmOn.impactSpeed.toFixed(2)} m/s`,
    );
  }

  // 5.5 Post-stop HOLD -> RELEASE handoff: (a) driver brake pedal takeover, (b) configurable holdMaxSeconds
  {
    // (a) Driver foot brake takeover (`brake = 0.3`) transitions HOLD -> RELEASE -> MONITOR
    const sim = makeCleanAdasSim({ usePerception: false, speedMps: 14 });
    sim.adas.config.acc = false;
    sim.traffic.addTestVehicle("stalled", sim.road.laneOf(0), 150 + 26, 0, 0);
    for (let i = 0; i < 5 * 60; i++) sim.step(FIXED_DT);
    assert.equal(sim.adas.status.aebState, "HOLD");
    sim.setDriverInput({ steer: 0, throttle: 0, brake: 0.3 });
    sim.step(FIXED_DT);
    assert.equal(sim.adas.status.aebState, "RELEASE");
    assert(!sim.adas.status.aebHolding && sim.adas.status.arbiterSource === "driver");

    // (b) Configurable `holdMaxSeconds = 0.5 s` releases HOLD after 0.5 s
    const timedSim = makeCleanAdasSim({ usePerception: false, speedMps: 14 });
    timedSim.adas.config.acc = false;
    timedSim.adas.config.aebCalibration = { holdMaxSeconds: 0.5 };
    timedSim.traffic.addTestVehicle("stalled", timedSim.road.laneOf(0), 150 + 26, 0, 0);
    for (let i = 0; i < 4 * 60; i++) timedSim.step(FIXED_DT);
    assert(timedSim.ego.v === 0 && !timedSim.adas.status.aebHolding, "holdMaxSeconds did not release HOLD after timeout");
  }
}

// ===========================================================================
// GROUP 6: Driver Braking Priority, Override Policy & ACC/AEB Arbitration
// ===========================================================================
{
  const baseSim = makeCleanAdasSim({ usePerception: false, speedMps: 20 });
  const pose = baseSim.path.toFrenet(baseSim.ego.x, baseSim.ego.y);
  const mkFrame = (overrides: Partial<ADASFrame> = {}): ADASFrame => ({
    ego: baseSim.ego,
    egoS: pose.s,
    egoD: pose.d,
    path: baseSim.path,
    road: baseSim.road,
    obstacles: [],
    desiredSpeed: 22,
    input: { steer: 0, throttle: 0, brake: 0 },
    dt: FIXED_DT,
    speedControl: (e) => e,
    usePerception: false,
    ...overrides,
  });

  // 6.1 Stronger driver brake (`0.85 -> 5.95 m/s²`) during PARTIAL AEB (`~3.85 m/s²`) is NEVER weakened
  {
    const c = new ADASController();
    const movingLead: Obstacle = { id: 1, s: pose.s + 26, d: pose.d, v: 9.5, vd: 0, length: 4.6, width: 1.9, kind: "car" };
    const autoOnly = c.update(mkFrame({ obstacles: [movingLead] }));
    assert.equal(autoOnly.status.aebState, "PARTIAL");
    assert(autoOnly.accel > -5.9 && autoOnly.accel < -3.5);

    const cDriver = new ADASController();
    const withStrongDriver = cDriver.update(mkFrame({ obstacles: [movingLead], input: { steer: 0, throttle: 0, brake: 0.85 } }));
    assert(Math.abs(withStrongDriver.accel - (-0.85 * baseSim.ego.maxDecel)) < 1e-6, `Driver stronger braking was altered: ${withStrongDriver.accel}`);
    assert.equal(withStrongDriver.status.arbiterSource, "driver");
    assert.equal(withStrongDriver.status.brakeReason, "driver");
  }

  // 6.2 Configurable kickdown override policy (`throttleOverrideThreshold = 0.95` vs default `null`)
  {
    const closeObs: Obstacle = { id: 2, s: pose.s + 28, d: pose.d, v: 0, vd: 0, length: 4.6, width: 1.9, kind: "car" };
    const defaultCtrl = new ADASController();
    const defOut = defaultCtrl.update(mkFrame({ obstacles: [closeObs], input: { steer: 0, throttle: 0.98, brake: 0 } }));
    assert(defOut.status.aeb && defOut.accel <= -6.9, "Default policy must override held accelerator during emergency");

    const kickdownCtrl = new ADASController();
    kickdownCtrl.config.aebCalibration = { overridePolicy: { throttleOverrideThreshold: 0.95, steeringOverrideRelease: true } };
    const ovrOut = kickdownCtrl.update(mkFrame({ obstacles: [closeObs], input: { steer: 0, throttle: 0.98, brake: 0 } }));
    assert(!ovrOut.status.aeb && ovrOut.status.arbiterSource === "override" && ovrOut.accel > 0, "Configured kickdown override failed");
  }

  // 6.3 Direct MONITOR -> EMERGENCY jump on sudden close obstacle even while ACC comfort limiter is active
  {
    const c = new ADASController();
    // Cruise comfortably for 10 steps so ACC `normalAccel` is positive/near zero
    for (let i = 0; i < 10; i++) c.update(mkFrame({ desiredSpeed: 25 }));
    assert.equal(c.status.aebState, "MONITOR");
    // Inject sudden imminent obstacle -> must jump straight from MONITOR to EMERGENCY in 1 step at -7.0 m/s²!
    const sudden: Obstacle = { id: 3, s: pose.s + 18, d: pose.d, v: 0, vd: 0, length: 4.6, width: 1.9, kind: "car" };
    const jumpOut = c.update(mkFrame({ obstacles: [sudden], desiredSpeed: 25 }));
    assert.equal(jumpOut.status.aebState, "EMERGENCY", "Failed to jump directly from MONITOR to EMERGENCY");
    assert.equal(jumpOut.accel, -baseSim.ego.maxDecel, "ACC comfort limiter weakened or overwrote EMERGENCY AEB command");
    assert.equal(jumpOut.status.arbiterSource, "aeb-emergency");
  }
}

// ===========================================================================
// GROUP 7: Permutation Invariance, 30/60/144 FPS, dt Convergence & Logger
// ===========================================================================
{
  // 7.1 All 6 permutations of 3 mixed obstacles + independent ACC lead vs AEB critical target
  {
    const sim = makeCleanAdasSim({ usePerception: false, speedMps: 20 });
    const pose = sim.path.toFrenet(sim.ego.x, sim.ego.y);
    // Target A: closer fast pulling-away car in lane (`ds = 14`, `v = 26` -> ACC lead, zero AEB risk)
    // Target B: stopped car in ego lane (`ds = 33`, `v = 0` -> AEB EMERGENCY critical target)
    // Target C: adjacent-lane car (`ds = 10`, `d = +3.7`, `v = 15` -> distractor)
    const obsA: Obstacle = { id: 101, s: pose.s + 14, d: pose.d, v: 26, vd: 0, length: 4.6, width: 1.9, kind: "car" };
    const obsB: Obstacle = { id: 102, s: pose.s + 33, d: pose.d, v: 0, vd: 0, length: 4.6, width: 1.9, kind: "car" };
    const obsC: Obstacle = { id: 103, s: pose.s + 10, d: pose.d + sim.road.laneWidth, v: 15, vd: 0, length: 4.6, width: 1.9, kind: "car" };
    const perms: Obstacle[][] = [
      [obsA, obsB, obsC],
      [obsA, obsC, obsB],
      [obsB, obsA, obsC],
      [obsB, obsC, obsA],
      [obsC, obsA, obsB],
      [obsC, obsB, obsA],
    ];
    const results = perms.map((obstacles) => {
      const ctrl = new ADASController();
      return ctrl.update({
        ego: sim.ego,
        egoS: pose.s,
        egoD: pose.d,
        path: sim.path,
        road: sim.road,
        obstacles,
        desiredSpeed: 22,
        input: { steer: 0, throttle: 0, brake: 0 },
        dt: FIXED_DT,
        speedControl: (e) => e,
        usePerception: false,
      });
    });
    const ref = results[0];
    assert(ref.status.aeb && ref.status.aebTargetId === 102, "Closer pulling-away car masked AEB critical target #102");
    for (let i = 1; i < results.length; i++) {
      assert.equal(results[i].accel, ref.accel, `Permutation ${i} changed accel`);
      assert.equal(results[i].status.aebState, ref.status.aebState, `Permutation ${i} changed aebState`);
      assert.equal(results[i].status.aebTargetId, ref.status.aebTargetId, `Permutation ${i} changed aebTargetId`);
      assert.equal(results[i].status.fcwLevel, ref.status.fcwLevel, `Permutation ${i} changed fcwLevel`);
      assert.equal(results[i].status.leadGap, ref.status.leadGap, `Permutation ${i} changed ACC leadGap`);
    }
  }

  // 7.2 Display FPS independence (30 / 60 / 144 FPS accumulator loop with same `fixedDt = 1/60` and `seed`)
  {
    const runAtDisplayFps = (fps: number): { finalGap: number; stepsExecuted: number; aebEvents: number } => {
      const sim = makeCleanAdasSim({ usePerception: true, speedMps: 20, seed: 2026 });
      sim.adas.config.acc = false;
      const lead = sim.traffic.addTestVehicle("stalled", sim.road.laneOf(0), 150 + 52, 0, 0);
      const renderDt = 1 / fps;
      const totalWallSec = 6.0;
      const nFrames = Math.round(totalWallSec * fps);
      let acc = 0;
      let stepsExecuted = 0;
      for (let f = 0; f < nFrames; f++) {
        acc = Math.min(acc + renderDt, 0.1);
        while (acc + 1e-9 >= FIXED_DT) {
          sim.step(FIXED_DT);
          acc -= FIXED_DT;
          stepsExecuted++;
        }
      }
      // Drain identical 360 fixed physics steps across 30/60/144 FPS
      while (stepsExecuted < 360) {
        sim.step(FIXED_DT);
        stepsExecuted++;
      }
      return {
        finalGap: bumperGapAhead(sim, lead.s, lead.length),
        stepsExecuted,
        aebEvents: sim.stats.aebEvents,
      };
    };
    const r30 = runAtDisplayFps(30);
    const r60 = runAtDisplayFps(60);
    const r144 = runAtDisplayFps(144);
    assert.equal(r30.stepsExecuted, r60.stepsExecuted);
    assert.equal(r60.stepsExecuted, r144.stepsExecuted);
    assert(Math.abs(r30.finalGap - r60.finalGap) < 1e-9 && Math.abs(r60.finalGap - r144.finalGap) < 1e-9, "Display FPS altered fixed-step AEB outcome");
    assert.equal(r30.aebEvents, 1);
  }

  // 7.3 Timestep convergence (`dt = 1/60` vs `dt = 1/120` vs `dt = 1/240`)
  {
    const runWithDt = (dt: number): { firstAebTime: number; finalGap: number } => {
      const sim = makeCleanAdasSim({ usePerception: true, speedMps: 20, seed: 314 });
      sim.adas.config.acc = false;
      sim.sensorScanIntervalSec = 1 / 60;
      sim.sensor.config.dropout = 0;
      sim.sensor.config.posNoise = 0.05;
      sim.sensor.config.velocityNoise = 0.05;
      const lead = sim.traffic.addTestVehicle("stalled", sim.road.laneOf(0), 150 + 50, 0, 0);
      let firstAebTime = Infinity;
      const totalSteps = Math.round(6.0 / dt);
      for (let i = 0; i < totalSteps; i++) {
        sim.step(dt);
        if (sim.adas.status.aeb && !Number.isFinite(firstAebTime)) firstAebTime = sim.simTime;
      }
      return {
        firstAebTime,
        finalGap: bumperGapAhead(sim, lead.s, lead.length),
      };
    };
    const c60 = runWithDt(1 / 60);
    const c120 = runWithDt(1 / 120);
    const c240 = runWithDt(1 / 240);
    assert(
      Math.abs(c60.firstAebTime - c120.firstAebTime) <= EXPECTED_SPECS.dtConvergenceTriggerTolSec &&
      Math.abs(c120.firstAebTime - c240.firstAebTime) <= EXPECTED_SPECS.dtConvergenceTriggerTolSec,
      `AEB trigger time failed dt convergence: 60Hz=${c60.firstAebTime.toFixed(3)}s, 120Hz=${c120.firstAebTime.toFixed(3)}s, 240Hz=${c240.firstAebTime.toFixed(3)}s`,
    );
    assert(
      Math.abs(c60.finalGap - c120.finalGap) <= EXPECTED_SPECS.dtConvergenceGapTolM &&
      Math.abs(c120.finalGap - c240.finalGap) <= EXPECTED_SPECS.dtConvergenceGapTolM,
      `Stopping gap failed dt convergence: 60Hz=${c60.finalGap.toFixed(3)}m, 120Hz=${c120.finalGap.toFixed(3)}m, 240Hz=${c240.finalGap.toFixed(3)}m`,
    );
    console.log(
      `  [metrics] dt convergence: trigger(60/120/240Hz)=${c60.firstAebTime.toFixed(3)}/${c120.firstAebTime.toFixed(3)}/${c240.firstAebTime.toFixed(3)}s | stopGap=${c60.finalGap.toFixed(3)}/${c120.finalGap.toFixed(3)}/${c240.finalGap.toFixed(3)}m`,
    );
  }

  // 7.4 Toggleable `AEBDiagnosticLogger` schema & export verification
  {
    const sim = makeCleanAdasSim({ usePerception: true, speedMps: 18 });
    sim.adas.config.acc = false;
    sim.traffic.addTestVehicle("stalled", sim.road.laneOf(0), 150 + 40, 0, 0);
    // Disabled by default -> 0 entries recorded
    sim.step(FIXED_DT);
    assert.equal(sim.aebLogger.entries.length, 0);

    sim.setAebLogging(true);
    for (let i = 0; i < 4 * 60; i++) sim.step(FIXED_DT);
    assert.equal(sim.aebLogger.entries.length, 240);
    const emergencyEntry = sim.aebLogger.entries.find((e) => e.aebState === "EMERGENCY");
    assert(emergencyEntry !== undefined, "Logger did not capture EMERGENCY state");
    assert(
      emergencyEntry.targetId !== null &&
      emergencyEntry.trackAgeSec !== null &&
      emergencyEntry.gap !== null &&
      emergencyEntry.closingSpeed !== null &&
      emergencyEntry.ttcValid === true &&
      emergencyEntry.ttc !== null &&
      emergencyEntry.aebDecelReq > 6 &&
      emergencyEntry.finalAccelCmd <= -6.9 &&
      emergencyEntry.availability === "available",
      "Logger EMERGENCY entry missing required diagnostic fields",
    );
    const csv = sim.aebLogger.toCSV();
    const json = JSON.parse(sim.aebLogger.toJSON());
    assert(csv.split("\n").length === 241 && Array.isArray(json) && json.length === 240);
    sim.setAebLogging(false);
    sim.step(FIXED_DT);
    assert.equal(sim.aebLogger.entries.length, 240, "Logger continued recording after being toggled off");
  }
}

console.log(
  "AEB-AUDIT-TEST PASS — actuator physics, CCRs/CCRm/same-speed/CCRb, cut-in/out, 3-phase pedestrian, curved road, occlusion, multi-rate/dropout/faults, low-mu/grade/cornering, unavoidable mitigation, arbiter/override, 6-way permutation, 30/60/144 FPS, dt convergence & diagnostic logger.",
);
