/** Shared relay phase for the exterior lamps, cluster, HUD and audio. */
export function indicatorOn(timeSeconds: number): boolean {
  return Math.floor((timeSeconds + 1e-8) / .39) % 2 === 0;
}

export function laneChangeIndicator(lateralRemaining: number): -1 | 0 | 1 {
  return Math.abs(lateralRemaining) > .12 ? lateralRemaining > 0 ? 1 : -1 : 0;
}
