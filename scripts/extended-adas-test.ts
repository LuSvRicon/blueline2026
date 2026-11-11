import { ExtendedAssistance } from "../src/sim/ExtendedAssistance.ts";
import { ADASFrame, DEFAULT_ADAS_CONFIG } from "../src/sim/ADAS.ts";
import { Simulation } from "../src/sim/Simulation.ts";
function check(ok: boolean, text: string) { if (!ok) throw new Error(text); }
const sim = new Simulation({ trafficCount: 0 }); sim.traffic.clear(); sim.pedestrians.clear();
const f = sim.path.toFrenet(sim.ego.x, sim.ego.y);
const config = { ...DEFAULT_ADAS_CONFIG };
const base: ADASFrame = { ego: sim.ego, egoS: f.s, egoD: f.d, path: sim.path, road: sim.road, obstacles: [], desiredSpeed: 20,
  input: { steer: 0, throttle: 0, brake: 0 }, dt: .1, speedControl: e => e };
const options = { gear: "D", night: true, weather: "clear", attentive: true, handsOn: true, fatigued: false };
const obstacle = (s: number, d: number, v = 0) => ({ s: f.s + s, d: f.d + d, v, vd: 0, length: 4.6, width: 1.9, kind: "car" as const });
let a = new ExtendedAssistance();
sim.ego.v = 0;
check(a.update({ ...base, obstacles: [obstacle(-25, -3.7, 12)] }, config, 0, 0, options).status.safeExitLeft, "SEA missed approaching left traffic");
check(!a.update({ ...base, obstacles: [obstacle(-55, 3.7, 2)] }, config, 0, 0, options).status.safeExitRight, "SEA warned for distant slow car");
check(!a.update({ ...base, obstacles: [obstacle(-2, -3.7, 0)] }, config, 0, 0, options).status.safeExitLeft, "SEA falsely locked door for stationary parked car beside ego");
const pmc = a.update({ ...base, obstacles: [obstacle(6, 0)], input: { steer: 0, throttle: 1, brake: 0 } }, config, 0, 3.5, options);
check(pmc.status.pedalMitigation && pmc.accel === -sim.ego.maxDecel, "PMC failed held full throttle near obstacle");
config.pedalMitigation = false;
check(!a.update({ ...base, obstacles: [obstacle(6, 0)], input: { steer: 0, throttle: 1, brake: 0 } }, config, 0, 3.5, options).status.pedalMitigation, "PMC toggle ineffective");
let departed = false;
for (let i = 0; i < 25; i++) a.update({ ...base, obstacles: [obstacle(10, 0)] }, config, 0, 0, options);
for (let i = 0; i < 20; i++) departed ||= a.update({ ...base, obstacles: [obstacle(10 + i * .2, 0, 2)] }, config, 0, 0, options).status.leadDeparture;
check(departed, "FDA missed departure after wait");
sim.ego.v = 15;
let high = false;
for (let i = 0; i < 25; i++) high = a.update(base, config, 0, 0, options).status.highBeam;
check(high, "HBA failed to select high beam");
check(!a.update({ ...base, obstacles: [obstacle(100, 0, -15)] }, config, 0, 0, options).status.highBeam, "HBA failed to dip immediately for oncoming car");
let last = a.update(base, config, 0, 0, options);
for (let i = 0; i < 165; i++) last = a.update(base, config, 0, 1, { ...options, attentive: false });
check(last.status.driverWarning === "takeover" && last.status.minimalRiskBraking && last.accel <= -2, "DMS scripted attention did not escalate/brake");
sim.ego.v = 0;
for (let i = 0; i < 30; i++) last = a.update(base, config, 0, 3.5, { ...options, attentive: false });
check(last.status.minimalRiskBraking && last.accel <= -2, "driver-monitor stop released at standstill while still inattentive");
check(a.update(base, config, 0, 0, options).status.driverWarning === "none", "DMS did not clear after attentive input");
sim.ego.v = 15;
const bca = a.update({ ...base, obstacles: [obstacle(-3, 2.3, 18)], input: { steer: .3, throttle: 0, brake: 0 } }, config, .3, 0, options);
check(bca.status.blindSpotIntervention && bca.steer < 0, "BCA failed inward correction");
const strong = a.update({ ...base, obstacles: [obstacle(-3, 2.3, 18)], input: { steer: 1, throttle: 0, brake: 0 } }, config, sim.ego.maxSteer, 0, options);
check(strong.steer === sim.ego.maxSteer, "BCA defeated full driver takeover");
const s = 150, edge = sim.road.totalWidth / 2 - sim.ego.dims.width / 2;
const w = sim.path.toCartesian(s, edge - .1); sim.ego.x = w.x; sim.ego.y = w.y; sim.ego.yaw = w.heading + .1;
check(a.update({ ...base, egoS: s, egoD: edge - .1 }, config, 0, 0, options).status.emergencyLaneKeeping, "ELK missed predicted road-edge departure");
// Door interlock is exercised through the integrated simulation, including P.
sim.setControlMode("adas"); sim.ego.v = 0; sim.setGear("P"); sim.usePerception = false;
sim.traffic.addTestVehicle("car", 0, s - 15, 14, 14);
sim.step(.1);
// Simulate an explicit unsafe side result, independent of the chosen lane in this geometry.
sim.adas.status.extra.safeExitLeft = true;
check(!sim.requestDoor("left"), "SEA did not inhibit unsafe opening");
sim.adas.status.extra.safeExitLeft = false;
check(sim.requestDoor("left") && !sim.setGear("D"), "open door did not lock drive selection");
check(sim.requestDoor("left") && sim.setGear("D"), "door close did not restore shift");

