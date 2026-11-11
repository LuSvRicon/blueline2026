// Deep 4-Layer Physical ADAS/AEB Verification Suite:
//   Layer 1: Dual-Channel 77 GHz Radar + Windshield Optical Camera + Body-Pitch Coupling + 2x2 Information Fusion
//   Layer 2: 4-Wheel Rotational Dynamics, Pacejka Magic Formula Tire Slip & Cyclic 10-14 Hz ABS
//   Layer 3: Real Vehicle Mass/Tire/Brake/AEB Profiles (Civic Type R FL5, Santa Fe MX5, Everest, VF 9)
//   Layer 4: Junction Turn-Across-Path AEB (CCFtap & CPTA — Euro NCAP 2023-2026)

import assert from "node:assert/strict";
import { Simulation } from "../src/sim/Simulation.ts";
import { DualChannelSensorSuite, SensableObject } from "../src/perception/Sensor.ts";
import { Vehicle, EGO_DIMS } from "../src/vehicle/Vehicle.ts";
import { calibratePacejka, pacejkaNormalizedMu, computeWheelNormalLoads } from "../src/vehicle/WheelDynamics.ts";
import { getVehiclePhysicsProfile, REAL_VEHICLE_IDS } from "../src/vehicle/VehicleProfiles.ts";
import { Rng } from "../src/core/rng.ts";
import { wrapDiff } from "../src/core/math.ts";

const DT = 1 / 60;

