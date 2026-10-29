import assert from "node:assert/strict";
import { DriveControls } from "../src/ui/DriveControls.ts";
import { Simulation } from "../src/sim/Simulation.ts";
import { releaseDrivingInputs } from "../src/ui/input.ts";

// Event-level checks without WebGL or a browser. Physical hardware is not emulated.
class ElementStub extends EventTarget {
  isContentEditable = false;
  style = { display: "none" };
  type = "text";
  constructor(public tagName = "DIV") { super(); }
}
const win = new EventTarget();
const menu = new ElementStub();
const doc = Object.assign(new EventTarget(), { hidden: false, activeElement: new ElementStub(), getElementById: (id: string) => id === "intro" ? menu : null });
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
function key(type: string, code: string, target?: ElementStub, repeat = false): void {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "code", { value: code });
  Object.defineProperty(event, "repeat", { value: repeat });
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
assert.equal(sim.paused, false, "blur must not pause the world");
const timeBeforeBlur = sim.metrics.time; sim.step(1 / 60);
assert(sim.metrics.time > timeBeforeBlur, "simulation stopped progressing after blur");
win.dispatchEvent(new Event("focus")); step();
key("keydown", "KeyW", undefined, true); step();
assert.equal(sim.driverInput.throttle, 0, "auto-repeat after blur must not restore a cleared accelerator");
key("keyup", "KeyW");
key("keydown", "KeyW"); step(); doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange")); step();
assert.equal(sim.driverInput.throttle, 0, "hidden tab must clear held throttle");
assert.equal(sim.paused, false, "hidden tab must not force pause");
doc.hidden = false; doc.dispatchEvent(new Event("visibilitychange")); step();
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
// Reset callbacks used by the drawer and R shortcut release every input source.
key("keydown", "KeyW"); key("keydown", "KeyD"); controls.setPedalInputs(1, 0); step();
releaseDrivingInputs(); sim.reset(); step();
assert.equal(sim.driverInput.throttle, 0, "reset inherited keyboard/pointer throttle");
assert.equal(sim.driverInput.steer, 0, "reset inherited held steering");
key("keydown", "KeyW", undefined, true); step();
assert.equal(sim.driverInput.throttle, 0, "key auto-repeat restarted throttle after reset");
key("keyup", "KeyW"); key("keyup", "KeyD");

// Form ownership lasts until blur; a gamepad must not rearm inside a dropdown.
doc.activeElement = new ElementStub("SELECT");
pads = [{ connected: true, mapping: "standard", axes: [0], buttons }];
buttons[7].value = 0; step(); buttons[7].value = .8; step();
assert.equal(sim.driverInput.throttle, 0, "gamepad accelerated while editing a form");
doc.activeElement = new ElementStub(); step();
assert.equal(sim.driverInput.throttle, 0, "leaving a form must require a neutral gamepad");
buttons[7].value = 0; step(); buttons[7].value = .8; step();
assert.equal(sim.driverInput.throttle, .8, "gamepad did not rearm after form editing");
buttons[7].value = 0; pads = []; controls.clear();

doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange")); step();
controls.setPedalInputs(1, 0); controls.setSteering(1); step();
doc.hidden = false; step();
assert.equal(sim.driverInput.throttle, 0, "hidden pointer event survived until the tab became visible");
assert.equal(sim.driverInput.steer, 0, "hidden steering event survived until the tab became visible");

const oldIndicator=sim.indicator;
key("keydown","BracketRight"); const indicated=sim.indicator;
assert.notEqual(indicated,oldIndicator,'fresh indicator press was ignored');
key("keydown","BracketRight",undefined,true);
assert.equal(sim.indicator,indicated,'held indicator toggled on keyboard auto-repeat');
key("keyup","BracketRight");key("keydown","BracketRight");
assert.equal(sim.indicator,0,'second fresh indicator press did not cancel');

sim.startRecording();sim.step(1/60);sim.stopRecording();assert(sim.startReplay());
const recordedIndicator=sim.indicator;
key('keydown','BracketLeft');
assert.equal(sim.indicator,recordedIndicator,'keyboard indicator modified replay state');
sim.stopReplay();step();

sim.setControlMode("adas"); step(); sim.ego.v = 40;
key("keydown", "KeyD");
let previousSteer = 0;
for (let i = 0; i < 60; i++) {
  step(); const steer = sim.driverInput.steer * sim.ego.maxSteer;
  assert(Math.abs(steer - previousSteer) < .003, "keyboard steering has an abrupt per-frame jump");
  assert(Math.abs(Math.tan(steer) * sim.ego.v ** 2 / sim.ego.dims.wheelbase) <= 4.51, "keyboard exceeds its high-speed lateral acceleration envelope");
  previousSteer = steer;
}
assert.equal(sim.driverInput.steeringOverride, true, "speed limiting must preserve the driver's takeover intent");
sim.step(1 / 60); assert(!sim.adas.status.laneCenteringActive, "high-speed key input did not override lane assistance");
key("keyup", "KeyD"); for (let i = 0; i < 90; i++) step();
assert.equal(sim.driverInput.steer, 0, "keyboard steering never settled after key release");
controls.dispose();
console.log("DRIVE-INPUT PASS — W/arrows, all brake keys, progressive steering, blur/pause/menu, form focus, blended sources and disconnect.");
