import { Simulation } from "../src/sim/Simulation.ts";
import { wrapDiff } from "../src/core/math.ts";
import { bodyContact } from "../src/core/collision.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`DRIVING-SYSTEMS-TEST FAIL: ${message}`);
}

const dt = 1 / 60;

// PRND/ignition/EPB interlocks and a true reverse gear that moves against yaw.
const drive = new Simulation({ trafficCount: 0 });
drive.traffic.clear();
drive.pedestrians.clear();
drive.setControlMode("manual");
assert(!drive.setGear("R"), "must not select reverse while rolling");
assert(!drive.setGear("P"), "Park must not lock the transmission while rolling");
drive.setDriverInput({ steer: 0, throttle: 0, brake: 1 });
for (let i = 0; i < 150 && drive.ego.v > 0.45; i++) drive.step(dt);
assert(drive.ego.v <= 0.45, "foot brake did not bring the vehicle to a stop");
assert(drive.setGear("P"), "Park was rejected while stationary");
assert(drive.epbEngaged, "Park did not engage the parking brake");
assert(drive.setEngineRunning(false), "engine could not be stopped in Park");
assert(!drive.setGear("D"), "shift was allowed with the engine off");
assert(drive.setEngineRunning(true), "engine could not be started in Park");
assert(drive.setGear("R"), "reverse was rejected while stopped with engine running");
assert(drive.setParkingBrake(false), "parking brake could not be released");
const beforeReverse = drive.path.toFrenet(drive.ego.x, drive.ego.y).s;
drive.setDriverInput({ steer: 0, throttle: 0.65, brake: 0 });
for (let i = 0; i < 60; i++) drive.step(dt);
const afterReverse = drive.path.toFrenet(drive.ego.x, drive.ego.y).s;
assert(drive.ego.v > 0.5, "reverse gear did not build vehicle speed");
assert(wrapDiff(afterReverse, beforeReverse, drive.path.length) < -0.4, "reverse gear moved forward along the road");
console.log("PRND / engine / EPB: interlocks hold; reverse moves backward while the vehicle remains forward-facing");

// The ADAS brake supplements a driver's insufficient pedal pressure.
const boost = new Simulation({ trafficCount: 0 });
boost.traffic.clear();
boost.pedestrians.clear();
boost.usePerception = false;
boost.ego.v = 20;
boost.setControlMode("adas");
const pose = boost.path.toFrenet(boost.ego.x, boost.ego.y);
const lane = boost.road.laneOf(pose.d);
boost.traffic.addTestVehicle("stalled", lane, pose.s + 51.35, 0, 0);
boost.setDriverInput({ steer: 0, throttle: 0, brake: 0.3 });
boost.step(dt);
assert(boost.telemetry.adas.aeb, "AEB did not intervene while driver brake was insufficient");
assert(boost.telemetry.userBrakeForce === 0.3, "driver brake pressure was not exposed in telemetry");
assert(boost.telemetry.adasBrakeForce > 0.3, "AEB failed to add pressure above the driver's 30%");
assert(boost.telemetry.accel < -boost.ego.maxDecel * 0.3, "supplemental braking was not applied to vehicle dynamics");
console.log(`AEB pressure boost: driver 30%, assistance ${Math.round(boost.telemetry.adasBrakeForce * 100)}%, total ${Math.round(boost.telemetry.finalBrakeForce * 100)}%`);

// Reverse cross-traffic warning and Rear AEB in the actual ADAS control path.
const reverse = new Simulation({ trafficCount: 0 });
reverse.traffic.clear();
reverse.pedestrians.clear();
reverse.usePerception = false;
reverse.ego.v = 0;
reverse.setControlMode("adas");
assert(reverse.setGear("R"), "failed to select reverse for RCTA test");
const rearPose = reverse.path.toFrenet(reverse.ego.x, reverse.ego.y);
const bike = reverse.traffic.addTestVehicle("motorcycle", reverse.road.laneOf(rearPose.d), rearPose.s - 5, 0, 0);
bike.crossing = true;
bike.d = rearPose.d + 1.8;
bike.crossingToD = rearPose.d - 4;
bike.crossingSpeed = 4;
reverse.setDriverInput({ steer: 0, throttle: 1, brake: 0 });
reverse.step(dt);
assert(reverse.telemetry.rctaActive && reverse.telemetry.rctaLeft, "RCTA did not show the crossing motorcycle on the left");
assert(reverse.telemetry.rearAeb, "Rear AEB did not stop the vehicle from backing into the crossing motorcycle");
assert(reverse.ego.v < 0.1, "Rear AEB allowed reverse movement into the hazard");
reverse.ego.v = 1;
reverse.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
reverse.step(dt);
assert(reverse.telemetry.rearAeb && reverse.ego.v < 1, "Rear AEB failed to brake a vehicle already coasting in reverse");
console.log("RCTA / Rear AEB: left-side crossing motorcycle detected and reverse motion inhibited");

// Body-sized contact response must stop and separate overlapped vehicles.
const collision = new Simulation({ trafficCount: 0 });
collision.traffic.clear();
collision.pedestrians.clear();
collision.usePerception = false;
collision.ego.v = 0;
collision.setControlMode("manual");
const collisionPose = collision.path.toFrenet(collision.ego.x, collision.ego.y);
const obstacle = collision.traffic.addTestVehicle("stalled", collision.road.laneOf(collisionPose.d), collisionPose.s + 2, 0, 0);
collision.setDriverInput({ steer: 0, throttle: 1, brake: 0 });
collision.step(dt);
const resolvedPose = collision.path.toFrenet(collision.ego.x, collision.ego.y);
assert(collision.metrics.collisions > 0, "contact was not detected at body-sized overlap");
assert(collision.ego.v === 0 && obstacle.v === 0, "collision response failed to stop both vehicles");
const obstaclePose = collision.path.toCartesian(obstacle.s, obstacle.d);
assert(!bodyContact({ ...collision.ego, ...collision.ego.dims }, { x: obstaclePose.x, y: obstaclePose.y, yaw: obstaclePose.heading, length: obstacle.length, width: obstacle.width }), "collision response left rotated vehicle bodies overlapping");
console.log("Collision response: body contact detected, vehicles stopped and separated without persistent mesh overlap");

// Holding both pedals must not dilute the physical brake pressure.
for (const mode of ["manual", "adas"] as const) {
  const pedals = new Simulation({ trafficCount: 0 });
  pedals.traffic.clear(); pedals.pedestrians.clear(); pedals.setControlMode(mode);
  pedals.adas.config.acc = false;
  pedals.setDriverInput({ steer: 0, throttle: 1, brake: .5 });
  pedals.step(dt);
  assert(Math.abs(pedals.ego.a + pedals.ego.maxDecel * .5) < .01, `${mode}: throttle diluted foot braking`);
  pedals.reset();
  assert(pedals.ego.v === 0, `${mode}: reset must start a human-driven car at rest`);
}
console.log("Pedal priority: manual and ADAS without ACC preserve 50% braking while accelerator is held; human resets start at rest");

console.log("\nDRIVING-SYSTEMS-TEST PASS — PRND/EPB, reverse, brake-pressure boost, RCTA/Rear AEB and collision response.");
