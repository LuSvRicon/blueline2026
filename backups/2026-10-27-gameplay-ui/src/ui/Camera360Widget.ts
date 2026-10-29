import { Simulation } from "../sim/Simulation.ts";
import { SurroundView } from "../render/Scene.ts";

type View = SurroundView;

/** Lightweight bird's-eye surround display rendered from the simulated actors. */
export class Camera360Widget {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private view: View = "360";
  private previousGear: string;
  private buttons: HTMLButtonElement[];
  private leftArrow: HTMLElement;
  private rightArrow: HTMLElement;
  private status: HTMLElement;
  private screen: HTMLElement;
  private widget: HTMLElement;
  private collapseButton: HTMLButtonElement;

  constructor(root: HTMLElement, private sim: Simulation) {
    root.insertAdjacentHTML("beforeend", `
      <section class="camera-360-widget panel" aria-label="Màn hình camera quan sát quanh xe">
        <div class="camera-360-head">
          <b>CAMERA 360°</b>
          <div class="camera-360-actions">
            <span id="camera360-status">GÓC NHÌN MÔ PHỎNG</span>
            <button class="camera-360-collapse" id="camera360-collapse" type="button" aria-label="Thu gọn camera" aria-expanded="true">−</button>
          </div>
        </div>
        <div class="camera-360-screen">
          <canvas id="camera360-canvas" width="360" height="210" aria-label="Mô phỏng góc nhìn camera quanh xe"></canvas>
          <span class="rcta-arrow rcta-arrow-left" id="camera360-left">◀</span>
          <span class="rcta-arrow rcta-arrow-right" id="camera360-right">▶</span>
          <span class="camera-360-tag">HÌNH DỰNG TỪ MÔ PHỎNG</span>
        </div>
        <div class="camera-360-modes" role="group" aria-label="Chọn góc camera">
          <button data-view="front">Trước</button><button data-view="rear">Lùi</button>
          <button data-view="left">Trái</button><button data-view="right">Phải</button>
          <button class="active" data-view="360">360°</button>
        </div>
      </section>
    `);
    this.canvas = document.getElementById("camera360-canvas") as HTMLCanvasElement;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Trình duyệt không khởi tạo được vùng vẽ Camera 360°.");
    this.ctx = ctx;
    this.previousGear = sim.gear;
    this.buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-view]"));
    this.leftArrow = document.getElementById("camera360-left")!;
    this.rightArrow = document.getElementById("camera360-right")!;
    this.status = document.getElementById("camera360-status")!;
    this.screen = root.querySelector<HTMLElement>(".camera-360-screen")!;
    this.widget = root.querySelector<HTMLElement>(".camera-360-widget")!;
    this.collapseButton = document.getElementById("camera360-collapse") as HTMLButtonElement;
    this.collapseButton.addEventListener("click", () => {
      const collapsed = this.widget.classList.toggle("collapsed");
      this.collapseButton.textContent = collapsed ? "+" : "−";
      this.collapseButton.setAttribute("aria-expanded", String(!collapsed));
      this.collapseButton.setAttribute("aria-label", collapsed ? "Mở camera" : "Thu gọn camera");
    });
    for (const button of this.buttons) {
      button.addEventListener("click", () => {
        this.view = button.dataset.view as View;
        this.update(this.sim.telemetry);
      });
    }
  }

  get activeView(): SurroundView {
    return this.view;
  }

  get renderSurface(): HTMLElement {
    return this.screen;
  }

  update(t: Simulation["telemetry"]): void {
    if (this.sim.gear !== this.previousGear) {
      this.view = this.sim.gear === "R" ? "rear" : "360";
      this.previousGear = this.sim.gear;
    }
    for (const button of this.buttons) button.classList.toggle("active", button.dataset.view === this.view);
    this.leftArrow.classList.toggle("active", t.rctaLeft);
    this.rightArrow.classList.toggle("active", t.rctaRight);
    this.status.textContent = t.rearAeb
      ? "PHANH TỰ ĐỘNG KHI LÙI"
      : t.rctaActive
        ? "CÓ PHƯƠNG TIỆN CẮT NGANG"
        : this.sim.gear === "R"
          ? "CAMERA LÙI · RCTA SẴN SÀNG"
          : this.view === "front"
            ? "CAMERA TRƯỚC · ĐANG HOẠT ĐỘNG"
            : this.view === "rear"
              ? "CAMERA SAU · ĐANG HOẠT ĐỘNG"
              : this.view === "left"
                ? "CAMERA BÊN TRÁI · ĐANG HOẠT ĐỘNG"
                : this.view === "right"
                  ? "CAMERA BÊN PHẢI · ĐANG HOẠT ĐỘNG"
                  : "CAMERA 360° ĐANG HOẠT ĐỘNG";
    this.status.classList.toggle("warn", t.rctaActive && !t.rearAeb);
    this.status.classList.toggle("danger", t.rearAeb);
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const centerX = width / 2;
    ctx.clearRect(0, 0, width, height);

    // A subtle steering-angle trajectory is useful when backing into a space.
    if (this.sim.gear === "R" || this.view === "rear" || this.view === "360") {
      const steer = Math.max(-1, Math.min(1, this.sim.ego.delta / this.sim.ego.maxSteer));
      for (const side of [-1, 1]) {
        ctx.strokeStyle = side < 0 ? "rgba(74,222,128,.86)" : "rgba(250,204,21,.86)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(centerX + side * 31, height * 0.78);
        ctx.quadraticCurveTo(
          centerX + side * 44 + steer * 17,
          height * 0.9,
          centerX + side * 62 + steer * 43,
          height * 1.08,
        );
        ctx.stroke();
      }
    }

    if (this.sim.telemetry.rctaActive) {
      ctx.fillStyle = "rgba(255,65,65,.92)";
      ctx.font = "700 11px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("CÓ XE CẮT NGANG", centerX, height - 10);
    }
  }
}
