// IntroOverlay — the launch screen. Instead of a flat "welcome card" it works
// like a game menu: pick a driving mode (ADAS / manual / autopilot), a traffic
// scenario and the weather, then start. It also doubles as the help panel
// (reopened with the "?" button) and lists the keyboard map.

import { Simulation } from "../sim/Simulation.ts";
import { Scene } from "../render/Scene.ts";
import { ControlMode } from "../sim/Simulation.ts";
import { ScenarioName } from "../traffic/TrafficManager.ts";
import { SCENARIOS } from "./scenarios.ts";

const MODES: { id: ControlMode; icon: string; title: string; text: string }[] = [
  {
    id: "adas",
    icon: "🛡️",
    title: "Hỗ trợ ADAS",
    text: "Tự lái tay và cảm nhận ACC, giữ làn, FCW, AEB, điểm mù, nhận biết biển báo và hỗ trợ chuyển làn.",
  },
  {
    id: "manual",
    icon: "🎮",
    title: "Lái thủ công",
    text: "Toàn quyền điều khiển bằng WASD. Không can thiệp — dùng để cảm nhận xe và giao thông.",
  },
  {
    id: "classical",
    icon: "🤖",
    title: "Tự lái AI",
    text: "Bộ xếp kế hoạch Frenet tự lái. Có thể huấn luyện mạng nơ-ron hoặc tiến hóa AI ngay trong trình duyệt.",
  },
];

export class IntroOverlay {
  private intro: HTMLElement;
  private selectedMode: ControlMode = "adas";
  private selectedScenario: ScenarioName;
  private selectedWeather: "clear" | "rain" | "fog" = "clear";
  private previousPause = false;

  constructor(
    root: HTMLElement,
    private sim: Simulation,
    private scene: Scene,
  ) {
    this.selectedScenario = sim.scenario;
    this.selectedWeather = sim.weather;
    if (sim.controlMode === "manual" || sim.controlMode === "adas") this.selectedMode = sim.controlMode;
    const scenarioOptions = SCENARIOS.map(
      (s) => `<option value="${s.id}"${s.id === sim.scenario ? " selected" : ""}>${s.label}</option>`,
    ).join("");
    const modeCards = MODES.map(
      (m) => `
        <button class="intro-mode${m.id === this.selectedMode ? " active" : ""}" data-intro-mode="${m.id}">
          <span class="intro-mode-icon">${m.icon}</span>
          <span class="intro-mode-title">${m.title}</span>
          <span class="intro-mode-text">${m.text}</span>
        </button>`,
    ).join("");

    root.insertAdjacentHTML(
      "beforeend",
      `
      <button class="intro-help" id="intro-help" title="Giới thiệu BlueLine">?</button>
      <div class="intro" id="intro">
        <div class="intro-card panel">
          <div class="intro-top">
            <div>
              <div class="intro-title">BLUELINE</div>
            <div class="intro-sub">TRẢI NGHIỆM LÁI XE · VIỆT NAM & QUỐC TẾ</div>
            </div>
            <div class="intro-version">v0.5 · BỘ HỖ TRỢ LÁI</div>
          </div>
          <div class="intro-tag">
            Xe, giao thông và các hệ thống hỗ trợ lái được mô phỏng theo cách một chiếc xe hiện đại
            nhìn thế giới. Chọn chế độ và bắt đầu lái.
          </div>

          <div class="intro-label">CHỌN CHẾ ĐỘ LÁI</div>
          <div class="intro-modes">${modeCards}</div>

          <div class="intro-row">
            <label class="intro-field">
              <span>Kịch bản</span>
              <select id="intro-scenario">${scenarioOptions}</select>
            </label>
            <div class="intro-field">
              <span>Thời tiết</span>
              <div class="seg" id="intro-weather">
                <button class="seg-btn active" data-intro-w="clear">Quang</button>
                <button class="seg-btn" data-intro-w="rain">Mưa</button>
                <button class="seg-btn" data-intro-w="fog">Sương</button>
              </div>
            </div>
          </div>

          <button class="bl intro-start" id="intro-start">BẮT ĐẦU LÁI →</button>
          <button class="bl intro-resume" id="intro-resume" hidden>QUAY LẠI PHIÊN LÁI</button>

          <div class="intro-hint">
            <b>W / ↑</b> ga · <b>Space / S / M / ↓</b> phanh · <b>A / D / ← / →</b> lái · <b>Esc</b> tạm dừng ·
            <b>[ ]</b> xi nhan &amp; chuyển làn hỗ trợ ·
            <b>K</b> góc nhìn · <b>H</b> gọn HUD · <b>F1</b> cài đặt · <b>R</b> đặt lại
            <br />Mô hình mô phỏng phục vụ học tập, không phải hệ thống an toàn trên xe thật.
          </div>
        </div>
      </div>
      `,
    );

    this.intro = document.getElementById("intro")!;
    document.getElementById("intro-start")!.addEventListener("click", () => this.start());
    document.getElementById("intro-resume")!.addEventListener("click", () => this.close());
    document.getElementById("intro-help")!.addEventListener("click", () => {
      this.previousPause = this.sim.paused;
      this.sim.paused = true;
      this.sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
      document.getElementById("intro-resume")!.hidden = false;
      this.intro.style.display = "flex";
    });
    (document.getElementById("intro-scenario") as HTMLSelectElement).addEventListener("change", (event) => {
      this.selectedScenario = (event.target as HTMLSelectElement).value as ScenarioName;
    });
    for (const card of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-intro-mode]"))) {
      card.addEventListener("click", () => {
        this.selectedMode = card.dataset.introMode as ControlMode;
        for (const other of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-intro-mode]"))) {
          other.classList.toggle("active", other === card);
        }
      });
    }
    const weatherBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("#intro-weather .seg-btn"));
    for (const button of weatherBtns) {
      button.addEventListener("click", () => {
        weatherBtns.forEach((other) => other.classList.toggle("active", other === button));
        this.selectedWeather = button.dataset.introW as "clear" | "rain" | "fog";
      });
    }
    window.addEventListener("keydown", (event) => {
      if (this.intro.style.display === "none") return;
      if (event.code !== "Enter" && event.code !== "Escape") return;
      if ((event.target as HTMLElement)?.tagName === "SELECT") return;
      if (event.code === "Enter" && (event.target as HTMLElement)?.tagName === "BUTTON" && (event.target as HTMLElement).id !== "intro-start") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.code === "Enter") this.start();
      else this.close();
    }, { capture: true });

    // Deep links can skip the menu (handy for screenshots and kiosk demos).
    const params = new URLSearchParams(location.search);
    if (params.get("intro") === "0") this.intro.style.display = "none";
    else { this.previousPause = sim.paused; sim.paused = true; }
    for (const button of weatherBtns) button.classList.toggle("active", button.dataset.introW === this.selectedWeather);
  }

  private close(): void {
    this.intro.style.display = "none";
    this.sim.paused = this.previousPause;
  }

  private start(): void {
    this.sim.setControlMode(this.selectedMode);
    this.sim.setScenario(this.selectedScenario);
    this.sim.setWeather(this.selectedWeather);
    this.scene.setWeather(this.selectedWeather);
    this.intro.style.display = "none";
    this.sim.paused = false;
  }
}
