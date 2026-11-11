import * as THREE from 'three';
import {Road} from '../world/Road.ts';
import {StaticWorld} from '../world/StaticWorld.ts';
import {WORLD_ASSETS,requestWorldAsset,worldAsset,extractWorldParts,groundAndCenter} from './WorldAssets.ts';
import {addSpatialInstances} from './SpatialInstances.ts';

let cachedHanoiTemplate:THREE.Group|null=null;
let cachedBenchTemplate:THREE.Group|null=null;
let cachedAccessRoadTemplate:THREE.Group|null=null;

function deferBuild(fn:()=>void):void{
 if(typeof window!=='undefined'&&typeof window.requestAnimationFrame==='function'){
  window.requestAnimationFrame(()=>fn());
 }else{
  fn();
 }
}

/** Real downloaded geometry, placed outside the traffic corridor. No extra render loop. */
export class WorldSceneryView {
 readonly group=new THREE.Group();
 readonly buildings=new THREE.Group();
 constructor(private road:Road,private world?:StaticWorld){
  this.group.name='ImportedStreetFurniture';this.buildings.name='HanoiTubeHouses';
  // Stagger background traffic asset warmups so startup bandwidth & main-thread decode stay smooth.
  void requestWorldAsset('hanoi').then(()=>deferBuild(()=>this.addHouses()));
  void requestWorldAsset('roads_city').then(()=>deferBuild(()=>this.addFurniture()));
  void requestWorldAsset('roads_modular').then(()=>deferBuild(()=>this.addAccessRoads()));
  if(typeof window!=='undefined'){
   window.setTimeout(()=>{
    for(const asset of WORLD_ASSETS){
     if(asset.id!=='hanoi'&&asset.id!=='roads_city'&&asset.id!=='roads_modular')void requestWorldAsset(asset.id);
    }
   },180);
  }else{
   for(const asset of WORLD_ASSETS)void requestWorldAsset(asset.id);
  }
  this.addPlanting();
 }
 private instance(template:THREE.Group,placements:{s:number;d:number;scale?:number;turn?:number}[],target:THREE.Group,castShadow=true):void{
  if(!placements.length)return;
  template.updateMatrixWorld(true);const dummy=new THREE.Object3D();
  template.traverse(o=>{
   if(!(o instanceof THREE.Mesh))return;
   const instances=placements.map(p=>{const world=this.road.path.toCartesian(p.s,p.d);dummy.position.set(world.x,.045,world.y);dummy.rotation.set(0,-world.heading+(p.turn??0),0);dummy.scale.setScalar(p.scale??1);dummy.updateMatrix();return {matrix:dummy.matrix.clone().multiply(o.matrixWorld)};});
   addSpatialInstances(target,o.geometry,o.material,instances,{name:o.name,castShadow,receiveShadow:true});
  });
 }
 private addHouses():void{
  const source=worldAsset('hanoi');if(!source||this.road.profile?.environment==='rural')return;
  if(!cachedHanoiTemplate){
   const template=extractWorldParts(source,()=>true);groundAndCenter(template);
   template.traverse(o=>{if(o instanceof THREE.Mesh){const m=o.material as THREE.MeshStandardMaterial;
    const colors:Record<string,number>={Mat_Facade_Blue:0x90a6ae,Mat_Facade_Cream:0xd5c5a9,Mat_Facade_Green:0x95ac96,Mat_Facade_Yellow:0xc6ad71,Mat_SideWall:0x878580};
    if(colors[m.name])m.color.setHex(colors[m.name]);
   }});
   cachedHanoiTemplate=template;
  }
  const placements:{s:number;d:number;scale:number;turn:number}[]=[],L=this.road.path.length;
  const step=this.road.profile?.environment==='suburban'?150:80;
  for(let s=45;s<L;s+=step){
   if(this.road.path.maxCurvatureAhead(s-30,60)>.009)continue;
   if(Math.abs(s-L*.4)<55)continue; // access road has an open forecourt
   for(const side of [-1,1])placements.push({s,d:side*(this.road.totalWidth/2+24),scale:.9,turn:side>0?0:Math.PI});
  }
  this.instance(cachedHanoiTemplate,placements,this.buildings,true);
  placements.forEach((p,i)=>{const w=this.road.path.toCartesian(p.s,p.d);this.world?.add({id:`hanoi:${i}`,kind:'building',x:w.x,y:w.y,yaw:w.heading,length:42.7*p.scale,width:30*p.scale});});
 }
 private addFurniture():void{
  const source=worldAsset('roads_city');if(!source)return;
  if(!cachedBenchTemplate){
   const bench=extractWorldParts(source,m=>/^Object_(59|60)$/.test(m.name));groundAndCenter(bench);
   cachedBenchTemplate=bench;
  }
  if(this.road.profile?.motorway)return;
  const placements=[];
  for(let s=65;s<this.road.path.length;s+=190)if(this.road.path.maxCurvatureAhead(s,15)<.01)placements.push({s,d:-(this.road.totalWidth/2+2.2),scale:1.5});
  this.instance(cachedBenchTemplate,placements,this.group,false);
  placements.forEach((p,i)=>{const w=this.road.path.toCartesian(p.s,p.d);this.world?.add({id:`bench:${i}`,kind:'furniture',x:w.x,y:w.y,yaw:w.heading,length:2.3,width:1.46});});
  // A separate bus-stop nameplate avoids importing a static, misleading traffic signal.
  if(typeof document!=='undefined'){
   const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
   const ctx=canvas.getContext('2d')!;ctx.fillStyle='#155c78';ctx.fillRect(0,0,512,128);ctx.fillStyle='white';ctx.font='bold 36px sans-serif';ctx.textAlign='center';ctx.fillText('ĐIỂM DỪNG XE BUÝT',256,79);
   const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
   const sign=new THREE.Group(),pole=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,2.8,8),new THREE.MeshStandardMaterial({color:0x7e8789,roughness:.7}));pole.position.y=1.4;
   const board=new THREE.Mesh(new THREE.BoxGeometry(2.1,.55,.05),new THREE.MeshStandardMaterial({map:texture,roughness:.75}));board.position.y=2.5;sign.add(pole,board);
   this.instance(sign,placements.filter((_,i)=>i%2===0),this.group,false);
  }
 }
 private addAccessRoads():void{
  const source=worldAsset('roads_modular');if(!source||this.road.profile?.motorway)return;
  if(!cachedAccessRoadTemplate){
   const road=extractWorldParts(source,m=>m.name.startsWith('Road_1X_Straight_'));const size=groundAndCenter(road);
   // The kit uses centimetre-like units; normalize a full module to 30 x 7 m.
   road.scale.set(30/size.x,1,7/size.z);road.updateMatrixWorld(true);
   cachedAccessRoadTemplate=road;
  }
  this.instance(cachedAccessRoadTemplate,[{s:this.road.path.length*.4,d:this.road.totalWidth/2+15,turn:-Math.PI/2}],this.group,false);
 }
 private addPlanting():void{
  const motorway=this.road.profile?.motorway,half=this.road.totalWidth/2;
  const tree=new THREE.Group();
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.14,.23,3.1,6),new THREE.MeshStandardMaterial({color:0x635140,roughness:1}));trunk.position.y=1.55;
  const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.7,1),new THREE.MeshStandardMaterial({color:0x365f3a,roughness:.88}));crown.position.y=3.65;crown.scale.set(1,1.3,1);tree.add(trunk,crown);
  const placements=[];for(let s=12;s<this.road.path.length;s+=motorway?45:30)for(const side of [-1,1])placements.push({s,d:side*(half+(motorway?9:5.2)),scale:.85+(Math.sin(s*1.7)+1)*.15});
  this.instance(tree,placements,this.group,true);
  placements.forEach((p,i)=>{const w=this.road.path.toCartesian(p.s,p.d);this.world?.add({id:`tree:${i}`,kind:'tree',x:w.x,y:w.y,yaw:0,length:.46*p.scale,width:.46*p.scale});});
 }
}
