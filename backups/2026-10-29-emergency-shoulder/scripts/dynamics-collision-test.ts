import assert from "node:assert/strict";
import { bodyContact, sweepBodies, Body2D } from "../src/core/collision.ts";
import { Simulation } from "../src/sim/Simulation.ts";
import { Vehicle } from "../src/vehicle/Vehicle.ts";
import { wrapDiff } from "../src/core/math.ts";

const box = (x: number, y: number, yaw = 0): Body2D => ({ x, y, yaw, length: 4.7, width: 2 });
const hit = sweepBodies(box(-20, 0), box(20, 0), box(0, 0), box(0, 0));
assert(hit && hit.time > .3 && hit.time < .5, "fast car must contact between non-overlapping endpoints");
const crossing = sweepBodies(box(0, 0), box(0, 0), box(0, -15, Math.PI / 2), box(0, 15, Math.PI / 2));
assert(crossing, "perpendicular sweep must detect a crossing vehicle");
assert(!bodyContact(box(0, 0), box(0, 3.7)), "adjacent parallel lanes must remain clear");
assert(bodyContact(box(0, 0, Math.PI / 4), box(0, 2.4)), "rotated body corners must count");
assert(!sweepBodies(box(-4.725, 0), box(-6, 0), box(0, 0), box(0, 0)), "separating bodies must not create a new impact");

const sim = new Simulation({ trafficCount: 0 });
sim.traffic.clear(); sim.pedestrians.clear(); sim.setControlMode("manual");
sim.ego.v = 12;
assert(sim.setGear("N"), "N should be selectable while rolling");
const beforeN = sim.path.toFrenet(sim.ego.x, sim.ego.y).s;
sim.setDriverInput({ steer: 0, throttle: 1, brake: 0 });
sim.step(1 / 60);
assert(sim.ego.v > 11.9 && sim.ego.v < 12, "N should coast without propulsion or an instant stop");
assert(wrapDiff(sim.path.toFrenet(sim.ego.x, sim.ego.y).s, beforeN, sim.path.length) > 0, "forward momentum must persist");
assert(!sim.setGear("R") && !sim.setGear("P"), "reverse and Park must stay interlocked");
sim.ego.v = 0; assert(sim.setGear("R")); sim.ego.v = 2; assert(sim.setGear("N"));
const beforeR = sim.path.toFrenet(sim.ego.x, sim.ego.y).s;
sim.step(1 / 60);
assert(wrapDiff(sim.path.toFrenet(sim.ego.x, sim.ego.y).s, beforeR, sim.path.length) < 0, "N must preserve reverse momentum");
sim.setDriverInput({ steer: 0, throttle: 0, brake: 1 });
for (let i = 0; i < 60; i++) sim.step(1 / 60);
assert.equal(sim.ego.v, 0, "foot brake must stop neutral coasting");

const cross = new Simulation({ trafficCount: 0 });
cross.traffic.clear(); cross.pedestrians.clear(); cross.setControlMode("manual"); cross.ego.v = 0;
const pose = cross.path.toFrenet(cross.ego.x, cross.ego.y);
const actor = cross.traffic.addCrossingVehicle("car", pose.s, 64);
actor.d = -8; actor.crossingToD = 8;
cross.step(.25);
assert.equal(cross.metrics.collisions, 1, "cross-traffic cannot tunnel through a stationary car during a long step");
assert(actor.disabled && cross.traffic.cars.includes(actor), "contact must stop and retain the crossing actor");
const contact = cross.path.toCartesian(actor.s, actor.d);
assert(!bodyContact({ ...cross.ego, ...cross.ego.dims }, { ...box(contact.x, contact.y, contact.heading + Math.PI / 2), length: actor.length, width: actor.width }), "crossing response must separate oriented bodies");

const wet = new Vehicle(0, 0, 0, 25); wet.surfaceMu = .72; wet.limitLateralGrip = true;
for(let i=0;i<15;i++)wet.step(.5, -7, 1 / 60);
assert(wet.tractionLimited, "high-speed wet cornering must hit the grip limit");
assert(Math.abs(wet.a + 7 * .72) < .001, "telemetry should expose applied wet braking");
assert(Math.hypot(wet.a, wet.lateralAccel) <= .72 * 9.81 + .01, "combined forces must stay within the simplified friction circle");
const chain = new Simulation({trafficCount:0}); chain.traffic.clear(); chain.setControlMode("manual"); chain.ego.v=0;
const initial = chain.path.toFrenet(chain.ego.x,chain.ego.y), centre = chain.road.laneOf(initial.d);
chain.traffic.addTestVehicle("stalled",centre,initial.s+2,0,0);
chain.traffic.addTestVehicle("stalled",centre+1,initial.s,0,0);
chain.step(1/60);
for(const car of chain.traffic.cars){const w=chain.path.toCartesian(car.s,car.d);assert(!bodyContact({...chain.ego,...chain.ego.dims},{x:w.x,y:w.y,yaw:w.heading,length:car.length,width:car.width}),"multiple injected overlaps must not oscillate forever");}
console.log("DYNAMICS-COLLISION PASS — continuous/rotated contact, neutral in both directions, braking, crossing tunneling and wet grip.");
