// ARHudView — World-space 3D Augmented Reality Head-Up Display (Tesla FSD +
// Mercedes MBUX style). Projects a zero-allocation 60 FPS AR overlay onto the
// 3D roadway:
//   1. Dynamic AR Lane Corridor Rails (adapts to LFA, ALC lane change, LDW, AEB)
//   2. Animated MBUX/FSD Speed & Lane-Change Chevrons along the road curvature
//   3. 3D Volumetric Target Lock Cage + Translucent Headway Stop Wall behind
//      the tracked lead / FCW / AEB vehicle
//   4. 3D Blind-Spot (BSM / BCA) & Rear Cross-Traffic (RCTA) ground hazard zones

import * as THREE from "three";
import { Simulation } from "../sim/Simulation.ts";
import { clamp, wrapDiff } from "../core/math.ts";
import type { RenderPose } from "./RenderMotion.ts";

const MAX_LINE_VERTICES = 1024;
const MAX_TRI_VERTICES = 512;

// Pre-allocated palette colors (RGB tuples) to avoid per-frame allocations
const COL_CYAN: [number, number, number] = [0.22, 0.78, 0.98];
const COL_EMERALD: [number, number, number] = [0.2, 0.9, 0.62];
const COL_AMBER: [number, number, number] = [1.0, 0.76, 0.16];
const COL_CRIMSON: [number, number, number] = [1.0, 0.28, 0.28];

export class ARHudView {
  readonly group = new THREE.Group();
  private lines: THREE.LineSegments;
  private meshes: THREE.Mesh;
  private lineGeo = new THREE.BufferGeometry();
  private meshGeo = new THREE.BufferGeometry();
  private linePos = new Float32Array(MAX_LINE_VERTICES * 3);
  private lineCol = new Float32Array(MAX_LINE_VERTICES * 3);
  private meshPos = new Float32Array(MAX_TRI_VERTICES * 3);
  private meshCol = new Float32Array(MAX_TRI_VERTICES * 3);
  private linePosAttr: THREE.BufferAttribute;
  private lineColAttr: THREE.BufferAttribute;
  private meshPosAttr: THREE.BufferAttribute;
  private meshColAttr: THREE.BufferAttribute;
  private lineMat: THREE.LineBasicMaterial;
  private meshMat: THREE.MeshBasicMaterial;
  private lineVertexCount = 0;
  private meshVertexCount = 0;
  private phase = 0;

