import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Simulation } from '../src/sim/Simulation.ts';
import { wrapDiff } from '../src/core/math.ts';

export const auditEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
export const auditOutput = auditEnv.AUDIT_ARTIFACT_DIR ?? join(tmpdir(), 'blueline-runtime-audit-20261109');
export const auditDt = 1 / 60;
type Frame = Parameters<Simulation['recorder']['record']>[0];

/** A bounded diagnostic ring, not the all-session recorder. A failed case writes
 * both its seed/action parameters and a 30-second standard visual replay. */
export class AuditProbe {
  private trace: { time: number; value: Frame }[] = [];
  private steps = 0;
  private brakeConflictSeconds = 0;
  private clearHoldSeconds = 0;
  private previousX: number;
  private previousY: number;
  private previousCollisions: number;
  readonly observed = { maxTracks: 0, maxCars: 0, minHeapBytes: Infinity, maxHeapBytes: 0, maxStepMetres: 0 };
  phase = 'initial';

  constructor(readonly sim: Simulation, readonly key: string, readonly fixture: Record<string, unknown>) {
    this.previousX = sim.ego.x; this.previousY = sim.ego.y;
    this.previousCollisions = sim.metrics.collisions;
  }

  check(condition: unknown, message: string): void {
    if (condition) return;
    mkdirSync(auditOutput, { recursive: true });
    const filename = this.key.replace(/[^a-z0-9_-]/gi, '_');
    const replayBase = this.trace[0]?.time ?? 0;
    const replay = { version: 1, frames: this.trace.map(f => ({ time: f.time - replayBase + .2, value: f.value })) };
    const replayPath = join(auditOutput, `${filename}-replay.json`);
    if (replay.frames.length) writeFileSync(replayPath, JSON.stringify(replay));
    const detailsPath = join(auditOutput, `${filename}-failure.json`);
    writeFileSync(detailsPath, JSON.stringify({ key: this.key, message, phase: this.phase,
      simTime: this.sim.simTime, step: this.steps, fixture: this.fixture, observed: this.observed,
      rerun: this.key.startsWith('endurance-')
        ? { test: 'adas-endurance-test', env: { AUDIT_ENDURANCE_SECONDS: String(this.fixture.seconds),
          AUDIT_ENDURANCE_SEED: String(this.fixture.seed), AUDIT_ENDURANCE_TRACK: String(this.fixture.trackId) } }
        : { test: 'adas-noisy-sequence-test', env: { AUDIT_CASE: this.key, AUDIT_PROFILES: String(this.fixture.profile),
          AUDIT_WEATHERS: String(this.fixture.weather), AUDIT_SEEDS: String(this.fixture.seed) } },
      ego: { x: this.sim.ego.x, y: this.sim.ego.y, yaw: this.sim.ego.yaw, v: this.sim.ego.v,
        a: this.sim.ego.a, delta: this.sim.ego.delta, dimensions: this.sim.ego.dims },
      status: this.sim.adas.status, parking: this.sim.parkingAssist.status,
      traffic: this.sim.traffic.cars, replayPath,
      note: 'Replay is a visual snapshot trace; deterministic resimulation uses the fixture seed and script action schedule.' }, null, 2));
    throw new Error(`${this.key}: ${message}; phase=${this.phase}, t=${this.sim.simTime.toFixed(3)}; fixture=${detailsPath}`);
  }

