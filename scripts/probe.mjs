// Dev-only probe: drives the built app in headless Chrome over the DevTools
// protocol, reports console errors, sim state, and writes a screenshot.
//
//   node scripts/probe.mjs "http://127.0.0.1:5199/?intro=0&scenario=dense" shots/out.png [waitMs]
//
// Requires Chrome at the standard Windows path and Node >= 22 (global WebSocket).

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:5199/?intro=0";
const out = process.argv[3] ?? "shots/probe.png";
const waitMs = Number(process.argv[4] ?? 8000);
const setup = process.argv[5] ?? "";
const width = Number(process.env.BL_PROBE_WIDTH ?? 1280);
const height = Number(process.env.BL_PROBE_HEIGHT ?? 800);
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 9333 + Math.floor(Math.random() * 200);
const profile = mkdtempSync(join(tmpdir(), "bl-probe-"));

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu-sandbox",
    "--enable-unsafe-swiftshader",
    "--hide-scrollbars",
    `--window-size=${width},${height}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  throw new Error("devtools endpoint never came up");
}

const logs = [];
let ws;
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 15000);
  });
}

function evaluate(expression) {
  return send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }).then(
    (msg) => msg.result?.result?.value,
  );
}

try {
  await waitForDevtools();
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const target = await res.json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      logs.push(`[console.${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      logs.push(`[exception] ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ""}`);
    }
    if (msg.method === "Log.entryAdded") {
      logs.push(`[log.${msg.params.entry.level}] ${msg.params.entry.text}`);
    }
  };

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await sleep(2500);
  if (setup) {
    const setupResult = await evaluate(setup);
    if (setupResult !== undefined) console.log("setup ->", JSON.stringify(setupResult));
  }
  await sleep(waitMs);

  const state = await evaluate(`(() => {
    const b = window.blueline;
    const pre = document.getElementById('boot-error');
    return {
      ready: !!b,
      fps: b ? Math.round(b.fps()) : null,
      elapsed: b ? +b.sim.metrics.time.toFixed(2) : null,
      distance: b ? +b.sim.telemetry.distanceTravelled.toFixed(1) : null,
      speed: b ? +b.sim.ego.v.toFixed(1) : null,
      cars: b ? b.sim.traffic.cars.length : null,
      tracks: b ? b.sim.tracks.length : null,
      mode: b ? b.sim.controlMode : null,
      camera: b ? b.scene.cameraMode : null,
      camY: b ? +b.scene.camera.position.y.toFixed(1) : null,
      ego: b ? [+b.sim.ego.x.toFixed(1), +b.sim.ego.y.toFixed(1)] : null,
      hudSpeed: document.getElementById('hud-speed')?.textContent,
      hudDist: document.getElementById('t-dist')?.textContent,
      bootError: pre ? pre.textContent.trim().slice(0, 800) : '',
    };
  })()`);

  console.log(JSON.stringify(state, null, 2));

  const debug = await evaluate(`(() => {
    const b = window.blueline;
    if (!b) return null;
    const grp = b.fleet.group;
    const ego = grp.children[0];
    const egoF = b.sim.path.toFrenet(b.sim.ego.x, b.sim.ego.y);
    return {
      groupChildren: grp.children.length,
      groupVisible: grp.visible,
      egoPos: ego.position.toArray().map((n) => +n.toFixed(1)),
      egoVisible: ego.visible,
      egoKids: ego.children.length,
      egoShellKids: ego.userData.shell ? ego.userData.shell.children.length : null,
      sample: grp.children.slice(1, 4).map((g) => ({
        pos: g.position.toArray().map((n) => +n.toFixed(1)),
        scale: g.scale.toArray().map((n) => +n.toFixed(2)),
        visible: g.visible,
        kind: g.userData.builtKind,
        variant: g.userData.builtVariant,
        kids: g.children.length,
      })),
      egoS: +egoF.s.toFixed(1),
      nearCars: b.sim.traffic.cars.map((c) => {
        let ds = (c.s - egoF.s + b.sim.path.length) % b.sim.path.length;
        if (ds > b.sim.path.length / 2) ds -= b.sim.path.length;
        return { ds: +ds.toFixed(0), d: +c.d.toFixed(1), v: +c.v.toFixed(1), kind: c.kind };
      }).sort((a, c) => Math.abs(a.ds) - Math.abs(c.ds)).slice(0, 6),
      adas: b.sim.controlMode === "adas" ? {
        input: b.sim.driverInput,
        egoD: +egoF.d.toFixed(2),
        lane: b.sim.road.laneOf(egoF.d),
        steer: +b.sim.ego.delta.toFixed(3),
        accel: +b.sim.ego.a.toFixed(2),
        targetSpeed: +b.sim.telemetry.targetSpeed.toFixed(2),
        pid: {
          kp: b.sim.speedPID.kp,
          ki: b.sim.speedPID.ki,
          integral: +b.sim.speedPID.integral.toFixed(3),
          prevError: +b.sim.speedPID.prevError.toFixed(3),
        },
        probeAccel: (() => {
          const s = b.sim;
          const out = s.adas.update({
            ego: s.ego,
            egoS: egoF.s,
            egoD: egoF.d,
            path: s.path,
            road: s.road,
            obstacles: [],
            desiredSpeed: 26,
            input: { steer: 0, throttle: 0, brake: 0 },
            dt: 1 / 60,
            speedControl: (e, d) => s.speedPID.update(e, d),
          });
          return { accel: out.accel, targetSpeed: out.targetSpeed };
        })(),
        stepTrace: (() => {
          const s = b.sim;
          let stepArgs = null;
          let adasOut = null;
          const origStep = s.ego.step.bind(s.ego);
          s.ego.step = (steer, accel, dt) => {
            stepArgs = { steer: +steer.toFixed(3), accel: +accel.toFixed(3), dt: +dt.toFixed(4) };
            origStep(steer, accel, dt);
          };
          const origAdas = s.adas.update.bind(s.adas);
          s.adas.update = (f) => {
            const r = origAdas(f);
            adasOut = { accel: +r.accel.toFixed(3), targetSpeed: +r.targetSpeed.toFixed(2) };
            return r;
          };
          s.step(1 / 60);
          s.ego.step = origStep;
          s.adas.update = origAdas;
          return { stepArgs, adasOut };
        })(),
        status: b.sim.adas.status,
      } : null,
    };
  })()`);
  console.log(JSON.stringify(debug, null, 2));
  if (logs.length) console.log("--- logs ---\n" + logs.slice(-25).join("\n"));

  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log(`screenshot -> ${out}`);
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  chrome.kill();
}
process.exit(0);