// ===========================================================================
// LAYER 1: Dual-Channel 77 GHz Radar + Optical Camera + Body Pitch + 2x2 Fusion
// ===========================================================================
{
  const suite = new DualChannelSensorSuite(new Rng(20260417));
  const zeroDropRef = {
    range: 180,
    fov: Math.PI,
    posNoise: 0.35,
    sizeNoise: 0.1,
    dropout: 0,
    occlusion: true,
    occlusionMode: "pedestrians-only" as const,
    heading: 0,
    velocityNoise: 0.25,
  };

  // 1.1 Weather & Darkness Asymmetry: Fog + Night blinds optical camera at 78 m while 77 GHz Radar tracks cleanly
  const farCar: SensableObject = { x: 78, y: 0, vx: -5, vy: 0, length: 4.6, width: 1.9, kind: "car" };
  const fogNightEnv = {
    weather: "fog" as const,
    night: true,
    bodyPitchRad: 0,
    cameraAvailable: true,
    frontRadarAvailable: true,
    rearRadarAvailable: true,
    referenceConfig: zeroDropRef,
    simTime: 1.0,
  };
  const camFarFog = suite.senseCamera(0, 0, 0, [farCar], fogNightEnv);
  const radFarFog = suite.senseRadar(0, 0, 0, [farCar], fogNightEnv);
  assert.equal(camFarFog.length, 0, "Optical camera should not see unlit/distant 78m target through dense fog at night");
  assert.equal(radFarFog.length, 1, "77 GHz millimeter-wave radar must penetrate fog and darkness at 78m");
  assert(radFarFog[0].vx !== undefined && Math.abs(radFarFog[0].vx - -5) < 1.0, "77 GHz radar must measure radial Doppler velocity");

  // 1.2 Optimal 2x2 Inverse-Covariance Fusion: Fused covariance strictly beats BOTH Radar-only and Camera-only
  const midCar: SensableObject = { x: 62, y: 0, vx: 12, vy: 0, length: 4.6, width: 1.9, kind: "car" };
  const clearEnv = { ...fogNightEnv, weather: "clear" as const, night: false };
  const fusedOut = suite.sense(0, 0, 0, [midCar], clearEnv);
  assert.equal(fusedOut.length, 1, "Expected 1 fused track for single target in shared FOV");
  const fDet = fusedOut[0];
  const rDet = suite.lastRadarDetections[0];
  const cDet = suite.lastCameraDetections[0];
  assert.equal(fDet.sensorChannel, "fused");
  assert(fDet.radarDetected && fDet.cameraDetected, "Fused detection must flag both physical channels");
  // Along X (longitudinal range): Radar is tight (~0.032 m²), Camera monocular depth is loose (> 2.0 m²)
  assert(rDet.measCov![0][0] < 0.06 && cDet.measCov![0][0] > 1.5, "Expected Radar tight range & Camera loose monocular depth");
  // Along Y (lateral azimuth): Camera is razor-sharp (< 0.06 m²), Radar beamwidth is wider (> 0.50 m²)
  assert(cDet.measCov![1][1] < 0.08 && rDet.measCov![1][1] > 0.45, "Expected Camera sharp bearing & Radar wider cross-range");
  // Fused covariance inherits BOTH tight longitudinal range AND sharp lateral bearing!
  assert(
    fDet.measCov![0][0] < rDet.measCov![0][0] && fDet.measCov![1][1] < cDet.measCov![1][1],
    "2x2 Information Filter covariance must be strictly tighter than each single sensor in both axes",
  );
  console.log(
    `[Layer 1] 62m Covariance (σ_x, σ_y): Radar=(${Math.sqrt(rDet.measCov![0][0]).toFixed(2)}m, ${Math.sqrt(rDet.measCov![1][1]).toFixed(2)}m) | ` +
    `Camera=(${Math.sqrt(cDet.measCov![0][0]).toFixed(2)}m, ${Math.sqrt(cDet.measCov![1][1]).toFixed(2)}m) -> ` +
    `Fused=(${Math.sqrt(fDet.measCov![0][0]).toFixed(2)}m, ${Math.sqrt(fDet.measCov![1][1]).toFixed(2)}m)`,
  );

  // 1.3 Chassis Nose-Dive (`bodyPitchRad < 0`) Horizon Foreshortening & Radar Range Anchoring
  const horizonTarget: SensableObject = { x: 96, y: 0, vx: 0, vy: 0, length: 4.6, width: 1.9, kind: "car" };
  const deterministicRef = { ...zeroDropRef, posNoise: 0, velocityNoise: 0 };
  const camLevel = suite.senseCamera(0, 0, 0, [horizonTarget], { ...clearEnv, bodyPitchRad: 0, referenceConfig: deterministicRef });
  const camDive = suite.senseCamera(0, 0, 0, [horizonTarget], { ...clearEnv, bodyPitchRad: -0.055, referenceConfig: deterministicRef });
  const radDive = suite.senseRadar(0, 0, 0, [horizonTarget], { ...clearEnv, bodyPitchRad: -0.055, referenceConfig: deterministicRef });
  assert.equal(camLevel.length, 1, "Level chassis camera sees 96m target in clear daylight");
  assert.equal(camDive.length, 0, "Hard braking nose-dive (-3.15 deg) foreshortens camera horizon below 96m");
  assert.equal(radDive.length, 1, "77 GHz LRR radar keeps tracking 96m target during nose-dive");

  // Uncalibrated IPM pitch bias at 55m: Camera alone underestimates range during nose-dive, Fusion anchors to Radar
  const midTarget55: SensableObject = { x: 55, y: 0, vx: 0, vy: 0, length: 4.6, width: 1.9, kind: "car" };
  let camMeanX = 0;
  let fusedMeanX = 0;
  const N_SAMPLES = 24;
  for (let i = 0; i < N_SAMPLES; i++) {
    const cSample = suite.senseCamera(0, 0, 0, [midTarget55], { ...clearEnv, bodyPitchRad: -0.055, referenceConfig: zeroDropRef });
    const fSample = suite.sense(0, 0, 0, [midTarget55], { ...clearEnv, bodyPitchRad: -0.055, referenceConfig: zeroDropRef });
    camMeanX += cSample[0].x / N_SAMPLES;
    fusedMeanX += fSample[0].x / N_SAMPLES;
  }
  assert(camMeanX < 52.5, `Expected monocular IPM nose-dive foreshortening (<52.5m) at 55m, got mean x=${camMeanX.toFixed(2)}m`);
  assert(Math.abs(fusedMeanX - 55) < 0.35, `Radar+Camera fusion must anchor longitudinal range (~55.0m), got ${fusedMeanX.toFixed(2)}m`);
  console.log(
    `[Layer 1] Nose-Dive (-3.15°) @ 55m: Camera-only IPM mean=${camMeanX.toFixed(2)}m vs Radar+Camera Fused mean=${fusedMeanX.toFixed(2)}m`,
  );

  // 1.4 Full Simulation Stationary Pedestrian RCS Asymmetry (Camera-Only vs Radar-Only)
  const runStaticPedTrial = (camera: boolean, frontRadar: boolean) => {
    const sim = new Simulation({ trafficCount: 0, seed: 77 });
    sim.traffic.clear();
    sim.pedestrians.clear();
    sim.trafficLights = [];
    sim.roadSigns = [];
    sim.setControlMode("adas");
    sim.adas.config.acc = false;
    sim.sensor.config.dropout = 0;
    sim.sensorAvailability = { camera, frontRadar, rearRadar: true, ultrasonic: true };
    const startPose = sim.path.toCartesian(150, sim.road.laneCenter(1));
    Object.assign(sim.ego, { x: startPose.x, y: startPose.y, yaw: startPose.heading, v: 11.5 });
    sim.ego.syncWheelSpeeds();
    // Stationary pedestrian standing in ego's lane 31 m ahead
    const ped = sim.pedestrians.add({ s: 181, fromD: sim.road.laneCenter(1), toD: sim.road.laneCenter(1), speed: 0, wait: 999 });
    ped.d = sim.road.laneCenter(1);
    ped.state = "waiting";
    let firstBrakeSec: number | null = null;
    for (let i = 0; i < 6 * 60; i++) {
      sim.step(DT);
      if (firstBrakeSec === null && sim.adas.status.aeb) firstBrakeSec = sim.simTime;
      if (sim.ego.v === 0 && i > 10) break;
    }
    return { collisions: sim.metrics.collisions, firstBrakeSec, finalV: sim.ego.v };
  };
  const camOnlyPed = runStaticPedTrial(true, false);
  const radOnlyPed = runStaticPedTrial(false, true);
  assert.equal(camOnlyPed.collisions, 0, "Camera-only ADAS must detect and stop for stationary pedestrian at 31m");
  assert(
    camOnlyPed.firstBrakeSec !== null &&
      (radOnlyPed.firstBrakeSec === null || camOnlyPed.firstBrakeSec < radOnlyPed.firstBrakeSec - 0.10),
    "Camera-only VRU detection must engage earlier than Radar-only (weak stationary human RCS)",
  );
  console.log(
    `[Layer 1] Stationary VRU @ 31m (41 km/h): Camera-Only brake@${camOnlyPed.firstBrakeSec?.toFixed(2)}s (collisions=${camOnlyPed.collisions}) vs ` +
    `Radar-Only brake@${radOnlyPed.firstBrakeSec?.toFixed(2) ?? "late"}s`,
  );
}

