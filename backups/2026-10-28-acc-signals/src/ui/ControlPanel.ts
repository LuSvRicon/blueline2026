// ControlPanel — the interactive dashboard (bottom-left). Lets the viewer drive
// the demo: pick a scenario, change the ego's target speed, add/remove traffic,
// pause/reset, switch camera, and toggle every perception/planner overlay.

import * as THREE from "three";
import { ControlMode, ScenarioEventName, Simulation } from "../sim/Simulation.ts";
import { CameraMode, Scene } from "../render/Scene.ts";
import { CandidatesView } from "../render/CandidatesView.ts";
import { ScenarioName, TrafficProfile } from "../traffic/TrafficManager.ts";
import { mps2kph, kph2mps } from "../core/math.ts";
import { SimulationAudio } from "../audio/SimulationAudio.ts";
import { SCENARIOS } from "./scenarios.ts";

export interface OverlayObjects {
  occupancy: THREE.Object3D;
  tracks: THREE.Object3D;
  sensor: THREE.Object3D;
  buildings: THREE.Object3D;
  navigation: THREE.Object3D;
}


export class ControlPanel {
  constructor(
    root: HTMLElement,
    private sim: Simulation,
    private scene: Scene,
    private candidates: CandidatesView,
    private overlays: OverlayObjects,
    private audio: SimulationAudio,
  ) {
    const scenarioBtns = SCENARIOS.map(
      (s) => `<button class="bl scn${s.id === sim.scenario ? " active" : ""}" data-scn="${s.id}">${s.label}</button>`,
    ).join("");

    root.insertAdjacentHTML(
      "beforeend",
      `
      <div class="controls panel" id="control-panel">
        <div class="controls-head">
          <div><span class="controls-eyebrow">BLUELINE · MÔ PHỎNG</span><b>BẢNG ĐIỀU KHIỂN</b></div>
          <button class="controls-hide" id="c-panel-hide" type="button" aria-label="Ẩn bảng điều khiển" title="Ẩn bảng điều khiển">×</button>
        </div>
        <div class="controls-body" id="c-panel-body">
          <section class="control-drive-section">
            <h4>CHẾ ĐỘ LÁI</h4>
            <div class="btn-row drive-modes" id="c-drive-mode">
              <button class="bl" data-drive-mode="manual" aria-pressed="false">Lái thủ công</button>
              <button class="bl active" data-drive-mode="classical" aria-pressed="true">Tự lái AI</button>
              <button class="bl" data-drive-mode="adas" aria-pressed="false">Hỗ trợ ADAS</button>
            </div>
            <div class="drive-help">WASD / phím mũi tên · Space phanh</div>
            <div class="adas-state" id="c-adas-state">Chưa bật hỗ trợ lái.</div>
          </section>

          <details class="control-drawer" id="c-scenario-drawer">
            <summary><span>🚦 Tình huống &amp; giao thông</span><span class="drawer-chevron">⌄</span></summary>
            <div class="control-drawer-body">
              <label class="drawer-label">Mật độ giao thông</label>
              <div class="ctl">
                <div class="ctl-label"><span>Số phương tiện</span><span class="val" id="c-traffic-val"></span></div>
                <input type="range" id="c-traffic" min="0" max="40" step="1" />
              </div>
              <label class="drawer-label">Mô hình giao thông</label>
              <div class="seg profile-select" id="c-profile">
                <button class="seg-btn${sim.traffic.profile === "international" ? " active" : ""}" data-profile="international" aria-pressed="${sim.traffic.profile === "international"}">Quốc tế</button>
                <button class="seg-btn${sim.traffic.profile === "vietnam" ? " active" : ""}" data-profile="vietnam" aria-pressed="${sim.traffic.profile === "vietnam"}">Việt Nam</button>
              </div>
              <label class="drawer-label">Kịch bản có sẵn</label>
              <div class="btn-row wrap scenario-grid">${scenarioBtns}</div>
              <p class="scenario-description" id="c-scenario-description"></p>
              <label class="drawer-label">Tạo tình huống trực tiếp</label>
              <div class="btn-row wrap event-controls">
                <button class="bl" data-event="stopped-lead">Xe dừng phía trước</button>
                <button class="bl" data-event="motorcycle-cutin">Xe máy tạt đầu</button>
                <button class="bl" data-event="vehicle-crossing">Xe cắt ngang</button>
                <button class="bl" data-event="pedestrian-crossing">Người đi bộ sang đường</button>
                <button class="bl" data-event="motorcycle-weave">Xe máy luồn làn</button>
                <button class="bl" data-event="bus-stop">Xe buýt đón khách</button>
                <button class="bl" data-event="rear-crossing-left">Cắt ngang sau từ trái · R</button>
                <button class="bl" data-event="rear-crossing-right">Cắt ngang sau từ phải · R</button>
              </div>
              <div class="event-status" id="c-event-status">Tình huống thêm vào phiên đang chạy.</div>
            </div>
          </details>

          <details class="control-drawer" id="c-settings-drawer">
            <summary><span>⚙ Cài đặt mô phỏng</span><span class="drawer-chevron">⌄</span></summary>
            <div class="control-drawer-body">
              <label class="drawer-label">Điều chỉnh xe</label>
              <div class="ctl">
                <div class="ctl-label"><span>Tốc độ mục tiêu</span><span class="val" id="c-speed-val"></span></div>
                <input type="range" id="c-speed" min="20" max="140" step="1" />
              </div>
              <div class="toggle-row"><span>Hiện nhà cửa</span><div class="switch on" id="c-build"><div class="knob"></div></div></div>
              <div class="toggle-row"><span>Nhận thức cảm biến</span><div class="switch on" id="c-percept"><div class="knob"></div></div></div>
              <div class="toggle-row"><span>Phạm vi cảm biến</span><div class="switch" id="c-sensor"><div class="knob"></div></div></div>
              <div class="toggle-row"><span>Hộp theo dõi vật thể</span><div class="switch" id="c-tracks"><div class="knob"></div></div></div>
              <div class="toggle-row"><span>Lưới chiếm chỗ</span><div class="switch" id="c-occ"><div class="knob"></div></div></div>
              <div class="toggle-row"><span>Dẫn đường trên mặt đường</span><div class="switch on" id="c-guide"><div class="knob"></div></div></div>
              <div class="toggle-row"><span>Quỹ đạo ứng viên</span><div class="switch" id="c-cand"><div class="knob"></div></div></div>
              <label class="drawer-label">Góc nhìn</label>
              <div class="btn-row camera-modes">
                <button class="bl active" data-camera="chase">Bám theo xe</button>
                <button class="bl" data-camera="cockpit">Trong cabin</button>
                <button class="bl" data-camera="top">Nhìn từ trên</button>
                <button class="bl" data-camera="orbit">Camera 360°</button>
              </div>
              <div class="camera-help" id="c-camera-help">Kéo chuột để xoay quanh xe · lăn chuột để phóng to/thu nhỏ</div>
              <label class="drawer-label">Thời tiết</label>
              <div class="seg" id="c-weather">
                <button class="seg-btn active" data-w="clear">Trời quang</button>
                <button class="seg-btn" data-w="rain">Mưa</button>
                <button class="seg-btn" data-w="fog">Sương mù</button>
              </div>
              <label class="drawer-label">Thời điểm</label>
              <div class="seg" id="c-tod">
                <button class="seg-btn active" data-t="night">Ban đêm</button>
                <button class="seg-btn" data-t="day">Ban ngày</button>
              </div>
              <div class="btn-row control-utility-buttons">
                <button class="bl" id="c-pause">Tạm dừng</button>
                <button class="bl" id="c-reset">Đặt lại</button>
              </div>
              <div class="simulation-only">ADAS trong BlueLine là mô hình mô phỏng, chưa được kiểm định để sử dụng trên xe thật.</div>
            </div>
          </details>

          <details class="control-drawer" id="c-session-drawer">
            <summary><span>⏺ Phiên lái &amp; âm thanh</span><span class="drawer-chevron">⌄</span></summary>
            <div class="control-drawer-body session-drawer-body">
              <div class="btn-row session-controls">
                <button class="bl record" id="c-record">● Ghi</button>
                <button class="bl" id="c-stop-session" disabled>Dừng</button>
                <button class="bl" id="c-replay" disabled>Phát lại</button>
                <button class="bl" id="c-export-session" disabled>Xuất tệp</button>
              </div>
              <div class="session-status" id="c-session-status">Chưa có phiên lái.</div>
              <button class="bl audio-button" id="c-audio" aria-pressed="false">Bật âm thanh</button>
              <div class="ctl audio-volume-row">
                <div class="ctl-label"><span>Âm lượng</span><span class="val" id="c-audio-val">85%</span></div>
                <input type="range" id="c-audio-vol" min="0" max="100" step="5" value="85" />
              </div>
            </div>
          </details>
        </div>
      </div>
      <button class="control-reopen" id="c-panel-show" type="button" hidden>☰ Điều khiển</button>
      `,
    );

    this.wireScenarios();
    this.wireDriveModes();
    this.wireTrafficProfile();
    this.wireSessionControls();
    this.wireAudio();
    this.wireScenarioLab();
    this.wireSpeed();
    this.wireTraffic();
    this.wireToggles();
    this.wirePlayReset();
    this.wireCamera();
    this.wireWeather();
    this.wireTimeOfDay();
    this.wirePanelVisibility();
    this.updateSessionStatus();
  }

