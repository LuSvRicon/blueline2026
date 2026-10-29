import assert from 'node:assert/strict';
import {Simulation} from '../src/sim/Simulation.ts';
import {ADASController,ADASFrame} from '../src/sim/ADAS.ts';
import {proximitySafety} from '../src/sim/ProximitySafety.ts';
import {bodyContact} from '../src/core/collision.ts';

function emptyDrive(){
 const sim=new Simulation({trafficCount:0});sim.setControlMode('adas');
 sim.traffic.clear();sim.pedestrians.clear();sim.trafficLights=[];sim.roadSigns=[];sim.usePerception=false;
 const p=sim.path.toCartesian(150,0);Object.assign(sim.ego,{x:p.x,y:p.y,yaw:p.heading,v:12});
 return sim;
}

// A visual replay must not silently re-enable ACC that was cancelled by the
// recorded driver's brake, nor inherit cruise settings from another run.
{
 const sim=emptyDrive();sim.setAccSpeedKph(82);sim.adas.config.timeGap=2.5;
 sim.setDriverInput({steer:0,throttle:0,brake:.4});sim.step(1/60);
 sim.setDriverInput({steer:0,throttle:0,brake:0});sim.startRecording();
 for(let i=0;i<4;i++)sim.step(1/60);sim.stopRecording();
 sim.reset();sim.setAccSpeedKph(32);sim.adas.config.timeGap=1;
 assert(sim.startReplay());for(let i=0;i<6;i++)sim.step(1/60);
 assert.equal(sim.adas.status.accState,'cancelled');
 sim.stopReplay();sim.paused=false;sim.step(1/60);
 assert.equal(sim.adas.status.accState,'cancelled','ACC re-enabled after a replay of driver brake cancellation');
 assert.equal(Math.round(sim.accSetSpeedKph),82,'ACC resumed with settings from a different session');
 assert.equal(sim.adas.config.timeGap,2.5,'headway setting was not restored from the recorded session');
 const legacy=JSON.parse(sim.exportRecordedSession());for(const f of legacy.frames)delete f.value.adasRuntime;
 const old=emptyDrive();assert(old.recorder.load(JSON.stringify(legacy)));assert(old.startReplay());for(let i=0;i<6;i++)old.step(1/60);
 old.stopReplay();old.paused=false;old.step(1/60);assert.equal(old.adas.status.accState,'cancelled','legacy replay re-enabled a cancelled ACC');
 console.log('replay: ACC cancellation, set speed and headway survive reset/playback/resume');
}

// Capture at the middle of a manoeuvre, not just with an idle controller.
{
 const sim=emptyDrive(),ego=sim.ego,path=sim.path,road=sim.road;
 const frame=(overrides:Partial<ADASFrame>={}):ADASFrame=>{const f=path.toFrenet(ego.x,ego.y);return {ego,egoS:f.s,egoD:f.d,path,road,obstacles:[],desiredSpeed:25,input:{steer:0,throttle:0,brake:0},dt:1/60,speedControl:e=>e,...overrides};};
 const alc=new ADASController();for(let i=0;i<80;i++)alc.update(frame({indicator:1}));
 assert.equal(alc.status.alc,'active');
 const restoredAlc=new ADASController();restoredAlc.restoreState(alc.captureState(),alc.status);
 const originalOut=alc.update(frame({indicator:1})),restoredOut=restoredAlc.update(frame({indicator:1}));
 assert.equal(restoredOut.steer,originalOut.steer,'ALC reference jumped after restoring the middle of a manoeuvre');
 assert.equal(restoredOut.status.alc,originalOut.status.alc);
 const aeb=new ADASController(),f=path.toFrenet(ego.x,ego.y);
 const obstacle={s:f.s+12,d:f.d,v:0,vd:0,length:4.6,width:1.9,kind:'car' as const};
 ego.v=12;assert(aeb.update(frame({obstacles:[obstacle]})).status.aeb);ego.v=0;
 assert(aeb.update(frame({obstacles:[obstacle]})).status.aebHolding);
 const restoredAeb=new ADASController();restoredAeb.restoreState(aeb.captureState(),aeb.status);
 assert(restoredAeb.update(frame({obstacles:[obstacle],input:{steer:0,throttle:1,brake:0}})).status.aebHolding,'restored AEB lost the emergency stop latch');
 const yellow=new ADASController();ego.v=12;
 assert(yellow.update(frame({trafficLight:{state:'yellow',distance:90,id:7}})).status.trafficLightStopping);
 const restoredYellow=new ADASController();restoredYellow.restoreState(yellow.captureState(),yellow.status);
 assert(restoredYellow.update(frame({trafficLight:{state:'yellow',distance:10,id:7}})).status.trafficLightStopping,'restored yellow-light decision changed from stop to go');
 console.log('replay controller memory: mid-ALC, AEB hold and yellow-stop decision restored');
}

