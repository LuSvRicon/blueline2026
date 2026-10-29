// RoadView — builds the static road environment from the ReferencePath:
// the asphalt surface, soft shoulders framing it, solid edge lines, dashed lane
// dividers, and a run of glowing roadside delineator posts that give the scene
// depth and a clear sense of the road sweeping away into the night.

import * as THREE from "three";
import { ReferencePath } from "../world/ReferencePath.ts";
import { Road } from "../world/Road.ts";
import { THEME } from "./theme.ts";
import {requestWorldAsset,worldAsset} from './WorldAssets.ts';

export class RoadView {
  readonly group = new THREE.Group();
  private asphaltMaterial: THREE.MeshStandardMaterial;
  private markerMaterials: THREE.MeshStandardMaterial[] = [];

  constructor(road: Road) {
    const path = road.path;
    const halfW = road.totalWidth / 2;

    // Helper for flat, unlit, always-visible road paint (DoubleSide defeats any
    // back-face culling; toneMapped:false keeps the true colour under ACES).
    const flat = (color: number) =>
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false });

    // Soft shoulders just outside the road, to frame the asphalt.
    for (const sign of [-1, 1]) {
      const shoulder = ribbon(path, sign * (halfW + 1.3), 1.4, 0.015, false);
      this.group.add(new THREE.Mesh(shoulder, flat(THEME.shoulder)));
    }

    // Upward-facing asphalt receives scene/headlamp lighting; a small repeating
    // grain supplies surface detail without downloading texture assets.
    const asphalt = ribbon(path, 0, halfW, 0.02, false);
    const textureSize = 256;
    const data = new Uint8Array(textureSize * textureSize * 4);
    let seed = 173;
    for (let i = 0; i < textureSize * textureSize; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const x = i % textureSize, y = Math.floor(i / textureSize);
      const weathering = Math.sin(x * .035) * Math.sin(y * .049) * 4;
      const value = 90 + seed % 35 + weathering;
      data.set([value, value + 1, value + 2, 255], i * 4);
    }
    const texture = new THREE.DataTexture(data, textureSize, textureSize);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.needsUpdate = true;
    texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter; texture.anisotropy = 8;
    this.asphaltMaterial = new THREE.MeshStandardMaterial({ color: 0x70757a, map: texture, roughness: .95, metalness: .03, bumpMap: texture, bumpScale: .012 });
    const surface=new THREE.Mesh(asphalt,this.asphaltMaterial);surface.receiveShadow=true;this.group.add(surface);
    void requestWorldAsset('roads_pbr').then(()=>{
      const source=worldAsset('roads_pbr');if(!source)return;
      source.traverse(o=>{if(!(o instanceof THREE.Mesh)||o.name!=='Road01_Road_0')return;
        const material=o.material as THREE.MeshStandardMaterial;
        for(const key of ['map','normalMap','roughnessMap','metalnessMap'] as const){const original=material[key];if(!original)continue;const map=original.clone();map.wrapS=map.wrapT=THREE.RepeatWrapping;map.anisotropy=8;map.needsUpdate=true;this.asphaltMaterial[key]=map;}
        this.asphaltMaterial.color.setHex(0xb0b2b4);this.asphaltMaterial.bumpMap=null;this.asphaltMaterial.normalScale.set(.4,.4);this.asphaltMaterial.needsUpdate=true;
      });
    });
    for (const side of [-1, 1]) {
      this.group.add(new THREE.Mesh(ribbon(path, side * (halfW + 2.15), 1.25, .13, false), new THREE.MeshStandardMaterial({ color: 0x9b9b93, roughness: .96 })));
      this.group.add(new THREE.Mesh(ribbon(path, side * (halfW + .78), .12, .14, false), new THREE.MeshStandardMaterial({ color: 0xc4c7c3, roughness: .9 })));
    }

    // Solid outer edge lines — bright, clearly wider so the road edge is obvious.
    for (const sign of [-1, 1]) {
      const edge = ribbon(path, sign * halfW, 0.24, 0.05, false);
      this.group.add(new THREE.Mesh(edge, flat(0xe7ebef)));
    }

    // Dashed interior lane dividers — crisp white, evenly spaced.
    for (let i = 0; i < road.numLanes - 1; i++) {
      const dOff = road.laneCenter(i) + road.laneWidth / 2;
      const divider = ribbon(path, dOff, 0.18, 0.06, true, 6.0, 5.0);
      this.group.add(new THREE.Mesh(divider, flat(0xdde3ea)));
    }
    if(road.opposingLanes){
      for(let i=0;i<road.opposingLanes-1;i++)this.group.add(new THREE.Mesh(ribbon(path,road.oncomingCenter(i)+road.laneWidth/2,.08,.065,true,4,5),flat(0xe0e4e6)));
      for(const side of [-1,1])this.group.add(new THREE.Mesh(ribbon(path,road.centerDivider+side*(road.median/2+.12),.07,.07,false),flat(road.median?0xe1e2dd:0xe8b74c)));
      if(road.median){
        const median=new THREE.Mesh(ribbon(path,road.centerDivider,road.median/2,.25,false),new THREE.MeshStandardMaterial({color:0x777e75,roughness:.94}));median.receiveShadow=true;this.group.add(median);
      }
    }
    if(road.profile?.motorway){
      const rail=new THREE.MeshStandardMaterial({color:0x8d999d,metalness:.65,roughness:.5});
      for(const side of [-1,1])this.group.add(new THREE.Mesh(ribbon(path,side*(halfW+1.0),.1,.75,false),rail));
    }

    // Glowing roadside delineator posts (blue on the left, amber on the right).
    this.group.add(this.delineators(path, halfW + 3.7, 0xd3e5df));
    this.group.add(this.delineators(path, -(halfW + 3.7), 0xe0c591));
  }

  setWeather(weather: "clear" | "rain" | "fog"): void {
    this.asphaltMaterial.roughness = weather === "rain" ? .34 : .95;
    this.asphaltMaterial.color.setHex(weather === "rain" ? 0x535e67 : 0x70757a);
  }

  setNight(night: boolean): void { for (const material of this.markerMaterials) material.emissiveIntensity = night ? .8 : .025; }

  private delineators(path: ReferencePath, dOff: number, color: number): THREE.InstancedMesh {
    const spacing = 20; // metres between posts
    const count = Math.max(1, Math.floor(path.length / spacing));
    const geo = new THREE.BoxGeometry(0.16, 1.1, 0.16);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.3,
      roughness: 0.5,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    this.markerMaterials.push(mat);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const s = i * spacing;
      const p = path.toCartesian(s, dOff);
      dummy.position.set(p.x, 0.55, p.y);
      dummy.rotation.y = -p.heading;
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }
}

