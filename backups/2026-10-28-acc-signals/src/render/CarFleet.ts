// CarFleet — renders the ego and all ambient traffic as proper 3-D vehicles.
//
// Each vehicle is built from a painted shell (rounded body, glass greenhouse,
// mirrors, lamps), a set of steerable/spinning wheels, and a soft contact
// shadow so it sits on the road instead of floating. Per-frame animation drives
// what makes a scene feel alive: wheels roll with speed, front wheels steer,
// the body rolls into lane changes and pitches under braking, brake lights come
// on, turn signals blink, and headlamps switch on at night.
//
// The simulation's vehicle physics are unchanged — this file is presentation.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { Simulation } from "../sim/Simulation.ts";
import { THEME } from "./theme.ts";
import { VehicleDims } from "../vehicle/Vehicle.ts";
import { clamp } from "../core/math.ts";
import { disposeVehicle } from "./CockpitGeometry.ts";
import { createCarInterior } from "./CarInterior.ts";
import { paintCockpitInstruments } from "./CockpitInstruments.ts";
import { projectEgoPoint } from "../core/viewProjection.ts";

type Kind = "car" | "truck" | "bus" | "motorcycle" | "ego";

// Three.js reflectors render the scene from a virtual camera. Keep other mirror
// surfaces out of that secondary render so mirrors cannot recursively render
// one another. The mirrors are low-resolution, real scene reflections rather
// than a static blue material; BSM telltales remain separate meshes on top.
const mirrorReflectors: Reflector[] = [];

function makeMirror(width: number, height: number, name: string): Reflector {
  const mirror = new Reflector(new THREE.PlaneGeometry(width, height), {
    color: 0xb8c5c9,
    textureWidth: 1024,
    textureHeight: 512,
    clipBias: 0.003,
    multisample: 0,
  });
  mirror.name = name;

  const renderReflection = mirror.onBeforeRender;
  mirror.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
    const otherMirrors = mirrorReflectors.filter((candidate) => candidate !== mirror);
    const visibility = otherMirrors.map((candidate) => candidate.visible);
    otherMirrors.forEach((candidate) => { candidate.visible = false; });
    try {
      renderReflection(renderer, scene, camera, geometry, material, group);
    } finally {
      otherMirrors.forEach((candidate, index) => { candidate.visible = visibility[index]; });
    }
  };
  mirrorReflectors.push(mirror);
  return mirror;
}

/** Realistic paint colours: white, silver, grey, black, red, blue, green, beige. */
const CAR_PAINTS = [0xf1f3f4, 0xe4e7e9, 0xc3c9ce, 0xa2a9b0, 0x7c848b, 0x3a4046, 0x181b1f, 0x8d2f2f, 0x26476d, 0x3c6350, 0xb6a780];
const TRUCK_PAINTS = [0xe8ebed, 0xc8ced3, 0x9aa3aa, 0x33566f, 0x7d3b36, 0x2f4a3a];
const BUS_PAINTS = [0xe0b23f, 0x2f7d5c, 0xe9ecee, 0x3b6ea8];
const BIKE_PAINTS = [0x1a1d21, 0x8d2f2f, 0x26476d, 0x9aa3aa];

function paintFor(kind: Kind, hue: number): THREE.Color {
  const list = kind === "truck" ? TRUCK_PAINTS : kind === "bus" ? BUS_PAINTS : kind === "motorcycle" ? BIKE_PAINTS : CAR_PAINTS;
  const index = Math.min(list.length - 1, Math.floor(hue * list.length));
  return new THREE.Color(list[index]);
}

function vehicleBox(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  r = 0.04,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function vehicleSegment(
  parent: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const axis = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, axis.length(), 8), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  parent.add(mesh);
  return mesh;
}

function vehicleSideGlass(points: [number, number][], z: number, material: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const glass = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  glass.position.z = z;
  return glass;
}

function vehicleFrontGlass(
  x: number,
  y: number,
  width: number,
  height: number,
  material: THREE.Material,
  rear = false,
): THREE.Mesh {
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  glass.rotation.y = rear ? -Math.PI / 2 : Math.PI / 2;
  glass.position.set(x, y, 0);
  return glass;
}

/** Smooth, tapered outer body shell for a passenger car (x is front/rear). */
function vehicleBodyShell(length: number, width: number): THREE.BufferGeometry {
  const profile = [
    [-0.5, 0.7, 0.72], [-0.38, 0.92, 0.82], [-0.22, 1, 0.84],
    [0.02, 0.99, 0.83], [0.25, 0.93, 0.8], [0.42, 0.8, 0.72], [0.5, 0.56, 0.62],
  ] as const;
  const rings = 26;
  const around = 28;
  const bottom = 0.25;
  const vertices: number[] = [];
  const indices: number[] = [];
  const smooth = (a: number, b: number, t: number): number => {
    const u = t * t * (3 - 2 * t);
    return a + (b - a) * u;
  };

  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const xNorm = -0.5 + t;
    let section = 0;
    while (section < profile.length - 2 && xNorm > profile[section + 1][0]) section++;
    const a = profile[section];
    const b = profile[section + 1];
    const u = (xNorm - a[0]) / (b[0] - a[0]);
    const halfWidth = width * 0.5 * smooth(a[1], b[1], u);
    const top = smooth(a[2], b[2], u);
    const centerY = (bottom + top) * 0.5;
    const halfHeight = (top - bottom) * 0.5;
    for (let j = 0; j <= around; j++) {
      const angle = (j / around) * Math.PI * 2;
      vertices.push(xNorm * length, centerY + Math.cos(angle) * halfHeight, Math.sin(angle) * halfWidth);
    }
  }
  const stride = around + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const rearCenter = vertices.length / 3;
  vertices.push(-length * 0.5, (bottom + profile[0][2]) * 0.5, 0);
  const frontCenter = vertices.length / 3;
  vertices.push(length * 0.5, (bottom + profile[profile.length - 1][2]) * 0.5, 0);
  for (let j = 0; j < around; j++) {
    indices.push(rearCenter, j + 1, j);
    const frontStart = rings * stride;
    indices.push(frontCenter, frontStart + j, frontStart + j + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

interface WheelRef {
  pivot: THREE.Group;
  spin: THREE.Group;
  radius: number;
  front: boolean;
}

/** A wheel with a steer pivot and a separate spin pivot at the hub centre. */
function detailedWheel(radius: number, width: number, x: number, z: number, front: boolean): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, radius, z);
  const spin = new THREE.Group();
  pivot.add(spin);

  const rubber = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.94, metalness: 0.02 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0x929ba2, roughness: 0.28, metalness: 0.82 });
  const darkAlloy = new THREE.MeshStandardMaterial({ color: 0x343a40, roughness: 0.38, metalness: 0.72 });
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 28, 1), rubber);
  tire.rotation.x = Math.PI / 2;
  spin.add(tire);
  for (const side of [-1, 1]) {
    const faceZ = side * (width * 0.5 + 0.013);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.68, radius * 0.052, 8, 28), alloy);
    rim.position.z = faceZ;
    spin.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.15, radius * 0.15, 0.035, 18), darkAlloy);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = faceZ;
    spin.add(hub);
    for (let i = 0; i < 5; i++) {
      const angle = (i * Math.PI * 2) / 5;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.085, radius * 0.68, 0.025), alloy);
      spoke.position.set(Math.sin(angle) * radius * 0.27, Math.cos(angle) * radius * 0.27, faceZ);
      spoke.rotation.z = -angle;
      spin.add(spoke);
    }
  }
  pivot.userData.spin = spin;
  pivot.userData.radius = radius;
  pivot.userData.front = front;
  return pivot;
}

