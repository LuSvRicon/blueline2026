import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/Simulation.ts';
for (const perception of [false, true]) {
  const sim = new Simulation({ trackId: 'motorway', trafficCount: 0 });
  sim.setControlMode('adas'); sim.usePerception = perception;
  sim.setTrafficCount(0); sim.ego.v = 25; sim.setAccSpeedKph(90);
  const start = sim.road.laneOf(sim.path.toFrenet(sim.ego.x, sim.ego.y).d);
  sim.toggleIndicator(1);
  let active = false, completed = false;
  const reasons = new Set<string>();
  for (let i = 0; i < 10 * 60; i++) {
    sim.step(1 / 60); active ||= sim.adas.status.alc === 'active'; completed ||= sim.adas.status.alcComplete;
    if (sim.adas.status.alcReason) reasons.add(sim.adas.status.alcReason);
  }
  const lane = sim.road.laneOf(sim.path.toFrenet(sim.ego.x, sim.ego.y).d);
  console.log({ perception, start, lane, active, completed, reasons: [...reasons], collisions: sim.metrics.collisions });
  if (!completed) console.log('Nearby target-lane observations', (sim as any).lastObstacles.filter((o: any) => Math.abs(o.d - sim.road.laneCenter(start + 1)) < 3).slice(0, 8));
  assert(active && completed && lane === start + 1, 'eligible empty motorway lane change failed with the actual road/sensor pipeline');
  assert(sim.indicator === 0 && sim.metrics.collisions === 0);
}
// The boundary classification must not hide a real construction barrier in
// the destination lane, or disable braking towards the median itself.
{
  const sim = new Simulation({ trackId: 'motorway', trafficCount: 0 }); sim.setControlMode('adas'); sim.ego.v = 25; sim.setAccSpeedKph(90);
  const p = sim.path.toFrenet(sim.ego.x, sim.ego.y), lane = sim.road.laneOf(p.d) + 1;
  const w = sim.path.toCartesian(p.s + 25, sim.road.laneCenter(lane));
  sim.staticWorld.add({ id: 'construction-block', kind: 'barrier', x: w.x, y: w.y, yaw: w.heading, length: 3, width: 3 });
  sim.toggleIndicator(1); let blocked = false;
  for (let i = 0; i < 80; i++) { sim.step(1 / 60); blocked ||= sim.adas.status.alc === 'blocked' || sim.adas.status.alcAborted; }
  assert(blocked && sim.metrics.collisions === 0, 'construction barrier was mistaken for a continuous mapped guardrail');
}
{
  const sim = new Simulation({ trackId: 'motorway', trafficCount: 0 }); sim.setControlMode('adas');
  sim.adas.config.acc = sim.adas.config.laneCentering = sim.adas.config.laneKeeping = sim.adas.config.emergencyLaneKeeping = false;
  const w = sim.path.toCartesian(150, sim.road.laneCenter(1)); Object.assign(sim.ego, { x: w.x, y: w.y, yaw: w.heading, v: 12 });
  sim.tracker.reset(); sim.tracks = []; sim.setDriverInput({ steer: .25, throttle: .5, brake: 0 });
  let braked = false;
  for (let i = 0; i < 60; i++) { sim.step(1 / 60); braked ||= sim.adas.status.aeb; }
  assert(braked && sim.ego.v < 12, 'mapped guardrail disappeared from emergency braking');
}
console.log('MOTORWAY DOMAIN PASS: clear lane with noisy perception, construction rejection and median braking.');
