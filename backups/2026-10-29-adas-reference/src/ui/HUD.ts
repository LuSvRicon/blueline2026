// HUD — the always-on overlay: brand mark, the big Tesla-style speed cluster
// (speed arc, gear, posted limit, turn signals), the "ĐANG TỰ LÁI" pill, and a
// live telemetry panel exposing what the autonomy stack is doing. It also owns
// the collision impact flash.

import { Telemetry } from "../sim/Simulation.ts";
import { clamp, mps2kph } from "../core/math.ts";

const ARC_LENGTH = 330; // 270° of a r=70 circle
const SPEEDO_MAX_KPH = 140;

export class HUD {
  private root: HTMLElement;
  private speedNum: HTMLElement;
  private speedRing: SVGCircleElement;
  private gear: HTMLElement;
  private limit: HTMLElement;
  private turnLeft: HTMLElement;
  private turnRight: HTMLElement;
  private pill: HTMLElement;
  private pillText: HTMLElement;
  private impact: HTMLElement;
  private aebWarning: HTMLElement;
  private aebWarningText: HTMLElement;
  private rows: Record<string, HTMLElement> = {};
  private rpmBars: HTMLElement[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    const gaugeTicks = Array.from({ length: 29 }, (_, i) => {
      const angle = i / 28 * Math.PI * 1.5;
      const inner = i % 4 === 0 ? 57 : 60;
      return `<line x1="${80 + Math.cos(angle) * inner}" y1="${80 + Math.sin(angle) * inner}" x2="${80 + Math.cos(angle) * 64}" y2="${80 + Math.sin(angle) * 64}" class="${i % 4 === 0 ? "major" : ""}"/>`;
    }).join("");
    root.insertAdjacentHTML(
      "beforeend",
      `
      <div class="brand">
        <div class="brand-dot"></div>
        <div>
          <div class="brand-name">BLUELINE</div>
          <div class="brand-sub">MÔ PHỎNG LÁI XE TỰ ĐỘNG</div>
        </div>
      </div>

      <div class="speedo" aria-label="Cụm đồng hồ vận hành">
        <div class="dashboard-cluster-label">VẬN HÀNH</div>
        <div class="turn-led left" id="hud-turn-l">◀</div>
        <div class="speed-ring">
          <svg viewBox="0 0 160 160" aria-hidden="true">
            <circle class="ring-track" cx="80" cy="80" r="70" />
            <g class="dashboard-gauge-ticks">${gaugeTicks}</g>
            <circle class="ring-value" id="hud-ring" cx="80" cy="80" r="70"
              stroke-dasharray="${ARC_LENGTH} 440" stroke-dashoffset="${ARC_LENGTH}" />
          </svg>
          <div class="speed-core">
            <div class="speed-num" id="hud-speed">0</div>
            <div class="speed-unit">KM/H</div>
            <div class="cluster-rpm"><span class="dashboard-rpm-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><b id="hud-rpm">800</b><span>VÒNG/PHÚT</span></div>
          </div>
        </div>
        <div class="turn-led right" id="hud-turn-r">▶</div>
        <div class="speed-tags">
          <span class="dashboard-gear-label">SỐ</span><span class="gear" id="hud-gear">D</span>
          <span class="limit hidden" id="hud-limit">50</span>
        </div>
        <div class="autopill" id="hud-pill">
          <span class="pulse"></span><span id="hud-pill-text">ĐANG TỰ LÁI</span>
        </div>
        <div class="cluster-telltales"><span id="hud-epb" hidden>(P) PHANH ĐỖ</span><span id="hud-grip" hidden>GIẢM ĐỘ BÁM</span><span id="hud-engine-off" hidden>ĐỘNG CƠ TẮT</span></div>
      </div>

      <div class="hud-aeb-warning" id="hud-aeb-warning" role="alert">
        <span class="hud-brake-symbol">▣</span><span id="hud-aeb-warning-text">AEB ĐANG PHANH TỰ ĐỘNG</span>
      </div>

      <div class="telemetry panel">
        <h4>THÔNG SỐ VẬN HÀNH</h4>
        <div class="trow"><span class="k">Chế độ lái</span><span class="v blue" id="t-driver">–</span></div>
        <div class="trow"><span class="k">Trạng thái</span><span class="v blue" id="t-behav">–</span></div>
        <div class="trow"><span class="k">Hỗ trợ ADAS</span><span class="v" id="t-adas">TẮT</span></div>
        <div class="trow"><span class="k">Tốc độ mục tiêu</span><span class="v blue" id="t-target">–</span></div>
        <div class="trow"><span class="k">Làn đường</span><span class="v" id="t-lane">–</span></div>
        <div class="trow"><span class="k">Khoảng cách an toàn</span><span class="v" id="t-headway">–</span></div>
        <div class="trow"><span class="k">Vật thể được nhận biết</span><span class="v" id="t-tracks">–</span></div>
        <div class="trow"><span class="k">Người đi bộ</span><span class="v" id="t-peds">–</span></div>
        <div class="trow"><span class="k">Tầm cảm biến</span><span class="v" id="t-sensor">–</span></div>
        <div class="trow"><span class="k">Gia tốc</span><span class="v" id="t-accel">–</span></div>
        <div class="trow"><span class="k">Góc đánh lái</span><span class="v" id="t-steer">–</span></div>
        <div class="trow"><span class="k">Quỹ đạo xem xét</span><span class="v" id="t-cand">–</span></div>
        <div class="trow"><span class="k">Điểm quỹ đạo</span><span class="v" id="t-cost">–</span></div>
        <div class="trow"><span class="k">Thời gian lập kế hoạch</span><span class="v" id="t-ms">–</span></div>
        <div class="trow"><span class="k">Quãng đường</span><span class="v" id="t-dist">–</span></div>
      </div>

      <div class="impact-flash" id="hud-impact"></div>
      `,
    );

    this.speedNum = document.getElementById("hud-speed")!;
    this.speedRing = document.getElementById("hud-ring") as unknown as SVGCircleElement;
    this.gear = document.getElementById("hud-gear")!;
    this.limit = document.getElementById("hud-limit")!;
    this.turnLeft = document.getElementById("hud-turn-l")!;
    this.turnRight = document.getElementById("hud-turn-r")!;
    this.pill = document.getElementById("hud-pill")!;
    this.pillText = document.getElementById("hud-pill-text")!;
    this.impact = document.getElementById("hud-impact")!;
    this.aebWarning = document.getElementById("hud-aeb-warning")!;
    this.aebWarningText = document.getElementById("hud-aeb-warning-text")!;
    this.rpmBars = Array.from(root.querySelectorAll<HTMLElement>(".dashboard-rpm-bars i"));
    this.rows = {
      driver: document.getElementById("t-driver")!,
      behav: document.getElementById("t-behav")!,
      adas: document.getElementById("t-adas")!,
      tracks: document.getElementById("t-tracks")!,
      peds: document.getElementById("t-peds")!,
      sensor: document.getElementById("t-sensor")!,
      target: document.getElementById("t-target")!,
      lane: document.getElementById("t-lane")!,
      headway: document.getElementById("t-headway")!,
      accel: document.getElementById("t-accel")!,
      steer: document.getElementById("t-steer")!,
      cand: document.getElementById("t-cand")!,
      cost: document.getElementById("t-cost")!,
      ms: document.getElementById("t-ms")!,
      dist: document.getElementById("t-dist")!,
    };
  }

