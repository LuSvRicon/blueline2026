// Blueline — entry point. Wires the headless Simulation to the Three.js views
// and the DOM HUD, and drives everything from a fixed-timestep game loop so the
// physics/planner are deterministic regardless of the display refresh rate.

import "./ui/styles.css";
import { Simulation } from "./sim/Simulation.ts";
import { Scene } from "./render/Scene.ts";
import { RoadView } from "./render/RoadView.ts";
import { CarFleet } from "./render/CarFleet.ts";
import { PathRibbon } from "./render/PathRibbon.ts";
import { CandidatesView } from "./render/CandidatesView.ts";
import { TracksView } from "./render/TracksView.ts";
import { OccupancyView } from "./render/OccupancyView.ts";
import { SensorView } from "./render/SensorView.ts";
import { BuildingsView } from "./render/BuildingsView.ts";
import { PedestrianView } from "./render/PedestrianView.ts";
import { TrafficLightView } from "./render/TrafficLightView.ts";
import { RoadSignsView } from "./render/RoadSignsView.ts";
import { TrailView } from "./render/TrailView.ts";
import { CrossStreetView } from "./render/CrossStreetView.ts";
import { getTrack } from "./world/track.ts";
import { HUD } from "./ui/HUD.ts";
import { ControlPanel } from "./ui/ControlPanel.ts";
import { LearningPanel } from "./ui/LearningPanel.ts";
import { Scorecard } from "./ui/Scorecard.ts";
import { Minimap } from "./ui/Minimap.ts";
import { IntroOverlay } from "./ui/IntroOverlay.ts";
import { Shortcuts } from "./ui/Shortcuts.ts";
import { DriveControls } from "./ui/DriveControls.ts";
import { ADASPanel } from "./ui/ADASPanel.ts";
import { SimulationAudio } from "./audio/SimulationAudio.ts";
import { TelemetryPanel } from "./ui/TelemetryPanel.ts";
import { PedalControls } from "./ui/PedalControls.ts";
import { CenterConsoleControls } from "./ui/CenterConsoleControls.ts";
import { Camera360Widget } from "./ui/Camera360Widget.ts";
import { CockpitLayout } from "./ui/CockpitLayout.ts";
import "./ui/game.css";
import "./ui/dashboard-controls.css";
import "./ui/dashboard-adas.css";
import "./ui/dashboard.css";
import "./ui/mobile.css";
import "./ui/station.css";
import { TouchSteering } from "./ui/TouchSteering.ts";
import { SCENARIOS } from "./ui/scenarios.ts";
import { CabinLookControls } from "./ui/CabinLookControls.ts";
import { ParkingView } from "./render/ParkingView.ts";
import { ARHudView } from "./render/ARHudView.ts";
import {WorldSceneryView} from './render/WorldSceneryView.ts';
import {RenderMotion} from './render/RenderMotion.ts';
import {selectedVehicleModel} from './render/VehicleCatalog.ts';
import { RuntimePerformance } from './diagnostics/RuntimePerformance.ts';
import './ui/runtime-performance.css';

