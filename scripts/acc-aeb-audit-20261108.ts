import assert from "node:assert/strict";
import { ADASController, type ADASFrame } from "../src/sim/ADAS.ts";
import { Simulation } from "../src/sim/Simulation.ts";
import type { Obstacle } from "../src/planner/Trajectory.ts";
import { CollisionPredictor, DEFAULT_AEB_CALIBRATION, assessAEBAvailability } from "../src/sim/AEB.ts";
import { proximitySafety } from "../src/sim/ProximitySafety.ts";
import { Vehicle } from "../src/vehicle/Vehicle.ts";

const sim = new Simulation({ trackId: "motorway", trafficCount: 0 });
const s = 500, d = sim.road.laneCenter(1), w = sim.path.toCartesian(s, d), dt = 1 / 60;
Object.assign(sim.ego, { x: w.x, y: w.y, yaw: w.heading, v: 8 });
const frame = (obstacles: Obstacle[], throttle = 0): ADASFrame => ({
  ego: sim.ego, egoS: s, egoD: d, path: sim.path, road: sim.road, obstacles,
  desiredSpeed: 20, input: { steer: 0, throttle, brake: 0 }, dt,
  speedControl: e => e, usePerception: false,
});

// Simulation projects a perpendicular 12m bus to a 2.55m-long, 12m-wide
// envelope in road coordinates. Re-rotating it from vd hides its rear half
// even while that rear half still occupies ego's lane.
const crossBus: Obstacle = { id: 771, s: s + 8, d: d + 4.5, v: 0, vd: 3,
  length: 2.55, width: 12, kind: "car", footprintFrame: "road" };
const busCtrl = new ADASController();
busCtrl.config.acc = false;
let out = busCtrl.update(frame([crossBus]));
assert(out.status.aeb && out.status.aebTargetId === 771,
  "AEB missed the road-aligned envelope of a crossing bus still occupying ego's lane");
assert(out.accel <= -sim.ego.maxDecel * .99);
const clearBusCtrl = new ADASController();
clearBusCtrl.config.acc = false;
assert(!clearBusCtrl.update(frame([{ ...crossBus, d: d + 9 }])).status.aeb,
  "AEB braked after the crossing bus completely cleared the lane");

// End-to-end adapter coverage: actual TrafficCar -> projected footprint ->
// ground truth OR dual-channel perception -> ADAS -> actuator -> contact.
for (const perceived of [false, true]) {
  const trial = new Simulation({ trackId: "motorway", trafficCount: 0, seed: 41 });
  trial.traffic.clear(); trial.pedestrians.clear(); trial.trafficLights = []; trial.roadSigns = [];
  trial.setControlMode("adas"); trial.adas.config.acc = false; trial.adas.config.pedalMitigation = false;
  trial.usePerception = perceived; trial.sensor.config.dropout = 0;
  Object.assign(trial.ego, { x: w.x, y: w.y, yaw: w.heading, v: 8 });
  trial.ego.syncWheelSpeeds(); (trial as any).lastEgoIndex = -1;
  const bus = trial.traffic.addTestVehicle("bus", 1, s + 12, 0, 0);
  Object.assign(bus, { d: d + 3, crossing: true, crossingStarted: true,
    crossingSpeed: 3, crossingToD: d + 30, headingOffset: Math.PI / 2 });
  let sawAeb = false;
  for (let i = 0; i < 2 * 60; i++) { trial.step(dt); sawAeb ||= trial.adas.status.aeb; }
  assert(sawAeb, `Cross-bus did not engage AEB through the ${perceived ? "sensor" : "ground-truth"} adapter`);
  assert.equal(trial.metrics.collisions, 0, "AEB made contact with an avoidable crossing bus");
}

// An existing emergency stop must not auto-release solely because its final
// clearance lies between the former 9.5m HOLD gate and the 12m stop latch.
for (const gap of [9.6, 10.5, 11.8]) {
  const c = new ADASController(); c.config.acc = false;
  sim.ego.v = 20;
  const stopped: Obstacle = { id: 772, s: s + 20, d, v: 0, vd: 0,
    length: 4.6, width: 1.9, kind: "car", footprintFrame: "road" };
  assert(c.update(frame([stopped], 1)).status.aeb);
  sim.ego.v = 0;
  stopped.s = s + (sim.ego.dims.length + stopped.length) / 2 + gap;
  for (let i = 0; i < 90; i++) out = c.update(frame([stopped], 1));
  assert(out.status.aebHolding && out.accel < 0,
    `AEB auto-released its completed stop with the accelerator still held at gap=${gap}m`);
  // A confirmed clear observation must still release the hold promptly.
  stopped.d = d + sim.road.laneWidth;
  for (let i = 0; i < 30; i++) out = c.update(frame([stopped], 0));
  assert(!out.status.aebHolding, "AEB held indefinitely after the target left the lane");
}

