// PedestrianView — renders pedestrians as simple upright figures, plus zebra
// crosswalk markings at signalised crossings. A crossing pedestrian glows amber
// (an alert colour) so it reads instantly; waiting ones stay a muted grey.

import * as THREE from "three";
import { Pedestrian } from "../pedestrian/PedestrianManager.ts";
import { ReferencePath } from "../world/ReferencePath.ts";
import type {RenderPose} from './RenderMotion.ts';

function makeFigure(): THREE.Group {
  const g = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color: 0x4a6681, roughness: .88 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc69b7b, roughness: .9 });
  const trousers = new THREE.MeshStandardMaterial({ color: 0x263444, roughness: .92 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0x242326, roughness: .8 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.19, .32, 4, 10), coat); torso.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.13, 12, 10), skin); head.position.set(0,1.61,0);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(.135, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), shoe); hair.position.copy(head.position);
  const limbs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(0,.78,side*.115);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(.068,.56,3,8), trousers); shin.position.y = -.35;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(.23,.085,.115), shoe); foot.position.set(.045,-.72,0);
    leg.add(shin,foot); g.add(leg); limbs.push(leg);
    const arm = new THREE.Group(); arm.position.set(0,1.34,side*.235);
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(.055,.32,3,8), coat); sleeve.position.y=-.2;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(.058,8,6),skin); hand.position.y=-.45;
    arm.add(sleeve,hand); g.add(arm); limbs.push(arm);
  }
  g.add(torso,head,hair);
  g.userData.limbs = limbs; g.userData.coat = coat;
  return g;
}

export class PedestrianView {
  readonly group = new THREE.Group();
  private figures: THREE.Group[] = [];
  private crosswalks = new THREE.Group();
  private crosswalkKey = "";

  constructor(private path: ReferencePath) {
    this.group.add(this.crosswalks);
  }

  update(peds: Pedestrian[],motion?:Map<number,RenderPose>): void {
    const active = peds.filter((p) => p.state !== "done");

    // Grow/shrink the figure pool.
    while (this.figures.length < active.length) {
      const f = makeFigure();
      this.figures.push(f);
      this.group.add(f);
    }
    for (let i = active.length; i < this.figures.length; i++) this.figures[i].visible = false;

    for (let i = 0; i < active.length; i++) {
      const p = active[i];
      const f = this.figures[i];
      f.visible = true;
      const visual=motion?.get(p.id),w = visual??this.path.toCartesian(p.s, p.d);
      f.position.set(w.x, 0, w.y);
      f.rotation.y = -(visual?.yaw??(this.path.cartesianAt(p.s).heading + Math.sign(p.toD - p.fromD) * Math.PI / 2));
      const walking = p.state === "crossing" && !p.collided && !p.yielding;
      const phase = ((visual?.d??p.d) - p.fromD) / .62 * Math.PI;
      const swing = walking ? Math.sin(phase) * .42 : 0;
      const limbs = f.userData.limbs as THREE.Group[];
      limbs[0].rotation.z = swing; limbs[2].rotation.z = -swing;
      limbs[1].rotation.z = -swing * .7; limbs[3].rotation.z = swing * .7;
      f.position.y = walking ? Math.abs(Math.sin(phase)) * .022 : 0;
      const palette = [0x4a6681,0x85765f,0x6c3e42,0x54715a,0xb6bec5];
      (f.userData.coat as THREE.MeshStandardMaterial).color.setHex(palette[p.id % palette.length]);
    }

    // Rebuild crosswalk markings only when the crossing set changes. Jaywalkers
    // (triggered crossings) get no crosswalk — that's the whole point.
    const key = peds
      .filter((p) => p.triggerDist === 0)
      .map((p) => p.s.toFixed(0))
      .join(",");
    if (key !== this.crosswalkKey) {
      this.crosswalkKey = key;
      this.rebuildCrosswalks(peds.filter((p) => p.triggerDist === 0));
    }
  }

  private rebuildCrosswalks(peds: Pedestrian[]): void {
    this.crosswalks.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
    this.crosswalks.clear();
    for (const p of peds) {
      const positions: number[] = [];
      const halfW = Math.max(Math.abs(p.fromD), Math.abs(p.toD));
      for (let k = -3; k <= 3; k++) {
        const sc = p.s + k * 1.3;
        const a = this.path.toCartesian(sc - 0.32, -halfW);
        const b = this.path.toCartesian(sc - 0.32, halfW);
        const c = this.path.toCartesian(sc + 0.32, halfW);
        const d = this.path.toCartesian(sc + 0.32, -halfW);
        const y = 0.055;
        positions.push(a.x, y, a.y, b.x, y, b.y, c.x, y, c.y);
        positions.push(a.x, y, a.y, c.x, y, c.y, d.x, y, d.y);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.MeshBasicMaterial({
        color: 0xdfe6f0,
        transparent: true,
        opacity: 0.5,
        toneMapped: false,
      });
      this.crosswalks.add(new THREE.Mesh(geo, mat));
    }
  }
}
