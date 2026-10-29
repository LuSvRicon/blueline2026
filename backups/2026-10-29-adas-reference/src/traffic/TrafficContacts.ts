import {Body2D,bodyContact,interpolateBody,sweepBodies} from '../core/collision.ts';
import {Road} from '../world/Road.ts';
import type {TrafficCar} from './TrafficManager.ts';
/** Ordinary vehicles pause after a vehicle impact. Broken-down, perpendicular
 * and pedestrian/static crashes keep their explicit non-drivable state. */
export function stopTrafficAfterImpact(car:TrafficCar):void{
 if(!car.disabled&&car.kind!=='stalled'&&!car.crossing)car.impactPause=3;
 car.v=0;car.disabled=true;car.stopReason='collision';
}
export function trafficBody(car:TrafficCar,road:Road):Body2D{
 const p=road.path.toCartesian(car.s,car.d);
 return {x:p.x,y:p.y,yaw:p.heading+(car.headingOffset??0),length:car.length,width:car.width};
}
/** Last line of defence, not an AI manoeuvre: contacts stop both actors at the
 * first swept contact and separate their bodies. No lateral "dodge" on impact. */
export function resolveTrafficContacts(cars:TrafficCar[],before:Map<number,Body2D>,road:Road):number{
 let count=0;
 const ends=new Map(cars.map(car=>[car.id,trafficBody(car,road)]));
 const cells=new Map<string,number[]>(),pairs=new Set<string>();
 cars.forEach((car,i)=>{
  const start=before.get(car.id),end=ends.get(car.id);if(!start||!end)return;
  const r=Math.hypot(car.length,car.width)/2+.1;
  for(let x=Math.floor((Math.min(start.x,end.x)-r)/16);x<=Math.floor((Math.max(start.x,end.x)+r)/16);x++)for(let y=Math.floor((Math.min(start.y,end.y)-r)/16);y<=Math.floor((Math.max(start.y,end.y)+r)/16);y++){
   const key=`${x},${y}`,list=cells.get(key)??[];for(const j of list)pairs.add(`${j}:${i}`);list.push(i);cells.set(key,list);
  }
 });
 const ordered=[...pairs].map(pair=>pair.split(':').map(Number)).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 for(const [i,j]of ordered){
  const a=cars[i],b=cars[j],a0=before.get(a.id),b0=before.get(b.id);if(!a0||!b0)continue;
  let a1=ends.get(a.id)!,b1=ends.get(b.id)!;
  const radius=(Math.hypot(a.length,a.width)+Math.hypot(b.length,b.width))/2+.2;
  const motion=Math.hypot(a1.x-a0.x,a1.y-a0.y)+Math.hypot(b1.x-b0.x,b1.y-b0.y);
  if(Math.hypot(a0.x-b0.x,a0.y-b0.y)>radius+motion)continue;
  const hit=sweepBodies(a0,a1,b0,b1,.03);if(!hit)continue;
  a1=interpolateBody(a0,a1,Math.max(0,hit.time-.0001));b1=interpolateBody(b0,b1,Math.max(0,hit.time-.0001));
  const contact=bodyContact(a1,b1,.04);
  if(contact){const shift=(contact.depth+.001)/2;a1.x+=contact.nx*shift;a1.y+=contact.ny*shift;b1.x-=contact.nx*shift;b1.y-=contact.ny*shift;}
  for(const [car,body]of [[a,a1],[b,b1]] as const){const f=road.path.toFrenet(body.x,body.y);car.s=f.s;car.d=f.d;stopTrafficAfterImpact(car);}
  ends.set(a.id,a1);ends.set(b.id,b1);
  count++;
 }
 return count;
}
