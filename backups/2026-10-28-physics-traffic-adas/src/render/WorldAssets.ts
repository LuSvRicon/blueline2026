import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export const WORLD_ASSETS = [
  {id:'ola',name:'Xe tay ga OLA',file:'ola.glb',author:'neshallads',source:'https://sketchfab.com/3d-models/ola-electric-scooter-black-color-7b0cac285c654c248cecec50f97d459a'},
  {id:'motorcycle',name:'Hai mẫu xe máy Sidra',file:'motorcycle.glb',author:'Sidra',source:'https://sketchfab.com/3d-models/low-poly-motorcycle-2-9e79295e99654e2a9fa930b5139a7d84'},
  {id:'tata',name:'Xe tải container Tata Signa',file:'tata.glb',author:'kevin_k_5124',source:'https://sketchfab.com/3d-models/tata-signa-cargo-truck-low-poly-game-ready-pbr-a5c03c1a1c2c4b21b7db6192b1ef8718'},
  {id:'bus',name:'Xe buýt đô thị',file:'bus.glb',author:'PolyLabs',source:'https://sketchfab.com/3d-models/city-bus-dd99ebfc07e54d4fa674fd07b4bbef92'},
  {id:'hanoi',name:'Dãy nhà ống Hà Nội',file:'hanoi.glb',author:'RimiChama',source:'https://sketchfab.com/3d-models/low-poly-hanoi-vietnamese-tube-houses-block-e900c122f3b3491d98349385e04c700c'},
  {id:'roads_pbr',name:'Bộ đường PBR',file:'roads_pbr.glb',author:'intfloat',source:'https://sketchfab.com/3d-models/modular-road-pack-free-4k-textures-b84f5cc449ff49e38d853ea393e35885'},
  {id:'roads_city',name:'Đường phố & trạm xe buýt',file:'roads_city.glb',author:'Salah3D',source:'https://sketchfab.com/3d-models/modular-city-road-pack-game-ready-d9df5cfa079f4da8a18ef1372c00d01c'},
  {id:'roads_modular',name:'Bộ đường mô-đun',file:'roads_modular.glb',author:'Mini Loft Games / SquadCell',source:'https://sketchfab.com/3d-models/modular-roads-pack-99023ee0b2564395b47b40d22f51f7c2'},
] as const;
export type WorldAssetId=typeof WORLD_ASSETS[number]['id'];
const scenes=new Map<WorldAssetId,THREE.Group>(), pending=new Map<WorldAssetId,Promise<void>>(),errors=new Set<WorldAssetId>();
export const worldAsset=(id:WorldAssetId)=>scenes.get(id);
export const worldAssetStatus=()=>({loaded:scenes.size,total:WORLD_ASSETS.length,failed:errors.size});
export function requestWorldAsset(id:WorldAssetId):Promise<void>{
 if(pending.has(id))return pending.get(id)!;
 const info=WORLD_ASSETS.find(a=>a.id===id)!;
 const promise=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env?.BASE_URL??'/'}models/world/${info.file}`)
  .then(gltf=>{gltf.scene.updateMatrixWorld(true);scenes.set(id,gltf.scene);})
  .catch(error=>{errors.add(id);console.warn(`Không tải được ${info.name}`,error);});
 pending.set(id,promise);return promise;
}
/** Decode normalized integer attributes before baking world transforms. */
export function bakedMesh(mesh:THREE.Mesh,matrix=mesh.matrixWorld):THREE.Mesh{
 const geometry=mesh.geometry.clone();
 for(const [name,a]of Object.entries(geometry.attributes)){
  const values=new Float32Array(a.count*a.itemSize);
  for(let i=0;i<a.count;i++)for(let j=0;j<a.itemSize;j++)values[i*a.itemSize+j]=[a.getX(i),a.getY(i),a.getZ(i),a.getW(i)][j];
  geometry.setAttribute(name,new THREE.BufferAttribute(values,a.itemSize));
 }
 geometry.applyMatrix4(matrix);geometry.computeBoundingBox();
 const material=Array.isArray(mesh.material)?mesh.material.map(m=>m.clone()):mesh.material.clone();
 const out=new THREE.Mesh(geometry,material);out.name=mesh.name;out.castShadow=out.receiveShadow=true;out.userData.sharedVehicleAsset=true;
 for(const m of Array.isArray(material)?material:[material])if(m instanceof THREE.MeshStandardMaterial){
  m.roughness=Math.max(.3,m.roughness);for(const v of Object.values(m))if(v instanceof THREE.Texture)v.anisotropy=8;
 }
 return out;
}
export function extractWorldParts(source:THREE.Group,filter:(mesh:THREE.Mesh)=>boolean):THREE.Group{
 source.updateMatrixWorld(true);const group=new THREE.Group();
 source.traverse(o=>{if(o instanceof THREE.Mesh&&filter(o))group.add(bakedMesh(o));});return group;
}
export function groundAndCenter(group:THREE.Group):THREE.Vector3{
 const box=new THREE.Box3().setFromObject(group,true),center=box.getCenter(new THREE.Vector3());
 for(const child of group.children)child.position.add(new THREE.Vector3(-center.x,-box.min.y,-center.z));
 group.updateMatrixWorld(true);return box.getSize(new THREE.Vector3());
}
function triangles(flat:THREE.BufferGeometry,ids:number[]):THREE.BufferGeometry{
 const result=new THREE.BufferGeometry();
 for(const [name,a]of Object.entries(flat.attributes)){
  const values=new Float32Array(ids.length*a.itemSize);ids.forEach((index,i)=>{for(let j=0;j<a.itemSize;j++)values[i*a.itemSize+j]=[a.getX(index),a.getY(index),a.getZ(index),a.getW(index)][j];});result.setAttribute(name,new THREE.BufferAttribute(values,a.itemSize));
 }result.computeBoundingBox();return result;
}
function busWheels(group:THREE.Group,mesh:THREE.Mesh):void{
 const flat=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry,p=flat.getAttribute('position'),buckets=Array.from({length:5},()=>[] as number[]);
 const hubs=[new THREE.Vector3(2.64,.54,-.95),new THREE.Vector3(2.64,.54,.95),new THREE.Vector3(-3.38,.54,-.95),new THREE.Vector3(-3.38,.54,.95)];
 for(let i=0;i<p.count;i+=3){
  const c=new THREE.Vector3();for(let j=0;j<3;j++)c.add(new THREE.Vector3().fromBufferAttribute(p,i+j));c.multiplyScalar(1/3);
  const hub=hubs.findIndex(h=>Math.hypot(c.x-h.x,c.y-h.y)<.57&&Math.abs(c.z-h.z)<.22);
  buckets[hub+1].push(i,i+1,i+2);
 }
 mesh.geometry=triangles(flat,buckets[0]);
 hubs.forEach((h,i)=>{if(!buckets[i+1].length)return;const geometry=triangles(flat,buckets[i+1]);geometry.translate(-h.x,-h.y,-h.z);
  const pivot=new THREE.Group(),spin=new THREE.Group();pivot.name=`Wheel${i<2?'Front':'Rear'}${group.children.length}`;pivot.position.copy(h);pivot.userData.radius=.54;
  spin.add(new THREE.Mesh(geometry,mesh.material));pivot.add(spin);group.add(pivot);
 });
}

/** Traffic-only rigs. Four selectable driver vehicles and their cabin rigs stay separate. */
export function prepareTrafficAsset(source:THREE.Group,id:'ola'|'motorcycle'|'motorcycle_alt'|'tata'|'bus'):THREE.Group{
 const group=extractWorldParts(source,mesh=>{
  if(!id.startsWith('motorcycle'))return true;
  const x=new THREE.Box3().setFromObject(mesh,true).getCenter(new THREE.Vector3()).x;
  return id==='motorcycle'?x<0:x>0;
 });
 const rotation=new THREE.Matrix4().makeRotationY(id==='bus'?0:id==='motorcycle_alt'?-Math.PI/2:Math.PI/2);
 for(const child of group.children)(child as THREE.Mesh).geometry.applyMatrix4(rotation);
 const size=groundAndCenter(group);
 const length=id==='bus'?12:id==='tata'?15.3:1.9,width=id==='bus'?2.55:id==='tata'?2.5:.82;
 const scale=new THREE.Matrix4().makeScale(length/size.x,length/size.x,width/size.z);
 for(const child of [...group.children]){
  const mesh=child as THREE.Mesh;mesh.geometry.translate(mesh.position.x,mesh.position.y,mesh.position.z);mesh.position.set(0,0,0);mesh.geometry.applyMatrix4(scale);mesh.geometry.computeBoundingBox();
  const material=mesh.material as THREE.MeshStandardMaterial;
  if(/LightRed/i.test(mesh.name))material.name='Brakelight';
  if(/LightYellow$/.test(material.name))material.name='Headlight';
  if(id==='bus'&&/PlasticBlack|Chrome/.test(mesh.name))busWheels(group,mesh);
  // OLA combines both tyres into one mesh; split front/rear triangles before rigging.
  if(/wheel|tyer/i.test(mesh.name+' '+material.name)){
   group.remove(mesh);
   const flat=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry;
   const pos=flat.getAttribute('position');
   for(const front of [false,true]){
    const ids:number[]=[];
    for(let i=0;i<pos.count;i+=3)if(((pos.getX(i)+pos.getX(i+1)+pos.getX(i+2))/3>0)===front)ids.push(i,i+1,i+2);
    if(!ids.length)continue;
    const geometry=new THREE.BufferGeometry();
    for(const [name,a]of Object.entries(flat.attributes)){
     const values=new Float32Array(ids.length*a.itemSize);ids.forEach((index,i)=>{for(let j=0;j<a.itemSize;j++)values[i*a.itemSize+j]=[a.getX(index),a.getY(index),a.getZ(index),a.getW(index)][j];});geometry.setAttribute(name,new THREE.BufferAttribute(values,a.itemSize));
    }
    geometry.computeBoundingBox();const box=geometry.boundingBox!,hub=box.getCenter(new THREE.Vector3());
    geometry.translate(-hub.x,-hub.y,-hub.z);
    const pivot=new THREE.Group(),spin=new THREE.Group();pivot.name=`Wheel${front?'Front':'Rear'}${group.children.length}`;
    pivot.position.copy(hub);pivot.userData.radius=box.getSize(new THREE.Vector3()).y/2;spin.add(new THREE.Mesh(geometry,material));pivot.add(spin);group.add(pivot);
   }
  }
 }
 // Lamps remain event-driven even for models whose baked textures combine all lights.
 for(const front of [false,true])for(const side of [-1,1]){
  const lamp=new THREE.Mesh(new THREE.BoxGeometry(.04,.07,width*.13),new THREE.MeshStandardMaterial({color:front?0xe5e3cf:0x8f1014,emissive:front?0xf4f2de:0xf01818}));
  lamp.position.set((front?1:-1)*(length/2-.06),id==='bus'?.8:id==='tata'?.65:.6,side*width*.35);
  lamp.material.name=front?'Headlight':'Brakelight';group.add(lamp);
  const signal=new THREE.Mesh(new THREE.BoxGeometry(.05,.045,width*.12),new THREE.MeshStandardMaterial({color:0x8a5510,emissive:0xff8800}));signal.name='Turnsignal';signal.position.copy(lamp.position).y+=.09;group.add(signal);
 }
 group.traverse(o=>{if(o instanceof THREE.Mesh)o.userData.sharedVehicleAsset=true;});
 group.userData.assetDimensions={length,width};group.name=`traffic-${id}`;return group;
}
const templates=new Map<string,THREE.Group>();
export function trafficAsset(id:'ola'|'motorcycle'|'motorcycle_alt'|'tata'|'bus'):THREE.Group|undefined{
 if(!templates.has(id)){const source=worldAsset(id==='motorcycle_alt'?'motorcycle':id);if(source)templates.set(id,prepareTrafficAsset(source,id));else void requestWorldAsset(id==='motorcycle_alt'?'motorcycle':id);}
 return templates.get(id);
}
