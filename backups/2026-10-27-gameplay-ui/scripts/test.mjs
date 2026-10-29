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
  "adas-brake-test",
  "driving-systems-test",
  "adas-features-test",
  "traffic-profile-test",
  "scenario-lab-test",
  "record-replay-test",
  "lights-test",
  "weather-test",
  "road-sign-test",
  "learn-test",
  "evo-test",
];

const outDir = mkdtempSync(join(tmpdir(), "blueline-tests-"));
const failed = [];
const started = Date.now();

for (const name of TESTS) {
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
  console.error(`\nTEST SUITE FAILED (${failed.length}/${TESTS.length}) in ${seconds}s: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\nTEST SUITE PASS — ${TESTS.length} headless checks in ${seconds}s.`);
