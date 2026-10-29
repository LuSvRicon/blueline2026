// Headless checks for Manual Drive and the simulation-only ADAS assist models.

import { ADASController, ADASFrame } from "../src/sim/ADAS.ts";
import { Simulation } from "../src/sim/Simulation.ts";
import { clamp } from "../src/core/math.ts";
import { Obstacle } from "../src/planner/Trajectory.ts";

function fail(message: string): never {
  console.error("ADAS-TEST FAIL:", message);
  process.exit(1);
}

function assert(condition: boolean, message: string): void {
  if (!condition) fail(message);
}

const sim = new Simulation();
sim.traffic.cars = [];
sim.setControlMode("manual");
const initialSpeed = sim.ego.v;
sim.setDriverInput({ steer: 0.35, throttle: 1, brake: 0 });
for (let i = 0; i < 60; i++) sim.step(1 / 60);
assert(sim.ego.v > initialSpeed + 2, "manual throttle did not accelerate the vehicle");
assert(sim.ego.delta > 0, "manual steering input was not applied");
assert(Math.abs(sim.ego.yaw) > 0.1, "manual steering did not change vehicle heading");
console.log(`manual: speed ${initialSpeed.toFixed(1)} -> ${sim.ego.v.toFixed(1)} m/s, steering applied`);

const assistSim = new Simulation();
assistSim.traffic.cars = [];
const ego = assistSim.ego;
const egoPose = assistSim.path.toFrenet(ego.x, ego.y);
const lane = assistSim.road.laneOf(egoPose.d);
const laneCenter = assistSim.road.laneCenter(lane);
const offsetPose = assistSim.path.toCartesian(egoPose.s, laneCenter + 1.0);
const offsetHeading = assistSim.path.cartesianAt(egoPose.s).heading;
ego.x = offsetPose.x;
ego.y = offsetPose.y;
ego.yaw = offsetHeading;

const adas = new ADASController();
const zeroInput = { steer: 0, throttle: 0, brake: 0 };
const speedControl = (error: number) => clamp(error * 1.2, -ego.maxDecel, ego.maxAccel);
function makeFrame(obstacles: Obstacle[], desiredSpeed = 26): ADASFrame {
  const f = assistSim.path.toFrenet(ego.x, ego.y);
  return {
    ego,
    egoS: f.s,
    egoD: f.d,
    path: assistSim.path,
    road: assistSim.road,
    obstacles,
    desiredSpeed,
    input: zeroInput,
    dt: 1 / 60,
    speedControl,
  };
}

const centered = adas.update(makeFrame([]));
assert(centered.steer < 0, "lane centering did not steer back toward the lane center");
console.log("lane centering: applies a correction toward the lane center");

const lead: Obstacle = {
  s: egoPose.s + 35,
  d: egoPose.d,
  v: 5,
  vd: 0,
  length: 4.5,
  width: 1.9,
  kind: "car",
};
const following = adas.update(makeFrame([lead], 26));
assert(following.targetSpeed < 26, "ACC did not reduce its target speed behind a slower lead vehicle");
console.log(`ACC: target ${following.targetSpeed.toFixed(1)} m/s behind a slower lead vehicle`);

const closeLead = { ...lead, s: egoPose.s + 10, v: 0 };
const braking = adas.update(makeFrame([closeLead]));
assert(braking.status.fcw, "FCW did not warn about an imminent lead-vehicle conflict");
assert(braking.status.aeb, "AEB did not trigger for an imminent lead-vehicle conflict");
assert(braking.accel <= -ego.maxDecel, "AEB did not request maximum simulated braking");
console.log("FCW/AEB: warning and emergency brake triggered for an imminent conflict");

const leftBlindSpot = {
  ...lead,
  s: egoPose.s - 5,
  d: egoPose.d - assistSim.road.laneWidth,
  v: ego.v,
};
const blindSpot = adas.update(makeFrame([leftBlindSpot]));
assert(blindSpot.status.blindSpotLeft, "BSM did not detect a vehicle in the left rear blind spot");
console.log("BSM: left rear blind-spot vehicle detected");

const integrated = new Simulation();
integrated.traffic.cars = [];
integrated.usePerception = false;
for (let i = 0; i < 10; i++) integrated.step(1 / 60);
const integratedPose = integrated.path.toFrenet(integrated.ego.x, integrated.ego.y);
const integratedLane = integrated.road.laneOf(integratedPose.d);
integrated.traffic.cars.push({
  id: 999,
  s: integratedPose.s + 12,
  d: integratedPose.d,
  v: 0,
  lane: integratedLane,
  desiredSpeed: 0,
  length: 4.6,
  width: 1.95,
  changeCooldown: 99,
  hue: 0,
  kind: "stalled",
  cutInTimer: 0,
  cutInLane: integratedLane,
});
integrated.setControlMode("adas");
for (let i = 0; i < 20; i++) integrated.step(1 / 60);
assert(integrated.telemetry.adas.aeb, "Simulation ADAS mode did not trigger AEB from a perceived obstacle");
assert(integrated.telemetry.accel <= -integrated.ego.maxDecel, "Simulation ADAS mode did not apply its brake command");
console.log("simulation integration: ADAS mode applied AEB against a stopped vehicle");

console.log("\nADAS-TEST PASS — manual inputs and simulated assistance checks passed.");
