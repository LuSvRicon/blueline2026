// Verify captured simulation state can be played back to its exact final frame.

import { Simulation } from "../src/sim/Simulation.ts";

function fail(message: string): never {
  console.error("RECORD-REPLAY-TEST FAIL:", message);
  process.exit(1);
}

const sim = new Simulation();
sim.usePerception = false;
sim.traffic.cars = [];
sim.setControlMode("manual");
sim.setDriverInput({ steer: 0.16, throttle: 0.65, brake: 0 });
sim.startRecording();
for (let i = 0; i < 180; i++) sim.step(1 / 60);
sim.stopRecording();

const frames = sim.recorder.frames.length;
if (frames !== 180) fail(`expected 180 recorded frames, got ${frames}`);
const final = { x: sim.ego.x, y: sim.ego.y, yaw: sim.ego.yaw, v: sim.ego.v };
const finalDistance = sim.telemetry.distanceTravelled;
const exported = JSON.parse(sim.exportRecordedSession()) as { version?: number; frames?: unknown[] };
if (exported.version !== 1 || exported.frames?.length !== frames) fail("session export did not include the recorded frames");

sim.reset();
if (!sim.startReplay()) fail("replay did not start with a recorded session");
for (let i = 0; i < frames + 2; i++) sim.step(1 / 60);

if (!sim.paused) fail("replay did not pause at the last recorded frame");
if (Math.abs(sim.ego.x - final.x) > 1e-9 || Math.abs(sim.ego.y - final.y) > 1e-9) fail("replay final position differs from the recorded final frame");
if (Math.abs(sim.ego.yaw - final.yaw) > 1e-9 || Math.abs(sim.ego.v - final.v) > 1e-9) fail("replay final heading or speed differs from the recording");
if (Math.abs(sim.telemetry.distanceTravelled - finalDistance) > 1e-9) fail("replay did not restore recorded telemetry");

console.log(`record/replay: ${frames} frames, ${(finalDistance / 1000).toFixed(2)} km, exact final state restored`);
console.log("\nRECORD-REPLAY-TEST PASS — session snapshots and replay stay synchronized.");
