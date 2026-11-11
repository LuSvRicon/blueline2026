// BuildingsView — a procedural city laid out on a GRID of blocks around the road
// loop. Buildings are placed on a regular lattice (axis-aligned, like real city
// blocks), skipping any cell that overlaps the road corridor. Façades are plain
// PBR boxes that pick up the scene environment; a second additive pass adds
// procedural windows (lit and unlit) tiled by building height band.

import * as THREE from "three";
import { Road } from "../world/Road.ts";
import {StaticWorld} from '../world/StaticWorld.ts';
import {Rng} from '../core/rng.ts';
import {addSpatialInstances} from './SpatialInstances.ts';

interface Slot {
  x: number;
  z: number;
  w: number;
  h: number;
  depth: number;
  color: THREE.Color;
  nearRoad: boolean;
}

const PALETTE = [0xb6afa2, 0x999e9e, 0xc8bba5, 0x8c9c9c, 0xb6b2a9, 0x818d98, 0xd1c9b9, 0xa8aaa3];

/** Transparent window overlay: bright rectangles on a clear background. */
function windowTexture(columns: number, rows: number, litRatio: number,night=false): THREE.Texture {
  const cell = 48;
  const canvas = document.createElement("canvas");
  canvas.width = columns * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = column * cell + 7,y = row * cell + 8,w=cell-14,h=cell-16;
      const seed=((column+13)*73856093^(row+9)*19349663)>>>0;
      const lit=(seed%100)/100<litRatio;
      if(night){ctx.fillStyle=lit?(seed%3?"#e6ba77":"#a5c6df"):"#000000";ctx.fillRect(x,y,w,h);continue;}
      ctx.fillStyle="#343d43";ctx.fillRect(x-2,y-2,w+4,h+5);
      const glass=ctx.createLinearGradient(x,y,x+w,y+h);
      glass.addColorStop(0,"#547286");glass.addColorStop(.48,seed%3?"#354c5a":"#627582");glass.addColorStop(1,"#253640");
      ctx.fillStyle=glass;ctx.fillRect(x,y,w,h);
      ctx.fillStyle="#8e9c9f";ctx.fillRect(x-2,y+h+1,w+4,2);
      ctx.fillStyle="#28363e";ctx.fillRect(x+w*.5,y,2,h);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export class BuildingsView {
  readonly group = new THREE.Group();
  private windowMaterials: THREE.MeshStandardMaterial[] = [];

  constructor(road: Road,world?:StaticWorld) {
    const path = road.path;
    const sceneryRng=new Rng(20261028);const rand = ()=>sceneryRng.next();

    // Coarse road points for a fast "is this cell on the road?" test.
    const roadPts: [number, number][] = [];
    for (let i = 0; i < path.count; i += 5) roadPts.push([path.xs[i], path.ys[i]]);
    const clearance = road.totalWidth / 2 + 55;
    const clr2 = clearance * clearance;

    const slots: Slot[] = [];
    const grid = 34;
    for (let x = -600; x <= 600; x += grid) {
      for (let z = -460; z <= 460; z += grid) {
        const bx = x + (rand() - 0.5) * 8;
        const bz = z + (rand() - 0.5) * 8;
        let onRoad = false;
        let minDist2 = Infinity;
        for (const [rx, rz] of roadPts) {
          const dx = bx - rx;
          const dz = bz - rz;
          const d2 = dx * dx + dz * dz;
          if (d2 < minDist2) minDist2 = d2;
          if (d2 < clr2) {
            onRoad = true;
            break;
          }
        }
        if (onRoad) continue;
        if(road.profile?.environment==='rural')continue;
        if (rand() < 0.12) continue; // occasional empty lot / plaza
        const t = rand();
        slots.push({
          x: bx,
          z: bz,
          w: 14 + rand() * 12,
          depth: 14 + rand() * 12,
          h: 8 + t * t * t * 90,
          color: new THREE.Color(PALETTE[(rand() * PALETTE.length) | 0]),
          nearRoad: minDist2 < 135 * 135,
        });
      }
    }

    this.buildBodies(slots);
    slots.forEach((b,i)=>world?.add({id:`building:${i}`,kind:'building',x:b.x,y:b.z,yaw:0,length:b.w,width:b.depth}));
    this.buildWindows(slots);
    this.buildDetails(slots);
  }

  setNight(night: boolean): void { for (const material of this.windowMaterials) {material.emissiveIntensity=night?.9:0;material.color.setHex(night?0x536274:0xffffff);} }

  private buildDetails(slots: Slot[]): void {
    // Shared instanced geometry keeps the extra architecture inexpensive.
    const transforms: THREE.Matrix4[] = [];
    const roofs: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    const add = (list: THREE.Matrix4[], x: number, y: number, z: number, w: number, h: number, d: number) => {
      dummy.position.set(x,y,z); dummy.scale.set(w,h,d); dummy.updateMatrix(); list.push(dummy.matrix.clone());
    };
    for (const b of slots) {
      add(roofs,b.x,b.h+.25,b.z,b.w+.6,.5,b.depth+.6);
      add(roofs,b.x,b.h+1,b.z,b.w*.32,1.1,b.depth*.3);
      if (!b.nearRoad) continue;
      // Recessed ground-floor glazing and projecting floor slabs for near-corridor buildings.
      add(transforms,b.x,1.7,b.z,b.w+ .08,2.8,b.depth+.08);
      for(let y=3.8;y<b.h;y+=7.6) add(roofs,b.x,y,b.z,b.w+.24,.16,b.depth+.24);
      for(const side of [-1,1]) {
        add(roofs,b.x+side*(b.w/2-.3),b.h/2,b.z,.42,b.h,b.depth+.2);
        add(roofs,b.x,b.h/2,b.z+side*(b.depth/2-.3),b.w+.2,b.h,.42);
      }
    }
    for(const [matrices,material] of [
      [transforms,new THREE.MeshStandardMaterial({color:0x34454e,metalness:.45,roughness:.28})],
      [roofs,new THREE.MeshStandardMaterial({color:0x92938d,roughness:.83})],
    ] as const) {
      if (!matrices.length) continue;
      addSpatialInstances(this.group,new THREE.BoxGeometry(1,1,1),material,matrices.map(matrix=>({matrix})),{receiveShadow:true});
    }
  }

  private buildBodies(slots: Slot[]): void {
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.72,
      metalness: 0.04,
    });
    const dummy = new THREE.Object3D();
    for (const [subset, castShadow] of [
      [slots.filter((s) => s.nearRoad), true],
      [slots.filter((s) => !s.nearRoad), false],
    ] as const) {
      if (!subset.length) continue;
      const instances = subset.map(b => {
        dummy.position.set(b.x, b.h / 2, b.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(b.w, b.h, b.depth);
        dummy.updateMatrix();
        return {matrix:dummy.matrix.clone(),color:b.color};
      });
      addSpatialInstances(this.group,new THREE.BoxGeometry(1,1,1),mat,instances,{castShadow,receiveShadow:true});
    }
  }

  private buildWindows(slots: Slot[]): void {
    const bands: { minH: number; maxH: number; columns: number; rows: number; lit: number }[] = [
      { minH: 0, maxH: 22, columns: 7, rows: 5, lit: 0.42 },
      { minH: 22, maxH: 48, columns: 9, rows: 10, lit: 0.34 },
      { minH: 48, maxH: Infinity, columns: 10, rows: 19, lit: 0.3 },
    ];
    for (const band of bands) {
      const bucket = slots.filter((s) => s.h > band.minH && s.h <= band.maxH);
      if (bucket.length === 0) continue;
      const texture = windowTexture(band.columns, band.rows, band.lit);
      const mat = new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap:windowTexture(band.columns,band.rows,band.lit,true),emissive:0xffffff,emissiveIntensity:.9,
        roughness:.3,metalness:.25,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.windowMaterials.push(mat);
      const dummy = new THREE.Object3D();
      const instances = bucket.map(b => {
        dummy.position.set(b.x, b.h / 2, b.z);
        dummy.scale.set(b.w * 1.004, b.h * 0.995, b.depth * 1.004);
        dummy.updateMatrix();
        return {matrix:dummy.matrix.clone()};
      });
      addSpatialInstances(this.group,new THREE.BoxGeometry(1,1,1),mat,instances,{renderOrder:2,receiveShadow:true});
    }
  }
}
