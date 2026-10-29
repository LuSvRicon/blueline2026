// TelemetryPanel — Real-time vehicle dynamics and telemetry visualization.
// Shows live G-force meters, jerk, cross-track error, and a rolling multi-channel oscilloscope.

import { Simulation } from "../sim/Simulation.ts";
import { isTypingTarget, launchMenuOpen } from "./input.ts";

export class TelemetryPanel {
  private panel: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private visible = false;
  private history: { time: number; speed: number; target: number; accel: number; d: number }[] = [];
  private lastUpdate = 0;

  constructor(root: HTMLElement, private sim: Simulation) {
    const el = document.createElement("div");
    el.className = "telemetry-panel panel";
    el.id = "telemetry-panel";
    el.style.display = "none";
    el.innerHTML = `
      <div class="telemetry-head">
        <span class="telemetry-title">THÔNG SỐ ĐỘNG LỰC HỌC</span>
        <button class="telemetry-close" id="telemetry-close" title="Đóng (Phím G)">✕</button>
      </div>
      <div class="telemetry-grid">
        <div class="telemetry-card">
          <div class="telemetry-lbl">Gia tốc dọc</div>
          <div class="telemetry-val" id="tel-accel-val">0.00 G</div>
          <div class="tel-bar-wrap"><div class="tel-bar" id="tel-accel-bar"></div></div>
        </div>
        <div class="telemetry-card">
          <div class="telemetry-lbl">Gia tốc ngang</div>
          <div class="telemetry-val" id="tel-lat-val">0.00 G</div>
          <div class="tel-bar-wrap"><div class="tel-bar" id="tel-lat-bar"></div></div>
        </div>
        <div class="telemetry-card">
          <div class="telemetry-lbl">Độ giật</div>
          <div class="telemetry-val" id="tel-jerk-val">0.0 m/s³</div>
          <div class="tel-desc" id="tel-jerk-desc">Êm ái</div>
        </div>
        <div class="telemetry-card">
          <div class="telemetry-lbl">Lệch tâm làn</div>
          <div class="telemetry-val" id="tel-d-val">0.00 m</div>
          <div class="tel-desc" id="tel-d-desc">Chính giữa làn</div>
        </div>
      </div>
      <div class="telemetry-chart-title">Biểu đồ động thái thời gian thực (10 giây)</div>
      <canvas class="telemetry-canvas" id="telemetry-canvas" width="340" height="96"></canvas>
      <div class="telemetry-legend">
        <span class="leg-item"><span class="leg-color" style="background:#38bdf8"></span> Tốc độ xe</span>
        <span class="leg-item"><span class="leg-color" style="background:#a855f7"></span> Mục tiêu</span>
        <span class="leg-item"><span class="leg-color" style="background:#22c55e"></span> Gia tốc</span>
        <span class="leg-item"><span class="leg-color" style="background:#f59e0b"></span> Lệch làn d</span>
      </div>
    `;
    root.appendChild(el);
    this.panel = el;
    this.canvas = el.querySelector("#telemetry-canvas") as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d")!;

    el.querySelector("#telemetry-close")?.addEventListener("click", () => this.toggle(false));

    // Shortcut: Press G to toggle telemetry graphs
    window.addEventListener("keydown", (e) => {
      if (e.repeat || isTypingTarget(e.target) || launchMenuOpen()) return;
      if (e.code === "KeyG") {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle(force?: boolean): void {
    this.visible = force !== undefined ? force : !this.visible;
    this.panel.style.display = this.visible ? "flex" : "none";
    const btn = document.getElementById("hud-toggle-telemetry");
    if (btn) btn.classList.toggle("active", this.visible);
  }

  update(): void {
    if (!this.visible) return;

    const now = performance.now();
    if (now - this.lastUpdate < 32) return; // ~30 fps graph refresh
    this.lastUpdate = now;

    const v = this.sim.ego.v;
    const aLong = this.sim.ego.a; // m/s^2
    const gLong = aLong / 9.81;

    const f = this.sim.path.toFrenet(this.sim.ego.x, this.sim.ego.y);
    const k = this.sim.path.signedCurvatureAt(f.s);
    const aLat = v * v * k;
    const gLat = aLat / 9.81;

    const currentLane = this.sim.road.laneOf(f.d);
    const targetLaneCenter = this.sim.road.laneCenter(currentLane);
    const laneOffset = f.d - targetLaneCenter;

    // Jerk from Metrics (mean absolute jerk in m/s³)
    const jerk = this.sim.metrics.meanJerk;

    // Update DOM indicators
    const accelVal = document.getElementById("tel-accel-val");
    if (accelVal) accelVal.textContent = `${gLong >= 0 ? "+" : ""}${gLong.toFixed(2)} G`;
    const accelBar = document.getElementById("tel-accel-bar");
    if (accelBar) {
      const pct = Math.min(100, Math.abs(gLong) / 0.5 * 100);
      accelBar.style.width = `${pct}%`;
      accelBar.style.backgroundColor = gLong < -0.3 ? "#ef4444" : gLong > 0.15 ? "#22c55e" : "#38bdf8";
    }

    const latVal = document.getElementById("tel-lat-val");
    if (latVal) latVal.textContent = `${Math.abs(gLat).toFixed(2)} G`;
    const latBar = document.getElementById("tel-lat-bar");
    if (latBar) {
      const pct = Math.min(100, Math.abs(gLat) / 0.4 * 100);
      latBar.style.width = `${pct}%`;
      latBar.style.backgroundColor = Math.abs(gLat) > 0.25 ? "#f59e0b" : "#38bdf8";
    }

    const jerkVal = document.getElementById("tel-jerk-val");
    if (jerkVal) jerkVal.textContent = `${jerk.toFixed(1)} m/s³`;
    const jerkDesc = document.getElementById("tel-jerk-desc");
    if (jerkDesc) {
      jerkDesc.textContent = jerk < 1.0 ? "Êm ái" : jerk < 2.5 ? "Bình thường" : "Giật mạnh";
      jerkDesc.style.color = jerk < 1.0 ? "#4ade80" : jerk < 2.5 ? "#facc15" : "#f87171";
    }

    const dVal = document.getElementById("tel-d-val");
    if (dVal) dVal.textContent = `${laneOffset >= 0 ? "+" : ""}${laneOffset.toFixed(2)} m`;
    const dDesc = document.getElementById("tel-d-desc");
    if (dDesc) {
      dDesc.textContent = Math.abs(laneOffset) < 0.15 ? "Chính giữa làn" : laneOffset > 0 ? "Lệch phải" : "Lệch trái";
    }

    // Push history (rolling 10s = 300 samples at 30 Hz)
    this.history.push({
      time: now,
      speed: v * 3.6, // km/h
      target: this.sim.planner.config.desiredSpeed * 3.6,
      accel: aLong,
      d: laneOffset,
    });
    if (this.history.length > 250) this.history.shift();

    this.drawChart();
  }

  private drawChart(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 0; y <= h; y += h / 4) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    if (this.history.length < 2) return;

    const n = this.history.length;
    const stepX = w / 250;
    const startX = w - n * stepX;

    // 1. Draw Target Speed (Purple dashed)
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = startX + i * stepX;
      const y = h - (this.history[i].target / 120) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Draw Actual Speed (Blue solid)
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = startX + i * stepX;
      const y = h - (this.history[i].speed / 120) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 3. Draw Acceleration (Green) - Centered around mid-line
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 1.2;
    const midY = h * 0.7;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = startX + i * stepX;
      const y = midY - (this.history[i].accel / 8) * (h * 0.35);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 4. Draw Cross-track offset d (Amber)
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = startX + i * stepX;
      const y = midY - (this.history[i].d / 2.5) * (h * 0.3);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