// ===========================================================================
// LAYER 2: 4-Wheel Rotational Dynamics, Pacejka Slip & Cyclic 10-14 Hz ABS
// ===========================================================================
{
  // 2.1 Pacejka Magic Formula exact boundary calibration & 4-wheel normal load conservation
  const p = calibratePacejka(0.13, 0.72);
  assert.equal(pacejkaNormalizedMu(0, p), 0);
  assert(Math.abs(pacejkaNormalizedMu(0.13, p) - 1.0) < 1e-4, "Pacejka curve must peak at exact 1.000 at peakSlip");
  assert(Math.abs(pacejkaNormalizedMu(1.0, p) - 0.72) < 0.015, "Pacejka locked-wheel friction must match slideRatio at κ=1.0");
  assert(pacejkaNormalizedMu(0.06, p) > 0.6 && pacejkaNormalizedMu(0.45, p) < 0.92, "Pacejka curve must rise elastically then decay past peakSlip");

  const sfProf = getVehiclePhysicsProfile("santafe");
  const loads = computeWheelNormalLoads(sfProf, -7.0, 2.5, 0);
  const sumLoads = loads[0] + loads[1] + loads[2] + loads[3];
  assert(Math.abs(sumLoads - sfProf.massKg * 9.81) < 1e-3, "4-wheel normal loads must conserve total vertical weight m*g");
  assert(loads[0] + loads[1] > (loads[2] + loads[3]) * 1.55, "Hard braking must transfer significant normal load to front axle");
  assert(loads[1] > loads[0] + 600 && loads[3] > loads[2] + 600, "Leftward lateral accel (+ay) must transfer load onto right-side outside tires");

  // 2.2 Cyclic 4-Channel ABS ON vs ABS OFF (Locked Wheels) on Low-Grip Wet/Icy Surface (`surfaceMu = 0.40`)
  const runLowGripPanicStop = (absOn: boolean) => {
    const car = new Vehicle(0, 0, 0, 24, EGO_DIMS); // 86.4 km/h
    car.applyPhysicsProfile("santafe");
    car.enableWheelSlipDynamics = true;
    car.wheelAbsEnabled = absOn;
    car.limitLateralGrip = true;
    car.corneringBrakeCoupling = true;
    car.surfaceMu = 0.40;

    let maxSlip = 0;
    let minFrontOmegaMoving = Infinity;
    let absActiveSteps = 0;
    for (let i = 0; i < 12 * 60; i++) {
      // Driver applies full panic brake (-ego.maxDecel) + gentle 0.06 rad evasive steer
      const steer = car.v > 4 ? 0.06 : 0;
      car.step(steer, -car.maxDecel, DT, 1);
      if (car.v > 4.0) {
        maxSlip = Math.max(maxSlip, car.maxWheelSlip);
        minFrontOmegaMoving = Math.min(minFrontOmegaMoving, car.wheelSpeeds[0], car.wheelSpeeds[1]);
      }
      if (car.wheelAbsActive) absActiveSteps++;
      if (car.v === 0) break;
    }
    const stopDist = Math.hypot(car.x, car.y);
    return {
      stopDist,
      finalY: car.y,
      finalYaw: car.yaw,
      maxSlip,
      minFrontOmegaMoving,
      absActiveSteps,
      absCycles: car.wheelDynamics.absCycleCount,
    };
  };

  const absOn = runLowGripPanicStop(true);
  const absOff = runLowGripPanicStop(false);

  assert(absOn.absActiveSteps > 60 && absOn.absCycles >= 8, `Expected cyclic 4-channel ABS modulation, got cycles=${absOn.absCycles}`);
  assert(absOn.maxSlip < 0.36 && absOn.minFrontOmegaMoving > 2.0, `ABS ON must prevent wheel lockup (maxSlip=${absOn.maxSlip.toFixed(3)})`);
  assert(absOff.maxSlip > 0.98 && absOff.minFrontOmegaMoving < 0.05, `ABS OFF must lock front wheels to κ≈1.0 (maxSlip=${absOff.maxSlip.toFixed(3)})`);
  assert(
    absOn.stopDist < absOff.stopDist - 5.0,
    `ABS ON (${absOn.stopDist.toFixed(1)}m) must stop shorter than locked-wheel ABS OFF (${absOff.stopDist.toFixed(1)}m) on μ=0.40`,
  );
  assert(
    Math.abs(absOn.finalY) > Math.abs(absOff.finalY) * 1.35,
    `ABS ON (y=${absOn.finalY.toFixed(2)}m) must preserve lateral steering authority vs locked front wheels (y=${absOff.finalY.toFixed(2)}m)`,
  );
  console.log(
    `[Layer 2] Panic Stop 86.4->0 km/h on μ=0.40: ABS ON=${absOn.stopDist.toFixed(1)}m (maxSlip=${(absOn.maxSlip * 100).toFixed(1)}%, cycles=${absOn.absCycles}, latShift=${absOn.finalY.toFixed(1)}m) | ` +
    `ABS OFF=${absOff.stopDist.toFixed(1)}m (LOCKED κ=${(absOff.maxSlip * 100).toFixed(0)}%, latShift=${absOff.finalY.toFixed(1)}m)`,
  );
}