  constructor() {
    this.group.name = "ARHud3D";

    this.linePosAttr = new THREE.BufferAttribute(this.linePos, 3);
    this.linePosAttr.setUsage(THREE.DynamicDrawUsage);
    this.lineColAttr = new THREE.BufferAttribute(this.lineCol, 3);
    this.lineColAttr.setUsage(THREE.DynamicDrawUsage);
    this.lineGeo.setAttribute("position", this.linePosAttr);
    this.lineGeo.setAttribute("color", this.lineColAttr);
    this.lineGeo.setDrawRange(0, 0);

    this.lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.lines = new THREE.LineSegments(this.lineGeo, this.lineMat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 6;

    this.meshPosAttr = new THREE.BufferAttribute(this.meshPos, 3);
    this.meshPosAttr.setUsage(THREE.DynamicDrawUsage);
    this.meshColAttr = new THREE.BufferAttribute(this.meshCol, 3);
    this.meshColAttr.setUsage(THREE.DynamicDrawUsage);
    this.meshGeo.setAttribute("position", this.meshPosAttr);
    this.meshGeo.setAttribute("color", this.meshColAttr);
    this.meshGeo.setDrawRange(0, 0);

    this.meshMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.meshes = new THREE.Mesh(this.meshGeo, this.meshMat);
    this.meshes.frustumCulled = false;
    this.meshes.renderOrder = 5;

    this.group.add(this.meshes, this.lines);
  }

  private addLine(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    c: [number, number, number],
    intensity = 1,
  ): void {
    if (this.lineVertexCount + 2 > MAX_LINE_VERTICES) return;
    const o = this.lineVertexCount * 3;
    const pos = this.linePos;
    const col = this.lineCol;
    pos[o] = ax;
    pos[o + 1] = ay;
    pos[o + 2] = az;
    pos[o + 3] = bx;
    pos[o + 4] = by;
    pos[o + 5] = bz;
    const r = c[0] * intensity;
    const g = c[1] * intensity;
    const b = c[2] * intensity;
    col[o] = r;
    col[o + 1] = g;
    col[o + 2] = b;
    col[o + 3] = r;
    col[o + 4] = g;
    col[o + 5] = b;
    this.lineVertexCount += 2;
  }

  private addQuad(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    dx: number,
    dy: number,
    dz: number,
    colA: [number, number, number],
    intA: number,
    colB: [number, number, number] = colA,
    intB: number = intA,
  ): void {
    if (this.meshVertexCount + 6 > MAX_TRI_VERTICES) return;
    const o = this.meshVertexCount * 3;
    const p = this.meshPos;
    const c = this.meshCol;

    // Triangle 1: A - B - C
    p[o] = ax; p[o + 1] = ay; p[o + 2] = az;
    p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz;
    p[o + 6] = cx; p[o + 7] = cy; p[o + 8] = cz;
    // Triangle 2: A - C - D
    p[o + 9] = ax; p[o + 10] = ay; p[o + 11] = az;
    p[o + 12] = cx; p[o + 13] = cy; p[o + 14] = cz;
    p[o + 15] = dx; p[o + 16] = dy; p[o + 17] = dz;

    const rA = colA[0] * intA, gA = colA[1] * intA, bA = colA[2] * intA;
    const rB = colB[0] * intB, gB = colB[1] * intB, bB = colB[2] * intB;

    c[o] = rA; c[o + 1] = gA; c[o + 2] = bA;
    c[o + 3] = rA; c[o + 4] = gA; c[o + 5] = bA;
    c[o + 6] = rB; c[o + 7] = gB; c[o + 8] = bB;

    c[o + 9] = rA; c[o + 10] = gA; c[o + 11] = bA;
    c[o + 12] = rB; c[o + 13] = gB; c[o + 14] = bB;
    c[o + 15] = rB; c[o + 16] = gB; c[o + 17] = bB;

    this.meshVertexCount += 6;
  }

  update(sim: Simulation, dt: number, cockpitView: boolean, egoPose?: RenderPose): void {
    if (!this.group.visible) return;
    this.lineVertexCount = 0;
    this.meshVertexCount = 0;

    const ego = egoPose ?? sim.ego;
    const f = sim.path.toFrenet(ego.x, ego.y);
    const status = sim.adas.status;
    const isAdasOrAi = sim.controlMode !== "manual" || status.active;

    this.lineMat.opacity = cockpitView ? 0.68 : 0.9;
    this.meshMat.opacity = cockpitView ? 0.28 : 0.42;

    if (!sim.paused) {
      this.phase = (this.phase + clamp(Math.abs(sim.ego.v) * 0.38, 1.2, 7.5) * clamp(dt, 0, 0.1)) % 1;
    }
    const pulse = 0.72 + 0.28 * Math.sin(sim.metrics.time * 9);

    // ---- 1. Find primary forward target in lane corridor -------------------
    const laneIdx = sim.road.laneOf(f.d);
    const laneCenterD = sim.road.laneCenter(laneIdx);
    const halfLane = sim.road.laneWidth * 0.44;
    let leadCar: (typeof sim.traffic.cars)[number] | null = null;
    let minAhead = 68;

    for (let i = 0; i < sim.traffic.cars.length; i++) {
      const c = sim.traffic.cars[i];
      const ds = wrapDiff(f.s, c.s, sim.path.length);
      if (ds > 1.5 && ds < minAhead && Math.abs(c.d - f.d) < sim.road.laneWidth * 0.85) {
        minAhead = ds;
        leadCar = c;
      }
    }

    // ---- 2. AR Lane Corridor Rails & MBUX Chevrons -------------------------
    if (isAdasOrAi && sim.gear !== "R") {
      const aebActive = status.aeb || status.aebHolding;
      const warnActive = status.fcw || status.laneDeparture !== "none" || status.alc === "active" || status.trafficLightStopping;
      const railColor = aebActive ? COL_CRIMSON : warnActive ? COL_AMBER : status.laneCenteringActive ? COL_EMERALD : COL_CYAN;

      const startOffset = cockpitView ? 6.2 : 3.2;
      const maxHorizon = leadCar ? Math.max(startOffset + 4, minAhead - leadCar.length * 0.55 - 1.2) : 44;
      const alcShift = status.alc === "active" ? (sim.indicator < 0 ? -sim.road.laneWidth : sim.indicator > 0 ? sim.road.laneWidth : 0) : 0;

      const steps = 14;
      const stepDist = (maxHorizon - startOffset) / steps;
      const yRail = 0.055;

      for (let i = 0; i < steps; i++) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const s0 = f.s + startOffset + i * stepDist;
        const s1 = s0 + stepDist;
        // Smooth S-curve lateral blend during ALC
        const blend0 = t0 * t0 * (3 - 2 * t0);
        const blend1 = t1 * t1 * (3 - 2 * t1);
        const dCenter0 = laneCenterD + alcShift * blend0;
        const dCenter1 = laneCenterD + alcShift * blend1;

        const fade0 = (1 - t0 * 0.72) * (aebActive ? pulse : 0.85);
        const fade1 = (1 - t1 * 0.72) * (aebActive ? pulse : 0.85);

        const l0 = sim.path.toCartesian(s0, dCenter0 - halfLane);
        const l1 = sim.path.toCartesian(s1, dCenter1 - halfLane);
        const r0 = sim.path.toCartesian(s0, dCenter0 + halfLane);
        const r1 = sim.path.toCartesian(s1, dCenter1 + halfLane);

        this.addLine(l0.x, yRail, l0.y, l1.x, yRail, l1.y, railColor, fade0);
        this.addLine(r0.x, yRail, r0.y, r1.x, yRail, r1.y, railColor, fade0);

        // Soft glowing lane carpet ribbon
        const carpetL0 = sim.path.toCartesian(s0, dCenter0 - halfLane * 0.92);
        const carpetR0 = sim.path.toCartesian(s0, dCenter0 + halfLane * 0.92);
        const carpetR1 = sim.path.toCartesian(s1, dCenter1 + halfLane * 0.92);
        const carpetL1 = sim.path.toCartesian(s1, dCenter1 - halfLane * 0.92);
        this.addQuad(
          carpetL0.x, 0.038, carpetL0.y,
          carpetR0.x, 0.038, carpetR0.y,
          carpetR1.x, 0.038, carpetR1.y,
          carpetL1.x, 0.038, carpetL1.y,
          railColor, fade0 * 0.35,
          railColor, fade1 * 0.35,
        );
      }

      // Animated MBUX / FSD Chevrons (>>>) gliding along the corridor
      const chevronSpacing = 6.5;
      const chevronCount = Math.min(6, Math.floor((maxHorizon - startOffset) / chevronSpacing));
      const yChev = 0.068;
      for (let k = 0; k < chevronCount; k++) {
        const dist = startOffset + ((k + this.phase) * chevronSpacing);
        if (dist >= maxHorizon - 1.5) continue;
        const t = clamp((dist - startOffset) / Math.max(1, maxHorizon - startOffset), 0, 1);
        const blend = t * t * (3 - 2 * t);
        const dCenter = laneCenterD + alcShift * blend;
        const sTip = f.s + dist + 1.15;
        const sTail = f.s + dist;
        const tip = sim.path.toCartesian(sTip, dCenter);
        const leftWing = sim.path.toCartesian(sTail, dCenter - halfLane * 0.52);
        const rightWing = sim.path.toCartesian(sTail, dCenter + halfLane * 0.52);
        const intensity = Math.sin(t * Math.PI) * 1.15;

        this.addLine(leftWing.x, yChev, leftWing.y, tip.x, yChev, tip.y, railColor, intensity);
        this.addLine(rightWing.x, yChev, rightWing.y, tip.x, yChev, tip.y, railColor, intensity);
      }
    }

    // ---- 3. 3D Target Lock Cage & Headway Stop Wall on Lead Vehicle --------
    if (leadCar && (isAdasOrAi || status.fcw || status.aeb)) {
      const targetColor = status.aeb
        ? COL_CRIMSON
        : status.fcw || minAhead < Math.max(8, sim.ego.v * 0.9)
          ? COL_AMBER
          : COL_EMERALD;
      const boost = status.aeb ? 1.25 * pulse : status.fcw ? 1.1 * pulse : 0.95;

      const wPos = sim.path.toCartesian(leadCar.s, leadCar.d);
      const heading = wPos.heading + (leadCar.headingOffset ?? 0);
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);
      const hl = leadCar.length * 0.5 + 0.28;
      const hw = leadCar.width * 0.5 + 0.22;
      const yBot = 0.1;
      const yTop = leadCar.kind === "truck" || leadCar.kind === "bus" ? 2.6 : 1.52;
      const tickL = Math.min(1.05, hl * 0.45);
      const tickW = Math.min(0.65, hw * 0.52);

      const toWorld = (lx: number, lz: number): [number, number] => [
        wPos.x + lx * cos - lz * sin,
        wPos.y + lx * sin + lz * cos,
      ];

      // 4 3D Corner Lock Brackets (bottom + top + vertical corner risers)
      for (const sx of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) {
          const [cx, cz] = toWorld(sx * hl, sz * hw);
          const [ax, az] = toWorld(sx * (hl - tickL), sz * hw);
          const [bx, bz] = toWorld(sx * hl, sz * (hw - tickW));
          // Bottom corner bracket
          this.addLine(cx, yBot, cz, ax, yBot, az, targetColor, boost);
          this.addLine(cx, yBot, cz, bx, yBot, bz, targetColor, boost);
          // Top corner bracket
          this.addLine(cx, yTop, cz, ax, yTop, az, targetColor, boost * 0.85);
          this.addLine(cx, yTop, cz, bx, yTop, bz, targetColor, boost * 0.85);
          // Vertical corner lock ticks
          this.addLine(cx, yBot, cz, cx, yBot + 0.45, cz, targetColor, boost);
          this.addLine(cx, yTop, cz, cx, yTop - 0.38, cz, targetColor, boost * 0.85);
        }
      }

