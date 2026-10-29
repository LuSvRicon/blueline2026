// ADASPanel — the assisted-driving cluster. It mirrors what a modern car shows
// while the assistance systems are engaged:
//
//   • a live "surround" view (lane geometry + perceived traffic) drawn on a 2-D
//     canvas from the Kalman tracks, the same objects the assistance logic sees
//   • an icon strip for every system (ACC / LKA / LDW / FCW / AEB / BSM / ALC / TSR)
//   • headway, TTC, set speed and the recognised limit
//   • headway and turn-signal controls
//   • a short intervention log ("AEB can thiệp · 01:12")
//
// It only appears in ADAS mode, replacing the engineering telemetry panel.

import { Simulation } from "../sim/Simulation.ts";
import { ADAS_GAP_NOTCHES } from "../sim/ADAS.ts";
import { wrapDiff } from "../core/math.ts";

const W = 252;
const H = 176;
const RANGE = 64; // metres shown ahead
const LAT_SPAN = 17; // metres across the panel
type ADASOption = keyof Pick<
  Simulation["adas"]["config"],
  "acc" | "laneCentering" | "lda" | "fcw" | "aeb" | "bsm" | "alc" | "tsr" | "isa" | "parking" |
  "rcta" | "rearAeb" | "blindSpotAvoidance" | "emergencyLaneKeeping" | "pedalMitigation" | "leadDeparture" | "safeExit" | "driverMonitoring" | "highBeamAssist" | "trafficLightAssist"
>;

const ADAS_OPTIONS: { code: string; label: string; option: ADASOption }[] = [
  { code: "ACC", label: "Ga thích ứng", option: "acc" },
  { code: "LKA", label: "Giữ làn", option: "laneCentering" },
  { code: "LDW", label: "Lệch làn", option: "lda" },
  { code: "FCW", label: "Cảnh báo trước", option: "fcw" },
  { code: "AEB", label: "Phanh tự động", option: "aeb" },
  { code: "BSM", label: "Điểm mù", option: "bsm" },
  { code: "ALC", label: "Chuyển làn", option: "alc" },
  { code: "TSR", label: "Biển báo", option: "tsr" },
  { code: "ISA", label: "Giới hạn tốc độ", option: "isa" },
  { code: "USS", label: "Cảm biến quanh xe", option: "parking" },
  { code: "RCTA", label: "Cắt ngang khi lùi", option: "rcta" },
  { code: "Rear AEB", label: "Phanh phía sau", option: "rearAeb" },
  { code: "BCA", label: "Tránh va chạm điểm mù", option: "blindSpotAvoidance" },
  { code: "ELK", label: "Giữ làn khẩn cấp", option: "emergencyLaneKeeping" },
  { code: "PMC", label: "Kiểm soát nhầm ga", option: "pedalMitigation" },
  { code: "FDA", label: "Nhắc xe trước đi", option: "leadDeparture" },
  { code: "SEA", label: "Mở cửa an toàn", option: "safeExit" },
  { code: "DAW", label: "Tài xế · đầu vào giả lập", option: "driverMonitoring" },
  { code: "HBA", label: "Tự chuyển pha/cốt", option: "highBeamAssist" },
  { code: "TLA", label: "Dừng đèn khi dùng ACC", option: "trafficLightAssist" },
];

export class ADASPanel {
  private ctx: CanvasRenderingContext2D;
  private el: Record<string, HTMLElement> = {};
  private canvas: HTMLCanvasElement;
  private panel: HTMLElement;
  private logs: { stamp: string; text: string; tone: "ok" | "warn" | "danger" }[] = [];
  private prev = {
    aeb: false,
    fcw: 0,
    laneDeparture: "none",
    blindSpot: false,
    rcta: false,
    alc: "off",
    parking: 0,
  };
  private clock = 0;
  private previousExtraAlert = "";