// ===========================================================================
// LAYER 3: 4 Real Vehicle Physics & AEB Profiles (Civic, Santa Fe, Everest, VF 9)
// ===========================================================================
{
  // 3.1 Pure 100 -> 0 km/h (27.78 m/s) Dry Emergency Braking & EV Regen Coasting
  const brake100Results: Record<string, { distM: number; timeS: number; coastDecel: number }> = {};
  for (const id of REAL_VEHICLE_IDS) {
    const sim = new Simulation({ trafficCount: 0, vehicleProfile: id });
    sim.traffic.clear();
    sim.pedestrians.clear();
    sim.setControlMode("manual");
    const p0 = sim.path.toCartesian(120, sim.road.laneCenter(1));
    Object.assign(sim.ego, { x: p0.x, y: p0.y, yaw: p0.heading, v: 100 / 3.6 });
    sim.ego.syncWheelSpeeds();
    // Measure 1 step of off-throttle passive coasting first
    sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
    sim.step(DT);
    const coastDecel = -sim.ego.a;

    // Reset to exact 100 km/h and apply 100% emergency foot brake
    Object.assign(sim.ego, { x: p0.x, y: p0.y, yaw: p0.heading, v: 100 / 3.6, a: 0 });
    sim.ego.syncWheelSpeeds();
    let steps = 0;
    for (let i = 0; i < 10 * 60; i++) {
      sim.setDriverInput({ steer: 0, throttle: 0, brake: 1 });
      sim.step(DT);
      steps++;
      if (sim.ego.v === 0) break;
    }
    const distM = Math.hypot(sim.ego.x - p0.x, sim.ego.y - p0.y);
    brake100Results[id] = { distM, timeS: steps * DT, coastDecel };
  }

  assert(
    brake100Results.civic.distM < brake100Results.santafe.distM &&
      brake100Results.santafe.distM < brake100Results.vf9.distM &&
      brake100Results.vf9.distM < brake100Results.everest.distM,
    `Expected stopping distance ordering civic < santafe < vf9 < everest, got ${JSON.stringify(brake100Results)}`,
  );
  assert(
    brake100Results.everest.distM - brake100Results.civic.distM > 9.0,
    "Lightweight Brembo Civic Type R must stop >9m shorter from 100 km/h than 2.38t BoF Everest",
  );
  assert(
    brake100Results.vf9.coastDecel > brake100Results.santafe.coastDecel + 0.30,
    "EV VinFast VF 9 must exhibit stronger off-throttle regenerative coasting than ICE Santa Fe",
  );

  // 3.2 Full ADAS CCRs (80 km/h -> Stationary Car) across all 4 Vehicle Profiles
  const ccrsResults: Record<string, { triggerGapM: number; finalGapM: number; collisions: number }> = {};
  for (const id of REAL_VEHICLE_IDS) {
    const sim = new Simulation({ trafficCount: 0, seed: 42, vehicleProfile: id });
    sim.traffic.clear();
    sim.pedestrians.clear();
    sim.trafficLights = [];
    sim.roadSigns = [];
    sim.setControlMode("adas");
    sim.adas.config.acc = false;
    sim.sensor.config.dropout = 0;
    sim.sensor.config.posNoise = 0;
    sim.sensor.config.velocityNoise = 0;

    const lane = 1;
    const startS = 140;
    const targetSpeedMps = 80 / 3.6;
    const p0 = sim.path.toCartesian(startS, sim.road.laneCenter(lane));
    Object.assign(sim.ego, { x: p0.x, y: p0.y, yaw: p0.heading, v: targetSpeedMps });
    sim.ego.syncWheelSpeeds();
    const stalled = sim.traffic.addTestVehicle("stalled", lane, startS + 72, 0, 0);

    let triggerGapM: number | null = null;
    for (let i = 0; i < 10 * 60; i++) {
      // Euro NCAP CCRs driving robot maintains constant 80 km/h until AEB intervenes
      const holdThrottle = sim.adas.status.aeb || sim.adas.status.aebHolding
        ? 0
        : Math.max(0, Math.min(0.45, (targetSpeedMps - sim.ego.v) * 0.6));
      sim.setDriverInput({ steer: 0, throttle: holdThrottle, brake: 0 });
      sim.step(DT);
      if (triggerGapM === null && sim.adas.status.aeb) {
        const ef = sim.path.toFrenet(sim.ego.x, sim.ego.y);
        triggerGapM = wrapDiff(stalled.s, ef.s, sim.path.length) - (sim.ego.dims.length + stalled.length) * 0.5;
      }
      if (sim.adas.status.aebHolding && sim.ego.v === 0) break;
    }
    const endEf = sim.path.toFrenet(sim.ego.x, sim.ego.y);
    const finalGapM = wrapDiff(stalled.s, endEf.s, sim.path.length) - (sim.ego.dims.length + stalled.length) * 0.5;
    assert.equal(sim.metrics.collisions, 0, `${id} collided in CCRs 80 km/h test`);
    assert(sim.ego.v < 0.05 && finalGapM > 1.0, `${id} failed to leave safe standstill gap (v=${sim.ego.v.toFixed(2)}, gap=${finalGapM.toFixed(2)}m)`);
    assert(triggerGapM !== null, `${id} did not trigger AEB`);
    ccrsResults[id] = { triggerGapM: triggerGapM!, finalGapM, collisions: sim.metrics.collisions };
  }

  // Heavy VF9 (2870 kg) & Everest (2380 kg) must initiate AEB at a larger distance than nimble Civic Type R (1430 kg)!
  assert(
    ccrsResults.vf9.triggerGapM > ccrsResults.civic.triggerGapM + 2.5 &&
      ccrsResults.everest.triggerGapM > ccrsResults.civic.triggerGapM + 3.5,
    `Heavy SUVs must trigger AEB earlier than Civic: VF9=${ccrsResults.vf9.triggerGapM.toFixed(1)}m, Everest=${ccrsResults.everest.triggerGapM.toFixed(1)}m, Civic=${ccrsResults.civic.triggerGapM.toFixed(1)}m`,
  );

  for (const id of REAL_VEHICLE_IDS) {
    const prof = getVehiclePhysicsProfile(id);
    console.log(
      `[Layer 3] ${prof.name} (${prof.massKg}kg): 100-0=${brake100Results[id].distM.toFixed(1)}m | ` +
      `CCRs@80km/h AEB trigger=${ccrsResults[id].triggerGapM.toFixed(1)}m -> stopGap=${ccrsResults[id].finalGapM.toFixed(2)}m (0 collisions)`,
    );
  }
}

