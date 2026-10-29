// Scene — owns the Three.js renderer, camera, lighting and post-processing.
//
// World-space convention: the simulation works in a 2-D (x, y) plane; we map it
// onto the ground plane as (x, 0, y) with +Y up. A smooth chase camera trails
// the ego like the Tesla "3D driving visualisation", and an UnrealBloomPass
// gives the ego body and the blue path their signature glow.

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { THEME } from "./theme.ts";
import { clamp, smoothTowards } from "../core/math.ts";
import { COCKPIT_RIG, cockpitCameraPose, cockpitVerticalFov } from "./CockpitRig.ts";

export type CameraMode = "chase" | "top" | "cockpit" | "orbit";
export type SurroundView = "360" | "front" | "rear" | "left" | "right";

export class Scene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly surroundCamera = new THREE.PerspectiveCamera(68, 1, 0.1, 500);
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom:UnrealBloomPass;
  cameraMode: CameraMode = "chase";
  timeOfDay: "day" | "night" = "night";
  private hudInset = 0;
  cockpitFov = COCKPIT_RIG.horizontalFov;
  cockpitEyeHeight = COCKPIT_RIG.eye.y;
  cockpitModelRig: {eye:THREE.Vector3;pitch:number;viewYaw?:number}|undefined;
  private cabinLookYaw = 0;
  private cabinLookPitch = 0;
  private cabinLookTarget = { yaw: 0, pitch: 0 };
  private weather: "clear" | "rain" | "fog" = "clear";
  private terrain?:THREE.Mesh<THREE.PlaneGeometry,THREE.MeshStandardMaterial>;
  private terrainGrid?:THREE.GridHelper;
  setLandscape(environment:'urban'|'suburban'|'rural'):void{
    this.terrain?.material.color.setHex(environment==='rural'?0x596749:environment==='suburban'?0x555e4d:0x30383b);
    if(this.terrainGrid)this.terrainGrid.visible=false;
  }

  setCockpitFov(degrees: number): void { this.cockpitFov = clamp(degrees, 75, 125); this.projectedCameraMode = null; }
  setCabinLook(yaw: number, pitch = 0): void { this.cabinLookTarget = { yaw: clamp(yaw, -1.3, 1.3), pitch: clamp(pitch, -.3, .25) }; }

  private setMaximumQuality(): void {
    const ratio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    const samples=this.renderer.capabilities.isWebGL2?Math.min(this.renderer.capabilities.maxSamples,4):0;
    for(const target of [this.composer.renderTarget1,this.composer.renderTarget2]){
      if(target.samples!==samples){target.dispose();target.samples=samples;}
    }
    this.renderer.shadowMap.enabled=true;
    this.onResize();
  }

  // Smoothed camera target state.
  private camPos = new THREE.Vector3(0, 30, -40);
  private camLook = new THREE.Vector3();
  private projectedCameraMode: CameraMode | null = null;
  private lastEgo:THREE.Vector2|undefined;
  private orbitAzimuth = 0;
  private orbitElevation = 0.24;
  private orbitDistance = 9;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;

    this.scene.background = this.makeGradientBackground();
    this.nightBg = this.scene.background;
    this.scene.fog = new THREE.Fog(THEME.fog, 80, 360);

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.camera.position.copy(this.camPos);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envNight = this.makeEnvironment(
      [
        [0, "#05070b"],
        [0.42, "#121a26"],
        [0.52, "#33465e"],
        [0.56, "#23272d"],
        [1, "#0e1013"],
      ],
      { x: 380, y: 66, r: 30, color: "rgba(130, 165, 210, 0.55)" },
    );
    this.envDay = this.makeEnvironment(
      [
        [0, "#4f86bd"],
        [0.42, "#9dc3e6"],
        [0.52, "#dcebf7"],
        [0.56, "#939aa2"],
        [1, "#5b6067"],
      ],
      { x: 360, y: 48, r: 46, color: "rgba(255, 250, 232, 0.95)" },
    );
    this.scene.environment = this.envNight;

    this.setupLights();
    this.setupGround();
    this.setupRain();
    this.setupOrbitControls(canvas);

    // Post-processing chain: render -> bloom -> output(color-correct).
    const target=new THREE.WebGLRenderTarget(window.innerWidth,window.innerHeight,{type:THREE.HalfFloatType});
    target.samples=this.renderer.capabilities.isWebGL2?Math.min(4,this.renderer.capabilities.maxSamples):0;
    this.composer = new EffectComposer(this.renderer,target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.4, // strength — subtle glow, keep lane lines crisp not blown out
      0.5, // radius
      0.92, // threshold — only the brightest (emissive) things bloom
    );
    this.composer.addPass(bloom);
    this.bloom=bloom;
    this.composer.addPass(new OutputPass());
    this.setMaximumQuality();

    window.addEventListener("resize", () => this.onResize());
  }

  /** Vertical navy gradient background — the Tesla "sky", never pure black. */
  private makeGradientBackground(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
    g.addColorStop(0.0, hex(THEME.bgTop));
    g.addColorStop(0.62, hex(THEME.background));
    g.addColorStop(1.0, hex(THEME.bgHorizon));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 512);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private hemi!: THREE.HemisphereLight;
  private key!: THREE.DirectionalLight;
  private nightBg!: THREE.Texture;
  private dayBg!: THREE.Texture;
  private pmrem!: THREE.PMREMGenerator;
  private envNight!: THREE.Texture;
  private envDay!: THREE.Texture;

  /** Image-based lighting from a small equirect gradient (plus a sun blob). */
  private makeEnvironment(
    stops: [number, string][],
    sun: { x: number; y: number; r: number; color: string } | null,
  ): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 256);
    if (sun) {
      const glow = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, sun.r);
      glow.addColorStop(0, sun.color);
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 512, 256);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    const target = this.pmrem.fromEquirectangular(texture);
    texture.dispose();
    return target.texture;
  }

  private setupLights(): void {
    this.hemi = new THREE.HemisphereLight(0xaebfff, 0x0a0e14, 0.75);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xcfe0ff, 1.0);
    this.key.position.set(60, 120, 40);
    this.key.castShadow=true;
    Object.assign(this.key.shadow.camera,{left:-45,right:45,top:45,bottom:-45,near:1,far:180});
    this.key.shadow.mapSize.set(2048,2048);this.key.shadow.normalBias=.035;this.key.shadow.bias=-.00015;
    this.scene.add(this.key.target);
    this.scene.add(this.key);

    const fill = new THREE.DirectionalLight(0x44557a, 0.45);
    fill.position.set(-50, 60, -30);
    this.scene.add(fill);
  }

  setTimeOfDay(t: "day" | "night"): void {
    this.timeOfDay = t;
    this.scene.environment = t === "day" ? this.envDay : this.envNight;
    const fog = this.scene.fog as THREE.Fog;
    if (t === "day") {
      if (!this.dayBg) this.dayBg = gradientTexture(["#8fbce8", "#bcd7f0", "#d7e7f5"]);
      this.scene.background = this.dayBg;
      this.hemi.color.setHex(0xdfeaff);
      this.hemi.intensity = .85;
      this.key.color.setHex(0xfff2da);
      this.key.intensity = 2.35;
      this.renderer.toneMappingExposure = .96;
      this.bloom.strength=.12;this.bloom.threshold=1.15;
      fog.color.setHex(0xcadcec);
      fog.near = 120;
      fog.far = 520;
    } else {
      this.scene.background = this.nightBg;
      this.hemi.color.setHex(0xaebfff);
      this.hemi.intensity = 0.75;
      this.key.color.setHex(0xcfe0ff);
      this.key.intensity = 1.0;
      this.renderer.toneMappingExposure = 1.05;
      this.bloom.strength=.32;this.bloom.threshold=.95;
      fog.color.setHex(THEME.fog);
      fog.near = 80;
      fog.far = 360;
    }
    this.setWeather(this.weather);
  }

  private setupGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshStandardMaterial({ color: THEME.ground, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow=true;
    this.terrain=ground;
    this.scene.add(ground);

    // A faint grid over the terrain gives motion & depth cues; fog fades it out.
    const grid = new THREE.GridHelper(6000, 300, THEME.grid, THEME.grid);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    grid.position.y = -0.04;
    this.terrainGrid=grid;
    this.scene.add(grid);
  }

  add(obj: THREE.Object3D): void {
    this.scene.add(obj);
  }

  // ---- weather -----------------------------------------------------------
  private rain!: THREE.LineSegments;
  private rainPos!: Float32Array;
  private rainOn = false;
  private readonly RAIN_N = 1800;
  private readonly RAIN_B = 70;
  private readonly RAIN_H = 48;

  private setupRain(): void {
    const n = this.RAIN_N;
    this.rainPos = new Float32Array(n * 6); // two vertices per drop
    for (let i = 0; i < n; i++) {
      const x = (Math.random() * 2 - 1) * this.RAIN_B;
      const y = Math.random() * this.RAIN_H;
      const z = (Math.random() * 2 - 1) * this.RAIN_B;
      const o = i * 6;
      this.rainPos[o] = x; this.rainPos[o + 1] = y; this.rainPos[o + 2] = z;
      this.rainPos[o + 3] = x; this.rainPos[o + 4] = y - 1.3; this.rainPos[o + 5] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xaebfd8, transparent: true, opacity: 0.34 });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  setWeather(w: "clear" | "rain" | "fog"): void {
    this.weather = w;
    const fog = this.scene.fog as THREE.Fog;
    if (w === "rain") {
      fog.near = 55; fog.far = 230;
      this.renderer.toneMappingExposure = this.timeOfDay === "day" ? 1.02 : .92;
      this.rainOn = true;
    } else if (w === "fog") {
      fog.near = 22; fog.far = 105;
      this.renderer.toneMappingExposure = this.timeOfDay === "day" ? 1.05 : .98;
      this.rainOn = false;
    } else {
      fog.near = this.timeOfDay === "day" ? 120 : 80; fog.far = this.timeOfDay === "day" ? 520 : 360;
      this.renderer.toneMappingExposure = this.timeOfDay === "day" ? 1.15 : 1.05;
      this.rainOn = false;
    }
    this.rain.visible = this.rainOn;
  }

  updateWeather(dt: number, egoX: number, egoY: number): void {
    if (!this.rainOn) return;
    this.rain.position.set(egoX, 0, egoY);
    const fall = 34 * dt;
    const p = this.rainPos;
    for (let i = 0; i < this.RAIN_N; i++) {
      const o = i * 6;
      let y = p[o + 1] - fall;
      if (y < -2) y += this.RAIN_H;
      p[o + 1] = y;
      p[o + 4] = y - 1.3;
    }
    (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  private setupOrbitControls(canvas: HTMLCanvasElement): void {
    let pointerId: number | null = null;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener("pointerdown", (event) => {
      if (this.cameraMode !== "orbit" || event.button !== 0) return;
      pointerId = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("camera-orbiting");
    });
    canvas.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId || this.cameraMode !== "orbit") return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      this.orbitAzimuth += dx * 0.006;
      this.orbitElevation = clamp(this.orbitElevation + dy * 0.004, 0.06, 1.2);
    });
    const release = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      canvas.classList.remove("camera-orbiting");
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("wheel", (event) => {
      if (this.cameraMode !== "orbit") return;
      event.preventDefault();
      this.orbitDistance = clamp(this.orbitDistance * Math.exp(event.deltaY * 0.001), 4.5, 22);
    }, { passive: false });
  }

  /** Reposition the chase/top camera to follow the ego smoothly. */
  updateCamera(egoX: number, egoY: number, egoYaw: number, dt: number, speed = 0): void {
    this.key.position.set(egoX+35,65,egoY+25);this.key.target.position.set(egoX,0,egoY);
    const fx = Math.cos(egoYaw);
    const fz = Math.sin(egoYaw);
    const leftX = -Math.sin(egoYaw);
    const leftZ = Math.cos(egoYaw);
    const cameraChanged = this.projectedCameraMode !== this.cameraMode;
    if(this.cameraMode==="chase"&&!cameraChanged&&this.lastEgo){
      const dx=egoX-this.lastEgo.x,dz=egoY-this.lastEgo.y;
      this.camPos.x+=dx;this.camPos.z+=dz;this.camLook.x+=dx;this.camLook.z+=dz;
    }
    (this.lastEgo??=new THREE.Vector2()).set(egoX,egoY);
    if (cameraChanged) {
      this.camera.fov = this.cameraMode === "cockpit" ? cockpitVerticalFov(this.cockpitFov, this.camera.aspect) : 55;
      this.camera.near = this.cameraMode === "cockpit" ? .04 : .1;
      this.camera.updateProjectionMatrix();
      this.projectedCameraMode = this.cameraMode;
      this.renderer.domElement.classList.toggle("camera-orbit-enabled", this.cameraMode === "orbit");
    }
    // A gentle speed-widening of the chase lens: the faster the car, the more of
    // the road you feel. Cockpit keeps its wide, fixed lens.
    if (this.cameraMode !== "cockpit") {
      const want = 55 + clamp(speed / 40, 0, 1) * 5;
      if (Math.abs(this.camera.fov - want) > 0.02) {
        this.camera.fov += (want - this.camera.fov) * Math.min(1, dt * 2);
        this.camera.updateProjectionMatrix();
      }
    }
    let targetPos: THREE.Vector3;
    let targetLook: THREE.Vector3;

    if (this.cameraMode === "chase") {
      // Behind and above, aimed just ahead of the car: the ego sits in the
      // lower third of the frame, clear of the HUD speed cluster, with the road
      // sweeping away toward the horizon.
      targetPos = new THREE.Vector3(egoX - fx * 8.5, 3.5, egoY - fz * 8.5);
      targetLook = new THREE.Vector3(egoX + fx * 2.5, .9, egoY + fz * 2.5);
    } else if (this.cameraMode === "top") {
      targetPos = new THREE.Vector3(egoX - fx * 2, 60, egoY - fz * 2);
      targetLook = new THREE.Vector3(egoX + fx * 8, 0, egoY + fz * 8);
    } else if (this.cameraMode === "orbit") {
      const horizontal = this.orbitDistance * Math.cos(this.orbitElevation);
      const azimuth = egoYaw + Math.PI + this.orbitAzimuth;
      targetPos = new THREE.Vector3(
        egoX + Math.cos(azimuth) * horizontal,
        0.35 + this.orbitDistance * Math.sin(this.orbitElevation),
        egoY + Math.sin(azimuth) * horizontal,
      );
      targetLook = new THREE.Vector3(egoX, 0.85, egoY);
    } else {
      this.cabinLookYaw = smoothTowards(this.cabinLookYaw, this.cabinLookTarget.yaw, 14, dt);
      this.cabinLookPitch = smoothTowards(this.cabinLookPitch, this.cabinLookTarget.pitch, 14, dt);
      const rig=this.cockpitModelRig;
      const pose = cockpitCameraPose(egoX, egoY, egoYaw, this.cockpitEyeHeight+(rig?rig.eye.y-COCKPIT_RIG.eye.y:0), this.cabinLookYaw, this.cabinLookPitch,rig?.eye,rig?.pitch,rig?.viewYaw);
      targetPos = pose.position; targetLook = pose.target;
    }

    if (cameraChanged || this.cameraMode === "cockpit") {
      // First-person cameras must stay rigidly attached to the car. Smoothing
      // while driving at speed leaves the camera several metres behind and
      // makes the seats appear in front of the driver.
      this.camPos.copy(targetPos);
      this.camLook.copy(targetLook);
    } else {
      const rate = 6;
      this.camPos.x = smoothTowards(this.camPos.x, targetPos.x, rate, dt);
      this.camPos.y = smoothTowards(this.camPos.y, targetPos.y, rate, dt);
      this.camPos.z = smoothTowards(this.camPos.z, targetPos.z, rate, dt);
      this.camLook.x = smoothTowards(this.camLook.x, targetLook.x, rate, dt);
      this.camLook.y = smoothTowards(this.camLook.y, targetLook.y, rate, dt);
      this.camLook.z = smoothTowards(this.camLook.z, targetLook.z, rate, dt);
    }

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  render(): void {
    this.composer.render();
  }

  /** Reserve actual viewport space for the cockpit instead of covering the road. */
  setHudInset(pixels: number): void {
    const next = Math.max(0, Math.min(pixels, window.innerHeight - 160));
    if (Math.abs(next - this.hudInset) < 1) return;
    this.hudInset = next;
    this.onResize();
  }

  /** Render the live 3-D world into a small camera viewport using this renderer. */
  renderSurroundView(
    viewport: HTMLCanvasElement,
    egoX: number,
    egoZ: number,
    yaw: number,
    view: SurroundView,
  ): void {
    const rect = viewport.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;

    const forwardX = Math.cos(yaw);
    const forwardZ = Math.sin(yaw);
    const rightX = -forwardZ;
    const rightZ = forwardX;
    const camera = this.surroundCamera;
    camera.aspect = rect.width / rect.height;
    camera.fov = view === "360" ? 68 : 74;
    camera.updateProjectionMatrix();

    if (view === "360") {
      camera.up.set(forwardX, 0, forwardZ);
      camera.position.set(egoX, 22, egoZ);
      camera.lookAt(egoX, 0, egoZ);
    } else if (view === "front") {
      camera.up.set(0, 1, 0);
      // Mount at the front bumper so the image shows the roadway ahead rather
      // than the host vehicle's bonnet and rear body.
      camera.position.set(egoX + forwardX * 2.35, 1.25, egoZ + forwardZ * 2.35);
      camera.lookAt(egoX + forwardX * 38, 1.25, egoZ + forwardZ * 38);
    } else if (view === "rear") {
      camera.up.set(0, 1, 0);
      camera.position.set(egoX - forwardX * 2.35, 1.25, egoZ - forwardZ * 2.35);
      camera.lookAt(egoX - forwardX * 38, 1.25, egoZ - forwardZ * 38);
    } else {
      const side = view === "left" ? -1 : 1;
      camera.up.set(0, 1, 0);
      camera.position.set(egoX + forwardX * 0.7 + rightX * side * 1.0, 1.35, egoZ + forwardZ * 0.7 + rightZ * side * 1.0);
      camera.lookAt(egoX + rightX * side * 24 + forwardX * 0.7, 0.6, egoZ + rightZ * side * 24 + forwardZ * 0.7);
    }

    const output=viewport.getContext("2d");
    if(!output)return;
    // Draw the secondary view into this frame's scratch corner, copy it into
    // the widget canvas, then let the main composer overwrite the scratch view.
    // The widget can now sit below the main viewport without covering the road.
    const ratio=this.renderer.getPixelRatio();
    const canvas=this.renderer.domElement;
    // A short/zoomed window can leave less WebGL height than the widget needs.
    // Scale BOTH dimensions to fit instead of copying a negative source crop.
    const scale=Math.min(1,canvas.width/(ratio*rect.width),canvas.height/(ratio*rect.height));
    const width=rect.width*scale,height=rect.height*scale;
    if(width<1||height<1)return;
    const previousTarget=this.renderer.getRenderTarget();
    const previousViewport=this.renderer.getViewport(new THREE.Vector4());
    const previousScissor=this.renderer.getScissor(new THREE.Vector4());
    const previousScissorTest=this.renderer.getScissorTest();
    try{
      this.renderer.setRenderTarget(null);
      this.renderer.setScissorTest(true);
      this.renderer.setScissor(0,0,width,height);
      this.renderer.setViewport(0,0,width,height);
      this.renderer.render(this.scene,camera);
      output.clearRect(0,0,viewport.width,viewport.height);
      output.drawImage(canvas,0,Math.max(0,canvas.height-height*ratio),width*ratio,height*ratio,0,0,viewport.width,viewport.height);
    }finally{
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setViewport(previousViewport);
      this.renderer.setScissor(previousScissor);
      this.renderer.setScissorTest(previousScissorTest);
    }
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = Math.max(160, window.innerHeight - this.hudInset);
    this.camera.aspect = w / h;
    if (this.cameraMode === "cockpit") this.camera.fov = cockpitVerticalFov(this.cockpitFov, this.camera.aspect);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }
}

/** Build a vertical gradient background texture from CSS colour stops. */
function gradientTexture(colors: string[]): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
