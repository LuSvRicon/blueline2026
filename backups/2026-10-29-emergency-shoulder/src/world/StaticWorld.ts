import {Body2D} from '../core/collision.ts';
import {Road} from './Road.ts';

export interface StaticBody extends Body2D {id:string;kind:'building'|'tree'|'barrier'|'furniture';}
/** Ground-plane collision registry shared by scene builders and simulation.
 * A uniform grid keeps swept queries local even on the 6 km motorway. */
export class StaticWorld {
 private cells=new Map<string,Set<StaticBody>>();
 private bodies=new Map<string,StaticBody>();
 constructor(road?:Road){
  if(!road)return;
  const offsets:number[]=[];
  if(road.median)offsets.push(road.centerDivider);
  if(road.profile?.motorway)offsets.push(-road.totalWidth/2-1,road.totalWidth/2+1);
  for(const d of offsets)for(let s=0;s<road.path.length;s+=5){
   const end=Math.min(s+5,road.path.length),a=road.path.toCartesian(s,d),b=road.path.toCartesian(end,d);
   this.add({id:`rail:${d}:${s}`,kind:'barrier',x:(a.x+b.x)/2,y:(a.y+b.y)/2,yaw:Math.atan2(b.y-a.y,b.x-a.x),length:Math.hypot(b.x-a.x,b.y-a.y)+.12,width:d===road.centerDivider?road.median:.2});
  }
 }
 get count():number{return this.bodies.size;}
 add(body:StaticBody):void{
  if(this.bodies.has(body.id))return;
  this.bodies.set(body.id,body);
  const c=Math.abs(Math.cos(body.yaw)),s=Math.abs(Math.sin(body.yaw));
  const hx=(c*body.length+s*body.width)/2,hy=(s*body.length+c*body.width)/2;
  this.eachCell(body.x-hx,body.y-hy,body.x+hx,body.y+hy,key=>{if(!this.cells.has(key))this.cells.set(key,new Set());this.cells.get(key)!.add(body);});
 }
 query(minX:number,minY:number,maxX:number,maxY:number):StaticBody[]{
  const found=new Set<StaticBody>();this.eachCell(minX,minY,maxX,maxY,key=>this.cells.get(key)?.forEach(body=>found.add(body)));return [...found];
 }
 near(x:number,y:number,radius:number):StaticBody[]{return this.query(x-radius,y-radius,x+radius,y+radius);}
 private eachCell(x0:number,y0:number,x1:number,y1:number,visit:(key:string)=>void):void{
  for(let x=Math.floor(x0/32);x<=Math.floor(x1/32);x++)for(let y=Math.floor(y0/32);y<=Math.floor(y1/32);y++)visit(`${x},${y}`);
 }
}
