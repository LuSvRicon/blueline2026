import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { dashboardGeometry, leatherGrain, makeSteeringWheel } from "./CockpitGeometry.ts";
import { COCKPIT_RIG } from "./CockpitRig.ts";

export interface CabinDisplay { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }
export interface CarInterior {
  group: THREE.Group;
  seats: THREE.Object3D[];
  instrument: CabinDisplay;
  navigation: CabinDisplay;
  wheelSpin: THREE.Object3D;
  wipers: THREE.Group[];
  gearLights: Record<string, THREE.MeshStandardMaterial>;
}
interface InteriorOptions {
  bodyMaterial: THREE.Material;
  makeMirror: (width: number, height: number, name: string) => THREE.Object3D;
  blindSpotMaterials: { left: THREE.MeshStandardMaterial; right: THREE.MeshStandardMaterial };
  canvasFactory?: () => HTMLCanvasElement;
}

/** A complete left-hand-drive passenger-car cabin. Every component is authored
 * against CockpitRig so screens face the eye and the doors meet the dashboard. */
export function createCarInterior(options: InteriorOptions): CarInterior {
  const group = new THREE.Group(); group.name = "passenger-car-interior";
  const grain = leatherGrain();
  const trim = new THREE.MeshStandardMaterial({ color: 0x12191e, roughness: .72, metalness: .08 });
  const soft = new THREE.MeshStandardMaterial({ color: 0x252d32, roughness: .88, roughnessMap: grain, bumpMap: grain, bumpScale: .0006 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x1b2328, roughness: .88, roughnessMap: grain, bumpMap: grain, bumpScale: .0005 });
  const aluminium = new THREE.MeshStandardMaterial({ color: 0x79878e, metalness: .78, roughness: .37 });
  const headliner = new THREE.MeshStandardMaterial({ color: 0x777d7e, roughness: .97 });
  const carpet = new THREE.MeshStandardMaterial({ color: 0x141a1d, roughness: 1 });
  const box = (name: string, size: [number,number,number], position: [number,number,number], material: THREE.Material, radius = .025): THREE.Mesh => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(...size, 3, Math.min(radius, Math.min(...size) * .45)), material);
    mesh.name = name; mesh.position.set(...position); group.add(mesh); return mesh;
  };
  const tube = (name: string, points: THREE.Vector3[], radius: number, material: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, radius, 10, false), material);
    mesh.name = name; group.add(mesh); return mesh;
  };
  const polygon = (points: [number,number,number][], material: THREE.Material, name: string): THREE.Mesh => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(),3));
    geometry.setIndex([0,1,2,0,2,3]); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; group.add(mesh); return mesh;
  };
  const display = (width: number, height: number): CabinDisplay => {
    const canvas = options.canvasFactory?.() ?? document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d"); if (ctx) { ctx.fillStyle = "#071218"; ctx.fillRect(0,0,width,height); }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, texture };
  };
  const screen = (name: string, position: THREE.Vector3, width: number, height: number, source: CabinDisplay): THREE.Mesh => {
    box(`${name}-bezel`, [.075,height+.028,width+.035], [position.x+.045,position.y,position.z],trim,.018);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({ map:source.texture,toneMapped:false }));
    mesh.name = name; mesh.rotation.y = -Math.PI/2; mesh.position.copy(position); group.add(mesh); return mesh;
  };

  box("cabin-floor",[3.3,.09,1.85],[-.45,.18,0],carpet,.02);
  const dashboard = new THREE.Mesh(dashboardGeometry(),soft); dashboard.name = "continuous-dashboard"; group.add(dashboard);
  box("dashboard-fascia",[.15,.29,1.85],[.50,.735,0],soft,.06);
  box("dashboard-trim-rail",[.018,.016,1.78],[.417,.84,0],aluminium,.005);
  const instrument = display(1024,384);
  screen("instrument-screen",COCKPIT_RIG.cluster,.55,.205,instrument);
  box("instrument-hood-top",[.31,.045,.65],[.71,1.185,-.43],trim,.02);
  for (const side of [-1,1]) box("instrument-hood-side",[.27,.215,.03],[.70,1.06,-.43+side*.318],trim,.012);

  const navigation = display(256,256);
  screen("infotainment-screen",COCKPIT_RIG.infotainment,.42,.255,navigation);
  // The lower edge of the display is carried by the fascia, not a floating stem.
  box("infotainment-mount",[.22,.075,.37],[.57,.895,.29],trim,.025);
  for (const z of [-.82,.30,.81]) {
    const width = z === .30 ? .42 : .18;
    box("air-vent",[.025,.062,width],[.411,.79,z],trim,.012);
    for(let row=-1;row<=1;row++) box("air-vent-louvre",[.007,.005,width-.025],[.395,.79+row*.017,z],aluminium,.001);
  }
  box("climate-control-strip",[.025,.09,.37],[.408,.675,.30],trim,.014);
  for (const z of [.17,.43]) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(.021,.021,.025,20),aluminium);
    knob.rotation.z = Math.PI/2; knob.position.set(.386,.685,z); group.add(knob);
  }
  box("hazard-switch",[.014,.02,.035],[.386,.685,.30],new THREE.MeshStandardMaterial({color:0x983e3b}),.004);

  const consoleShape = new THREE.Shape();
  [[-1.1,.22],[-1.1,.48],[-.75,.52],[-.25,.50],[.1,.53],[.48,.69],[.70,.69],[.70,.22]].forEach(([x,y],index)=>index?consoleShape.lineTo(x,y):consoleShape.moveTo(x,y));
  consoleShape.closePath();
  const consoleBody = new THREE.Mesh(new THREE.ExtrudeGeometry(consoleShape,{depth:.36,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:3,steps:1}),trim);
  consoleBody.name = "continuous-centre-console"; consoleBody.position.z=-.13; group.add(consoleBody);
  box("centre-armrest",[.53,.10,.34],[-.78,.56,.05],leather,.04);
  box("gear-selector-base",[.28,.025,.22],[-.23,.54,.05],aluminium,.012);
  box("gear-selector-stem",[.045,.12,.045],[-.23,.61,.05],trim,.012);
  box("gear-selector-grip",[.09,.065,.085],[-.25,.685,.05],leather,.024);
  for (const x of [-.45,-.64]) {
    const cup = new THREE.Mesh(new THREE.TorusGeometry(.055,.008,8,24),trim); cup.rotation.x=Math.PI/2;
    cup.position.set(x,.545,.05); group.add(cup);
  }
  const gearLights: Record<string,THREE.MeshStandardMaterial> = {};
  for (const [index,gear] of ["P","R","N","D"].entries()) {
    const material = new THREE.MeshStandardMaterial({color:0x31413d,emissive:0x5ce3b0,emissiveIntensity:0,toneMapped:false});
    box(`gear-led-${gear}`,[.024,.003,.008],[-.30+index*.047,.558,.16],material,.001); gearLights[gear]=material;
  }
  const wheel = makeSteeringWheel(leather,aluminium); group.add(wheel);
  tube("steering-column",[COCKPIT_RIG.wheel.clone().add(new THREE.Vector3(.035,0,0)),new THREE.Vector3(.58,.87,-.43)],.041,trim);
  for(const side of [-1,1]) box("stalk",[.13,.021,.022],[.29,COCKPIT_RIG.wheel.y+.03,-.43+side*.19],trim,.008);

  const glass = new THREE.MeshPhysicalMaterial({color:0xc0d7dd,roughness:.14,transparent:true,opacity:.012,depthWrite:false,side:THREE.DoubleSide});
  polygon([[1.18,.97,-1.0],[1.18,.97,1.0],[.49,1.59,.88],[.49,1.59,-.88]],glass,"sloped-windscreen");
  for (const side of [-1,1] as const) {
    const sideName = side<0?"left":"right";
    box(`${sideName}-door-panel`,[2.08,.65,.085],[-.24,.59,side*.94],soft,.04);
    box(`${sideName}-door-beltline`,[1.90,.075,.095],[-.25,.945,side*.945],trim,.03);
    box(`${sideName}-door-armrest`,[.64,.075,.12],[-.36,.66,side*.865],leather,.025);
    box(`${sideName}-door-handle`,[.14,.026,.027],[.12,.785,side*.888],aluminium,.009);
    box(`${sideName}-window-switches`,[.19,.017,.075],[-.24,.71,side*.865],trim,.01);
    tube(`${sideName}-a-pillar`,[new THREE.Vector3(1.14,.96,side*.99),new THREE.Vector3(.92,1.28,side*.96),new THREE.Vector3(.49,1.59,side*.88)],.037,headliner);
    tube(`${sideName}-roof-rail`,[new THREE.Vector3(.49,1.59,side*.88),new THREE.Vector3(-.3,1.63,side*.97),new THREE.Vector3(-1.44,1.55,side*.98)],.042,headliner);
    box(`${sideName}-b-pillar`,[.085,.65,.075],[-1.26,1.27,side*.96],headliner,.024);
    polygon([[.96,.99,side*.985],[-1.26,.99,side*.985],[-1.26,1.55,side*.965],[.49,1.59,side*.88]],glass,`${sideName}-side-window`);
    const speaker = new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,.015,24),trim); speaker.rotation.x=Math.PI/2; speaker.position.set(.32,.43,side*.892); group.add(speaker);

    // Real-sized door mirror and its sail panel meet the front of the door.
    const sailMaterial = trim.clone(); sailMaterial.side = THREE.DoubleSide;
    polygon([[1.12,.97,side*.99],[.84,.97,side*.99],[.89,1.17,side*.99],[1.02,1.22,side*.99]],sailMaterial,`${sideName}-mirror-sail`);
    tube(`${sideName}-mirror-mount`,[new THREE.Vector3(.91,1.055,side*.96),new THREE.Vector3(.95,1.09,side*1.10)],.025,trim);
    const angle = side<0 ? -1.25 : -2.34;
    const normal = new THREE.Vector3(Math.sin(angle),0,Math.cos(angle));
    const centre = new THREE.Vector3(.96,1.115,side*1.10);
    const housing=box(`${sideName}-mirror-housing`,[.265,.148,.058],[centre.x,centre.y,centre.z],trim,.028); housing.rotation.y=angle;
    const lens=options.makeMirror(.235,.118,`cabin-mirror-${sideName}`);
    lens.position.copy(centre).addScaledVector(normal,.032); lens.rotation.y=angle; group.add(lens);
    const symbol = new THREE.Shape(); symbol.moveTo(-.019,-.012);symbol.lineTo(.019,-.012);symbol.lineTo(0,.020);symbol.closePath();
    const hole = new THREE.Path(); hole.moveTo(-.013,-.008);hole.lineTo(0,.012);hole.lineTo(.013,-.008);hole.closePath();symbol.holes.push(hole);
    const led=new THREE.Mesh(new THREE.ShapeGeometry(symbol),side<0?options.blindSpotMaterials.left:options.blindSpotMaterials.right);
    led.name=`${sideName}-blind-spot-led`;
    led.position.copy(centre).addScaledVector(normal,.036).addScaledVector(new THREE.Vector3(Math.cos(angle),0,-Math.sin(angle)),side*.075);
    led.position.y+=.022;
    led.rotation.y=angle;led.renderOrder=4;group.add(led);
  }
  box("roof-headliner",[2.56,.045,1.91],[-.80,1.65,0],headliner,.02);
  tube("windscreen-header",[new THREE.Vector3(.49,1.59,-.88),new THREE.Vector3(.49,1.62,0),new THREE.Vector3(.49,1.59,.88)],.04,headliner);
  for(const side of [-1,1]) box("sun-visor",[.31,.045,.39],[.24,1.59,side*.47],headliner,.018);
  const rearHousing=box("rear-view-housing",[.07,.092,.265],[.77,1.435,.05],trim,.025);rearHousing.rotation.z=-.04;
  const rearMirror=options.makeMirror(.235,.07,"cabin-rearview-mirror"); rearMirror.rotation.y=-Math.PI/2;rearMirror.position.set(.729,1.435,.05);group.add(rearMirror);
  tube("rear-view-stalk",[new THREE.Vector3(.82,1.46,.05),new THREE.Vector3(.60,1.60,.05)],.013,trim);

  const seats: THREE.Object3D[]=[];
  for(const side of [-1,1]) {
    const seat=new THREE.Group();seat.name=side<0?"driver-seat":"passenger-seat";
    const cushion=new THREE.Mesh(new RoundedBoxGeometry(.75,.22,.55,4,.07),leather);cushion.position.set(-.78,.43,side*.46);
    const back=new THREE.Mesh(new RoundedBoxGeometry(.20,.67,.55,4,.07),leather);back.position.set(-1.12,.85,side*.46);back.rotation.z=.12;
    const head=new THREE.Mesh(new RoundedBoxGeometry(.17,.20,.36,4,.05),leather);head.position.set(-1.18,1.29,side*.46);
    seat.add(cushion,back,head);group.add(seat);seats.push(seat);
  }
  box("bonnet-edge",[.68,.07,1.56],[1.93,.82,0],options.bodyMaterial,.03);
  const wipers: THREE.Group[]=[];
  const screenUp=new THREE.Vector3(-.69,.62,0).normalize();
  const screenRight=new THREE.Vector3(0,0,1),screenNormal=screenRight.clone().cross(screenUp);
  for(const z of [-.76,.02]) {
    const mount=new THREE.Group();mount.name="wiper-spindle";
    mount.position.set(1.18-(1.005-.97)*.69/.62,1.005,z).addScaledVector(screenNormal,-.015);
    mount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(screenRight,screenUp,screenNormal));
    const wiper=new THREE.Group();wiper.name="wiper-sweep";mount.add(wiper);
    const arm=new THREE.Mesh(new THREE.CylinderGeometry(.005,.007,.32,8),aluminium);
    arm.rotation.z=-Math.PI/2;arm.position.set(.16,0,0);wiper.add(arm);
    const blade=new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,.46,8),trim);
    blade.rotation.z=-Math.PI/2;blade.position.set(.35,.018,0);wiper.add(blade);
    group.add(mount);wipers.push(wiper);
  }
  const fill=new THREE.PointLight(0xddeaff,.22,3.2,2);fill.position.set(-.25,1.60,0);group.add(fill);
  group.visible=false;
  return {group,seats,instrument,navigation,wheelSpin:wheel.getObjectByName("wheel-spin")!,wipers,gearLights};
}
