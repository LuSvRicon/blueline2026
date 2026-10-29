import { Simulation } from "../sim/Simulation.ts";
import { Scene, CameraMode } from "../render/Scene.ts";
import { DriveControls } from "./DriveControls.ts";
import { Camera360Widget } from "./Camera360Widget.ts";
import { TelemetryPanel } from "./TelemetryPanel.ts";
import { SCENARIOS } from "./scenarios.ts";
import { isTypingTarget, launchMenuOpen } from "./input.ts";

const CAMERAS: CameraMode[] = ["chase", "cockpit", "top", "orbit"];
const CAMERA_NAMES = { chase: "Bám theo xe", cockpit: "Trong cabin", top: "Từ trên cao", orbit: "Xoay quanh xe" };

/** Composes the existing working panels into one cockpit and optional drawers. */
export class CockpitLayout {
  private panel: HTMLElement;
  private config: HTMLDetailsElement;
  private mode: HTMLSelectElement;
  private cameraButton: HTMLButtonElement;
  private pauseOverlay: HTMLElement;
  private lastCamera: CameraMode;
  private lastRefresh = -Infinity;

  constructor(private root: HTMLElement, private sim: Simulation, private scene: Scene,
    private drive: DriveControls, private camera360: Camera360Widget, telemetry: TelemetryPanel) {
    root.classList.add("game-ui");
    root.insertAdjacentHTML("beforeend", `
      <header class="game-toolbar" aria-label="Thanh công cụ mô phỏng">
        <div class="game-brand"><span class="game-brand-mark">B<span>‖</span></span><div><b>BLUELINE</b><small>MÔ PHỎNG LÁI XE</small></div></div>
        <span class="toolbar-divider"></span>
        <button class="game-tool" id="game-menu" aria-expanded="false" title="Mở bảng điều khiển (F1)">☰ <span>Điều khiển</span><kbd>F1</kbd></button>
        <button class="game-tool" id="game-scenarios">Tình huống</button>
        <button class="game-tool" id="game-settings">Cài đặt</button>
        <select id="game-mode" aria-label="Chế độ lái">
          <option value="manual">Lái thủ công</option><option value="adas">Hỗ trợ ADAS</option>
          <option value="classical">Tự lái AI</option><option value="learned" disabled>Mạng nơ-ron</option><option value="external" disabled>AI tiến hóa</option>
        </select>
        <div class="game-toolbar-spacer"></div>
        <button class="game-tool game-score" id="game-score" aria-expanded="false" title="Xem điểm và thống kê phiên lái">Điểm <b id="game-score-value">—</b></button>
        <button class="game-tool" id="game-camera" title="Đổi góc nhìn (K)">Góc nhìn <kbd>K</kbd></button>
        <button class="game-tool" id="game-surround" aria-pressed="true">Cam 360°</button>
        <button class="game-tool" id="game-focus" aria-pressed="false" title="Thu gọn HUD (H)">Gọn HUD <kbd>H</kbd></button>
        <button class="game-tool game-icon-tool" id="game-fullscreen" title="Toàn màn hình" aria-label="Toàn màn hình">⛶</button>
        <button class="game-tool game-pause" id="game-pause" title="Tạm dừng hoặc tiếp tục (Esc)">Ⅱ</button>
      </header>
      <div class="game-session-strip"><span class="session-dot"></span><span id="game-scenario-info"></span><span id="game-session-info"></span></div>
      <section class="game-dock" aria-label="Bảng điều khiển xe"></section>
      <footer class="game-keybar"><span><kbd>W</kbd> Ga <kbd>S</kbd> / <kbd>Space</kbd> Phanh <kbd>A</kbd><kbd>D</kbd> Lái <kbd>[</kbd><kbd>]</kbd> Xi nhan</span><span id="game-camera-name"></span><span>ADAS: mô hình mô phỏng</span></footer>
      <div class="game-pause-overlay" hidden>
        <section class="game-pause-card"><small>BLUELINE · PHIÊN LÁI</small><h2>Đã tạm dừng</h2><p>Xe và giao thông đang dừng mô phỏng.</p>
          <button class="game-primary" id="game-resume">Tiếp tục lái <kbd>Esc</kbd></button>
          <button class="game-secondary" id="game-reset">Đặt lại tình huống</button>
          <button class="game-secondary" id="game-help">Hướng dẫn & chọn phiên mới</button>
        </section>
      </div>
      <div id="game-feedback" class="game-feedback" role="status"></div>
    `);
    const dock = root.querySelector<HTMLElement>(".game-dock")!;
    for (const selector of [".center-console", ".speedo", ".adas-panel", ".pedal-controls"]) {
      const panel = root.querySelector<HTMLElement>(selector);
      if (panel) dock.appendChild(panel);
    }
    this.panel = document.getElementById("control-panel")!;
    this.panel.hidden = true;
    this.config = root.querySelector<HTMLDetailsElement>(".adas-config")!;
    this.mode = document.getElementById("game-mode") as HTMLSelectElement;
    this.cameraButton = document.getElementById("game-camera") as HTMLButtonElement;
    this.pauseOverlay = root.querySelector<HTMLElement>(".game-pause-overlay")!;
    this.lastCamera = scene.cameraMode;
    root.querySelector(".adas-config-heading")!.insertAdjacentHTML("beforeend", '<button type="button" class="adas-config-close" aria-label="Đóng cài đặt hỗ trợ">×</button>');
    root.querySelector(".adas-config-close")!.addEventListener("click", () => { this.config.open = false; });
    this.config.addEventListener("toggle", () => {
      root.classList.toggle("adas-settings-open", this.config.open);
      if (this.config.open) { this.panel.hidden = true; root.classList.remove("stats-open"); }
    });

    // Preserve the AI lab and detailed telemetry inside optional drawers.
    const body = document.getElementById("c-panel-body")!;
    for (const [selector, id, label] of [[".neural", "c-lab-drawer", "Phòng AI · huấn luyện & mô hình"], [".telemetry", "c-telemetry-drawer", "Thông số kỹ thuật"]]) {
      const content = root.querySelector<HTMLElement>(selector);
      if (!content) continue;
      const details = document.createElement("details");
      details.className = "control-drawer";
      details.id = id;
      details.innerHTML = `<summary><span>${label}</span><span class="drawer-chevron">⌄</span></summary><div class="control-drawer-body"></div>`;
      details.querySelector("div")!.appendChild(content);
      body.appendChild(details);
    }
    document.querySelector("#c-settings-drawer .control-drawer-body")!.insertAdjacentHTML("beforeend", '<button type="button" class="bl" id="game-minimap" aria-pressed="false">Hiện radar bản đồ</button>');
    document.querySelector("#c-telemetry-drawer .control-drawer-body")!.insertAdjacentHTML("afterbegin", '<button type="button" class="bl" id="game-graphs">Biểu đồ động lực học · G</button>');
    this.on("game-minimap", () => {
      const visible = root.classList.toggle("map-open");
      document.getElementById("game-minimap")!.setAttribute("aria-pressed", String(visible));
      document.getElementById("game-minimap")!.textContent = visible ? "Ẩn radar bản đồ" : "Hiện radar bản đồ";
    });
    this.on("game-graphs", () => telemetry.toggle());
    this.on("game-menu", () => this.openControls());
    this.on("game-scenarios", () => this.openControls("c-scenario-drawer"));
    this.on("game-settings", () => this.openControls("c-settings-drawer"));
    this.on("game-score", () => {
      const open = root.classList.toggle("stats-open");
      if (open) { this.panel.hidden = true; this.config.open = false; }
    });
    this.on("game-camera", () => this.cycleCamera());
    this.on("game-surround", () => camera360.setExpanded(!camera360.expanded));
    this.on("game-focus", () => this.toggleFocus());
    this.on("game-pause", () => document.getElementById("c-pause")!.click());
    this.on("game-resume", () => { sim.paused = false; drive.clear(); });
    this.on("game-reset", () => { sim.reset(); sim.paused = false; drive.clear(); });
    this.on("game-help", () => document.getElementById("intro-help")!.click());
    this.on("game-fullscreen", async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch { this.feedback("Trình duyệt chưa cho phép mở toàn màn hình."); }
    });
    this.mode.addEventListener("change", () => {
      const aiButton: Record<string, string> = { classical: "nn-classical", learned: "nn-ai", external: "nn-evo" };
      if (aiButton[this.mode.value]) document.getElementById(aiButton[this.mode.value])!.click();
      else sim.setControlMode(this.mode.value as Simulation["controlMode"]);
      drive.clear();
    });
    window.addEventListener("keydown", (event) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target) || launchMenuOpen()) return;
      const action: Record<string, () => void> = {
        F1: () => this.openControls(), KeyK: () => this.cycleCamera(), KeyH: () => this.toggleFocus(),
      };
      if (action[event.code]) { event.preventDefault(); action[event.code](); }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { sim.paused = true; drive.clear(); }
    });
    window.addEventListener("blur", () => { sim.paused = true; drive.clear(); });
    this.update();
  }

  private on(id: string, action: () => void): void { document.getElementById(id)!.addEventListener("click", action); }

  private openControls(drawer?: string): void {
    this.root.classList.remove("focus-mode", "stats-open");
    this.config.open = false;
    this.panel.hidden = drawer ? false : !this.panel.hidden;
    if (drawer) for (const details of Array.from(this.panel.querySelectorAll<HTMLDetailsElement>("details"))) details.open = details.id === drawer;
  }

  private cycleCamera(): void { this.scene.cameraMode = CAMERAS[(CAMERAS.indexOf(this.scene.cameraMode) + 1) % CAMERAS.length]; }
  private toggleFocus(): void {
    const compact = this.root.classList.toggle("focus-mode");
    if (compact) { this.panel.hidden = true; this.config.open = false; this.root.classList.remove("stats-open"); }
  }
  private feedback(message: string): void {
    const feedback = document.getElementById("game-feedback")!;
    feedback.textContent = message;
    window.setTimeout(() => { feedback.textContent = ""; }, 4000);
  }

  update(): void {
    const now = performance.now();
    if (now - this.lastRefresh < 80) return;
    this.lastRefresh = now;
    const intro = launchMenuOpen();
    this.root.classList.toggle("launch-open", intro);
    this.root.classList.toggle("reverse-mode", this.sim.gear === "R");
    const dock = this.root.querySelector<HTMLElement>(".game-dock")!;
    this.scene.setHudInset(this.root.classList.contains("focus-mode") ? 0 : dock.getBoundingClientRect().height);
    this.pauseOverlay.hidden = !this.sim.paused || intro;
    this.root.classList.toggle("game-paused", this.sim.paused && !intro);
    this.mode.value = this.sim.controlMode;
    this.mode.querySelector<HTMLOptionElement>('[value="learned"]')!.disabled = !this.sim.imitation.trained;
    this.mode.querySelector<HTMLOptionElement>('[value="external"]')!.disabled = !this.sim.evolvedChampion;
    const menu = document.getElementById("game-menu")!;
    menu.classList.toggle("active", !this.panel.hidden);
    menu.setAttribute("aria-expanded", String(!this.panel.hidden));
    const score = document.getElementById("game-score")!;
    score.setAttribute("aria-expanded", String(this.root.classList.contains("stats-open")));
    document.getElementById("game-score-value")!.textContent = String(Math.round(this.sim.metrics.scores().overall));
    document.getElementById("game-focus")!.setAttribute("aria-pressed", String(this.root.classList.contains("focus-mode")));
    document.getElementById("game-surround")!.setAttribute("aria-pressed", String(this.camera360.expanded));
    const pause = document.getElementById("game-pause")!;
    pause.textContent = this.sim.paused ? "▶" : "Ⅱ";
    pause.setAttribute("aria-label", this.sim.paused ? "Tiếp tục mô phỏng" : "Tạm dừng mô phỏng");
    this.cameraButton.textContent = `${CAMERA_NAMES[this.scene.cameraMode]} · K`;
    document.getElementById("game-camera-name")!.textContent = CAMERA_NAMES[this.scene.cameraMode];
    document.getElementById("game-scenario-info")!.textContent = `${this.sim.traffic.profile === "vietnam" ? "VIỆT NAM" : "QUỐC TẾ"} / ${SCENARIOS.find(s => s.id === this.sim.scenario)?.label ?? this.sim.scenario}`;
    const elapsed = Math.floor(this.sim.metrics.time);
    document.getElementById("game-session-info")!.textContent = `${Math.floor(elapsed / 60).toString().padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")} · ${(this.sim.metrics.distance / 1000).toFixed(2)} km${this.sim.recorder.recording ? " · ● ĐANG GHI" : this.sim.recorder.playing ? " · PHÁT LẠI" : ""}`;
    if (this.lastCamera !== this.scene.cameraMode) {
      this.feedback(CAMERA_NAMES[this.scene.cameraMode]);
      this.lastCamera = this.scene.cameraMode;
    }
  }
}
