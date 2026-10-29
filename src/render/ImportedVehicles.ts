import * as THREE from "three";
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader.js";
import {MeshoptDecoder} from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {mergeGeometries} from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {VEHICLE_MODELS,VehicleModelId} from "./VehicleCatalog.ts";
import {IMPORTED_CABINS} from "./ImportedCabin.ts";
const ready=new Map<VehicleModelId,THREE.Group>();
const pending=new Map<VehicleModelId,Promise<void>>();
const errors=new Map<VehicleModelId,string>();
function selectTriangles(source:THREE.BufferGeometry,indices:number[]):THREE.BufferGeometry{
  const vertices=[...new Set(indices)],remap=new Map(vertices.map((old,index)=>[old,index]));
  const result=new THREE.BufferGeometry();
  for(const [name,attribute]of Object.entries(source.attributes)){
    const values=new Float32Array(vertices.length*attribute.itemSize);
    vertices.forEach((old,index)=>{const v=[attribute.getX(old),attribute.getY(old),attribute.getZ(old),attribute.getW(old)];for(let c=0;c<attribute.itemSize;c++)values[index*attribute.itemSize+c]=v[c];});
    result.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize));
  }
  result.setIndex(indices.map(old=>remap.get(old)!));result.computeBoundingBox();return result;
}
export function importedVehicle(id:VehicleModelId):THREE.Group|undefined {return ready.get(id);}
export function importedVehicleError(id:VehicleModelId):string|undefined{return errors.get(id);}
export function requestImportedVehicle(id:VehicleModelId):Promise<void>{
  if(pending.has(id))return pending.get(id)!;
  const model=VEHICLE_MODELS.find(model=>model.id===id)!;
  const promise=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env?.BASE_URL??"/"}models/imported/${model.file}`)
    .then(gltf=>{ready.set(id,prepareImportedVehicle(gltf.scene,id));})
    .catch(error=>{errors.set(id,"Không tải được mô hình; xe dự phòng đang được giữ lại.");console.warn(model.name,error);});
  pending.set(id,promise);return promise;
}

/** Convert Sketchfab transforms to +X forward, preserve actual vertices/UVs,
 * and batch parts by material and articulated wheel rather than by mesh name. */
export function prepareImportedVehicle(source:THREE.Group,id?:VehicleModelId):THREE.Group{
  source.rotation.y+=Math.PI/2;source.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(source,true),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  if(size.x<=0||size.z<=0)throw new Error("Mô hình xe không có kích thước hợp lệ");
  const normal=new THREE.Matrix4().makeScale(4.6/size.x,4.6/size.x,1.9/size.z)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x,-bounds.min.y,-center.z));
  type Part={geometry:THREE.BufferGeometry;material:THREE.Material;box:THREE.Box3;wheel?:string;window?:boolean;interior?:boolean;steering?:boolean};
  const parts:Part[]=[], hubs=new Map<string,THREE.Box3>();
  source.traverse(object=>{
    if(!(object instanceof THREE.Mesh)||Array.isArray(object.material))return;
    const geometry:THREE.BufferGeometry=object.geometry.clone();
    // Meshopt/quantization may store normalized integers. Bake transforms only
    // after decoding to floats, otherwise coordinates outside [-1,1] truncate.
    for(const [name,attribute]of Object.entries(geometry.attributes)){
      if(attribute.normalized || name==="position" || name==="normal" || name==="tangent"){
        const values=new Float32Array(attribute.count*attribute.itemSize);
        for(let i=0;i<attribute.count;i++)for(let c=0;c<attribute.itemSize;c++)values[i*attribute.itemSize+c]=[attribute.getX(i),attribute.getY(i),attribute.getZ(i),attribute.getW(i)][c];
        geometry.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize));
      }
    }
    geometry.applyMatrix4(normal.clone().multiply(object.matrixWorld));geometry.computeBoundingBox();
    const box=geometry.boundingBox!.clone(),s=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3());
    let material=object.material as THREE.Material;
    // Santa Fe's supplied interior has no albedo texture: retain its geometry,
    // give the untextured surfaces a restrained trim rather than pure white.
    if(id==="santafe"&&material.name==="interior"){
      const trim=material.clone() as THREE.MeshStandardMaterial;
      trim.color.setHex(/047/.test(object.name)?0x51483f:/205/.test(object.name)?0x50504c:0x1d252b);
      trim.roughness=.85;material=trim;
    }
    const rig=id?IMPORTED_CABINS[id]:undefined;
    const steeringCandidate=rig&&(id==="santafe"?/055_interior/.test(object.name):box.intersectsBox(new THREE.Box3(new THREE.Vector3(.22,.59,-.56),new THREE.Vector3(.51,1.02,-.12))));
    if(steeringCandidate){
      const p=geometry.getAttribute("position"),index=geometry.index,sets=[[],[]] as number[][];
      const hub=new THREE.Vector3(...rig!.wheel);
      for(let i=0,n=index?.count??p.count;i<n;i+=3){
        const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);
        const c=new THREE.Vector3();for(const j of ids)c.add(new THREE.Vector3().fromBufferAttribute(p,j));c.multiplyScalar(1/3).sub(hub);
        const rotating=Math.abs(c.x+.23*c.y)<(id==="santafe"?.055:.10)&&Math.hypot(c.y,c.z)<(id==="santafe"?.16:.205);
        sets[rotating?1:0].push(...ids);
      }
      if(sets[1].length){
        sets.forEach((indices,part)=>{if(!indices.length)return;const split=selectTriangles(geometry,indices);parts.push({geometry:split,material,box:split.boundingBox!.clone(),interior:true,steering:part===1});});
        geometry.dispose();return;
      }
    }
    if(/LightA_Material/i.test(material.name)){
      const flat=geometry.index?geometry.toNonIndexed():geometry;
      const pos=flat.getAttribute("position"),triangles=[[],[]] as number[][];
      for(let i=0;i<pos.count;i+=3)triangles[(pos.getX(i)+pos.getX(i+1)+pos.getX(i+2))>0?0:1].push(i,i+1,i+2);
      triangles.forEach((indices,side)=>{
        if(!indices.length)return;const split=new THREE.BufferGeometry();
        for(const [name,attribute]of Object.entries(flat.attributes)){
          const values=new Float32Array(indices.length*attribute.itemSize);
          indices.forEach((index,i)=>{const v=[attribute.getX(index),attribute.getY(index),attribute.getZ(index),attribute.getW(index)];for(let k=0;k<attribute.itemSize;k++)values[i*attribute.itemSize+k]=v[k];});
          split.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize));
        }
        const lamp=material.clone() as THREE.MeshStandardMaterial;lamp.name=side===0?"Headlight":"Brakelight";lamp.emissive.setHex(side===0?0xe9eeff:0xb51916);
        split.computeBoundingBox();parts.push({geometry:split,material:lamp,box:split.boundingBox!.clone()});
      });
      if(flat!==geometry)flat.dispose();geometry.dispose();return;
    }
    const tyre=/tire|tyre|rim|lop_xe|Wheel1A/i.test(material.name);
    const isWheel=tyre&&s.y>.015&&s.x<1.2&&s.y<1.2&&Math.abs(c.z)>.4&&Math.abs(c.x)>.65&&c.y<.7;
    const wheel=isWheel?`Wheel${c.x>0?"Front":"Rear"}${c.z<0?"L":"R"}`:undefined;
    if(wheel){if(!hubs.has(wheel))hubs.set(wheel,new THREE.Box3());hubs.get(wheel)!.union(box);}
    const window=/Window_Material|^(d_glass|vd_glass)$/i.test(material.name)&&s.x>.3&&s.y>.08;
    parts.push({geometry,material,box,wheel,window,interior:/interior/i.test(material.name)});
  });
  const root=new THREE.Group();root.name="ImportedVehicle";
  const steering=new THREE.Group();steering.name="asset-steering-wheel";
  const rig=id?IMPORTED_CABINS[id]:undefined;
  if(rig){steering.position.set(...rig.wheel);root.add(steering);}
  const groups=new Map<string,THREE.Group>(),centers=new Map<string,THREE.Vector3>();
  for(const [name,box]of hubs){const pivot=new THREE.Group(),spin=new THREE.Group();pivot.name=name;pivot.position.copy(box.getCenter(new THREE.Vector3()));pivot.userData.radius=box.getSize(new THREE.Vector3()).y/2;pivot.add(spin);root.add(pivot);groups.set(name,spin);centers.set(name,pivot.position);}
  const buckets=new Map<string,{geometries:THREE.BufferGeometry[];material:THREE.Material;parent:THREE.Group;window?:boolean;interior?:boolean}>();
  for(const part of parts){
    // Include the wheel hub hardware when it occupies the same small volume.
    if(!part.wheel){const c=part.box.getCenter(new THREE.Vector3()),s=part.box.getSize(new THREE.Vector3());
      for(const [name,hub]of centers)if(c.distanceTo(hub)<.23&&s.x<1&&s.y<1&&s.z<.5){part.wheel=name;break;}}
    if(part.wheel)part.geometry.translate(...centers.get(part.wheel)!.clone().negate().toArray());
    if(part.steering)part.geometry.translate(-steering.position.x,-steering.position.y,-steering.position.z);
    const key=`${part.steering?"steering":part.wheel??"body"}/${part.material.uuid}/${!!part.window}/${Object.keys(part.geometry.attributes).sort().join(",")}/${!!part.geometry.index}`;
    if(!buckets.has(key))buckets.set(key,{geometries:[],material:part.material,parent:part.steering?steering:part.wheel?groups.get(part.wheel)!:root,window:part.window,interior:part.interior});
    buckets.get(key)!.geometries.push(part.geometry);
  }
  for(const bucket of buckets.values()){
    const geometry=mergeGeometries(bucket.geometries,false);if(!geometry)throw new Error("Không ghép được hình học xe");
    bucket.geometries.forEach(geometry=>geometry.dispose());
    const material=bucket.material.clone();
    if(material instanceof THREE.MeshStandardMaterial){
      for(const value of Object.values(material))if(value instanceof THREE.Texture)value.anisotropy=8;
      if(bucket.interior){material.metalness=Math.min(material.metalness,.25);material.roughness=Math.max(material.roughness,.5);}
      if(id==="civic"&&/InteriorColourZoneA_Material/.test(material.name)){material.color.setHex(0x6d1d24);material.roughness=.8;}
      if(id==="civic"&&/InteriorTillingColourZoneA_Material/.test(material.name)){material.color.setHex(0x25272a);material.roughness=.9;}
      const box=new THREE.Box3().setFromBufferAttribute(geometry.getAttribute("position") as THREE.BufferAttribute),c=box.getCenter(new THREE.Vector3());
      const redEmission=material.emissive.r>.1 && material.emissive.r>material.emissive.g*2 && material.emissive.r>material.emissive.b*2;
      if((/r_lights|redglass|RED_GLASS|Carlight_triangle_chrome_red/i.test(material.name)||redEmission)&&c.x<0){material.name="Brakelight";material.emissive.setHex(0xb51916);}
      else if(/^(lights|light|den_xe)$/i.test(material.name)&&c.x>.4){material.name="Headlight";material.emissive.setHex(0xe9eeff);}
    }
    const mesh=new THREE.Mesh(geometry,material);mesh.name=bucket.interior?"asset-interior":bucket.window?"asset-window":"asset-body";
    mesh.castShadow=!bucket.window;mesh.receiveShadow=true;
    mesh.userData.cabinWindow=!!bucket.window;mesh.userData.sharedVehicleAsset=true;bucket.parent.add(mesh);
  }
  // Dedicated amber telltales keep signals independent even when the artist
  // combined all lens geometry into a single material. Position is approximate.
  for(const side of [-1,1])for(const end of [-1,1]){
    const lamp=new THREE.Mesh(new THREE.BoxGeometry(.045,.035,.12),new THREE.MeshStandardMaterial({color:0x6c3b07,emissive:0xff8800}));
    lamp.name="Turnsignal";lamp.position.set(end*2.18,.65,side*.8);lamp.userData.sharedVehicleAsset=true;root.add(lamp);
  }
  root.userData.hubs=[...hubs.keys()];if(id&&IMPORTED_CABINS[id])root.userData.cabinRig=IMPORTED_CABINS[id];return root;
}
