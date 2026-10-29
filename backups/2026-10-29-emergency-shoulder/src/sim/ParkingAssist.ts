import { bodyContact, Body2D, sweepBodies } from "../core/collision.ts";
import { clamp, wrapAngle } from "../core/math.ts";
import type { ADASFrame } from "./ADAS.ts";
import { assistanceAvailability } from './AssistancePolicy.ts';

export interface ParkingBay { id: string; s: number; d: number; length: number; width: number }
export type ParkingMode = "apa" | "remote-forward" | "remote-reverse";
export interface ParkingStatus {
  state: "idle" | "ready" | "running" | "paused" | "blocked" | "cancelled" | "complete";
  mode: ParkingMode;
  message: string;
  bayId: string | null;
  progress: number;
}
interface Waypoint { x: number; y: number; yaw: number }
interface Segment { gear: "D" | "R"; points: Waypoint[] }
export const emptyParkingStatus = (): ParkingStatus => ({ state: "idle", mode: "apa", message: "Chưa tìm ô đỗ", bayId: null, progress: 0 });

/** Low-speed, hold-to-run parking in marked parallel bays. It runs through the
 * SAME bicycle dynamics and collision system as driving, never teleports. */
export class ParkingAssist {
  status = emptyParkingStatus();
  segments: Segment[] = [];
  private segment = 0;
  private point = 0;
  private heartbeat = 0;
  private stopping = false;
  get controlling(): boolean { return ["running", "paused"].includes(this.status.state) || this.stopping; }
  reset(): void { this.status = emptyParkingStatus(); this.segments = []; this.segment = this.point = 0; this.heartbeat = 0; this.stopping = false; }
  hold(held: boolean): void { this.heartbeat = held ? .3 : 0; }
  cancel(message = "Người lái hủy đỗ xe"): void {
    if (!this.controlling && this.status.state !== "ready") return;
    this.status.state = "cancelled"; this.status.message = message; this.heartbeat = 0; this.stopping = true;
  }
  /** Scan actual free bay geometry and the complete approach/reverse envelope. */
  find(frame: ADASFrame, bays: ParkingBay[]): boolean {
    this.reset();
    const a = assistanceAvailability(frame);
    if (frame.ego.v > 2 || !a.sensors.ultrasonic || !a.sensors.camera || !a.conditions.engineOn || !a.conditions.doorsClosed || !a.conditions.beltFastened) {
      this.status.message = 'APA cần dưới 7 km/h, máy bật, cửa đóng, dây an toàn và camera/siêu âm sẵn sàng'; return false;
    }
    for (const bay of bays) {
      if (bay.length < frame.ego.dims.length + 2 || bay.width < frame.ego.dims.width + .6) continue;
      const stageS = bay.s + 18;
      const approach: Waypoint[] = [], reverse: Waypoint[] = [];
      // Only a local, nearly straight parking aisle is supported.
      if (Math.abs(wrapAngle(frame.path.cartesianAt(stageS).heading - frame.ego.yaw)) > .12) continue;
      const forwardDistance = ((stageS - frame.egoS + frame.path.length / 2) % frame.path.length + frame.path.length) % frame.path.length - frame.path.length / 2;
      if (forwardDistance < 0 || forwardDistance > 35 || Math.abs(bay.d - frame.egoD) > 5) continue;
      for (let i = 0; i <= 100; i++) {
        const w = frame.path.toCartesian(frame.egoS + forwardDistance * i / 100, frame.egoD);
        approach.push({ x: w.x, y: w.y, yaw: w.heading });
      }
      for (let i = 0; i <= 150; i++) {
        const t = i / 150, blend = t ** 3 * (10 - 15 * t + 6 * t * t);
        const w = frame.path.toCartesian(stageS - 18 * t, frame.egoD + (bay.d - frame.egoD) * blend);
        reverse.push({ x: w.x, y: w.y, yaw: w.heading });
      }
      for (let i = 0; i < reverse.length - 1; i++) reverse[i].yaw = Math.atan2(reverse[i].y - reverse[i + 1].y, reverse[i].x - reverse[i + 1].x);
      const segments: Segment[] = [{ gear: "D", points: approach }, { gear: "R", points: reverse }];
      if (!this.clearRoute(frame, segments)) continue;
      this.segments = segments;
      this.status = { state: "ready", mode: "apa", message: "Có ô phù hợp · giữ nút APA để tiến rồi lùi vào ô", bayId: bay.id, progress: 0 };
      return true;
    }
    this.status.state = "blocked"; this.status.message = "Không có ô hoặc đường vào đủ rộng; chưa lập được quỹ đạo an toàn";
    return false;
  }
  prepareRemote(frame: ADASFrame, direction: 1 | -1): boolean {
    this.reset();
    const a = assistanceAvailability(frame);
    if (frame.ego.v > .2 || !a.sensors.ultrasonic || !a.sensors.camera || !a.conditions.doorsClosed) { this.status.message = "RPA cần xe dừng, cửa đóng và camera/siêu âm hoạt động"; return false; }
    const points: Waypoint[] = [];
    for (let i = 0; i <= 60; i++) points.push({ x: frame.ego.x + direction * i / 10 * Math.cos(frame.ego.yaw), y: frame.ego.y + direction * i / 10 * Math.sin(frame.ego.yaw), yaw: frame.ego.yaw });
    this.segments = [{ gear: direction > 0 ? "D" : "R", points }];
    if (!this.clearRoute(frame, this.segments)) { this.status.state = "blocked"; this.status.message = "Đường di chuyển RPA có vật cản"; this.segments = []; return false; }
    this.status = { state: "ready", mode: direction > 0 ? "remote-forward" : "remote-reverse", message: "Giữ nút RPA · nhả nút hoặc mất tín hiệu sẽ phanh", bayId: null, progress: 0 };
    return true;
  }
  update(frame: ADASFrame) {
    const { ego, dt } = frame;
    this.heartbeat = Math.max(0, this.heartbeat - dt);
    const command = { steer: 0, accel: -ego.maxDecel, gear: null as "P" | "D" | "R" | null, releaseEpb: false, startEngine: false };
    if (this.status.state === "ready" && this.heartbeat > 0) this.status.state = "running";
    if (!this.controlling) return null;
    if (!this.segments[this.segment]) this.cancel("Không có quỹ đạo điều khiển · phanh dừng; hãy chuẩn bị lại APA/RPA");
    const a = assistanceAvailability(frame);
    if (!a.sensors.ultrasonic || !a.sensors.camera) this.cancel("Mất camera/siêu âm · đỗ xe đã hủy");
    if (!a.conditions.doorsClosed || (this.status.mode === 'apa' && (!a.conditions.beltFastened || !a.conditions.engineOn))) this.cancel('Cửa/dây an toàn/động cơ không đủ điều kiện · đã hủy đỗ');
    if (Math.abs(frame.input.steer) > .1 || frame.input.brake > .02 || frame.input.throttle > .02) this.cancel("Người lái tiếp quản · đỗ xe đã hủy");
    if (this.stopping) {
      if (ego.v < .05) { command.gear = "P"; this.stopping = false; }
      return command;
    }
    if (this.heartbeat <= 0) { this.status.state = "paused"; this.status.message = "Đang phanh · giữ lại nút để tiếp tục"; return command; }
    this.status.state = "running";
    const segment = this.segments[this.segment], points = segment.points;
    let nearest = this.point, distance = Infinity;
    for (let i = this.point; i < Math.min(points.length, this.point + 35); i++) {
      const d = Math.hypot(points[i].x - ego.x, points[i].y - ego.y);
      if (d < distance) { nearest = i; distance = d; }
    }
    this.point = nearest;
    const end = points[points.length - 1], remaining = Math.hypot(end.x - ego.x, end.y - ego.y);
    if (distance > 1.3) { this.cancel("Lệch khỏi quỹ đạo đỗ · hãy tiếp quản"); return command; }
    if (remaining < .25) {
      if (ego.v > .05) return command;
      if (this.segment < this.segments.length - 1) { this.segment++; this.point = 0; return command; }
      if (Math.abs(wrapAngle(ego.yaw - end.yaw)) > .12) { this.cancel("Xe chưa thẳng trong ô · cần chỉnh tay"); return command; }
      this.status.state = "complete"; this.status.progress = 1; this.status.message = "Đã đỗ · số P và phanh đỗ"; command.gear = "P"; return command;
    }
    let look = nearest;
    while (look < points.length - 1 && Math.hypot(points[look].x - ego.x, points[look].y - ego.y) < 1.3) look++;
    const target = points[look], dx = target.x - ego.x, dy = target.y - ego.y;
    const lateral = -dx * Math.sin(ego.yaw) + dy * Math.cos(ego.yaw);
    command.steer = this.status.mode === "apa" ? Math.atan2(2 * ego.dims.wheelbase * lateral, Math.max(dx * dx + dy * dy, .2)) : 0;
    command.gear = segment.gear; command.releaseEpb = true; command.startEngine = this.status.mode !== "apa";
    const targetSpeed = Math.min(this.status.mode === "apa" ? 1.3 : .7, Math.sqrt(Math.max(0, 1.2 * (remaining - .15))));
    command.accel = clamp((targetSpeed - ego.v) * 2, -ego.maxDecel, 1);
    const direction = segment.gear === "R" ? -1 : 1;
    // Predict the actual vehicle sweep (including rotation), with moving
    // actors, before applying any throttle. A new obstacle aborts the manoeuvre.
    const next: Body2D = { ...ego, ...ego.dims, x: ego.x + direction * Math.cos(ego.yaw) * 1.5, y: ego.y + direction * Math.sin(ego.yaw) * 1.5,
      yaw: ego.yaw + direction * 1.5 / ego.dims.wheelbase * Math.tan(command.steer) };
    for (const o of frame.obstacles) {
      const w = frame.path.toCartesian(o.s, o.d), predicted = frame.path.toCartesian(o.s + o.v, o.d + o.vd);
      const body: Body2D = { x: w.x, y: w.y, yaw: w.heading, length: o.length, width: o.width };
      if (sweepBodies({ ...ego, ...ego.dims }, next, body, { ...body, x: predicted.x, y: predicted.y }, .3)) {
        this.cancel("Vật cản trên quỹ đạo · phanh và hủy đỗ"); command.accel = -ego.maxDecel; command.releaseEpb = false; break;
      }
    }
    if (this.stopping) return command;
    this.status.progress = (this.segment + nearest / points.length) / this.segments.length;
    this.status.message = `${this.status.mode === "apa" ? "APA" : "RPA"} · số ${segment.gear} · ${Math.round(this.status.progress * 100)}% · giữ nút để chạy`;
    return command;
  }
  private clearRoute(frame: ADASFrame, segments: Segment[]): boolean {
    for (const segment of segments) {
      for (let i = 0; i < segment.points.length; i++) {
        const p = segment.points[i];
        if (i > 0) {
          const prev = segment.points[i - 1], ds = Math.hypot(prev.x - p.x, prev.y - p.y);
          if (Math.abs(wrapAngle(p.yaw - prev.yaw)) / Math.max(ds, .01) > Math.tan(frame.ego.maxSteer) / frame.ego.dims.wheelbase * .9) return false;
        }
        for (const o of frame.obstacles) {
          const w = frame.path.toCartesian(o.s, o.d);
          if (bodyContact({ ...p, ...frame.ego.dims }, { ...w, yaw: w.heading, length: o.length, width: o.width }, .35)) return false;
        }
      }
    }
    return true;
  }
}
