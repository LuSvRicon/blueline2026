import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
export async function geometryOnly(path) {
 const data=fs.readFileSync(path),length=data.readUInt32LE(12);
 const json=JSON.parse(data.subarray(20,20+length));
 delete json.images;delete json.textures;
 json.materials=json.materials.map(material=>({name:material.name,doubleSided:material.doubleSided,alphaMode:material.alphaMode,alphaCutoff:material.alphaCutoff,pbrMetallicRoughness:{baseColorFactor:material.pbrMetallicRoughness?.baseColorFactor},emissiveFactor:material.emissiveFactor,extras:material.extras}));
 const text=Buffer.from(JSON.stringify(json));const padded=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(padded);
 const binary=data.subarray(20+length),out=Buffer.alloc(20+padded.length+binary.length);
 data.copy(out,0,0,12);out.writeUInt32LE(out.length,8);out.writeUInt32LE(padded.length,12);out.writeUInt32LE(0x4e4f534a,16);padded.copy(out,20);binary.copy(out,20+padded.length);
 return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(out.buffer.slice(out.byteOffset,out.byteOffset+out.byteLength),'');
}
if(process.argv[1]?.endsWith('inspect-vehicle-assets.mjs')) for(const path of process.argv.slice(2)){
 const gltf=await geometryOnly(path); gltf.scene.rotation.y=Math.PI/2;gltf.scene.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(gltf.scene,true);console.log(path,bounds.min.toArray(),bounds.max.toArray());
 const rows=[];gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh && /lop|tire|tyre|rim|light|lamp|den_xe|redglass|RED_GLASS/i.test(o.material.name)){
 const box=new THREE.Box3().setFromObject(o,true);rows.push({name:o.name,mat:o.material.name,c:box.getCenter(new THREE.Vector3()).toArray().map(n=>+n.toFixed(3)),s:box.getSize(new THREE.Vector3()).toArray().map(n=>+n.toFixed(3))});}});console.log(JSON.stringify(rows.slice(0,25)));
}
