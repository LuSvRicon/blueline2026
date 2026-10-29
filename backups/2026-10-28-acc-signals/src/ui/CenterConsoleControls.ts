import { Gear, Simulation } from "../sim/Simulation.ts";

/** PRND, ignition and electronic parking-brake controls for the simulation. */
export class CenterConsoleControls {
  private state: HTMLElement;
  private alert: HTMLElement;
  private engineButton: HTMLButtonElement;
  private epbButton: HTMLButtonElement;
  private gearButtons: HTMLButtonElement[];
  private notice = "";
  private noticeTimer = 0;

  constructor(root: HTMLElement, private sim: Simulation) {
    root.insertAdjacentHTML("beforeend", `
      <section class="center-console panel" aria-label="Cần số và phanh tay">
        <div class="console-title"><span>CỤM ĐIỀU KHIỂN</span><span id="console-engine-state">ĐỘNG CƠ ĐANG BẬT</span></div>
        <div class="prnd-row" role="group" aria-label="Cần số PRND">
          ${(["P", "R", "N", "D"] as Gear[]).map((gear) => `<button class="gear-select" data-gear="${gear}" aria-label="Số ${gear}">${gear}</button>`).join("")}
        </div>
        <div class="console-actions">
          <button class="console-action" id="console-engine">TẮT ĐỘNG CƠ</button>
          <button class="console-action" id="console-epb">NHẢ PHANH TAY</button>
        </div>
        <div class="console-state" id="console-state">Số D · sẵn sàng di chuyển</div>
        <div class="console-alert" id="console-alert" aria-live="assertive"></div>
      </section>
    `);
    this.state = document.getElementById("console-state")!;
    this.alert = document.getElementById("console-alert")!;
    this.engineButton = document.getElementById("console-engine") as HTMLButtonElement;
    this.epbButton = document.getElementById("console-epb") as HTMLButtonElement;
    this.gearButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".gear-select"));

    for (const button of this.gearButtons) {
      button.addEventListener("click", () => {
        const gear = button.dataset.gear as Gear;
        const changed = this.sim.setGear(gear);
        this.update();
        if (!changed) this.message("P và đổi chiều D/R cần xe dừng dưới 0,5 m/s; phải bật động cơ.");
        else this.message(gear === "P" ? "Đã vào P · phanh đỗ tự động được kích hoạt." : `Đã chọn số ${gear}${this.sim.epbEngaged ? " · hãy nhả phanh tay để chạy." : "."}`);
      });
    }
    this.engineButton.addEventListener("click", () => {
      const success = this.sim.setEngineRunning(!this.sim.engineOn);
      this.update();
      if (!success) this.message(this.sim.engineOn ? "Chỉ tắt động cơ khi xe đã dừng và ở số P." : "Chuyển số P trước khi khởi động động cơ.");
      else this.message(this.sim.engineOn ? "Động cơ mô phỏng đã khởi động." : "Động cơ đã tắt · phanh đỗ đang giữ xe.");
    });
    this.epbButton.addEventListener("click", () => {
      const next = !this.sim.epbEngaged;
      const success = this.sim.setParkingBrake(next);
      this.update();
      if (!success) this.message("Hãy dừng xe trước khi kéo phanh đỗ điện tử.");
      else this.message(next ? "Đã kéo phanh đỗ điện tử." : "Đã nhả phanh đỗ điện tử.");
    });
  }

  update(): void {
    const humanMode = this.sim.controlMode === "manual" || this.sim.controlMode === "adas";
    for (const button of this.gearButtons) {
      button.classList.toggle("active", button.dataset.gear === this.sim.gear);
      button.disabled = !humanMode;
    }
    const engineState = document.getElementById("console-engine-state");
    if (engineState) engineState.textContent = this.sim.engineOn ? "ĐỘNG CƠ ĐANG BẬT" : "ĐỘNG CƠ ĐANG TẮT";
    this.engineButton.textContent = this.sim.engineOn ? "TẮT ĐỘNG CƠ" : "ĐỀ MÁY";
    this.engineButton.disabled = !humanMode;
    this.epbButton.textContent = this.sim.epbEngaged ? "NHẢ PHANH TAY" : "KÉO PHANH TAY";
    this.epbButton.classList.toggle("engaged", this.sim.epbEngaged);
    this.epbButton.disabled = !humanMode;
    this.state.textContent = this.notice || (this.sim.gear === "N" ? "N · ngắt truyền động · xe có thể trôi" : `${this.sim.gear} · ${this.sim.epbEngaged ? "phanh đỗ đang giữ xe" : "phanh đỗ đã nhả"}`);
    this.state.classList.toggle("notice", Boolean(this.notice));
    const t = this.sim.telemetry;
    const alert = t.adas.aeb
      ? `AEB TỰ ĐỘNG · PHANH ${Math.round(t.adasBrakeForce * 100)}%`
      : t.rearAeb
        ? "PHANH TỰ ĐỘNG KHI LÙI"
        : t.rctaActive
          ? `CẢNH BÁO CẮT NGANG KHI LÙI${t.rctaLeft && t.rctaRight ? " · HAI BÊN" : t.rctaLeft ? " · BÊN TRÁI" : " · BÊN PHẢI"}`
          : this.sim.driverInput.throttle > 0 && this.sim.gear === "P"
            ? "CHỌN SỐ D HOẶC R ĐỂ DI CHUYỂN"
            : this.sim.driverInput.throttle > 0 && (this.sim.epbEngaged || !this.sim.engineOn)
              ? !this.sim.engineOn ? "HÃY ĐỀ MÁY" : "HÃY NHẢ PHANH TAY"
              : "";
    this.alert.textContent = alert;
    this.alert.classList.toggle("danger", t.adas.aeb || t.rearAeb);
    this.alert.classList.toggle("warn", !t.adas.aeb && !t.rearAeb && t.rctaActive);
  }

  private message(text: string): void {
    this.notice = text;
    this.state.textContent = text;
    this.state.classList.add("notice");
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.notice = "";
      this.update();
    }, 1800);
  }
}