// ---- contact shadows -----------------------------------------------------

let shadowTexture: THREE.Texture | null = null;
function contactShadowTexture(): THREE.Texture | null {
  if (shadowTexture) return shadowTexture;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  gradient.addColorStop(0, "rgba(0,0,0,0.55)");
  gradient.addColorStop(0.55, "rgba(0,0,0,0.32)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  shadowTexture = new THREE.CanvasTexture(canvas);
  shadowTexture.colorSpace = THREE.SRGBColorSpace;
  return shadowTexture;
}

function contactShadow(w: number, l: number): THREE.Mesh | null {
  const map = contactShadowTexture();
  if (!map) return null;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 1.45, l * 1.15),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.065;
  mesh.renderOrder = 1;
  return mesh;
}

// ---- licence plates ------------------------------------------------------

let plateTexture: THREE.Texture | null = null;
function plateMaterial(): THREE.Material | null {
  if (!plateTexture) {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#eceff1";
    ctx.fillRect(0, 0, 128, 32);
    ctx.strokeStyle = "#9aa2a8";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 126, 30);
    ctx.fillStyle = "#14171a";
    ctx.font = "700 17px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("51F-412.86", 66, 17);
    ctx.fillStyle = "#2c6db3";
    ctx.fillRect(4, 4, 12, 24);
    plateTexture = new THREE.CanvasTexture(canvas);
    plateTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshStandardMaterial({ map: plateTexture, roughness: 0.5, metalness: 0.1, toneMapped: false });
}

