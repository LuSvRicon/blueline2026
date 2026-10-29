import assert from 'node:assert/strict';
import {Simulation} from '../src/sim/Simulation.ts';
import {RenderMotion} from '../src/render/RenderMotion.ts';
const dt=1/60;
for(const hz of [30,60,75,120,144,165]){
 const sim=new Simulation({trafficCount:0});sim.traffic.clear();sim.pedestrians.clear();sim.setControlMode('manual');
 Object.assign(sim.ego,{x:0,y:0,yaw:0,v:20});sim.metrics.time=0;
 const motion=new RenderMotion();let acc=0,previous:number|undefined,maxError=0;
 for(let i=0;i<hz*2;i++){
  acc+=1/hz;
  while(acc>=dt-1e-10){motion.capture(sim);sim.ego.x+=20*dt;sim.metrics.time+=dt;acc-=dt;}
  const view=motion.sample(sim,acc/dt,dt);
  if(previous!==undefined&&i>2){const jump=view.ego.x-previous;maxError=Math.max(maxError,Math.abs(jump-20/hz));}
  previous=view.ego.x;
 }
 assert(maxError<1e-8,`${hz}Hz render advances in discrete 60Hz jumps: error ${maxError}`);
 console.log(`${hz} Hz: constant-velocity render step error ${maxError.toExponential(1)}m`);
}
{
 const sim=new Simulation({trafficCount:0});sim.traffic.clear();sim.pedestrians.clear();
 const car=sim.traffic.addTestVehicle('car',1,150,10,10),ped=sim.pedestrians.add({s:160,fromD:-5,toD:5});
 const motion=new RenderMotion();sim.ego.yaw=Math.PI-.01;motion.capture(sim);
 car.s+=10*dt;car.v+=dt;ped.d+=dt;sim.ego.yaw=-Math.PI+.01;sim.ego.x+=.1;sim.metrics.time+=dt;
 const old=JSON.stringify(sim.captureFrame()),view=motion.sample(sim,.5,dt);
 assert(Math.abs(view.ego.yaw-Math.PI)<1e-9,'yaw interpolation took long path across angle wrap');
 assert(Math.abs(view.cars.get(car.id)!.a-1)<1e-9,'acceleration depends on render frame interval');
 assert(Math.abs(view.peds.get(ped.id)!.d-(-5+dt/2))<1e-9,'pedestrian render did not interpolate');
 assert.equal(JSON.stringify(sim.captureFrame()),old,'render interpolation changed live physics state');
 sim.paused=true;assert.equal(motion.sample(sim,.1,dt).ego.x,sim.ego.x,'pause showed a stale intermediate pose');
 sim.paused=false;sim.reset();assert.equal(motion.sample(sim,.1,dt).ego.x,sim.ego.x,'reset blended across unrelated worlds');
}
console.log('RENDER-MOTION PASS — matched actor/camera presentation, angle wrap, pause/reset, no physics mutation');
