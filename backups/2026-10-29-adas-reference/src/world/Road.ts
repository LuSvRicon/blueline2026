// Road — lane structure layered on top of a ReferencePath.
//
// Lanes are indexed 0..numLanes-1 from LEFT to RIGHT. Each lane has a constant
// lateral offset (d) from the centerline (-d is left, +d is right), so "drive in lane i" == "hold
// d = laneCenter(i)". This is what makes lane keeping and lane changes trivial
// to express for both the ego planner and the traffic model.

import { ReferencePath } from "./ReferencePath.ts";
import type { RoadProfile } from './track.ts';

export class Road {
  readonly path: ReferencePath;
  readonly numLanes: number;
  readonly laneWidth: number;

  constructor(path: ReferencePath, numLanes = 3, laneWidth = 3.7, readonly profile?:RoadProfile) {
    this.path = path;
    this.numLanes = numLanes;
    this.laneWidth = laneWidth;
  }

  get totalWidth(): number {
    return (this.numLanes+this.opposingLanes)*this.laneWidth+this.median;
  }
  get opposingLanes():number{return this.profile?.opposing??0;}
  get median():number{return this.profile?.median??0;}
  get forwardOffset():number{return -(this.opposingLanes*this.laneWidth+this.median)/2;}
  get centerDivider():number{return this.forwardOffset+this.numLanes*this.laneWidth/2+this.median/2;}
  oncomingCenter(i:number):number{return this.centerDivider+this.median/2+(i+.5)*this.laneWidth;}

  /** Signed lateral offset (d) of the centre of lane `i`. Left lanes are -d, right lanes are +d. */
  laneCenter(i: number): number {
    return (i - (this.numLanes - 1) / 2) * this.laneWidth+this.forwardOffset;
  }

  /** Which lane index a given lateral offset falls into (clamped to the road). */
  laneOf(d: number): number {
    const raw = Math.round((d-this.forwardOffset) / this.laneWidth + (this.numLanes - 1) / 2);
    return Math.max(0, Math.min(this.numLanes - 1, raw));
  }

  /** d of the left/right paint edge of the drivable surface. */
  get leftEdge(): number {
    return this.totalWidth / 2;
  }
  get rightEdge(): number {
    return -this.totalWidth / 2;
  }
}
