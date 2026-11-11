import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { Scene } from "../src/render/Scene.ts";

type Internals = {
  handleContextLost(event: Event): void;
  handleContextRestored(): void;
  environmentTargets: THREE.WebGLRenderTarget[];
  pmrem: THREE.PMREMGenerator;
  envNight: THREE.Texture;
  envDay: THREE.Texture;
};
const internals = (scene: Scene) => scene as unknown as Internals;
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const oldTimeout = Object.getOwnPropertyDescriptor(globalThis, "setTimeout");
const originalFrom = THREE.PMREMGenerator.prototype.fromEquirectangular;
const originalDispose = THREE.PMREMGenerator.prototype.dispose;
const failures: string[] = [];
let groups = 0;
const check = (name: string, run: () => void) => {
  try { run(); groups++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
};
const restoreGlobal = (name: string, original: PropertyDescriptor | undefined) => {
  if (original) Object.defineProperty(globalThis, name, original); else Reflect.deleteProperty(globalThis, name);
};
const gradient = { addColorStop: () => {} };
Object.defineProperty(globalThis, "document", { configurable: true, value: {
  createElement: () => ({ width: 0, height: 0, getContext: () => ({
    createLinearGradient: () => gradient, createRadialGradient: () => gradient, fillRect: () => {},
  }) }),
} });

interface Generated {
  target: THREE.WebGLRenderTarget;
  source: THREE.Texture;
  sourceDisposals: number;
  targetDisposals: number;
}
let generated: Generated[] = [], generationCalls = 0, failAt = Infinity;
const generatorDisposals = new Map<THREE.PMREMGenerator, number>();
THREE.PMREMGenerator.prototype.fromEquirectangular = function(source: THREE.Texture) {
  generationCalls++;
  assert.equal(source.mapping, THREE.EquirectangularReflectionMapping, "PMREM source is not equirectangular");
  assert.equal(source.colorSpace, THREE.SRGBColorSpace, "PMREM source has wrong color space");
  const record: Generated = { target: new THREE.WebGLRenderTarget(16, 16), source, sourceDisposals: 0, targetDisposals: 0 };
  // Record source disposal before injecting failure, so try/finally is tested
  // even when generation never returns its target to the scene.
  source.addEventListener("dispose", () => record.sourceDisposals++);
  record.target.addEventListener("dispose", () => record.targetDisposals++);
  generated.push(record);
  if (generationCalls === failAt) {
    // A thrown generator owns its own partial target. Scene is responsible for
    // the source texture and targets returned by earlier successful calls.
    record.target.dispose();
    throw new Error("injected PMREM generation failure");
  }
  return record.target;
};
THREE.PMREMGenerator.prototype.dispose = function() {
  generatorDisposals.set(this, (generatorDisposals.get(this) ?? 0) + 1);
  originalDispose.call(this);
};

function fixture(timeOfDay: "day" | "night" = "day", failure?: "composer" | "quality") {
  generated = []; generationCalls = 0; failAt = Infinity;
  const scene = Object.create(Scene.prototype) as Scene;
  let oldGeneratorDisposals = 0, oldTargetDisposals = 0, resets = 0, quality = 0, renderCalls = 0, compileCalls = 0;
  const oldTargets = [new THREE.WebGLRenderTarget(8, 8), new THREE.WebGLRenderTarget(8, 8)];
  oldTargets.forEach(target => target.addEventListener("dispose", () => oldTargetDisposals++));
  const oldGenerator = { dispose: () => oldGeneratorDisposals++ };
  const callbacks: string[] = [];
  Object.assign(scene, {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), graphicsState: "ready", graphicsError: "old error",
    effectiveQuality: "ultra", qualityMode: "ultra", cameraMode: "cockpit", timeOfDay,
    environmentTargets: oldTargets, envDay: oldTargets[0].texture, envNight: oldTargets[1].texture, pmrem: oldGenerator,
    renderer: { compile: () => compileCalls++, render: () => renderCalls++ },
    composer: {
      reset: () => { resets++; if (failure === "composer") throw new Error("injected composer reset failure"); },
      render: () => renderCalls++,
    },
    applyQualityTier: (tier: string) => {
      quality++; assert.equal(tier, "ultra", "recovery silently lowered requested quality");
      if (failure === "quality") throw new Error("injected quality rebuild failure");
    },
  });
  scene.scene.environment = oldTargets[0].texture;
  scene.onGraphicsStateChange = state => {
    callbacks.push(state);
    if (state !== "ready") {
      const before = renderCalls;
      scene.render();
      scene.renderSurroundView({ getBoundingClientRect: () => { throw new Error("surround accessed the DOM while GPU unavailable"); } } as unknown as HTMLCanvasElement, 0, 0, 0, "360");
      assert.equal(renderCalls, before, "rendering continued inside GPU state-change callback");
    }
  };
  return { scene, callbacks, oldGenerator,
    counts: () => ({ oldGeneratorDisposals, oldTargetDisposals, resets, quality, renderCalls, compileCalls }),
  };
}

