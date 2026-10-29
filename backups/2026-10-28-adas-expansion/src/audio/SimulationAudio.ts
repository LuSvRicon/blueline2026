// SimulationAudio — procedural, event-driven audio generated with Web Audio.
// Engine, tyre scrub, turn-signal ticks, warning chimes and impact feedback.
// These are simulation cues, not an acoustic model of a real vehicle.

import { Simulation } from "../sim/Simulation.ts";
import { clamp } from "../core/math.ts";
import { engineRpm } from "../vehicle/Powertrain.ts";

export class SimulationAudio {
  enabled = false;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private traffic: AudioBufferSourceNode | null = null;
  private trafficGain: GainNode | null = null;
  private trafficFilter: BiquadFilterNode | null = null;
  private skidGain: GainNode | null = null;
  private previousAlert = "";
  private lastTick = 0;
  private lastAebBeep = 0;
  private lastRctaBeep = 0;

  async setEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      if (this.context && this.master) {
        this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.05);
      }
      this.enabled = false;
      this.previousAlert = "";
      return false;
    }

    if (!window.AudioContext) return false;
    if (!this.context) this.createGraph();
    await this.context!.resume();
    this.enabled = true;
    this.master!.gain.setTargetAtTime(0.85, this.context!.currentTime, 0.08);
    return true;
  }

  setVolume(vol: number): void {
    if (!this.context || !this.master) return;
    const clamped = clamp(vol, 0, 1);
    this.master.gain.setTargetAtTime(clamped, this.context.currentTime, 0.05);
  }

  update(sim: Simulation): void {
    if (
      !this.enabled ||
      !this.context ||
      !this.engine ||
      !this.engineGain ||
      !this.engineFilter ||
      !this.trafficGain ||
      !this.trafficFilter
    ) {
      return;
    }
    const now = this.context.currentTime;
    if (sim.paused) {
      this.engineGain.gain.setTargetAtTime(0, now, .05);
      this.trafficGain.gain.setTargetAtTime(0, now, .05);
      this.skidGain?.gain.setTargetAtTime(0, now, .05);
      this.previousAlert = "";
      return;
    }
    const speed = sim.ego.v;
    const acceleration = sim.ego.a;
    const rpm = engineRpm(speed, sim.driverInput.throttle, sim.gear, sim.engineOn);
    this.engine.frequency.setTargetAtTime(32 + rpm / 60 * 1.6, now, 0.06);
    this.engineGain.gain.setTargetAtTime(
      sim.engineOn ? 0.08 + clamp(speed / 45, 0, 1) * 0.12 + Math.max(0, acceleration) * 0.02 : 0,
      now,
      0.08,
    );
    this.engineFilter.frequency.setTargetAtTime(260 + rpm * .22, now, 0.1);

    const density = clamp(sim.traffic.count / 36, 0, 1);
    this.trafficGain.gain.setTargetAtTime(density * (0.02 + clamp(speed / 50, 0, 1) * 0.04), now, 0.25);
    this.trafficFilter.frequency.setTargetAtTime(320 + density * 500, now, 0.3);

    // Tyre scrub: lateral acceleration beyond ~4.5 m/s².
    if (this.skidGain) {
      const lateral = Math.abs(sim.ego.lateralAccel);
      const scrub = clamp((lateral - 4.0) / 6, 0, 1);
      this.skidGain.gain.setTargetAtTime(scrub * 0.18, now, 0.12);
    }

    const state = sim.adas.status;
    const alert = state.aeb ? "aeb" : state.fcw ? "fcw" : state.rctaActive ? "rcta" : state.blindSpotLeft ? "left" : state.blindSpotRight ? "right" : "";
    if (alert && alert !== this.previousAlert) {
      const frequency = alert === "aeb" ? 980 : alert === "fcw" ? 740 : alert === "rcta" ? 620 : 480;
      const pan = alert === "left" || (alert === "rcta" && state.rctaLeft) ? -0.65 : alert === "right" || (alert === "rcta" && state.rctaRight) ? 0.65 : 0;
      this.playAlert(frequency, pan, alert === "aeb" ? 0.25 : 0.16);
    }
    // Escalating chime while AEB is actually braking.
    if (state.aeb && now - this.lastAebBeep > 0.45) {
      this.lastAebBeep = now;
      this.playAlert(1120, 0, 0.14);
    }
    if (state.rctaActive && !state.rearAeb && now - this.lastRctaBeep > 0.32) {
      this.lastRctaBeep = now;
      const pan = state.rctaLeft && !state.rctaRight ? -0.7 : state.rctaRight && !state.rctaLeft ? 0.7 : 0;
      this.playAlert(650, pan, 0.12);
    }
    this.previousAlert = alert;

    // Turn-signal relay ticks, in time with the 0.78 s flash cycle.
    const indicating = (sim.controlMode === "manual" || sim.controlMode === "adas") && sim.indicator !== 0;
    if (indicating && now - this.lastTick > 0.39) {
      this.lastTick = now;
      this.playTick(sim.indicator < 0 ? -0.55 : 0.55);
    }
  }

  /** One-shot impact thud used when the metrics count a collision. */
  impact(): void {
    if (!this.enabled || !this.context || !this.master) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(140, now);
    oscillator.frequency.exponentialRampToValueAtTime(32, now + 0.25);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.85, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.42);
  }

  private createGraph(): void {
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);

    const engine = context.createOscillator();
    engine.type = "sawtooth";
    const engineFilter = context.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 320;
    const engineGain = context.createGain();
    engineGain.gain.value = 0;
    engine.connect(engineFilter).connect(engineGain).connect(master);
    engine.start();

    const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
    const traffic = context.createBufferSource();
    traffic.buffer = noiseBuffer;
    traffic.loop = true;
    const trafficFilter = context.createBiquadFilter();
    trafficFilter.type = "lowpass";
    trafficFilter.frequency.value = 500;
    const trafficGain = context.createGain();
    trafficGain.gain.value = 0;
    traffic.connect(trafficFilter).connect(trafficGain).connect(master);
    traffic.start();

    const skid = context.createBufferSource();
    skid.buffer = noiseBuffer;
    skid.loop = true;
    const skidFilter = context.createBiquadFilter();
    skidFilter.type = "bandpass";
    skidFilter.frequency.value = 1500;
    skidFilter.Q.value = 0.9;
    const skidGain = context.createGain();
    skidGain.gain.value = 0;
    skid.connect(skidFilter).connect(skidGain).connect(master);
    skid.start();

    this.context = context;
    this.master = master;
    this.engine = engine;
    this.engineFilter = engineFilter;
    this.engineGain = engineGain;
    this.traffic = traffic;
    this.trafficFilter = trafficFilter;
    this.trafficGain = trafficGain;
    this.skidGain = skidGain;
  }

  private playAlert(frequency: number, pan: number, duration: number): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const stereo = this.context.createStereoPanner();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    stereo.pan.value = pan;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.018);
    gain.gain.setValueAtTime(0.35, now + duration * 0.55);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(stereo).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  /** Short, dry relay click for the turn signal. */
  private playTick(pan: number): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const stereo = this.context.createStereoPanner();
    oscillator.type = "square";
    oscillator.frequency.value = 1650;
    stereo.pan.value = pan;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    oscillator.connect(gain).connect(stereo).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.06);
  }
}
