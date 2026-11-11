import assert from 'node:assert/strict';
import { ADASController, type ADASFrame } from '../src/sim/ADAS.ts';
import { Simulation } from '../src/sim/Simulation.ts';
import type { Obstacle } from '../src/planner/Trajectory.ts';

const dt = 1 / 60;
const failures: string[] = [];
let checks = 0;
function check(condition: unknown, message: string) {
  checks++;
  if (!condition) failures.push(message);
}
const sim = new Simulation({ trackId: 'motorway', trafficCount: 0 });
const { ego, road, path } = sim;
function position(s = 500, d = road.laneCenter(1), speed = 20) {
  const p = path.toCartesian(s, d);
  Object.assign(ego, { x: p.x, y: p.y, yaw: p.heading, v: speed, a: 0, delta: 0 });
}
position();
function frame(overrides: Partial<ADASFrame> = {}): ADASFrame {
  const p = path.toFrenet(ego.x, ego.y);
  return { ego, egoS: p.s, egoD: p.d, path, road, obstacles: [], desiredSpeed: 20,
    input: { steer: 0, throttle: 0, brake: 0 }, speedControl: e => e, dt, ...overrides };
}
function vehicle(ds: number, side: -1 | 1, length: number, speed = ego.v, lateral?: number): Obstacle {
  const f = frame();
  return { s: f.egoS + ds, d: f.egoD + side * (lateral ?? road.laneWidth),
    length, width: 2.3, v: speed, vd: 0, kind: 'car', confirmed: true };
}

// The blind spot is a physical region, not a window on vehicle centres.
// A bus/container may have its cabin well ahead while its body still overlaps.
for (const side of [-1, 1] as const) {
  for (const [length, ds] of [[4.6, 0], [12, 7.5], [18, 10.5], [18, -11.5]]) {
    const c = new ADASController();
    const out = c.update(frame({ obstacles: [vehicle(ds, side, length)] }));
    check(side < 0 ? out.status.blindSpotLeft : out.status.blindSpotRight,
      `BSM missed ${length}m vehicle on ${side < 0 ? 'left' : 'right'}, centre ds=${ds}m although its body overlaps ego`);
  }
  const passing = new ADASController();
  check(passing.update(frame({ obstacles: [vehicle(-6, side, 18, 10)] })).status[side < 0 ? 'blindSpotLeft' : 'blindSpotRight'],
    'BSM suppressed a slower long truck before its front cleared ego rear bumper');
  const passed = new ADASController();
  check(!passed.update(frame({ obstacles: [vehicle(-15, side, 18, 10)] })).status[side < 0 ? 'blindSpotLeft' : 'blindSpotRight'],
    'BSM retained a receding long truck after its front cleared ego rear bumper');
  const c = new ADASController();
  check(!c.update(frame({ obstacles: [vehicle(30, side, 18)] })).status[side < 0 ? 'blindSpotLeft' : 'blindSpotRight'],
    'BSM retained a truck that has completely cleared the region ahead');
  check(!new ADASController().update(frame({ obstacles: [vehicle(-40, side, 18, 15)] })).status[side < 0 ? 'blindSpotLeft' : 'blindSpotRight'],
    'BSM warned about a distant receding truck');
  check(!new ADASController().update(frame({ obstacles: [vehicle(0, side, 12, -20)] })).status[side < 0 ? 'blindSpotLeft' : 'blindSpotRight'],
    'BSM warned about oncoming traffic');
  check(!new ADASController().update(frame({ sensorAvailability: { rearRadar: false }, obstacles: [vehicle(0, side, 12)] })).status[side < 0 ? 'blindSpotLeft' : 'blindSpotRight'],
    'BSM ignored rear-radar fault');
  check(!new ADASController({ bsm: false }).update(frame({ obstacles: [vehicle(0, side, 12)] })).status[side < 0 ? 'blindSpotLeft' : 'blindSpotRight'],
    'BSM ignored its off switch');
}

