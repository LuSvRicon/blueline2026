import assert from 'node:assert/strict';
import { DualChannelSensorSuite, type Detection, type DualChannelEnvironment, type SensableObject } from '../src/perception/Sensor.ts';
import { Tracker } from '../src/perception/Tracker.ts';
import { Rng } from '../src/core/rng.ts';
import { Simulation } from '../src/sim/Simulation.ts';
import { wrapDiff } from '../src/core/math.ts';

const environment = (simTime: number, changes: Partial<DualChannelEnvironment> = {}): DualChannelEnvironment & {simTime: number} => ({
  simTime, weather: 'clear', night: false, bodyPitchRad: 0,
  cameraAvailable: true, frontRadarAvailable: true, rearRadarAvailable: true,
  referenceConfig: { range: 180, posNoise: 0, sizeNoise: 0, dropout: 0, velocityNoise: 0, fov: Math.PI, heading: 0, occlusion: false },
  ...changes,
});
const target = (time = 0): SensableObject => ({x: 30 + 10 * time, y: 0, vx: 10, vy: 0, length: 4.6, width: 1.9, kind: 'car'});
const suite = () => new DualChannelSensorSuite(new Rng(20261109));
let cases = 0;
function check(name: string, run: () => void) { run(); cases++; console.log(`PASS ${name}`); }

check('same-exposure fusion is physically withheld until processing completes', () => {
  const s = suite(), object = target();
  s.capture(0, 0, 0, [object], environment(0));
  object.x = 999; // Sampling must copy the measured scene, not consult world NOW at delivery.
  assert.equal(s.poll(.034).length, 0);
  assert.equal(s.poll(.035).length, 0, 'Fused output bypassed unfinished camera processing');
  const delivery = s.poll(.055);
  assert.equal(delivery.length, 1);
  assert.equal(delivery[0].sampledAt, 0);
  assert.equal(delivery[0].availableAt, .055);
  assert.equal(delivery[0].deliveredAt, .055);
  assert(Math.abs(delivery[0].detections[0].x - 30) < 1e-9);
  assert.equal(delivery[0].detections[0].sensorChannel, 'fused');
  assert.equal(delivery[0].detections[0].timestamp, 0);
  assert.equal(delivery[0].detections[0].deliveredAt, .055);
  assert.equal(s.poll(.056).length, 0, 'Completed scan was delivered twice');
});

for (const channel of ['radar', 'camera'] as const) check(`${channel}-only configured processing delay`, () => {
  const s = suite(), delay = channel === 'radar' ? .035 : .055;
  s.capture(0, 0, 0, [target()], environment(0, channel === 'radar'
    ? {cameraAvailable: false} : {frontRadarAvailable: false, rearRadarAvailable: false}));
  assert.equal(s.poll(delay - 1e-4).length, 0);
  const frames = s.poll(delay);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].detections[0].sensorChannel, channel);
  assert.equal(frames[0].detections[0].latencySec, delay);
});

check('instantaneous standalone calibration API retains its explicit contract', () => {
  const s = suite();
  const detections = s.sense(0, 0, 0, [target()], environment(10));
  assert.equal(detections.length, 1);
  assert.equal(detections[0].deliveredAt, undefined);
  assert.equal(s.poll(10.1).length, 0, 'Standalone API secretly queued an extra runtime sample');
});

check('completed empty scan differs from processing in flight', () => {
  const s = suite(), tracker = new Tracker({confirmHits: 1});
  s.capture(0, 0, 0, [target()], environment(0));
  const first = s.poll(.06)[0];
  tracker.update(first.detections, .06, {simTime: .06});
  assert.equal(tracker.tracks.length, 1);
  tracker.update([], .01, {simTime: .07, hasNewSample: false});
  assert.equal(tracker.tracks[0].misses, 0);
  s.capture(0, 0, 0, [], environment(.1));
  assert.equal(s.poll(.14).length, 0);
  const completed = s.poll(.155);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].detections.length, 0);
  tracker.update([], .085, {simTime: .155, sampleIntervalSec: completed[0].sampleIntervalSec});
  assert.equal(tracker.tracks[0].misses, 1);
  assert(Math.abs(tracker.tracks[0].coastingSec - .1) < 1e-9);
});

check('fault discards pre-fault in-flight data, recovery requires a fresh exposure', () => {
  const s = suite();
  s.capture(0, 0, 0, [target()], environment(0));
  assert.equal(s.poll(.06, {cameraAvailable: false, frontRadarAvailable: true, rearRadarAvailable: true}).length, 0);
  s.capture(0, 0, 0, [target(.1)], environment(.1, {cameraAvailable: false}));
  const fresh = s.poll(.135, {cameraAvailable: false, frontRadarAvailable: true, rearRadarAvailable: true});
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].sampledAt, .1);
  assert.equal(fresh[0].detections[0].sensorChannel, 'radar');
});

