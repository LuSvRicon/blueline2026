import * as THREE from "three";
import type {VehicleModelId} from "./VehicleCatalog.ts";

/** Positions are in the normalized imported vehicle, before ego dimension scale. */
export const IMPORTED_CABINS: Partial<Record<VehicleModelId,{
  eye:[number,number,number];pitch:number;viewYaw:number;wheel:[number,number,number];
  mirrors:{side:[number,number,number];rear:[number,number,number]};
  cluster:[number,number,number];navigation:[number,number,number];
}>> = {
  santafe: {eye:[.04,1.34,-.36],pitch:-8*Math.PI/180,viewYaw:10*Math.PI/180,wheel:[.556,1.09,-.358],mirrors:{side:[.628,1.165,.875],rear:[.55,1.375,-.01]},cluster:[.668,1.10,-.358],navigation:[.643,1.075,.035]},
  civic: {eye:[-.26,1.12,-.36],pitch:-8*Math.PI/180,viewYaw:8*Math.PI/180,wheel:[.365,.805,-.34],mirrors:{side:[.515,.985,.845],rear:[.43,1.19,-.04]},cluster:[.64,.88,-.34],navigation:[.575,.953,-.012]},
};

/** Swap glass only for the first-person pass. Exterior cameras keep original materials. */
export function setImportedCabinView(root:THREE.Group,enabled:boolean):void {
  const equipment=root.getObjectByName("imported-cabin-equipment");if(equipment)equipment.visible=enabled;
  root.traverse(object=>{
    if(!(object instanceof THREE.Mesh)||!object.userData.cabinWindow)return;
    const original=object.userData.exteriorGlass as THREE.Material|undefined;
    if(!original){
      object.userData.exteriorGlass=object.material;
      const glass=(object.material as THREE.MeshStandardMaterial).clone();
      glass.transparent=true;glass.opacity=.018;glass.depthWrite=false;
      glass.color.setHex(0xd3e2e7);glass.metalness=0;glass.side=THREE.DoubleSide;
      if(glass instanceof THREE.MeshPhysicalMaterial)glass.transmission=0;
      object.userData.driverGlass=glass;
    }
    object.material=enabled?object.userData.driverGlass:object.userData.exteriorGlass;
  });
}

/** Real scene reflections and live instruments, fitted to the imported trim. */
export function installImportedCabinEquipment(root:THREE.Group,options:{
  makeMirror:(w:number,h:number,name:string)=>THREE.Object3D;
  blindSpot:{left:THREE.Material;right:THREE.Material};
  instrument:THREE.Texture;navigation:THREE.Texture;
}):void {
  const rig=root.userData.cabinRig as NonNullable<typeof IMPORTED_CABINS.santafe>|undefined;
  if(!rig||root.getObjectByName("imported-cabin-equipment"))return;
  const group=new THREE.Group();group.name="imported-cabin-equipment";group.visible=false;root.add(group);
  const mirror=(w:number,h:number,name:string)=>{
    const object=options.makeMirror(w,h,name);
    if(object instanceof THREE.Mesh){
      const shape=new THREE.Shape(),x=-w/2,y=-h/2,r=.012;
      shape.moveTo(x+r,y);shape.lineTo(x+w-r,y);shape.quadraticCurveTo(x+w,y,x+w,y+r);shape.lineTo(x+w,y+h-r);shape.quadraticCurveTo(x+w,y+h,x+w-r,y+h);shape.lineTo(x+r,y+h);shape.quadraticCurveTo(x,y+h,x,y+h-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);
      object.geometry.dispose();object.geometry=new THREE.ShapeGeometry(shape);
      const uv=object.geometry.getAttribute("uv"),position=object.geometry.getAttribute("position");
      for(let i=0;i<uv.count;i++)uv.setXY(i,position.getX(i)/w+.5,position.getY(i)/h+.5);
    }
    return object;
  };
  for(const side of [-1,1] as const){
    const name=side<0?"left":"right";
    const centre=new THREE.Vector3(...rig.mirrors.side);centre.z*=side;
    const incident=centre.clone().sub(new THREE.Vector3(...rig.eye)).normalize();
    const normal=new THREE.Vector3(-1,0,side*.20).normalize().sub(incident).normalize();
    centre.addScaledVector(normal,.018);
    const orientation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
    const lens=mirror(.16,.078,`imported-mirror-${name}`);lens.position.copy(centre);lens.quaternion.copy(orientation);group.add(lens);
    const triangle=new THREE.Shape();triangle.moveTo(-.009,-.006);triangle.lineTo(.009,-.006);triangle.lineTo(0,.010);triangle.closePath();
    const led=new THREE.Mesh(new THREE.ShapeGeometry(triangle),options.blindSpot[name]);led.name=`imported-bsm-${name}`;
    led.userData.sharedCabinMaterial=true;
    led.position.copy(centre).addScaledVector(normal,.003).add(new THREE.Vector3(side*.055,.018,0).applyQuaternion(orientation));led.quaternion.copy(orientation);group.add(led);
  }
  const rear=mirror(.17,.055,"imported-rearview-mirror");rear.position.set(...rig.mirrors.rear);
  const rearNormal=new THREE.Vector3(-1,-.025,0).normalize().sub(rear.position.clone().sub(new THREE.Vector3(...rig.eye)).normalize()).normalize();
  rear.position.addScaledVector(rearNormal,.035);
  rear.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),rearNormal);group.add(rear);
  for(const [name,point,width,height,texture] of [
    ["imported-live-cluster",rig.cluster,.29,.105,options.instrument],
    ["imported-live-navigation",rig.navigation,.22,.12,options.navigation],
  ] as const){
    const screen=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}));
    screen.name=name;screen.position.set(...point);screen.rotation.y=-Math.PI/2;group.add(screen);
  }
}
