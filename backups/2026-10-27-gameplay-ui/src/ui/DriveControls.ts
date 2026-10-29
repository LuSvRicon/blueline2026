// DriveControls — hold-to-drive keyboard inputs for Manual and ADAS modes,
// plus the turn-signal stalk (which the assisted lane change listens to).

import { Simulation } from "../sim/Simulation.ts";

const KEY_ACTION: Record<string, "left" | "right" | "throttle" | "brake"> = {
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyW: "throttle",
  ArrowUp: "throttle",
  Space: "brake",
  KeyS: "brake",
  KeyM: "brake",
  ArrowDown: "brake",
};

export class DriveControls {
  private readonly held = new Set<string>();
  private gamepadIndex: number | null = null;
  private prevButtonStates: Record<number, boolean> = {};
  private rafId: number | null = null;
  private onCameraSwitch?: () => void;
  private pedalThrottle = 0;
  private pedalBrake = 0;
  private lastMode = "";

  constructor(private sim: Simulation, onCameraSwitch?: () => void) {
    this.onCameraSwitch = onCameraSwitch;
    this.lastMode = this.simMode();
    window.addEventListener("keydown", (event) => this.onKeyDown(event));
    window.addEventListener("keyup", (event) => this.onKeyUp(event));
    window.addEventListener("blur", () => this.clear());

    window.addEventListener("gamepadconnected", (e: GamepadEvent) => {
      this.gamepadIndex = e.gamepad.index;
      this.showToast(`🎮 Đã kết nối tay cầm: ${e.gamepad.id.split("(")[0].trim()}`);
    });

    window.addEventListener("gamepaddisconnected", (e: GamepadEvent) => {
      if (this.gamepadIndex === e.gamepad.index) {
        this.gamepadIndex = null;
        this.showToast("🎮 Đã ngắt kết nối tay cầm");
      }
    });

    this.startGamepadLoop();
  }

