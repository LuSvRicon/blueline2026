import assert from 'node:assert/strict';
// @ts-expect-error Node-only GLB geometry loader.
import {geometryOnly} from './inspect-vehicle-assets.mjs';
import * as THREE from 'three';
import {WORLD_ASSETS,prepareTrafficAsset,extractWorldParts,groundAndCenter} from '../src/render/WorldAssets.ts';
import {attachDetailedVehicle} from '../src/render/DetailedVehicle.ts';
for(const asset of WORLD_ASSETS){
 const {scene}=await geometryOnly(`public/models/world/${asset.file}`);
 let meshes=0;scene.traverse((o:THREE.Object3D)=>{if(o instanceof THREE.Mesh)meshes++;});assert(meshes>0,asset.id);
 if(['ola','motorcycle','bus','tata'].includes(asset.id))for(const id of asset.id==='motorcycle'?['motorcycle','motorcycle_alt']:[asset.id]){
  const prepared=prepareTrafficAsset(scene,id as 'ola'),box=new THREE.Box3().setFromObject(prepared,true),size=box.getSize(new THREE.Vector3());
  const expected=id==='bus'?12:id==='tata'?15.3:1.9;
  assert(Math.abs(size.x-expected)<.05,`${id}: actual length ${size.x}`);
  assert(Math.abs(box.min.y)<.015,`${id}: wheels must be grounded ${box.min.y}`);
  assert(Math.abs(box.getCenter(new THREE.Vector3()).x)<.03,`${id}: correctly centered, including imported centimetre-scale transforms`);
  assert(size.y>.7&&size.y<4,`${id}: height ${size.y}`);
  assert(prepared.children.filter(c=>c.name.startsWith('Wheel')).length>=2,`${id}: moving wheels`);
  const host=new THREE.Group(),shell=new THREE.Group();host.add(shell);host.userData.shell=shell;host.userData.wheels=[];host.userData.visualDims={length:expected,width:prepared.userData.assetDimensions.width};
  assert(attachDetailedVehicle(host,0xffffff,prepared));assert(host.userData.headLamps.length&&host.userData.brakeLamps.length,`${id}: lamps wired`);
  console.log(`${id}: ${size.toArray().map(v=>v.toFixed(2)).join(' x ')}m, wheels + lights PASS`);
 }else{
  const group=extractWorldParts(scene,()=>true);groundAndCenter(group);assert(new THREE.Box3().setFromObject(group,true).min.y>-.01);
  console.log(`${asset.id}: ${meshes} real source meshes PASS`);
 }
}
console.log('WORLD-ASSETS PASS — all eight supplied files, five traffic rigs, transforms, ground contact and event lamps.');