// Losing lane recognition or deliberately switching LKA off must permit a new
// lane to be acquired, instead of keeping an invisible old lane target.
{
 const sim=emptyDrive(),ego=sim.ego,path=sim.path,road=sim.road,adas=new ADASController();
 const frame=(overrides:Partial<ADASFrame>={}):ADASFrame=>{const f=path.toFrenet(ego.x,ego.y);return {ego,egoS:f.s,egoD:f.d,path,road,obstacles:[],desiredSpeed:25,input:{steer:0,throttle:0,brake:0},dt:1/60,speedControl:e=>e,...overrides};};
 adas.update(frame());adas.config.laneCentering=false;adas.update(frame());
 const p=path.toCartesian(150,road.laneCenter(2)-.2);Object.assign(ego,{x:p.x,y:p.y,yaw:p.heading});
 adas.config.laneCentering=true;assert(adas.update(frame()).steer>0,'re-enabled LKA pulled toward the old lane');
 adas.update(frame({laneConfidence:0}));const q=path.toCartesian(150,road.laneCenter(0)+.2);Object.assign(ego,{x:q.x,y:q.y,yaw:q.heading});
 assert(adas.update(frame()).steer<0,'re-acquired lane recognition pulled toward an old lane');
 console.log('LKA: disable/re-enable and lost/re-acquired markings acquire the correct lane');
}

// A rear vehicle travelling away faster than our reverse speed is not a rear
// collision threat. A static obstacle at the same position still must brake.
{
 const sim=emptyDrive(),ego=sim.ego,path=sim.path;ego.v=1;
 const f=path.toFrenet(ego.x,ego.y),o={s:f.s-6,d:f.d,v:-5,vd:0,length:4.6,width:1.9,kind:'car' as const};
 assert(!proximitySafety(ego,path,[o],true).rearAeb,'Rear AEB braked for rear traffic pulling away');
 assert(proximitySafety(ego,path,[{...o,v:0}],true).rearAeb,'Rear AEB ignored a stationary rear obstacle');
 console.log('Rear AEB: departing traffic is clear; stationary rear obstacle still brakes');
}

// Ambient actors also have physical bodies: a crossing person cannot walk
// straight through a stopped NPC merely because the ego is elsewhere.
{
 const sim=emptyDrive();sim.setControlMode('manual');sim.ego.v=0;
 const car=sim.traffic.addTestVehicle('stalled',1,200,0,0);
 const ped=sim.pedestrians.add({s:200,fromD:-3,toD:3,speed:1.4,triggerDist:1});ped.state='crossing';
 for(let i=0;i<5*60;i++)sim.step(1/60);
 assert(ped.collided,'pedestrian walked through the stopped traffic vehicle without contact');
 assert(car.disabled&&car.v===0,'NPC/pedestrian contact did not stop the vehicle');
 assert.equal(sim.traffic.contactCount,1,'ambient contact must be counted once');
 assert.equal(sim.metrics.collisions,0,'ambient contact was incorrectly charged to the ego');
 const c=sim.path.toCartesian(car.s,car.d),p=sim.path.toCartesian(ped.s,ped.d);
 assert(!bodyContact({x:c.x,y:c.y,yaw:c.heading,length:car.length,width:car.width},{x:p.x,y:p.y,yaw:p.heading,length:ped.radius*2,width:ped.radius*2}),'ambient vehicle and pedestrian stayed interpenetrating after contact');
 console.log('ambient contacts: pedestrian cannot walk through a stopped vehicle');
}

// A high-speed NPC can cross the pedestrian between two non-overlapping end
// poses during a long step; check the swept contact rather than end overlap.
{
 const sim=emptyDrive();sim.setControlMode('manual');sim.ego.v=0;
 const car=sim.traffic.addTestVehicle('car',1,190,40,40);car.brakeTestDelay=100;car.changeCooldown=999;
 const ped=sim.pedestrians.add({s:200,fromD:0,toD:0,speed:0});ped.state='crossing';
 sim.step(.5);
 assert(ped.collided&&car.disabled,'fast NPC tunneled through a pedestrian between frames');
 assert.equal(sim.traffic.contactCount,1);
 assert(car.s<200,'NPC stopped beyond the pedestrian instead of at first contact');
 console.log('ambient contacts: high-speed swept vehicle/pedestrian contact stops before crossing');
}
console.log('ADAS-RUNTIME-AUDIT PASS');
