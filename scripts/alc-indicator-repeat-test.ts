import assert from 'node:assert/strict';
import {Simulation} from '../src/sim/Simulation.ts';
import {ADASController,type ADASFrame} from '../src/sim/ADAS.ts';

const dt=1/60;
function drive(trackId:'motorway'|'ring-road',kph:number,weather:'clear'|'rain',perception=false){
  const sim=new Simulation({trackId,trafficCount:0});sim.setControlMode('adas');sim.setTrafficCount(0);
  sim.setWeather(weather);sim.usePerception=perception;sim.ego.v=kph/3.6;sim.setAccSpeedKph(Math.max(30,kph));return sim;
}
let runs=0;
for(const track of ['motorway','ring-road'] as const)for(const weather of ['clear','rain'] as const)for(const kph of [5,50,90])for(const dir of [-1,1] as const)for(const phase of [.1,.35,.6,.8]){
  const baseline=drive(track,kph,weather),repeat=drive(track,kph,weather);
  const start=baseline.road.laneOf(baseline.path.toFrenet(baseline.ego.x,baseline.ego.y).d);
  baseline.toggleIndicator(dir);repeat.toggleIndicator(dir);
  for(let i=0;i<900&&(baseline.adas.captureState().alcProgress??0)<phase;i++){baseline.step(dt);repeat.step(dt);}
  assert.equal(repeat.adas.status.alc,'active',`test did not reach the requested phase: ${track}/${kph}/${phase}`);
  repeat.toggleIndicator(dir);repeat.toggleIndicator(dir);repeat.toggleIndicator(-dir);
  assert.equal(repeat.indicator,dir,'a repeated/opposite stalk click cancelled the committed lane change');
  assert.deepEqual(repeat.adas.captureState(),baseline.adas.captureState(),'signal click reset the active trajectory');
  let completed=false;
  for(let i=0;i<900;i++){
    baseline.step(dt);repeat.step(dt);
    assert(Math.hypot(baseline.ego.x-repeat.ego.x,baseline.ego.y-repeat.ego.y)<1e-8&&Math.abs(baseline.ego.delta-repeat.ego.delta)<1e-8,'repeat changed the physical steering path');
    assert.equal(repeat.adas.status.laneSupportLimited,baseline.adas.status.laneSupportLimited,'repeat generated a new lateral-limit warning');
    assert(!repeat.adas.status.alcAborted,'repeat aborted the trajectory');
    if(repeat.adas.status.alcComplete){completed=true;break;}
  }
  const f=repeat.path.toFrenet(repeat.ego.x,repeat.ego.y);
  assert(completed&&repeat.road.laneOf(f.d)===start+dir&&repeat.indicator===0,'did not finish in the intended lane with the signal cleared');
  assert(repeat.metrics.collisions===0&&repeat.metrics.offRoadTime===0);
  runs++;
}
console.log(`REPEAT SIGNAL: ${runs} physical baseline/repeated-click pairs, both directions, four phases, two roads, three initial speeds and dry/wet.`);
// A real brake or steering takeover must still cancel. The second stalk click
// must not be the only way of stopping an automatic lateral command.
for(const input of [{steer:0,throttle:0,brake:.6},{steer:-.001,steeringOverride:true,throttle:0,brake:0}]){
  const sim=drive('motorway',60,'clear',true);sim.toggleIndicator(1);
  for(let i=0;i<120;i++)sim.step(dt);assert.equal(sim.adas.status.alc,'active');
  sim.toggleIndicator(1);sim.setDriverInput(input);sim.step(dt);
  assert(sim.adas.status.alcAborted&&sim.adas.status.alc!=='active','repeat protection blocked the driver takeover');
}
// Pending/ordinary signals can still be switched off with a second click.
for(const mode of ['manual','adas'] as const){const sim=drive('motorway',0,'clear');sim.setControlMode(mode);sim.toggleIndicator(1);sim.toggleIndicator(1);assert.equal(sim.indicator,0);}
// Braking after crossing the lane divider may cancel ALC, but LFA must settle
// the lane the car now occupies, rather than pulling towards a stale origin.
{
  const sim=drive('motorway',60,'clear');sim.toggleIndicator(1);
  for(let i=0;i<600&&(sim.adas.captureState().alcProgress??0)<.8;i++)sim.step(dt);
  const before=sim.path.toFrenet(sim.ego.x,sim.ego.y),target=sim.road.laneOf(before.d);
  assert.equal(target,2);sim.setDriverInput({steer:0,throttle:0,brake:.6});
  for(let i=0;i<8*60;i++)sim.step(dt);
  const after=sim.path.toFrenet(sim.ego.x,sim.ego.y);
  assert.equal(sim.road.laneOf(after.d),target,'brake cancellation pulled the car back across the divider');
  assert(sim.ego.v===0&&sim.metrics.collisions===0&&sim.metrics.offRoadTime===0);
}
// Reaching tyre grip on a straight road is a lateral-limit warning; only
// actual road curvature may be described as excessive speed through a bend.
{
  const sim=drive('motorway',90,'clear'),ego=sim.ego,c=new ADASController();
  const frame=():ADASFrame=>{const f=sim.path.toFrenet(ego.x,ego.y);return{ego,egoS:f.s,egoD:f.d,path:sim.path,road:sim.road,obstacles:[],desiredSpeed:ego.v,input:{steer:0,throttle:0,brake:0},dt,speedControl:e=>e};};
  const straight=sim.path.toCartesian(500,sim.road.laneCenter(1));Object.assign(ego,{x:straight.x,y:straight.y,yaw:straight.heading,v:40,delta:0});
  ego.limitLateralGrip=true;ego.step(ego.maxSteer,0,1);assert(ego.tractionLimited);
  c.update(frame());assert(c.status.laneSupportLimited&&c.status.laneSupportLimitCause==='lateral-grip','straight-road tyre saturation was labelled a sharp bend');
  let bend=0,curvature=0;for(let s=0;s<sim.path.length;s+=10){const k=Math.abs(sim.path.signedCurvatureAt(s));if(k>curvature){curvature=k;bend=s;}}
  const w=sim.path.toCartesian(bend,sim.road.laneCenter(1));Object.assign(ego,{x:w.x,y:w.y,yaw:w.heading,v:55,tractionLimited:false});
  c.update(frame());assert(c.status.laneSupportLimited&&c.status.laneSupportLimitCause==='curve','genuine excessive curve speed lost its warning');
}
console.log('ALC REPEAT SIGNAL PASS — trajectory unchanged by duplicate commands; genuine takeover and ordinary signal cancellation remain available.');