try {
  for (const time of ["day", "night"] as const) check(`loss, ${time} environment rebuild, render restart and second recovery`, () => {
    const f = fixture(time), state = internals(f.scene);
    const event = new Event("webglcontextlost", { cancelable: true });
    state.handleContextLost(event);
    assert(event.defaultPrevented, "loss listener must permit browser context restoration");
    assert.equal(f.scene.graphicsState, "lost");
    assert.deepEqual(f.callbacks, ["lost"]);
    const priorEnvironment = f.scene.scene.environment;
    state.handleContextRestored();
    assert.equal(f.scene.graphicsState, "ready"); assert.equal(f.scene.graphicsError, "");
    assert.deepEqual(f.callbacks, ["lost", "restoring", "ready"]);
    assert.equal(f.counts().resets, 1); assert.equal(f.counts().quality, 1);
    assert.equal(f.counts().oldTargetDisposals, 2, "old environment targets leaked");
    assert.equal(f.counts().oldGeneratorDisposals, 1, "old PMREM generator leaked");
    assert.equal(f.counts().compileCalls, 1, "PMREM generator was not recreated");
    assert.notEqual(state.pmrem, f.oldGenerator);
    assert.equal(state.environmentTargets.length, 2);
    assert.notEqual(f.scene.scene.environment, priorEnvironment, "scene kept the invalid old environment");
    assert.equal(f.scene.scene.environment, time === "day" ? state.envDay : state.envNight);
    assert(generated.every(record => record.sourceDisposals === 1 && record.targetDisposals === 0), "rebuilt source/target ownership is wrong");
    f.scene.render(); assert.equal(f.counts().renderCalls, 1, "main composer did not resume");
    const firstGenerator = state.pmrem, firstTargets = [...state.environmentTargets], firstRecords = [...generated];
    state.handleContextLost(new Event("webglcontextlost", { cancelable: true })); state.handleContextRestored();
    assert.equal(f.scene.graphicsState, "ready");
    assert.equal(generatorDisposals.get(firstGenerator), 1, "second recovery leaked/reused the first generator");
    assert(firstRecords.every(record => record.targetDisposals === 1), "second recovery did not dispose the first rebuilt environments");
    assert(state.environmentTargets.every(target => !firstTargets.includes(target)), "context-restored target was reused");
    state.environmentTargets.forEach(target => target.dispose()); state.pmrem.dispose();
  });

  check("composer failure reports failed state and suppresses both render paths", () => {
    const f = fixture("day", "composer"); internals(f.scene).handleContextRestored();
    assert.equal(f.scene.graphicsState, "failed");
    assert.equal(f.scene.graphicsError, "injected composer reset failure");
    assert.deepEqual(f.callbacks, ["restoring", "failed"]);
    assert.equal(generationCalls, 0); assert.equal(f.counts().renderCalls, 0);
  });

  for (const fault of ["first-environment", "second-environment", "quality"] as const) check(`failed ${fault} cleans partial rebuild and permits clean retry`, () => {
    const f = fixture("night", fault === "quality" ? "quality" : undefined);
    failAt = fault === "first-environment" ? 1 : fault === "second-environment" ? 2 : Infinity;
    internals(f.scene).handleContextRestored();
    const state = internals(f.scene), failedGenerator = state.pmrem, records = [...generated];
    assert.equal(f.scene.graphicsState, "failed");
    assert.match(f.scene.graphicsError, /injected (PMREM generation|quality rebuild) failure/);
    assert.deepEqual(f.callbacks, ["restoring", "failed"]);
    assert.equal(f.counts().renderCalls, 0);
    assert(records.every(record => record.sourceDisposals === 1), "PMREM failure leaked its source CanvasTexture");
    assert(records.every(record => record.targetDisposals === 1), "failed recovery kept a partial generated environment target");
    assert.equal(state.environmentTargets.length, 0, "failed recovery retained invalid environment targets");
    assert.equal(f.scene.scene.environment, null, "failed recovery points scene at a disposed environment");
    assert.equal(generatorDisposals.get(failedGenerator), 1, "failed rebuild did not dispose new PMREM resources");
    failAt = Infinity;
    Object.assign(f.scene, { applyQualityTier: () => {} });
    state.handleContextRestored();
    assert.equal(f.scene.graphicsState, "ready"); assert.equal(f.scene.graphicsError, "");
    assert.equal(state.environmentTargets.length, 2);
    assert.notEqual(state.pmrem, failedGenerator);
    assert(records.every(record => record.sourceDisposals === 1 && record.targetDisposals === 1), "retry double-disposed failed resources");
    f.scene.render(); assert.equal(f.counts().renderCalls, 1);
    state.environmentTargets.forEach(target => target.dispose()); state.pmrem.dispose();
  });

  check("debug context-loss exercise respects state/extension and schedules restore", () => {
    let extension = false, losses = 0, restores = 0, contextQueries = 0;
    const timers: (() => void)[] = [];
    Object.defineProperty(globalThis, "setTimeout", { configurable: true, value: (callback: () => void, delay: number) => {
      assert(delay >= 100 && delay <= 3000, "restore timer is not bounded"); timers.push(callback); return 1;
    } });
    const scene = Object.create(Scene.prototype) as Scene;
    Object.assign(scene, { graphicsState: "lost", renderer: {
      getContext: () => { contextQueries++; return { getExtension: () => extension ? {} : null }; },
      forceContextLoss: () => losses++, forceContextRestore: () => restores++,
    } });
    assert.equal(scene.testGraphicsRecovery(), false); assert.equal(contextQueries, 0);
    scene.graphicsState = "ready";
    assert.equal(scene.testGraphicsRecovery(), false); assert.equal(losses, 0); assert.equal(timers.length, 0);
    extension = true;
    assert.equal(scene.testGraphicsRecovery(), true); assert.equal(losses, 1); assert.equal(restores, 0);
    assert.equal(timers.length, 1); timers[0](); assert.equal(restores, 1);
  });

  for (const [width, height, dpr, maxSamples] of [[1920, 1080, 2.75, 8], [844, 390, 3, 4], [844, 390, 1, 0]]) check(`highest detail remains enabled at ${width}×${height}, DPR${dpr}, samples${maxSamples}`, () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { innerWidth: width, innerHeight: height, devicePixelRatio: dpr } });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: () => { throw new Error("storage disabled"); } } });
    const scene = Object.create(Scene.prototype) as Scene;
    let rendererDpr = 0, composerDpr = 0;
    const targets = [new THREE.WebGLRenderTarget(), new THREE.WebGLRenderTarget()];
    const key = new THREE.DirectionalLight(); key.shadow.mapSize.set(512, 512);
    Object.assign(scene, {
      camera: new THREE.PerspectiveCamera(), cameraMode: "chase", hudInset: 0, floatingHudInset: 0,
      renderer: { setPixelRatio: (ratio: number) => rendererDpr = ratio, setSize: () => {}, capabilities: { isWebGL2: maxSamples > 0, maxSamples }, shadowMap: {} },
      composer: { setPixelRatio: (ratio: number) => composerDpr = ratio, setSize: () => {}, renderTarget1: targets[0], renderTarget2: targets[1] },
      key, bloom: { resolution: new THREE.Vector2() },
    });
    scene.setQualityMode("ultra");
    for (let i = 0; i < 600; i++) scene.stepAdaptiveQuality(15, 1 / 60);
    assert.equal(scene.qualityMode, "ultra"); assert.equal(scene.effectiveQuality, "ultra");
    assert.equal(rendererDpr, Math.min(dpr, 2)); assert.equal(composerDpr, rendererDpr);
    assert(targets.every(target => target.samples === Math.min(maxSamples, 4)), "highest quality lost supported MSAA");
    assert.equal(scene.renderer.shadowMap.enabled, true); assert.equal(scene.renderer.shadowMap.type, THREE.PCFSoftShadowMap);
    assert.equal(key.shadow.mapSize.x, 2048); assert.equal(key.shadow.mapSize.y, 2048);
    assert.equal(scene.camera.userData.mirrorIntervalMs, 1000 / 30);
    targets.forEach(target => target.dispose());
  });

  check("constructor selects highest detail and registers loss/restore listeners", () => {
    // Constructor requires a real WebGL canvas; keep this narrow assertion
    // static and test the quality/lifecycle methods dynamically above.
    const source = readFileSync("src/render/Scene.ts", "utf8");
    const constructor = source.slice(source.indexOf("constructor(canvas:"), source.indexOf("private setupEnvironments"));
    assert.match(constructor, /this\.setQualityMode\(['"]ultra['"]\)/);
    assert.match(constructor, /addEventListener\(['"]webglcontextlost['"]/);
    assert.match(constructor, /addEventListener\(['"]webglcontextrestored['"]/);
    assert.doesNotMatch(constructor, /localStorage\.getItem/);
  });
} finally {
  THREE.PMREMGenerator.prototype.fromEquirectangular = originalFrom;
  THREE.PMREMGenerator.prototype.dispose = originalDispose;
  restoreGlobal("document", oldDocument); restoreGlobal("window", oldWindow);
  restoreGlobal("localStorage", oldStorage); restoreGlobal("setTimeout", oldTimeout);
}
if (failures.length) throw new Error(`GRAPHICS-RECOVERY failed:\n${failures.join("\n")}`);
console.log(`GRAPHICS-RECOVERY PASS — ${groups} lifecycle/cleanup/retry/quality checks. Stubbed renderer verifies application behavior; real GPU context loss still requires browser testing.`);
