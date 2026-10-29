import * as THREE from "three";
import type { Simulation } from "../sim/Simulation.ts";

/** Marked training bays and the planned parking path, from live planner data. */
export class ParkingView {
  readonly group = new THREE.Group();
  private baysKey = "";
  private routeKey: unknown = null;
  private bays = new THREE.Group();
  private route = new THREE.Group();
  constructor(private sim: Simulation) { this.group.add(this.bays, this.route); }
  update(): void {
    const key = JSON.stringify(this.sim.parkingBays);
    if (key !== this.baysKey) {
      this.baysKey = key; this.clear(this.bays);
      for (const bay of this.sim.parkingBays) {
        const w = this.sim.path.toCartesian(bay.s, bay.d);
        const tile = new THREE.Group(); tile.position.set(w.x, 0, w.y); tile.rotation.y = -w.heading;
        const surface = new THREE.Mesh(new THREE.BoxGeometry(bay.length + 1, .03, bay.width + .6), new THREE.MeshStandardMaterial({ color: 0x333c41, roughness: .95 }));
        surface.position.y = .15; tile.add(surface);
        const points = [[-1,-1], [1,-1], [1,1], [-1,1], [-1,-1]].map(([x,z]) => new THREE.Vector3(x * bay.length / 2, .172, z * bay.width / 2));
        tile.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xe4f0e8 })));
        // A P marking formed by vector strokes, avoiding an external font asset.
        const p = [[-.7,.6],[-.7,-.6],[.4,-.6],[.6,-.4],[.6,0],[.4,.15],[-.7,.15]].map(([x,z]) => new THREE.Vector3(x,.175,z));
        tile.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), new THREE.LineBasicMaterial({ color: 0x6ae4bd })));
        this.bays.add(tile);
      }
    }
    if (this.routeKey !== this.sim.parkingAssist.segments) {
      this.routeKey = this.sim.parkingAssist.segments; this.clear(this.route);
      for (const segment of this.sim.parkingAssist.segments) {
        this.route.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(segment.points.map(p => new THREE.Vector3(p.x,.21,p.y))),
          new THREE.LineDashedMaterial({ color: segment.gear === "R" ? 0xffc861 : 0x6ae4bd, dashSize: .5, gapSize: .35 })));
      }
      this.route.traverse(o => { if (o instanceof THREE.Line) o.computeLineDistances(); });
    }
    this.route.visible = ["ready", "running", "paused"].includes(this.sim.parkingAssist.status.state);
  }
  private clear(group: THREE.Group): void {
    group.traverse(o => { const mesh = o as THREE.Mesh; mesh.geometry?.dispose(); const m = mesh.material; if (Array.isArray(m)) m.forEach(v => v.dispose()); else m?.dispose(); });
    group.clear();
  }
}
