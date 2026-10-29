import { Simulation } from "../src/sim/Simulation.ts";
function check(ok: boolean, message: string) { if (!ok) throw new Error(message); }
const dt = 1 / 60;
for (const trackId of ["city", "boulevard", "ring-road"] as const) for (const perception of [false, true]) {
  const sim = new Simulation({ trackId, trafficCount: 0 }); sim.usePerception = perception; sim.prepareParkingLab();
  check(sim.requestParking("apa"), `APA could not find free bay (perception=${perception})`);
  const bay = sim.parkingBays.find(b => b.id === sim.parkingAssist.status.bayId)!;
  const gears = new Set<string>(); let maxSteer = 0;
  for (let i = 0; i < 75 * 60 && sim.parkingAssist.status.state !== "complete"; i++) {
    sim.parkingAssist.hold(true); sim.step(dt); gears.add(sim.gear); maxSteer = Math.max(maxSteer, Math.abs(sim.ego.delta));
    if (["cancelled", "blocked"].includes(sim.parkingAssist.status.state)) throw new Error(sim.parkingAssist.status.message);
  }
  const goal = sim.path.toCartesian(bay.s, bay.d), error = Math.hypot(sim.ego.x - goal.x, sim.ego.y - goal.y);
  console.log(`APA ${trackId}/${perception ? "tracks" : "reference"}: ${sim.parkingAssist.status.state}, error=${error.toFixed(2)}, gear=${sim.gear}, collisions=${sim.metrics.collisions}`);
  check(sim.parkingAssist.status.state === "complete" && error < .35 && sim.ego.v === 0, "APA failed actual closed-loop parking");
  check(gears.has("D") && gears.has("R") && sim.gear === "P" && sim.epbEngaged && maxSteer > .05, "APA did not coordinate actuators");
  check(sim.metrics.collisions === 0, "APA collided");
  check(sim.metrics.offRoadTime === 0, "legal marked parking was penalised as off-road");
}
for (const direction of ["remote-forward", "remote-reverse"] as const) {
  const sim = new Simulation({ trafficCount: 0 }); sim.prepareParkingLab(); sim.traffic.clear(); sim.usePerception = false;
  sim.step(dt); sim.setGear("P"); sim.setEngineRunning(false);
  check(sim.requestParking(direction), "RPA could not prepare");
  for (let i = 0; i < 60; i++) { sim.parkingAssist.hold(true); sim.step(dt); }
  const moving = sim.ego.v;
  check(moving > .3 && sim.engineOn, "RPA did not start engine/propel");
  // No heartbeat delivered: emulate link loss, with simulation still running.
  for (let i = 0; i < 60; i++) sim.step(dt);
  check(sim.ego.v === 0 && sim.parkingAssist.status.state === "paused", "RPA failed heartbeat-loss stop");
  for (let i = 0; i < 20 * 60 && sim.parkingAssist.status.state !== "complete"; i++) { sim.parkingAssist.hold(true); sim.step(dt); }
  check(sim.parkingAssist.status.state === "complete" && sim.gear === "P" && sim.epbEngaged, "RPA did not finish in P");
}
{
  const sim = new Simulation({ trafficCount: 0 }); sim.prepareParkingLab(); sim.usePerception = false;
  check(sim.requestParking("apa"), "APA setup");
  for (let i = 0; i < 30; i++) { sim.parkingAssist.hold(true); sim.step(dt); }
  sim.sensorFault = true;
  for (let i = 0; i < 90; i++) { sim.parkingAssist.hold(true); sim.step(dt); }
  check(sim.ego.v === 0 && sim.parkingAssist.status.state === "cancelled", "parking ignored sensor failure");
}
{
  const sim = new Simulation({ trafficCount: 0 }); sim.prepareParkingLab(); sim.usePerception = false;
  check(sim.requestParking("apa"), "APA intrusion setup");
  for (let i = 0; i < 60; i++) { sim.parkingAssist.hold(true); sim.step(dt); }
  const f = sim.path.toFrenet(sim.ego.x, sim.ego.y);
  const o = sim.traffic.addTestVehicle("stalled", sim.road.laneOf(f.d), f.s + 6, 0, 0); o.d = f.d;
  for (let i = 0; i < 120; i++) { sim.parkingAssist.hold(true); sim.step(dt); }
  check(sim.parkingAssist.status.state === "cancelled" && sim.ego.v === 0 && sim.metrics.collisions === 0, "APA failed to stop for new obstacle");
}
{
  const sim = new Simulation({ trafficCount: 0 }); sim.prepareParkingLab(); sim.usePerception = false;
  sim.requestParking("apa"); sim.startRecording();
  for (let i = 0; i < 60; i++) { sim.parkingAssist.hold(true); sim.step(dt); }
  sim.stopRecording(); check(sim.startReplay(), "parking replay unavailable");
  for (let i = 0; i < 70; i++) sim.step(dt);
  check(sim.parkingBays.length === 3, "replay lost marked bay geometry");
  sim.paused = false;
  for (let i = 0; i < 120; i++) sim.step(dt);
  check(sim.ego.v === 0 && sim.parkingAssist.status.state === "cancelled", "replay resumed a missing parking controller");
}
console.log("Parking assist: actual D/R trajectory, sensors, remote start, hold/release/link loss and sensor-fault stop PASS");
