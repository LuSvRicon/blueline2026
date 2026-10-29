import { Simulation } from "../sim/Simulation.ts";
import { Scene, CameraMode } from "../render/Scene.ts";
import { DriveControls } from "./DriveControls.ts";
import { Camera360Widget } from "./Camera360Widget.ts";
import { TelemetryPanel } from "./TelemetryPanel.ts";
import { SCENARIOS } from "./scenarios.ts";
import { isTypingTarget, launchMenuOpen } from "./input.ts";
import { TRACKS } from "../world/track.ts";

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
    const settings = document.querySelector("#c-settings-drawer .control-drawer-body")!;
    settings.insertAdjacentHTML("afterbegin", `<label class="drawer-label">Bản đồ · chọn để bắt đầu phiên mới</label><select class="game-setting-select" id="game-map" aria-label="Bản đồ">${TRACKS.map(track => `<option value="${track.id}"${sim.track.id === track.id ? " selected" : ""}>${track.name}</option>`).join("")}</select>`);
    settings.insertAdjacentHTML("beforeend", `
      <label class="drawer-label">Góc nhìn & cảm giác điều khiển</label>
      <label class="game-slider"><span>Góc nhìn ngang cabin <b id="game-fov-value">96°</b></span><input type="range" id="game-fov" min="75" max="110" step="1" value="96"></label>
      <label class="game-slider"><span>Độ cao ghế <b id="game-seat-value">130 cm</b></span><input type="range" id="game-seat" min="122" max="140" step="1" value="130"></label>
      <button type="button" class="bl" id="game-reset-seat">Đưa ghế & góc nhìn về mặc định</button>
      <label class="game-slider"><span>Độ nhạy lái <b id="game-steering-value">100%</b></span><input type="range" id="game-steering" min="50" max="180" step="5" value="100"></label>
      <label class="game-slider"><span>Vùng chết tay cầm <b id="game-deadzone-value">8%</b></span><input type="range" id="game-deadzone" min="3" max="25" step="1" value="8"></label>
      <label class="drawer-label" for="game-quality">Chất lượng dựng hình</label><select class="game-setting-select" id="game-quality"><option value="low">Tiết kiệm hiệu năng</option><option value="balanced" selected>Cân bằng</option><option value="high">Chi tiết cao</option></select>
    `);
    document.getElementById("game-map")!.addEventListener("change", event => {
      const url = new URL(location.href); url.searchParams.set("map", (event.target as HTMLSelectElement).value);
      url.searchParams.set("mode", sim.controlMode); url.searchParams.set("profile", sim.traffic.profile);
      url.searchParams.set("scenario", sim.scenario); url.searchParams.set("weather", sim.weather); url.searchParams.set("tod", scene.timeOfDay); url.searchParams.set("intro", "0");
      location.assign(url.href);
    });
    this.slider("fov", value => { scene.setCockpitFov(value); return `${value}°`; },"fov-horizontal");
    this.slider("seat", value => { scene.cockpitEyeHeight = value / 100; return `${value} cm`; });
    this.slider("steering", value => { drive.steeringSensitivity = value / 100; return `${value}%`; });
    this.slider("deadzone", value => { drive.gamepadDeadzone = value / 100; return `${value}%`; });
    this.on("game-reset-seat",()=>{
      for(const [id,value] of [["fov","96"],["seat","130"]]) {
        const input=document.getElementById(`game-${id}`) as HTMLInputElement;input.value=value;input.dispatchEvent(new Event("input"));
      }
      scene.setCabinLook(0,0);
    });
    const quality = document.getElementById("game-quality") as HTMLSelectElement;
    try { const saved = localStorage.getItem("blueline.setting.quality"); if (saved && ["low","balanced","high"].includes(saved)) quality.value = saved; } catch { /* Browser storage may be disabled. */ }
    scene.setQuality(quality.value as "low" | "balanced" | "high");
    quality.addEventListener("change", () => {
      scene.setQuality(quality.value as "low" | "balanced" | "high");
      try { localStorage.setItem("blueline.setting.quality",quality.value); } catch { /* Keep the current setting in memory. */ }
    });
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
  private slider(id: string, apply: (value: number) => string, preferenceKey = id): void {
    const input = document.getElementById(`game-${id}`) as HTMLInputElement;
    try {
      const saved = localStorage.getItem(`blueline.setting.${preferenceKey}`);
      if (saved !== null && Number.isFinite(Number(saved))) input.value = String(Math.max(Number(input.min), Math.min(Number(input.max), Number(saved))));
    } catch { /* Browser storage may be disabled. */ }
    document.getElementById(`game-${id}-value`)!.textContent = apply(Number(input.value));
    input.addEventListener("input", () => {
      document.getElementById(`game-${id}-value`)!.textContent = apply(Number(input.value));
      try { localStorage.setItem(`blueline.setting.${preferenceKey}`,input.value); } catch { /* Keep the current setting in memory. */ }
    });
  }

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
    document.getElementById("game-camera-name")!.textContent = this.scene.cameraMode === "cockpit" ? "Nhìn quanh: giữ chuột phải / Num 4·6 · Num 5 về giữa" : CAMERA_NAMES[this.scene.cameraMode];
    document.getElementById("game-scenario-info")!.textContent = `${this.sim.traffic.profile === "vietnam" ? "VIỆT NAM" : "QUỐC TẾ"} / ${this.sim.track.name} / ${SCENARIOS.find(s => s.id === this.sim.scenario)?.label ?? this.sim.scenario}`;
    const elapsed = Math.floor(this.sim.metrics.time);
    document.getElementById("game-session-info")!.textContent = `${Math.floor(elapsed / 60).toString().padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")} · ${(this.sim.metrics.distance / 1000).toFixed(2)} km${this.sim.recorder.recording ? " · ● ĐANG GHI" : this.sim.recorder.playing ? " · PHÁT LẠI" : ""}`;
    if (this.lastCamera !== this.scene.cameraMode) {
      this.feedback(CAMERA_NAMES[this.scene.cameraMode]);
      this.lastCamera = this.scene.cameraMode;
    }
  }
}
