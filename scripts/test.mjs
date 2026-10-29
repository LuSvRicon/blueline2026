// Test runner — bundles each headless TypeScript check with esbuild and runs it
// with Node, so the suite needs no global ts loader. Exits non-zero on failure.

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TESTS = [
  "smoke",
  "all-scenarios-smoke",
  "vietnam-scenario-smoke",
  "vietnam-scenarios-test",
  "adas-test",
  "adas-reference-test",
  "adas-motorway-domain-test",
  "alc-all-speeds-test",
  "alc-indicator-repeat-test",
  "acc-aeb-handoff-test",
  "emergency-shoulder-test",
  "adas-regression-test",
  "high-speed-lane-test",
  "acc-curve-recovery-test",
  "handling-traffic-test",
  "driver-feedback-test",
  "audio-runtime-test",
  "adas-runtime-audit-test",
  "pedal-console-input-test",
  "parking-assist-test",
  "extended-adas-test",
  "adas-brake-test",
  "aeb-following-test",
  "driving-systems-test",
  "dynamics-collision-test",
  "render-geometry-test",
  "render-runtime-test",
  "render-motion-test",
  "sensor-visibility-test",
  "projection-cache-test",
  "runtime-recovery-test",
  "detailed-vehicle-test",
  "imported-vehicles-test",
  "imported-cabin-test",
  "view-quality-test",
  "cockpit-view-test",
  "cabin-look-test",
  "maps-traffic-test",
  "world-assets-test",
  "road-profiles-test",
  "planner-rear-clearance-test",
  "drive-input-test",
  "scenario-matrix-test",
  "network-matrix-test",
  "static-traffic-adas-test",
  "adas-features-test",
  "traffic-profile-test",
  "traffic-flow-test",
  "scenario-lab-test",
  "record-replay-test",
  "session-timeline-test",
  "lights-test",
  "weather-test",
  "road-sign-test",
  "learn-test",
  "evo-test",
];
const requested = process.argv.slice(2);
if (requested.some((name) => !TESTS.includes(name))) throw new Error("Unknown test name. Pass names from the TESTS list without extensions.");
const selected = requested.length ? TESTS.filter((name) => requested.includes(name)) : TESTS;

const outDir = mkdtempSync(join(tmpdir(), "blueline-tests-"));
const failed = [];
const started = Date.now();

for (const name of selected) {
  const outfile = join(outDir, `${name}.mjs`);
  process.stdout.write(`\n=== ${name} ===\n`);
  try {
    await build({
      entryPoints: [`scripts/${name}.ts`],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile,
      logLevel: "silent",
    });
    execFileSync(process.execPath, [outfile], { stdio: "inherit" });
  } catch {
    failed.push(name);
    console.error(`!!! ${name} FAILED`);
  }
}

rmSync(outDir, { recursive: true, force: true });
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (failed.length > 0) {
  console.error(`\nTEST SUITE FAILED (${failed.length}/${selected.length}) in ${seconds}s: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\nTEST SUITE PASS — ${selected.length} headless checks in ${seconds}s.`);
