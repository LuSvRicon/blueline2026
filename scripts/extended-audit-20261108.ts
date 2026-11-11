import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/Simulation.ts';
import { ExtendedAssistance } from '../src/sim/ExtendedAssistance.ts';
import { DEFAULT_ADAS_CONFIG, type ADASFrame } from '../src/sim/ADAS.ts';

const sim = new Simulation({trackId:'motorway',trafficCount:0});
sim.traffic.clear(); sim.pedestrians.clear();
const s = 500, d = sim.road.laneCenter(1), w = sim.path.toCartesian(s,d);
Object.assign(sim.ego,{x:w.x,y:w.y,yaw:w.heading,v:0});
const options = {gear:'D',night:true,weather:'clear',attentive:true,handsOn:true,fatigued:false};
const frame: ADASFrame = {ego:sim.ego,egoS:s,egoD:d,path:sim.path,road:sim.road,obstacles:[],desiredSpeed:30,
  input:{steer:0,throttle:0,brake:0},dt:1/60,speedControl:e=>e};
const config = {...DEFAULT_ADAS_CONFIG};
const failures:string[]=[];
const check = (label:string, run:()=>void) => {
  try { run(); console.log(`PASS ${label}`); }
  catch(error) { failures.push(`${label}: ${error instanceof Error?error.message:String(error)}`); console.error(`FAIL ${label}`); }
};

// A bus/trailer can occupy the blind spot while its centre is several metres
// ahead of the driver. Centre-only windows miss its rear body beside the door.
for (const side of [-1,1]) check(`SEA/BCA full body, side ${side}`,()=>{
  const assistant = new ExtendedAssistance();
  const bus = {s:s+8,d:d+side*2.4,v:18,vd:0,length:16,width:2.5,kind:'car' as const};
  sim.ego.v=0;
  const stopped = assistant.update({...frame,obstacles:[bus]},config,0,0,options);
  assert(side<0?stopped.status.safeExitLeft:stopped.status.safeExitRight,'long vehicle beside door was not detected');
  sim.ego.v=15;
  const moving = assistant.update({...frame,obstacles:[bus],input:{steer:side*.25,throttle:0,brake:0}},config,side*.25,0,options);
  assert(moving.status.blindSpotIntervention,'long vehicle beside ego was not protected by BCA');
  assert(moving.steer*side<0,'BCA did not correct away from the overlapping side body');
  sim.ego.v=0;
  const distant = assistant.update({...frame,obstacles:[{...bus,s:s+30}]},config,0,0,options);
  assert(!distant.status.safeExitLeft&&!distant.status.safeExitRight,'receding vehicle well ahead caused safe-exit lock');
  const tentative = assistant.update({...frame,obstacles:[{...bus,confirmed:false}]},config,0,0,options);
  assert(!tentative.status.safeExitLeft&&!tentative.status.safeExitRight,'tentative target locked door');
});

// Automatic evasive steering owns its stored target only while its original
// sensing and lateral-support conditions remain valid. Losing them mid-swerve
// must not silently keep an old lane command alive.
for (const fault of ['rearRadar','esc','lateral-off'] as const) check(`ESA mid-manoeuvre ${fault}`,()=>{
  const assistant = new ExtendedAssistance(), cfg={...config};
  sim.ego.v=138/3.6;
  const danger = {...frame,obstacles:[{s:s+40,d,v:0,vd:0,length:4.6,width:1.9,kind:'car' as const}]};
  assert(assistant.update(danger,cfg,0,-sim.ego.maxDecel,options).status.evasiveSteering,'setup did not initiate automatic ESA');
  const altered:ADASFrame = {...danger};
  if(fault==='rearRadar') altered.sensorAvailability={rearRadar:false};
  if(fault==='esc') altered.conditions={escAvailable:false};
  if(fault==='lateral-off') cfg.laneCentering=cfg.laneKeeping=false;
  const lost=assistant.update(altered,cfg,0,-sim.ego.maxDecel,options);
  assert(!lost.status.evasiveSteering&&assistant.activeEvadeLane===null,'ESA retained stale lane ownership after condition loss');
  assert(lost.accel<=-sim.ego.maxDecel,'ESA weakened straight-line braking after condition loss');
});

