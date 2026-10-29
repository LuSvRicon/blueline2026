import * as THREE from 'three';
import {Road} from '../world/Road.ts';
import {StaticWorld} from '../world/StaticWorld.ts';
import {WORLD_ASSETS,requestWorldAsset,worldAsset,extractWorldParts,groundAndCenter} from './WorldAssets.ts';

/** Real downloaded geometry, placed outside the traffic corridor. No extra render loop. */
export class WorldSceneryView {
 readonly group=new THREE.Group();
 readonly buildings=new THREE.Group();
 constructor(private road:Road,private world?:StaticWorld){
  this.group.name='ImportedStreetFurniture';this.buildings.name='HanoiTubeHouses';
  for(const asset of WORLD_ASSETS)void requestWorldAsset(asset.id);
  void requestWorldAsset('hanoi').then(()=>this.addHouses());
  void requestWorldAsset('roads_city').then(()=>this.addFurniture());
  void requestWorldAsset('roads_modular').then(()=>this.addAccessRoads());
  this.addPlanting();
 }
 private instance(template:THREE.Group,placements:{s:number;d:number;scale?:number;turn?:number}[],target:THREE.Group):void{
  template.updateMatrixWorld(true);const dummy=new THREE.Object3D();
  template.traverse(o=>{
   if(!(o instanceof THREE.Mesh))return;
   const mesh=new THREE.InstancedMesh(o.geometry,o.material,placements.length);mesh.name=o.name;mesh.castShadow=mesh.receiveShadow=true;
   placements.forEach((p,i)=>{const world=this.road.path.toCartesian(p.s,p.d);dummy.position.set(world.x,.045,world.y);dummy.rotation.set(0,-world.heading+(p.turn??0),0);dummy.scale.setScalar(p.scale??1);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix.clone().multiply(o.matrixWorld));});
   mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();target.add(mesh);
  });
 }
 private addHouses():void{
  const source=worldAsset('hanoi');if(!source||this.road.profile?.environment==='rural')return;
  const template=extractWorldParts(source,()=>true);groundAndCenter(template);
  template.traverse(o=>{if(o instanceof THREE.Mesh){const m=o.material as THREE.MeshStandardMaterial;
    const colors:Record<string,number>={Mat_Facade_Blue:0x90a6ae,Mat_Facade_Cream:0xd5c5a9,Mat_Facade_Green:0x95ac96,Mat_Facade_Yellow:0xc6ad71,Mat_SideWall:0x878580};
    if(colors[m.name])m.color.setHex(colors[m.name]);
  }});
  const placements:{s:number;d:number;scale:number;turn:number}[]=[],L=this.road.path.length;
  const step=this.road.profile?.environment==='suburban'?150:80;
  for(let s=45;s<L;s+=step){
   if(this.road.path.maxCurvatureAhead(s-30,60)>.009)continue;
   if(Math.abs(s-L*.4)<55)continue; // access road has an open forecourt
   for(const side of [-1,1])placements.push({s,d:side*(this.road.totalWidth/2+24),scale:.9,turn:side>0?0:Math.PI});
  }
  this.instance(template,placements,this.buildings);
  placements.forEach((p,i)=>{const w=this.road.path.toCartesian(p.s,p.d);this.world?.add({id:`hanoi:${i}`,kind:'building',x:w.x,y:w.y,yaw:w.heading,length:42.7*p.scale,width:30*p.scale});});
 }
 private addFurniture():void{
  const source=worldAsset('roads_city');if(!source)return;
  const bench=extractWorldParts(source,m=>/^Object_(59|60)$/.test(m.name));groundAndCenter(bench);
  if(this.road.profile?.motorway)return;
  const placements=[];
  for(let s=65;s<this.road.path.length;s+=190)if(this.road.path.maxCurvatureAhead(s,15)<.01)placements.push({s,d:-(this.road.totalWidth/2+2.2),scale:1.5});
  this.instance(bench,placements,this.group);
  placements.forEach((p,i)=>{const w=this.road.path.toCartesian(p.s,p.d);this.world?.add({id:`bench:${i}`,kind:'furniture',x:w.x,y:w.y,yaw:w.heading,length:2.3,width:1.46});});
  // A separate bus-stop nameplate avoids importing a static, misleading traffic signal.
  if(typeof document!=='undefined'){
   const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
   const ctx=canvas.getContext('2d')!;ctx.fillStyle='#155c78';ctx.fillRect(0,0,512,128);ctx.fillStyle='white';ctx.font='bold 36px sans-serif';ctx.textAlign='center';ctx.fillText('ĐIỂM DỪNG XE BUÝT',256,79);
   const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
   const sign=new THREE.Group(),pole=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,2.8,8),new THREE.MeshStandardMaterial({color:0x7e8789,roughness:.7}));pole.position.y=1.4;
   const board=new THREE.Mesh(new THREE.BoxGeometry(2.1,.55,.05),new THREE.MeshStandardMaterial({map:texture,roughness:.75}));board.position.y=2.5;sign.add(pole,board);
   this.instance(sign,placements.filter((_,i)=>i%2===0),this.group);
  }
 }
 private addAccessRoads():void{
  const source=worldAsset('roads_modular');if(!source||this.road.profile?.motorway)return;
  const road=extractWorldParts(source,m=>m.name.startsWith('Road_1X_Straight_'));const size=groundAndCenter(road);
  // The kit uses centimetre-like units; normalize a full module to 30 x 7 m.
  road.scale.set(30/size.x,1,7/size.z);road.updateMatrixWorld(true);
  this.instance(road,[{s:this.road.path.length*.4,d:this.road.totalWidth/2+15,turn:-Math.PI/2}],this.group);
 }
 private addPlanting():void{
  const motorway=this.road.profile?.motorway,half=this.road.totalWidth/2;
  const tree=new THREE.Group();
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.14,.23,3.1,7),new THREE.MeshStandardMaterial({color:0x635140,roughness:1}));trunk.position.y=1.55;
  const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.7,2),new THREE.MeshStandardMaterial({color:0x355b37,roughness:.95}));crown.position.y=3.65;crown.scale.set(1,1.3,1);tree.add(trunk,crown);
  const placements=[];for(let s=12;s<this.road.path.length;s+=motorway?45:30)for(const side of [-1,1])placements.push({s,d:side*(half+(motorway?9:5.2)),scale:.85+(Math.sin(s*1.7)+1)*.15});
  this.instance(tree,placements,this.group);
  placements.forEach((p,i)=>{const w=this.road.path.toCartesian(p.s,p.d);this.world?.add({id:`tree:${i}`,kind:'tree',x:w.x,y:w.y,yaw:0,length:.46*p.scale,width:.46*p.scale});});
 }
}
