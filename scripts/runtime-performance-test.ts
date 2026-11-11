import assert from 'node:assert/strict';
import { RuntimePerformance } from '../src/diagnostics/RuntimePerformance.ts';
import { Simulation } from '../src/sim/Simulation.ts';

const monitor = new RuntimePerformance(4);
const counters = { calls: 12, triangles: 300, geometries: 4, textures: 2 };
for (const ms of [10, 20, 30, 400]) monitor.record(ms, 5, counters, 1024);
assert.equal(monitor.snapshot().frameP95Ms, 400, 'Long browser stalls were capped to physics delta');
assert.equal(monitor.snapshot().fps, 4 * 1000 / 460);
assert.equal(monitor.snapshot().longFramesOver50Ms, 1);
for (let i = 0; i < 100000; i++) monitor.record(16, 4, counters, 2048);
assert.equal(monitor.snapshot().samples, 4, 'Long sessions accumulated an unbounded frame history');
assert.equal(monitor.snapshot().frameP95Ms, 16);
assert.equal(monitor.snapshot().worstFrameMs, 400, 'Rolling history erased the session worst stall');
assert.equal(monitor.snapshot().peakJsHeapBytes, 2048);
const exported = monitor.snapshot(); exported.render.calls = 999;
assert.equal(monitor.snapshot().render.calls, 12, 'An exported report mutated live counters');
const before = monitor.snapshot().frames;
monitor.record(Number.NaN, 4, counters); monitor.record(16, -1, counters);
assert.equal(monitor.snapshot().frames, before);

// Normal play must not construct full recording snapshots on every physics
// tick. Recording still captures real complete frames at its configured rate.
const sim = new Simulation({trafficCount: 0});
const internal = sim as unknown as { captureFrame: () => unknown };
const capture = internal.captureFrame.bind(sim);
let captures = 0;
internal.captureFrame = () => { captures++; return capture(); };
for (let i = 0; i < 60; i++) sim.step(1 / 60);
assert.equal(captures, 0, 'Inactive recording allocated complete session frames');
sim.startRecording();
for (let i = 0; i < 60; i++) sim.step(1 / 60);
sim.stopRecording();
assert(captures > 0 && sim.recorder.frames.length > 0, 'Performance guard broke session recording');
console.log('RUNTIME PERFORMANCE PASS — measured raw stalls, bounded history, immutable export and lazy recording snapshots.');
