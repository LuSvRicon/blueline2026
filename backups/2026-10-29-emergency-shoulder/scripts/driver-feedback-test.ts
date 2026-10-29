import assert from "node:assert/strict";
import * as THREE from "three";
import { Simulation } from "../src/sim/Simulation.ts";
import { ADASController, ADASFrame } from "../src/sim/ADAS.ts";
import { TrafficLight } from "../src/world/TrafficLight.ts";
import { TrafficLightView } from "../src/render/TrafficLightView.ts";
import { indicatorOn, laneChangeIndicator } from "../src/vehicle/Signals.ts";
import { Sensor } from "../src/perception/Sensor.ts";
import { Tracker } from "../src/perception/Tracker.ts";

const dt = 1 / 60;
function emptyDrive(speed = 10): Simulation {
  const sim = new Simulation({ trafficCount: 0 }); sim.setControlMode("adas");
  sim.traffic.clear(); sim.pedestrians.clear(); sim.trafficLights = []; sim.roadSigns = [];
  sim.usePerception = false;
  const w = sim.path.toCartesian(150, 0);
  Object.assign(sim.ego, { x: w.x, y: w.y, yaw: w.heading, v: speed });
  sim.setAccSpeedKph(72); return sim;
}

// Rendered lamps must read NEW signal objects after a reset at identical stations.
{
  const sim = emptyDrive(); const view = new TrafficLightView(sim.path, sim.road.totalWidth / 2);
  const first = new TrafficLight(190, { green: 5, yellow: 2, red: 5 }); view.update([first]);
  const green = view.group.getObjectByName("signal-green") as THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  const red = view.group.getObjectByName("signal-red") as THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  assert(green.material.emissiveIntensity > 1 && red.material.emissiveIntensity < .1);
  const replacement = new TrafficLight(190, { green: 5, yellow: 2, red: 5, offset: 8 }); view.update([replacement]);
  assert.equal(view.group.getObjectByName("signal-red"), red, "same geometry should be reused");
  assert(red.material.emissiveIntensity > 1 && green.material.emissiveIntensity < .1, "render used frozen old phase after reset");
  replacement.restoreTime(0); view.update([replacement]); assert(green.material.emissiveIntensity > 1);
}

// Actual ACC/TLA dynamics: stop BEFORE the painted line, hold, then leave on green.
{
  const sim = emptyDrive(10); sim.setAccSpeedKph(36);
  const light = new TrafficLight(195, { green: 1000, yellow: 1000, red: 1000, offset: 2000 }); sim.trafficLights = [light];
  for (let i = 0; i < 14 * 60; i++) sim.step(dt);
  const f = sim.path.toFrenet(sim.ego.x, sim.ego.y);
  const frontGap = light.s - 1.2 - f.s - sim.ego.dims.length / 2;
  console.log(`red stop: ${sim.ego.v.toFixed(2)}m/s, bumper ${frontGap.toFixed(2)}m before paint`);
  assert(sim.ego.v < .1 && frontGap > .1 && frontGap < 2, "wrong red stop location");
  assert(sim.adas.status.trafficLightStopping && sim.adas.status.brakeReason === "signal");
  light.restoreTime(0);
  for (let i = 0; i < 2 * 60; i++) sim.step(dt);
  assert(sim.ego.v > 1 && !sim.adas.status.trafficLightStopping, "ACC remained stopped at a clear green signal");
}

// Yellow decision is made once, from available comfortable stopping distance.
{
  const sim = emptyDrive(15), f = sim.path.toFrenet(sim.ego.x, sim.ego.y);
  const frame: ADASFrame = { ego: sim.ego, egoS: f.s, egoD: f.d, path: sim.path, road: sim.road, obstacles: [], desiredSpeed: 15,
    input: { steer: 0, throttle: 0, brake: 0 }, dt, speedControl: e => e };
  const close = new ADASController();
  assert(!close.update({ ...frame, trafficLight: { id: 1, state: "yellow", distance: 15 } }).status.trafficLightStopping, "hard stop in yellow dilemma zone");
  const far = new ADASController();
  assert(far.update({ ...frame, trafficLight: { id: 2, state: "yellow", distance: 80 } }).status.trafficLightStopping);
  assert(far.update({ ...frame, trafficLight: { id: 2, state: "yellow", distance: 10 } }).status.trafficLightStopping, "yellow decision oscillated while approaching");
  assert(!far.update({ ...frame, trafficLight: { id: 2, state: "green", distance: 10 } }).status.trafficLightStopping);
}

// A far slow lead calls for smooth following, not instant emergency pressure.
{
  const sim = emptyDrive(20);
  const lead = sim.traffic.addTestVehicle("car", 1, 260, 5, 5); lead.changeCooldown = 99;
  let maxDecel = 0, aeb = false, maxJerk = 0, previousAccel = 0;
  for (let i = 0; i < 10 * 60; i++) {
    sim.step(dt); maxDecel = Math.max(maxDecel, -sim.ego.a); aeb ||= sim.adas.status.aeb;
    maxJerk = Math.max(maxJerk, Math.abs(sim.ego.a - previousAccel) / dt); previousAccel = sim.ego.a;
  }
  console.log(`ACC slow lead: peak decel ${maxDecel.toFixed(2)}m/s², jerk ${maxJerk.toFixed(2)}m/s³, AEB=${aeb}`);
  assert(!aeb && maxDecel <= 2.81 && maxJerk <= 2.51 && sim.metrics.collisions === 0, "ACC braking was abrupt or emergency became necessary from a comfortable setup");
}