// Explicit switches, lane confidence and driver torque must remove lateral
// steering authority, rather than only changing the displayed lamp.
for (const kph of [5, 60, 130, 180]) {
  position(500, road.laneCenter(1) + .35, kph / 3.6);
  for (const steer of [-.2, .2]) {
    const raw = steer * ego.maxSteer;
    const disabled = new ADASController({ laneCentering: false, laneKeeping: false, alc: false });
    check(Math.abs(disabled.update(frame({ input: { steer, throttle: 0, brake: 0 } })).steer - raw) < 1e-10,
      `Lateral switches off changed manual steering at ${kph}km/h`);
    const fault = new ADASController();
    const out = fault.update(frame({ sensorAvailability: { camera: false }, input: { steer, throttle: 0, brake: 0 } }));
    check(Math.abs(out.steer - raw) < 1e-10 && !out.status.laneCenteringActive,
      `Camera fault retained LFA authority at ${kph}km/h`);
    const torque = new ADASController();
    const overtaken = torque.update(frame({ input: { steer, steeringOverride: true, throttle: 0, brake: 0 } }));
    check(Math.abs(overtaken.steer - raw) < 1e-10 && !overtaken.status.laneCenteringActive,
      `LFA opposed driver torque at ${kph}km/h`);
  }
  const uncertain = new ADASController();
  check(!uncertain.update(frame({ laneConfidence: .59 })).status.laneCenteringActive,
    `Low-confidence lane enabled LFA at ${kph}km/h`);
}

// ALC must cancel when perception is lost, must not automatically restart the
// aborted manoeuvre, and must accept a fresh, explicit signal afterward.
position();
for (const fault of [{ sensorAvailability: { camera: false } }, { sensorAvailability: { rearRadar: false } }, { laneConfidence: .2 }]) {
  const c = new ADASController();
  for (let i = 0; i < 40; i++) c.update(frame({ indicator: 1 }));
  check(c.status.alc === 'active', 'Empty-lane ALC did not reach active state');
  const out = c.update(frame({ indicator: 1, ...fault }));
  check(out.status.alcAborted && out.status.alc !== 'active', 'ALC did not abort on lane/radar fault');
  for (let i = 0; i < 40; i++) c.update(frame({ indicator: 1 }));
  check(c.status.alc === 'blocked', 'ALC silently restarted after fault without fresh intent');
  c.update(frame({ indicator: 0 }));
  for (let i = 0; i < 40; i++) c.update(frame({ indicator: 1 }));
  check(c.status.alc === 'active', 'Fresh signal could not rearm ALC after sensor recovery');
}

// Speed recognition/limiting loses authority with the camera; warning and
// suggestion-only modes do not add a hidden brake demand.
position(500, road.laneCenter(1), 20);
for (const mode of ['warning', 'suggest'] as const) {
  const c = new ADASController({ acc: false, isaMode: mode });
  const out = c.update(frame({ speedLimitKph: 50, input: { steer: 0, throttle: .5, brake: 0 } }));
  check(out.accel > 0 && out.status.adasBrakeForce === 0, `${mode} ISA applied the brake`);
  check(c.getSetSpeed(20) === 20, `${mode} ISA changed the chosen set speed without consent`);
}
const noCamera = new ADASController({ acc: false });
const lostSign = noCamera.update(frame({ sensorAvailability: { camera: false }, speedLimitKph: 50,
  input: { steer: 0, throttle: .5, brake: 0 } }));
check(lostSign.status.tsrLimitKph === null && !lostSign.status.speedLimited && lostSign.accel > 0,
  'Camera loss left synthetic TSR/ISA authority active');

// A passed sign still governs the road segment after it leaves the camera
// window. Loss of camera does not erase a previously read limit from memory.
{
  const c = new ADASController({ acc: false });
  const input = { steer: 0, throttle: .5, brake: 0 };
  check(c.update(frame({ speedLimitKph: 50, input })).status.tsrNew, 'TSR did not mark a newly observed limit');
  const passed = c.update(frame({ speedLimitKph: null, input }));
  check(passed.status.tsrLimitKph === 50 && passed.status.speedLimited && passed.accel <= 0,
    'ISA forgot the active 50km/h restriction once the sign left view');
  check(!passed.status.tsrNew, 'TSR repeated the new-sign event when only remembering a passed sign');
  const lost = c.update(frame({ sensorAvailability: { camera: false }, speedLimitKph: null, input }));
  check(lost.status.tsrLimitKph === null && !lost.status.speedLimited, 'TSR claimed fresh visibility during camera failure');
  const recovered = c.update(frame({ speedLimitKph: null, input }));
  check(recovered.status.tsrLimitKph === 50 && recovered.status.speedLimited,
    'TSR discarded the remembered restriction during a transient camera outage');
  const replacement = c.update(frame({ speedLimitKph: 80, input }));
  check(replacement.status.tsrLimitKph === 80 && replacement.status.tsrNew && !replacement.status.speedLimited,
    'TSR did not replace the old limit when a new sign was observed');
  const recorded = new ADASController();
  recorded.restoreState(c.captureState(), c.status);
  check(recorded.update(frame({ speedLimitKph: null, input })).status.tsrLimitKph === 80,
    'Record/replay lost remembered TSR limit');
  c.config.tsr = false; c.update(frame({ speedLimitKph: null, input }));
  c.config.tsr = true;
  check(c.update(frame({ speedLimitKph: null, input })).status.tsrLimitKph === null,
    'TSR off/on resurrected stale sign memory');
  c.update(frame({ speedLimitKph: 30, input })); c.clearStatus();
  check(c.update(frame({ speedLimitKph: null, input })).status.tsrLimitKph === null,
    'Reset inherited a speed sign from an old driving session');
}

