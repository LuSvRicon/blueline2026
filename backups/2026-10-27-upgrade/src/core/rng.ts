// Rng — a small deterministic PRNG (mulberry32) for the simulation.
//
// Every stochastic decision inside the simulation (spawn placement, sensor
// noise, dropout, lane-change cooldowns, colours) draws from an instance of this
// class instead of Math.random, so a run is fully reproducible from its seed.
// Rendering-only randomness (building placement, sparkles) may keep using
// Math.random and never affects the physics.

export class Rng {
  private state: number;
  private readonly initial: number;

  constructor(seed = 1) {
    this.initial = seed >>> 0;
    this.state = this.initial;
  }

  get seed(): number {
    return this.initial;
  }

  reset(seed = this.initial): void {
    this.state = seed >>> 0;
  }

  /** Uniform [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform [min, max). */
  range(min: number, max: number): number {
    return min + (this.next() * (max - min));
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Box–Muller normal sample (mean 0, std-dev 1). */
  normal(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** Snapshot/restore support for deterministic replay. */
  getState(): number {
    return this.state >>> 0;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}

/** A fresh, unpredictable seed for a new session (URL `?seed=` to override). */
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}
