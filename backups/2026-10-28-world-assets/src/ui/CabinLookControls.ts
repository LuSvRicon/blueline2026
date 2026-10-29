import type { Scene } from "../render/Scene.ts";
import { isTypingTarget, launchMenuOpen } from "./input.ts";

/** Right-drag and held numpad glances; releasing returns to the driving view. */
export class CabinLookControls {
  private held = new Set<string>();
  private pointer: number | null = null;
  private x = 0; private y = 0; private yaw = 0; private pitch = 0;
  private wasActive = false;
  constructor(private canvas: HTMLCanvasElement, private scene: Scene, private paused: () => boolean) {
    canvas.addEventListener("contextmenu", event => { if (scene.cameraMode === "cockpit") event.preventDefault(); });
    canvas.addEventListener("pointerdown", event => {
      if (event.button !== 2 || !this.active()) return;
      event.preventDefault(); canvas.setPointerCapture(event.pointerId);
      this.pointer=event.pointerId;this.x=event.clientX;this.y=event.clientY;this.yaw=0;this.pitch=0;
      canvas.classList.add("cabin-looking");
    });
    canvas.addEventListener("pointermove", event => {
      if(event.pointerId!==this.pointer || !this.active())return;
      this.yaw=Math.max(-1.3,Math.min(1.3,this.yaw+(event.clientX-this.x)*.004));
      this.pitch=Math.max(-.3,Math.min(.25,this.pitch-(event.clientY-this.y)*.003));
      this.x=event.clientX;this.y=event.clientY;scene.setCabinLook(this.yaw,this.pitch);
    });
    const release = (event: PointerEvent) => {if(event.pointerId===this.pointer)this.reset();};
    canvas.addEventListener("pointerup",release);canvas.addEventListener("pointercancel",release);canvas.addEventListener("lostpointercapture",release);
    window.addEventListener("keydown",event=>{
      if(!this.active() || event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target))return;
      if(!["Numpad4","Numpad6","Numpad8","Numpad2","Numpad5"].includes(event.code))return;
      event.preventDefault();if(event.code==="Numpad5"){this.reset();return;}
      this.held.add(event.code);this.publish();
    });
    window.addEventListener("keyup",event=>{if(this.held.delete(event.code))this.publish();});
    window.addEventListener("blur",()=>this.reset());
  }
  update(): void {const active=this.active();if(!active && this.wasActive)this.reset();this.wasActive=active;}
  private active(): boolean {return this.scene.cameraMode==="cockpit" && !this.paused() && !launchMenuOpen();}
  private publish(): void {
    if(this.pointer!==null)return;
    const yaw=(Number(this.held.has("Numpad6"))-Number(this.held.has("Numpad4")))*1.05;
    const pitch=(Number(this.held.has("Numpad8"))-Number(this.held.has("Numpad2")))*.15;
    this.scene.setCabinLook(yaw,pitch);
  }
  reset(): void {this.held.clear();this.pointer=null;this.yaw=0;this.pitch=0;this.canvas.classList.remove("cabin-looking");this.scene.setCabinLook(0,0);}
}
