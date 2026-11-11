import assert from 'node:assert/strict';
import { Simulation, type Weather } from '../src/sim/Simulation.ts';
import type { VehicleProfileId } from '../src/vehicle/VehicleProfiles.ts';
import { AuditProbe, auditDt as dt, auditEnv, saveAuditSummary } from './adas-audit-support.ts';

const profiles = (auditEnv.AUDIT_PROFILES?.split(',') ?? ['vf9', 'santafe', 'everest', 'civic']) as VehicleProfileId[];
const weathers = (auditEnv.AUDIT_WEATHERS?.split(',') ?? ['clear', 'rain', 'fog']) as Weather[];
const seeds = (auditEnv.AUDIT_SEEDS?.split(',') ?? ['20261109']).map(Number);
assert(profiles.length > 0 && profiles.every(p => ['vf9', 'santafe', 'everest', 'civic'].includes(p)), 'Unknown vehicle profile filter');
assert(weathers.length > 0 && weathers.every(w => ['clear', 'rain', 'fog'].includes(w)), 'Unknown weather filter');
assert(seeds.length > 0 && seeds.every(Number.isSafeInteger), 'Seeds must be integers');
const failures: string[] = [], results: Record<string, unknown>[] = [];
function run(key: string, body: () => Record<string, unknown>) {
  if (auditEnv.AUDIT_CASE && auditEnv.AUDIT_CASE !== key) return;
  try { const result = body(); results.push({ key, ...result }); console.log(`PASS ${key} ${JSON.stringify(result)}`); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); failures.push(message); console.error(`FAIL ${message}`); }
}
function relocate(sim: Simulation, s: number, lane: number, speed: number) {
  const pose = sim.path.toCartesian(s, sim.road.laneCenter(lane));
  Object.assign(sim.ego, { x: pose.x, y: pose.y, yaw: pose.heading, v: speed, a: 0, delta: 0 });
  (sim as unknown as { lastEgoIndex: number }).lastEgoIndex = -1;
  sim.ego.syncWheelSpeeds();
}

