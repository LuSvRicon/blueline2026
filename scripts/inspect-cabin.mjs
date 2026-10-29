import {geometryOnly} from './inspect-vehicle-assets.mjs';
import * as T from 'three';
export async function cabinGeometry(id){
 const {scene}=await geometryOnly(`public/models/imported/${id}.glb`);
 scene.rotation.y=Math.PI/2;scene.updateMatrixWorld(true);
 const b=new T.Box3().setFromObject(scene,true),s=b.getSize(new T.Vector3()),c=b.getCenter(new T.Vector3());
 const m=new T.Matrix4().makeScale(4.6/s.x,4.6/s.x,1.9/s.z).multiply(new T.Matrix4().makeTranslation(-c.x,-b.min.y,-c.z)),g=new T.Group();
 scene.traverse(o=>{if(o.isMesh){const a=o.geometry.getAttribute('position'),v=[];for(let i=0;i<a.count;i++)v.push(a.getX(i),a.getY(i),a.getZ(i));const geo=o.geometry.clone();geo.setAttribute('position',new T.Float32BufferAttribute(v,3));geo.applyMatrix4(m.clone().multiply(o.matrixWorld));const mesh=new T.Mesh(geo,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.name=o.name+'/'+o.material.name;g.add(mesh);}});
 g.updateMatrixWorld(true);return g;
}
if(process.argv[1]?.endsWith('inspect-cabin.mjs'))for(const id of ['santafe','civic']){
 const g=await cabinGeometry(id),eye=new T.Vector3(...(id==='santafe'?[.04,1.34,-.31]:[-.26,1.12,-.36]));
 console.log(id);
 for(const [y,z]of (id==='santafe'?[[1.05,-.25],[1.1,-.25],[1.15,-.25],[1.05,.1],[1.375,0]]:[[.78,-.34],[.85,-.34],[.92,-.34],[1.0,.02],[1.27,0]])){
 const dest=new T.Vector3(.65,y,z),r=new T.Raycaster(eye,dest.sub(eye).normalize());
 console.log([y,z],r.intersectObject(g,true).filter(h=>! /glass|Window/i.test(h.object.name)).slice(0,3).map(h=>[h.object.name,h.point.toArray().map(v=>+v.toFixed(3))]));
 }
}
