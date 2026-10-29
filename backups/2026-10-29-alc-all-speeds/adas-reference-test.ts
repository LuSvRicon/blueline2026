import assert from 'node:assert/strict';
import { ADASController, ADASFrame, DEFAULT_ADAS_CONFIG } from '../src/sim/ADAS.ts';
import { assistanceAvailability } from '../src/sim/AssistancePolicy.ts';
import { ExtendedAssistance } from '../src/sim/ExtendedAssistance.ts';
import { proximitySafety } from '../src/sim/ProximitySafety.ts';
import { Simulation } from '../src/sim/Simulation.ts';

// Behaviour acceptance tests reference public manuals, not the implementation's
// intermediate calculations. Numerical braking/steering tuning remains BlueLine's.
const sim = new Simulation({ trafficCount: 0 }); sim.traffic.clear(); sim.pedestrians.clear();
const ego = sim.ego, path = sim.path, road = sim.road;
function position(s = 150, d = 0, speed = 25, heading = 0) {
  const p = path.toCartesian(s, d); Object.assign(ego, { x: p.x, y: p.y, yaw: p.heading + heading, v: speed });
}
position();
function frame(overrides: Partial<ADASFrame> = {}): ADASFrame {
  const p = path.toFrenet(ego.x, ego.y);
  return { ego, egoS: p.s, egoD: p.d, path, road, obstacles: [], desiredSpeed: 25,
    input: { steer: 0, throttle: 0, brake: 0 }, dt: .1, speedControl: e => e, ...overrides };
}
function obstacle(ds: number, dd = 0, v = 0, vd = 0) {
  const p = path.toFrenet(ego.x, ego.y);
  return { s: p.s + ds, d: p.d + dd, v, vd, length: 4.6, width: 1.9, kind: 'car' as const };
}
// Faults remove only the relevant authority. Camera loss must not turn rear radar off.
{
  const a = assistanceAvailability({ sensorAvailability: { camera: false } });
  assert(!a.lane && !a.forward && a.sensors.rearRadar && a.sensors.ultrasonic);
  const c = new ADASController();
  const result = c.update(frame({ sensorAvailability: { camera: false }, obstacles: [obstacle(-4, -3.7, 26)] }));
  assert(!result.status.accActive && !result.status.laneCenteringActive && result.status.blindSpotLeft);
  const rearLost = c.update(frame({ sensorAvailability: { rearRadar: false }, obstacles: [obstacle(-4, -3.7, 26)] }));
  assert(!rearLost.status.blindSpotLeft && rearLost.status.laneCenteringActive);
}
// SCC: brake cancels until RES; belt/door/ESC/ABS conditions inhibit cruise.
for (const conditions of [{ beltFastened: false }, { doorsClosed: false }, { escAvailable: false }, { absActive: true }, { epb: true }, { gear: 'N' as const }]) {
  const c = new ADASController();
  assert(!c.update(frame({ conditions })).status.accActive);
  assert(c.status.availabilityReason.length > 0);
  assert(!c.update(frame()).status.accActive, 'cruise reactivated without driver confirmation');
  c.resumeCruise(); assert(c.update(frame()).status.accActive);
}
{
  const c = new ADASController();
  assert(!c.update(frame({ input: { steer: 0, throttle: 0, brake: .2 } })).status.accActive);
  assert(!c.update(frame()).status.accActive); c.resumeCruise(); assert(c.update(frame()).status.accActive);
  const emergency = c.update(frame({ conditions: { beltFastened: false }, obstacles: [obstacle(20)], input: { steer: 0, throttle: 1, brake: .2 } }));
  assert(emergency.status.aeb && emergency.accel < -ego.maxDecel * .2, 'ACC inhibition incorrectly disabled emergency brake assist');
}
// ALC road domain, hands-on, rear radar and a new dangerous rear approach.
{
  const c = new ADASController();
  for (let i = 0; i < 10; i++) c.update(frame({ indicator: 1 }));
  assert.equal(c.status.alc, 'blocked'); assert.match(c.status.alcReason, /cao tốc/);
  c.update(frame({ indicator: 0, conditions: { motorway: true } }));
  for (let i = 0; i < 10; i++) c.update(frame({ indicator: 1, conditions: { motorway: true }, trafficLight: { state: 'green', distance: 45 } }));
  assert.equal(c.status.alc, 'blocked'); assert.match(c.status.alcReason, /giao lộ/);
  c.update(frame({ indicator: 0, conditions: { motorway: true } }));
  const pedestrian = { ...obstacle(35, -3.7, 0, 1), kind: 'ped' as const, width: .6, length: .6 };
  for (let i = 0; i < 10; i++) c.update(frame({ indicator: 1, conditions: { motorway: true }, obstacles: [pedestrian] }));
  assert.equal(c.status.alc, 'blocked'); assert.match(c.status.alcReason, /người đi bộ/);
  c.update(frame({ indicator: 0, conditions: { motorway: true } }));
  for (let i = 0; i < 8; i++) c.update(frame({ indicator: 1, conditions: { motorway: true } }));
  assert.equal(c.status.alc, 'active');
  const lost = c.update(frame({ indicator: 1, conditions: { motorway: true, handsOn: false } }));
  assert(lost.status.alcAborted && lost.status.alc !== 'active');
  c.update(frame({ indicator: 0, conditions: { motorway: true } }));
  for (let i = 0; i < 10; i++) c.update(frame({ indicator: 1, conditions: { motorway: true }, obstacles: [obstacle(-70, 3.7, 45)] }));
  assert.equal(c.status.alc, 'blocked');
  c.update(frame({ indicator: 0, conditions: { motorway: true } }));
  for (let i = 0; i < 10; i++) c.update(frame({ indicator: 1, conditions: { motorway: true }, sensorAvailability: { rearRadar: false } }));
  assert.equal(c.status.alc, 'blocked'); assert.match(c.status.alcReason, /Radar sau/);
}
// LFA centres continuously; LKA only intervenes near a departure and above 60 km/h.
// A rejected initial request remains a live signal intent: recover after the
// speed/hands/rear-radar condition becomes valid, with a fresh arming delay.
// It must not inherit the cancellation latch reserved for an aborted move.
for(const initial of ['speed','hands','rearRadar'] as const){
  position(150,0,initial==='speed'?75/3.6:25);const c=new ADASController();
  const blocked:Partial<ADASFrame>={indicator:1,conditions:{motorway:true,handsOn:initial!=='hands'},sensorAvailability:{rearRadar:initial!=='rearRadar'}};
  for(let i=0;i<10;i++)c.update(frame(blocked));
  assert.equal(c.status.alc,'blocked');
  position(150,0,25);
  c.update(frame({indicator:1,conditions:{motorway:true}}));
  assert.notEqual(c.status.alc,'active','recovered request skipped perception arming');
  for(let i=0;i<8;i++)c.update(frame({indicator:1,conditions:{motorway:true}}));
  assert.equal(c.status.alc,'active',`initial ${initial} rejection stayed latched after conditions recovered`);
  position(150,0,75/3.6);
  const slowing=c.update(frame({indicator:1,conditions:{motorway:true}}));
  assert(slowing.status.alc==='active'&&!slowing.status.alcAborted,'ACC slowdown below entry speed aborted a committed lane change');
}
position();
{
  const c=new ADASController();for(let i=0;i<8;i++)c.update(frame({indicator:1,conditions:{motorway:true}}));
  c.update(frame({indicator:1,conditions:{motorway:true},input:{steer:-.001,steeringOverride:true,throttle:0,brake:0}}));
  c.update(frame({indicator:1,conditions:{motorway:true}}));
  assert.equal(c.status.alc,'blocked');assert.match(c.status.alcReason,/tắt rồi bật lại/);
  c.update(frame({indicator:0,conditions:{motorway:true}}));
  for(let i=0;i<8;i++)c.update(frame({indicator:1,conditions:{motorway:true}}));
  assert.equal(c.status.alc,'active','fresh indicator could not rearm after driver takeover');
}
{
  const c = new ADASController(); c.config.laneCentering = false;
  position(150, .72, 20, .04);
  assert(c.update(frame()).status.laneKeepAssist);
  position(150, .72, 10, .04);
  assert(!c.update(frame()).status.laneKeepAssist);
  position(150, .72, 20, .04);
  assert(!c.update(frame({ indicator: 1 })).status.laneKeepAssist, 'LKA resisted signalled departure');
  position(150, .2, 20);
  assert(!c.update(frame()).status.laneKeepAssist, 'LKA became continuous lane centring');
  c.config.laneCentering = true; assert(c.update(frame()).status.laneCenteringActive);
}
// Optional signal confirmation must not change the standard green-light mode.
{
  position(); const c = new ADASController();
  const light = { state: 'green' as const, distance: 60, id: 42 };
  assert(!c.update(frame({ trafficLight: light })).status.trafficLightStopping);
  c.config.signalMode = 'confirmation';
  assert(c.update(frame({ trafficLight: light })).status.signalConfirmationRequired);
  assert(!c.update(frame({ trafficLight: light, input: { steer: 0, throttle: .2, brake: 0 } })).status.signalConfirmationRequired);
  assert(!c.update(frame({ trafficLight: light })).status.signalConfirmationRequired);
  assert(c.update(frame({ trafficLight: { ...light, state: 'red' } })).status.trafficLightStopping);
  assert(c.update(frame({ trafficLight: light })).status.signalConfirmationRequired, 'red-to-green reused stale consent');
  assert(!c.update(frame({ trafficLight: light, obstacles: [obstacle(25, 0, 25)] })).status.signalConfirmationRequired);
  const restored = new ADASController(); restored.restoreState(c.captureState(), c.status);
  assert.equal(restored.config.signalMode, 'confirmation');
}
// ISA warning-only has no braking authority. Kick-down does not bypass AEB.
{
  position(150, 0, 20); const c = new ADASController(); c.config.acc = false; c.config.isaMode = 'warning';
  const out = c.update(frame({ speedLimitKph: 50, input: { steer: 0, throttle: .6, brake: 0 } }));
  assert(out.status.speedWarning && out.accel > 0 && out.status.adasBrakeForce === 0);
  c.config.isaMode = 'limit'; assert(c.update(frame({ speedLimitKph: 50, input: { steer: 0, throttle: .6, brake: 0 } })).accel < 0);
  c.config.isaMode = 'suggest';
  assert(c.update(frame({ speedLimitKph: 50, input: { steer: 0, throttle: .6, brake: 0 } })).accel > 0);
  assert.equal(c.getSetSpeed(25), 25, 'sign suggestion changed set speed without consent');
  c.setCruiseSpeedKph(50); assert.equal(Math.round(c.getSetSpeed(25) * 3.6), 50);
  assert(c.update(frame({ speedLimitKph: 50, input: { steer: 0, throttle: 1, brake: 0 }, obstacles: [obstacle(14)] })).status.aeb);
}
const options = { gear: 'D', night: true, weather: 'clear', attentive: true, handsOn: true, fatigued: false };
// BCA departure braking is independent of forward camera/lane recognition.
{
  position(150, 0, .2);
  const a = new ExtendedAssistance(), config = { ...DEFAULT_ADAS_CONFIG, pedalMitigation: false };
  const f = frame({ indicator: 1, sensorAvailability: { camera: false }, obstacles: [obstacle(-20, 3.7, 15)], input: { steer: .3, throttle: .5, brake: 0 } });
  const braking = a.update(f, config, .15, 2, options);
  assert(braking.status.blindSpotBraking && braking.accel <= -ego.maxDecel);
  assert(!a.update({ ...f, conditions: { escAvailable: false } }, config, .15, 2, options).status.blindSpotBraking);
  assert(!a.update(f, { ...config, blindSpotAvoidance: false }, .15, 2, options).status.blindSpotBraking);
}
// A correction away from a right-side threat on a left curve must retain the
// curvature steering component, rather than steering off the curve entirely.
{
  let bend = 0, k = 0;
  for (let s = 0; s < path.length; s += 2) if (path.signedCurvatureAt(s) > k) { k = path.signedCurvatureAt(s); bend = s; }
  position(bend, 0, 20);
  const a = new ExtendedAssistance();
  const out = a.update(frame({ obstacles: [obstacle(-3, 2.3, 22)], input: { steer: .3, throttle: 0, brake: 0 } }), DEFAULT_ADAS_CONFIG, .2, 0, options);
  assert(out.status.blindSpotIntervention && out.steer > 0, 'BCA discarded curvature steering');
}
// HBA hysteresis 40-on / 25-off; oncoming traffic and camera loss dip immediately.
{
  const a = new ExtendedAssistance(); position(150, 0, 45 / 3.6);
  for (let i = 0; i < 22; i++) a.update(frame(), DEFAULT_ADAS_CONFIG, 0, 0, options);
  position(150, 0, 30 / 3.6); assert(a.update(frame(), DEFAULT_ADAS_CONFIG, 0, 0, options).status.highBeam);
  position(150, 0, 24 / 3.6); assert(!a.update(frame(), DEFAULT_ADAS_CONFIG, 0, 0, options).status.highBeam);
  position(150, 0, 50 / 3.6);
  for (let i = 0; i < 22; i++) a.update(frame(), DEFAULT_ADAS_CONFIG, 0, 0, options);
  assert(!a.update(frame({ obstacles: [obstacle(100, 3.7, -20)] }), DEFAULT_ADAS_CONFIG, 0, 0, options).status.highBeam);
  assert(!a.update(frame({ sensorAvailability: { camera: false } }), DEFAULT_ADAS_CONFIG, 0, 0, options).status.highBeam);
}
// Nonresponsive driver: staged warning -> controlled stop -> hold + hazards.
// A new deliberate action overrides the stop; this is NOT eye recognition.
{
  position(150, 0, 15); const a = new ExtendedAssistance();
  let out = a.update(frame(), DEFAULT_ADAS_CONFIG, 0, 1, { ...options, attentive: false });
  for (let i = 0; i < 160; i++) out = a.update(frame(), DEFAULT_ADAS_CONFIG, 0, 1, { ...options, attentive: false });
  assert(out.status.minimalRiskBraking && out.status.hazardRequest && out.accel <= -2);
  const restored = new ExtendedAssistance(); restored.restoreState(a.captureState()); position(150, 0, 0);
  assert.equal(restored.update(frame(), DEFAULT_ADAS_CONFIG, 0, 1, { ...options, attentive: false }).status.emergencyStopState, 'hold');
  out = restored.update(frame({ input: { steer: 0, throttle: .5, brake: 0 } }), DEFAULT_ADAS_CONFIG, 0, 1, { ...options, attentive: false });
  assert(!out.status.minimalRiskBraking && !out.status.hazardRequest);
}
// RCTA works stationary in R, rejects outward traffic and high reverse speed.
{
  position(150, 0, 0);
  const crossing = obstacle(-5, -4, 0, 4);
  assert(proximitySafety(ego, path, [crossing], true).rctaLeft);
  assert(!proximitySafety(ego, path, [crossing], false).rctaLeft);
  assert(!proximitySafety(ego, path, [{ ...crossing, vd: -4 }], true).rctaLeft);
  position(150, 0, 9 / 3.6); assert(!proximitySafety(ego, path, [crossing], true).rctaLeft);
  position(150, 0, 1); const parked = proximitySafety(ego, path, [obstacle(-6)], true);
  assert(parked.parkingBrake && !parked.rctaLeft && !parked.rctaRight);
}
// Integrated independent rear channel: front AEB switch/camera fault must not
// disable Rear AEB; holding the accelerator must not pulse it into the obstacle.
{
  const r = new Simulation({ trafficCount: 0 }); r.traffic.clear(); r.pedestrians.clear(); r.usePerception = false;
  r.setControlMode('adas'); r.ego.v = 0; assert(r.setGear('R'));
  r.adas.config.aeb = false; r.adas.config.pedalMitigation = false; r.sensorAvailability.camera = false;
  const p = r.path.toFrenet(r.ego.x, r.ego.y); r.traffic.addTestVehicle('stalled', r.road.laneOf(p.d), p.s - 7, 0, 0);
  for (let i = 0; i < 240; i++) { r.setDriverInput({ steer: 0, throttle: 1, brake: 0 }); r.step(1 / 60); }
  assert(r.telemetry.rearAeb && r.ego.v === 0 && r.metrics.collisions === 0);
  assert(r.adas.status.rctaArmed, 'RCTA arming depended on forward camera');
}
// A modern recorded nonresponse stop must survive reset/playback and remain
// stopped when returning to live simulation, including the injected driver state.
{
  const r = new Simulation({ trafficCount: 0 }); r.traffic.clear(); r.pedestrians.clear(); r.trafficLights = []; r.roadSigns = [];
  r.usePerception = false; r.setControlMode('adas');
  const p = r.path.toCartesian(150, 0); Object.assign(r.ego, { x: p.x, y: p.y, yaw: p.heading, v: 15 });
  r.driverAttentive = false;
  for (let i = 0; i < 26 * 60; i++) r.step(1 / 60);
  assert(r.adas.status.extra.minimalRiskBraking && r.ego.v === 0);
  r.startRecording(); for (let i = 0; i < 5; i++) r.step(1 / 60); r.stopRecording(); r.reset();
  assert(r.startReplay()); for (let i = 0; i < 7; i++) r.step(1 / 60);
  r.stopReplay(); r.paused = false; r.step(1 / 60);
  assert(!r.driverAttentive && r.adas.status.extra.minimalRiskBraking && r.ego.v === 0, 'replay lost the emergency-stop driver state');
}
// Parking interlocks and brake arbitration remain functional with injected faults.
{
  const p = new Simulation({ trafficCount: 0 }); p.prepareParkingLab(); p.usePerception = false;
  p.beltFastened = false; assert(!p.requestParking('apa'));
  p.beltFastened = true; assert(p.requestParking('apa'));
  for (let i = 0; i < 60; i++) { p.parkingAssist.hold(true); p.step(1 / 60); }
  p.sensorAvailability.ultrasonic = false;
  for (let i = 0; i < 60; i++) { p.parkingAssist.hold(true); p.step(1 / 60); }
  assert(p.parkingAssist.status.state === 'cancelled' && p.ego.v === 0);
}
console.log('ADAS REFERENCE PASS: ACC interlocks, independent faults, LFA/LKA, ALC domain, signal confirmation, ISA, HBA hysteresis, driver stop/override/replay, RCTA, Rear AEB and parking.');
