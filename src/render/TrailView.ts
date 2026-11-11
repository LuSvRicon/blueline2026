// TrailView — a fading breadcrumb ribbon of where the ego has driven, laid on
// the road behind it. Together with the blue planned path ahead, it shows the
// car's full trajectory: past (fading white) and intended future (blue).

import * as THREE from "three";

const MAX = 120; // points retained
const HALF_W = 0.35;
const MIN_STEP = 0.6; // metres between retained points

export class TrailView {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private posBuf = new Float32Array(MAX * 2 * 3);
  private colBuf = new Float32Array(MAX * 2 * 3);
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private pts: { x: number; y: number }[] = [];
  private lastX = Infinity;
  private lastY = Infinity;
  private dirty = false;

  constructor() {
    this.posAttr = new THREE.BufferAttribute(this.posBuf, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colBuf, 3);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", this.posAttr);
    this.geo.setAttribute("color", this.colAttr);

    const indices: number[] = [];
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(indices);
    this.geo.setDrawRange(0, 0);

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  reset(): void {
    this.pts = [];
    this.lastX = Infinity;
    this.lastY = Infinity;
    this.dirty = true;
    this.geo.setDrawRange(0, 0);
  }

  update(egoX: number, egoY: number): void {
    const dist = Math.hypot(egoX - this.lastX, egoY - this.lastY);
    if (dist > 15 && Number.isFinite(this.lastX)) {
      this.reset();
    }
    if (Math.hypot(egoX - this.lastX, egoY - this.lastY) >= MIN_STEP) {
      this.pts.push({ x: egoX, y: egoY });
      if (this.pts.length > MAX) this.pts.shift();
      this.lastX = egoX;
      this.lastY = egoY;
      this.dirty = true;
    }

    const n = this.pts.length;
    if (n < 2) {
      this.mesh.visible = false;
      this.geo.setDrawRange(0, 0);
      return;
    }
    this.mesh.visible = true;
    if (!this.dirty) return;
    this.dirty = false;

    const pos = this.posBuf;
    const col = this.colBuf;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      const prev = this.pts[Math.max(0, i - 1)];
      const next = this.pts[Math.min(n - 1, i + 1)];
      let dx = next.x - prev.x;
      let dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const px = -dy * HALF_W;
      const py = dx * HALF_W;
      const o = i * 6;
      pos[o] = p.x + px;
      pos[o + 1] = 0.05;
      pos[o + 2] = p.y + py;
      pos[o + 3] = p.x - px;
      pos[o + 4] = 0.05;
      pos[o + 5] = p.y - py;

      const t = i / (n - 1);
      const c = 0.35 + 0.55 * t;
      const r = c * 0.75;
      const g = c * 0.85;
      col[o] = r;
      col[o + 1] = g;
      col[o + 2] = c;
      col[o + 3] = r;
      col[o + 4] = g;
      col[o + 5] = c;
    }

    this.geo.setDrawRange(0, (n - 1) * 6);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}
