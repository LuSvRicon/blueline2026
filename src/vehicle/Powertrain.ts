import { clamp } from "../core/math.ts";

/** Rolling resistance and aerodynamic drag expressed as deceleration. */
export function coastDeceleration(speed: number): number { return .16 + .00048 * speed * speed; }

/** An approximate six-speed automatic tachometer; not an engine torque model. */
export function engineRpm(speed: number, throttle: number, gear: string, running: boolean): number {
  if (!running) return 0;
  if (gear === "N" || gear === "P") return 800 + clamp(throttle, 0, 1) * 4200;
  const ratios = [3.9, 2.4, 1.55, 1.12, .87, .68];
  const index = Math.min(5, Math.floor(speed / 7));
  const ratio = gear === "R" ? 3.4 : ratios[index];
  return clamp(800 + speed * ratio * 78 + throttle * 420, 800, 6200);
}
