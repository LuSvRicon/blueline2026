/** Heading-up projection matching the simulator's (x,y) -> Three (x,0,z)
 * mapping. Positive lateral displacement appears on the driver's right. */
export function projectEgoPoint(x: number, y: number, egoX: number, egoY: number, yaw: number, scale: number, cx: number, cy: number): [number, number] {
  const dx = x - egoX, dy = y - egoY, cos = Math.cos(yaw), sin = Math.sin(yaw);
  return [cx + (-dx * sin + dy * cos) * scale, cy - (dx * cos + dy * sin) * scale];
}