/** Higher-detail game-style vehicle meshes; the simulation physics are unchanged. */
function makeVehicle(
  kind: Kind,
  paint: number,
  emissive: number,
  emiss: number,
  dims: VehicleDims,
  variant = 0,
): THREE.Group {
  const g = new THREE.Group();
  // Chassis carries the whole vehicle (shell + wheels) so two-wheelers can lean
  // about their contact patch; cars roll only the body shell.
  const chassis = new THREE.Group();
  g.add(chassis);
  const shell = new THREE.Group();
  chassis.add(shell);
  const L = dims.length;
  const W = dims.width;
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: paint,
    emissive,
    emissiveIntensity: emiss,
    roughness: 0.28,
    metalness: 0.45,
    clearcoat: 0.85,
    clearcoatRoughness: 0.18,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x202d36,
    roughness: 0.15,
    metalness: 0.2,
    clearcoat: 0.95,
    clearcoatRoughness: 0.12,
    side: THREE.DoubleSide,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x171b20, roughness: 0.55, metalness: 0.24 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.92, metalness: 0.02 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xaab2b8, roughness: 0.28, metalness: 0.8 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0x8d999f, roughness: 0.24, metalness: 0.88 });
  const headlamp = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd98f, emissiveIntensity: 1.5, roughness: 0.2 });
  const taillamp = new THREE.MeshStandardMaterial({ color: 0xb52b30, emissive: 0xd3151c, emissiveIntensity: 1.25, roughness: 0.24 });
  const signalLeft = new THREE.MeshStandardMaterial({ color: 0x60491f, emissive: 0xff8a14, emissiveIntensity: 0.25, roughness: 0.28 });
  const signalRight = new THREE.MeshStandardMaterial({ color: 0x60491f, emissive: 0xff8a14, emissiveIntensity: 0.25, roughness: 0.28 });
  const bodyMats: THREE.MeshStandardMaterial[] = [bodyMat];
  const wheels: WheelRef[] = [];
  const addBox = (
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    r = 0.04,
  ): THREE.Mesh => {
    const mesh = vehicleBox(w, h, d, material, x, y, z, r);
    shell.add(mesh);
    return mesh;
  };
  const addLamp = (x: number, y: number, z: number, material: THREE.Material, width: number, height: number): void => {
    addBox(0.075, height, width, material, x, y, z, 0.025);
  };
  const addWheels = (radius: number, width: number, axles: number[]): void => {
    for (const x of axles) {
      const front = x > 0.01;
      for (const side of [-1, 1] as const) {
        const wheel = detailedWheel(radius, width, x, side * (W * 0.5 + 0.04), front);
        wheels.push({
          pivot: wheel,
          spin: wheel.userData.spin as THREE.Group,
          radius,
          front,
        });
        chassis.add(wheel);
        const arch = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.03, 0.05, 8, 24, Math.PI), trim);
        arch.position.set(x, radius + 0.025, side * (W * 0.5 + 0.045));
        shell.add(arch);
      }
    }
  };

  if (kind === "motorcycle") {
    const radius = 0.29;
    const frontX = L * 0.36;
    const rearX = -L * 0.36;
    for (const x of [frontX, rearX]) {
      const tire = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.065, 10, 24), rubber);
      tire.position.set(0, 0, 0);
      // Spin the wheel about its axle by nesting it in a pivot at the hub.
      const hubPivot = new THREE.Group();
      hubPivot.position.set(x, radius, 0);
      hubPivot.add(tire);
      chassis.add(hubPivot);
      wheels.push({
        pivot: hubPivot,
        spin: hubPivot,
        radius,
        front: x > 0,
      });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.7, 0.018, 6, 20), alloy);
      rim.position.set(0, 0, 0.012);
      hubPivot.add(rim);
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 12), chrome);
      axle.rotation.x = Math.PI / 2;
      hubPivot.add(axle);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI * 2) / 8;
        vehicleSegment(
          hubPivot,
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(Math.cos(a) * radius * 0.65, Math.sin(a) * radius * 0.65, 0),
          0.008,
          alloy,
        );
      }
    }
    vehicleSegment(shell, new THREE.Vector3(rearX, 0.4, 0), new THREE.Vector3(0.42, 0.65, 0), 0.045, trim);
    vehicleSegment(shell, new THREE.Vector3(-0.28, 0.5, 0), new THREE.Vector3(frontX, 0.36, 0), 0.035, chrome);
    addBox(0.43, 0.34, W * 0.48, bodyMat, 0.08, 0.72, 0, 0.12);
    addBox(0.48, 0.13, W * 0.44, trim, -0.28, 0.78, 0, 0.055);
    addBox(0.36, 0.32, W * 0.46, trim, -0.07, 0.47, 0, 0.1);
    addBox(0.38, 0.07, W * 0.34, bodyMat, rearX * 0.72, 0.87, 0, 0.035);
    vehicleSegment(shell, new THREE.Vector3(frontX, radius, -0.1), new THREE.Vector3(0.41, 0.96, -0.1), 0.032, chrome);
    vehicleSegment(shell, new THREE.Vector3(frontX, radius, 0.1), new THREE.Vector3(0.41, 0.96, 0.1), 0.032, chrome);
    const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, W * 0.78, 10), chrome);
    handlebar.rotation.x = Math.PI / 2;
    handlebar.position.set(0.42, 0.99, 0);
    shell.add(handlebar);
    for (const side of [-1, 1]) {
      addBox(0.15, 0.05, 0.05, rubber, 0.42, 0.99, side * W * 0.34, 0.02);
      vehicleSegment(shell, new THREE.Vector3(0.44, 1.0, side * 0.28), new THREE.Vector3(0.26, 1.12, side * 0.18), 0.04, trim);
      const mirror = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), chrome);
      mirror.position.set(0.34, 1.16, side * 0.38);
      shell.add(mirror);
    }
    addBox(0.045, 0.11, 0.18, headlamp, frontX + 0.07, 0.84, 0, 0.04);
    addBox(0.05, 0.09, 0.12, taillamp, rearX - 0.05, 0.81, 0, 0.025);
    const riderSuit = new THREE.MeshStandardMaterial({ color: 0x303741, roughness: 0.88 });
    const rider = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.38, 4, 10), riderSuit);
    rider.position.set(-0.02, 1.07, 0);
    rider.rotation.z = -0.27;
    shell.add(rider);
    vehicleSegment(shell, new THREE.Vector3(0.08, 1.16, -0.1), new THREE.Vector3(0.39, 0.97, -0.27), 0.06, riderSuit);
    vehicleSegment(shell, new THREE.Vector3(0.08, 1.16, 0.1), new THREE.Vector3(0.39, 0.97, 0.27), 0.06, riderSuit);
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 18, 14),
      new THREE.MeshPhysicalMaterial({ color: 0x243845, roughness: 0.2, metalness: 0.36, clearcoat: 0.9 }),
    );
    helmet.position.set(0.12, 1.43, 0);
    shell.add(helmet);
    addBox(0.07, 0.075, 0.2, glassMat, 0.25, 1.42, 0, 0.035);
    addLamp(frontX + 0.1, 0.84, 0, signalLeft, 0.1, 0.05);
    addLamp(rearX - 0.08, 0.83, 0, signalRight, 0.1, 0.05);
  } else if (kind === "bus") {
    const radius = 0.48;
    addWheels(radius, 0.34, [L * 0.34, 0, -L * 0.34]);
    addBox(L * 0.98, 2.62, W * 0.96, bodyMat, 0, radius + 1.32, 0, 0.18);
    addBox(L * 0.72, 0.15, W * 0.99, trim, -L * 0.06, radius + 0.43, 0, 0.035);
    addBox(L * 0.92, 0.11, W * 0.82, alloy, -L * 0.02, radius + 0.85, 0, 0.025);
    addBox(0.08, 0.24, W * 0.52, trim, L * 0.5 + 0.025, radius + 2.28, 0, 0.025);
    for (let i = 0; i < 7; i++) {
      const x = -L * 0.34 + i * L * 0.108;
      for (const side of [-1, 1]) {
        addBox(L * 0.086, 0.72, 0.035, glassMat, x, radius + 2.02, side * W * 0.48, 0.05);
        addBox(0.026, 0.76, 0.04, alloy, x + L * 0.046, radius + 2.02, side * W * 0.49, 0.01);
      }
    }
    shell.add(vehicleFrontGlass(L * 0.49, radius + 1.93, W * 0.78, 1.02, glassMat));
    shell.add(vehicleFrontGlass(-L * 0.49, radius + 1.92, W * 0.76, 0.92, glassMat, true));
    for (const side of [-1, 1]) {
      addBox(0.58, 1.82, 0.045, glassMat, L * 0.24, radius + 1.22, side * W * 0.49, 0.035);
      addBox(0.055, 1.88, 0.055, bodyMat, L * 0.24, radius + 1.22, side * W * 0.5, 0.018);
      vehicleSegment(shell, new THREE.Vector3(L * 0.42, 1.95, side * W * 0.43), new THREE.Vector3(L * 0.53, 2.13, side * W * 0.62), 0.032, trim);
      addBox(0.24, 0.24, 0.14, trim, L * 0.53, 2.12, side * W * 0.62, 0.055);
      addLamp(L * 0.49, radius + 0.72, side * W * 0.35, headlamp, 0.28, 0.18);
      addLamp(-L * 0.49, radius + 0.72, side * W * 0.35, taillamp, 0.28, 0.2);
      addLamp(L * 0.49, radius + 0.43, side * W * 0.35, side > 0 ? signalLeft : signalRight, 0.18, 0.09);
      addLamp(-L * 0.49, radius + 0.43, side * W * 0.35, side > 0 ? signalLeft : signalRight, 0.18, 0.09);
      addBox(L * 0.86, 0.035, 0.04, side > 0 ? signalLeft : signalRight, -L * 0.015, radius + 0.61, side * W * 0.495, 0.012);
    }
    addBox(0.08, 0.25, W * 0.42, trim, L * 0.5 + 0.025, radius + 1.05, 0, 0.025);
  } else if (kind === "truck") {
    const radius = 0.46;
    addWheels(radius, 0.32, [L * 0.35, L * 0.02, -L * 0.31]);
    addBox(L * 0.94, 0.48, W * 0.92, trim, 0, radius + 0.22, 0, 0.08);
    addBox(L * 0.59, 2.45, W * 0.9, bodyMat, -L * 0.14, radius + 1.67, 0, 0.08);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 15; i++) addBox(0.025, 2.24, 0.025, alloy, -L * 0.42 + i * L * 0.04, radius + 1.67, side * W * 0.455, 0.01);
      addBox(L * 0.58, 0.11, 0.035, trim, -L * 0.14, radius + 0.51, side * W * 0.46, 0.02);
      addBox(L * 0.56, 0.055, 0.035, side > 0 ? signalLeft : signalRight, -L * 0.14, radius + 0.59, side * W * 0.465, 0.015);
      addLamp(L * 0.49, radius + 0.58, side * W * 0.34, side > 0 ? signalLeft : signalRight, 0.18, 0.08);
      addLamp(-L * 0.48, radius + 0.58, side * W * 0.34, side > 0 ? signalLeft : signalRight, 0.18, 0.08);
    }
    addBox(L * 0.32, 2.24, W * 0.98, bodyMat, L * 0.32, radius + 1.36, 0, 0.15);
    addBox(L * 0.32, 0.38, W * 0.94, trim, L * 0.32, radius + 0.25, 0, 0.07);
    shell.add(vehicleFrontGlass(L * 0.485, radius + 1.78, W * 0.78, 0.82, glassMat));
    for (const side of [-1, 1]) {
      addBox(L * 0.13, 0.78, 0.035, glassMat, L * 0.32, radius + 1.8, side * W * 0.5, 0.04);
      vehicleSegment(shell, new THREE.Vector3(L * 0.28, 1.42, side * W * 0.43), new THREE.Vector3(L * 0.43, 1.78, side * W * 0.47), 0.035, trim);
      addBox(0.28, 0.24, 0.18, trim, L * 0.44, 1.72, side * W * 0.57, 0.055);
      addLamp(L * 0.49, radius + 0.75, side * W * 0.33, headlamp, 0.28, 0.16);
      addLamp(-L * 0.48, radius + 0.64, side * W * 0.34, taillamp, 0.22, 0.2);
    }
    addBox(0.08, 0.38, W * 0.38, trim, L * 0.49, radius + 0.53, 0, 0.035);
    addBox(0.08, 1.72, W * 0.82, trim, -L * 0.49, radius + 1.67, 0, 0.035);
    for (const side of [-1, 1]) {
      addLamp(-L * 0.49, radius + 0.62, side * W * 0.34, taillamp, 0.24, 0.25);
    }
  } else {
    const radius = 0.34;
    addWheels(radius, 0.25, [dims.wheelbase * 0.5, -dims.wheelbase * 0.5]);
    shell.add(new THREE.Mesh(vehicleBodyShell(L * 0.96, W * 0.95), bodyMat));
    addBox(L * 0.34, 0.12, W * 0.84, bodyMat, L * 0.285, 0.87, 0, 0.065);
    addBox(L * 0.19, 0.1, W * 0.84, bodyMat, -L * 0.34, 0.84, 0, 0.05);
    addBox(1.62, 0.12, W * 0.78, bodyMat, -0.08, 1.38, 0, 0.075);
    addBox(L * 0.06, 0.18, W * 0.88, trim, 0, 0.56, 0, 0.045);
    const sideZ = W * 0.425;
    const frontSideGlass: [number, number][] = [[-0.28, 1.06], [0.72, 1.06], [0.37, 1.37], [-0.38, 1.37]];
    const rearSideGlass: [number, number][] = [[-1.46, 1.06], [-0.43, 1.06], [-0.48, 1.37], [-1.05, 1.37]];
    for (const side of [-1, 1]) {
      shell.add(vehicleSideGlass(frontSideGlass, side * (sideZ + 0.008), glassMat));
      shell.add(vehicleSideGlass(rearSideGlass, side * (sideZ + 0.008), glassMat));
      const barZ = side * (W * 0.46);
      vehicleSegment(shell, new THREE.Vector3(0.37, 1.39, barZ), new THREE.Vector3(0.78, 0.98, barZ), 0.044, bodyMat);
      vehicleSegment(shell, new THREE.Vector3(-0.39, 1.39, barZ), new THREE.Vector3(-0.4, 1.0, barZ), 0.04, bodyMat);
      vehicleSegment(shell, new THREE.Vector3(-1.05, 1.39, barZ), new THREE.Vector3(-1.46, 0.99, barZ), 0.044, bodyMat);
      addBox(1.95, 0.032, 0.03, chrome, -0.32, 1.045, side * (W * 0.47), 0.01);
      addBox(0.17, 0.042, 0.035, chrome, -0.28, 0.82, side * (W * 0.49), 0.014);
      addBox(1.72, 0.055, 0.08, trim, -0.22, 0.39, side * (W * 0.48), 0.025);
      addBox(1.58, 0.045, 0.035, chrome, -0.08, 0.65, side * (W * 0.49), 0.014);
      vehicleSegment(shell, new THREE.Vector3(0.69, 1.08, side * 0.86), new THREE.Vector3(0.91, 1.19, side * 1.02), 0.026, trim);
      addBox(0.29, 0.16, 0.15, trim, 0.94, 1.19, side * 1.02, 0.05);
      const mirror = new THREE.Mesh(
        new THREE.PlaneGeometry(0.2, 0.09),
        new THREE.MeshPhysicalMaterial({ color: 0x8499a1, roughness: 0.16, metalness: 0.4, side: THREE.DoubleSide }),
      );
      mirror.position.set(0.94, 1.19, side * 0.935);
      if (side > 0) mirror.rotation.y = Math.PI;
      shell.add(mirror);
      const turn = side > 0 ? signalLeft : signalRight;
      addLamp(L * 0.5 - 0.035, 0.75, side * W * 0.33, headlamp, 0.28, 0.14);
      addLamp(-L * 0.5 + 0.035, 0.75, side * W * 0.33, taillamp, 0.28, 0.16);
      addLamp(L * 0.5 - 0.03, 0.57, side * W * 0.34, turn, 0.16, 0.07);
      addLamp(-L * 0.5 + 0.03, 0.61, side * W * 0.34, turn, 0.16, 0.08);
    }
    shell.add(vehicleFrontGlass(0.79, 1.18, W * 0.82, 0.62, glassMat));
    shell.add(vehicleFrontGlass(-L * 0.45, 1.16, W * 0.64, 0.45, glassMat, true));
    addBox(0.08, 0.19, W * 0.34, trim, L * 0.5 + 0.005, 0.56, 0, 0.025);
    addBox(0.055, 0.09, 0.38, alloy, L * 0.5 + 0.04, 0.5, 0, 0.012);
    for (let i = 0; i < 5; i++) addBox(0.018, 0.13, 0.012, chrome, L * 0.5 + 0.053, 0.56, -0.14 + i * 0.07, 0.006);
    addBox(0.08, 0.18, W * 0.34, trim, -L * 0.5 - 0.005, 0.56, 0, 0.025);
    addBox(0.16, 0.08, W * 0.38, alloy, L * 0.5 + 0.028, 0.44, 0, 0.012);
    addBox(0.11, 0.11, W * 0.34, chrome, L * 0.5 + 0.06, 0.7, 0, 0.025);

    // High-mounted centre brake light — a detail the chase camera sees.
    addBox(0.05, 0.05, W * 0.5, taillamp, -L * 0.3, 1.4, 0, 0.02);

    // SUV / crossover: taller stance, roof rails. Hatchback: shorter tail.
    if (variant === 1) {
      shell.scale.y = 1.06;
      for (const side of [-1, 1]) {
        addBox(1.5, 0.05, 0.07, trim, -0.1, 1.46, side * (W * 0.34), 0.02);
      }
    } else if (variant === 2) {
      shell.scale.x = 0.94;
    }

    // Licence plates.
    const plateMat = plateMaterial();
    if (plateMat) {
      const rearPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.13), plateMat);
      rearPlate.rotation.y = -Math.PI / 2;
      rearPlate.position.set(-L * 0.505, 0.58, 0);
      shell.add(rearPlate);
      const frontPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.13), plateMat);
      frontPlate.rotation.y = Math.PI / 2;
      frontPlate.position.set(L * 0.505, 0.58, 0);
      shell.add(frontPlate);
    }
  }

  const shadow = contactShadow(W, L);
  if (shadow) g.add(shadow);

  if (kind === "ego") {
    const mirrors = new THREE.Group();
    const mirrorHousing = new THREE.MeshPhysicalMaterial({ color: 0x151a20, roughness: 0.32, metalness: 0.32, clearcoat: 0.8 });
    const indicators: { left: THREE.Mesh; right: THREE.Mesh } = {} as { left: THREE.Mesh; right: THREE.Mesh };
    const indicatorMaterials: { left: THREE.MeshStandardMaterial; right: THREE.MeshStandardMaterial } = {} as { left: THREE.MeshStandardMaterial; right: THREE.MeshStandardMaterial };
    for (const side of [-1, 1] as const) {
      const mount = vehicleBox(0.22, 0.04, 0.06, mirrorHousing, 0.88, 1.12, side * 0.91, 0.018);
      const shellBox = vehicleBox(0.29, 0.16, 0.15, mirrorHousing, 1.02, 1.2, side * 1.0, 0.05);
      mirrors.add(mount, shellBox);
      const glass = makeMirror(0.2, 0.1, `exterior-mirror-${side < 0 ? "left" : "right"}`);
      // Put the reflective face just outside the housing/body so its virtual
      // camera has an unobstructed rearward view of traffic.
      glass.position.set(1.02, 1.2, side * 1.078);
      if (side > 0) glass.rotation.y = Math.PI;
      mirrors.add(glass);
      const mark = new THREE.Shape();
      mark.moveTo(-0.065, 0); mark.lineTo(-0.024, 0.04); mark.lineTo(0.052, 0.04);
      mark.lineTo(0.07, 0); mark.lineTo(0.052, -0.04); mark.lineTo(-0.024, -0.04); mark.closePath();
      const indicatorMaterial = new THREE.MeshStandardMaterial({ color: 0x5b492f, emissive: 0x241300, emissiveIntensity: 0.3, side: THREE.DoubleSide, toneMapped: false });
      const indicator = new THREE.Mesh(
        new THREE.ShapeGeometry(mark),
        indicatorMaterial,
      );
      indicator.position.set(1.02, 1.2, side * 1.081);
      if (side > 0) indicator.rotation.y = Math.PI;
      mirrors.add(indicator);
      indicators[side < 0 ? "left" : "right"] = indicator;
      indicatorMaterials[side < 0 ? "left" : "right"] = indicatorMaterial;
    }
    shell.add(mirrors);
    g.userData.sideMirrors = mirrors;
    g.userData.bsmIndicators = indicators;
    g.userData.bsmIndicatorMaterials = indicatorMaterials;

    const interior = createCarInterior({ bodyMaterial: bodyMat, makeMirror, blindSpotMaterials: indicatorMaterials });
    shell.add(interior.group);
    Object.assign(g.userData, {
      cockpit: interior.group,
      cabinSeats: interior.seats,
      cockpitDisplay: interior.instrument,
      cockpitNavigation: interior.navigation,
      cockpitSpeed: -1,
      steeringWheel: interior.wheelSpin,
      wipers: interior.wipers,
      gearLights: interior.gearLights,
    });

    // Headlamp beams: two spot lights that only switch on at night.
    const beams: THREE.SpotLight[] = [];
    for (const side of [-1, 1]) {
      const beam = new THREE.SpotLight(0xfff3dc, 0, 62, 0.62, 0.55, 1.1);
      beam.position.set(L * 0.44, 0.72, side * W * 0.32);
      const target = new THREE.Object3D();
      target.position.set(L * 0.44 + 30, -0.4, side * W * 0.55);
      g.add(beam, target);
      beam.target = target;
      beams.push(beam);
    }
    g.userData.headlampBeams = beams;
  }

  g.userData.builtKind = kind;
  g.userData.builtVariant = variant;
  g.userData.bodyMats = bodyMats;
  g.userData.chassis = chassis;
  g.userData.shell = shell;
  g.userData.wheels = wheels;
  g.userData.brakeLamps = [taillamp];
  g.userData.headLamps = [headlamp];
  g.userData.turnLeft = signalLeft;
  g.userData.turnRight = signalRight;
  g.userData.prevSpeed = 0;
  g.userData.prevD = 0;
  g.userData.roll = 0;
  g.userData.pitch = 0;
  g.userData.steerVisual = 0;
  return g;
}