  constructor(root: HTMLElement, private sim: Simulation) {
    const systemControls = ADAS_OPTIONS.map(({ code, label, option }) => {
      const enabled = sim.adas.config[option];
      return `<button type="button" role="switch" class="adas-system-toggle${enabled ? " on" : ""}" data-adas-toggle="${option}" aria-checked="${enabled}" aria-labelledby="adas-toggle-label-${option}" aria-label="${code} · ${label}" title="${code} · ${label}">
        <span class="adas-system-copy" id="adas-toggle-label-${option}"><b>${code}</b><small>${label}</small></span>
        <span class="adas-switch" aria-hidden="true"><i></i></span>
      </button>`;
    }).join("");
    root.insertAdjacentHTML(
      "beforeend",
      `
      <div class="adas-panel panel" id="adas-panel">
        <div class="adas-head">
          <div class="adas-heading-copy"><span class="adas-heading-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m6 3-3 18M18 3l3 18M12 3v4m0 3v4m0 3v4"/><path d="M8 13h8v6H8z"/></svg></span><span class="adas-title">HỖ TRỢ LÁI <b>ADAS</b></span></div>
          <div class="adas-head-actions"><span class="adas-badge" id="adas-badge">CHỜ</span></div>
        </div>
        <div class="adas-radar-block"><div class="adas-radar-label"><i></i><span>QUAN SÁT</span></div>
          <canvas id="adas-view" width="${W}" height="${H}" aria-label="Làn đường và phương tiện được cảm biến nhận biết"></canvas>
          <span class="adas-radar-range">PHẠM VI 64 m</span>
        </div>
        <div class="adas-command-zone">
          <div class="adas-metrics">
            <div class="adas-metric adas-distance-metric"><span>XE PHÍA TRƯỚC</span><b id="adas-gap">—</b></div>
            <div class="adas-metric adas-headway-metric"><span>KHOẢNG CÁCH ĐẶT</span><b id="adas-headway">—</b></div>
          </div>
        <div class="adas-controls">
          <div class="adas-speed-control" role="group" aria-label="Tốc độ ACC"><span class="adas-control-caption">TỐC ĐỘ ACC</span>
            <button class="adas-mini" data-acc-speed="-5" aria-label="Giảm tốc độ ACC 5 km/h">−</button>
            <label><input type="number" id="adas-speed-input" aria-label="Tốc độ ACC (km/h)" min="10" max="140" step="5" value="${Math.round(sim.accSetSpeedKph)}"><small>km/h</small></label>
            <button class="adas-mini" data-acc-speed="5" aria-label="Tăng tốc độ ACC 5 km/h">+</button>
          </div>
          <div class="adas-cruise-controls" role="group" aria-label="Điều khiển ACC"><span class="adas-control-caption">ĐIỀU KHIỂN</span><button class="adas-mini" id="adas-acc-set" title="Lấy tốc độ hiện tại và bật ACC">SET</button><button class="adas-mini" id="adas-acc-resume" title="Phục hồi ACC sau khi đã nhả phanh">RES</button><button class="adas-mini" id="adas-acc-cancel">HỦY</button></div>
          <div class="adas-gapctl" title="Khoảng cách giữ xe"><span class="adas-gap-caption">GIỮ CÁCH</span>
            <button class="adas-mini" data-adas-gap="-1">−</button>
            <select class="adas-gap-choice" id="adas-notch" aria-label="Khoảng cách ACC">${ADAS_GAP_NOTCHES.map((gap, i) => `<option value="${gap}">${["Gần", "Vừa", "Chuẩn", "Xa", "Rất xa", "Xa nhất"][i]} · ${gap.toFixed(1)} s</option>`).join("")}</select>
            <button class="adas-mini" data-adas-gap="1">+</button>
          </div>
          <div class="adas-indctl" title="Xi nhan / chuyển làn hỗ trợ">
            <button class="adas-mini" data-adas-ind="-1">◀</button>
            <button class="adas-mini" data-adas-ind="1">▶</button>
          </div>
        </div>
        </div>
        <details class="adas-config">
          <summary aria-label="Mở cài đặt hệ thống ADAS" title="Bật/tắt từng hệ thống ADAS"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 4.4 10 2h4l1 2.4 2.4 1 .9-.3 2.8 2.8-.9 2.2.2 2.8 1.6 1.8-2 3.5-2.5-.1-2.2 1.4-.9 2.5h-4l-.9-2.5-2.2-1.4-2.5.1-2-3.5 1.6-1.8.2-2.8-.9-2.2 2.8-2.8.9.3Z"/><circle cx="12" cy="12" r="3.2"/></svg><span>CÀI ĐẶT HỖ TRỢ</span></summary>
          <div class="adas-config-menu">
            <div class="adas-config-heading"><b>BẬT / TẮT HỆ THỐNG</b><span>Thay đổi áp dụng ngay trong phiên mô phỏng</span></div>
            <div class="adas-lab-tabs" role="tablist" aria-label="Trang hỗ trợ lái">
              <button type="button" role="tab" id="adas-tab-systems" aria-label="Hệ thống hỗ trợ lái" title="Hệ thống hỗ trợ lái" aria-controls="adas-page-systems" aria-selected="true" tabindex="0" data-adas-page="systems">Hệ thống</button>
              <button type="button" role="tab" id="adas-tab-parking" aria-label="Đỗ xe APA và RPA" title="Đỗ xe APA và RPA" aria-controls="adas-page-parking" aria-selected="false" tabindex="-1" data-adas-page="parking">Đỗ xe</button>
              <button type="button" role="tab" id="adas-tab-testing" aria-label="Thử nghiệm cảm biến và tài xế" title="Thử nghiệm cảm biến và tài xế" aria-controls="adas-page-testing" aria-selected="false" tabindex="-1" data-adas-page="testing">Thử nghiệm</button>
            </div>
            <div class="adas-lab-page" role="tabpanel" id="adas-page-systems" aria-labelledby="adas-tab-systems" data-adas-content="systems">
              <div class="adas-detailed-state"><span>TRẠNG THÁI NHẬN BIẾT</span><div class="adas-chips adas-detail-chips"><span class="adas-chip" data-chip="ldw">LỆCH LÀN</span><span class="adas-chip" data-chip="fcw">VA CHẠM TRƯỚC</span><span class="adas-chip" data-chip="alc">CHUYỂN LÀN</span><span class="adas-chip" data-chip="tsr">BIỂN BÁO</span></div></div>
              <div class="adas-system-grid">${systemControls}</div>
              <p class="adas-lab-note">Mô hình ADAS để học và thử tình huống. TSR đọc dữ liệu biển; DAW dùng trạng thái tài xế giả lập. Đạp ga hết hành trình để tạm vượt ISA; AEB vẫn có ưu tiên.</p>
            </div>
            <div class="adas-lab-page" role="tabpanel" id="adas-page-parking" aria-labelledby="adas-tab-parking" data-adas-content="parking" hidden>
              <p class="adas-lab-note">APA: ô song song đã kẻ trên đoạn thẳng. RPA: điều khiển từ xa giả lập, tiến/lùi thẳng tối đa 6 m. Luôn giữ nút; nhả hoặc mất tín hiệu sẽ phanh.</p>
              <button class="adas-lab-button" id="adas-parking-lab">Mở bãi tập đỗ · bắt đầu phiên mới</button>
              <button class="adas-lab-button" id="adas-find-bay">Quét ô đỗ phù hợp · APA</button>
              <div class="adas-lab-row"><button class="adas-lab-button" data-remote="remote-forward">Chuẩn bị RPA tiến</button><button class="adas-lab-button" data-remote="remote-reverse">Chuẩn bị RPA lùi</button></div>
              <button class="adas-lab-button hold-to-park" id="adas-park-hold" title="Giữ chuột/chạm hoặc giữ Enter khi nút được chọn">GIỮ ĐỂ CHẠY APA / RPA</button>
              <button class="adas-lab-button" id="adas-park-cancel">Hủy đỗ xe · phanh dừng</button>
              <p id="adas-parking-status" class="adas-lab-readout" role="status">Chưa tìm ô đỗ</p>
              <div class="adas-lab-row"><button class="adas-lab-button" data-door="left">Cửa trái</button><button class="adas-lab-button" data-door="right">Cửa phải</button></div>
              <p class="adas-lab-note">SEA chặn yêu cầu mở cửa khi có xe áp sát. Đóng cửa trước khi vào D/R. Mô hình cửa mở hiện biểu diễn bằng trạng thái.</p>
            </div>
            <div class="adas-lab-page" role="tabpanel" id="adas-page-testing" aria-labelledby="adas-tab-testing" data-adas-content="testing" hidden>
              <p class="adas-lab-note">Đây là đầu vào lỗi/tài xế của phòng thí nghiệm, không phải kết quả nhận diện từ webcam.</p>
              <label class="adas-lab-check"><input type="checkbox" id="adas-sensor-fault" aria-label="Mô phỏng mất cảm biến"> Mô phỏng mất cảm biến</label>
              <label class="adas-lab-check"><input type="checkbox" id="adas-lane-lost" aria-label="Mô phỏng mất vạch làn"> Mô phỏng mất vạch làn</label>
              <label class="adas-lab-check"><input type="checkbox" id="adas-driver-distracted" aria-label="Tài xế mất tập trung"> Tài xế mất tập trung</label>
              <label class="adas-lab-check"><input type="checkbox" id="adas-driver-hands-off" aria-label="Tài xế bỏ tay khỏi vô-lăng"> Tài xế bỏ tay khỏi vô-lăng</label>
              <label class="adas-lab-check"><input type="checkbox" id="adas-driver-fatigued" aria-label="Tài xế mệt mỏi"> Tài xế mệt mỏi</label>
              <div id="adas-sensor-readout" class="adas-lab-readout"></div>
            </div>
          </div>
        </details>
        <div class="adas-status-strip">
          <div class="adas-chips adas-primary-chips" aria-label="Trạng thái hỗ trợ lái"><span class="adas-chip" data-chip="acc">ACC</span><span class="adas-chip" data-chip="lka">GIỮ LÀN</span><span class="adas-chip" data-chip="aeb">AEB</span><span class="adas-chip" data-chip="bsm">ĐIỂM MÙ</span><span class="adas-chip" data-chip="rcta">RCTA</span></div>
          <div class="adas-set-readout"><span>ĐẶT</span><b id="adas-set">—</b></div>
          <div class="adas-limit-readout" title="Giới hạn tốc độ được nhận biết"><b id="adas-limit">—</b></div>
        </div>
        <div class="adas-log" id="adas-log">ADAS sẵn sàng · [ ] để chuyển làn</div>
      </div>
      `,
    );
    this.panel = document.getElementById("adas-panel")!;
    const config = this.panel.querySelector<HTMLDetailsElement>(".adas-config")!;
    config.addEventListener("toggle", () => this.panel.classList.toggle("config-open", config.open));
    this.canvas = document.getElementById("adas-view") as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d")!;
    for (const id of ["badge", "gap", "headway", "set", "limit", "log", "notch"]) {
      this.el[id] = document.getElementById(`adas-${id}`)!;
    }
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-adas-gap]"))) {
      button.addEventListener("click", () => {
        this.sim.adas.adjustGap(parseInt(button.dataset.adasGap!, 10) as -1 | 1);
        this.renderNotches();
      });
    }
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-adas-ind]"))) {
      button.addEventListener("click", () => {
        this.sim.toggleIndicator(parseInt(button.dataset.adasInd!, 10) as -1 | 1);
      });
    }
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-adas-toggle]"))) {
      button.addEventListener("click", () => {
        const option = button.dataset.adasToggle as ADASOption;
        this.sim.adas.config[option] = !this.sim.adas.config[option];
        this.syncADASControls();
      });
    }
    this.syncADASControls();
    this.renderNotches();
    this.bindLabControls();
    const speedInput = document.getElementById("adas-speed-input") as HTMLInputElement;
    speedInput.addEventListener("change", () => {
      if (speedInput.value.trim()) sim.setAccSpeedKph(Number(speedInput.value));
      speedInput.value = String(Math.round(sim.accSetSpeedKph));
    });
    speedInput.addEventListener("keydown", event => {
      if (event.code === "Enter") { event.preventDefault(); speedInput.dispatchEvent(new Event("change")); speedInput.blur(); }
      if (event.code === "Escape") { speedInput.value = String(Math.round(sim.accSetSpeedKph)); speedInput.blur(); }
    });
    for (const button of this.panel.querySelectorAll<HTMLButtonElement>("[data-acc-speed]")) button.addEventListener("click", () => {
      sim.setAccSpeedKph(sim.accSetSpeedKph + Number(button.dataset.accSpeed));
      speedInput.value = String(Math.round(sim.accSetSpeedKph));
    });
    this.el.notch.addEventListener("change", () => { sim.adas.config.timeGap = Number((this.el.notch as HTMLSelectElement).value); });
  }

  private bindLabControls(): void {
    const sim = this.sim;
    const on = (id: string, fn: () => void) => document.getElementById(id)!.addEventListener("click", fn);
    on("adas-acc-cancel", () => sim.adas.cancelCruise());
    const engage = (capture: boolean) => { if (!sim.engageAcc(capture)) this.log("ACC chưa bật · chọn D, nhả phanh chân/phanh tay và kiểm tra cảm biến", "warn"); };
    on("adas-acc-set", () => engage(true)); on("adas-acc-resume", () => engage(false));
    let held = false;
    const release = () => { held = false; sim.parkingAssist.hold(false); document.getElementById("adas-park-hold")!.classList.remove("held"); };
    const tabs = Array.from(this.panel.querySelectorAll<HTMLButtonElement>("[data-adas-page]"));
    const selectPage = (tab: HTMLButtonElement) => {
      release();
      for (const b of tabs) { b.setAttribute("aria-selected", String(b === tab)); b.tabIndex = b === tab ? 0 : -1; }
      for (const page of this.panel.querySelectorAll<HTMLElement>("[data-adas-content]")) page.hidden = page.dataset.adasContent !== tab.dataset.adasPage;
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectPage(tab));
      tab.addEventListener("keydown", event => {
        const next = event.code === "ArrowRight" ? (index + 1) % tabs.length : event.code === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.code === "Home" ? 0 : event.code === "End" ? tabs.length - 1 : event.code === "Space" || event.code === "Enter" ? index : -1;
        if (next < 0) return;
        event.preventDefault(); event.stopPropagation(); selectPage(tabs[next]); tabs[next].focus();
      });
    });
    on("adas-parking-lab", () => { release(); sim.prepareParkingLab(); });
    on("adas-find-bay", () => { release(); sim.requestParking("apa"); });
    for (const b of this.panel.querySelectorAll<HTMLButtonElement>("[data-remote]")) b.addEventListener("click", () => {
      release(); sim.requestParking(b.dataset.remote as "remote-forward" | "remote-reverse");
    });
    const button = document.getElementById("adas-park-hold")!;
    const press = () => {
      if (sim.paused || sim.recorder.playing || sim.controlMode !== "adas") return;
      held = true; sim.parkingAssist.hold(true); button.classList.add("held");
    };
    button.addEventListener("pointerdown", event => { event.preventDefault(); button.focus({ preventScroll: true }); button.setPointerCapture(event.pointerId); press(); });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(event, release);
    button.addEventListener("keydown", event => { if (event.code === "Enter") { event.preventDefault(); press(); } });
    button.addEventListener("keyup", event => { if (event.code === "Enter") release(); });
    button.addEventListener("blur", release); window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", () => { if (document.hidden) release(); });
    this.panel.querySelector(".adas-config")!.addEventListener("toggle", () => { if (!this.panel.querySelector<HTMLDetailsElement>(".adas-config")!.open) release(); });
    window.setInterval(() => { if (held && !sim.paused && !document.hidden && sim.controlMode === "adas") sim.parkingAssist.hold(true); else release(); }, 50);
    on("adas-park-cancel", () => { release(); sim.parkingAssist.cancel(); });
    for (const b of this.panel.querySelectorAll<HTMLButtonElement>("[data-door]")) b.addEventListener("click", () => {
      const side = b.dataset.door as "left" | "right";
      if (!sim.requestDoor(side)) this.log("Mở cửa bị chặn · cần số P, xe dừng và bên cửa an toàn", "warn");
    });
    const toggles: [string, (v: boolean) => void][] = [
      ["sensor-fault", v => { sim.sensorFault = v; }], ["lane-lost", v => { sim.laneMarkingConfidence = v ? 0 : 1; }],
      ["driver-distracted", v => { sim.driverAttentive = !v; }], ["driver-hands-off", v => { sim.driverHandsOn = !v; }],
      ["driver-fatigued", v => { sim.driverFatigued = v; }],
    ];
    for (const [id, apply] of toggles) document.getElementById(`adas-${id}`)!.addEventListener("change", event => apply((event.target as HTMLInputElement).checked));
  }

  private syncADASControls(): void {
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-adas-toggle]"))) {
      const option = button.dataset.adasToggle as ADASOption;
      const enabled = this.sim.adas.config[option];
      const definition = ADAS_OPTIONS.find((entry) => entry.option === option);
      button.classList.toggle("on", enabled);
      button.setAttribute("aria-checked", String(enabled));
      button.setAttribute(
        "aria-label",
        `${definition?.code ?? option} · ${definition?.label ?? "Hệ thống ADAS"} · ${enabled ? "đang bật" : "đang tắt"}`,
      );
      button.title = `${definition?.code ?? option} · ${definition?.label ?? "Hệ thống ADAS"} · ${enabled ? "đang bật" : "đang tắt"}`;
    }
  }

  private renderNotches(): void {
    const notch = this.sim.adas.gapNotch;
    (this.el.notch as HTMLSelectElement).value = String(ADAS_GAP_NOTCHES[notch]);
  }

  private log(text: string, tone: "ok" | "warn" | "danger"): void {
    const t = this.sim.metrics.time;
    const stamp = `${Math.floor(t / 60).toString().padStart(2, "0")}:${Math.floor(t % 60)
      .toString()
      .padStart(2, "0")}`;
    this.logs.unshift({ stamp, text, tone });
    this.logs = this.logs.slice(0, 3);
  }

  update(dt: number): void {
    this.clock += dt;
    const sim = this.sim;
    const root = document.getElementById("ui");
    root?.classList.toggle("adas-mode", sim.controlMode === "adas");
    root?.classList.toggle("manual-mode", sim.controlMode === "manual");
    this.syncADASControls();
    this.panel.classList.toggle("sensor-unavailable", sim.sensorFault);
    this.renderNotches();
    const speedInput = document.getElementById("adas-speed-input") as HTMLInputElement;
    if (document.activeElement !== speedInput) speedInput.value = String(Math.round(sim.accSetSpeedKph));
    const parkingStatus = document.getElementById("adas-parking-status")!;
    parkingStatus.textContent = sim.parkingAssist.status.message;
    const ranges = ["Front", "Rear", "Left", "Right"].map((side, i) => {
      const value = sim.adas.status[`parking${side}` as "parkingFront" | "parkingRear" | "parkingLeft" | "parkingRight"];
      return `${["Trước", "Sau", "Trái", "Phải"][i]}: ${value === null ? "—" : value.toFixed(1) + " m"}`;
    });
    document.getElementById("adas-sensor-readout")!.textContent = ranges.join(" · ");
    for (const b of this.panel.querySelectorAll<HTMLButtonElement>("[data-door]")) {
      const left = b.dataset.door === "left", open = left ? sim.doorLeftOpen : sim.doorRightOpen;
      const danger = left ? sim.adas.status.extra.safeExitLeft : sim.adas.status.extra.safeExitRight;
      b.textContent = `${open ? "Đóng" : "Mở"} cửa ${left ? "trái" : "phải"}${danger ? " · CÓ XE" : ""}`;
      b.classList.toggle("warn", danger);
    }
    const checkStates: Record<string, boolean> = { "sensor-fault": sim.sensorFault, "lane-lost": sim.laneMarkingConfidence < .6,
      "driver-distracted": !sim.driverAttentive, "driver-hands-off": !sim.driverHandsOn, "driver-fatigued": sim.driverFatigued };
    for (const [id, checked] of Object.entries(checkStates)) (document.getElementById(`adas-${id}`) as HTMLInputElement).checked = checked;
    if (sim.controlMode !== "adas") {
      this.el.badge.className = "adas-badge";
      this.el.badge.textContent = sim.controlMode === "manual" ? "LÁI THỦ CÔNG" : "CHỜ HỖ TRỢ";
      this.el.gap.textContent = "—";
      this.el.headway.textContent = "—";
      this.el.set.textContent = `${Math.round(sim.telemetry.targetSpeed * 3.6)} km/h`;
      this.el.limit.textContent = sim.telemetry.speedLimitKph === null ? "—" : String(sim.telemetry.speedLimitKph);
      for (const chip of Array.from(this.panel.querySelectorAll<HTMLElement>(".adas-chip"))) chip.classList.remove("on", "warn", "danger");
      return;
    }

    const status = sim.adas.status;
    const badge = this.el.badge;
    badge.className = "adas-badge";
    if (status.aeb) {
      badge.textContent = "PHANH KHẨN CẤP";
      badge.classList.add("danger");
    } else if (status.takeoverRequired) {
      badge.textContent = "HÃY TIẾP QUẢN"; badge.classList.add("danger");
    } else if (status.aebHolding) {
      badge.textContent = "AEB · ĐANG GIỮ DỪNG"; badge.classList.add("warn");
    } else if (sim.parkingAssist.controlling) {
      badge.textContent = sim.parkingAssist.status.state === "paused" ? "ĐỖ XE · ĐANG DỪNG" : "ĐANG ĐỖ XE"; badge.classList.add("active");
    } else if (status.extra.pedalMitigation) {
      badge.textContent = "PMC · NGẮT GA / PHANH"; badge.classList.add("danger");
    } else if (status.extra.driverWarning !== "none") {
      badge.textContent = status.extra.driverWarning === "hands" ? "ĐẶT TAY LÊN VÔ-LĂNG" : "CHÚ Ý LÁI XE"; badge.classList.add("warn");
    } else if (status.extra.leadDeparture) {
      badge.textContent = "XE TRƯỚC ĐÃ ĐI"; badge.classList.add("warn");
    } else if (status.rctaActive) {
      badge.textContent = "CÓ XE CẮT NGANG PHÍA SAU";
      badge.classList.add("warn");
    } else if (status.fcw || status.laneDeparture !== "none" || status.blindSpotLeft || status.blindSpotRight) {
      badge.textContent = "CẢNH BÁO";
      badge.classList.add("warn");
    } else if (status.alc === "active") {
      badge.textContent = "ĐANG CHUYỂN LÀN";
      badge.classList.add("active");
    } else if (status.accState === "resume-required") {
      badge.textContent = "ACC · NHẤN RES ĐỂ ĐI"; badge.classList.add("warn");
    } else if (status.accState === "cancelled") {
      badge.textContent = "ACC ĐÃ HỦY · LÁI CHÂN GA";
    } else if (status.trafficLightStopping) {
      badge.textContent = status.trafficLight === "yellow" ? "ĐÈN VÀNG · ĐANG DỪNG" : "ĐÈN ĐỎ · ĐANG DỪNG"; badge.classList.add("warn");
    } else if (status.brakeReason === "acc-gap") {
      badge.textContent = `ACC · GIỮ CÁCH ${Math.round(status.desiredGap)} m`;
    } else if (status.brakeReason === "acc-speed") {
      badge.textContent = "ACC · GIẢM VỀ TỐC ĐỘ ĐẶT";
    } else if (status.engaged) {
      badge.textContent = "ĐANG HỖ TRỢ";
      badge.classList.add("active");
    } else {
      badge.textContent = "CHỜ";
    }
    this.panel.querySelector("#adas-acc-cancel")!.classList.toggle("active", status.accState === "cancelled");
    const extraAlert = status.takeoverRequired ? "Hãy tiếp quản · kiểm tra cảm biến/vạch làn hoặc trạng thái tài xế" : status.extra.pedalMitigation ? "PMC ngắt ga và phanh" :
      status.extra.blindSpotIntervention ? "BCA hỗ trợ tránh xe trong điểm mù" : status.extra.emergencyLaneKeeping ? "ELK can thiệp tại mép đường" :
      status.extra.driverWarning !== "none" ? "Cảnh báo trạng thái tài xế giả lập" : status.extra.leadDeparture ? "Xe phía trước đã khởi hành" : "";
    if (extraAlert && extraAlert !== this.previousExtraAlert) this.log(extraAlert, status.takeoverRequired || status.extra.pedalMitigation ? "danger" : "warn");
    this.previousExtraAlert = extraAlert;

    // Icon strip.
    const chips: Record<string, "off" | "on" | "warn" | "danger"> = {
      acc: status.accActive ? (status.accHolding ? "warn" : "on") : "off",
      lka: status.laneCenteringActive ? "on" : "off",
      ldw: status.laneDeparture !== "none" ? "warn" : "off",
      fcw: status.aeb ? "danger" : status.fcw ? "warn" : "off",
      aeb: status.aeb ? "danger" : "off",
      bsm: status.blindSpotLeft || status.blindSpotRight ? "warn" : "off",
      alc: status.alc === "active" ? "on" : status.alc === "blocked" ? "warn" : status.alc === "armed" ? "warn" : "off",
      tsr: status.tsrLimitKph !== null ? (status.speedLimited ? "warn" : "on") : "off",
      rcta: status.rearAeb ? "danger" : status.rctaActive ? "warn" : "off",
    };
    for (const chip of Array.from(document.querySelectorAll<HTMLElement>(".adas-chip"))) {
      const state = chips[chip.dataset.chip ?? ""] ?? "off";
      chip.classList.toggle("on", state === "on");
      chip.classList.toggle("warn", state === "warn");
      chip.classList.toggle("danger", state === "danger");
    }

    this.el.gap.textContent = status.leadGap !== null ? `${status.leadGap.toFixed(1)} m` : "—";
    this.el.headway.textContent = `${sim.adas.config.timeGap.toFixed(1)} s / ${status.desiredGap.toFixed(0)} m`;
    this.el.headway.title = status.leadGap === null ? "Chưa có xe trước" : sim.ego.v < .5 ? `Xe đã dừng · cách xe trước ${status.leadGap.toFixed(1)} m` : `Thời gian bám xe thực tế: ${status.headway?.toFixed(1) ?? "—"} s`;
    this.el.set.textContent = `${Math.round(status.setSpeed * 3.6)} km/h`;
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-adas-ind]"))) {
      const direction = parseInt(button.dataset.adasInd!, 10);
      button.classList.toggle("active", sim.indicator === direction);
    }
    if (status.tsrLimitKph !== null) {
      this.el.limit.textContent = `${Math.round(status.tsrLimitKph)}`;
      this.el.limit.classList.toggle("warn", status.speedLimited);
    } else {
      this.el.limit.textContent = "—";
      this.el.limit.classList.remove("warn");
    }

    // Rising-edge event log.
    if (status.aeb && !this.prev.aeb) this.log(status.rearAeb ? "Phanh tự động khi lùi" : "AEB phanh khẩn cấp", "danger");
    if (status.fcwLevel > this.prev.fcw) this.log("Cảnh báo va chạm phía trước", "warn");
    if (status.laneDeparture !== "none" && this.prev.laneDeparture === "none") {
      this.log(status.laneDeparture === "left" ? "Lệch làn sang trái" : "Lệch làn sang phải", "warn");
    }
    const blind = status.blindSpotLeft || status.blindSpotRight;
    if (blind && !this.prev.blindSpot) {
      this.log(status.blindSpotLeft ? "Có xe trong điểm mù trái" : "Có xe trong điểm mù phải", "warn");
    }
    if (status.rctaActive && !this.prev.rcta) this.log("Có phương tiện cắt ngang phía sau", "warn");
    if (status.alc === "blocked" && this.prev.alc !== "blocked") this.log("Không thể chuyển làn", "warn");
    if (status.alcAborted) this.log(status.alcReason || "Đã hủy chuyển làn hỗ trợ", "warn");
    if (status.alc === "active" && this.prev.alc !== "active") {
      this.log(status.alcTargetLane !== null && status.alcTargetLane > sim.telemetry.lane ? "Hỗ trợ chuyển làn phải" : "Hỗ trợ chuyển làn trái", "ok");
    }
    if (status.tsrNew && status.tsrLimitKph !== null) this.log(`Nhận biết biển ${Math.round(status.tsrLimitKph)} km/h`, "ok");
    if (status.parkingFront !== null && status.parkingFront < 2.5 && this.prev.parking !== 1) {
      this.log(`Cảm biến đỗ xe trước: ${status.parkingFront.toFixed(1)} m`, "warn");
    }
    this.prev = {
      aeb: status.aeb,
      fcw: status.fcwLevel,
      laneDeparture: status.laneDeparture,
      blindSpot: blind,
      rcta: status.rctaActive,
      alc: status.alc,
      parking: status.parkingFront !== null && status.parkingFront < 2.5 ? 1 : 0,
    };
    if (this.logs.length > 0) {
      const latest = this.logs[0];
      this.el.log.innerHTML = `<span class="adas-log-t">${latest.stamp}</span><span class="adas-log-${latest.tone}">${latest.text}</span>`;
    }

    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    const sim = this.sim;
    const road = sim.road;
    const ego = sim.ego;
    const egoF = sim.path.toFrenet(ego.x, ego.y);
    const L = sim.path.length;
    const status = sim.adas.status;

    const sx = W / LAT_SPAN;
    const yOf = (ds: number): number => H - 30 - (ds / RANGE) * (H - 44);
    const xOf = (d: number): number => W / 2 + (d - egoF.d) * sx;

    ctx.clearRect(0, 0, W, H);
    // Cabin-like backdrop with a subtle horizon gradient.
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0d141b");
    bg.addColorStop(1, "#0a0f14");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    roundRect(ctx, 1, 1, W - 2, H - 2, 9);
    ctx.clip();

    // Road surface.
    ctx.fillStyle = "rgba(72, 82, 94, 0.55)";
    ctx.beginPath();
    ctx.moveTo(xOf(road.rightEdge), H);
    ctx.lineTo(xOf(road.leftEdge), H);
    ctx.lineTo(xOf(road.leftEdge), 0);
    ctx.lineTo(xOf(road.rightEdge), 0);
    ctx.closePath();
    ctx.fill();

    // Lane paint: solid edges, dashed dividers.
    const paint = (d: number, dashed: boolean): void => {
      ctx.strokeStyle = dashed ? "rgba(232,239,246,0.55)" : "rgba(240,246,252,0.9)";
      ctx.lineWidth = dashed ? 1 : 1.6;
      ctx.setLineDash(dashed ? [7, 7] : []);
      ctx.beginPath();
      ctx.moveTo(xOf(d), H);
      ctx.lineTo(xOf(d), 0);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    paint(road.leftEdge, false);
    paint(road.rightEdge, false);
    for (let i = 1; i < road.numLanes; i++) paint(road.rightEdge + i * road.laneWidth, true);

    // Distance ticks (10 / 25 / 40 m) for a sense of scale.
    ctx.strokeStyle = "rgba(120, 140, 160, 0.16)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "rgba(150, 170, 190, 0.4)";
    ctx.font = "8px Inter, Segoe UI, sans-serif";
    ctx.textAlign = "left";
    for (const metres of [10, 25, 40]) {
      const y = yOf(metres);
      ctx.beginPath();
      ctx.moveTo(xOf(road.rightEdge), y);
      ctx.lineTo(xOf(road.leftEdge), y);
      ctx.stroke();
      ctx.fillText(`${metres}m`, 5, y - 2);
    }

    // Perceived objects from the tracker.
    let leadTrack: { x: number; y: number; gap: number; ahead: number } | null = null;
    for (const track of sim.tracks) {
      const f = sim.path.toFrenet(track.px, track.py);
      const ds = wrapDiff(f.s, egoF.s, L);
      if (ds < -14 || ds > RANGE) continue;
      const x = xOf(f.d);
      const y = yOf(ds);
      if (x < -20 || x > W + 20) continue;
      if (track.kind === "ped") {
        ctx.fillStyle = "#ffc861";
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const inLane = Math.abs(f.d - egoF.d) < road.laneWidth * 0.55;
      const near = ds >= 0 && ds < Math.max(24, ego.v * 2.2);
      const alert = inLane && near;
      const danger = alert && status.aeb && ds < Math.max(14, ego.v * 1.2);
      const color = danger ? "255, 90, 90" : alert ? "255, 184, 64" : "110, 220, 168";
      const w = Math.max(9, track.width * sx);
      const h = Math.max(6, (track.length / RANGE) * (H - 44));
      ctx.fillStyle = `rgba(${color}, 0.18)`;
      ctx.strokeStyle = `rgba(${color}, 0.95)`;
      ctx.lineWidth = 1.2;
      roundRect(ctx, x - w / 2, y - h / 2, w, h, 2);
      ctx.fill();
      ctx.stroke();
      // Always show the measured following distance to the nearest vehicle in
      // our lane. The distance ruler is informational and must not disappear
      // just because FCW's warning threshold has not been reached.
      if (inLane && ds >= 0 && (leadTrack === null || ds < leadTrack.ahead)) {
        leadTrack = {
          x,
          y,
          gap: Math.max(0, ds - (ego.dims.length + track.length) / 2),
          ahead: ds,
        };
      }
    }

    // Lead-distance bracket.
    if (leadTrack) {
      const egoTop = H - 30 - 19;
      ctx.strokeStyle = "rgba(255, 184, 64, 0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W / 2 + 17, egoTop);
      ctx.lineTo(W / 2 + 17, leadTrack.y + 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(W / 2 + 13, leadTrack.y + 4);
      ctx.lineTo(W / 2 + 21, leadTrack.y + 4);
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 200, 97, 0.95)";
      ctx.font = "700 17px Inter, Segoe UI, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`${Math.max(0, leadTrack.gap).toFixed(0)} m`, W / 2 + 24, (egoTop + leadTrack.y) / 2 + 3);
    }

    // Ego.
    const egoX = W / 2;
    const egoY = H - 16;
    const blinkPhase = sim.telemetry.indicatorOn !== false;
    if (blinkPhase) {
      if (sim.indicator < 0) this.triangle(egoX - 16, egoY - 10, -1);
      if (sim.indicator > 0) this.triangle(egoX + 16, egoY - 10, 1);
    }
    ctx.fillStyle = "rgba(31, 209, 139, 0.16)";
    ctx.strokeStyle = "rgba(95, 230, 173, 0.95)";
    ctx.lineWidth = 1.4;
    roundRect(ctx, egoX - 13, egoY - 20, 26, 36, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(95, 230, 173, 0.85)";
    roundRect(ctx, egoX - 9, egoY - 17, 18, 11, 3);
    ctx.fill();
    // Turn-signal lamps on the ego silhouette.
    if (sim.indicator < 0) {
      ctx.fillStyle = blinkPhase ? "#ffc861" : "rgba(255, 200, 97, 0.25)";
      ctx.fillRect(egoX - 18, egoY - 18, 4, 4);
    }
    if (sim.indicator > 0) {
      ctx.fillStyle = blinkPhase ? "#ffc861" : "rgba(255, 200, 97, 0.25)";
      ctx.fillRect(egoX + 14, egoY - 18, 4, 4);
    }

    // Blind-spot shading.
    if (status.blindSpotLeft || status.blindSpotRight) {
      ctx.fillStyle = "rgba(255, 184, 64, 0.1)";
      if (status.blindSpotLeft) ctx.fillRect(egoX - 44, egoY - 22, 30, 42);
      if (status.blindSpotRight) ctx.fillRect(egoX + 14, egoY - 22, 30, 42);
    }

    // Sensor horizon hint.
    ctx.strokeStyle = "rgba(95, 230, 173, 0.18)";
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.arc(egoX, egoY - 2, (H - 44) * 0.42, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }

  private triangle(x: number, y: number, dir: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#ffc861";
    ctx.beginPath();
    ctx.moveTo(x + dir * 4, y - 4);
    ctx.lineTo(x + dir * 4, y + 4);
    ctx.lineTo(x - dir * 2, y);
    ctx.closePath();
    ctx.fill();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
