export interface RenderCounters { calls: number; triangles: number; geometries: number; textures: number }

/** Bounded, measured frame telemetry. Raw wall intervals are kept separate
 * from the simulation's capped timestep; a 400ms stall must remain 400ms. */
export class RuntimePerformance {
  private readonly intervals: Float64Array;
  private readonly work: Float64Array;
  private cursor = 0;
  private count = 0;
  private frames = 0;
  private visibleMs = 0;
  private worstMs = 0;
  private longFrames = 0;
  private heapBytes: number | null = null;
  private peakHeapBytes: number | null = null;
  private counters: RenderCounters = { calls: 0, triangles: 0, geometries: 0, textures: 0 };
  contextLosses = 0;
  contextRestores = 0;

  constructor(capacity = 3600) {
    if (!Number.isInteger(capacity) || capacity < 2 || capacity > 36000) throw new Error('Invalid frame sample capacity');
    this.intervals = new Float64Array(capacity);
    this.work = new Float64Array(capacity);
  }

  record(intervalMs: number, workMs: number, counters: RenderCounters, heapBytes?: number): void {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || !Number.isFinite(workMs) || workMs < 0) return;
    this.intervals[this.cursor] = intervalMs;
    this.work[this.cursor] = workMs;
    this.cursor = (this.cursor + 1) % this.intervals.length;
    this.count = Math.min(this.count + 1, this.intervals.length);
    this.frames++;
    this.visibleMs += intervalMs;
    this.worstMs = Math.max(this.worstMs, intervalMs);
    if (intervalMs > 50) this.longFrames++;
    this.counters = { ...counters };
    if (heapBytes !== undefined && Number.isFinite(heapBytes) && heapBytes >= 0) {
      this.heapBytes = heapBytes;
      this.peakHeapBytes = Math.max(this.peakHeapBytes ?? 0, heapBytes);
    }
  }

  snapshot() {
    const sorted = Array.from(this.intervals.subarray(0, this.count)).sort((a, b) => a - b);
    const percentile = (p: number) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
    const sum = sorted.reduce((a, b) => a + b, 0);
    let workSum = 0;
    for (let i = 0; i < this.count; i++) workSum += this.work[i];
    return {
      frames: this.frames, visibleSeconds: this.visibleMs / 1000, samples: this.count,
      sampleCapacity: this.intervals.length,
      fps: sum > 0 ? this.count * 1000 / sum : null,
      frameP50Ms: percentile(.50), frameP95Ms: percentile(.95), frameP99Ms: percentile(.99),
      worstFrameMs: this.worstMs, longFramesOver50Ms: this.longFrames,
      meanMainThreadWorkMs: this.count ? workSum / this.count : null,
      jsHeapBytes: this.heapBytes, peakJsHeapBytes: this.peakHeapBytes,
      render: { ...this.counters }, contextLosses: this.contextLosses, contextRestores: this.contextRestores,
    };
  }
}