/**
 * Build a flat ribbon centred at lateral offset `dCenter`, `halfWidth` to each
 * side, laid at height `y`. If `dashed`, only segments whose arc-length falls in
 * the "on" part of a dash/gap cycle are emitted.
 */
export function ribbon(
  path: ReferencePath,
  dCenter: number,
  halfWidth: number,
  y: number,
  dashed: boolean,
  dashLen = 3,
  gapLen = 4,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const n = path.count;
  const period = dashLen + gapLen;

  const offsetPoint = (i: number, lat: number): [number, number] => {
    const h = path.headings[i];
    const nx = -Math.sin(h);
    const ny = Math.cos(h);
    return [path.xs[i] + nx * lat, path.ys[i] + ny * lat];
  };

  for (let i = 0; i < n; i++) {
    const ni = (i + 1) % n;
    if (dashed) {
      const on = path.ss[i] % period < dashLen;
      if (!on) continue;
    }
    const [lix, liy] = offsetPoint(i, dCenter + halfWidth);
    const [rix, riy] = offsetPoint(i, dCenter - halfWidth);
    const [lnx, lny] = offsetPoint(ni, dCenter + halfWidth);
    const [rnx, rny] = offsetPoint(ni, dCenter - halfWidth);

    // Two triangles (world mapping: sim x -> x, sim y -> z).
    positions.push(lix, y, liy, lnx, y, lny, rix, y, riy);
    positions.push(rix, y, riy, lnx, y, lny, rnx, y, rny);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const uv: number[] = [];
  for (let i = 0; i < positions.length; i += 3) uv.push(positions[i] / 2, positions[i + 2] / 2);
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}