for (const seed of seeds) for (const profile of profiles) for (const weather of weathers) {
  // Clear target-lane gaps surrounded by real sensed moving traffic. Default
  // weather noise/dropout stay enabled; no injected perfect obstacles.
  for (const direction of [-1, 1]) run(`mixed/${seed}/${profile}/${weather}/${direction}`, () => {
    const sim = new Simulation({ trackId: 'ring-road', trafficCount: 0, seed });
    sim.setVehicleProfile(profile); sim.setControlMode('adas'); sim.setWeather(weather);
    sim.traffic.clear(); sim.pedestrians.clear();
    relocate(sim, 500, 1, 50 / 3.6); sim.setAccSpeedKph(60); sim.engageAcc();
    const targetLane = 1 + direction, otherLane = 1 - direction;
    sim.traffic.addTestVehicle('car', 1, 585, 15, 15);
    sim.traffic.addTestVehicle('car', targetLane, 640, 15, 15);
    sim.traffic.addTestVehicle('car', targetLane, 365, 15, 15);
    sim.traffic.addTestVehicle('bus', otherLane, 535, 14, 14);
    sim.traffic.addTestVehicle('motorcycle', otherLane, 470, 14, 14);
    const probe = new AuditProbe(sim, `mixed/${seed}/${profile}/${weather}/${direction}`, { seed, profile, weather, direction, trackId: 'ring-road' });
    probe.phase = 'sense-traffic';
    for (let tick = 0; tick < 60; tick++) { sim.step(dt); probe.tick(); }
    probe.check(sim.tracks.some(t => t.confirmed), 'no actual noisy sensor tracks were confirmed');
    probe.check(sim.usePerception && sim.sensor.config.dropout > 0 && sim.sensor.config.posNoise > 0, 'fixture disabled actual perception uncertainty');
    sim.toggleIndicator(direction);
    probe.phase = 'moving-alc-fault';
    for (let tick = 0; tick < 90 && sim.adas.status.alc !== 'active'; tick++) { sim.step(dt); probe.tick(); }
    probe.check(sim.adas.status.alc === 'active', `clear-gap ALC did not arm: ${sim.adas.status.alcReason}`);
    for (let tick = 0; tick < 24; tick++) { sim.step(dt); probe.tick(); }
    sim.sensorAvailability.rearRadar = false; sim.step(dt); probe.tick();
    probe.check(sim.adas.status.alcAborted && sim.adas.status.alc !== 'active', 'ALC retained lane-change authority after rear-radar fault');
    sim.sensorAvailability.rearRadar = true;
    for (let tick = 0; tick < 45; tick++) { sim.step(dt); probe.tick(); }
    probe.check(sim.adas.status.alc !== 'active', 'ALC silently resumed the cancelled manoeuvre on radar recovery');
    sim.clearIndicator(); sim.step(dt); probe.tick(); sim.toggleIndicator(direction);
    probe.phase = 'fresh-request-assisted-lane-change';
    let completed = false;
    for (let tick = 0; tick < 20 * 60; tick++) {
      sim.step(dt); probe.tick(); completed ||= sim.adas.status.alcComplete;
      if (completed) break;
    }
    probe.check(completed && sim.indicator === 0, `ALC did not complete through noisy traffic: ${sim.adas.status.alcReason}`);
    const f = sim.path.toFrenet(sim.ego.x, sim.ego.y);
    probe.check(Math.abs(f.d - sim.road.laneCenter(targetLane)) < .4, 'ALC did not settle in requested lane');

    probe.phase = 'foot-brake-cancel';
    for (let tick = 0; tick < 30; tick++) { sim.setDriverInput({ steer: 0, throttle: 0, brake: .4 }); sim.step(dt); probe.tick(); }
    probe.check(!sim.adas.status.accActive, 'foot brake did not cancel ACC');
    probe.phase = 'release-without-resume';
    for (let tick = 0; tick < 30; tick++) { sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 }); sim.step(dt); probe.tick(); }
    probe.check(!sim.adas.status.accActive, 'ACC silently resumed after foot-brake release');

    probe.phase = 'fault-with-safe-driver-stop';
    sim.sensorFault = true;
    for (let tick = 0; tick < 60; tick++) { sim.setDriverInput({ steer: 0, throttle: 0, brake: .55 }); sim.step(dt); probe.tick(); }
    probe.check(sim.adas.status.takeoverRequired && !sim.adas.status.accActive && !sim.adas.status.laneCenteringActive, 'sensor failure retained assisted drive authority');
    sim.sensorFault = false;
    for (let tick = 0; tick < 60; tick++) { sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 }); sim.step(dt); probe.tick(); }
    probe.check(!sim.adas.status.accActive, 'sensor recovery automatically reengaged ACC');
    probe.phase = 'explicit-acc-resume';
    probe.check(sim.engageAcc(), 'driver could not explicitly resume after sensor recovery');
    for (let tick = 0; tick < 180; tick++) { sim.step(dt); probe.tick(); }
    probe.check(sim.adas.status.accActive, 'explicit resume did not restore ACC');
    probe.phase = 'manual-steering-takeover';
    for (let tick = 0; tick < 12; tick++) {
      sim.setDriverInput({ steer: direction * .12, throttle: 0, brake: 0, steeringOverride: true }); sim.step(dt); probe.tick();
      probe.check(!sim.adas.status.laneCenteringActive, 'lane centering retained steering authority during deliberate takeover');
    }
    sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
    for (let tick = 0; tick < 60; tick++) { sim.step(dt); probe.tick(); }
    probe.phase = 'braking-lead-after-recovery';
    const previousCars = sim.traffic.cars.length;
    sim.addScenarioEvent('lead-hard-brake');
    probe.check(sim.traffic.cars.length === previousCars + 1, 'lead-brake challenge was not actually spawned');
    let sawLeadBraking = false;
    for (let tick = 0; tick < 12 * 60; tick++) {
      sim.step(dt); probe.tick();
      sawLeadBraking ||= sim.adas.status.aeb || sim.adas.status.aebHolding || sim.adas.status.brakeReason === 'acc-gap';
    }
    probe.check(sawLeadBraking && sim.ego.v < .1, 'ACC/AEB did not stop for the real braking lead after fault recovery');
    probe.phase = 'stop-before-reverse';
    for (let tick = 0; tick < 12 * 60 && sim.ego.v > .01; tick++) {
      sim.setDriverInput({ steer: 0, throttle: 0, brake: .8 }); sim.step(dt); probe.tick();
    }
    probe.check(sim.ego.v < .05 && sim.setGear('R'), 'safe stop did not permit selecting R');
    sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
    sim.addScenarioEvent(direction < 0 ? 'rear-crossing-left' : 'rear-crossing-right');
    probe.phase = 'reverse-with-real-cross-traffic';
    let warned = false, rearBraked = false;
    for (let tick = 0; tick < 4 * 60; tick++) {
      sim.setDriverInput({ steer: 0, throttle: .15, brake: 0 }); sim.step(dt); probe.tick();
      warned ||= sim.telemetry.rctaActive; rearBraked ||= sim.telemetry.rearAeb;
    }
    probe.check(warned && rearBraked, `reverse crossing did not produce both RCTA and Rear AEB: warn=${warned}, brake=${rearBraked}`);
    sim.setDriverInput({ steer: 0, throttle: 0, brake: .8 });
    for (let tick = 0; tick < 90; tick++) { sim.step(dt); probe.tick(); }
    probe.check(sim.ego.v < .01 && sim.setGear('P'), 'driver could not park after reverse intervention');
    return { seconds: +sim.simTime.toFixed(2), confirmedTracks: sim.tracks.filter(t => t.confirmed).length,
      maxTracks: probe.observed.maxTracks, collisions: sim.metrics.collisions, sensorDropout: sim.sensor.config.dropout,
      reverseWarning: warned, reverseBraking: rearBraked };
  });

  for (const orientation of ['parallel', 'perpendicular'] as const) run(`apa/${seed}/${profile}/${weather}/${orientation}`, () => {
    const sim = new Simulation({ trafficCount: 0, seed });
    sim.setVehicleProfile(profile); sim.prepareParkingLab(orientation); sim.setWeather(weather);
    const probe = new AuditProbe(sim, `apa/${seed}/${profile}/${weather}/${orientation}`, { seed, profile, weather, orientation });
    probe.phase = 'noisy-parking-scan';
    for (let tick = 0; tick < 45; tick++) { sim.setDriverInput({ steer: 0, throttle: 0, brake: .2 }); sim.step(dt); probe.tick(); }
    sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
    probe.check(sim.usePerception && sim.sensor.config.dropout > 0, 'parking used ideal ground truth');
    probe.check(sim.requestParking('apa'), `APA did not find a bay: ${sim.parkingAssist.status.message}`);
    const bay = sim.parkingBays.find(b => b.id === sim.parkingAssist.status.bayId)!;
    probe.phase = 'noisy-parking-hold-release';
    for (let tick = 0; tick < 60; tick++) { sim.parkingAssist.hold(true); sim.step(dt); probe.tick(); }
    sim.parkingAssist.hold(false);
    for (let tick = 0; tick < 90; tick++) { sim.step(dt); probe.tick(); }
    probe.check(sim.ego.v < .01 && sim.parkingAssist.status.state === 'paused', 'APA did not stop after releasing hold');
    probe.phase = 'noisy-parking-completion';
    for (let tick = 0; tick < 90 * 60 && sim.parkingAssist.status.state !== 'complete'; tick++) {
      sim.parkingAssist.hold(true); sim.step(dt); probe.tick();
      probe.check(!['cancelled', 'blocked'].includes(sim.parkingAssist.status.state), sim.parkingAssist.status.message);
    }
    const goal = sim.path.toCartesian(bay.s, bay.d), error = Math.hypot(sim.ego.x - goal.x, sim.ego.y - goal.y);
    probe.check(sim.parkingAssist.status.state === 'complete' && error < .4 && sim.ego.v === 0 && sim.gear === 'P' && sim.epbEngaged,
      `sensor-driven APA failed completion: state=${sim.parkingAssist.status.state}, error=${error.toFixed(3)}`);
    return { seconds: +sim.simTime.toFixed(2), errorMetres: +error.toFixed(3), collisions: sim.metrics.collisions, maxTracks: probe.observed.maxTracks };
  });

  for (const mode of ['remote-forward', 'remote-reverse'] as const) run(`rpa/${seed}/${profile}/${weather}/${mode}`, () => {
    const sim = new Simulation({ trafficCount: 0, seed });
    sim.setVehicleProfile(profile); sim.prepareParkingLab(); sim.setWeather(weather);
    const probe = new AuditProbe(sim, `rpa/${seed}/${profile}/${weather}/${mode}`, { seed, profile, weather, mode });
    probe.phase = 'remote-parking-prepare';
    for (let tick = 0; tick < 45; tick++) { sim.step(dt); probe.tick(); }
    probe.check(sim.setGear('P'), 'RPA preparation could not select P');
    probe.check(sim.setEngineRunning(false), 'RPA preparation could not switch engine off');
    probe.check(sim.requestParking(mode), `RPA could not prepare: ${sim.parkingAssist.status.message}`);
    probe.phase = 'remote-parking-start-and-link-loss';
    for (let tick = 0; tick < 60; tick++) { sim.parkingAssist.hold(true); sim.step(dt); probe.tick(); }
    probe.check(sim.engineOn && sim.ego.v > .3, 'RPA did not coordinate engine/gear/propulsion');
    for (let tick = 0; tick < 60; tick++) { sim.step(dt); probe.tick(); }
    probe.check(sim.ego.v < .01 && sim.parkingAssist.status.state === 'paused', 'lost RPA heartbeat did not stop the vehicle');
    probe.phase = 'remote-parking-completion';
    for (let tick = 0; tick < 30 * 60 && sim.parkingAssist.status.state !== 'complete'; tick++) {
      sim.parkingAssist.hold(true); sim.step(dt); probe.tick();
      probe.check(!['cancelled', 'blocked'].includes(sim.parkingAssist.status.state), sim.parkingAssist.status.message);
    }
    probe.check(sim.parkingAssist.status.state === 'complete' && sim.gear === 'P' && sim.epbEngaged && sim.ego.v === 0,
      `RPA did not finish parked: ${sim.parkingAssist.status.message}`);
    return { seconds: +sim.simTime.toFixed(2), collisions: sim.metrics.collisions, maxTracks: probe.observed.maxTracks };
  });
}

saveAuditSummary('adas-noisy-sequence-results', { profiles, weathers, seeds, results, failures });
assert(results.length + failures.length > 0, 'Case filter matched no test cases');
assert.equal(failures.length, 0, failures.join('\n'));
console.log(`NOISY ADAS SEQUENCE PASS — ${results.length} seeded sensed-traffic lane-change/ACC/fault and sensor-driven APA cases.`);
