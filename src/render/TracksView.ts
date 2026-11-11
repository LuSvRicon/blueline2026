// TracksView — draws the ego's *perception*: for every confirmed Kalman track,
// a 3D volumetric bounding cage + footprint oriented along its estimated
// velocity, plus a velocity vector arrow. This is the "what the car thinks is
// around it" overlay — on-screen proof that the ego runs on tracked estimates.

import * as THREE from "three";
import { Track } from "../perception/Tracker.ts";

const H_BOT = 0.14;
const H_TOP = 1.48;
const MAX_VERTICES = 2048;

export class TracksView {
  readonly object: THREE.LineSegments;
  private geo = new THREE.BufferGeometry();
  private posBuf = new Float32Array(MAX_VERTICES * 3);
  private posAttr: THREE.BufferAttribute;

  constructor() {
    this.posAttr = new THREE.BufferAttribute(this.posBuf, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", this.posAttr);
    this.geo.setDrawRange(0, 0);

    const mat = new THREE.LineBasicMaterial({
      color: 0x38ef9d,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      toneMapped: false,
    });
    this.object = new THREE.LineSegments(this.geo, mat);
    this.object.frustumCulled = false;
    this.object.renderOrder = 6;
  }

  update(tracks: Track[]): void {
    if (!this.object.visible || tracks.length === 0) {
      this.geo.setDrawRange(0, 0);
      return;
    }

    const pos = this.posBuf;
    let vCount = 0;

    const pushEdge3D = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      if (vCount + 2 > MAX_VERTICES) return;
      const o = vCount * 3;
      pos[o] = ax;
      pos[o + 1] = ay;
      pos[o + 2] = az;
      pos[o + 3] = bx;
      pos[o + 4] = by;
      pos[o + 5] = bz;
      vCount += 2;
    };

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const speed = Math.hypot(t.vx, t.vy);
      const heading = speed > 1 ? Math.atan2(t.vy, t.vx) : 0;
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);
      const hl = t.length / 2;
      const hw = t.width / 2;
      const hTop = t.length > 7 ? 2.45 : t.length < 2.4 ? 1.25 : H_TOP;

      const c1x = t.px + hl * cos - hw * sin;
      const c1z = t.py + hl * sin + hw * cos;
      const c2x = t.px + hl * cos + hw * sin;
      const c2z = t.py + hl * sin - hw * cos;
      const c3x = t.px - hl * cos + hw * sin;
      const c3z = t.py - hl * sin - hw * cos;
      const c4x = t.px - hl * cos - hw * sin;
      const c4z = t.py - hl * sin + hw * cos;

      // Ground footprint
      pushEdge3D(c1x, H_BOT, c1z, c2x, H_BOT, c2z);
      pushEdge3D(c2x, H_BOT, c2z, c3x, H_BOT, c3z);
      pushEdge3D(c3x, H_BOT, c3z, c4x, H_BOT, c4z);
      pushEdge3D(c4x, H_BOT, c4z, c1x, H_BOT, c1z);

      // 3D Roof frame & vertical pillars
      pushEdge3D(c1x, hTop, c1z, c2x, hTop, c2z);
      pushEdge3D(c2x, hTop, c2z, c3x, hTop, c3z);
      pushEdge3D(c3x, hTop, c3z, c4x, hTop, c4z);
      pushEdge3D(c4x, hTop, c4z, c1x, hTop, c1z);

      pushEdge3D(c1x, H_BOT, c1z, c1x, hTop, c1z);
      pushEdge3D(c2x, H_BOT, c2z, c2x, hTop, c2z);
      pushEdge3D(c3x, H_BOT, c3z, c3x, hTop, c3z);
      pushEdge3D(c4x, H_BOT, c4z, c4x, hTop, c4z);

      // Velocity arrow.
      if (speed > 1) {
        const len = Math.min(speed * 0.4, 12);
        const tipX = t.px + cos * (hl + len);
        const tipY = t.py + sin * (hl + len);
        pushEdge3D(t.px, H_BOT, t.py, tipX, H_BOT, tipY);
        const ah = 0.7;
        pushEdge3D(tipX, H_BOT, tipY, tipX - cos * ah - sin * ah, H_BOT, tipY - sin * ah + cos * ah);
        pushEdge3D(tipX, H_BOT, tipY, tipX - cos * ah + sin * ah, H_BOT, tipY - sin * ah - cos * ah);
      }
    }

    this.geo.setDrawRange(0, vCount);
    this.posAttr.needsUpdate = true;
  }
}
