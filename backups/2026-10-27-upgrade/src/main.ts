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
import { DEFAULT_TRACK } from "./world/track.ts";
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

function boot(): void {
  const canvas = document.getElementById("scene") as HTMLCanvasElement;
  const uiRoot = document.getElementById("ui") as HTMLElement;
  const loading = document.getElementById("loading");

  const sim = new Simulation();

  // Vietnamese traffic is the default; profile and scenarios can be deep-linked.
  const params = new URLSearchParams(location.search);
  sim.setTrafficProfile(params.get("profile") === "international" ? "international" : "vietnam");
  const wanted = params.get("scenario");
  const known = ["highway", "dense", "trucks", "stalled", "cutin", "crossing", "occluded", "jaywalker", "blindspot", "lights", "rush", "motorcycle-weave", "bus-stop", "traffic-jam", "truck-breakdown", "vietnam-rush"];
  if (wanted && known.includes(wanted)) sim.setScenario(wanted as never);
  const wx = params.get("weather");
  const wantedMode = params.get("mode");
  if (wantedMode === "adas" || wantedMode === "manual") {
    sim.setControlMode(wantedMode);
    sim.reset();
  }

  const scene = new Scene(canvas);
  if (params.get("cam") === "top") scene.cameraMode = "top";
  else if (params.get("cam") === "cockpit") scene.cameraMode = "cockpit";
  if (wx === "rain" || wx === "fog") {
    sim.setWeather(wx);
    scene.setWeather(wx);
  }
  let renderedWeather = sim.weather;
  scene.setTimeOfDay(params.get("tod") === "night" ? "night" : "day");
  const buildings = new BuildingsView(sim.road);
  const road = new RoadView(sim.road);
  const fleet = new CarFleet(sim);
  const ribbon = new PathRibbon();
  const candidates = new CandidatesView();
  const tracksView = new TracksView();
  const occupancyView = new OccupancyView(sim.occupancy);
  const sensorView = new SensorView(sim.sensor.config.range);
  const pedView = new PedestrianView(sim.path);
  const lightView = new TrafficLightView(sim.path, sim.road.totalWidth / 2);
  const signView = new RoadSignsView(sim.path, sim.roadSigns, sim.road.totalWidth / 2);
  const trailView = new TrailView();

  const crossStreets = new CrossStreetView(sim.path, DEFAULT_TRACK.junctions, sim.road.totalWidth / 2);
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
  scene.add(ribbon.mesh);
  scene.add(tracksView.object);

  const hud = new HUD(uiRoot);
  const audio = new SimulationAudio();
  const scorecard = new Scorecard(uiRoot, sim);
  const minimap = new Minimap(uiRoot, sim);
  const adasPanel = new ADASPanel(uiRoot, sim);
  const telemetryPanel = new TelemetryPanel(uiRoot, sim);
  // eslint-disable-next-line no-new
  new IntroOverlay(uiRoot, sim, scene);
  // eslint-disable-next-line no-new
  new Shortcuts();
  const learningPanel = new LearningPanel(uiRoot, sim);
  // eslint-disable-next-line no-new
  const driveControls = new DriveControls(sim, () => {
    const modes: Array<"chase" | "top" | "cockpit" | "orbit"> = ["chase", "top", "cockpit", "orbit"];
    const idx = modes.indexOf(scene.cameraMode);
    scene.cameraMode = modes[(idx + 1) % modes.length];
  });
  const pedalControls = new PedalControls(uiRoot, driveControls);
  const consoleControls = new CenterConsoleControls(uiRoot, sim);
  const camera360 = new Camera360Widget(uiRoot, sim);
  const controlPanel = new ControlPanel(uiRoot, sim, scene, candidates, {
    occupancy: occupancyView.object,
    tracks: tracksView.object,
    sensor: sensorView.object,
    buildings: buildings.group,
    navigation: ribbon.mesh,
  }, audio);
  const cockpitLayout = new CockpitLayout(uiRoot, sim, scene, driveControls, camera360, telemetryPanel);

  // ---- fixed-timestep loop ----------------------------------------------
  const fixedDt = sim.config.fixedDt;
  let last = performance.now();
  let acc = 0;
  let firstFrame = true;
  let lastCollisions = 0;
  let fps = 60;

  // A small scripting handle for debugging and live demos from the dev console.
  (window as unknown as Record<string, unknown>).blueline = { sim, scene, fleet, fps: () => fps };

  function frame(now: number): void {
    requestAnimationFrame(frame);

    let delta = (now - last) / 1000;
    last = now;
    if (delta > 0.1) delta = 0.1; // avoid spiral-of-death after a tab stall
    if (delta > 1e-4) fps = fps * 0.9 + (1 / delta) * 0.1;
    acc += delta;

    let steps = 0;
    while (acc >= fixedDt && steps < 6) {
      driveControls.update(fixedDt);
      sim.step(fixedDt);
      acc -= fixedDt;
      steps++;
    }

    if (sim.weather !== renderedWeather) {
      scene.setWeather(sim.weather);
      renderedWeather = sim.weather;
    }

    // ---- sync views ----
    fleet.setNight(scene.timeOfDay === "night");
    fleet.update(sim.paused ? 0 : delta, now * 0.001);
    fleet.setCockpitView(scene.cameraMode === "cockpit");
    fleet.updateCockpitDisplay(sim.ego.v, sim.telemetry.speedLimitKph);
    fleet.updateMirrorWarnings(sim.adas.status.blindSpotLeft, sim.adas.status.blindSpotRight, now * 0.001);
    pedView.update(sim.pedestrians.peds);
    lightView.update(sim.trafficLights);
    if (!sim.paused) trailView.update(sim.ego.x, sim.ego.y);
    const cockpitView = scene.cameraMode === "cockpit";
    ribbon.update(sim.plan, sim.planner.config.desiredSpeed, cockpitView ? 7 : 0, cockpitView ? 0.45 : 1);
    candidates.update(sim.candidates, sim.plan);
    tracksView.update(sim.tracks);
    occupancyView.update(sim.occupancy);
    sensorView.update(sim.ego.x, sim.ego.y, sim.sensor.config.range);
    scene.updateCamera(sim.ego.x, sim.ego.y, sim.ego.yaw, delta, sim.ego.v);
    hud.setCameraMode(scene.cameraMode);
    scene.updateWeather(delta, sim.ego.x, sim.ego.y);
    audio.update(sim);
    hud.update(sim.telemetry, sim.road.numLanes);
    scorecard.update();
    minimap.update();
    adasPanel.update(delta);
    learningPanel.update();
    telemetryPanel.update();
    controlPanel.update();
    pedalControls.update(sim.telemetry);
    consoleControls.update();
    camera360.update(sim.telemetry);
    cockpitLayout.update();

    // Collision feedback: flash the screen and thump once per new impact.
    if (sim.metrics.collisions < lastCollisions) lastCollisions = sim.metrics.collisions; // reset
    if (sim.metrics.collisions > lastCollisions) {
      lastCollisions = sim.metrics.collisions;
      hud.flashImpact();
      audio.impact();
    }
    scene.render();
    scene.renderSurroundView(
      camera360.renderSurface,
      sim.ego.x,
      sim.ego.y,
      sim.ego.yaw,
      camera360.activeView,
    );

    if (firstFrame && loading) {
      firstFrame = false;
      loading.classList.add("hidden");
      setTimeout(() => loading.remove(), 700);
    }
  }

  requestAnimationFrame(frame);
}

boot();