check('reset/replay boundary and backwards clock cannot leak a previous drive', () => {
  const s = suite();
  s.capture(0, 0, 0, [target()], environment(10));
  s.reset();
  assert.equal(s.poll(11).length, 0);
  s.capture(0, 0, 0, [target()], environment(20));
  s.capture(0, 0, 0, [target()], environment(0));
  const replayRestart = s.poll(.06);
  assert.equal(replayRestart.length, 1);
  assert.equal(replayRestart[0].sampledAt, 0);
  const tracker = new Tracker({confirmHits: 1});
  tracker.update([{...replayRestart[0].detections[0], x: 100}], .1, {simTime: 10});
  tracker.update(replayRestart[0].detections, .1, {simTime: .06});
  assert.equal(tracker.tracks.length, 1);
  assert(tracker.tracks[0].px < 31, 'Backwards clock retained old-drive track position');
});

check('changed processing deadline cannot resurrect an obsolete scene', () => {
  const s = suite();
  s.capture(0, 0, 0, [target()], environment(0));
  s.radarSpec.latencySec = s.cameraSpec.latencySec = 0;
  s.capture(0, 0, 0, [], environment(.01));
  const newer = s.poll(.01);
  assert.equal(newer.length, 1);
  assert.equal(newer[0].detections.length, 0);
  assert.equal(s.poll(.06).length, 0, 'An old delayed exposure resurrected a target after a newer clear observation');
});

check('batched completed scans update at one current epoch without extra prediction', () => {
  const s = suite(), tracker = new Tracker({confirmHits: 3});
  for (const time of [0, .01, .02]) s.capture(0, 0, 0, [target(time)], environment(time));
  const completed = s.poll(.1);
  assert.deepEqual(completed.map(scan => scan.sampledAt), [0, .01, .02]);
  for (const scan of completed) tracker.update(scan.detections, .1, {simTime: .1, sampleIntervalSec: scan.sampleIntervalSec});
  assert.equal(tracker.tracks.length, 1);
  const tracked = tracker.tracks[0];
  assert.equal(tracked.hits, 3);
  assert(tracked.confirmed);
  assert(Math.abs(tracked.px - 31) < .02, `Track was stale or propagated more than once: ${tracked.px}`);
  assert.equal(tracked.lastTimestamp, .02, 'Track discarded its true measurement epoch');
  const beforeHits = tracked.hits;
  const obsolete = {...completed[0].detections[0], deliveredAt: .11};
  tracker.update([obsolete], .01, {simTime: .11});
  assert.equal(tracker.tracks.length, 1, 'Older exposure spawned a duplicate');
  assert.equal(tracked.hits, beforeHits, 'Older exposure falsely matured the track');
  assert(Math.abs(tracked.px - 31.1) < .02, 'Older exposure pulled the current-time track backwards');
});

for (const mode of ['fused', 'camera'] as const) check(`${mode} delayed tracking converges to current-time motion`, () => {
  const s = suite(), tracker = new Tracker(), dt = 1 / 60;
  for (let tick = 0; tick <= 90; tick++) {
    const time = tick * dt;
    s.capture(0, 0, 0, [target(time)], environment(time, mode === 'camera' ? {frontRadarAvailable: false, rearRadarAvailable: false} : {}));
    const ready = s.poll(time);
    if (ready.length === 0) tracker.update([], dt, {simTime: time, hasNewSample: false});
    for (const scan of ready) tracker.update(scan.detections, dt, {simTime: time, sampleIntervalSec: scan.sampleIntervalSec});
  }
  assert.equal(tracker.tracks.length, 1);
  const t = tracker.tracks[0];
  assert(t.confirmed && t.coastingSec === 0);
  assert(Math.abs(t.vx - 10) < .25, `${mode} velocity did not converge: ${t.vx}`);
  assert(Math.abs(t.px - 45) < .2, `${mode} track still represents the delayed position: ${t.px}`);
  assert(t.lastTimestamp < 1.5 && t.latencySec === .055);
});

check('bounded unpolled queue and defensive detection copies', () => {
  const s = suite();
  for (let i = 0; i < 1000; i++) s.capture(0, 0, 0, [target()], environment(i / 100));
  const ready = s.poll(20);
  assert(ready.length > 0 && ready.length <= 256);
  const d: Detection = ready[0].detections[0];
  if (d.measCov) d.measCov[0][0] = 999;
  assert.notEqual(s.lastFusedDetections[0].measCov?.[0][0], 999);
  s.reset(); assert.equal(s.lastFusedDetections.length, 0);
});

