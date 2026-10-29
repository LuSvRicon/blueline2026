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
  /** The motorway uses right-hand traffic. Other historic maps retain their
   * layout in this change; they do not have an emergency shoulder. */
  get rightHandMotorway():boolean{return this.profile?.motorway === true;}
  get forwardOffset():number{return (this.rightHandMotorway?1:-1)*(this.opposingLanes*this.laneWidth+this.median)/2;}
  get centerDivider():number{return this.forwardOffset+(this.rightHandMotorway?-1:1)*(this.numLanes*this.laneWidth/2+this.median/2);}
  oncomingCenter(i:number):number{return this.centerDivider+(this.rightHandMotorway?-1:1)*(this.median/2+(i+.5)*this.laneWidth);}
  get forwardLeftEdge():number{return this.laneCenter(0)-this.laneWidth/2;}
  get forwardRightEdge():number{return this.laneCenter(this.numLanes-1)+this.laneWidth/2;}
  get shoulderWidth():number{return this.profile?.motorway ? this.profile.emergencyShoulder ?? 0 : 0;}
  get shoulderCenter():number{return this.forwardRightEdge+this.shoulderWidth/2;}
  get pavedHalfWidth():number{return this.totalWidth/2+this.shoulderWidth;}
  inEmergencyShoulder(d:number,halfVehicleWidth=0):boolean{
    return this.shoulderWidth>0 && d-halfVehicleWidth>=this.forwardRightEdge && d+halfVehicleWidth<=this.forwardRightEdge+this.shoulderWidth;
  }

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
