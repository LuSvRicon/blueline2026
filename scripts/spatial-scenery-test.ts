import assert from 'node:assert/strict';
import * as THREE from 'three';
import {addSpatialInstances, StaticInstance} from '../src/render/SpatialInstances.ts';
// @ts-expect-error Node-only loader for the supplied GLB geometry.
import {geometryOnly} from './inspect-vehicle-assets.mjs';
import {extractWorldParts, groundAndCenter} from '../src/render/WorldAssets.ts';

function frustum(camera:THREE.PerspectiveCamera) {
  camera.updateMatrixWorld(true);
  return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
}
const geometry=new THREE.BoxGeometry(12,20,14).translate(220,10,-150);
const material=new THREE.MeshStandardMaterial();
const parent=new THREE.Group();
const instances:StaticInstance[]=[];
for(let x=-600;x<=600;x+=50)for(let z=-600;z<=600;z+=50) {
  const matrix=new THREE.Matrix4().compose(new THREE.Vector3(x,0,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),x*.01),new THREE.Vector3(1,1.2,1));
  instances.push({matrix,color:new THREE.Color((x+600)/1200,.5,(z+600)/1200)});
}
const meshes=addSpatialInstances(parent,geometry,material,instances,{name:'house',castShadow:true,receiveShadow:true,renderOrder:2});
assert.equal(meshes.reduce((sum,m)=>sum+m.count,0),instances.length);
assert(meshes.length>1);
const expected=new Map(instances.map(instance=>[instance.matrix.elements.map(n=>n.toFixed(3)).join(','),instance]));
const actual=new THREE.Matrix4(),color=new THREE.Color();
for(const mesh of meshes) {
  assert.equal(mesh.geometry,geometry); assert.equal(mesh.material,material);
  assert.equal(mesh.castShadow,true);assert.equal(mesh.receiveShadow,true);assert.equal(mesh.renderOrder,2);
  for(let i=0;i<mesh.count;i++) {
    mesh.getMatrixAt(i,actual);mesh.getColorAt(i,color);
    const key=actual.elements.map(n=>n.toFixed(3)).join(','),expectedInstance=expected.get(key);
    assert(expectedInstance,'Spatial batching moved or duplicated a house');
    assert(Math.abs(color.r-expectedInstance.color!.r)<1e-6&&Math.abs(color.g-expectedInstance.color!.g)<1e-6&&Math.abs(color.b-expectedInstance.color!.b)<1e-6);
    const bounds=geometry.boundingBox!.clone().applyMatrix4(actual);
    assert(mesh.boundingBox!.containsBox(bounds),'An off-origin or boundary-crossing house escaped its culling bound');
    expected.delete(key);
  }
}
assert.equal(expected.size,0,'A static instance was silently dropped');

// Each independent camera must retain every actually visible instance. Main
// camera culling must not hide houses needed by a rear mirror or surround view.
for(const [x,z,yaw]of [[0,0,0],[90,110,Math.PI],[-200,-200,Math.PI/2],[100,100,-Math.PI/2]]) {
  const camera=new THREE.PerspectiveCamera(65,1.8,.04,430);
  camera.position.set(x,12,z);camera.lookAt(x+Math.sin(yaw)*100,12,z-Math.cos(yaw)*100);
  const f=frustum(camera);parent.updateMatrixWorld(true);
  let rendered=0,visible=0;
  for(const mesh of meshes) {
    const chunkVisible=f.intersectsObject(mesh);if(chunkVisible)rendered+=mesh.count;
    for(let i=0;i<mesh.count;i++) {
      mesh.getMatrixAt(i,actual);
      if(f.intersectsBox(geometry.boundingBox!.clone().applyMatrix4(actual))) {
        visible++;assert(chunkVisible,'A visible building disappeared from one of the camera views');
      }
    }
  }
  assert(visible>0 && rendered<instances.length*.65,'Map-wide off-screen instances are still submitted for drawing');
}

// Repeat the draw-work check using the actual downloaded Hanoi geometry, not
// just cubes; keep full vertex detail and shared materials in all chunks.
const {scene}=await geometryOnly('public/models/world/hanoi.glb');
const houses=extractWorldParts(scene,()=>true);groundAndCenter(houses);houses.updateMatrixWorld(true);
const camera=new THREE.PerspectiveCamera(65,1.8,.1,430);camera.position.set(0,2,10);camera.lookAt(0,2,-100);
const f=frustum(camera),groups=new THREE.Group();let mapTriangles=0,submittedTriangles=0;
houses.traverse(object=>{
  if(!(object instanceof THREE.Mesh))return;
  const placements:StaticInstance[]=[];
  for(let z=-800;z<=800;z+=80)for(const x of [-35,35])placements.push({matrix:new THREE.Matrix4().makeTranslation(x,0,z).multiply(object.matrixWorld)});
  const triangles=(object.geometry.index?.count??object.geometry.getAttribute('position').count)/3;
  mapTriangles+=triangles*placements.length;
  for(const mesh of addSpatialInstances(groups,object.geometry,object.material,placements))if(f.intersectsObject(mesh))submittedTriangles+=triangles*mesh.count;
});
assert(submittedTriangles>0 && submittedTriangles<mapTriangles*.65);
assert.throws(()=>addSpatialInstances(parent,geometry,material,instances,{},0));
console.log(`SPATIAL SCENERY PASS — exact matrices/colors/resources, four camera frusta, actual Hanoi triangles ${Math.round(mapTriangles)} → ${Math.round(submittedTriangles)} submitted in the fixture; full visible detail preserved.`);
