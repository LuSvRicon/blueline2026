import assert from 'node:assert/strict';
import { ADASController, ADASFrame } from '../src/sim/ADAS.ts';
import { Simulation } from '../src/sim/Simulation.ts';

const sim = new Simulation({ trafficCount: 0 });
sim.traffic.clear(); sim.pedestrians.clear();
const s = 150, d = sim.road.laneCenter(1), pose = sim.path.toCartesian(s, d);
Object.assign(sim.ego, { x: pose.x, y: pose.y, yaw: pose.heading, v: 50 / 3.6 });
const frame = (changes: Partial<ADASFrame> = {}): ADASFrame => ({
  ego: sim.ego, egoS: s, egoD: d, road: sim.road, path: sim.path,
  obstacles: [], desiredSpeed: 25, speedLimitKph: 50,
  input: { steer: 0, throttle: .6, brake: 0 }, dt: 1 / 60,
  speedControl: error => error, ...changes,
});
const c = new ADASController();
c.config.acc = c.config.curveSpeedAssist = false;
const atLimit = c.update(frame());
assert(atLimit.accel <= 0, `ISA at 50 km/h still requested propulsion ${atLimit.accel}`);
for (let i = 0; i < 600; i++) {
  // Integrate only longitudinal motion on flat ground to isolate the limiter
  // from road curvature, traffic and the comfort cruise controller.
  const out = c.update(frame());
  sim.ego.step(0, out.accel, 1 / 60);
  assert(sim.ego.v * 3.6 <= 50.1, 'ISA oscillated above the set speed under held partial throttle');
}
assert(sim.ego.v * 3.6 > 48.5, 'ISA unnecessarily slowed far below the restriction');
assert(c.update(frame({ input: { steer: 0, throttle: 1, brake: 0 } })).accel > 0, 'Kickdown override lost');
for (const mode of ['warning', 'suggest'] as const) {
  c.config.isaMode = mode;
  assert(c.update(frame()).accel > 0, `${mode} incorrectly limited propulsion`);
}
console.log('ISA LIMIT AUDIT PASS — boundary, 10 s held throttle, kickdown, warning and suggestion.');