// Predictor must not invent tyre grip on a downhill. Compare its estimate
// with the actual baseline vehicle's full-brake deceleration, including grade.
const predictor = new CollisionPredictor();
// Raw delayed measurements still need propagation. Live tracks, already
// propagated to the current clock, must not gain another v*latency in range.
sim.ego.v = 20;
const moving: Obstacle = { id: 774, s: s + 30, d, v: 15, vd: 0,
  length: 4.6, width: 1.9, kind: "car", footprintFrame: "road" };
const currentRisk = (obstacle: Obstacle) => predictor.evaluate({ ego: sim.ego,
  egoS: s, egoD: d, path: sim.path, road: sim.road, obstacles: [obstacle],
  steerCmd: 0, driverSteerInput: 0, driverThrottle: 0, driverBrake: 0,
  laneAssistActive: false, targetLaneD: d, estimatedMu: 1, prefillReady: false,
  availability: assessAEBAvailability(true, {}), calibration: DEFAULT_AEB_CALIBRATION }).risks[0];
const fresh = currentRisk(moving);
const rawDelayed = currentRisk({ ...moving, latencySec: .2 });
const compensated = currentRisk({ ...moving, latencySec: .2, latencyCompensated: true });
assert(Math.abs(rawDelayed.gap - fresh.gap - moving.v * .2) < 1e-6,
  "Raw delayed measurement no longer receives its one required time propagation");
assert(Math.abs(compensated.gap - fresh.gap) < 1e-6,
  "AEB extrapolated an already-current track by the sensor latency a second time");
assert(Math.abs(compensated.minGapFull - fresh.minGapFull) < 1e-6,
  "Latency metadata changed a current-time track's full-brake clearance");
for (const grade of [-.10, -.06, 0, .06]) {
  let previousCap = 0;
  for (const mu of [.2, .35, .65, 1]) {
    const ego = new Vehicle(w.x, w.y, w.heading, 15);
    ego.surfaceMu = mu; ego.roadGrade = grade;
    const cap = predictor.evaluate({ ego, egoS: s, egoD: d, path: sim.path, road: sim.road,
      obstacles: [], steerCmd: 0, driverSteerInput: 0, driverThrottle: 0, driverBrake: 0,
      laneAssistActive: false, targetLaneD: d, estimatedMu: mu, prefillReady: false,
      availability: assessAEBAvailability(true, {}), calibration: DEFAULT_AEB_CALIBRATION }).estimatedBrakeCap;
    ego.step(0, -ego.maxDecel, dt);
    assert(cap <= -ego.a + 1e-6, `Optimistic brake estimate ${cap} vs physical ${-ego.a}: mu=${mu}, grade=${grade}`);
    assert(Number.isFinite(cap) && cap > 0 && cap >= previousCap, "Invalid/non-monotonic brake-capability estimate");
    previousCap = cap;
  }
}

// Proximity's explicit physical-body contract must agree with the equivalent
// perpendicular road-envelope contract, without changing legacy road inputs.
sim.ego.v = 1;
const rearBus: Obstacle = { id: 773, s: s - 6, d: d + 4.5, v: 0, vd: 3,
  length: 12, width: 2.55, kind: "car", footprintFrame: "body" };
const bodyProximity = proximitySafety(sim.ego, sim.path, [rearBus], true);
const envelopeProximity = proximitySafety(sim.ego, sim.path,
  [{ ...rearBus, length: 2.55, width: 12, footprintFrame: "road" }], true);
assert(bodyProximity.parkingBrake && envelopeProximity.parkingBrake,
  "Rear AEB missed the tail of a perpendicular bus still occupying the reversing corridor");
assert(Math.abs(bodyProximity.rear! - envelopeProximity.rear!) < .25,
  "Physical body and projected road envelope disagree on perpendicular rear clearance");
console.log("ACC/AEB AUDIT 2026-11-08 PASS — cross-bus footprint contracts, clear-lane control, latched stop release, latency epochs, and 16 grip/grade brake estimates.");
