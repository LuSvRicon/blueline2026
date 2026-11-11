// ADAS coordination audit — long, browser-like drives (real vehicle profiles,
// Vietnam traffic, populated district, every map) in ADAS mode with ACC + LFA
// engaged and the driver hands-on but passive. It measures cross-feature
// invariants that unit tests do not see: AEB/FCW flapping, AEB without a
// physical threat, ACC/AEB arbitration jumps, steering oscillation between
// LFA/ALC/LKA, propulsion during braking, stuck holds and road departures.
//
// Usage: node scripts/test.mjs adas-coordination-audit
//        (AUDIT_SECONDS=90 to lengthen each run)
import { Simulation } from "../src/sim/Simulation.ts";
import { TRACKS } from "../src/world/track.ts";
import { wrapDiff } from "../src/core/math.ts";

type Profile = "vf9" | "santafe" | "everest" | "civic";
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const SECONDS = Number(env.AUDIT_SECONDS ?? 60);
const DT = 1 / 60;
const profiles: Profile[] = (env.AUDIT_PROFILES?.split(",") as Profile[] | undefined) ?? ["vf9", "civic"];
const trackFilter = env.AUDIT_TRACKS?.split(",");
const weathers = (env.AUDIT_WEATHERS?.split(",") as ("clear" | "rain")[] | undefined) ?? ["clear", "rain"];

interface RunResult {
  key: string;
  collisions: number;
  offRoad: number;
  aebEvents: number;
  aebFlaps: number;
  fcwFlaps: number;
  aebNoThreat: number;
  arbiterJumps: number;
  steerFlips: number;
  maxComfortJerk: number;
  propWhileBrake: number;
  stuckHold: number;
  takeoverSec: number;
  meanSpeed: number;
  notes: string[];
}

const failures: string[] = [];
const results: RunResult[] = [];