      // Translucent 3D Headway Stop Wall right behind the target's rear bumper
      const wallS = leadCar.s - leadCar.length * 0.5 - 0.65;
      const wallL = sim.path.toCartesian(wallS, leadCar.d - halfLane * 0.95);
      const wallR = sim.path.toCartesian(wallS, leadCar.d + halfLane * 0.95);
      const wallH = status.aeb ? 1.05 : status.fcw ? 0.82 : 0.55;

      this.addLine(wallL.x, 0.08, wallL.y, wallR.x, 0.08, wallR.y, targetColor, boost * 1.2);
      this.addLine(wallL.x, wallH, wallL.y, wallR.x, wallH, wallR.y, targetColor, boost * 0.7);
      this.addLine(wallL.x, 0.08, wallL.y, wallL.x, wallH, wallL.y, targetColor, boost);
      this.addLine(wallR.x, 0.08, wallR.y, wallR.x, wallH, wallR.y, targetColor, boost);
      this.addQuad(
        wallL.x, 0.08, wallL.y,
        wallR.x, 0.08, wallR.y,
        wallR.x, wallH, wallR.y,
        wallL.x, wallH, wallL.y,
        targetColor, boost * 0.9,
        targetColor, 0.04,
      );
    }

    // ---- 4. Blind-Spot (BSM / BCA) 3D Ground Hazard Zones ------------------
    for (const [side, active] of [
      [-1, status.blindSpotLeft || status.extra.safeExitLeft],
      [1, status.blindSpotRight || status.extra.safeExitRight],
    ] as const) {
      if (!active) continue;
      const bsmDanger = status.extra.blindSpotIntervention || (side < 0 && sim.indicator < 0) || (side > 0 && sim.indicator > 0);
      const bsmCol = bsmDanger ? COL_CRIMSON : COL_AMBER;
      const dZone = f.d + side * sim.road.laneWidth;
      const sFront = f.s + 0.8;
      const sRear = f.s - 6.2;
      const zHalfW = sim.road.laneWidth * 0.38;
      const fl = sim.path.toCartesian(sFront, dZone - zHalfW);
      const fr = sim.path.toCartesian(sFront, dZone + zHalfW);
      const rr = sim.path.toCartesian(sRear, dZone + zHalfW);
      const rl = sim.path.toCartesian(sRear, dZone - zHalfW);
      const yBsm = 0.07;
      const bsmBoost = bsmDanger ? 1.2 * pulse : 0.85;

      this.addLine(fl.x, yBsm, fl.y, fr.x, yBsm, fr.y, bsmCol, bsmBoost);
      this.addLine(fr.x, yBsm, fr.y, rr.x, yBsm, rr.y, bsmCol, bsmBoost);
      this.addLine(rr.x, yBsm, rr.y, rl.x, yBsm, rl.y, bsmCol, bsmBoost);
      this.addLine(rl.x, yBsm, rl.y, fl.x, yBsm, fl.y, bsmCol, bsmBoost);
      this.addQuad(
        fl.x, 0.045, fl.y,
        fr.x, 0.045, fr.y,
        rr.x, 0.045, rr.y,
        rl.x, 0.045, rl.y,
        bsmCol, bsmBoost * 0.55,
        bsmCol, bsmBoost * 0.25,
      );
    }

    this.lineGeo.setDrawRange(0, this.lineVertexCount);
    this.linePosAttr.needsUpdate = true;
    this.lineColAttr.needsUpdate = true;

    this.meshGeo.setDrawRange(0, this.meshVertexCount);
    this.meshPosAttr.needsUpdate = true;
    this.meshColAttr.needsUpdate = true;
  }
}