const DIMS: Record<Kind, VehicleDims> = {
  car: { length: 4.6, width: 1.9, wheelbase: 2.7 },
  truck: { length: 10, width: 2.4, wheelbase: 4 },
  bus: { length: 12, width: 2.55, wheelbase: 6 },
  motorcycle: { length: 1.9, width: 0.82, wheelbase: 1.25 },
  ego: { length: 4.7, width: 2.0, wheelbase: 2.8 },
};

export class CarFleet {
  readonly group = new THREE.Group();
  private ego: THREE.Group;
  private pool: THREE.Group[] = [];
  private night = false;
  private inCockpit = false;

  constructor(private sim: Simulation) {
    this.ego = makeVehicle("ego", THEME.egoBlue, 0x0a1a24, 0.32, sim.ego.dims);
    this.group.add(this.ego);
  }

  setCockpitView(enabled: boolean): void {
    this.inCockpit = enabled;
    const shell = this.ego.userData.shell as THREE.Group | undefined;
    const cockpit = this.ego.userData.cockpit as THREE.Group | undefined;
    if (!shell) return;
    for (const part of shell.children) {
      part.visible = part === cockpit ? enabled : !enabled;
    }
    shell.rotation.x = enabled ? 0 : (this.ego.userData.roll as number) ?? 0;
    shell.rotation.z = enabled ? 0 : (this.ego.userData.pitch as number) ?? 0;
    // The cabin has its own calibrated door mirrors; keep the exterior pair
    // out of this pass to avoid overlapping housings and reflection surfaces.
    const mirrors = this.ego.userData.sideMirrors as THREE.Group | undefined;
    if (mirrors) mirrors.visible = !enabled;
    // Seats are behind the calibrated eye; keep them present for side glances.
    const seats = this.ego.userData.cabinSeats as THREE.Object3D[] | undefined;
    if (seats) for (const seat of seats) seat.visible = true;
    for (const wheel of this.ego.userData.wheels as WheelRef[]) wheel.pivot.visible = !enabled;
  }