// Driver brake cancels propulsion immediately and remains cancelled after release.
{
  const sim = emptyDrive(14); sim.setAccSpeedKph(85);
  sim.setDriverInput({ steer: 0, throttle: 1, brake: 1 });
  assert(!sim.engageAcc(), "RES accepted while brake held"); sim.step(dt);
  assert(!sim.adas.status.accActive && sim.ego.a < -6.9);
  for (let i = 0; i < 150; i++) sim.step(dt);
  sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
  for (let i = 0; i < 120; i++) sim.step(dt);
  assert.equal(sim.ego.v, 0); assert.equal(sim.adas.status.accState, "cancelled");
  assert.equal(Math.round(sim.accSetSpeedKph), 85, "brake erased remembered speed");
  sim.setAccSpeedKph(95); sim.step(dt); assert.equal(sim.ego.v, 0, "editing speed silently resumed ACC");
  assert(sim.engageAcc()); for (let i = 0; i < 120; i++) sim.step(dt);
  assert(sim.ego.v > 1 && sim.adas.status.accActive);
}

// User-selected time gap changes the actual following response.
{
  const settledGaps: number[] = [];
  for (const gap of [1, 3]) {
    const sim = emptyDrive(10); sim.setAccSpeedKph(46.8); sim.adas.config.timeGap = gap;
    const car = sim.traffic.addTestVehicle("car", 1, 190, 10, 10); car.changeCooldown = 99;
    for (let i = 0; i < 15 * 60; i++) sim.step(dt);
    const pose = sim.path.toFrenet(sim.ego.x, sim.ego.y);
    settledGaps.push(car.s - pose.s - (car.length + sim.ego.dims.length) / 2);
    assert.equal(sim.metrics.collisions, 0);
  }
  console.log(`ACC gaps near/far: ${settledGaps.map(d => d.toFixed(1)).join(" / ")}m`);
  assert(settledGaps[1] > settledGaps[0] + 8, "gap setting did not change physical following distance");
}

// Same-direction traffic never starts with a zero-speed measurement in radar mode.
{
  const sensor = new Sensor({ dropout: 0, posNoise: .35, velocityNoise: .25 }); const tracker = new Tracker();
  const detections = sensor.sense(0, 0, [{ x: 30, y: 3.7, vx: 20, vy: 0, length: 4.6, width: 1.9, kind: "car" }]);
  tracker.update(detections, dt);
  assert(Math.abs(tracker.tracks[0].vx - 20) < 1, "new moving track was treated as parked");
  for (const lane of [1, 2]) {
    const sim = emptyDrive(20); sim.usePerception = true;
    const car = sim.traffic.addTestVehicle("car", lane, 170, 20, 20); car.changeCooldown = 99;
    for (let i = 0; i < 12; i++) { sim.step(dt); assert(!sim.adas.status.aeb, "fresh same-speed or adjacent-lane radar track caused phantom AEB"); }
  }
}

// Indicators cancel after manual lane settling and reverse ALC requests cancel.
{
  const sim = emptyDrive(8); sim.setControlMode("manual"); sim.toggleIndicator(1);
  const w = sim.path.toCartesian(150, sim.road.laneCenter(2)); Object.assign(sim.ego, { x: w.x, y: w.y, yaw: w.heading });
  for (let i = 0; i < 20; i++) sim.step(dt); assert.equal(sim.indicator, 0, "manual lane-change signal did not self-cancel");
  assert.equal(laneChangeIndicator(2), 1); assert.equal(laneChangeIndicator(-2), -1);
  assert(indicatorOn(0) && !indicatorOn(.39) && indicatorOn(.78), "indicator relay phases disagree");
  const controller = new ADASController(); const f = sim.path.toFrenet(sim.ego.x, sim.ego.y);
  controller.config.alcHighwayOnly = false; // Low-speed laboratory fixture tests signal cancellation, not the road domain.
  const frame: ADASFrame = { ego: sim.ego, egoS: f.s, egoD: 0, path: sim.path, road: sim.road, obstacles: [], desiredSpeed: 15,
    input: { steer: 0, throttle: 0, brake: 0 }, dt, speedControl: e => e, indicator: 1 };
  for (let i = 0; i < 40; i++) controller.update(frame);
  assert.equal(controller.status.alc, "active");
  const switched = controller.update({ ...frame, indicator: -1 });
  assert(switched.status.alcAborted && switched.status.alcTargetLane === null, "ALC continued toward old signal direction");
}
console.log("DRIVER-FEEDBACK PASS — light reset/render, red/green/yellow, brake cancellation, speed/gap, smooth ACC, radar velocity and signals");
