// RoadSignsView — procedural 3-D speed-limit signs placed before junctions.

import * as THREE from "three";
import { ReferencePath } from "../world/ReferencePath.ts";
import { RoadSign } from "../world/RoadSign.ts";

export class RoadSignsView {
  readonly group = new THREE.Group();

  constructor(path: ReferencePath, signs: RoadSign[], roadHalf: number) {
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x9ca6b2, metalness: 0.58, roughness: 0.38 });
    const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xe43835, roughness: 0.48 });
    const faceMaterial = new THREE.MeshStandardMaterial({ color: 0xf4f3ed, roughness: 0.62, side: THREE.DoubleSide });

    for (const sign of signs) {
      const roadPose = path.cartesianAt(sign.s);
      const position = path.toCartesian(sign.s, roadHalf + 2.2);
      const assembly = new THREE.Group();
      assembly.position.set(position.x, 0, position.y);
      assembly.rotation.y = Math.PI / 2 - roadPose.heading;

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 2.15, 10), poleMaterial);
      pole.position.y = 1.07;
      const rim = new THREE.Mesh(new THREE.CircleGeometry(0.52, 32), rimMaterial);
      rim.position.set(0, 1.9, 0.01);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.43, 32), faceMaterial);
      face.position.set(0, 1.9, 0.018);
      const number = new THREE.Mesh(
        new THREE.PlaneGeometry(0.74, 0.74),
        new THREE.MeshBasicMaterial({ map: speedTexture(sign.valueKph), transparent: true, side: THREE.DoubleSide }),
      );
      number.position.set(0, 1.9, 0.027);
      assembly.add(pole, rim, face, number);
      this.group.add(assembly);
    }
  }
}

function speedTexture(valueKph: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, 128, 128);
  context.fillStyle = "#20252b";
  context.font = "700 48px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(valueKph), 64, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