  setNight(night: boolean): void {
    this.night = night;
    const beams = this.ego.userData.headlampBeams as THREE.SpotLight[] | undefined;
    const high = this.sim.adas.status.extra.highBeam;
    if (beams) for (const beam of beams) {
      beam.intensity = night ? high ? 7.2 : 4.2 : 0;
      beam.distance = high ? 125 : 62; beam.angle = high ? .4 : .62;
      beam.target.position.y = high ? .6 : .1;
    }
  }

  renderExterior(render: () => void): void {
    const wasCockpit = this.inCockpit;
    this.setCockpitView(false);
    try { render(); } finally { this.setCockpitView(wasCockpit); }
  }

  updateMirrorWarnings(left: boolean, right: boolean, timeSeconds: number): void {
    const indicators = this.ego.userData.bsmIndicators as { left: THREE.Mesh; right: THREE.Mesh } | undefined;
    if (!indicators) return;
    for (const [side, active] of [["left", left], ["right", right]] as const) {
      const indicator = indicators[side];
      const material = indicator.material as THREE.MeshStandardMaterial;
      material.color.setHex(active ? 0xffb52e : 0x60491f);
      material.emissive.setHex(active ? 0xff8a00 : 0x100800);
      // Production BSM telltales stay steadily lit while the object is in the
      // blind zone; pulsing is reserved for urgent forward collision alerts.
      material.emissiveIntensity = active ? 4.2 : 0.12;
    }
  }

