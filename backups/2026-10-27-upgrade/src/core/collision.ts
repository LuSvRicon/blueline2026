/** Axis-aligned overlap in the road Frenet frame (station `s`, offset `d`). */

export function frenetBoxesOverlap(
  ds: number,
  dd: number,
  lengthA: number,
  widthA: number,
  lengthB: number,
  widthB: number,
  margin = 0.05,
): boolean {
  return Math.abs(ds) < (lengthA + lengthB) / 2 + margin && Math.abs(dd) < (widthA + widthB) / 2 + margin;
}

export function bumperGap(ds: number, lengthA: number, lengthB: number): number {
  return Math.abs(ds) - (lengthA + lengthB) / 2;
}