// ===========================================================================
// LAYER 4: Junction Turn-Across-Path AEB (CCFtap & CPTA — Euro NCAP 2023-2026)
// ===========================================================================
{
  // 4.1 CCFtap (Car-to-Car Front Turn-Across-Path): Ego turns across opposing lane on two-way road with oncoming GVT @ 50 km/h
  const runJunctionTurnAcrossOncoming = (aebEnabled: boolean) => {
    const sim = new Simulation({ trackId: "two-way", trafficCount: 0, seed: 2026 });
    sim.traffic.clear();
    sim.pedestrians.clear();
    sim.trafficLights = [];
    sim.roadSigns = [];
    sim.setControlMode("adas");
    sim.adas.config.acc = false;
    sim.adas.config.laneCentering = false;
    sim.adas.config.laneKeeping = false;
    sim.adas.config.emergencyLaneKeeping = false;
    sim.adas.config.aeb = aebEnabled;
    sim.sensor.config.dropout = 0;

    // Place ego in forward lane 0 at 20 km/h (5.56 m/s), turning across centerline toward opposing lane 0
    const startS = 200;
    const egoD0 = sim.road.laneCenter(0);
    const oppD0 = sim.road.oncomingCenter(0);
    const turnDir = Math.sign(oppD0 - egoD0); // +1 if opposing lane has larger d, -1 if smaller d
    const startPose = sim.path.toCartesian(startS, egoD0);
    Object.assign(sim.ego, { x: startPose.x, y: startPose.y, yaw: startPose.heading, v: 20 / 3.6 });
    sim.ego.syncWheelSpeeds();

    // Constant-speed oncoming GVT at 50 km/h (-13.89 m/s), ~33 m ahead so unbraked turn collides right in opposing lane
    const oncoming = sim.traffic.addOncomingVehicle("car", 0, startS + 33, 50 / 3.6, true);

    let sawJunctionCause = false;
    let sawHold = false;
    let releasedAfterPass = false;
    for (let i = 0; i < 6 * 60; i++) {
      // Driver signals and steers steadily across the centerline while holding light throttle
      sim.indicator = turnDir as -1 | 1;
      sim.setDriverInput({ steer: 0.34 * turnDir, throttle: 0.25, brake: 0 });
      sim.step(DT);
      if (sim.adas.status.aebCause === "Xe ngược chiều khi rẽ qua giao lộ") {
        sawJunctionCause = true;
      }
      if (sim.adas.status.aebHolding) {
        sawHold = true;
      }
      if (sawHold && !sim.adas.status.aebHolding && sim.adas.status.aebState === "MONITOR") {
        releasedAfterPass = true;
        break;
      }
      if (sim.metrics.collisions > 0) break;
    }
    return {
      collisions: sim.metrics.collisions,
      impactSpeed: sim.lastImpactSpeed,
      sawJunctionCause,
      sawHold,
      releasedAfterPass,
      oncomingS: oncoming.s,
    };
  };

  const ccftapOff = runJunctionTurnAcrossOncoming(false);
  const ccftapOn = runJunctionTurnAcrossOncoming(true);
  assert(
    ccftapOff.collisions >= 1 && (ccftapOff.impactSpeed ?? 0) > 12,
    `CCFtap setup must produce genuine head-on/angled collision when AEB is OFF (collisions=${ccftapOff.collisions})`,
  );
  assert.equal(ccftapOn.collisions, 0, "CCFtap AEB ON must prevent collision when turning across oncoming vehicle");
  assert(ccftapOn.sawJunctionCause, "CCFtap must report exact Vietnamese cause 'Xe ngược chiều khi rẽ qua giao lộ'");
  assert(ccftapOn.sawHold && ccftapOn.releasedAfterPass, "CCFtap must hold ego stopped while oncoming passes, then release HOLD cleanly");
  console.log(
    `[Layer 4] CCFtap (Turn 20 km/h vs Oncoming 50 km/h): AEB OFF -> COLLISION (v_rel=${ccftapOff.impactSpeed?.toFixed(1)} m/s) | ` +
    `AEB ON -> 0 collisions, HOLD & auto-release PASS`,
  );

  // 4.2 CPTA (Car-to-Pedestrian Turn Adult): Ego turns across pedestrian walking along turn arc outside straight lane
  const runJunctionTurnPedestrian = (aebEnabled: boolean) => {
    const sim = new Simulation({ trackId: "city", trafficCount: 0, seed: 3030 });
    sim.traffic.clear();
    sim.pedestrians.clear();
    sim.trafficLights = [];
    sim.roadSigns = [];
    sim.setControlMode("adas");
    sim.adas.config.acc = false;
    sim.adas.config.laneCentering = false;
    sim.adas.config.laneKeeping = false;
    sim.adas.config.emergencyLaneKeeping = false;
    sim.adas.config.aeb = aebEnabled;
    sim.sensor.config.dropout = 0;

    // Ego starts in center lane (lane 1, d=0) at 18 km/h (5.0 m/s) and turns left (+d) across lane 0 (d=+3.7m)
    const startS = 150;
    const egoD0 = sim.road.laneCenter(1);
    const targetSideD = sim.road.laneCenter(0);
    const turnDir = Math.sign(targetSideD - egoD0) || 1;
    const startPose = sim.path.toCartesian(startS, egoD0);
    Object.assign(sim.ego, { x: startPose.x, y: startPose.y, yaw: startPose.heading, v: 5.0 });
    sim.ego.syncWheelSpeeds();

    // Pedestrian is positioned laterally in lane 0 (offset ~3.7m from ego's straight-ahead line!)
    // walking across ego's R≈16.2m curved turn trajectory at s = startS + 10.5m
    const ped = sim.pedestrians.add({
      s: startS + 10.5,
      fromD: targetSideD + 2.6 * turnDir,
      toD: egoD0 - 2.0 * turnDir,
      speed: 1.30,
      wait: 0,
      triggerDist: 100,
    });
    ped.state = "crossing";

    let sawCptaCause = false;
    for (let i = 0; i < 4.5 * 60; i++) {
      sim.setDriverInput({ steer: 0.28 * turnDir, throttle: 0.2, brake: 0 });
      sim.step(DT);
      if (sim.adas.status.aebCause === "Người đi bộ cắt ngang hướng rẽ") {
        sawCptaCause = true;
      }
      if (sim.metrics.collisions > 0 || (aebEnabled && sim.adas.status.aebHolding)) break;
    }
    return { collisions: sim.metrics.collisions, pedHit: ped.collided, sawCptaCause };
  };

  const cptaOff = runJunctionTurnPedestrian(false);
  const cptaOn = runJunctionTurnPedestrian(true);
  assert(cptaOff.collisions >= 1 || cptaOff.pedHit, "CPTA setup must strike pedestrian along turn arc when AEB is OFF");
  assert.equal(cptaOn.collisions, 0, "CPTA AEB ON must stop before striking pedestrian on curved turn trajectory");
  assert(!cptaOn.pedHit && cptaOn.sawCptaCause, "CPTA must classify 'Người đi bộ cắt ngang hướng rẽ' and keep pedestrian unharmed");
  console.log(`[Layer 4] CPTA (Turn 18 km/h across VRU): AEB OFF -> HIT | AEB ON -> 0 collisions, cause='Người đi bộ cắt ngang hướng rẽ' PASS`);

  // 4.3 Zero False-Positive Oncoming Traffic Guard: Passing oncoming traffic in own lane at 65 km/h on two-way road
  {
    const sim = new Simulation({ trackId: "two-way", trafficCount: 0, seed: 4040 });
    sim.traffic.clear();
    sim.pedestrians.clear();
    sim.trafficLights = [];
    sim.roadSigns = [];
    sim.setControlMode("adas");
    sim.setAccSpeedKph(65);
    const p0 = sim.path.toCartesian(120, sim.road.laneCenter(0));
    Object.assign(sim.ego, { x: p0.x, y: p0.y, yaw: p0.heading, v: 65 / 3.6 });
    sim.ego.syncWheelSpeeds();
    for (let k = 0; k < 4; k++) {
      sim.traffic.addOncomingVehicle("car", 0, 180 + k * 55, 60 / 3.6, false);
    }
    let falseFcw = 0;
    let falseAeb = 0;
    for (let i = 0; i < 8 * 60; i++) {
      sim.step(DT);
      if (sim.adas.status.fcw) falseFcw++;
      if (sim.adas.status.aeb) falseAeb++;
    }
    assert.equal(falseFcw, 0, `Expected 0 false FCW against oncoming traffic in own lane, got ${falseFcw}`);
    assert.equal(falseAeb, 0, `Expected 0 false AEB against oncoming traffic in own lane, got ${falseAeb}`);
    assert.equal(sim.metrics.collisions, 0);
    console.log("[Layer 4] Oncoming False-Positive Guard (4 oncoming cars @ 60-65 km/h on rural two-way road): 0 FCW, 0 AEB PASS");
  }
}

console.log("\nAEB-DEEP-PHYSICS-TEST PASS — All 4 deep physical ADAS/AEB layers verified quantitatively.");