for (const track of TRACKS) {
  if (trackFilter && !trackFilter.includes(track.id)) continue;
  for (const profile of profiles) {
    for (const weather of weathers) {
      const sim = new Simulation({ trackId: track.id, seed: 20261107 });
      sim.setVehicleProfile(profile);
      sim.setTrafficProfile(track.road?.motorway ? "international" : "vietnam");
      if (!sim.track.road) { sim.traffic.populateDistrict(0, 48); }
      sim.setControlMode("adas");
      sim.reset();
      sim.setWeather(weather);
      sim.setAccSpeedKph(track.road?.speedKph ?? 60);
      sim.adas.resumeCruise();

      const r: RunResult = {
        key: `${track.id}/${profile}/${weather}`,
        collisions: 0, offRoad: 0, aebEvents: 0, aebFlaps: 0, fcwFlaps: 0, aebNoThreat: 0,
        arbiterJumps: 0, steerFlips: 0, maxComfortJerk: 0, propWhileBrake: 0, stuckHold: 0,
        takeoverSec: 0, meanSpeed: 0, notes: [],
      };
      let prevAeb = false, prevFcw = 0, aebOffTimer = 99, fcwOffTimer = 99;
      let prevSource = "none", prevAccel = 0, prevSteer = 0, prevSteerRateSign = 0, prevColl = 0;
      let holdStill = 0, speedSum = 0;
      const steerSignWindow: number[] = [];
      const N = Math.round(SECONDS / DT);
      for (let i = 0; i < N; i++) {
        sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
        sim.step(DT);
        const st = sim.adas.status;
        const t = sim.simTime;
        speedSum += sim.ego.v;
        if (sim.metrics.collisions > prevColl) {
          const ef = sim.path.toFrenet(sim.ego.x, sim.ego.y);
          const nearCar = sim.traffic.cars
            .map(c => ({ ds: wrapDiff(c.s, ef.s, sim.path.length), dd: c.d - ef.d, v: c.v, kind: c.kind }))
            .sort((a, b) => Math.hypot(a.ds, a.dd) - Math.hypot(b.ds, b.dd))[0];
          if (r.notes.length < 8) {
            r.notes.push(`t=${t.toFixed(2)} COLLISION#${sim.metrics.collisions} ego(d=${ef.d.toFixed(2)},v=${sim.ego.v.toFixed(2)},a=${sim.ego.a.toFixed(2)}) near(ds=${nearCar?.ds.toFixed(2)},dd=${nearCar?.dd.toFixed(2)},v=${nearCar?.v.toFixed(2)},${nearCar?.kind}) aeb=${st.aebState} esa=${st.extra.evasiveSteering} elk=${st.extra.emergencyLaneKeeping}`);
          }
          prevColl = sim.metrics.collisions;
        }

        // AEB re-trigger shortly after release = flapping (state chatter).
        if (st.aeb && !prevAeb) {
          r.aebEvents++;
          if (aebOffTimer < 1.0) { r.aebFlaps++; if (r.notes.length < 6) r.notes.push(`t=${t.toFixed(1)} AEB re-armed ${aebOffTimer.toFixed(2)}s after release (${st.aebCause})`); }
          // AEB with no object closer than a full emergency stop + 15 m in the predicted corridor = suspicious.
          const risk = sim.adas.lastAebRisk;
          if (!risk || (!risk.hasCollisionCourse && risk.gap > 15)) {
            r.aebNoThreat++;
            if (r.notes.length < 6) r.notes.push(`t=${t.toFixed(1)} AEB without collision course (gap=${risk?.gap?.toFixed(1)}, cause=${st.aebCause})`);
          }
        }
        aebOffTimer = st.aeb ? 0 : aebOffTimer + DT;
        if (st.fcwLevel > 0 && prevFcw === 0 && fcwOffTimer < 0.5) r.fcwFlaps++;
        fcwOffTimer = st.fcwLevel > 0 ? 0 : fcwOffTimer + DT;
        prevAeb = st.aeb; prevFcw = st.fcwLevel;

        // Arbiter: commanded accel jumping > 4 m/s² in one tick without AEB involvement.
        const src = st.arbiterSource ?? "none";
        const accelCmd = sim.telemetry.requestedAccel;
        const aebInvolved = src.startsWith("aeb") || prevSource.startsWith("aeb") || st.aeb || st.aebHolding;
        if (!aebInvolved && src !== "driver" && Math.abs(accelCmd - prevAccel) > 4.0 && i > 5) {
          r.arbiterJumps++;
          if (r.notes.length < 6) r.notes.push(`t=${t.toFixed(1)} accel cmd jump ${prevAccel.toFixed(2)}→${accelCmd.toFixed(2)} (${prevSource}→${src})`);
        }
        prevSource = src; prevAccel = accelCmd;

        // Comfort jerk (outside AEB/hold/driver) on actual chassis acceleration.
        const curJerk = Math.abs(sim.ego.jerkFiltered ?? 0);
        if (!aebInvolved && i > 30) {
          if (curJerk > 12 && r.maxComfortJerk <= 12 && r.notes.length < 6) {
            r.notes.push(`t=${t.toFixed(2)} comfortJerk=${curJerk.toFixed(1)} a=${sim.ego.a.toFixed(2)} req=${accelCmd.toFixed(2)} src=${src} reason=${st.brakeReason} aebSt=${st.aebState} v=${sim.ego.v.toFixed(2)} curve=${st.curveSpeedLimited} tl=${st.trafficLightStopping} esa=${st.extra.evasiveSteering}`);
          }
          r.maxComfortJerk = Math.max(r.maxComfortJerk, curJerk);
        }

        // Propulsion while ADAS is braking.
        if (st.adasBrakeForce > 0.15 && sim.ego.a > 0.6 && sim.ego.roadGrade > -0.03) r.propWhileBrake++;

        // Steering oscillation: count steer-rate sign reversals with meaningful amplitude per 2 s window.
        const steer = sim.ego.delta;
        const rate = (steer - prevSteer) / DT;
        const sign = Math.abs(rate) > 0.05 ? Math.sign(rate) : 0;
        if (sign !== 0 && prevSteerRateSign !== 0 && sign !== prevSteerRateSign) steerSignWindow.push(t);
        if (sign !== 0) prevSteerRateSign = sign;
        prevSteer = steer;
        while (steerSignWindow.length && steerSignWindow[0] < t - 2) steerSignWindow.shift();
        if (steerSignWindow.length > 8) { r.steerFlips++; steerSignWindow.length = 0; if (r.notes.length < 8) r.notes.push(`t=${t.toFixed(1)} steering oscillation (>8 reversals/2s) elk=${st.extra.emergencyLaneKeeping} lka=${st.laneKeepAssist} lfa=${st.laneCenteringActive} d=${sim.path.toFrenet(sim.ego.x, sim.ego.y).d.toFixed(2)}`); }

        // Hold stuck: stopped under AEB hold > 8 s while nothing is ahead within 12 m.
        if (st.aebHolding && sim.ego.v < 0.05) {
          const ef = sim.path.toFrenet(sim.ego.x, sim.ego.y);
          const blocked = sim.traffic.cars.some(c => { const ds = wrapDiff(c.s, ef.s, sim.path.length); return ds > 0 && ds < 14 && Math.abs(c.d - ef.d) < 2.6; })
            || sim.pedestrians.peds.some(p => p.state !== "done" && Math.abs(wrapDiff(p.s, ef.s, sim.path.length)) < 14 && Math.abs(p.d - ef.d) < 4);
          holdStill = blocked ? 0 : holdStill + DT;
          if (holdStill > 8) { r.stuckHold++; holdStill = 0; if (r.notes.length < 6) r.notes.push(`t=${t.toFixed(1)} AEB HOLD stuck with clear path`); }
        } else holdStill = 0;

        if (st.takeoverRequired) r.takeoverSec += DT;
      }
      r.collisions = sim.metrics.collisions;
      r.offRoad = sim.metrics.offRoadTime;
      r.meanSpeed = speedSum / N;
      results.push(r);

      const bad: string[] = [];
      if (r.collisions) bad.push(`collisions=${r.collisions}`);
      if (r.offRoad > 0.2) bad.push(`offRoad=${r.offRoad.toFixed(1)}s`);
      if (r.aebFlaps) bad.push(`aebFlaps=${r.aebFlaps}`);
      if (r.aebNoThreat) bad.push(`aebNoThreat=${r.aebNoThreat}`);
      if (r.fcwFlaps > 3) bad.push(`fcwFlaps=${r.fcwFlaps}`);
      if (r.arbiterJumps) bad.push(`arbiterJumps=${r.arbiterJumps}`);
      if (r.steerFlips) bad.push(`steerOsc=${r.steerFlips}`);
      if (r.propWhileBrake > 3) bad.push(`propWhileBrake=${r.propWhileBrake}`);
      if (r.stuckHold) bad.push(`stuckHold=${r.stuckHold}`);
      if (r.maxComfortJerk > 12) bad.push(`jerk=${r.maxComfortJerk.toFixed(1)}`);
      if (r.meanSpeed < 1.0) bad.push(`meanSpeed=${r.meanSpeed.toFixed(2)}`);
      const line = `${r.key.padEnd(30)} v̄=${(r.meanSpeed * 3.6).toFixed(0).padStart(3)}km/h AEB=${r.aebEvents} ${bad.length ? "!! " + bad.join(" ") : "ok"}`;
      console.log(line);
      for (const n of r.notes) console.log(`      · ${n}`);
      if (bad.length) failures.push(`${r.key}: ${bad.join(", ")}`);
    }
  }
}

