import assert from "node:assert/strict";
import { DriveControls } from "../src/ui/DriveControls.ts";
import { Simulation } from "../src/sim/Simulation.ts";

// Event-level checks without WebGL or a browser. Physical hardware is not emulated.
class ElementStub extends EventTarget {
  isContentEditable = false;
  style = { display: "none" };
  type = "text";
  constructor(public tagName = "DIV") { super(); }
}
const win = new EventTarget();
const menu = new ElementStub();
const doc = Object.assign(new EventTarget(), { hidden: false, getElementById: (id: string) => id === "intro" ? menu : null });
let pads: any[] = [];
Object.defineProperties(globalThis, {
  window: { value: win, configurable: true }, document: { value: doc, configurable: true },
  HTMLElement: { value: ElementStub, configurable: true },
  navigator: { value: { getGamepads: () => pads }, configurable: true },
});

const sim = new Simulation({ trafficCount: 0 });
sim.traffic.clear(); sim.pedestrians.clear(); sim.setControlMode("manual");
const controls = new DriveControls(sim);
const step = () => controls.update(1 / 60);
function key(type: string, code: string, target?: ElementStub): void {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "code", { value: code });
  if (target) Object.defineProperty(event, "target", { value: target });
  win.dispatchEvent(event);
}

step();
for (const code of ["KeyW", "ArrowUp"]) {
  key("keydown", code); step(); assert.equal(sim.driverInput.throttle, 1, `${code} must accelerate`);
  key("keyup", code); step(); assert.equal(sim.driverInput.throttle, 0, `${code} must release`);
}
for (const code of ["Space", "KeyS", "KeyM", "ArrowDown"]) {
  key("keydown", code); step(); assert.equal(sim.driverInput.brake, 1, `${code} must brake`);
  key("keyup", code); step(); assert.equal(sim.driverInput.brake, 0, `${code} must release`);
}
key("keydown", "KeyW"); key("keydown", "KeyA"); step();
assert.equal(sim.driverInput.throttle, 1);
assert(sim.driverInput.steer < 0 && sim.driverInput.steer > -0.1, "steering must ramp instead of snap");
key("keyup", "KeyA"); for (let i = 0; i < 20; i++) step();
assert.equal(sim.driverInput.steer, 0, "wheel must return to centre");
win.dispatchEvent(new Event("blur")); step();
assert.equal(sim.driverInput.throttle, 0, "blur must release held input");
win.dispatchEvent(new Event("focus")); step();
key("keydown", "KeyW"); step(); sim.paused = true; step(); sim.paused = false; step();
assert.equal(sim.driverInput.throttle, 0, "pause must not retain throttle after resuming");
key("keydown", "KeyW", new ElementStub("SELECT")); step();
assert.equal(sim.driverInput.throttle, 0, "select boxes own their keys");
const range = new ElementStub("INPUT"); range.type = "range";
key("keydown", "ArrowUp", range); step(); assert.equal(sim.driverInput.throttle, 0, "sliders must not accelerate the car");
menu.style.display = "flex"; key("keydown", "KeyW"); step();
assert.equal(sim.driverInput.throttle, 0, "launch menu blocks driving"); menu.style.display = "none"; step();

const buttons = Array.from({ length: 17 }, () => ({ value: 0, pressed: false }));
pads = [{ connected: true, mapping: "standard", axes: [.5], buttons }];
pads[0].axes[0] = 0; step(); // rearm after the pause/focus transition
buttons[7].value = .65; key("keydown", "KeyA"); step();
assert.equal(sim.driverInput.throttle, .65, "keyboard steering must preserve analog gamepad throttle");
key("keyup", "KeyA"); controls.setPedalInputs(0, .4); step();
assert.equal(sim.driverInput.brake, .4, "pointer brake blends with gamepad input");
pads = []; win.dispatchEvent(new Event("gamepaddisconnected")); step();
assert.equal(sim.driverInput.throttle, 0, "disconnect must release input");
controls.setPedalInputs(1, 0); step(); sim.setControlMode("classical"); step(); sim.setControlMode("manual"); step();
assert.equal(sim.driverInput.throttle, 0, "mode switches must release virtual pedals");
controls.dispose();
console.log("DRIVE-INPUT PASS — W/arrows, all brake keys, progressive steering, blur/pause/menu, form focus, blended sources and disconnect.");
