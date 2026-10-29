import { ADASController, ADASFrame } from "../src/sim/ADAS.ts";
import { Simulation } from "../src/sim/Simulation.ts";
import { proximitySafety } from "../src/sim/ProximitySafety.ts";
import { Obstacle } from "../src/planner/Trajectory.ts";
function check(ok: boolean, message: string) { if (!ok) throw new Error(message); }
const sim = new Simulation({ trafficCount: 0 }); sim.traffic.clear(); sim.pedestrians.clear();
const pose = sim.path.toFrenet(sim.ego.x, sim.ego.y);
const frame = (changes: Partial<ADASFrame> = {}): ADASFrame => ({ ego: sim.ego, egoS: pose.s, egoD: pose.d, path: sim.path, road: sim.road,
  obstacles: [], desiredSpeed: 22, input: { steer: 0, throttle: 0, brake: 0 }, dt: 1 / 60, speedControl: e => e, ...changes });
const obstacle = (s: number, d = pose.d, v = 0, vd = 0): Obstacle => ({ s: pose.s + s, d, v, vd, length: 4.6, width: 1.9, kind: "car" });
sim.ego.v = 20;
const near = obstacle(25, pose.d, 20), far = obstacle(35);
const a = new ADASController().update(frame({ obstacles: [near, far] }));
const b = new ADASController().update(frame({ obstacles: [far, near] }));
check(a.status.aeb && a.status.aeb === b.status.aeb && a.status.fcwLevel === b.status.fcwLevel && a.accel === b.accel, "AEB/FCW changed with array order");
const distantA = new ADASController().update(frame({ obstacles: [near, obstacle(50)] }));
const distantB = new ADASController().update(frame({ obstacles: [obstacle(50), near] }));
check(!distantA.status.aeb && distantA.status.aeb === distantB.status.aeb && distantA.status.fcwLevel === distantB.status.fcwLevel, "distant warning incorrectly became emergency braking");
for (const side of [-1, 1]) {
  const o = obstacle(-5, pose.d + side * 3, 0, -side * 1);
  const p = proximitySafety(sim.ego, sim.path, [o], true);
  check(side < 0 ? p.rctaLeft && !p.rctaRight : p.rctaRight && !p.rctaLeft, "RCTA direction mismatch");
  const away = proximitySafety(sim.ego, sim.path, [{ ...o, vd: side * 1 }], true);
  check(!away.rctaLeft && !away.rctaRight, "RCTA warned about outward traffic");
}
const rear = proximitySafety(sim.ego, sim.path, [obstacle(-5.5)], true);
check(rear.rearAeb && !rear.rctaLeft && !rear.rctaRight, "static Rear AEB confused with RCTA");
sim.ego.v = 0;
const stopped = new ADASController().update(frame({ obstacles: [obstacle(10)] }));
check(!stopped.status.aeb && stopped.status.adasBrakeForce === 0, "fresh standstill falsely triggered AEB");
sim.ego.v = 20;
const controller = new ADASController();
let firstActiveSteer: number | null = null;
for (let i = 0; i < 40; i++) { const o = controller.update(frame({ indicator: 1 })); if (o.status.alc === "active" && firstActiveSteer === null) firstActiveSteer = o.steer; }
check(controller.status.alc === "active", "clear ALC did not arm");
const baselineSteer = new ADASController().update(frame()).steer;
check(firstActiveSteer !== null && Math.abs(firstActiveSteer - baselineSteer) < .02, "ALC snapped to adjacent lane with an abrupt initial steering demand");
const overridden = controller.update(frame({ indicator: 1, input: { steer: -1, throttle: 0, brake: 0 } }));
check(overridden.status.alcAborted && overridden.steer < -.5, "ALC failed to yield to driver");
check(controller.update(frame({ indicator: 1 })).status.alc !== "active", "ALC rearmed without a new signal after takeover");
const timeout = new ADASController(); let timedOut = false;
for (let i = 0; i < 650; i++) { const o = timeout.update(frame({ indicator: 1 })); timedOut ||= o.status.alcAborted && !o.status.alcComplete; }
check(timedOut, "ALC timeout was not an abort");
const fastRear = new ADASController();
for (let i = 0; i < 50; i++) fastRear.update(frame({ indicator: 1, obstacles: [obstacle(-70, pose.d + sim.road.laneWidth, 42)] }));
check(fastRear.status.alc === "blocked", "ALC ignored fast rear approach beyond static zone");
const ldw = new ADASController(); ldw.config.alc = false;
check(ldw.update(frame({ egoD: pose.d + sim.road.laneWidth * .45, indicator: 1 })).status.laneDeparture === "none", "LDW ignored intended lane change");
check(ldw.update(frame({ egoD: pose.d + sim.road.laneWidth * .45, indicator: -1 })).status.laneDeparture === "right", "opposite signal suppressed LDW");
const cruise = new ADASController();
check(!cruise.update(frame({ input: { steer: 0, throttle: 0, brake: .3 } })).status.accActive, "brake did not cancel ACC");
check(!cruise.update(frame()).status.accActive, "ACC silently reengaged after brake");
cruise.resumeCruise(); check(cruise.update(frame()).status.accActive, "ACC RES failed");
const degraded = cruise.update(frame({ sensorsAvailable: false, obstacles: [obstacle(10)] }));
check(degraded.status.takeoverRequired && !degraded.status.accActive && !degraded.status.aeb && !degraded.status.laneCenteringActive, "sensor fault was concealed");
check(!cruise.update(frame({ laneConfidence: .1 })).status.laneCenteringActive, "LKA steered without lane confidence");
const accBrake = new ADASController().update(frame({ desiredSpeed: 5 }));
check(accBrake.accel < 0 && accBrake.status.adasBrakeForce > 0 && !accBrake.status.aeb, "ACC braking was missing from pressure meter");
const isa = new ADASController(); isa.config.acc = false;
const limited = isa.update(frame({ speedLimitKph: 50, input: { steer: 0, throttle: .6, brake: 0 } }));
check(limited.accel < 0 && limited.status.adasBrakeForce > 0 && !limited.status.isaOverride, "ISA did not limit manual throttle with ACC off");
const kickdown = isa.update(frame({ speedLimitKph: 50, input: { steer: 0, throttle: 1, brake: 0 } }));
check(kickdown.status.isaOverride && kickdown.accel > 0, "ISA full-pedal override was not explicit");
check(isa.update(frame({ speedLimitKph: 50, input: { steer: 0, throttle: 1, brake: 0 }, obstacles: [obstacle(12)] })).accel < -6, "ISA override bypassed AEB");
sim.traffic.addTestVehicle("stalled", sim.road.laneOf(pose.d), pose.s + 10, 0, 0);
sim.sensor.config.dropout = 1; sim.tracker.reset(); sim.tracks = [];
check((sim as any).obstacles().length === 0, "zero sensor tracks silently fell back to ground truth");
// Integrated stationary Rear AEB, with pedal-misapplication protection disabled
// to ensure it is specifically the rear brake that prevents the contact.
const reversing = new Simulation({ trafficCount: 0 }); reversing.traffic.clear(); reversing.pedestrians.clear(); reversing.usePerception = false;
reversing.setControlMode("adas"); reversing.adas.config.pedalMitigation = false; reversing.ego.v = 0; reversing.setGear("R");
const rf = reversing.path.toFrenet(reversing.ego.x, reversing.ego.y);
reversing.traffic.addTestVehicle("stalled", reversing.road.laneOf(rf.d), rf.s - 9, 0, 0);
let rearBraked = false;
for (let i = 0; i < 360; i++) { reversing.setDriverInput({ steer: 0, throttle: 1, brake: 0 }); reversing.step(1 / 60); rearBraked ||= reversing.telemetry.rearAeb; }
check(rearBraked && reversing.metrics.collisions === 0 && reversing.ego.v === 0, "Rear AEB failed physical stop against stationary rear obstacle");
console.log("ADAS regression: order invariance, RCTA directions, stationary rear brake, ALC override/timeout/rear prediction, LDW, ACC cancel/resume and degradation PASS");
