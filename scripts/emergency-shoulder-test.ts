import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/Simulation.ts';
import { wrapDiff } from '../src/core/math.ts';
import { RoadView } from '../src/render/RoadView.ts';
const dt=1/60;
function lab(perception=false,lane=0,weather:'clear'|'rain'|'fog'='clear',s=500){
  const sim=new Simulation({trackId:'motorway',trafficCount:0});assert(sim.prepareEmergencyStopLab());
  sim.usePerception=perception;sim.setWeather(weather);
  const w=sim.path.toCartesian(s,sim.road.laneCenter(lane));Object.assign(sim.ego,{x:w.x,y:w.y,yaw:w.heading,v:100/3.6,delta:0});
  sim.tracker.reset();sim.tracks=[];return sim;
}
function run(sim:Simulation,seconds=65){
  const states=new Set<string>();let maxLateral=0,maxMove=0;
  for(let i=0;i<seconds*60 && sim.emergencyPullOver.status.state!=='hold';i++){
    const x=sim.ego.x,y=sim.ego.y;sim.step(dt);states.add(sim.emergencyPullOver.status.state);
    maxLateral=Math.max(maxLateral,Math.abs(sim.ego.lateralAccel));maxMove=Math.max(maxMove,Math.hypot(sim.ego.x-x,sim.ego.y-y));
  }
  const f=sim.path.toFrenet(sim.ego.x,sim.ego.y);
  return {states:[...states],d:f.d,maxLateral,maxMove,status:sim.emergencyPullOver.status.state,reason:sim.emergencyPullOver.status.message};
}
// Actual road geometry, two carriageways, paved 3.5m shoulders and relocated rails.
{
  const sim=lab(),road=sim.road;
  assert.equal(road.shoulderWidth,3.5);assert(road.laneCenter(0)>road.centerDivider);
  assert(road.oncomingCenter(0)<road.centerDivider && road.shoulderCenter>road.forwardRightEdge);
  assert(road.inEmergencyShoulder(road.shoulderCenter,sim.ego.dims.width/2));
  const view=new RoadView(road);assert(view.group.getObjectByName('emergency-shoulder-forward'));
  const railBodies=sim.staticWorld.near(sim.ego.x,sim.ego.y,40).filter(b=>b.id.startsWith('rail:'));
  assert(railBodies.some(b=>Math.abs(sim.path.toFrenet(b.x,b.y).d-road.pavedHalfWidth-1)<.2),'outer guardrail still blocks the shoulder');
}
for(const perception of [false,true])for(const weather of ['clear','rain'] as const)for(const lane of [0,1,2]){
  const sim=lab(perception,lane,weather),out=run(sim);
  console.log({perception,weather,lane,...out,collisions:sim.metrics.collisions});
  assert.equal(out.status,'hold','pull-over failed to finish');
  assert(sim.road.inEmergencyShoulder(out.d,sim.ego.dims.width/2),'car did not fully fit inside emergency shoulder');
  assert.equal(sim.ego.v,0);assert.equal(sim.gear,'P');assert(sim.epbEngaged && sim.adas.status.extra.hazardRequest);
  assert.equal(sim.metrics.collisions,0);assert.equal(sim.metrics.offRoadTime,0);
  assert(out.maxMove<.55,'vehicle teleported rather than following the physics');
  assert(out.maxLateral<4.5,'emergency lane changes used an abrupt lateral manoeuvre');
}
// Curved road: use the same physical controller, including reduced wet-road grip.
for(const weather of ['clear','rain'] as const){const sim=lab(true,0,weather,150),out=run(sim);console.log('curve',weather,out);assert(sim.road.inEmergencyShoulder(out.d,sim.ego.dims.width/2)&&sim.metrics.collisions===0&&sim.metrics.offRoadTime===0);}
// Reduced visual range must not start shoulder entry before the entire
// lane-change-and-stop corridor fits inside the simulated long-range radar.
{const sim=lab(true,2,'fog'),out=run(sim);assert(out.status==='hold'&&sim.road.inEmergencyShoulder(out.d,sim.ego.dims.width/2)&&sim.metrics.collisions===0);}
// A continuously blocked emergency strip causes a stop in the traffic lane.
{
  const sim=lab(true);
  for(let s=450;s<=1200;s+=8){const w=sim.path.toCartesian(s,sim.road.shoulderCenter);sim.staticWorld.add({id:`blocked-shoulder:${s}`,kind:'barrier',...w,yaw:w.heading,length:7.9,width:2.8});}
  const out=run(sim);console.log('blocked shoulder',out);
  assert(out.states.includes('fallback') && out.status==='hold' && !sim.road.inEmergencyShoulder(out.d,sim.ego.dims.width/2));
  assert.equal(sim.metrics.collisions,0);assert(sim.ego.v===0 && sim.epbEngaged);
}
// Fast rear approach must prevent the FIRST move; after it passes the scan
// may find a safe opening. No forced movement through the approaching car.
{
  const sim=lab(false);sim.ego.v=14;const start=sim.path.toFrenet(sim.ego.x,sim.ego.y);
  const car=sim.traffic.addTestVehicle('car',1,start.s-100,45,45);car.changeCooldown=9999;
  for(let i=0;i<2*60;i++)sim.step(dt);
  const f=sim.path.toFrenet(sim.ego.x,sim.ego.y);
  assert(Math.abs(f.d-start.d)<.4,'pull-over entered the lane of a fast approaching rear vehicle');
  assert(sim.emergencyPullOver.status.state==='assessing' || sim.emergencyPullOver.status.state==='fallback');
  assert.equal(sim.metrics.collisions,0);
}
// Late intruder on the shoulder: cancel a partially started entry, do not
// keep following the previously clear trajectory blindly.
{
  const sim=lab(false,2);sim.ego.v=14;
  for(let i=0;i<300 && sim.emergencyPullOver.status.state!=='entering-shoulder';i++)sim.step(dt);
  assert.equal(sim.emergencyPullOver.status.state,'entering-shoulder');
  for(let i=0;i<20;i++)sim.step(dt);
  const f=sim.path.toFrenet(sim.ego.x,sim.ego.y),car=sim.traffic.addTestVehicle('stalled',2,f.s+35,0,0);car.d=sim.road.shoulderCenter;
  const out=run(sim);assert(out.states.includes('fallback') && out.status==='hold' && sim.metrics.collisions===0);
}
// Missing sensing is an in-lane controlled stop; it must never authorise a
// blind move to the shoulder. The existing manual pedal remains available.
for(const fault of ['rearRadar','frontRadar'] as const){const sim=lab();sim.sensorAvailability[fault]=false;const out=run(sim);assert(out.states.includes('fallback') && !sim.road.inEmergencyShoulder(out.d) && sim.metrics.collisions===0);}
// Map-localisation fallback follows a curve even when lane vision is lost;
// it may stop in its lane but must not claim a blind shoulder relocation.
for(const fault of ['camera','all','markings'] as const){
  const sim=lab(true,1,'clear',150),d=sim.road.laneCenter(1);
  if(fault==='all')sim.sensorFault=true;else if(fault==='camera')sim.sensorAvailability.camera=false;else sim.laneMarkingConfidence=0;
  const out=run(sim);assert(out.states.includes('fallback')&&out.status==='hold'&&Math.abs(out.d-d)<.45&&sim.metrics.collisions===0&&sim.metrics.offRoadTime===0);
}
for(const input of [{steer:.3,throttle:0,brake:0},{steer:0,throttle:.5,brake:0},{steer:0,throttle:0,brake:.8}]){
  const sim=lab();sim.ego.v=14;for(let i=0;i<30;i++)sim.step(dt);assert(sim.emergencyPullOver.status.active);
  sim.setDriverInput(input);sim.step(dt);
  assert.equal(sim.emergencyPullOver.status.state,'cancelled');assert(!sim.adas.status.extra.minimalRiskBraking && sim.driverAttentive && sim.driverHandsOn);
  if(input.brake)assert(sim.ego.a<=-input.brake*sim.ego.maxDecel+.01);
}
// Slow analogue pressure ramps are deliberate responses too. Per-frame
// deltas stay below the old acknowledgement thresholds throughout.
for(const pedal of ['throttle','brake'] as const){
  const sim=lab();sim.ego.v=14;for(let i=0;i<30;i++)sim.step(dt);
  for(let i=1;i<=20&&sim.emergencyPullOver.status.active;i++){sim.setDriverInput({steer:0,throttle:0,brake:0,[pedal]:i*.01});sim.step(dt);}
  assert.equal(sim.emergencyPullOver.status.state,'cancelled',`gradual ${pedal} failed to take over`);
}
// Replay restores the middle of the physical manoeuvre, not just warning text.
{
  const sim=lab();sim.ego.v=14;for(let i=0;i<120;i++)sim.step(dt);
  const before=sim.emergencyPullOver.captureState();assert(before.status.state==='changing-lane');
  sim.startRecording();for(let i=0;i<8;i++)sim.step(dt);sim.stopRecording();
  const saved=sim.emergencyPullOver.captureState();sim.reset();assert(sim.startReplay());for(let i=0;i<10;i++)sim.step(dt);
  assert.deepEqual(sim.emergencyPullOver.captureState(),saved);sim.stopReplay();sim.paused=false;
  const out=run(sim);assert(out.status==='hold' && sim.road.inEmergencyShoulder(out.d,sim.ego.dims.width/2) && sim.metrics.collisions===0);
}
console.log('EMERGENCY SHOULDER PASS — road geometry, all lanes/weather/sensing, curves, blockers, rear approach, intrusion, takeover and replay.');
// Disabling lateral relocation mid-manoeuvre must not revive an old lane
// target or accelerate the still-unresponsive driver.
{
  const sim=lab();sim.ego.v=14;for(let i=0;i<120;i++)sim.step(dt);
  sim.adas.config.emergencyShoulderStop=false;const out=run(sim);
  assert(out.states.includes('fallback')&&out.status==='hold'&&sim.ego.v===0&&sim.metrics.collisions===0);
}
// Natural DMS escalation must also request the manoeuvre; the demo injection
// is not the only trigger, and disabling the option retains in-lane stopping.
for(const enabled of [false,true]){
  const sim=lab();sim.extendedAssistance.reset();sim.adas.config.emergencyShoulderStop=enabled;
  for(let i=0;i<8*60;i++)sim.step(dt);assert(!sim.emergencyPullOver.status.active,'pull-over triggered before nonresponse escalation');
  const out=run(sim);assert(sim.ego.v===0 && sim.metrics.collisions===0);
  assert.equal(sim.road.inEmergencyShoulder(out.d,sim.ego.dims.width/2),enabled);
}
// Legacy recordings from the old motorway placement are mirrored into the
// right-hand layout; they must not reappear in the oncoming carriageway.
{
  const sim=new Simulation({trackId:'motorway',trafficCount:0});sim.setControlMode('manual');sim.ego.v=0;sim.startRecording();sim.step(dt);sim.stopRecording();
  const legacy=JSON.parse(sim.exportRecordedSession()),f=legacy.frames[0].value;
  delete f.roadLayoutVersion;delete f.pullOverRuntime;
  const w=sim.path.toCartesian(500,-6.625);Object.assign(f.ego,{x:w.x,y:w.y,yaw:w.heading,delta:0});
  f.telemetry.lane=1;f.telemetry.indicator=-1;f.driverInput.steer=-.2;
  assert(sim.recorder.load(JSON.stringify(legacy))&&sim.startReplay());sim.step(dt);
  assert(Math.abs(sim.path.toFrenet(sim.ego.x,sim.ego.y).d-6.625)<.02);
  assert.equal(sim.indicator,1);assert.equal(sim.driverInput.steer,.2);
}
console.log('Emergency handover, option-off fallback, natural DMS trigger and legacy motorway replay PASS.');
