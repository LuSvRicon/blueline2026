// Verify the ego stays safe with degraded perception in adverse weather and
// that the planner applies progressively lower speed targets as visibility falls.

import { Simulation } from "../src/sim/Simulation.ts";
import type { Weather } from "../src/sim/Simulation.ts";

let _seed = 24680;
Math.random = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };

function fail(m: string): never {
  console.error("WEATHER-TEST FAIL:", m);
  process.exit(1);
}

const dt = 1 / 60;
function run(w: Weather): number {
  const sim = new Simulation();
  sim.setScenario("dense");
  sim.setDesiredSpeed(30);
  sim.setWeather(w);
  const L = sim.path.length;
  const halfWidth = sim.road.totalWidth / 2;
  const wrap = (a: number, b: number) => { let d = (a - b) % L; if (d < -L / 2) d += L; else if (d > L / 2) d -= L; return d; };
  let crashes = 0;
  let maxAbsD = 0;
  let sumV = 0;
  for (let i = 0; i < 3000; i++) {
    sim.step(dt);
    if (!Number.isFinite(sim.ego.v)) fail(`${w}: NaN`);
    const ef = sim.path.toFrenet(sim.ego.x, sim.ego.y);
    maxAbsD = Math.max(maxAbsD, Math.abs(ef.d));
    sumV += sim.ego.v;
    for (const c of sim.traffic.cars) {
      if (Math.abs(wrap(c.s, ef.s)) < (2.35 + c.length / 2) * 0.8 && Math.abs(c.d - ef.d) < (1.0 + c.width / 2) * 0.75) crashes++;
    }
  }
  const meanV = sumV / 3000;
  console.log(`[${w}] sensor ${sim.sensor.config.range}m | mean speed ${meanV.toFixed(1)} m/s | max|d| ${maxAbsD.toFixed(2)} | crashes ${crashes}`);
  if (crashes > 0) fail(`${w}: ${crashes} collisions`);
  if (maxAbsD > halfWidth) fail(`${w}: left the road`);
  return meanV;
}

const clear = run("clear");
const rain = run("rain");
const fog = run("fog");

function plannedSpeed(weather: Weather): number {
  const sim = new Simulation();
  sim.traffic.cars = [];
  sim.trafficLights = [];
  sim.roadSigns = [];
  sim.setDesiredSpeed(3);
  sim.setWeather(weather);
  for (let i = 0; i < 10; i++) sim.step(dt);
  return sim.planner.config.desiredSpeed;
}

const clearTarget = plannedSpeed("clear");
const rainTarget = plannedSpeed("rain");
const fogTarget = plannedSpeed("fog");
console.log(`[visibility target] clear ${clearTarget.toFixed(1)} m/s | rain ${rainTarget.toFixed(1)} m/s | fog ${fogTarget.toFixed(1)} m/s`);
if (!(rainTarget < clearTarget && fogTarget < rainTarget)) fail("weather visibility factors did not reduce the planner speed target");

// Verify ADAS stability in fog with full noisy perception:
// 1. Overtaking straight-driving adjacent trucks/cars must not trigger phantom cut-in AEB.
{
  const sim = new Simulation({ trackId: "motorway", trafficCount: 0 });
  sim.setControlMode("adas");
  sim.usePerception = true;
  sim.setWeather("fog");
  sim.traffic.cars = [];
  sim.trafficLights = [];
  sim.roadSigns = [];
  const lane1 = sim.road.laneCenter(1);
  const p0 = sim.path.toCartesian(80, lane1);
  Object.assign(sim.ego, { x: p0.x, y: p0.y, yaw: p0.heading, v: 24 });
  sim.setDesiredSpeed(24);
  sim.setAccSpeedKph(24 * 3.6);
  sim.traffic.addTestVehicle("truck", 2, 130, 16, 16);
  sim.traffic.addTestVehicle("car", 0, 165, 17, 17);
  for (let i = 0; i < 420; i++) {
    sim.step(dt);
    if (sim.adas.status.aeb) fail(`fog adjacent-lane overtake triggered phantom AEB (${sim.adas.status.aebCause})`);
  }
}

// 2. Two-way road oncoming traffic in fog must not trigger phantom forward AEB/FCW.
{
  const sim = new Simulation({ trackId: "mountain", trafficCount: 0 });
  sim.setControlMode("adas");
  sim.usePerception = true;
  sim.setWeather("fog");
  sim.traffic.cars = [];
  sim.trafficLights = [];
  sim.roadSigns = [];
  const fwdLane = sim.road.laneCenter(0);
  const oppLaneIdx = sim.road.numLanes - 1;
  const p0 = sim.path.toCartesian(80, fwdLane);
  Object.assign(sim.ego, { x: p0.x, y: p0.y, yaw: p0.heading, v: 18 });
  sim.setDesiredSpeed(18);
  sim.setAccSpeedKph(18 * 3.6);
  sim.traffic.addTestVehicle("truck", oppLaneIdx, 220, -16, -16);
  sim.traffic.addTestVehicle("car", oppLaneIdx, 310, -15, -15);
  for (let i = 0; i < 400; i++) {
    sim.step(dt);
    if (sim.adas.status.aeb || sim.adas.status.fcw) {
      fail(`fog two-way oncoming traffic triggered phantom ${sim.adas.status.aeb ? "AEB" : "FCW"}`);
    }
  }
}

// 3. BSM in fog maintains stable detection without excessive boundary chatter.
{
  const sim = new Simulation({ trackId: "motorway", trafficCount: 0 });
  sim.setControlMode("adas");
  sim.usePerception = true;
  sim.setWeather("fog");
  sim.traffic.cars = [];
  sim.trafficLights = [];
  sim.roadSigns = [];
  const lane1 = sim.road.laneCenter(1);
  const lane2 = sim.road.laneCenter(2);
  const p0 = sim.path.toCartesian(100, lane1);
  Object.assign(sim.ego, { x: p0.x, y: p0.y, yaw: p0.heading, v: 20 });
  sim.setDesiredSpeed(20);
  sim.setAccSpeedKph(20 * 3.6);
  // Place vehicle near the outer BSM boundary moving at nearly identical speed
  const adj = sim.traffic.addTestVehicle("car", 2, 97.5, 20, 20);
  let flips = 0;
  let prevBsm = false;
  for (let i = 0; i < 300; i++) {
    adj.s = sim.path.toFrenet(sim.ego.x, sim.ego.y).s - 2.5;
    adj.d = lane2 + 0.45;
    adj.v = sim.ego.v;
    sim.step(dt);
    if (i > 15 && sim.adas.status.blindSpotRight !== prevBsm) flips++;
    prevBsm = sim.adas.status.blindSpotRight;
  }
  if (flips > 2) fail(`fog BSM chattered excessively at boundary (${flips} flips)`);
}

console.log("\nWEATHER-TEST PASS — safe in rain and fog; low visibility lowers the planner target and ADAS remains stable.");