  updateCockpitDisplay(speedMps: number, limitKph: number | null = null): void {
    const display = this.ego.userData.cockpitDisplay as
      | { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }
      | undefined;
    if (!display) return;
    const t=this.sim.telemetry;
    const speedKph = Math.round(Math.abs(speedMps) * 3.6);
    const key = [speedKph,limitKph,t.gear,Math.round(t.rpm/100),t.engineOn,t.epbEngaged,t.adas.aeb,t.rearAeb,t.adas.fcw,t.rctaActive,t.indicator,t.adas.accActive,t.adas.laneCenteringActive,t.adas.leadGap?.toFixed(1),t.controlMode].join("|");
    if (this.ego.userData.cockpitSpeed === key) return;
    this.ego.userData.cockpitSpeed = key;
    const ctx = display.canvas.getContext("2d");
    if (!ctx) return;
    paintCockpitInstruments(ctx,t,speedKph,limitKph);
    display.texture.needsUpdate = true;
    for(const [gear,material] of Object.entries(this.ego.userData.gearLights as Record<string,THREE.MeshStandardMaterial>)) material.emissiveIntensity = gear === this.sim.gear ? 1.8 : 0;
  }

  private updateCockpitNavigation(time: number): void {
    if (time - (this.ego.userData.lastNavigationTime ?? -1) < .16) return;
    this.ego.userData.lastNavigationTime = time;
    const display = this.ego.userData.cockpitNavigation as { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture };
    const ctx = display.canvas.getContext("2d");
    if (!ctx) return;
    const sim = this.sim, ego = sim.ego;
    const f = sim.path.toFrenet(ego.x, ego.y);
    const project = (x: number, y: number): [number, number] => projectEgoPoint(x, y, ego.x, ego.y, ego.yaw, 2, 128, 190);
    ctx.fillStyle = "#101f29"; ctx.fillRect(0, 0, 256, 256);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 22, 256, 218); ctx.clip();
    for (const [width, color] of [[sim.road.totalWidth * 2, "#3a4b57"], [3, "#6ae4bd"]] as const) {
      ctx.lineWidth = width; ctx.strokeStyle = color; ctx.lineCap = "round"; ctx.beginPath();
      for (let ds = -40; ds <= 110; ds += 2) {
        const w = sim.path.toCartesian(f.s + ds, width === 3 ? sim.road.laneCenter(sim.telemetry.lane) : 0);
        const [x,y] = project(w.x, w.y);
        if (ds === -40) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();
    }
    for (const car of sim.traffic.cars) {
      const w = sim.path.toCartesian(car.s, car.d), [x,y] = project(w.x,w.y);
      if (y < 25 || y > 236 || x < 0 || x > 256) continue;
      ctx.fillStyle = car.disabled || car.kind === "stalled" ? "#ffbd61" : "#b8cedb";
      ctx.fillRect(x-3,y-5,6,10);
    }
    ctx.fillStyle = "#f1fff9"; ctx.beginPath(); ctx.moveTo(128,180); ctx.lineTo(121,198); ctx.lineTo(128,194); ctx.lineTo(135,198); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#08131b"; ctx.fillRect(0,0,256,26); ctx.fillRect(0,236,256,20);
    ctx.font = "600 11px Segoe UI"; ctx.textAlign = "center"; ctx.fillStyle = "#bad0dc";
    ctx.fillText(sim.track.name.toLocaleUpperCase("vi"),128,17);
    ctx.font = "9px Segoe UI"; ctx.fillText("TUYẾN ĐƯỜNG MÔ PHỎNG",128,249);
    display.texture.needsUpdate = true;
  }