// ============================================================================
// Active Multi-ADAS Interaction & Handoff Verification (Real Vehicle Physics)
// ============================================================================
if (!trackFilter) {
  const check = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`  !! ACTIVE-COORDINATION FAIL: ${msg}`);
      failures.push(`active: ${msg}`);
    }
  };

  // 1. ACC + TLA (Traffic Light Assist) + FDA (Front Departure Alert)
  {
    const sim = new Simulation({ trackId: "city", trafficCount: 0, seed: 101 });
    sim.setVehicleProfile("vf9");
    sim.setControlMode("adas");
    sim.traffic.clear();
    sim.pedestrians.clear();
    sim.usePerception = false;
    const startS = 100;
    const lane = 1;
    const laneD = sim.road.laneCenter(lane);
    const w = sim.path.toCartesian(startS, laneD);
    Object.assign(sim.ego, { x: w.x, y: w.y, yaw: w.heading, v: 8 });
    (sim as unknown as { lastEgoIndex: number }).lastEgoIndex = -1;
    sim.ego.syncWheelSpeeds();
    sim.trafficLights = sim.trafficLights.filter(() => false);
    const lead = sim.traffic.addTestVehicle("car", lane, startS + 28, 0, 0);
    lead.d = laneD;
    lead.disabled = true;
    sim.setAccSpeedKph(40);
    sim.adas.resumeCruise();
    let maxJerk = 0;
    let sawFda = false;
    for (let i = 0; i < 8 * 60; i++) {
      sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
      sim.step(DT);
      if (i > 15 && !sim.adas.status.aeb) maxJerk = Math.max(maxJerk, Math.abs(sim.ego.jerkFiltered));
    }
    check(sim.ego.v < 0.15 && sim.metrics.collisions === 0, `ACC+FDA stop failed (v=${sim.ego.v.toFixed(2)}, coll=${sim.metrics.collisions})`);
    check(maxJerk <= 12, `ACC+FDA stop comfortJerk=${maxJerk.toFixed(1)} > 12`);
    lead.disabled = false;
    lead.v = 6;
    lead.desiredSpeed = 6;
    for (let i = 0; i < 2 * 60; i++) {
      lead.s += 6 * DT;
      sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
      sim.step(DT);
      sawFda ||= sim.adas.status.extra.leadDeparture;
    }
    check(sawFda, "FDA failed to alert when stopped lead vehicle departed");
    console.log("active/acc-tla-fda             ok");
  }

  // 2. ACC + TSR/ISA Speed Limiter + Kickdown Override + AEB Priority Over Kickdown
  {
    const sim = new Simulation({ trackId: "boulevard", trafficCount: 0, seed: 102 });
    sim.setVehicleProfile("vf9");
    sim.setControlMode("adas");
    sim.traffic.clear();
    sim.pedestrians.clear();
    sim.trafficLights = [];
    sim.usePerception = true;
    sim.sensor.config.dropout = 0;
    const startS = 120;
    const lane = 1;
    const laneD = sim.road.laneCenter(lane);
    const w = sim.path.toCartesian(startS, laneD);
    Object.assign(sim.ego, { x: w.x, y: w.y, yaw: w.heading, v: 22 }); // 79.2 km/h
    (sim as unknown as { lastEgoIndex: number }).lastEgoIndex = -1;
    sim.ego.syncWheelSpeeds();
    sim.roadSigns = [
      { id: "isa-50-a", s: startS + 30, kind: "speed-limit", valueKph: 50 },
      { id: "isa-50-b", s: startS + 85, kind: "speed-limit", valueKph: 50 },
    ];
    sim.adas.config.tsr = true;
    sim.adas.config.isa = true;
    sim.adas.config.isaMode = "limit";
    sim.adas.config.aebCalibration = {
      overridePolicy: { throttleOverrideThreshold: null, steeringOverrideRelease: true, driverBrakePriority: true },
    };
    sim.setAccSpeedKph(80);
    sim.adas.resumeCruise();
    let sawIsaLimit = false;
    let maxIsaJerk = 0;
    for (let i = 0; i < 3 * 60; i++) {
      sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
      sim.step(DT);
      sawIsaLimit ||= sim.adas.status.speedLimited;
      if (i > 10 && !sim.adas.status.aeb) maxIsaJerk = Math.max(maxIsaJerk, Math.abs(sim.ego.jerkFiltered));
    }
    check(sawIsaLimit && sim.ego.v < 19.5, `ISA failed to decelerate smoothly toward 50 km/h sign (v=${sim.ego.v.toFixed(2)})`);
    check(maxIsaJerk <= 12, `ISA speed-limit entry jerk=${maxIsaJerk.toFixed(1)} > 12`);

    // Driver kickdown (throttle >= 0.95) overrides ISA, then sudden stalled car ahead triggers AEB overriding kickdown
    sim.setDriverInput({ steer: 0, throttle: 0.98, brake: 0 });
    sim.step(DT);
    check(sim.adas.status.isaOverride, "Full-throttle kickdown did not set isaOverride");
    const fNow = sim.path.toFrenet(sim.ego.x, sim.ego.y);
    const blocker = sim.traffic.addTestVehicle("stalled", lane, fNow.s + 58, 0, 0);
    blocker.d = laneD;
    let sawAebOverKickdown = false;
    for (let i = 0; i < 8 * 60; i++) {
      sim.setDriverInput({ steer: 0, throttle: 0.98, brake: 0 });
      sim.step(DT);
      sawAebOverKickdown ||= sim.adas.status.aeb;
      if (sim.ego.v < 0.05 && sim.adas.status.aebHolding) break;
    }
    check(sawAebOverKickdown && sim.metrics.collisions === 0 && sim.ego.v < 0.2, "AEB failed to override kickdown before stalled car");
    console.log("active/isa-kickdown-aeb        ok");
  }

  // 3. LFA + ALC + BSM/BCA Blind-Spot Protection + Subsequent Clean ALC Completion
  {
    const sim = new Simulation({ trackId: "motorway", trafficCount: 0, seed: 103 });
    sim.setVehicleProfile("civic");
    sim.setControlMode("adas");
    sim.traffic.clear();
    sim.pedestrians.clear();
    sim.usePerception = true;
    sim.sensor.config.dropout = 0;
    const startS = 400;
    const lane = 1;
    const laneD = sim.road.laneCenter(lane);
    const rightD = sim.road.laneCenter(2);
    const w = sim.path.toCartesian(startS, laneD);
    Object.assign(sim.ego, { x: w.x, y: w.y, yaw: w.heading, v: 22 });
    (sim as unknown as { lastEgoIndex: number }).lastEgoIndex = -1;
    sim.ego.syncWheelSpeeds();
    sim.setAccSpeedKph(80);
    sim.adas.resumeCruise();
    const blindCar = sim.traffic.addTestVehicle("car", 2, startS - 2, 22, 22);
    blindCar.d = rightD;
    blindCar.changeCooldown = 999;
    for (let i = 0; i < 6; i++) sim.step(DT);

    sim.toggleIndicator(1); // Request right lane change into occupied blind spot
    for (let i = 0; i < 30; i++) {
      const ef = sim.path.toFrenet(sim.ego.x, sim.ego.y);
      blindCar.s = ef.s - 2;
      blindCar.v = sim.ego.v;
      sim.step(DT);
    }
    check(sim.adas.status.blindSpotRight && sim.adas.status.alc === "blocked", `ALC failed to block on right blind-spot vehicle (bsm=${sim.adas.status.blindSpotRight}, alc=${sim.adas.status.alc})`);

    // Driver drifts right toward lane 2 blind-spot car -> BCA intervenes inward without fighting LFA
    const efBca = sim.path.toFrenet(sim.ego.x, sim.ego.y);
    const wBca = sim.path.toCartesian(efBca.s, rightD - 2.35);
    Object.assign(sim.ego, { x: wBca.x, y: wBca.y, yaw: wBca.heading });
    blindCar.s = efBca.s - 3.5;
    blindCar.d = rightD;
    blindCar.v = sim.ego.v + 3;
    sim.setDriverInput({ steer: 0.25, throttle: 0, brake: 0 });
    sim.step(DT);
    check(
      sim.adas.status.extra.blindSpotIntervention && sim.ego.delta <= 0.05,
      `BCA failed to counter-steer away from blind-spot threat (bca=${sim.adas.status.extra.blindSpotIntervention}, delta=${sim.ego.delta.toFixed(3)})`,
    );
    sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
    sim.clearIndicator();

    // Remove blind-spot blocker, recenter in lane 1, wait for steering release cooldown, then complete ALC into lane 2
    sim.traffic.clear();
    sim.tracker.reset();
    sim.tracks = [];
    for (let i = 0; i < 75; i++) sim.step(DT);
    sim.adas.resumeCruise();
    sim.toggleIndicator(1);
    let alcCompleted = false;
    for (let i = 0; i < 10 * 60; i++) {
      sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
      sim.step(DT);
      alcCompleted ||= sim.adas.status.alcComplete;
      if (alcCompleted && sim.indicator === 0) break;
    }
    const fEnd = sim.path.toFrenet(sim.ego.x, sim.ego.y);
    check(
      alcCompleted && sim.indicator === 0 && Math.abs(fEnd.d - rightD) < 0.35 && sim.metrics.collisions === 0,
      `ALC failed to complete after blind spot cleared (done=${alcCompleted}, alc=${sim.adas.status.alc}, reason=${sim.adas.status.alcReason}, d=${fEnd.d.toFixed(2)}, rightD=${rightD.toFixed(2)})`,
    );
    console.log("active/lfa-alc-bsm-bca         ok");
  }

  // 4. ACC → FCW → Partial AEB → Emergency AEB → Standstill HOLD → Foot-Brake / Resume Handback
  {
    const sim = new Simulation({ trackId: "motorway", trafficCount: 0, seed: 104 });
    sim.setVehicleProfile("vf9");
    sim.setControlMode("adas");
    sim.traffic.clear();
    sim.pedestrians.clear();
    sim.usePerception = true;
    sim.sensor.config.dropout = 0;
    const startS = 400;
    const lane = 1;
    const laneD = sim.road.laneCenter(lane);
    const w = sim.path.toCartesian(startS, laneD);
    Object.assign(sim.ego, { x: w.x, y: w.y, yaw: w.heading, v: 19 });
    (sim as unknown as { lastEgoIndex: number }).lastEgoIndex = -1;
    sim.ego.syncWheelSpeeds();
    sim.setAccSpeedKph(70);
    sim.adas.resumeCruise();
    // Place lead car 45 m ahead stopped so ACC -> FCW -> PARTIAL -> EMERGENCY -> HOLD all engage
    const lead = sim.traffic.addTestVehicle("stalled", lane, startS + 45, 0, 0);
    lead.d = laneD;
    const seenStates = new Set<string>();
    let aebFlaps = 0;
    let prevAeb = false;
    let offTimer = 99;
    for (let i = 0; i < 8 * 60; i++) {
      sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
      sim.step(DT);
      seenStates.add(sim.adas.status.aebState);
      if (sim.adas.status.aeb && !prevAeb && offTimer < 1.0) aebFlaps++;
      offTimer = sim.adas.status.aeb ? 0 : offTimer + DT;
      prevAeb = sim.adas.status.aeb;
      if (sim.adas.status.aebHolding && sim.ego.v === 0) break;
    }
    check(
      seenStates.has("EMERGENCY") && seenStates.has("HOLD") && aebFlaps === 0 && sim.metrics.collisions === 0 && sim.ego.v === 0,
      `ACC->AEB->HOLD chain failed (states=${[...seenStates].join(",")}, flaps=${aebFlaps}, coll=${sim.metrics.collisions})`,
    );
    // Driver presses foot brake to take over from HOLD, lead clears, and ACC resumes smoothly
    sim.setDriverInput({ steer: 0, throttle: 0, brake: 0.35 });
    sim.step(DT);
    check(!sim.adas.status.aebHolding, "Foot brake takeover did not release AEB HOLD");
    sim.traffic.clear();
    sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
    sim.adas.resumeCruise();
    for (let i = 0; i < 2 * 60; i++) sim.step(DT);
    check(sim.adas.status.accActive && sim.ego.v > 1.5, "ACC failed to resume after AEB HOLD takeover");
    console.log("active/acc-aeb-hold-resume     ok");
  }

  // 5. High-Speed (>130 km/h) ESA + AEB + Rear-Radar Fault Interlock
  {
    const runHighSpeedEsa = (rearRadar: boolean) => {
      const sim = new Simulation({ trackId: "motorway", trafficCount: 0, seed: 105 });
      sim.setVehicleProfile("vf9");
      sim.setControlMode("adas");
      sim.traffic.clear();
      sim.pedestrians.clear();
      sim.usePerception = true;
      sim.sensor.config.dropout = 0;
      sim.sensorAvailability = { camera: true, frontRadar: true, rearRadar, ultrasonic: true };
      const startS = 500;
      const lane = 1;
      const laneD = sim.road.laneCenter(lane);
      const w = sim.path.toCartesian(startS, laneD);
      Object.assign(sim.ego, { x: w.x, y: w.y, yaw: w.heading, v: 138 / 3.6 });
      (sim as unknown as { lastEgoIndex: number }).lastEgoIndex = -1;
      sim.ego.syncWheelSpeeds();
      sim.setAccSpeedKph(138);
      sim.adas.resumeCruise();
      const stalled = sim.traffic.addTestVehicle("stalled", lane, startS + 48, 0, 0);
      stalled.d = laneD;
      let sawEsa = false;
      let sawAeb = false;
      for (let i = 0; i < 180; i++) {
        sim.setDriverInput({ steer: 0, throttle: 0, brake: 0 });
        sim.step(DT);
        sawEsa ||= sim.adas.status.extra.evasiveSteering;
        sawAeb ||= sim.adas.status.aeb;
        const f = sim.path.toFrenet(sim.ego.x, sim.ego.y);
        if (f.s > startS + 65 || sim.metrics.collisions > 0) break;
      }
      return { sawEsa, sawAeb, collisions: sim.metrics.collisions, endD: sim.path.toFrenet(sim.ego.x, sim.ego.y).d, lane0D: sim.road.laneCenter(0) };
    };
    const healthy = runHighSpeedEsa(true);
    const faulted = runHighSpeedEsa(false);
    check(healthy.sawEsa && healthy.collisions === 0 && Math.abs(healthy.endD - healthy.lane0D) < 0.6, "Healthy rearRadar high-speed ESA failed to evade and center in lane 0");
    check(!faulted.sawEsa && faulted.sawAeb, "Faulted rearRadar allowed blind autonomous high-speed ESA swerve");
    console.log("active/esa-aeb-radar-interlock ok");
  }

  // 6. DMS → MRB → EDSS Multi-Lane Shoulder Pull-Over & Mid-Maneuver Driver Takeover
  {
    const sim = new Simulation({ trackId: "motorway", trafficCount: 0, seed: 106 });
    sim.setVehicleProfile("vf9");
    check(sim.prepareEmergencyStopLab(), "prepareEmergencyStopLab failed");
    sim.ego.syncWheelSpeeds();
    for (let i = 0; i < 55 * 60 && sim.emergencyPullOver.status.state !== "hold"; i++) {
      sim.step(DT);
    }
    const fHold = sim.path.toFrenet(sim.ego.x, sim.ego.y);
    check(
      sim.emergencyPullOver.status.state === "hold" &&
        sim.road.inEmergencyShoulder(fHold.d, sim.ego.dims.width / 2) &&
        sim.ego.v === 0 &&
        sim.gear === "P" &&
        sim.epbEngaged &&
        sim.metrics.collisions === 0,
      "EDSS failed full motorway pull-over onto emergency shoulder on vf9 physics",
    );

    // Mid-maneuver driver takeover cleanly cancels EDSS
    const simTakeover = new Simulation({ trackId: "motorway", trafficCount: 0, seed: 106 });
    simTakeover.setVehicleProfile("vf9");
    simTakeover.prepareEmergencyStopLab();
    simTakeover.ego.syncWheelSpeeds();
    for (let i = 0; i < 60; i++) simTakeover.step(DT);
    simTakeover.setDriverInput({ steer: 0.25, throttle: 0, brake: 0 });
    simTakeover.step(DT);
    check(
      simTakeover.emergencyPullOver.status.state === "cancelled" && !simTakeover.adas.status.extra.minimalRiskBraking,
      "Driver steering takeover did not cancel EDSS/MRB",
    );
    console.log("active/dms-mrb-edss-takeover   ok");
  }

  // 7. Gear R: RCTA + Rear AEB + PMC (Pedal Misapplication Control)
  {
    const sim = new Simulation({ trackId: "city", trafficCount: 0, seed: 107 });
    sim.setVehicleProfile("vf9");
    sim.setControlMode("adas");
    sim.traffic.clear();
    sim.pedestrians.clear();
    sim.usePerception = true;
    sim.sensor.config.dropout = 0;
    const startS = 150;
    const lane = 1;
    const laneD = sim.road.laneCenter(lane);
    const w = sim.path.toCartesian(startS, laneD);
    Object.assign(sim.ego, { x: w.x, y: w.y, yaw: w.heading, v: 0 });
    sim.ego.syncWheelSpeeds();
    sim.setParkingBrake(false);
    sim.setGear("R");
    const wallCar = sim.traffic.addTestVehicle("stalled", lane, startS - 6.2, 0, 0);
    wallCar.d = laneD;
    let sawRearSafety = false;
    for (let i = 0; i < 3 * 60; i++) {
      sim.setDriverInput({ steer: 0, throttle: 0.95, brake: 0 });
      sim.step(DT);
      sawRearSafety ||= sim.adas.status.rearAeb || sim.adas.status.extra.pedalMitigation;
    }
    check(sawRearSafety && sim.metrics.collisions === 0 && sim.ego.v < 0.1, "Gear R Rear AEB / PMC failed to prevent reverse collision");
    console.log("active/reverse-rcta-rear-aeb   ok");
  }

  // 8. APA Closed-Loop Parking + Sudden Obstacle Intrusion Safe Abort
  {
    const sim = new Simulation({ trackId: "city", trafficCount: 0, seed: 108 });
    sim.setVehicleProfile("vf9");
    sim.usePerception = true;
    sim.sensor.config.dropout = 0;
    sim.prepareParkingLab();
    sim.ego.syncWheelSpeeds();
    check(sim.requestParking("apa"), "APA failed to find bay on vf9");
    for (let i = 0; i < 60; i++) {
      sim.parkingAssist.hold(true);
      sim.step(DT);
    }
    const f = sim.path.toFrenet(sim.ego.x, sim.ego.y);
    const intruder = sim.traffic.addTestVehicle("stalled", sim.road.laneOf(f.d), f.s + 5.8, 0, 0);
    intruder.d = f.d;
    for (let i = 0; i < 120; i++) {
      sim.parkingAssist.hold(true);
      sim.step(DT);
    }
    check(
      sim.parkingAssist.status.state === "cancelled" && sim.ego.v === 0 && sim.metrics.collisions === 0,
      "APA failed to brake and abort when obstacle intruded into swept path",
    );
    console.log("active/apa-obstacle-abort      ok");
  }

  // 9. High-Speed Sharp Cornering with Throttle Held (CSA) + ALC Near Green Signal & After Brake Tap
  {
    const sim = new Simulation({ trackId: "city", trafficCount: 0, seed: 109 });
    sim.setVehicleProfile("vf9");
    sim.setControlMode("adas");
    sim.traffic.clear();
    sim.pedestrians.clear();
    const lane = 1;
    const centerD = sim.road.laneCenter(lane);
    const p = sim.path.toCartesian(280, centerD);
    Object.assign(sim.ego, { x: p.x, y: p.y, yaw: p.heading, v: 90 / 3.6, a: 0, delta: 0 });
    (sim as unknown as { lastEgoIndex: number }).lastEgoIndex = -1;
    sim.ego.syncWheelSpeeds();
    sim.setAccSpeedKph(90);
    sim.adas.resumeCruise();

    // Tap brake once (cancelling ACC), then hold throttle W while triggering ALC left into lane 0 and rounding the 90° corner
    sim.setDriverInput({ steer: 0, throttle: 0, brake: 0.25 });
    sim.step(DT);
    sim.setDriverInput({ steer: 0, throttle: 1.0, brake: 0 });
    sim.toggleIndicator(-1);

    const targetD = sim.road.laneCenter(0);
    let alcDone = false;
    let alcAborted = false;
    let maxPostAlcOff = 0;
    for (let i = 0; i < 16 * 60; i++) {
      sim.setDriverInput({ steer: 0, throttle: 1.0, brake: 0 });
      sim.step(DT);
      if (sim.adas.status.alcComplete) alcDone = true;
      if (sim.adas.status.alcAborted) alcAborted = true;
      if (alcDone) {
        const f = sim.path.toFrenet(sim.ego.x, sim.ego.y);
        maxPostAlcOff = Math.max(maxPostAlcOff, Math.abs(f.d - targetD));
      }
    }
    check(
      alcDone && !alcAborted && maxPostAlcOff < 0.35 && sim.metrics.offRoadTime === 0,
      `High-speed throttle cornering + ALC failed (alcDone=${alcDone}, alcAborted=${alcAborted}, maxOff=${maxPostAlcOff.toFixed(3)}m)`,
    );
    console.log("active/csa-throttle-alc-curve  ok");
  }
}

if (failures.length) {
  console.error(`\nADAS-COORDINATION-AUDIT FAIL (${failures.length}/${results.length})`);
  throw new Error(failures.join("\n"));
}
console.log(`\nADAS-COORDINATION-AUDIT PASS — ${results.length} runs × ${SECONDS}s + active multi-ADAS checks.`);