for (const axis of ['x', 'y'] as const) check(`delayed ${axis}-axis braking tracks current motion and never extrapolates through rest`, () => {
  const s = suite(), tracker = new Tracker(), dt = 1 / 60;
  let maxEstablishedSpeedError = 0, maxEstablishedPositionError = 0;
  for (let tick = 0; tick <= 300; tick++) {
    const time = tick * dt, brakingTime = Math.max(0, Math.min(2.5, time - 1));
    const speed = 20 - 8 * brakingTime;
    const distance = 20 * Math.min(time, 1) + 20 * brakingTime - 4 * brakingTime ** 2;
    const object: SensableObject = {x: axis === 'x' ? 30 + distance : 0, y: axis === 'y' ? 30 + distance : 0,
      vx: axis === 'x' ? speed : 0, vy: axis === 'y' ? speed : 0, length: 4.6, width: 1.9, kind: 'car'};
    s.capture(0, 0, axis === 'x' ? 0 : Math.PI / 2, [object], environment(time));
    const ready = s.poll(time);
    if (ready.length === 0) tracker.update([], dt, {simTime: time, hasNewSample: false});
    for (const scan of ready) tracker.update(scan.detections, dt, {simTime: time, sampleIntervalSec: scan.sampleIntervalSec});
    if (time >= 1.8 && time <= 3.2) {
      const t = tracker.tracks[0]; assert(t, 'Braking target lost association');
      maxEstablishedSpeedError = Math.max(maxEstablishedSpeedError, Math.abs(t.speed - speed));
      maxEstablishedPositionError = Math.max(maxEstablishedPositionError, Math.abs((axis === 'x' ? t.px : t.py) - 30 - distance));
    }
    if (time >= 3.8) {
      const t = tracker.tracks[0]; assert(t);
      assert((axis === 'x' ? t.vx : t.vy) >= -.05, 'Braking extrapolation made a stopped target reverse');
      assert(t.speed < .15, 'Established stopped target retained false motion');
    }
  }
  assert(maxEstablishedSpeedError < .4, `Processing delay was counted again as braking-speed lag: ${maxEstablishedSpeedError}`);
  assert(maxEstablishedPositionError < .3, `Braking track remained at its measured-time position: ${maxEstablishedPositionError}`);
});

check('live Simulation cannot observe an in-flight scan and expires actual delayed dropout', () => {
  const sim = new Simulation({trackId: 'motorway', trafficCount: 0, seed: 20261109});
  sim.setControlMode('adas'); sim.reset(); sim.traffic.clear(); sim.pedestrians.clear();
  sim.adas.config.acc = false;
  sim.sensor.config.dropout = sim.sensor.config.posNoise = sim.sensor.config.sizeNoise = sim.sensor.config.velocityNoise = 0;
  const f = sim.path.toFrenet(sim.ego.x, sim.ego.y);
  sim.traffic.addTestVehicle('stalled', sim.road.laneOf(f.d), f.s + 30, 0, 0);
  for (let i = 0; i < 3; i++) {
    sim.step(1 / 60);
    assert.equal(sim.tracks.length, 0, 'Runtime bypassed processing delay with an immediate sensor/ground-truth track');
  }
  for (let i = 0; i < 8; i++) sim.step(1 / 60);
  assert(sim.tracks.some(t => t.confirmed), 'Completed runtime measurements did not reach the tracker');
  assert(sim.tracks.every(t => t.lastTimestamp <= sim.simTime - .055 + 1e-6), 'Runtime discarded the acquisition epoch');
  sim.sensor.config.dropout = 1;
  for (let i = 0; i < 65; i++) sim.step(1 / 60);
  assert.equal(sim.tracks.length, 0, 'Lost target persisted after actual delayed empty sweeps');
});

check('delayed live perception still produces a physical AEB stop', () => {
  const sim = new Simulation({trackId: 'motorway', trafficCount: 0, seed: 20261109});
  sim.setVehicleProfile('vf9'); sim.setControlMode('adas'); sim.reset();
  sim.traffic.clear(); sim.pedestrians.clear(); sim.trafficLights = []; sim.roadSigns = [];
  sim.adas.config.acc = false; sim.adas.config.isa = false;
  sim.sensor.config.dropout = 0;
  const s = 500, d = sim.road.laneCenter(1), w = sim.path.toCartesian(s, d);
  Object.assign(sim.ego, {x: w.x, y: w.y, yaw: w.heading, v: 50 / 3.6, a: 0, delta: 0});
  (sim as unknown as {lastEgoIndex: number}).lastEgoIndex = -1;
  sim.ego.syncWheelSpeeds();
  const obstacle = sim.traffic.addTestVehicle('stalled', 1, s + 60, 0, 0);
  let observedAeb = false;
  for (let i = 0; i < 8 * 60; i++) {
    sim.setDriverInput({steer: 0, throttle: 1, brake: 0}); sim.step(1 / 60);
    observedAeb ||= sim.adas.status.aeb || sim.adas.status.aebHolding;
  }
  const f = sim.path.toFrenet(sim.ego.x, sim.ego.y);
  const clearance = wrapDiff(obstacle.s, f.s, sim.path.length) - (sim.ego.dims.length + obstacle.length) / 2;
  assert(observedAeb && sim.adas.status.aebHolding, 'AEB did not reach/retain a completed physical stop');
  assert(sim.ego.v < .01 && sim.metrics.collisions === 0 && clearance > .2,
    `Delayed perception failed safe stop: v=${sim.ego.v}, contacts=${sim.metrics.collisions}, gap=${clearance}`);
});

console.log(`SENSOR LATENCY PIPELINE PASS — ${cases} delivery, clock, dropout, fault, covariance and reset checks.`);