  setCameraMode(mode: "chase" | "top" | "cockpit" | "orbit"): void {
    this.root.classList.toggle("cockpit-mode", mode === "cockpit");
  }

  /** Red screen flash + shake cue when the simulation counts a collision. */
  flashImpact(): void {
    this.impact.classList.remove("on");
    // Force a reflow so the animation restarts on repeated impacts.
    void this.impact.offsetWidth;
    this.impact.classList.add("on");
  }

  update(t: Telemetry, laneCount: number): void {
    const kph = mps2kph(t.speed);
    this.speedNum.textContent = Math.round(kph).toString();
    const frac = clamp(kph / SPEEDO_MAX_KPH, 0, 1);
    this.speedRing.style.strokeDashoffset = (ARC_LENGTH * (1 - frac)).toFixed(1);
    this.speedRing.style.stroke = t.adas.aeb ? "#ff6a4d" : frac > 0.82 ? "#ffc861" : "var(--bl-blue)";

    this.gear.textContent = t.gear;
    document.getElementById("hud-rpm")!.textContent = String(Math.round(t.rpm ?? 0));
    this.rpmBars.forEach((bar, i) => bar.classList.toggle("lit", (t.rpm ?? 0) >= 700 + i * 1000));
    document.getElementById("hud-epb")!.hidden = !t.epbEngaged;
    document.getElementById("hud-grip")!.hidden = !t.tractionLimited;
    document.getElementById("hud-engine-off")!.hidden = t.engineOn;
    this.gear.classList.toggle("gear-alert", t.rearAeb || t.adas.aeb);
    const aebActive = t.adas.aeb || t.rearAeb || t.adas.extra.pedalMitigation;
    this.aebWarning.classList.toggle("active", aebActive);
    this.aebWarningText.textContent = `${t.rearAeb ? "PHANH TỰ ĐỘNG KHI LÙI" : t.adas.extra.pedalMitigation ? "PMC · NGẮT GA VÀ PHANH" : "AEB ĐANG PHANH TỰ ĐỘNG"} · ${Math.round(t.adasBrakeForce * 100)}%`;
    if (t.speedLimitKph !== null) {
      this.limit.textContent = Math.round(t.speedLimitKph).toString();
      this.limit.classList.remove("hidden");
    } else {
      this.limit.classList.add("hidden");
    }
    this.turnLeft.classList.toggle("on", t.indicator < 0);
    this.turnRight.classList.toggle("on", t.indicator > 0);

    const label: Record<string, string> = {
      CRUISE: "ĐANG TỰ LÁI",
      FOLLOW: "GIỮ KHOẢNG CÁCH",
      OVERTAKE: "ĐANG VƯỢT XE",
      EMERGENCY: "PHANH KHẨN CẤP",
      YIELD: "NHƯỜNG NGƯỜI ĐI BỘ",
      STOP: "DỪNG ĐÈN ĐỎ",
    };
    const emergency = t.behaviorState === "EMERGENCY" || t.behaviorState === "STOP";
    const yielding = t.behaviorState === "YIELD";
    const manual = t.controlMode === "manual";
    const assisted = t.controlMode === "adas";
    const adasWarning = t.adas.fcw || t.adas.blindSpotLeft || t.adas.blindSpotRight ||
      t.adas.laneDeparture !== "none" || t.rctaActive || t.adas.extra.driverWarning !== "none";
    this.pill.classList.toggle("alert", emergency || t.rearAeb || (assisted && t.adas.aeb));
    this.pill.classList.toggle("warn", yielding || (assisted && !t.adas.aeb && adasWarning));
    this.pillText.textContent = manual
      ? "ĐIỀU KHIỂN TAY"
      : assisted
        ? t.rearAeb
          ? "PHANH TỰ ĐỘNG KHI LÙI"
          : t.adas.aeb
          ? "ĐANG PHANH KHẨN CẤP"
          : t.adas.takeoverRequired ? t.adas.laneSupportLimited ? "GIẢM TỐC · VƯỢT TỐC ĐỘ QUA CUA" : "HÃY TIẾP QUẢN ĐIỀU KHIỂN"
          : t.adas.extra.pedalMitigation ? "PMC · NGẮT GA VÀ PHANH"
          : t.adas.aebHolding ? "AEB · ĐANG GIỮ DỪNG"
          : t.adas.accState === "cancelled" ? "ACC ĐÃ HỦY · ĐIỀU KHIỂN CHÂN GA"
          : t.adas.trafficLightStopping ? t.adas.trafficLight === "yellow" ? "ĐÈN VÀNG · DỪNG TRƯỚC VẠCH" : "ĐÈN ĐỎ · DỪNG TRƯỚC VẠCH"
          : t.adas.curveSpeedLimited ? "ACC · ĐIỀU CHỈNH TỐC ĐỘ QUA CUA"
          : t.parkingAssist.state === "running" ? t.parkingAssist.message
          : t.adas.extra.driverWarning !== "none" ? "CHÚ Ý LÁI XE · TAY TRÊN VÔ-LĂNG"
          : t.adas.extra.leadDeparture ? "XE PHÍA TRƯỚC ĐÃ ĐI"
          : t.adas.fcw
            ? "CẢNH BÁO VA CHẠM PHÍA TRƯỚC"
            : t.adas.alc === "active"
              ? "HỖ TRỢ CHUYỂN LÀN"
              : "ADAS ĐANG HỖ TRỢ"
        : label[t.behaviorState] ?? "ĐANG TỰ LÁI";

    const driver: Record<string, string> = {
      classical: "AI TỰ ĐỘNG",
      learned: "MẠNG NƠ-RON 🧠",
      external: "AI TIẾN HÓA 🧬",
      manual: "LÁI TAY",
      adas: "HỖ TRỢ ADAS",
    };
    this.rows.driver.textContent = driver[t.controlMode] ?? t.controlMode;
    this.rows.behav.textContent = manual
      ? "ĐIỀU KHIỂN THỦ CÔNG"
      : assisted
        ? "ĐANG ĐƯỢC HỖ TRỢ"
        : label[t.behaviorState] ?? t.behaviorState;
    this.rows.behav.classList.toggle("blue", !emergency && !yielding && !(assisted && t.adas.aeb));
    this.rows.adas.textContent = !assisted
      ? "TẮT"
      : [
          t.adas.accActive ? "ACC" : "",
          t.adas.laneCenteringActive ? "GIỮ LÀN" : "",
          t.adas.laneDeparture !== "none" ? "LỆCH LÀN" : "",
          t.adas.fcw ? "FCW" : "",
          t.adas.aeb ? "AEB" : "",
          t.adas.blindSpotLeft ? "BSM TRÁI" : "",
          t.adas.blindSpotRight ? "BSM PHẢI" : "",
          t.adas.alc === "active" ? "CHUYỂN LÀN" : "",
        ]
          .filter(Boolean)
          .join(" · ") || "ĐANG BẬT";
    this.rows.tracks.textContent = `${t.trackedCount}${t.usePerception ? "" : " (dữ liệu mô phỏng)"}`;
    this.rows.peds.textContent = `${t.pedCount}`;
    this.rows.sensor.textContent = `${Math.round(t.sensorRange)} m`;
    this.rows.target.textContent = `${Math.round(mps2kph(t.targetSpeed))} km/h`;
    this.rows.lane.textContent = `${t.lane + 1} / ${laneCount}`;
    this.rows.headway.textContent = t.headway !== null ? `${t.headway.toFixed(1)} s` : "—";
    this.rows.accel.textContent = `${t.accel >= 0 ? "+" : ""}${t.accel.toFixed(1)} m/s²`;
    this.rows.steer.textContent = `${((t.steer * 180) / Math.PI).toFixed(1)}°`;
    this.rows.cand.textContent = `${t.candidateCount}`;
    this.rows.cost.textContent = t.planCost >= 1e5 ? "⚠ cao" : t.planCost.toFixed(1);
    this.rows.ms.textContent = `${t.planMs.toFixed(1)} ms`;
    this.rows.dist.textContent = `${(t.distanceTravelled / 1000).toFixed(2)} km`;
  }
}
