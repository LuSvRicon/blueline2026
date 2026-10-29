// Headless checks for the ADAS features added beyond ACC/AEB:
//   • turn-signal-driven assisted lane change (clear + blocked paths)
//   • self-cancelling signal when the manoeuvre completes
//   • traffic-sign recognition + intelligent speed assist
//   • lane-departure warning and low-speed parking sensors

import { Simulation } from "../src/sim/Simulation.ts";

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error("ADAS-FEATURES-TEST FAIL:", message);
    failures++;
  }
}

function egoFrenet(sim: Simulation) {
  return sim.path.toFrenet(sim.ego.x, sim.ego.y);
}

// ---- assisted lane change, clear target lane ------------------------------
{
  const sim = new Simulation({ trafficCount: 0 });
  sim.traffic.cars = [];
  sim.setControlMode("adas");
  sim.ego.v = 22;
  const start = egoFrenet(sim);
  const startLane = sim.road.laneOf(start.d);
  sim.toggleIndicator(1); // right-hand signal => higher lane index
  sim.adas.config.alcHighwayOnly = false; // Explicit laboratory test of trajectory/indicator completion.
  sim.trafficLights = []; // Clear testing aisle: junctions intentionally inhibit ALC.
  let sawActive = false;
  for (let i = 0; i < 300; i++) {
    sim.step(1 / 60);
    sawActive ||= sim.adas.status.alc === "active";
  }
  const end = egoFrenet(sim);
  const endLane = sim.road.laneOf(end.d);
  if(sim.indicator!==0)console.log('Signal completion diagnostic',{d:end.d,s:end.s,v:sim.ego.v,alc:sim.adas.status.alc,reason:sim.adas.status.alcReason,target:sim.road.laneCenter(endLane)});
  assert(sawActive, "ALC never engaged for a clear adjacent lane");
  assert(endLane === startLane + 1, `ALC did not reach the target lane (${startLane} -> ${endLane})`);
  assert(sim.indicator === 0, "the turn signal was not self-cancelled after the lane change");
  console.log(`ALC clear: lane ${startLane} -> ${endLane}, signal self-cancelled`);
}

// ---- assisted lane change blocked by a vehicle in the target lane ---------
{
  const sim = new Simulation({ trafficCount: 0 });
  sim.traffic.cars = [];
  sim.setControlMode("adas");
  sim.ego.v = 22;
  const start = egoFrenet(sim);
  const startLane = sim.road.laneOf(start.d);
  sim.traffic.addTestVehicle("car", startLane - 1, start.s + 8, 22, 22);
  sim.toggleIndicator(-1); // left signal into the occupied lane
  sim.adas.config.alcHighwayOnly = false;
  sim.trafficLights = [];
  let sawBlocked = false;
  for (let i = 0; i < 180; i++) {
    sim.step(1 / 60);
    sawBlocked ||= sim.adas.status.alc === "blocked";
  }
  const end = egoFrenet(sim);
  assert(sawBlocked, "ALC did not report a blocked lane change");
  assert(sim.road.laneOf(end.d) === startLane, "ALC changed lanes despite an occupied target lane");
  console.log("ALC blocked: occupied target lane kept the car in its lane");
}

// ---- traffic-sign recognition + intelligent speed assist ------------------
{
  const sim = new Simulation({ trafficCount: 0 });
  sim.traffic.cars = [];
  sim.setControlMode("adas");
  const start = egoFrenet(sim);
  sim.roadSigns.push({ id: "test-50", s: start.s + 40, kind: "speed-limit", valueKph: 50 });
  assert(sim.nearestSpeedLimit(start.s) === 50, "TSR did not read the posted limit near the ego");
  sim.adas.config.isa = true;
  sim.setDesiredSpeed(33);
  sim.ego.v = 33;
  let minTarget = Infinity;
  let sawLimit: number | null = null;
  // Comfort-limited ISA/ACC deceleration needs more than 0.67s to shed 2m/s.
  for (let i = 0; i < 90; i++) {
    sim.step(1 / 60);
    minTarget = Math.min(minTarget, sim.telemetry.targetSpeed);
    sawLimit = sim.adas.status.tsrLimitKph ?? sawLimit;
  }
  assert(sawLimit === 50, `TSR did not report the recognised limit (${sawLimit})`);
  assert(minTarget <= 50 / 3.6 + 0.6, `ISA did not cap the target speed to the sign (${minTarget.toFixed(1)} m/s)`);
  assert(sim.ego.v < 33 - 2, `ISA did not slow the car toward the posted limit (${sim.ego.v.toFixed(1)} m/s)`);
  console.log(`TSR/ISA: limit ${sawLimit} km/h, target capped at ${minTarget.toFixed(1)} m/s`);
}

// ---- lane-departure warning ----------------------------------------------
{
  const sim = new Simulation({ trafficCount: 0 });
  sim.traffic.cars = [];
  sim.setControlMode("adas");
  sim.adas.config.laneCentering = false;
  const start = egoFrenet(sim);
  const lane = sim.road.laneOf(start.d);
  const shifted = sim.path.toCartesian(start.s, sim.road.laneCenter(lane) + sim.road.laneWidth * 0.46);
  sim.ego.x = shifted.x;
  sim.ego.y = shifted.y;
  sim.ego.yaw = sim.path.cartesianAt(start.s).heading;
  sim.ego.v = 20;
  sim.step(1 / 60);
  assert(
    sim.adas.status.laneDeparture !== "none",
    "LDW did not warn when the car drifted past the lane edge",
  );
  console.log(`LDW: warned about a ${sim.adas.status.laneDeparture} departure`);
}

// ---- parking sensors at low speed ----------------------------------------
{
  const sim = new Simulation({ trafficCount: 0 });
  sim.traffic.cars = [];
  sim.setControlMode("adas");
  sim.ego.v = 1.2;
  const start = egoFrenet(sim);
  sim.traffic.addTestVehicle("stalled", sim.road.laneOf(start.d), start.s + 6.5, 0, 0);
  let front: number | null = null;
  for (let i = 0; i < 30; i++) {
    sim.step(1 / 60);
    front = sim.adas.status.parkingFront ?? front;
  }
  assert(front !== null, "parking sensors did not detect a close obstacle");
  assert((front ?? 99) < 4, `parking sensor distance looks wrong (${front})`);
  console.log(`Parking: front sensor reads ${front?.toFixed(1)} m`);
}

if (failures > 0) {
  console.error(`\nADAS-FEATURES-TEST FAILED (${failures})`);
  process.exit(1);
}
console.log("\nADAS-FEATURES-TEST PASS — lane change, TSR/ISA, LDW and parking checks passed.");
