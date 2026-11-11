// PathRibbon — the signature planned-path ribbon. Following the Tesla FSD look
// it is SHORT (only the immediate ~35 m of intent, not the full horizon) and
// TEMPORALLY SMOOTHED: the displayed points ease toward each new plan, so the
// ribbon glides when the planner switches lanes instead of snapping across the
// road. Brightness encodes intent (brighter where the car will carry speed).

import * as THREE from "three";
import { Trajectory } from "../planner/Trajectory.ts";
import { THEME } from "./theme.ts";
import { clamp } from "../core/math.ts";

const HALF_WIDTH = 0.65;
const HEIGHT = 0.08;
const N = 18; // display points
const SPACING = 2.0; // metres between them → ~36 m of path shown
const EASE = 0.35; // temporal smoothing per frame

const BRIGHT_COLOR = new THREE.Color(THEME.pathBlue).multiplyScalar(1.65);
const FAINT_COLOR = new THREE.Color(THEME.pathBlueFaint);

interface P {
  x: number;
  y: number;
  v: number;
}

export class PathRibbon {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private posBuf = new Float32Array(N * 2 * 3);
  private colBuf = new Float32Array(N * 2 * 3);
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private smooth: P[] = [];
  private cumBuf: number[] = [];

  constructor() {
    this.posAttr = new THREE.BufferAttribute(this.posBuf, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colBuf, 3);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", this.posAttr);
    this.geo.setAttribute("color", this.colAttr);

    const indices: number[] = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(indices);

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.mesh.renderOrder = 5;
  }

  /** Resample the plan to N points at fixed arc-length spacing. */
  private resample(pts: Trajectory["points"], startDistance: number): P[] {
    const out: P[] = [];
    const cum = this.cumBuf;
    cum.length = pts.length;
    cum[0] = 0;
    for (let i = 1; i < pts.length; i++) {
      cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    let seg = 0;
    for (let k = 0; k < N; k++) {
      const target = startDistance + k * SPACING;
      while (seg < pts.length - 2 && cum[seg + 1] < target) seg++;
      const segLen = cum[seg + 1] - cum[seg] || 1;
      const t = clamp((target - cum[seg]) / segLen, 0, 1);
      const a = pts[seg];
      const b = pts[Math.min(seg + 1, pts.length - 1)];
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, v: a.v + (b.v - a.v) * t });
    }
    return out;
  }

  update(plan: Trajectory | null, desiredSpeed: number, startDistance = 0, displayScale = 1): void {
    const pts = plan?.points ?? [];
    if (pts.length < 2) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = displayScale < 1 ? 0.48 : 0.92;

    const target = this.resample(pts, startDistance);
    // Snap on a big discontinuity (reset / teleport), otherwise ease.
    if (this.smooth.length !== N || Math.hypot(target[0].x - this.smooth[0].x, target[0].y - this.smooth[0].y) > 8) {
      this.smooth = target.map((p) => ({ ...p }));
    } else {
      for (let i = 0; i < N; i++) {
        this.smooth[i].x += (target[i].x - this.smooth[i].x) * EASE;
        this.smooth[i].y += (target[i].y - this.smooth[i].y) * EASE;
        this.smooth[i].v += (target[i].v - this.smooth[i].v) * EASE;
      }
    }

    const s = this.smooth;
    const pos = this.posBuf;
    const col = this.colBuf;
    const halfW = HALF_WIDTH * displayScale;
    const denom = Math.max(desiredSpeed, 1);

    for (let i = 0; i < N; i++) {
      const prev = s[Math.max(0, i - 1)];
      const next = s[Math.min(N - 1, i + 1)];
      let dx = next.x - prev.x;
      let dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const px = -dy * halfW;
      const py = dx * halfW;
      const o = i * 6;
      pos[o] = s[i].x + px;
      pos[o + 1] = HEIGHT;
      pos[o + 2] = s[i].y + py;
      pos[o + 3] = s[i].x - px;
      pos[o + 4] = HEIGHT;
      pos[o + 5] = s[i].y - py;

      const frac = clamp(s[i].v / denom, 0, 1);
      const w = 0.25 + 0.75 * frac;
      const r = FAINT_COLOR.r + (BRIGHT_COLOR.r - FAINT_COLOR.r) * w;
      const g = FAINT_COLOR.g + (BRIGHT_COLOR.g - FAINT_COLOR.g) * w;
      const b = FAINT_COLOR.b + (BRIGHT_COLOR.b - FAINT_COLOR.b) * w;
      col[o] = r;
      col[o + 1] = g;
      col[o + 2] = b;
      col[o + 3] = r;
      col[o + 4] = g;
      col[o + 5] = b;
    }

    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}