  update(): void {
    const activeMode = this.sim.controlMode === "manual"
      ? "manual"
      : this.sim.controlMode === "adas"
        ? "adas"
        : "classical";
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-drive-mode]"))) {
      const active = button.dataset.driveMode === activeMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-profile]"))) {
      const active = button.dataset.profile === this.sim.traffic.profile;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-camera]"))) {
      button.classList.toggle("active", button.dataset.camera === this.scene.cameraMode);
    }
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>(".scn"))) {
      button.classList.toggle("active", button.dataset.scn === this.sim.scenario);
    }
    const description = document.getElementById("c-scenario-description");
    if (description) description.textContent = SCENARIOS.find(scenario => scenario.id === this.sim.scenario)?.description ?? "Chọn tình huống hoặc thêm một sự kiện trực tiếp vào phiên lái.";
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("#c-weather .seg-btn"))) {
      button.classList.toggle("active", button.dataset.w === this.sim.weather);
    }
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("#c-tod .seg-btn"))) {
      button.classList.toggle("active", button.dataset.t === this.scene.timeOfDay);
    }
    document.getElementById("c-camera-help")?.classList.toggle("visible", this.scene.cameraMode === "orbit");
    const pause = document.getElementById("c-pause") as HTMLButtonElement | null;
    if (pause) {
      pause.textContent = this.sim.paused ? "Chạy tiếp" : "Tạm dừng";
      pause.classList.toggle("active", this.sim.paused);
    }

    const status = this.sim.adas.status;
    const message = document.getElementById("c-adas-state");
    if (!message) return;
    if (!status.active) {
      message.textContent = "Chưa bật hỗ trợ lái.";
    } else {
      const active: string[] = [];
      if (status.accActive) active.push("ACC");
      if (status.laneCenteringActive) active.push("GIỮ LÀN");
      if (status.laneDeparture === "left") active.push("LỆCH LÀN TRÁI");
      if (status.laneDeparture === "right") active.push("LỆCH LÀN PHẢI");
      if (status.fcw) active.push("CẢNH BÁO PHÍA TRƯỚC");
      if (status.aeb) active.push("ĐANG PHANH KHẨN CẤP");
      if (status.blindSpotLeft) active.push("ĐIỂM MÙ TRÁI");
      if (status.blindSpotRight) active.push("ĐIỂM MÙ PHẢI");
      if (status.alc === "active") active.push("ĐANG HỖ TRỢ CHUYỂN LÀN");
      if (status.alc === "blocked") active.push("KHÔNG THỂ CHUYỂN LÀN");
      message.textContent = active.length ? active.join(" · ") : "ADAS đang hỗ trợ · đường thông thoáng";
    }
    message.classList.toggle("alert", status.aeb);
    message.classList.toggle(
      "warn",
      !status.aeb &&
        (status.fcw ||
          status.blindSpotLeft ||
          status.blindSpotRight ||
          status.laneDeparture !== "none" ||
          status.alc === "blocked"),
    );
    this.updateSessionStatus();
  }

  private wireDriveModes(): void {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-drive-mode]"));
    for (const button of buttons) {
      button.addEventListener("click", () => {
        this.sim.setControlMode(button.dataset.driveMode as ControlMode);
        this.update();
      });
    }
  }

  private wireTrafficProfile(): void {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("#c-profile .seg-btn"));
    for (const button of buttons) {
      button.addEventListener("click", () => {
        const profile = button.dataset.profile as TrafficProfile;
        this.sim.setTrafficProfile(profile);
        for (const option of buttons) {
          const active = option === button;
          option.classList.toggle("active", active);
          option.setAttribute("aria-pressed", String(active));
        }
        const slider = document.getElementById("c-traffic") as HTMLInputElement;
        const value = document.getElementById("c-traffic-val")!;
        slider.value = this.sim.traffic.count.toString();
        value.textContent = `${slider.value} xe`;
      });
    }
  }

  private wireSessionControls(): void {
    document.getElementById("c-record")!.addEventListener("click", () => {
      this.sim.startRecording();
      this.updateSessionStatus();
    });
    document.getElementById("c-stop-session")!.addEventListener("click", () => {
      this.sim.stopRecording();
      this.sim.stopReplay();
      this.updateSessionStatus();
    });
    document.getElementById("c-replay")!.addEventListener("click", () => {
      this.sim.startReplay();
      this.updateSessionStatus();
    });
    document.getElementById("c-export-session")!.addEventListener("click", () => {
      if (this.sim.recorder.frames.length === 0) return;
      const blob = new Blob([this.sim.exportRecordedSession()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `blueline-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }

  private updateSessionStatus(): void {
    const recorder = this.sim.recorder;
    const status = document.getElementById("c-session-status");
    const record = document.getElementById("c-record") as HTMLButtonElement | null;
    const stop = document.getElementById("c-stop-session") as HTMLButtonElement | null;
    const replay = document.getElementById("c-replay") as HTMLButtonElement | null;
    const exportButton = document.getElementById("c-export-session") as HTMLButtonElement | null;
    if (!status || !record || !stop || !replay || !exportButton) return;

    const hasFrames = recorder.frames.length > 0;
    const time = recorder.recording ? recorder.elapsed : recorder.playhead || recorder.elapsed;
    const stamp = `${Math.floor(time / 60).toString().padStart(2, "0")}:${Math.floor(time % 60).toString().padStart(2, "0")}`;
    status.textContent = recorder.recording
      ? `● Đang ghi ${stamp} · ${recorder.frames.length} khung hình`
      : recorder.playing
        ? `▶ Đang phát lại ${stamp} · ${recorder.frames.length} khung hình`
        : hasFrames
          ? `Sẵn sàng · ${recorder.frames.length} khung hình · ${stamp}`
          : "Chưa có phiên lái.";
    status.classList.toggle("recording", recorder.recording);
    status.classList.toggle("replaying", recorder.playing);
    record.textContent = recorder.recording ? "● Đang ghi" : "● Ghi";
    record.classList.toggle("active", recorder.recording);
    stop.disabled = !recorder.recording && !recorder.playing;
    replay.disabled = !hasFrames || recorder.playing;
    exportButton.disabled = !hasFrames;
  }

  private wireAudio(): void {
    const button = document.getElementById("c-audio") as HTMLButtonElement;
    const volSlider = document.getElementById("c-audio-vol") as HTMLInputElement;
    const volVal = document.getElementById("c-audio-val") as HTMLElement;

    button.addEventListener("click", async () => {
      const wasEnabled = this.audio.enabled;
      button.disabled = true;
      try {
        const enabled = await this.audio.setEnabled(!wasEnabled);
        button.textContent = enabled ? "Đang bật âm thanh" : wasEnabled ? "Bật âm thanh" : "Không thể phát âm thanh";
        button.classList.toggle("active", enabled);
        button.setAttribute("aria-pressed", String(enabled));
        if (enabled && volSlider) {
          this.audio.setVolume(Number(volSlider.value) / 100);
        }
      } catch {
        button.textContent = "Không thể phát âm thanh";
      } finally {
        button.disabled = false;
      }
    });

    if (volSlider && volVal) {
      volSlider.addEventListener("input", () => {
        const val = Number(volSlider.value);
        volVal.textContent = `${val}%`;
        this.audio.setVolume(val / 100);
      });
    }
  }

  private wireScenarioLab(): void {
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-event]"))) {
      button.addEventListener("click", () => {
        const event = button.dataset.event as ScenarioEventName;
        this.sim.addScenarioEvent(event);
        const label: Record<ScenarioEventName, string> = {
          "stopped-lead": "Đã thêm xe dừng phía trước (đủ khoảng cách an toàn từ xa).",
          "motorcycle-cutin": "Đã thêm xe máy phía trước sẽ tạt đầu khi xe đến gần.",
          "vehicle-crossing": "Đã thêm phương tiện cắt ngang khi xe tiếp cận.",
          "pedestrian-crossing": "Đã thêm người đi bộ qua đường khi xe đến gần.",
          "motorcycle-weave": "Đã thêm xe máy luồn lách phía trước.",
          "bus-stop": "Đã thêm xe buýt dừng đỗ và hành khách sang đường phía trước.",
          "rear-crossing-left": "Đã thêm xe máy cắt ngang phía sau từ trái; chọn R để thử RCTA.",
          "rear-crossing-right": "Đã thêm xe máy cắt ngang phía sau từ phải; chọn R để thử RCTA.",
        };
        document.getElementById("c-event-status")!.textContent = label[event];
      });
    }
  }

  private wireTimeOfDay(): void {
    const btns = Array.from(document.querySelectorAll<HTMLButtonElement>("#c-tod .seg-btn"));
    for (const b of btns) {
      b.addEventListener("click", () => {
        btns.forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        this.scene.setTimeOfDay(b.dataset.t as "day" | "night");
      });
    }
  }

  private wireWeather(): void {
    const btns = Array.from(document.querySelectorAll<HTMLButtonElement>("#c-weather .seg-btn"));
    for (const b of btns) {
      b.addEventListener("click", () => {
        btns.forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        const w = b.dataset.w as "clear" | "rain" | "fog";
        this.sim.setWeather(w);
        this.scene.setWeather(w);
      });
    }
  }

  private wireScenarios(): void {
    const btns = Array.from(document.querySelectorAll<HTMLButtonElement>(".scn"));
    for (const b of btns) {
      b.addEventListener("click", () => {
        btns.forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        this.sim.setScenario(b.dataset.scn as ScenarioName);
        // Keep the traffic slider in sync with the scenario's car count.
        const slider = document.getElementById("c-traffic") as HTMLInputElement;
        const val = document.getElementById("c-traffic-val")!;
        slider.value = this.sim.traffic.count.toString();
        val.textContent = `${slider.value} xe`;
      });
    }
  }

  private wireSpeed(): void {
    const slider = document.getElementById("c-speed") as HTMLInputElement;
    const val = document.getElementById("c-speed-val")!;
    slider.value = Math.round(mps2kph(this.sim.config.egoDesiredSpeed)).toString();
    val.textContent = `${slider.value} km/h`;
    slider.addEventListener("input", () => {
      val.textContent = `${slider.value} km/h`;
      this.sim.setDesiredSpeed(kph2mps(parseFloat(slider.value)));
    });
  }

  private wireTraffic(): void {
    const slider = document.getElementById("c-traffic") as HTMLInputElement;
    const val = document.getElementById("c-traffic-val")!;
    slider.value = this.sim.traffic.count.toString();
    val.textContent = `${slider.value} xe`;
    slider.addEventListener("input", () => {
      val.textContent = `${slider.value} xe`;
    });
    slider.addEventListener("change", () => {
      this.sim.setTrafficCount(parseInt(slider.value, 10));
    });
  }

  private toggle(id: string, initial: boolean, onChange: (on: boolean) => void): void {
    const el = document.getElementById(id)!;
    el.classList.toggle("on", initial);
    onChange(initial);
    el.addEventListener("click", () => onChange(el.classList.toggle("on")));
  }

  private wireToggles(): void {
    this.toggle("c-build", true, (on) => (this.overlays.buildings.visible = on));
    this.toggle("c-percept", true, (on) => (this.sim.usePerception = on));
    this.toggle("c-sensor", false, (on) => (this.overlays.sensor.visible = on));
    this.toggle("c-tracks", false, (on) => (this.overlays.tracks.visible = on));
    this.toggle("c-occ", false, (on) => (this.overlays.occupancy.visible = on));
    this.toggle("c-guide", true, (on) => (this.overlays.navigation.visible = on));
    this.toggle("c-cand", false, (on) => {
      this.candidates.setVisible(on);
      this.sim.showCandidates = on;
    });
  }

  private wirePlayReset(): void {
    const pause = document.getElementById("c-pause") as HTMLButtonElement;
    const reset = document.getElementById("c-reset") as HTMLButtonElement;
    pause.addEventListener("click", () => {
      this.sim.paused = !this.sim.paused;
      pause.textContent = this.sim.paused ? "Chạy tiếp" : "Tạm dừng";
      pause.classList.toggle("active", this.sim.paused);
    });
    reset.addEventListener("click", () => this.sim.reset());
  }

  private wirePanelVisibility(): void {
    const panel = document.getElementById("control-panel");
    const hide = document.getElementById("c-panel-hide");
    const show = document.getElementById("c-panel-show");
    if (!panel || !hide || !show) return;

    hide.addEventListener("click", () => {
      panel.hidden = true;
      show.hidden = false;
    });
    show.addEventListener("click", () => {
      panel.hidden = false;
      show.hidden = true;
    });
  }

  private wireCamera(): void {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-camera]"));
    const set = (mode: CameraMode) => {
      this.scene.cameraMode = mode;
      for (const button of buttons) button.classList.toggle("active", button.dataset.camera === mode);
      document.getElementById("c-camera-help")?.classList.toggle("visible", mode === "orbit");
    };
    for (const button of buttons) {
      button.addEventListener("click", () => set(button.dataset.camera as CameraMode));
    }
  }
}