  /** Animate every vehicle: wheels, steering, body motion and lights. */
  update(dt: number, timeSeconds: number): void {
    const sim = this.sim;
    const step = clamp(dt, 0, 0.1);
    const blinkOn = Math.sin(timeSeconds * 9) > 0;

    // ---- ego --------------------------------------------------------------
    const ego = sim.ego;
    place(this.ego, ego.x, ego.y, ego.yaw);
    const latAccel = (ego.v * ego.v * Math.tan(ego.delta)) / Math.max(ego.dims.wheelbase, 0.1);
    animateVehicle(this.ego, {
      dt: step,
      speed: sim.signedSpeed,
      steer: ego.delta,
      accel: ego.a,
      lateralRate: clamp(latAccel * 0.012, -0.09, 0.09),
      braking: ego.a < -0.6 || (ego.v > 1 && sim.driverInput.brake > 0),
      indicator: sim.controlMode === "manual" || sim.controlMode === "adas" ? sim.indicator : 0,
      blinkOn,
      night: this.night,
      motorcycle: false,
      hazards: false,
    });

    // ---- traffic ----------------------------------------------------------
    const cars = sim.traffic.cars;
    const previousPool = this.pool;
    const byId = new Map(previousPool.map(mesh => [mesh.userData.actorId as number, mesh]));
    this.pool = [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      let mesh = byId.get(c.id);
      const wantKind: Kind = c.kind === "truck" || c.kind === "bus" || c.kind === "motorcycle" ? c.kind : "car";
      const wantVariant = wantKind === "car" ? (c.variant ?? 0) : 0;
      if (!mesh || mesh.userData.builtKind !== wantKind || mesh.userData.builtVariant !== wantVariant) {
        const dims = DIMS[wantKind];
        mesh = makeVehicle(wantKind, paintFor(wantKind, c.hue).getHex(), 0x000000, 0, dims, wantVariant);
        mesh.userData.prevSpeed = c.v;
        mesh.userData.prevD = c.d;
        this.group.add(mesh);
      }
      mesh.userData.actorId = c.id;
      this.pool.push(mesh);

      if (wantKind === "truck") mesh.scale.set(c.length / DIMS.truck.length, 1, c.width / DIMS.truck.width);
      else if (wantKind === "bus") mesh.scale.set(c.length / DIMS.bus.length, 1, c.width / DIMS.bus.width);
      else if (wantKind === "motorcycle") mesh.scale.set(c.length / DIMS.motorcycle.length, 1, c.width / DIMS.motorcycle.width);
      else mesh.scale.set(c.length / DIMS.car.length, 1, c.width / DIMS.car.width);

      const world = sim.path.toCartesian(c.s, c.d);
      const heading = sim.path.cartesianAt(c.s).heading + (c.crossing ? (Math.sign(c.crossingToD - c.d) || 1) * Math.PI / 2 : c.headingOffset ?? 0);
      place(mesh, world.x, world.y, heading);

      const still = c.kind === "stalled" || c.disabled;
      const laneDelta = sim.road.laneCenter(c.lane) - c.d;
      const indicator = still ? 0 : Math.abs(laneDelta) > 0.12 ? (laneDelta > 0 ? -1 : 1) : 0;
      const lateralRate = step > 0 ? (c.d - (mesh.userData.prevD as number)) / step : 0;
      const accel = step > 0 ? (c.v - (mesh.userData.prevSpeed as number)) / step : 0;
      mesh.userData.prevD = c.d;
      mesh.userData.prevSpeed = c.v;

      // Vehicles retain their paint; warnings use lamps and the ADAS display.
      const paint = paintFor(wantKind, c.hue);
      const mats = mesh.userData.bodyMats as THREE.MeshStandardMaterial[];
      for (const material of mats) { material.color.copy(paint); material.emissive.setHex(0); material.emissiveIntensity = 0; }

      animateVehicle(mesh, {
        dt: step,
        speed: c.disabled ? 0 : c.crossing ? c.crossingSpeed : c.v,
        steer: clamp(lateralRate * 0.24, -0.4, 0.4),
        accel,
        lateralRate: wantKind === "motorcycle" ? clamp(lateralRate * 0.42, -0.4, 0.4) : clamp(lateralRate * 0.06, -0.09, 0.09),
        braking: accel < -0.8 || still,
        indicator,
        blinkOn,
        night: this.night,
        motorcycle: wantKind === "motorcycle",
        hazards: still,
      });
    }

    const retained = new Set(this.pool);
    for (const mesh of previousPool) if (!retained.has(mesh)) { this.group.remove(mesh); disposeVehicle(mesh); }
    this.updateCockpitNavigation(timeSeconds);

    // Cockpit steering wheel follows the real steering angle.
    const steeringWheel = this.ego.userData.steeringWheel as THREE.Group | undefined;
    if (steeringWheel) steeringWheel.rotation.x = -sim.ego.delta * 12;
    for (const wiper of this.ego.userData.wipers as THREE.Group[] ?? []) {
      wiper.rotation.z = sim.weather === "rain" ? .05 + (Math.sin(sim.metrics.time * 5.5 - Math.PI / 2) + 1) * .55 : .05;
    }
  }
}

