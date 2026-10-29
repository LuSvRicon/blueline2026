import * as THREE from "three";
import {cockpitVerticalFov} from "./CockpitRig.ts";

export type MirrorSide="left"|"right"|"rear";
const mirrors=new Set<DrivingMirror>();

/** Live game mirror cameras with independent lenses. Approximate optics,
 * rather than a calibrated convex-glass model. */
export function mirrorCameraPose(host:THREE.Object3D,side:MirrorSide){
  const dims=host.userData.visualDims??{length:4.7,width:2};
  const mount=new THREE.Vector3(side==="rear"?-dims.length/2-.12:.55,side==="rear"?1.3:1.15,side==="rear"?0:(side==="left"?-1:1)*(dims.width/2+.12));
  const direction=new THREE.Vector3(-1,-.015,side==="rear"?0:side==="left"?-.22:.22).normalize();
  const rotation=host.getWorldQuaternion(new THREE.Quaternion());
  return {position:host.localToWorld(mount),direction:direction.applyQuaternion(rotation)};
}

export class DrivingMirror extends THREE.Mesh{
  private target:THREE.WebGLRenderTarget;
  readonly mirrorCamera:THREE.PerspectiveCamera;
  private lastFrame=-Infinity;
  readonly side:MirrorSide;
  constructor(width:number,height:number,name:string){
    const target=new THREE.WebGLRenderTarget(1024,Math.round(1024*height/width),{type:THREE.HalfFloatType,depthBuffer:true});
    target.texture.repeat.x=-1;target.texture.offset.x=1;
    super(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:target.texture,toneMapped:false}));
    this.name=name;this.side=/left/.test(name)?"left":/right/.test(name)?"right":"rear";
    this.target=target;
    this.mirrorCamera=new THREE.PerspectiveCamera(cockpitVerticalFov(this.side==="rear"?52:68,width/height),width/height,.08,240);
    mirrors.add(this);
    this.userData.disposeRenderTarget=()=>{target.dispose();mirrors.delete(this);};
    this.onBeforeRender=(renderer,scene)=>{
      const now=performance.now();if(now-this.lastFrame<1000/30)return;
      let host:THREE.Object3D|null=this.parent;
      while(host&&host.userData.builtKind!=="ego")host=host.parent;
      if(!host)return;
      const pose=mirrorCameraPose(host,this.side);
      this.mirrorCamera.position.copy(pose.position);this.mirrorCamera.lookAt(pose.position.clone().add(pose.direction));
      const previousTarget=renderer.getRenderTarget(),viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4());
      const scissorTest=renderer.getScissorTest(),xr=renderer.xr.enabled,shadowUpdate=renderer.shadowMap.autoUpdate;
      const all=[...mirrors],visible=all.map(m=>m.visible);all.forEach(m=>m.visible=false);
      try{
        renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;renderer.setScissorTest(false);
        renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,this.mirrorCamera);this.lastFrame=now;
      }finally{
        all.forEach((m,i)=>m.visible=visible[i]);renderer.xr.enabled=xr;renderer.shadowMap.autoUpdate=shadowUpdate;
        renderer.setRenderTarget(previousTarget);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
      }
    };
  }
  getRenderTarget(){return this.target;}
}