  private showToast(message: string): void {
    const existing = document.getElementById("bl-gamepad-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.id = "bl-gamepad-toast";
    toast.textContent = message;
    toast.style.cssText =
      "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.92);border:1px solid #38bdf8;color:#f8fafc;padding:8px 16px;border-radius:20px;font-size:12px;font-family:sans-serif;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.5);pointer-events:none;transition:opacity 0.4s ease;";
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 400);
    }, 2800);
  }

  private startGamepadLoop(): void {
    const poll = () => {
      this.pollGamepad();
      this.rafId = requestAnimationFrame(poll);
    };
    this.rafId = requestAnimationFrame(poll);
  }

  private pollGamepad(): void {
    const mode = this.simMode();
    if (mode !== this.lastMode) {
      this.lastMode = mode;
      this.held.clear();
      this.pedalThrottle = 0;
      this.pedalBrake = 0;
      this.publish();
    }
    if (this.gamepadIndex === null && !navigator.getGamepads) return;
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = (this.gamepadIndex !== null ? gamepads[this.gamepadIndex] : null) || gamepads.find((g) => g !== null);
    if (!pad) return;

    if (!this.isHumanDriveMode()) return;

    // Analog Steering: Left Stick X (Axis 0) with 0.06 deadzone
    const rawSteer = pad.axes[0] ?? 0;
    const deadzone = 0.06;
    let steer = 0;
    if (Math.abs(rawSteer) > deadzone) {
      steer = Math.sign(rawSteer) * ((Math.abs(rawSteer) - deadzone) / (1 - deadzone));
    }

    // Triggers: RT (button 7) or button 0 (A) for throttle
    const rtVal = pad.buttons[7] ? pad.buttons[7].value : 0;
    const btnA = pad.buttons[0] ? pad.buttons[0].value : 0;
    const throttle = Math.max(rtVal, btnA);

    // Triggers: LT (button 6) or button 1 (B) for brake
    const ltVal = pad.buttons[6] ? pad.buttons[6].value : 0;
    const btnB = pad.buttons[1] ? pad.buttons[1].value : 0;
    const brake = Math.max(ltVal, btnB);

    // D-Pad Left/Right for Turn Signals
    const dpadLeft = pad.buttons[14]?.pressed ?? false;
    const dpadRight = pad.buttons[15]?.pressed ?? false;
    if (dpadLeft && !this.prevButtonStates[14]) this.sim.toggleIndicator(-1);
    if (dpadRight && !this.prevButtonStates[15]) this.sim.toggleIndicator(1);
    this.prevButtonStates[14] = dpadLeft;
    this.prevButtonStates[15] = dpadRight;

    // Y Button (button 3) to cycle camera
    const btnY = pad.buttons[3]?.pressed ?? false;
    if (btnY && !this.prevButtonStates[3]) this.onCameraSwitch?.();
    this.prevButtonStates[3] = btnY;

    // Back / Select (button 8) to reset simulation
    const btnBack = pad.buttons[8]?.pressed ?? false;
    if (btnBack && !this.prevButtonStates[8]) this.sim.reset();
    this.prevButtonStates[8] = btnBack;

    // If keyboard is also pressed, keyboard can override or blend
    if (this.held.size === 0) {
      this.sim.setDriverInput({
        steer,
        throttle: Math.max(throttle, this.pedalThrottle),
        brake: Math.max(brake, this.pedalBrake),
      });
    }

    // Haptic feedback (rumble) on AEB active or collision
    if (pad.vibrationActuator && (this.sim.telemetry.adas.aeb || this.sim.metrics.collisions > 0)) {
      pad.vibrationActuator.playEffect("dual-rumble", {
        startDelay: 0,
        duration: 80,
        weakMagnitude: 0.7,
        strongMagnitude: 0.9,
      }).catch(() => {});
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.isEditing(event.target)) return;
    if (!this.isHumanDriveMode()) return;

    // Turn signals, ETS-style: [ = left, ] = right, press again to cancel.
    if (event.code === "BracketLeft" || event.code === "BracketRight") {
      event.preventDefault();
      if (!event.repeat) this.sim.toggleIndicator(event.code === "BracketLeft" ? -1 : 1);
      return;
    }

    if (!KEY_ACTION[event.code]) return;
    event.preventDefault();
    this.held.add(event.code);
    this.publish();
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (!KEY_ACTION[event.code]) return;
    this.held.delete(event.code);
    this.publish();
  }

  private clear(): void {
    this.held.clear();
    this.pedalThrottle = 0;
    this.pedalBrake = 0;
    this.sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
  }

  private publish(): void {
    if (!this.isHumanDriveMode()) {
      this.sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
      return;
    }

    let left = false;
    let right = false;
    let throttle = this.pedalThrottle;
    let brake = this.pedalBrake;
    for (const code of this.held) {
      const action = KEY_ACTION[code];
      if (action === "left") left = true;
      else if (action === "right") right = true;
      else if (action === "throttle") throttle = 1;
      else if (action === "brake") brake = 1;
    }
    const steer = Number(right) - Number(left);
    this.sim.setDriverInput({ steer, throttle, brake });
  }

  setPedalInputs(throttle: number, brake: number): void {
    this.pedalThrottle = Math.max(0, Math.min(1, throttle));
    this.pedalBrake = Math.max(0, Math.min(1, brake));
    this.publish();
  }

  private isHumanDriveMode(): boolean {
    return this.sim.controlMode === "manual" || this.sim.controlMode === "adas";
  }

  private isEditing(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || ["TEXTAREA", "SELECT"].includes(target.tagName)) return true;
    if (target.tagName !== "INPUT") return false;
    return ["text", "search", "email", "password", "number", "url"].includes(
      (target as HTMLInputElement).type.toLowerCase(),
    );
  }

  private simMode(): string {
    return this.sim.controlMode;
  }

  dispose(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }
}