// High-speed (>130 km/h) collision avoidance & Evasive Steering Assist (ESA):
// 1. When all adjacent lanes are occupied/blocked at >130 km/h and braking distance is
//    insufficient, ADAS must NOT swerve into adjacent traffic; it maintains straight-line AEB.
{
  const hSim = new Simulation({ trackId: "motorway", trafficCount: 0 });
  hSim.setControlMode("adas");
  hSim.traffic.clear();
  hSim.pedestrians.clear();
  hSim.usePerception = false;
  const startS = 500;
  const lane = 1;
  const laneD = hSim.road.laneCenter(lane);
  const p = hSim.path.toCartesian(startS, laneD);
  Object.assign(hSim.ego, { x: p.x, y: p.y, yaw: p.heading, v: 138 / 3.6 });
  (hSim as any).lastEgoIndex = -1;
  hSim.setDesiredSpeed(138 / 3.6);
  const stalled = hSim.traffic.addTestVehicle("stalled", lane, startS + 55, 0, 0);
  stalled.d = laneD;
  // Block both adjacent lanes (lane 0 and lane 2) so ESA cannot safely swerve
  const blockLeft = hSim.traffic.addTestVehicle("car", 0, startS + 18, 30, 30);
  blockLeft.d = hSim.road.laneCenter(0);
  const blockRight = hSim.traffic.addTestVehicle("car", 2, startS + 18, 30, 30);
  blockRight.d = hSim.road.laneCenter(2);
  let maxLat = 0;
  let sawAeb = false;
  for (let i = 0; i < 180; i++) {
    hSim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
    hSim.step(1 / 60);
    sawAeb ||= hSim.adas.status.aeb;
    if (hSim.metrics.collisions > 0) break;
    const fAfter = hSim.path.toFrenet(hSim.ego.x, hSim.ego.y);
    maxLat = Math.max(maxLat, Math.abs(fAfter.d - laneD));
  }
  check(sawAeb && maxLat < 0.05 && !hSim.adas.status.extra.evasiveSteering, `ADAS swerved into occupied adjacent lanes at >130 km/h (sawAeb=${sawAeb}, maxLat=${maxLat.toFixed(3)})`);
}

