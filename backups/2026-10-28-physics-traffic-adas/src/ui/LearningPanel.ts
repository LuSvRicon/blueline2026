// LearningPanel — the "Neural Driver" control (top-centre). Offers TWO ways to
// get a neural policy: (1) TRAIN by imitation + DAgger from the classical expert,
// (2) EVOLVE from scratch with a genetic algorithm (no teacher). Both show live
// progress AND a live chart (loss falling / fitness climbing). Trained brains are
// persisted to localStorage so they survive a reload; hand the wheel to either
// learned driver and toggle back to the classical stack anytime.

import { Simulation, ControlMode } from "../sim/Simulation.ts";
import { trainDriver } from "../learn/Trainer.ts";
import { evolveDriver } from "../learn/Evolution.ts";
import { MLP, MLPState } from "../learn/NN.ts";
import { decodeAction } from "../learn/features.ts";

const KEY_IMIT = "bl_imitation_v1";
const KEY_EVO = "bl_evolved_v1";

function translateTrainingPhase(phase: string): string {
  if (phase === "Collecting expert demonstrations") return "Đang thu thập thao tác mẫu";
  if (phase === "Training network (behavioural cloning)") return "Đang huấn luyện mạng nơ-ron";
  if (phase === "Done") return "Hoàn tất huấn luyện";
  const dagger = phase.match(/DAgger refinement (\d+)\/(\d+)/);
  return dagger ? `Tinh chỉnh DAgger ${dagger[1]}/${dagger[2]}` : phase;
}

export class LearningPanel {
  private busy = false;
  private champion: MLP | null = null;
  private history: number[] = [];
  private chart: CanvasRenderingContext2D | null = null;

  constructor(root: HTMLElement, private sim: Simulation) {
    root.insertAdjacentHTML(
      "beforeend",
      `
      <div class="neural panel">
        <div class="neural-head">
          <span class="neural-title">🧠 HUẤN LUYỆN AI</span>
          <span class="neural-sub" id="nn-sub">Huấn luyện chính sách lái rồi chuyển quyền điều khiển cho AI</span>
        </div>
        <div class="btn-row">
          <button class="bl" id="nn-train">Huấn luyện bắt chước</button>
          <button class="bl" id="nn-evolve">Tiến hóa AI</button>
        </div>
        <div class="btn-row model-ops">
          <button class="bl" id="nn-export" title="Tải xuống tệp trọng số mô hình đã huấn luyện">💾 Xuất mô hình</button>
          <button class="bl" id="nn-import-btn" title="Nạp tệp trọng số mô hình từ máy tính">📂 Nạp mô hình</button>
          <input type="file" id="nn-file-input" accept=".json" style="display:none" />
        </div>
        <div class="neural-prog" id="nn-prog" style="display:none">
          <canvas class="nn-chart" id="nn-chart" width="330" height="44"></canvas>
          <div class="neural-bar"><div class="neural-fill" id="nn-fill"></div></div>
          <div class="neural-stat"><span id="nn-phase">…</span><span id="nn-metric"></span></div>
        </div>
        <div class="neural-drive" id="nn-drive">
          <span class="neural-drive-label">Chế độ lái</span>
          <div class="seg">
            <button class="seg-btn active" id="nn-classical">AI tự động</button>
            <button class="seg-btn disabled" id="nn-ai">Mạng nơ-ron</button>
            <button class="seg-btn disabled" id="nn-evo">AI tiến hóa</button>
          </div>
        </div>
      </div>
      `,
    );

    this.chart = (document.getElementById("nn-chart") as HTMLCanvasElement).getContext("2d");
    (document.getElementById("nn-train") as HTMLButtonElement).addEventListener("click", () => this.runTrain());
    (document.getElementById("nn-evolve") as HTMLButtonElement).addEventListener("click", () => this.runEvolve());
    document.getElementById("nn-export")!.addEventListener("click", () => this.exportModel());
    
    const fileInput = document.getElementById("nn-file-input") as HTMLInputElement;
    document.getElementById("nn-import-btn")!.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => this.importModel(e));