  tick(): void {
    const sim = this.sim, ego = sim.ego, status = sim.adas.status;
    this.steps++;
    // Capture only at 5Hz. Calling the private snapshot builder in this test
    // deliberately avoids recording an hour of full-rate world snapshots.
    if (this.steps % 12 === 0) {
      const value = (sim as unknown as { captureFrame(): Frame }).captureFrame();
      this.trace.push({ time: sim.simTime, value });
      if (this.trace.length > 150) this.trace.shift();
    }
    this.check([ego.x, ego.y, ego.yaw, ego.v, ego.a, ego.delta, sim.simTime,
      sim.telemetry.requestedAccel ?? 0, status.adasBrakeForce].every(Number.isFinite), 'non-finite runtime value');
    this.check(ego.v >= 0 && ego.v <= ego.maxSpeed + .1, 'invalid speed');
    this.check(Math.abs(ego.delta) <= ego.maxSteer + 1e-6, 'steering actuator exceeded its limit');
    this.check(['P', 'R', 'N', 'D'].includes(sim.gear), 'invalid PRND state');
    this.check(status.adasBrakeForce >= 0 && status.adasBrakeForce <= 1 + 1e-6, 'invalid brake pressure');
    const stepMetres = Math.hypot(ego.x - this.previousX, ego.y - this.previousY);
    this.observed.maxStepMetres = Math.max(this.observed.maxStepMetres, stepMetres);
    this.check(stepMetres < 3, 'uncommanded world-position jump');
    this.previousX = ego.x; this.previousY = ego.y;

    const foot = sim.driverInput.brake * ego.maxDecel;
    this.check(foot <= 0 || (sim.telemetry.requestedAccel ?? 0) <= -foot + 1e-4,
      'a later controller weakened the foot-brake request');
    const conflict = status.adasBrakeForce > .15 && ego.requestedAccel > .2;
    this.brakeConflictSeconds = conflict ? this.brakeConflictSeconds + auditDt : 0;
    this.check(this.brakeConflictSeconds < .25, 'sustained propulsion while ADAS requests braking');

    if (status.aebHolding && ego.v < .05 && !sim.sensorFault) {
      const f = sim.path.toFrenet(ego.x, ego.y);
      const nearTraffic = sim.traffic.cars.some(c => {
        const ds = wrapDiff(c.s, f.s, sim.path.length);
        return ds > -1 && ds < 16 + c.length / 2 && Math.abs(c.d - f.d) < (c.width + ego.dims.width) / 2 + .8;
      });
      const nearPeds = sim.pedestrians.peds.some(p => p.state !== 'done' &&
        Math.abs(wrapDiff(p.s, f.s, sim.path.length)) < 16 && Math.abs(p.d - f.d) < ego.dims.width / 2 + 1.5);
      const nearStatic = [...sim.staticWorld.near(ego.x, ego.y, 16)].some(body => {
        const dx = body.x - ego.x, dy = body.y - ego.y;
        const ahead = dx * Math.cos(ego.yaw) + dy * Math.sin(ego.yaw);
        const across = -dx * Math.sin(ego.yaw) + dy * Math.cos(ego.yaw);
        return ahead > -1 && Math.abs(across) < ego.dims.width / 2 + Math.hypot(body.length, body.width) / 2 + .8;
      });
      this.clearHoldSeconds = nearTraffic || nearPeds || nearStatic ? 0 : this.clearHoldSeconds + auditDt;
    } else this.clearHoldSeconds = 0;
    this.check(this.clearHoldSeconds < 15, 'AEB HOLD remained latched with a clear physical corridor for 15 seconds');

    this.check(sim.metrics.collisions === this.previousCollisions,
      `ego contact in an explicitly avoidable fixture (${this.previousCollisions} -> ${sim.metrics.collisions})`);
    this.check(sim.metrics.offRoadTime < .1, 'ego left the paved/marked driving area');
    this.observed.maxTracks = Math.max(this.observed.maxTracks, sim.tracks.length);
    this.observed.maxCars = Math.max(this.observed.maxCars, sim.traffic.cars.length);
    if (this.steps % 600 === 0) {
      const heap = process.memoryUsage().heapUsed;
      this.observed.minHeapBytes = Math.min(this.observed.minHeapBytes, heap);
      this.observed.maxHeapBytes = Math.max(this.observed.maxHeapBytes, heap);
    }
  }
}

export function saveAuditSummary(name: string, data: unknown): void {
  mkdirSync(auditOutput, { recursive: true });
  writeFileSync(join(auditOutput, `${name}.json`), JSON.stringify(data, null, 2));
}
