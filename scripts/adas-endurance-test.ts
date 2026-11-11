import assert from 'node:assert/strict';
import { Simulation, type Weather } from '../src/sim/Simulation.ts';
import { AuditProbe, auditDt as dt, auditEnv, saveAuditSummary } from './adas-audit-support.ts';

// Default is a bounded CI smoke run. For the release endurance check use
// AUDIT_ENDURANCE_SECONDS=3600 (or7200). This is one continuous simulation,
// not a sum of reset 20-second scenarios. No rendering/GPU claim is made.
const seconds = Number(auditEnv.AUDIT_ENDURANCE_SECONDS ?? 60);
const seed = Number(auditEnv.AUDIT_ENDURANCE_SEED ?? 20261109);
assert(Number.isFinite(seconds) && seconds >= 30 && seconds <= 7200, 'Endurance duration must be 30..7200 simulated seconds');
assert(Number.isSafeInteger(seed), 'Seed must be an integer');
const trackId = (auditEnv.AUDIT_ENDURANCE_TRACK ?? 'city') as 'city' | 'motorway' | 'national';
assert(['city', 'motorway', 'national'].includes(trackId), 'Unknown endurance track');
const sim = new Simulation({ trackId, seed });
sim.setTrafficProfile(trackId === 'city' ? 'vietnam' : 'international');
sim.setControlMode('adas'); sim.setVehicleProfile('vf9'); sim.setAccSpeedKph(trackId === 'city' ? 55 : 80);
if (trackId === 'city') sim.traffic.populateDistrict(0, 48);
sim.reset();
const probe = new AuditProbe(sim, `endurance-${trackId}-${seed}-${seconds}`, { seed, trackId, seconds,
  actionSchedule: '300s cycles: foot-brake0..6s, profile/weather/fault6..8s, release8s, explicitRES9s, lane-change30s, signal-off50s; driverRESat5sintervals if requested' });
const profiles = ['vf9', 'santafe', 'everest', 'civic'] as const;
const weathers: Weather[] = ['clear', 'rain', 'fog'];
const events = new Set<string>(), progress: Record<string, unknown>[] = [];
let lastCycle = -1, lastProgress = -1, resumed = 0, alcComplete = 0, maxCars = 0;
const wallStart = performance.now();
for (let tick = 0; tick < Math.round(seconds / dt); tick++) {
  const time = tick * dt, cycle = Math.floor(time / 300), phase = time % 300;
  if (cycle !== lastCycle) { lastCycle = cycle; events.clear(); }
  const once = (name: string, due: number, action: () => void) => {
    if (phase >= due && !events.has(name)) { action(); events.add(name); }
  };
  // First minute is an uninterrupted ordinary drive. Long runs then include
  // deliberate driver actions and sensor outages at each5-minute boundary.
  if (cycle > 0) {
    probe.phase = phase < 6 ? 'driver-braking' : phase < 8 ? 'stationary-fault' : phase < 10 ? 'recover-resume' : 'ordinary-drive';
    sim.setDriverInput({ steer: 0, throttle: 0, brake: phase < 8 ? .55 : 0 });
    once('fault', 6, () => {
      probe.check(sim.ego.v < .1, 'controlled stop did not finish before stationary fault/profile change');
      sim.setVehicleProfile(profiles[cycle % profiles.length]); sim.setWeather(weathers[cycle % weathers.length]); sim.sensorFault = true;
    });
    once('recover', 8, () => { sim.sensorFault = false; });
    once('resume', 9, () => { if (sim.engageAcc()) resumed++; });
    once('lane-change', 30, () => {
      const f = sim.path.toFrenet(sim.ego.x, sim.ego.y), lane = sim.road.laneOf(f.d);
      sim.toggleIndicator(lane === 0 ? 1 : -1);
    });
    once('signal-off', 50, () => sim.clearIndicator());
  } else { probe.phase = 'ordinary-drive'; sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 }); }
  // ACC Stop&Go intentionally asks the driver forRES after a longer stop.
  // A planned explicit response is not an automatic repair of controller state.
  if (tick % 300 === 0 && sim.adas.status.accState === 'resume-required' && phase >= 10 && sim.engageAcc()) resumed++;
  sim.step(dt); probe.tick();
  if (sim.adas.status.alcComplete) alcComplete++;
  maxCars = Math.max(maxCars, sim.traffic.cars.length);
  const minute = Math.floor((tick + 1) * dt / 60);
  if (minute > lastProgress && (minute > 0 || tick === 0)) {
    lastProgress = minute;
    const sample = { seconds: +(sim.simTime).toFixed(2), distanceMetres: +sim.telemetry.distanceTravelled.toFixed(1),
      speedKph: +(sim.ego.v * 3.6).toFixed(1), profile: sim.vehicleProfileId, weather: sim.weather,
      collisions: sim.metrics.collisions, offRoadSeconds: sim.metrics.offRoadTime,
      cars: sim.traffic.cars.length, tracks: sim.tracks.length, heapMiB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1) };
    progress.push(sample); console.log(`ENDURANCE ${minute}m/${(seconds / 60).toFixed(0)}m ${JSON.stringify(sample)}`);
  }
}
probe.check(sim.simTime >= seconds - dt * 2, 'simulation clock failed to advance the requested continuous duration');
probe.check(sim.telemetry.distanceTravelled > seconds * .5, 'no-contact result hid an essentially frozen ego vehicle');
const summary = { seed, trackId, seconds, wallSeconds: +((performance.now() - wallStart) / 1000).toFixed(1),
  distanceMetres: +sim.telemetry.distanceTravelled.toFixed(1), collisions: sim.metrics.collisions,
  offRoadSeconds: sim.metrics.offRoadTime, resumed, alcComplete, maxCars, observed: probe.observed,
  progress, caveats: ['Headless physics/controller endurance; browser/GPU endurance is a separate check.',
    'Observed heap range includes garbage-collector cycles; it is not a proven absence of memory leaks.',
    'Driver actions follow the documented deterministic schedule and can be rerun with the same seed.'] };
saveAuditSummary('adas-endurance-results', summary);
console.log(`ADAS ENDURANCE PASS — ${JSON.stringify(summary)}`);
