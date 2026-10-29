// SessionRecorder stores timestamped simulation snapshots for exact visual replay.

export interface RecordedFrame<T> {
  time: number;
  value: T;
}

export class SessionRecorder<T> {
  readonly frames: RecordedFrame<T>[] = [];
  recording = false;
  playing = false;
  elapsed = 0;
  playhead = 0;

  constructor(private readonly maxFrames = 18000) {}

  startRecording(): void {
    this.frames.length = 0;
    this.elapsed = 0;
    this.playhead = 0;
    this.playing = false;
    this.recording = true;
  }

  stopRecording(): void {
    this.recording = false;
  }

  record(value: T, dt: number): void {
    if (!this.recording || this.playing) return;
    if (!Number.isFinite(dt) || dt <= 0 || value === undefined) return;
    if (this.frames.length >= this.maxFrames) {
      this.recording = false;
      return;
    }
    this.elapsed += dt;
    this.frames.push({ time: this.elapsed, value });
  }

  startPlayback(): boolean {
    if (this.frames.length === 0) return false;
    this.recording = false;
    this.playing = true;
    this.playhead = 0;
    return true;
  }

  stopPlayback(): void {
    this.playing = false;
  }

  advance(dt: number): { frame: RecordedFrame<T>; finished: boolean } | null {
    if (!this.playing || this.frames.length === 0) return null;
    if (!Number.isFinite(dt) || dt < 0) return null;
    const duration = this.frames[this.frames.length - 1].time;
    this.playhead = Math.min(this.playhead + dt, duration);
    if (duration - this.playhead < 1e-9) this.playhead = duration;
    if (this.playhead < this.frames[0].time) return null;
    // Snapshot timestamps need not be evenly spaced (imported/variable-step
    // sessions). Pick the latest actual timestamp, never a future snapshot.
    let index = 0, high = this.frames.length - 1;
    while (index < high) {
      const mid = Math.ceil((index + high) / 2);
      if (this.frames[mid].time <= this.playhead) index = mid;
      else high = mid - 1;
    }
    const finished = this.playhead >= duration;
    if (finished) this.playing = false;
    return { frame: this.frames[index], finished };
  }

  serialize(): string {
    return JSON.stringify({ version: 1, frames: this.frames });
  }

  load(json: string): boolean {
    try {
      const parsed = JSON.parse(json) as { version?: number; frames?: RecordedFrame<T>[] };
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.frames) || parsed.frames.length === 0 || parsed.frames.length > this.maxFrames) {
        return false;
      }
      let previous = -Infinity;
      for (const frame of parsed.frames) {
        if (!frame || !Number.isFinite(frame.time) || frame.time < 0 || frame.time <= previous || frame.value === undefined) return false;
        previous = frame.time;
      }
      // Validate completely before replacing the current session. A malformed
      // file must not erase or partially overwrite a valid drive recording.
      this.frames.splice(0, this.frames.length, ...parsed.frames.map(frame => ({time: frame.time, value: frame.value})));
      this.recording = false;
      this.playing = false;
      this.elapsed = this.frames[this.frames.length - 1].time;
      this.playhead = 0;
      return true;
    } catch {
      return false;
    }
  }
}
