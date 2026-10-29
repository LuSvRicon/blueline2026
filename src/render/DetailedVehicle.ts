import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {disposeVehicle} from "./CockpitGeometry.ts";

// Car Concept, Eric Chadwick / DGG, CC BY 4.0. See public/models/car-concept.
// Imported geometry is shared; per-instance paint and lamps remain independent.
let template: THREE.Group | undefined;
let loading: Promise<void> | undefined;
export function loadDetailedVehicle(): Promise<void> {
  return loading ??= new GLTFLoader().loadAsync(`${import.meta.env?.BASE_URL ?? "/"}models/car-concept/CarConcept.glb`).then(gltf => {
    template=prepareDetailedVehicle(gltf.scene);
  });
}

export function prepareDetailedVehicle(source: THREE.Group): THREE.Group {
    source.rotation.y=Math.PI/2; source.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(source), size=bounds.getSize(new THREE.Vector3()), center=bounds.getCenter(new THREE.Vector3());
    const scale=new THREE.Matrix4().makeScale(4.6/size.x,4.6/size.x,1.9/size.z);
    const normalize=scale.multiply(new THREE.Matrix4().makeTranslation(-center.x,-bounds.min.y,-center.z));
    const result=new THREE.Group();
    const wheels=new Map<string,THREE.Group>();
    for(const name of ["WheelFrontL","WheelFrontR","WheelRearL","WheelRearR"]) {
      const original=source.getObjectByName(name)!;
      const hub=new THREE.Box3().setFromObject(original).getCenter(new THREE.Vector3()).applyMatrix4(normalize);
      const pivot=new THREE.Group(),spin=new THREE.Group(); pivot.name=name; pivot.position.copy(hub); pivot.add(spin);
      result.add(pivot); wheels.set(name,pivot);
    }
    source.traverse(object=>{
      if(!(object instanceof THREE.Mesh)) return;
      let parent=object.parent, wheel:THREE.Group|undefined;
      while(parent && !wheel) { wheel=wheels.get(parent.name); parent=parent.parent; }
      const geometry=object.geometry.clone().applyMatrix4(normalize.clone().multiply(object.matrixWorld));
      if(wheel) geometry.translate(-wheel.position.x,-wheel.position.y,-wheel.position.z);
      const mesh=new THREE.Mesh(geometry,object.material); mesh.name=object.name; mesh.userData.sharedVehicleAsset=true;
      (wheel ? wheel.children[0] : result).add(mesh);
    });
    return result;
}

export function attachDetailedVehicle(vehicle: THREE.Group, paint: number, prepared=template): boolean {
  if(!prepared || vehicle.userData.detailedVehicle) return false;
  const model=prepared.clone(true);
  const dims=vehicle.userData.visualDims as {length:number;width:number}|undefined;
  const assetDims=prepared.userData.assetDimensions??{length:4.6,width:1.9};
  if(dims) model.scale.set(dims.length/assetDims.length,1,dims.width/assetDims.width);
  const materials=new Map<THREE.Material,THREE.Material>();
  const body:THREE.MeshStandardMaterial[]=[], brakes:THREE.MeshStandardMaterial[]=[], heads:THREE.MeshStandardMaterial[]=[];
  const signals=[new THREE.MeshStandardMaterial({color:0xffa42c,emissive:0xff8500,transparent:true,opacity:0}),new THREE.MeshStandardMaterial({color:0xffa42c,emissive:0xff8500,transparent:true,opacity:0})];
  model.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    const multiple=Array.isArray(object.material);
    const originals=multiple?object.material as THREE.Material[]:[object.material as THREE.Material];
    const converted=originals.map(original=>{
      let material=materials.get(original);
      if(!material) {
        const cloned: THREE.Material=original.clone(); material=cloned; materials.set(original,cloned);
        if(material instanceof THREE.MeshStandardMaterial) {
          if(original.name.startsWith("Paint 1")) { material.color.setHex(paint); body.push(material); }
          if(original.name==="Brakelight")brakes.push(material);
          if(original.name==="Headlight")heads.push(material);
          // Avoid transmission render passes for every NPC and every mirror.
          if(material instanceof THREE.MeshPhysicalMaterial && material.transmission>0) {
            material.transmission=0; material.color.setHex(0x344650); material.roughness=.14; material.metalness=.35;
          }
        }
      }
      return material!;
    });
    object.material=multiple?converted:converted[0];
    if(object.name.includes("Turnsignal")) {
      const geo=object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      const position=geo.getAttribute("position"); geo.clearGroups();
      for(let i=0;i<position.count;i+=3)geo.addGroup(i,3,(position.getZ(i)+position.getZ(i+1)+position.getZ(i+2))<0?0:1);
      object.geometry=geo; object.userData.sharedVehicleAsset=false; object.material=signals;
    }
  });
  const shell=vehicle.userData.shell as THREE.Group;
  for(const part of shell.children)if(part!==vehicle.userData.cockpit&&!part.userData.keepWithAsset) { part.visible=false; part.userData.hiddenByAsset=true; }
  for(const wheel of vehicle.userData.wheels ?? [])wheel.pivot.visible=false;
  shell.add(model);
  vehicle.userData.importedRoot=model;
  vehicle.userData.wheels=[...model.children].filter(child=>child.name.startsWith("Wheel")).map(pivot=>({pivot,spin:pivot.children[0],radius:pivot.userData.radius??.34,front:pivot.name.includes("Front")}));
  vehicle.userData.bodyMats=body; vehicle.userData.brakeLamps=brakes; vehicle.userData.headLamps=heads;
  vehicle.userData.turnLeft=signals[0]; vehicle.userData.turnRight=signals[1];
  vehicle.userData.detailedVehicle=true;
  return true;
}

export function replaceDetailedVehicle(vehicle:THREE.Group,paint:number,prepared:THREE.Group,id:string):boolean{
  if(vehicle.userData.modelId===id)return false;
  const previous=vehicle.userData.importedRoot as THREE.Group|undefined;
  if(previous){previous.removeFromParent();disposeVehicle(previous);}
  vehicle.userData.detailedVehicle=false;
  const attached=attachDetailedVehicle(vehicle,paint,prepared);
  if(attached)vehicle.userData.modelId=id;
  return attached;
}
