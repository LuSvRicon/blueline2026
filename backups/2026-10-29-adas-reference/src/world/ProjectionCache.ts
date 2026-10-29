import {ReferencePath,type FrenetPose} from './ReferencePath.ts';

/** Reuse the previous sample index for nearby observations. The road math is
 * unchanged; new actors/teleports still use a complete nearest-point search. */
export class ProjectionCache {
 private entries=new WeakMap<object,{x:number;y:number;pose:FrenetPose}>();
 constructor(private path:ReferencePath){}
 project(actor:object,x:number,y:number):FrenetPose{
  const old=this.entries.get(actor);
  if(old&&old.x===x&&old.y===y)return {...old.pose};
  const hint=old&&Math.hypot(x-old.x,y-old.y)<20?old.pose.index:-1;
  const pose=this.path.toFrenet(x,y,hint);
  this.entries.set(actor,{x,y,pose});return {...pose};
 }
}
