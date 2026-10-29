// BuildingsView — a procedural city laid out on a GRID of blocks around the road
// loop. Buildings are placed on a regular lattice (axis-aligned, like real city
// blocks), skipping any cell that overlaps the road corridor. Façades are plain
// PBR boxes that pick up the scene environment; a second additive pass adds
// procedural windows (lit and unlit) tiled by building height band.

import * as THREE from "three";
import { Road } from "../world/Road.ts";

interface Slot {
  x: number;
  z: number;
  w: number;
  h: number;
  depth: number;
  color: THREE.Color;
}

const PALETTE = [0x3d4d63, 0x46566e, 0x4e5f78, 0x37475d, 0x5a6b84, 0x31415a, 0x53647c, 0x62748c];

/** Transparent window overlay: bright rectangles on a clear background. */
function windowTexture(columns: number, rows: number, litRatio: number): THREE.Texture {
  const cell = 16;
  const canvas = document.createElement("canvas");
  canvas.width = columns * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = column * cell + 4;
      const y = row * cell + 5;
      if (Math.random() < litRatio) {
        const warm = Math.random() < 0.66;
        ctx.fillStyle = warm ? "rgba(255, 214, 150, 0.92)" : "rgba(176, 214, 255, 0.88)";
        ctx.fillRect(x, y, cell - 8, cell - 10);
      } else {
        ctx.fillStyle = "rgba(40, 54, 74, 0.55)";
        ctx.fillRect(x, y, cell - 8, cell - 10);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export class BuildingsView {
  readonly group = new THREE.Group();

  constructor(road: Road) {
    const path = road.path;
    const rand = Math.random;

    // Coarse road points for a fast "is this cell on the road?" test.
    const roadPts: [number, number][] = [];
    for (let i = 0; i < path.count; i += 5) roadPts.push([path.xs[i], path.ys[i]]);
    const clearance = road.totalWidth / 2 + 13;
    const clr2 = clearance * clearance;

    const slots: Slot[] = [];
    const grid = 34;
    for (let x = -600; x <= 600; x += grid) {
      for (let z = -460; z <= 460; z += grid) {
        const bx = x + (rand() - 0.5) * 8;
        const bz = z + (rand() - 0.5) * 8;
        let onRoad = false;
        for (const [rx, rz] of roadPts) {
          const dx = bx - rx;
          const dz = bz - rz;
          if (dx * dx + dz * dz < clr2) {
            onRoad = true;
            break;
          }
        }
        if (onRoad) continue;
        if (rand() < 0.12) continue; // occasional empty lot / plaza
        const t = rand();
        slots.push({
          x: bx,
          z: bz,
          w: 14 + rand() * 12,
          depth: 14 + rand() * 12,
          h: 8 + t * t * t * 90,
          color: new THREE.Color(PALETTE[(rand() * PALETTE.length) | 0]),
        });
      }
    }

    this.buildBodies(slots);
    this.buildWindows(slots);
  }

  private buildBodies(slots: Slot[]): void {
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.72,
      metalness: 0.22,
      emissive: 0x0c1524,
      emissiveIntensity: 0.22,
    });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, slots.length);
    const dummy = new THREE.Object3D();
    slots.forEach((b, i) => {
      dummy.position.set(b.x, b.h / 2, b.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(b.w, b.h, b.depth);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, b.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
  }

  private buildWindows(slots: Slot[]): void {
    const bands: { minH: number; maxH: number; columns: number; rows: number; lit: number }[] = [
      { minH: 0, maxH: 22, columns: 3, rows: 5, lit: 0.42 },
      { minH: 22, maxH: 48, columns: 4, rows: 8, lit: 0.34 },
      { minH: 48, maxH: Infinity, columns: 5, rows: 12, lit: 0.3 },
    ];
    for (const band of bands) {
      const bucket = slots.filter((s) => s.h > band.minH && s.h <= band.maxH);
      if (bucket.length === 0) continue;
      const texture = windowTexture(band.columns, band.rows, band.lit);
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, bucket.length);
      mesh.renderOrder = 2;
      const dummy = new THREE.Object3D();
      bucket.forEach((b, i) => {
        dummy.position.set(b.x, b.h / 2, b.z);
        dummy.scale.set(b.w * 1.004, b.h * 0.995, b.depth * 1.004);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    }
  }
}
