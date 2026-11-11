// CandidatesView — draws every trajectory the Frenet planner evaluated this
// cycle as faint thin lines: greyish-blue for viable candidates, dim red for
// ones rejected due to a predicted collision. It turns the planner's internal
// search into something you can actually watch — a big part of why the demo
// reads as "real autonomy" rather than a scripted animation.

import * as THREE from "three";
import { Trajectory } from "../planner/Trajectory.ts";
import { THEME } from "./theme.ts";

const HEIGHT = 0.05;
const MAX_VERTICES = 2048;
const VIABLE_COLOR = new THREE.Color(THEME.candidate);
const COLLIDING_COLOR = new THREE.Color(THEME.candidateColliding);

export class CandidatesView {
  readonly lines: THREE.LineSegments;
  private geo = new THREE.BufferGeometry();
  private posBuf = new Float32Array(MAX_VERTICES * 3);
  private colBuf = new Float32Array(MAX_VERTICES * 3);
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  visible = true;

  constructor() {
    this.posAttr = new THREE.BufferAttribute(this.posBuf, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colBuf, 3);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", this.posAttr);
    this.geo.setAttribute("color", this.colAttr);
    this.geo.setDrawRange(0, 0);

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(this.geo, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.lines.visible = v;
  }

  update(candidates: Trajectory[], best: Trajectory | null): void {
    if (!this.visible || candidates.length === 0) {
      this.lines.visible = false;
      this.geo.setDrawRange(0, 0);
      return;
    }
    this.lines.visible = true;

    let vCount = 0;
    const pos = this.posBuf;
    const col = this.colBuf;

    for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
      const cand = candidates[cIdx];
      if (cand === best) continue; // the best one is drawn by PathRibbon
      const c = cand.colliding ? COLLIDING_COLOR : VIABLE_COLOR;
      const pts = cand.points;
      const segs = pts.length - 1;
      for (let i = 0; i < segs; i++) {
        if (vCount + 2 > MAX_VERTICES) break;
        const o = vCount * 3;
        const p0 = pts[i];
        const p1 = pts[i + 1];
        pos[o] = p0.x;
        pos[o + 1] = HEIGHT;
        pos[o + 2] = p0.y;
        pos[o + 3] = p1.x;
        pos[o + 4] = HEIGHT;
        pos[o + 5] = p1.y;
        col[o] = c.r;
        col[o + 1] = c.g;
        col[o + 2] = c.b;
        col[o + 3] = c.r;
        col[o + 4] = c.g;
        col[o + 5] = c.b;
        vCount += 2;
      }
    }

    this.geo.setDrawRange(0, vCount);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}
