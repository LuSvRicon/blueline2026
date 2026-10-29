import fs from 'node:fs';
import * as THREE from 'three';
import {geometryOnly} from './inspect-vehicle-assets.mjs';
const names=['ola_electric_scooter_black_color','low-poly_motorcycle__2','low_poly_hanoi_vietnamese_tube_houses_block','modular_road_pack_free__4k_textures','modular_city_road_pack__game_ready','modular_roads_pack','tata_signa_cargo_truck__low_poly_game_ready_pbr','city_bus'];
for(const name of names){
 const path=`C:/Users/KHOA DANG/Downloads/${name}.glb`,data=fs.readFileSync(path);
 const json=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)));
 const gltf=await geometryOnly(path);gltf.scene.updateMatrixWorld(true);
 const box=new THREE.Box3().setFromObject(gltf.scene,true),meshes=[];
 gltf.scene.traverse(o=>{if(o.isMesh){const b=new THREE.Box3().setFromObject(o,true);meshes.push({name:o.name,mat:o.material.name,size:b.getSize(new THREE.Vector3()).toArray().map(v=>+v.toFixed(2)),center:b.getCenter(new THREE.Vector3()).toArray().map(v=>+v.toFixed(2))});}});
 console.log(JSON.stringify({name,bytes:data.length,asset:json.asset,size:box.getSize(new THREE.Vector3()).toArray(),meshes:meshes.length,parts:meshes.slice(0,name.includes('modular')?35:12)}));
}