interface AnimateInput {
  dt: number;
  speed: number;
  steer: number;
  accel: number;
  lateralRate: number;
  braking: boolean;
  indicator: number;
  blinkOn: boolean;
  night: boolean;
  motorcycle: boolean;
  hazards: boolean;
}

/** Shared per-vehicle animation: wheels, body attitude and lights. */
function animateVehicle(mesh: THREE.Group, input: AnimateInput): void {
  const wheels = mesh.userData.wheels as WheelRef[] | undefined;
  if (wheels) {
    for (const wheel of wheels) {
      wheel.spin.rotation.z -= (input.speed * input.dt) / Math.max(wheel.radius, 0.1);
      if (wheel.front) {
        const target = -input.steer;
        wheel.pivot.rotation.y += (target - wheel.pivot.rotation.y) * Math.min(1, input.dt * 10);
      }
    }
  }

  const shell = mesh.userData.shell as THREE.Group | undefined;
  if (shell) {
    const rollTarget = -input.lateralRate;
    const pitchTarget = clamp(input.accel * 0.0055, -0.035, 0.035);
    const prevRoll = (mesh.userData.roll as number) ?? 0;
    const prevPitch = (mesh.userData.pitch as number) ?? 0;
    const k = Math.min(1, input.dt * 7);
    const roll = prevRoll + (clamp(rollTarget, -0.45, 0.45) - prevRoll) * k;
    const pitch = prevPitch + (pitchTarget - prevPitch) * k;
    // A bike leans the whole chassis about the contact patch; a car rolls only
    // its body on the suspension, leaving the wheels flat on the road.
    const chassis = mesh.userData.chassis as THREE.Group | undefined;
    if (input.motorcycle && chassis) {
      chassis.rotation.x = roll;
      shell.rotation.x = 0;
    } else {
      shell.rotation.x = roll;
      if (chassis) chassis.rotation.x = 0;
    }
    shell.rotation.z = pitch;
    mesh.userData.roll = roll;
    mesh.userData.pitch = pitch;
  }

  const brakeLamps = mesh.userData.brakeLamps as THREE.MeshStandardMaterial[] | undefined;
  if (brakeLamps) {
    const glow = input.braking ? 3.4 : 1.1;
    for (const material of brakeLamps) material.emissiveIntensity = glow;
  }
  const headLamps = mesh.userData.headLamps as THREE.MeshStandardMaterial[] | undefined;
  if (headLamps) {
    for (const material of headLamps) material.emissiveIntensity = input.night ? 3.2 : 0.9;
  }
  const left = mesh.userData.turnLeft as THREE.MeshStandardMaterial | undefined;
  const right = mesh.userData.turnRight as THREE.MeshStandardMaterial | undefined;
  const showLeft = input.hazards ? input.blinkOn : input.indicator < 0 && input.blinkOn;
  const showRight = input.hazards ? input.blinkOn : input.indicator > 0 && input.blinkOn;
  if (left) left.emissiveIntensity = showLeft ? 3.2 : 0.18;
  if (right) right.emissiveIntensity = showRight ? 3.2 : 0.18;
}

/** Place a vehicle group at sim (x, y) with sim heading `yaw`. */
function place(obj: THREE.Object3D, x: number, y: number, yaw: number): void {
  obj.position.set(x, 0, y);
  obj.rotation.y = -yaw;
}
