// A single fixed-step input path for keyboard, touch and standard gamepads.
import { Simulation } from "../sim/Simulation.ts";
import { isTypingTarget, launchMenuOpen } from "./input.ts";

const KEY_ACTION: Record<string, "left" | "right" | "throttle" | "brake"> = {
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
  KeyW: "throttle", ArrowUp: "throttle", Space: "brake", KeyS: "brake",
  KeyM: "brake", ArrowDown: "brake",
};

export class DriveControls {
  revision = 0;
  steeringSensitivity = 1;
  gamepadDeadzone = .08;
  private held = new Set<string>();
  private pointer = { throttle: 0, brake: 0, steer: 0 };
  private steering = 0;
  private steeringVelocity = 0;
  private previousButtons = new Set<number>();
  private lastMode: string;
  private suspended = false;
  private unfocused = false;
  private gamepadNeedsNeutral = false;
  private previousAeb = false;
  private previousCollisions = 0;
  private events = new AbortController();

  constructor(private sim: Simulation, private onCameraSwitch?: () => void) {
    this.lastMode = sim.controlMode;
    const options = { signal: this.events.signal };
    window.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey || isTypingTarget(event.target) || !this.canDrive) return;
      if (event.code === "BracketLeft" || event.code === "BracketRight") {
        event.preventDefault();
        if (!event.repeat) sim.toggleIndicator(event.code === "BracketLeft" ? -1 : 1);
      } else if (KEY_ACTION[event.code]) {
        event.preventDefault();
        // Auto-repeat after a reset/blur is not a fresh driving command.
        if (event.repeat && !this.held.has(event.code)) return;
        this.held.add(event.code);
      }
    }, options);
    window.addEventListener("keyup", (event) => {
      if (KEY_ACTION[event.code]) this.held.delete(event.code);
    }, options);
    window.addEventListener("blur", () => { this.unfocused = true; this.clear(); }, options);
    window.addEventListener("focus", () => { this.unfocused = false; }, options);
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.clear(); }, options);
    document.addEventListener("focusin", (event) => { if (isTypingTarget(event.target)) this.clear(); }, options);
    document.addEventListener("blueline:release-driving-inputs", () => this.clear(), options);
    window.addEventListener("gamepaddisconnected", () => this.clear(), options);
  }

  /** Called before each physics step, never by a competing animation loop. */
  update(dt: number): void {
    const blocked = !this.canDrive;
    if (this.lastMode !== this.sim.controlMode || blocked !== this.suspended) {
      if (blocked || this.lastMode !== this.sim.controlMode) this.clear();
      this.lastMode = this.sim.controlMode;
      this.suspended = blocked;
    }
    if (blocked) return;
    // A form owns keyboard/gamepad navigation for the whole editing session.
    if (isTypingTarget(document.activeElement)) { this.clear(); return; }

    const pads = navigator.getGamepads?.() ?? [];
    const pad = Array.from(pads).find((candidate) => candidate?.connected && candidate.mapping === "standard");
    let padSteer = 0, padThrottle = 0, padBrake = 0;
    if (pad) {
      const raw = pad.axes[0] ?? 0;
      const trigger = (index: number) => pad.buttons[index]?.value ?? 0;
      if (this.gamepadNeedsNeutral && Math.abs(raw) < this.gamepadDeadzone && trigger(6) < 0.05 && trigger(7) < 0.05 && trigger(0) < 0.05 && trigger(1) < 0.05) {
        this.gamepadNeedsNeutral = false;
      }
      if (!this.gamepadNeedsNeutral) {
        padSteer = Math.abs(raw) > this.gamepadDeadzone ? Math.sign(raw) * (Math.abs(raw) - this.gamepadDeadzone) / (1 - this.gamepadDeadzone) : 0;
        padThrottle = Math.max(trigger(7), trigger(0));
        padBrake = Math.max(trigger(6), trigger(1));
        for (const index of [14, 15, 3]) {
          if (pad.buttons[index]?.pressed && !this.previousButtons.has(index)) {
            if (index === 3) this.onCameraSwitch?.();
            else this.sim.toggleIndicator(index === 14 ? -1 : 1);
          }
        }
      }
      this.previousButtons = new Set(pad.buttons.flatMap((button, index) => button.pressed ? [index] : []));
      const emergency = this.sim.adas.status.aeb || this.sim.telemetry.rearAeb;
      if ((emergency && !this.previousAeb) || this.sim.metrics.collisions > this.previousCollisions) {
        pad.vibrationActuator?.playEffect("dual-rumble", { duration: 120, startDelay: 0, weakMagnitude: .5, strongMagnitude: .7 }).catch(() => {});
      }
      this.previousAeb = emergency;
      this.previousCollisions = this.sim.metrics.collisions;
    } else this.previousButtons.clear();

    const active = new Set(Array.from(this.held, (code) => KEY_ACTION[code]));
    const keyboardSteer = Number(active.has("right")) - Number(active.has("left"));
    const targetSteer = active.has("left") || active.has("right") ? keyboardSteer : this.pointer.steer || padSteer;
    // Limit digital steering at speed and progressively turn/return the wheel.
    const digital = active.has("left") || active.has("right") || this.pointer.steer !== 0;
    const speedLimit = digital ? Math.min(1, Math.atan(4.5 * this.sim.ego.dims.wheelbase / Math.max(this.sim.ego.v ** 2, 1)) / this.sim.ego.maxSteer) : 1;
    const target = targetSteer * speedLimit;
    // A critically damped steering servo smooths key taps, counter-steering and
    // return-to-centre. The speed envelope limits actual lateral acceleration.
    const omega = 12 * this.steeringSensitivity;
    this.steeringVelocity += (omega * omega * (target - this.steering) - 2 * omega * this.steeringVelocity) * dt;
    this.steering += this.steeringVelocity * dt;
    this.steering = Math.max(-1, Math.min(1, this.steering));
    if (Math.abs(this.steering - target) < .002 && Math.abs(this.steeringVelocity) < .02) { this.steering = target; this.steeringVelocity = 0; }
    const brake = Math.max(active.has("brake") ? 1 : 0, this.pointer.brake, padBrake);
    const throttle = Math.max(active.has("throttle") ? 1 : 0, this.pointer.throttle, padThrottle);
    this.sim.setDriverInput({ steer: this.steering, throttle, brake, steeringOverride: Math.abs(targetSteer) > .01 });
  }

  clear(): void {
    this.revision++;
    this.held.clear();
    this.pointer = { throttle: 0, brake: 0, steer: 0 };
    this.steering = 0;
    this.steeringVelocity = 0;
    this.previousButtons.clear();
    this.gamepadNeedsNeutral = true;
    this.sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
  }

  setPedalInputs(throttle: number, brake: number): void {
    if (!this.canDrive) return;
    this.pointer.throttle = Math.max(0, Math.min(1, throttle));
    this.pointer.brake = Math.max(0, Math.min(1, brake));
  }

  get canDrive(): boolean { return !this.sim.paused && this.humanMode() && !launchMenuOpen() && !this.sim.recorder.playing && !document.hidden && !this.unfocused; }
  setSteering(steer: number): void { if (this.canDrive) this.pointer.steer = Math.max(-1, Math.min(1, steer)); }
  private humanMode(): boolean { return this.sim.controlMode === "manual" || this.sim.controlMode === "adas"; }
  dispose(): void { this.events.abort(); this.clear(); }
}