function boot(): void {
  const canvas = document.getElementById("scene") as HTMLCanvasElement;
  const uiRoot = document.getElementById("ui") as HTMLElement;
  const loading = document.getElementById("loading");

  const params = new URLSearchParams(location.search);
  const sim = new Simulation({ trackId: getTrack(params.get("map") ?? undefined).id });
  sim.setVehicleProfile(selectedVehicleModel());

  // Vietnamese traffic is the default; profile and scenarios can be deep-linked.
  sim.setTrafficProfile(params.get("profile") === "international" ? "international" : "vietnam");
  const wanted = params.get("scenario");
  const known = SCENARIOS.map(scenario => scenario.id as string);
  if (wanted && known.includes(wanted)) sim.setScenario(wanted as never);
  const wx = params.get("weather");
  const wantedMode = params.get("mode");
  if (wantedMode === "adas" || wantedMode === "manual") {
    sim.setControlMode(wantedMode);
    sim.reset();
  }
  // A livelier default city without changing deterministic laboratory scenarios.
  if((!wanted||wanted==='highway')&&!sim.track.road){sim.traffic.populateDistrict(0,48);sim.reset();}

  const scene = new Scene(canvas);
  scene.setLandscape(sim.track.road?.environment??'urban');
  if (params.get("cam") === "top") scene.cameraMode = "top";
  else if (params.get("cam") === "cockpit") scene.cameraMode = "cockpit";
  else if (params.get("cam") === "orbit") scene.cameraMode = "orbit";
  if (wx === "rain" || wx === "fog") {
    sim.setWeather(wx);
    scene.setWeather(wx);
  }
  let renderedWeather = sim.weather;
  scene.setTimeOfDay(params.get("tod") === "night" ? "night" : "day");
  const buildings = new BuildingsView(sim.road,sim.staticWorld);
  const scenery=new WorldSceneryView(sim.road,sim.staticWorld);buildings.group.add(scenery.buildings);scene.add(scenery.group);
  const road = new RoadView(sim.road);
  const fleet = new CarFleet(sim);
  const ribbon = new PathRibbon();
  const arHud = new ARHudView();
  ribbon.group.add(arHud.group);
  const candidates = new CandidatesView();
  const tracksView = new TracksView();
  const occupancyView = new OccupancyView(sim.occupancy);
  const sensorView = new SensorView(sim.sensor.config.range);
  const pedView = new PedestrianView(sim.path);
  const lightView = new TrafficLightView(sim.path, sim.road.totalWidth / 2);
  const signView = new RoadSignsView(sim.path, sim.roadSigns, sim.road.pavedHalfWidth);
  const trailView = new TrailView();
  const parkingView = new ParkingView(sim);

  const crossStreets = new CrossStreetView(sim.path, sim.track.junctions, sim.road.totalWidth / 2);
  scene.add(buildings.group);
  scene.add(crossStreets.group);
  scene.add(road.group);
  scene.add(lightView.group);
  scene.add(signView.group);
  scene.add(trailView.mesh);
  scene.add(sensorView.object);
  scene.add(occupancyView.object);
  scene.add(fleet.group);
  scene.add(pedView.group);
  scene.add(candidates.lines);
  scene.add(ribbon.group);
  scene.add(tracksView.object);
  scene.add(parkingView.group);

  const hud = new HUD(uiRoot);
  const audio = new SimulationAudio();
  const scorecard = new Scorecard(uiRoot, sim);
  const minimap = new Minimap(uiRoot, sim);
  const adasPanel = new ADASPanel(uiRoot, sim, (active) => {
    if (active) audio.honk(0.18);
  });
  const runtimePerformance = new RuntimePerformance();
  const telemetryPanel = new TelemetryPanel(uiRoot, sim, runtimePerformance, () => scene.testGraphicsRecovery());
  // eslint-disable-next-line no-new
  new IntroOverlay(uiRoot, sim, scene);
  // eslint-disable-next-line no-new
  new Shortcuts();
  const learningPanel = new LearningPanel(uiRoot, sim);
  // eslint-disable-next-line no-new
  const driveControls = new DriveControls(
    sim,
    () => {
      const modes: Array<"chase" | "top" | "cockpit" | "orbit"> = ["chase", "top", "cockpit", "orbit"];
      const idx = modes.indexOf(scene.cameraMode);
      scene.cameraMode = modes[(idx + 1) % modes.length];
    },
    () => audio.honk(0.18),
  );
  const pedalControls = new PedalControls(uiRoot, driveControls);
  const consoleControls = new CenterConsoleControls(uiRoot, sim);
  const camera360 = new Camera360Widget(uiRoot, sim);
  const controlPanel = new ControlPanel(uiRoot, sim, scene, candidates, {
    occupancy: occupancyView.object,
    tracks: tracksView.object,
    sensor: sensorView.object,
    buildings: buildings.group,
    navigation: ribbon.group,
  }, audio);
  const cockpitLayout = new CockpitLayout(uiRoot, sim, scene, driveControls, camera360, telemetryPanel);
  const touchSteering = new TouchSteering(uiRoot, driveControls);
  const cabinLook = new CabinLookControls(canvas,scene,()=>sim.paused);
  const graphicsNotice = document.createElement('div');
  graphicsNotice.id = 'graphics-recovery-status'; graphicsNotice.className = 'graphics-recovery-status';
  graphicsNotice.setAttribute('role', 'alert'); graphicsNotice.hidden = true;
  graphicsNotice.innerHTML = '<span></span><button type="button">Tải lại mô phỏng</button>';
  graphicsNotice.querySelector('button')!.addEventListener('click', () => location.reload());
  uiRoot.appendChild(graphicsNotice);
  scene.onGraphicsStateChange = state => {
    driveControls.clear();
    const unavailable = state !== 'ready';
    uiRoot.dataset.graphicsUnavailable = String(unavailable);
    graphicsNotice.hidden = !unavailable;
    graphicsNotice.querySelector('span')!.textContent = state === 'failed'
      ? 'Chưa khôi phục được hình ảnh. Hãy tải lại mô phỏng.' : 'Đang khôi phục hình ảnh · các phím đang giữ đã được nhả';
    (graphicsNotice.querySelector('button') as HTMLButtonElement).hidden = state !== 'failed';
    if (state === 'lost') runtimePerformance.contextLosses++;
    if (state === 'ready') runtimePerformance.contextRestores++;
  };

  // ---- fixed-timestep loop ----------------------------------------------
  const fixedDt = sim.config.fixedDt;
  let last = performance.now();
  let acc = 0;
  let firstFrame = true;
  let lastCollisions = 0;
  let fps = 60;
  let lastSurroundFrame = -Infinity;
  let lastUIFrame = -Infinity;
  const motion=new RenderMotion();
  scene.renderer.info.autoReset = false;
  document.addEventListener('visibilitychange', () => {
    // Resume with fresh input/timing, without toggling the user's pause state
    // or treating minutes in another app as one massive render frame.
    driveControls.clear(); last = performance.now(); acc = 0;
  });

  // A small scripting handle for debugging and live demos from the dev console.
  (window as unknown as Record<string, unknown>).blueline = { sim, scene, fleet, fps: () => fps };

  function frame(now: number): void {
    requestAnimationFrame(frame);
    const workStarted = performance.now();
    const rawFrameMs = now - last;
    let delta = rawFrameMs / 1000;
    last = now;
    if (delta > 0.1) delta = 0.1; // avoid spiral-of-death after a tab stall
    if (rawFrameMs > .1) fps = fps * 0.9 + (1000 / rawFrameMs) * 0.1;
    // Do not advance an invisible vehicle while the GPU is unavailable. This
    // does not alter the driver's pause setting or replay elapsed wall time.
    if (scene.graphicsState !== 'ready') { acc = 0; return; }
    scene.renderer.info.reset();
    acc += delta;

    let steps = 0;
    while (acc >= fixedDt && steps < 6) {
      sim.night = scene.timeOfDay === "night";
      driveControls.update(fixedDt);
      motion.capture(sim);
      sim.step(fixedDt);
      acc -= fixedDt;
      steps++;
    }

    if (sim.weather !== renderedWeather) {
      scene.setWeather(sim.weather);
      renderedWeather = sim.weather;
    }

    // ---- sync views ----
    const presentation=motion.sample(sim,acc/fixedDt,fixedDt),eye=presentation.ego;
    fleet.setNight(scene.timeOfDay === "night");
    buildings.setNight(scene.timeOfDay === "night");
    road.setNight(scene.timeOfDay === "night");
    road.setWeather(sim.weather);
    fleet.update(sim.paused ? 0 : delta, now * 0.001,presentation);
    fleet.setCockpitView(scene.cameraMode === "cockpit");
    fleet.updateCockpitDisplay(sim.ego.v, sim.telemetry.speedLimitKph);
    fleet.updateMirrorWarnings(sim.adas.status.blindSpotLeft || sim.adas.status.extra.safeExitLeft, sim.adas.status.blindSpotRight || sim.adas.status.extra.safeExitRight, now * 0.001);
    pedView.update(sim.pedestrians.peds,presentation.peds);
    parkingView.update();
    lightView.update(sim.trafficLights);
    if (!sim.paused) trailView.update(sim.ego.x, sim.ego.y);
    // A white history ribbon can look like a painted line down the middle of
    // the emergency strip. Keep the shoulder markings clear during EDSS.
    if(sim.emergencyPullOver.status.active)trailView.mesh.visible=false;
    const cockpitView = scene.cameraMode === "cockpit";
    const emergencyStopped=sim.controlMode==="adas"&&(sim.adas.status.aeb||sim.adas.status.aebHolding);
    const emergencyPath=sim.emergencyTrajectory();
    ribbon.update(sim.parkingBays.length||emergencyStopped ? null : emergencyPath??(sim.emergencyPullOver.status.active?null:sim.plan), sim.planner.config.desiredSpeed, cockpitView ? 7 : 0, cockpitView ? 0.45 : 1);
    arHud.update(sim, delta, cockpitView, eye);
    candidates.update(sim.emergencyPullOver.status.active?[]:sim.candidates, sim.plan);
    tracksView.update(sim.tracks);
    occupancyView.update(sim.occupancy);
    sensorView.update(eye.x,eye.y,sim.sensor.config.range);
    cabinLook.update();
    scene.cockpitModelRig=fleet.cockpitRig();
    scene.vehicleLength = sim.ego.dims.length; scene.vehicleWidth = sim.ego.dims.width;
    scene.updateCamera(eye.x,eye.y,eye.yaw,delta,Math.abs(eye.v));
    hud.setCameraMode(scene.cameraMode);
    scene.updateWeather(delta,eye.x,eye.y);
    audio.update(sim);
    // DOM/radar work and the 360° camera are staggered onto alternate frames
    // so the browser never executes heavy DOM updates and a secondary 3-D
    // scene render in the same 16.6 ms frame.
    let didUIUpdate = false;
    if(now-lastUIFrame>=1000/30){
      const uiDt=Number.isFinite(lastUIFrame)?(now-lastUIFrame)/1000:delta;
      hud.update(sim.telemetry, sim.road.numLanes);
      scorecard.update();
      minimap.update();
      adasPanel.update(uiDt);
      learningPanel.update();
      telemetryPanel.update();
      controlPanel.update();
      pedalControls.update(sim.telemetry);
      touchSteering.update(sim.telemetry);
      consoleControls.update();
      camera360.update(sim.telemetry);
      cockpitLayout.update();
      lastUIFrame=now;
      didUIUpdate=true;
    }

    // Collision feedback: flash the screen and thump once per new impact.
    if (sim.metrics.collisions < lastCollisions) lastCollisions = sim.metrics.collisions; // reset
    if (sim.metrics.collisions > lastCollisions) {
      lastCollisions = sim.metrics.collisions;
      hud.flashImpact();
      audio.impact();
    }
    // A hidden surround display needs no second scene render. Keep visible
    // camera video staggered off UI frames while physics and the main view retain their cadence.
    const surroundVisible = camera360.expanded && (!uiRoot.classList.contains("phone-landscape") || uiRoot.dataset.mobileView === "camera");
    const surroundInterval = scene.effectiveQuality === "ultra" ? 1000 / 30 : scene.effectiveQuality === "medium" ? 1000 / 24 : 1000 / 18;
    if(surroundVisible && (!didUIUpdate || now - lastSurroundFrame > 65) && now - lastSurroundFrame >= surroundInterval){
      fleet.renderExterior(() => scene.renderSurroundView(
        camera360.renderSurface,
        eye.x,
        eye.y,
        eye.yaw,
        camera360.activeView,
      ));
      lastSurroundFrame=now;
    }
    if (sim.metrics.time > 2.5 && !sim.paused) {
      scene.stepAdaptiveQuality(fps, delta);
    }
    scene.render();
    if (!document.hidden) {
      const info = scene.renderer.info;
      const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      runtimePerformance.record(rawFrameMs, performance.now() - workStarted, {
        calls: info.render.calls, triangles: info.render.triangles,
        geometries: info.memory.geometries, textures: info.memory.textures,
      }, heap);
    }

    if (firstFrame && loading) {
      firstFrame = false;
      loading.classList.add("hidden");
      setTimeout(() => loading.remove(), 700);
    }
  }

  requestAnimationFrame(frame);
}

boot();
