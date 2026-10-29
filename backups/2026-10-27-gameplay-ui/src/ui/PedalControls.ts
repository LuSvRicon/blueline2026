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

  constructor(root: HTMLElement, private controls: DriveControls) {
    root.insertAdjacentHTML("beforeend", `
      <div class="pedal-controls panel" aria-label="Điều khiển bàn đạp">
        <div class="pedal-head"><span>BÀN ĐẠP</span><span class="pedal-hint">W / ↑ · Space / S / M / ↓</span></div>
        <div class="pedal-row">
          <button class="pedal accelerator" id="pedal-accelerator" aria-label="Bàn đạp ga">
            <span class="pedal-icon">▲</span><b>GA</b><span class="pedal-state">GIỮ ĐỂ TĂNG TỐC</span>
          </button>
          <button class="pedal brake-pedal" id="pedal-brake" aria-label="Bàn đạp phanh">
            <span class="pedal-icon">■</span><b>PHANH</b><span class="pedal-state">GIỮ ĐỂ PHANH</span>
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
  }

  update(t: Telemetry): void {
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
