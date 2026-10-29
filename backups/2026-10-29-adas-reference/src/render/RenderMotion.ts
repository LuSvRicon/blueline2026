import {clamp,wrapAngle} from '../core/math.ts';
import type {Simulation} from '../sim/Simulation.ts';

export interface RenderPose {x:number;y:number;yaw:number;v:number;d:number;a:number;vd:number}
export interface RenderMotionFrame {ego:RenderPose;cars:Map<number,RenderPose>;peds:Map<number,RenderPose>}

/** One physics step of presentation latency, shared by actors AND cameras.
 * Never modifies simulation/collision/sensor state. Unlike exponential position
 * smoothing it preserves constant velocity on displays faster/slower than 60 Hz. */
export class RenderMotion {
 private previous:RenderMotionFrame|undefined;
 private previousTime=-Infinity;
 capture(sim:Simulation):void{
  this.previous=this.read(sim);this.previousTime=sim.metrics.time;
 }
 sample(sim:Simulation,alpha:number,dt:number):RenderMotionFrame{
  const current=this.read(sim),elapsed=sim.metrics.time-this.previousTime;
  if(!this.previous||sim.paused||elapsed<=0||Math.abs(elapsed-dt)>1e-6)return current;
  const blend=clamp(alpha,0,1);
  const mix=(old:RenderPose|undefined,now:RenderPose):RenderPose=>{
   if(!old||Math.hypot(now.x-old.x,now.y-old.y)>8)return now;
   return {x:old.x+(now.x-old.x)*blend,y:old.y+(now.y-old.y)*blend,
    yaw:old.yaw+wrapAngle(now.yaw-old.yaw)*blend,v:old.v+(now.v-old.v)*blend,
    d:old.d+(now.d-old.d)*blend,a:(now.v-old.v)/dt,vd:(now.d-old.d)/dt};
  };
  current.ego=mix(this.previous.ego,current.ego);
  for(const [id,pose]of current.cars)current.cars.set(id,mix(this.previous.cars.get(id),pose));
  for(const [id,pose]of current.peds)current.peds.set(id,mix(this.previous.peds.get(id),pose));
  return current;
 }
 private read(sim:Simulation):RenderMotionFrame{
  return {ego:{x:sim.ego.x,y:sim.ego.y,yaw:sim.ego.yaw,v:sim.signedSpeed,d:0,a:sim.ego.a,vd:0},
   cars:new Map(sim.traffic.cars.map(c=>{const p=sim.path.toCartesian(c.s,c.d);
    const offset=c.crossing?(Math.sign(c.crossingToD-c.d)||1)*Math.PI/2:c.headingOffset??0;
    return [c.id,{x:p.x,y:p.y,yaw:p.heading+offset,v:c.disabled?0:c.crossing?c.crossingSpeed:c.v,d:c.d,a:0,vd:0}];})),
   peds:new Map(sim.pedestrians.peds.map(p=>{const w=sim.path.toCartesian(p.s,p.d);
    return [p.id,{x:w.x,y:w.y,yaw:w.heading+Math.sign(p.toD-p.fromD)*Math.PI/2,v:0,d:p.d,a:0,vd:sim.pedestrians.lateralVel(p)}];}))};
 }
}