for (const fault of ['rearRadar','esc'] as const) check(`ESA to LFA integration ${fault}`,()=>{
  const drive=new Simulation({trackId:'motorway',trafficCount:0});
  drive.setControlMode('adas'); drive.traffic.clear(); drive.pedestrians.clear(); drive.usePerception=false;
  const lane=1,startS=500,laneD=drive.road.laneCenter(lane),pose=drive.path.toCartesian(startS,laneD);
  Object.assign(drive.ego,{x:pose.x,y:pose.y,yaw:pose.heading,v:138/3.6});
  (drive as unknown as {lastEgoIndex:number}).lastEgoIndex=-1;
  drive.setAccSpeedKph(138);
  const stopped=drive.traffic.addTestVehicle('stalled',lane,startS+48,0,0); stopped.d=laneD;
  for(let i=0;i<3;i++) drive.step(1/60);
  assert(drive.adas.status.extra.evasiveSteering,'integration setup did not initiate ESA');
  assert.equal(drive.adas.captureState().laneTarget,0,'integration setup did not assign the evade lane to LFA');
  const priorSteer=drive.ego.delta;
  if(fault==='rearRadar')drive.sensorAvailability.rearRadar=false; else drive.escAvailable=false;
  drive.step(1/60);
  assert(!drive.adas.status.extra.evasiveSteering,'ESA did not cancel at condition loss');
  assert.equal(drive.adas.captureState().laneTarget,lane,'LFA retained the cancelled ESA lane target');
  assert(Math.abs(drive.ego.delta)<Math.abs(priorSteer),'stale LFA steering survived the ESA cancellation tick');
});

check('ESA cannot reduce foot brake when AEB is off',()=>{
  const drive=new Simulation({trackId:'motorway',trafficCount:0});
  drive.setControlMode('adas'); drive.traffic.clear(); drive.pedestrians.clear(); drive.usePerception=false;
  const lane=1,startS=500,laneD=drive.road.laneCenter(lane),pose=drive.path.toCartesian(startS,laneD);
  Object.assign(drive.ego,{x:pose.x,y:pose.y,yaw:pose.heading,v:138/3.6});
  (drive as unknown as {lastEgoIndex:number}).lastEgoIndex=-1;
  drive.adas.config.aeb=false;
  const stopped=drive.traffic.addTestVehicle('stalled',lane,startS+48,0,0); stopped.d=laneD;
  drive.setDriverInput({steer:0,throttle:0,brake:.6}); drive.step(1/60);
  assert(drive.adas.status.extra.evasiveSteering,'setup did not activate the independent automatic ESA');
  assert(!drive.adas.status.aeb,'AEB unexpectedly activated while switched off');
  const footDemand=.6*drive.ego.maxDecel;
  assert(drive.telemetry.requestedAccel!<=-footDemand+1e-8,'ESA reduced the driver foot-brake request');
  assert(drive.ego.requestedAccel<=-footDemand+1e-8,'hydraulic request fell below the foot-brake floor');
});

// Use every selectable car's actual wheelbase/width and dynamics, rather than
// proving the parking trajectory only with the default composite dimensions.
for (const profile of ['vf9','santafe','everest','civic'] as const)
  for (const orientation of ['parallel','perpendicular'] as const) check(`APA ${profile}/${orientation}`,()=>{
    const parked = new Simulation({trafficCount:0});
    parked.setVehicleProfile(profile); parked.usePerception=false; parked.prepareParkingLab(orientation);
    assert(parked.requestParking('apa'),'could not find/plan a free bay');
    const bay=parked.parkingBays.find(b=>b.id===parked.parkingAssist.status.bayId)!;
    for(let i=0;i<4500&&parked.parkingAssist.status.state!=='complete';i++) {
      parked.parkingAssist.hold(true); parked.step(1/60);
      assert(!['cancelled','blocked'].includes(parked.parkingAssist.status.state),parked.parkingAssist.status.message);
    }
    const goal=parked.path.toCartesian(bay.s,bay.d);
    assert.equal(parked.parkingAssist.status.state,'complete');
    assert(Math.hypot(parked.ego.x-goal.x,parked.ego.y-goal.y)<.35,'vehicle did not settle inside the bay');
    assert.equal(parked.metrics.collisions,0); assert.equal(parked.ego.v,0);
    assert(parked.gear==='P'&&parked.epbEngaged,'completion did not select park/EPB');
  });

assert.deepEqual(failures,[],failures.join('\n'));
console.log('Extended ADAS audit 2026-11-08 complete.');
