import { Telemetry } from "../sim/Simulation.ts";
import { DriveControls } from "./DriveControls.ts";

/** Pointer/touch accelerator and brake pedals for the human-drive modes. */
export class PedalControls {
  private throttleButton: HTMLButtonElement;
  private brakeButton: HTMLButtonElement;
  private meterText: HTMLElement;
  private userFill: HTMLElement;
  private adasFill: HTMLElement;
  private pointerThrottle = 0;
  private pointerBrake = 0;
  private steeringHeld = new Set<number>();
  private revision = 0;

  constructor(root: HTMLElement, private controls: DriveControls) {
    root.insertAdjacentHTML("beforeend", `
      <div class="pedal-controls panel" aria-label="Điều khiển bàn đạp">
        <div class="pedal-head"><span>ĐIỀU KHIỂN LÁI</span><span class="pedal-hint">PHÍM · CHẠM · TAY CẦM</span></div>
        <div class="steering-controls" role="group" aria-label="Điều khiển vô lăng">
          <button type="button" id="steer-left" aria-label="Giữ để đánh lái trái">◀ <kbd>A</kbd></button>
          <span class="steering-readout"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M3.5 8.8 9.8 11m10.7-2.2L14.2 11M12 14.5V21"/></svg><span id="steering-value">VÔ LĂNG · 0°</span></span>
          <button type="button" id="steer-right" aria-label="Giữ để đánh lái phải"><kbd>D</kbd> ▶</button>
        </div>
        <div class="pedal-row">
          <button type="button" class="pedal brake-pedal" id="pedal-brake" aria-label="Bàn đạp phanh">
            <span class="pedal-mechanism" aria-hidden="true"><span class="pedal-arm"></span><span class="pedal-face"><i></i><i></i><i></i><i></i><i></i></span></span>
            <span class="pedal-copy"><b>PHANH</b><span class="pedal-state"><kbd>Space</kbd><span>S / ↓</span></span></span>
          </button>
          <button type="button" class="pedal accelerator" id="pedal-accelerator" aria-label="Bàn đạp ga">
            <span class="pedal-mechanism" aria-hidden="true"><span class="pedal-arm"></span><span class="pedal-face"><i></i><i></i><i></i></span></span>
            <span class="pedal-copy"><b>GA</b><span class="pedal-state"><kbd>W</kbd><span>↑</span></span></span>
          </button>
        </div>
        <div class="brake-meter-label"><span>ÁP SUẤT PHANH</span><b id="pedal-brake-value">0%</b></div>
        <div class="brake-meter"><span class="brake-meter-user"></span><span class="brake-meter-adas"></span></div>
        <div class="brake-meter-caption" id="pedal-brake-caption">Người lái 0% · ADAS 0%</div>
      </div>
    `);
    this.throttleButton = document.getElementById("pedal-accelerator") as HTMLButtonElement;
    this.brakeButton = document.getElementById("pedal-brake") as HTMLButtonElement;
    this.userFill = root.querySelector<HTMLElement>(".brake-meter-user")!;
    this.adasFill = root.querySelector<HTMLElement>(".brake-meter-adas")!;
    this.meterText = document.getElementById("pedal-brake-caption")!;
    this.bindPedal(this.throttleButton, "throttle");
    this.bindPedal(this.brakeButton, "brake");
    for (const direction of [-1, 1]) {
      const button = document.getElementById(direction < 0 ? "steer-left" : "steer-right") as HTMLButtonElement;
      const release = () => { this.steeringHeld.delete(direction); this.controls.setSteering([...this.steeringHeld].reduce((sum, value) => sum + value, 0)); };
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.steeringHeld.add(direction);
        this.controls.setSteering([...this.steeringHeld].reduce((sum, value) => sum + value, 0));
      });
      for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(event, release);
    }
  }

  update(t: Telemetry): void {
    const enabled = this.controls.canDrive;
    this.throttleButton.disabled = !enabled;
    this.brakeButton.disabled = !enabled;
    for (const id of ["steer-left", "steer-right"]) (document.getElementById(id) as HTMLButtonElement).disabled = !enabled;
    if (!enabled || this.revision !== this.controls.revision) {
      this.pointerThrottle = 0; this.pointerBrake = 0; this.steeringHeld.clear();
      this.revision = this.controls.revision;
    }
    const steering = document.getElementById("steering-value");
    if (steering) steering.textContent = `VÔ LĂNG · ${Math.round(t.steer * 180 / Math.PI)}°`;
    const steeringReadout = steering?.parentElement;
    steeringReadout?.style.setProperty("--wheel-angle", `${t.steer * 180 / Math.PI * 4}deg`);
    this.throttleButton.classList.toggle("pressed", t.userThrottle > 0.01);
    this.brakeButton.classList.toggle("pressed", t.userBrakeForce > 0.01 || t.adasBrakeForce > 0.01);
    this.brakeButton.classList.toggle("adas-intervening", t.adas.aeb || t.rearAeb);
    this.userFill.style.width = `${t.userBrakeForce * 100}%`;
    this.adasFill.style.width = `${Math.max(0, t.finalBrakeForce - t.userBrakeForce) * 100}%`;
    const total = Math.round(t.finalBrakeForce * 100);
    const user = Math.round(t.userBrakeForce * 100);
    const adas = Math.round(t.adasBrakeForce * 100);
    this.meterText.textContent = `Người lái ${user}% · ADAS ${adas}%`;
    this.adasFill.style.left = `${user}%`;
    this.adasFill.style.width = `${Math.max(0, total - user)}%`;
    const value = document.getElementById("pedal-brake-value");
    if (value) value.textContent = `${total}%`;
  }

  private bindPedal(button: HTMLButtonElement, pedal: "throttle" | "brake"): void {
    const set = (pressed: boolean) => {
      if (pedal === "throttle") this.pointerThrottle = pressed ? 1 : 0;
      else this.pointerBrake = pressed ? 1 : 0;
      this.controls.setPedalInputs(
        this.pointerThrottle,
        this.pointerBrake,
      );
    };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      set(true);
    });
    button.addEventListener("pointerup", () => set(false));
    button.addEventListener("pointercancel", () => set(false));
    button.addEventListener("lostpointercapture", () => set(false));
    window.addEventListener("blur", () => set(false));
  }
}