    document.getElementById("nn-classical")!.addEventListener("click", () => this.setMode("classical"));
    document.getElementById("nn-ai")!.addEventListener("click", () => this.setMode("learned"));
    document.getElementById("nn-evo")!.addEventListener("click", () => this.setMode("external"));

    this.restore();
  }

  private exportModel(): void {
    const imit = this.sim.imitation.trained ? this.sim.imitation.net.toJSON() : null;
    const evo = this.champion ? this.champion.toJSON() : null;
    if (!imit && !evo) {
      alert("Chưa có mô hình AI nào được huấn luyện để xuất. Vui lòng chạy Huấn luyện bắt chước hoặc Tiến hóa AI trước.");
      return;
    }
    const data = {
      app: "BlueLine",
      version: "0.1.0",
      exportedAt: new Date().toISOString(),
      imitation: imit,
      evolution: evo,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blueline-ai-model-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    document.getElementById("nn-sub")!.textContent = "Đã xuất mô hình AI thành công ✓";
  }

  private importModel(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);
        let loadedAny = false;
        if (data.imitation) {
          this.sim.imitation.loadState(data.imitation as MLPState);
          localStorage.setItem(KEY_IMIT, JSON.stringify(data.imitation));
          document.getElementById("nn-ai")!.classList.remove("disabled");
          loadedAny = true;
        }
        if (data.evolution) {
          this.champion = MLP.fromJSON(data.evolution as MLPState);
          this.sim.evolvedChampion = this.champion;
          localStorage.setItem(KEY_EVO, JSON.stringify(data.evolution));
          document.getElementById("nn-evo")!.classList.remove("disabled");
          loadedAny = true;
        }
        if (loadedAny) {
          document.getElementById("nn-sub")!.textContent = `Đã nạp thành công mô hình từ ${file.name} ✓`;
        } else {
          alert("Tệp JSON không chứa dữ liệu mô hình BlueLine hợp lệ.");
        }
      } catch (err) {
        alert("Lỗi đọc tệp mô hình: " + (err as Error).message);
      } finally {
        input.value = "";
      }
    };
    reader.readAsText(file);
  }

  /** Reload previously-trained brains from localStorage. */
  private restore(): void {
    try {
      const imit = localStorage.getItem(KEY_IMIT);
      if (imit) {
        this.sim.imitation.loadState(JSON.parse(imit) as MLPState);
        document.getElementById("nn-ai")!.classList.remove("disabled");
      }
      const evo = localStorage.getItem(KEY_EVO);
      if (evo) {
        this.champion = MLP.fromJSON(JSON.parse(evo) as MLPState);
        this.sim.evolvedChampion = this.champion;
        document.getElementById("nn-evo")!.classList.remove("disabled");
      }
      if (imit || evo) document.getElementById("nn-sub")!.textContent = "Đã tải mô hình AI đã lưu ✓";
    } catch {
      localStorage.removeItem(KEY_IMIT);
      localStorage.removeItem(KEY_EVO);
    }
  }

  private setMode(mode: ControlMode): void {
    if (mode === "learned" && !this.sim.imitation.trained) return;
    if (mode === "external") {
      if (!this.champion) return;
      const champ = this.champion;
      this.sim.externalPolicy = (f) => decodeAction(champ.predict(f));
    }
    this.sim.setControlMode(mode);
    this.update();
  }

  update(): void {
    document.getElementById("nn-classical")!.classList.toggle("active", this.sim.controlMode === "classical");
    document.getElementById("nn-ai")!.classList.toggle("active", this.sim.controlMode === "learned");
    document.getElementById("nn-evo")!.classList.toggle("active", this.sim.controlMode === "external");
  }

  private startBusy(label: string): void {
    this.busy = true;
    this.history = [];
    (document.getElementById("nn-train") as HTMLButtonElement).disabled = true;
    (document.getElementById("nn-evolve") as HTMLButtonElement).disabled = true;
    document.getElementById("nn-prog")!.style.display = "block";
    document.getElementById("nn-phase")!.textContent = label;
    document.getElementById("nn-fill")!.style.width = "0%";
  }

  private endBusy(): void {
    this.busy = false;
    (document.getElementById("nn-train") as HTMLButtonElement).disabled = false;
    (document.getElementById("nn-evolve") as HTMLButtonElement).disabled = false;
  }

  private drawChart(color: string): void {
    const ctx = this.chart;
    if (!ctx) return;
    const W = 330;
    const H = 44;
    ctx.clearRect(0, 0, W, H);
    const v = this.history;
    if (v.length < 2) return;
    let min = Infinity;
    let max = -Infinity;
    for (const x of v) {
      if (x < min) min = x;
      if (x > max) max = x;
    }
    if (max - min < 1e-9) max = min + 1;
    const x = (i: number) => (i / (v.length - 1)) * (W - 2) + 1;
    const y = (val: number) => H - 4 - ((val - min) / (max - min)) * (H - 8);

    ctx.beginPath();
    ctx.moveTo(x(0), y(v[0]));
    for (let i = 1; i < v.length; i++) ctx.lineTo(x(i), y(v[i]));
    ctx.lineTo(x(v.length - 1), H);
    ctx.lineTo(x(0), H);
    ctx.closePath();
    ctx.fillStyle = color + "22";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x(0), y(v[0]));
    for (let i = 1; i < v.length; i++) ctx.lineTo(x(i), y(v[i]));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  private async runTrain(): Promise<void> {
    if (this.busy) return;
    this.startBusy("Đang thu thập thao tác mẫu…");
    const fill = document.getElementById("nn-fill")!;
    const phase = document.getElementById("nn-phase")!;
    const metric = document.getElementById("nn-metric")!;
    const weights = await trainDriver((p) => {
      fill.style.width = `${Math.round(p.frac * 100)}%`;
      phase.textContent = translateTrainingPhase(p.phase);
      metric.textContent = `Sai số ${p.loss.toFixed(4)} · ${p.samples.toLocaleString()} mẫu`;
      if (p.loss > 0) {
        this.history.push(p.loss);
        this.drawChart("#5fe6ad");
      }
    });
    this.sim.imitation.loadState(weights);
    try {
      localStorage.setItem(KEY_IMIT, JSON.stringify(weights));
    } catch {
      /* storage full — non-fatal */
    }
    document.getElementById("nn-ai")!.classList.remove("disabled");
    document.getElementById("nn-sub")!.textContent = "Đã huấn luyện và lưu mạng nơ-ron ✓";
    this.setMode("learned");
    this.endBusy();
  }

  private async runEvolve(): Promise<void> {
    if (this.busy) return;
    this.startBusy("Bắt đầu tiến hóa thế hệ 1…");
    const fill = document.getElementById("nn-fill")!;
    const phase = document.getElementById("nn-phase")!;
    const metric = document.getElementById("nn-metric")!;
    const state = await evolveDriver((p) => {
      fill.style.width = `${Math.round(p.frac * 100)}%`;
      phase.textContent = `Đang tiến hóa · thế hệ ${p.generation}/${p.totalGen}`;
      metric.textContent = `Điểm cao nhất ${p.bestFitness.toFixed(0)} · trung bình ${p.avgFitness.toFixed(0)}`;
      this.history.push(p.bestFitness);
      this.drawChart("#4ade80");
    });
    this.champion = MLP.fromJSON(state);
    this.sim.evolvedChampion = this.champion;
    try {
      localStorage.setItem(KEY_EVO, JSON.stringify(state));
    } catch {
      /* non-fatal */
    }
    document.getElementById("nn-evo")!.classList.remove("disabled");
    document.getElementById("nn-sub")!.textContent = "AI đã tiến hóa từ đầu và được lưu ✓";
    this.setMode("external");
    this.endBusy();
  }
}