// Equivalent scene data must produce the same recognized sign regardless of
// object insertion order. The closest sign anchors the 45m zone association;
// a chain of intermediate signs cannot extend that association indefinitely.
{
  const signs = [
    { id: 'current', s: 150, kind: 'speed-limit' as const, valueKph: 60 },
    { id: 'near-zone', s: 190, kind: 'speed-limit' as const, valueKph: 40 },
    { id: 'later-zone', s: 230, kind: 'speed-limit' as const, valueKph: 30 },
  ];
  for (const order of [[0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0]]) {
    sim.roadSigns = order.map(i => signs[i]);
    check(sim.nearestSpeedLimit(150) === 40, `TSR zone association changed with sign insertion order ${order.join(',')}`);
  }
}

// End-to-end checks use the actual four selectable player physics profiles,
// sensor/tracker observations, wheel/steering integration and wet/dry grip.
// Speeds are initial conditions; real ACC/curve support may shed speed.
let physicalRuns = 0;
for (const profile of ['vf9', 'santafe', 'everest', 'civic'] as const) {
  for (const weather of ['clear', 'rain'] as const) {
    for (const initialKph of [30, 130]) for (const direction of [-1, 1] as const) {
      const drive = new Simulation({ trackId: 'motorway', trafficCount: 0, seed: 20261108 });
      drive.setVehicleProfile(profile); drive.setControlMode('adas'); drive.setWeather(weather);
      drive.traffic.clear(); drive.pedestrians.clear(); drive.trafficLights = []; drive.roadSigns = [];
      drive.sensor.config.dropout = 0;
      const p = drive.path.toCartesian(500, drive.road.laneCenter(1));
      Object.assign(drive.ego, { x: p.x, y: p.y, yaw: p.heading, v: initialKph / 3.6, a: 0, delta: 0 });
      // This rig relocates the car; invalidate the local nearest-path hint so
      // the relocation itself cannot be scored as an off-road driving event.
      (drive as unknown as { lastEgoIndex: number }).lastEgoIndex = -1;
      drive.ego.syncWheelSpeeds();
      drive.setAccSpeedKph(initialKph); drive.adas.resumeCruise(); drive.toggleIndicator(direction);
      let completed = false, aborted = false;
      for (let tick = 0; tick < 15 * 60; tick++) {
        drive.step(dt);
        completed ||= drive.adas.status.alcComplete;
        aborted ||= drive.adas.status.alcAborted;
        if (completed) break;
      }
      const f = drive.path.toFrenet(drive.ego.x, drive.ego.y);
      check(completed && !aborted && drive.indicator === 0 &&
        Math.abs(f.d - drive.road.laneCenter(1 + direction)) < .35 &&
        drive.metrics.collisions === 0 && drive.metrics.offRoadTime === 0,
        `Integrated ALC failed ${profile}/${weather}/initial${initialKph}/${direction}: done=${completed}, abort=${aborted}, d=${f.d}, target=${drive.road.laneCenter(1+direction)}, ind=${drive.indicator}, col=${drive.metrics.collisions}, off=${drive.metrics.offRoadTime}, reason=${drive.adas.status.alcReason}`);
      physicalRuns++;
    }
  }
}

for (const failure of failures) console.error(`FAIL: ${failure}`);
assert.deepEqual(failures, [], `Lateral audit failed ${failures.length}/${checks} checks`);
console.log(`LATERAL AUDIT 2026-11-08 PASS — ${checks} geometry, sensor, override, toggle and recognition checks, including ${physicalRuns} four-model wet/dry ALC drives.`);