// 2. When the driver initiates an evasive steering input after AEB has already latched
//    at 138 km/h (even on wet road), ESA assists steering into the clear adjacent lane,
//    modulates braking for lateral tire grip, and releases the AEB latch once the path clears.
{
  const hSim = new Simulation({ trackId: "motorway", trafficCount: 0 });
  hSim.setControlMode("adas");
  hSim.setWeather("rain");
  hSim.traffic.clear();
  hSim.pedestrians.clear();
  hSim.usePerception = false;
  const startS = 500;
  const lane = 1;
  const laneD = hSim.road.laneCenter(lane);
  const targetD = hSim.road.laneCenter(0);
  const p = hSim.path.toCartesian(startS, laneD);
  Object.assign(hSim.ego, { x: p.x, y: p.y, yaw: p.heading, v: 138 / 3.6 });
  (hSim as any).lastEgoIndex = -1;
  hSim.setDesiredSpeed(138 / 3.6);
  const stalled = hSim.traffic.addTestVehicle("stalled", lane, startS + 48, 0, 0);
  stalled.d = laneD;
  let sawAeb = false;
  let sawEsa = false;
  let aebReleasedAfterSwerve = false;
  for (let i = 0; i < 180; i++) {
    const fNow = hSim.path.toFrenet(hSim.ego.x, hSim.ego.y);
    // Hold slight throttle for the first 12 frames so automatic hands-free ESA does not pre-empt the driver's reaction test
    const throttle = i < 12 ? 0.1 : 0;
    let steer = 0;
    if (i >= 12) {
      // Driver reacts 0.2s after AEB starts and steers toward lane 0, then lets LFA/ESA stabilize in the new lane
      steer = fNow.d > targetD + 0.85 ? -0.18 : 0;
    }
    hSim.setDriverInput({ steer, throttle, brake: 0 });
    hSim.step(1 / 60);
    if (hSim.adas.status.aeb) sawAeb = true;
    if (hSim.adas.status.extra.evasiveSteering) sawEsa = true;
    const fAfter = hSim.path.toFrenet(hSim.ego.x, hSim.ego.y);
    if (sawAeb && !hSim.adas.status.aeb && hSim.ego.v > 10) {
      aebReleasedAfterSwerve = true;
    }
    if (fAfter.s > startS + 55 || hSim.metrics.collisions > 0) break;
  }
  check(sawAeb, "AEB did not trigger initially at 138 km/h");
  check(sawEsa, "ESA did not assist driver evasive steering at 138 km/h");
  check(aebReleasedAfterSwerve, `AEB stayed latched after evasive steering cleared the obstacle path (endAeb=${hSim.adas.status.aeb}, endV=${(hSim.ego.v * 3.6).toFixed(1)}, endD=${hSim.path.toFrenet(hSim.ego.x, hSim.ego.y).d.toFixed(2)}, targetD=${targetD.toFixed(2)}, collisions=${hSim.metrics.collisions})`);
  check(hSim.metrics.collisions === 0, `High-speed evasive swerve collided (${hSim.metrics.collisions})`);
  check(hSim.ego.v * 3.6 > 80, `AEB remained locked and scrubbed excessive speed (${(hSim.ego.v * 3.6).toFixed(1)} km/h)`);

  // Hands-free automatic high-speed evasive steering (>130 km/h, zero driver steering input)
  // when stopping distance is physically insufficient (`gap < pureStopDist * 0.92`).
  const autoSim = new Simulation({ trackId: "motorway", trafficCount: 0 });
  autoSim.traffic.clear();
  autoSim.pedestrians.clear();
  autoSim.setControlMode("adas");
  autoSim.usePerception = false;
  Object.assign(autoSim. ego, { x: p.x, y: p.y, yaw: p.heading, v: 138 / 3.6 });
  (autoSim as any).lastEgoIndex = -1;
  autoSim.setDesiredSpeed(138 / 3.6);
  autoSim.setAccSpeedKph(138);
  const autoStalled = autoSim.traffic.addTestVehicle("stalled", lane, startS + 48, 0, 0);
  autoStalled.d = laneD;
  let autoSawEsa = false;
  for (let i = 0; i < 180; i++) {
    autoSim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
    autoSim.step(1 / 60);
    if (autoSim.adas.status.extra.evasiveSteering) autoSawEsa = true;
    const fAfter = autoSim.path.toFrenet(autoSim.ego.x, autoSim.ego.y);
    if (fAfter.s > startS + 65 || autoSim.metrics.collisions > 0) break;
  }
  const autoEndD = autoSim.path.toFrenet(autoSim.ego.x, autoSim.ego.y).d;
  check(autoSawEsa, "Automatic high-speed ESA did not trigger without driver steering at 138 km/h");
  check(autoSim.metrics.collisions === 0, `Automatic high-speed ESA collided (${autoSim.metrics.collisions})`);
  check(Math.abs(autoEndD - targetD) < 0.85, `Automatic high-speed ESA did not move into the adjacent lane (endD=${autoEndD.toFixed(2)}, targetD=${targetD.toFixed(2)})`);

  // Even when AEB is explicitly turned OFF (`config.aeb = false`), running at >130 km/h
  // where stopping distance is insufficient still triggers automatic evasive steering
  // into a clear adjacent lane (since LFA/LKA lateral assistance is active).
  const noAebSim = new Simulation({ trackId: "motorway", trafficCount: 0 });
  noAebSim.traffic.clear();
  noAebSim.pedestrians.clear();
  noAebSim.setControlMode("adas");
  noAebSim.adas.config.aeb = false;
  noAebSim.usePerception = false;
  Object.assign(noAebSim.ego, { x: p.x, y: p.y, yaw: p.heading, v: 138 / 3.6 });
  (noAebSim as any).lastEgoIndex = -1;
  noAebSim.setDesiredSpeed(138 / 3.6);
  noAebSim.setAccSpeedKph(138);
  const noAebStalled = noAebSim.traffic.addTestVehicle("stalled", lane, startS + 48, 0, 0);
  noAebStalled.d = laneD;
  let noAebSawEsa = false;
  for (let i = 0; i < 180; i++) {
    noAebSim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
    noAebSim.step(1 / 60);
    if (noAebSim.adas.status.extra.evasiveSteering) noAebSawEsa = true;
    const fAfter = noAebSim.path.toFrenet(noAebSim.ego.x, noAebSim.ego.y);
    if (fAfter.s > startS + 65 || noAebSim.metrics.collisions > 0) break;
  }
  const noAebEndD = noAebSim.path.toFrenet(noAebSim.ego.x, noAebSim.ego.y).d;
  check(noAebSawEsa, "Automatic high-speed ESA did not trigger when AEB was turned off at 138 km/h");
  check(!noAebSim.adas.status.aeb, "AEB should remain false when AEB is disabled");
  check(noAebSim.metrics.collisions === 0, `High-speed ESA with AEB off collided (${noAebSim.metrics.collisions})`);
  check(Math.abs(noAebEndD - targetD) < 0.85, `High-speed ESA with AEB off did not move into the adjacent lane (endD=${noAebEndD.toFixed(2)}, targetD=${targetD.toFixed(2)})`);
}
console.log("Extended ADAS: SEA/door interlock, PMC, FDA, HBA, scripted DMS escalation, BCA driver authority, ELK and high-speed ESA PASS");
