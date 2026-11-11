// VehicleProfiles — Documented physical chassis, tire, brake-hydraulic, and AEB
// calibration profiles for the ego models available in BlueLine.
//
// Provenance Discipline (strictly separating public specs vs simulation models):
//   [SOURCE]: Publicly published manufacturer dimensions, curb mass, drivetrain
//             architecture, wheel/tire size class, and brake caliper class.
//   [SIMULATION_ASSUMPTION]: CG height, suspension pitch/roll compliance, wheel
//             rotational inertia, Pacejka slip-curve shape, and hydraulic delay
//             estimated for real-time 60-1000 Hz software simulation (NOT secret
//             OEM ECU/ESP bench data).
//   [TUNABLE]: Per-vehicle AEB warning/intervention thresholds adapted to each
//             vehicle's physical inertia, brake build rate, and stopping capability.
//
// Named profiles use their nominal exterior body envelope for collision,
// perception clearance and parking, and the visible GLB clone is fitted to that
// envelope. Imported assets keep a canonical authoring space for cabin/wheel
// rigs; canonical dimensions are NOT the physical dimensions of every car.
// These are nominal rectangular envelopes, not validated OEM collision meshes.

export type RealVehicleModelId = "vf9" | "santafe" | "everest" | "civic";
export type VehicleProfileId = "composite" | RealVehicleModelId;
export const REAL_VEHICLE_IDS: readonly RealVehicleModelId[] = ["civic", "santafe", "everest", "vf9"];

export interface VehicleAEBProfileOverrides {
  /** [SIMULATION_ASSUMPTION] Unprimed electro-hydraulic dead-time (s). */
  actuatorDelaySec?: number;
  /** [SIMULATION_ASSUMPTION] Primed dead-time (s) when FCW prefill is active. */
  prefillActuatorDelaySec?: number;
  /** [SIMULATION_ASSUMPTION] Stage-1 partial brake ramp rate (m/s³). */
  partialBuildRate?: number;
  /** [SIMULATION_ASSUMPTION] Full emergency hydraulic build rate (m/s³). */
  emergencyBuildRate?: number;
  /** [TUNABLE] Desired static post-stop bumper clearance (m). */
  standstillClearance?: number;
  /** [TUNABLE] Latest TTB (s) to raise FCW + hydraulic prefill. */
  warnTtbSec?: number;
  /** [TUNABLE] Latest TTB (s) to initiate Stage-1 partial braking. */
  partialTtbSec?: number;
  /** [TUNABLE] Latest TTB (s) to command full emergency braking. */
  emergencyTtbSec?: number;
  /** [TUNABLE] Driver override policy adjustments (e.g. sport kickdown). */
  throttleOverrideThreshold?: number | null;
}

export interface VehiclePhysicsProfile {
  readonly id: VehicleProfileId;
  readonly name: string;
  readonly segment: string;
  /** [SOURCE] Curb mass including driver/fluids (kg). */
  readonly massKg: number;
  /** [SOURCE / SIMULATION_ASSUMPTION] Nominal body envelope length (m). */
  readonly realLengthM: number;
  /** [SOURCE / SIMULATION_ASSUMPTION] Body envelope width excluding mirrors (m). */
  readonly realWidthM: number;
  /** Overall mirror-to-mirror width, when published. Never used as chassis width. */
  readonly overallWidthIncludingMirrorsM?: number;
  /** Public primary sources for dimensions; market/generation qualifications are in the note below. */
  readonly dimensionSourceUrls?: readonly string[];
  /** A body width estimate must not be presented as a manufacturer-verified measurement. */
  readonly bodyWidthProvenance?: "manufacturer" | "simulation-assumption";
  /** [SOURCE] Physical wheelbase L between front and rear axles (m). */
  readonly wheelbaseM: number;
  /** [SOURCE] Average front/rear track width tw (m). */
  readonly trackWidthM: number;
  /** [SIMULATION_ASSUMPTION] Center-of-gravity height h_cg above road plane (m). */
  readonly cgHeightM: number;
  /** [SOURCE / SIMULATION_ASSUMPTION] Static front-axle weight fraction in [0.4, 0.65]. */
  readonly frontStaticWeightFrac: number;
  /** [SOURCE] Loaded effective tire rolling radius R_eff (m). */
  readonly wheelRadiusM: number;
  /** [SIMULATION_ASSUMPTION] Single-wheel + rotor/half-shaft rotational inertia J_w (kg·m²). */
  readonly wheelInertiaKgM2: number;
  /** [SIMULATION_ASSUMPTION] Maximum forward propulsion acceleration on dry road (m/s²). */
  readonly maxAccel: number;
  /** [SIMULATION_ASSUMPTION] Sustained service/AEB braking capability on dry road (m/s²). */
  readonly maxDecel: number;
  /** [SOURCE / SIMULATION_ASSUMPTION] Max front road-wheel steer angle (deg). */
  readonly maxSteerDeg: number;
  /** [SIMULATION_ASSUMPTION] Nominal hydraulic front-axle brake proportioning (0..1). */
  readonly brakeBiasFront: number;
  /** [SIMULATION_ASSUMPTION] Additional off-throttle coasting deceleration (m/s², e.g. EV regen). */
  readonly extraCoastDecel: number;
  /** [SIMULATION_ASSUMPTION] Steady-state chassis pitch compliance (rad per m/s²). */
  readonly pitchGainRadPerMps2: number;
  /** [SIMULATION_ASSUMPTION] Steady-state chassis roll compliance (rad per m/s²). */
  readonly rollGainRadPerMps2: number;
  /** [SIMULATION_ASSUMPTION] First-order damper settling time constant (s). */
  readonly suspensionTauSec: number;
  /** [SIMULATION_ASSUMPTION] Longitudinal slip ratio κ_peak at peak tire friction (0.10..0.16). */
  readonly tirePeakSlip: number;
  /** [SIMULATION_ASSUMPTION] Ratio μ_slide / μ_peak at 100% locked-wheel slide (κ = 1.0). */
  readonly tireSlideRatio: number;
  /** [TUNABLE] Per-vehicle AEB actuator & timing calibration overrides. */
  readonly aebOverrides: VehicleAEBProfileOverrides;
  /** Short Vietnamese engineering summary of provenance & dynamic traits. */
  readonly provenanceNote: string;
}

export const VEHICLE_PHYSICS_PROFILES: Record<VehicleProfileId, VehiclePhysicsProfile> = {
  composite: {
    id: "composite",
    name: "Cấu hình tham chiếu tiêu chuẩn (Composite)",
    segment: "Sedan / Crossover hạng C-D chuẩn kiểm thử",
    massKg: 1750,
    realLengthM: 4.70,
    realWidthM: 2.00,
    wheelbaseM: 2.80,
    trackWidthM: 1.62,
    cgHeightM: 0.56,
    frontStaticWeightFrac: 0.54,
    wheelRadiusM: 0.34,
    wheelInertiaKgM2: 1.15,
    maxAccel: 3.5,
    maxDecel: 7.0,
    maxSteerDeg: 35,
    brakeBiasFront: 0.66,
    extraCoastDecel: 0,
    pitchGainRadPerMps2: 0.009,
    rollGainRadPerMps2: 0.006,
    suspensionTauSec: 0.20,
    tirePeakSlip: 0.13,
    tireSlideRatio: 0.77,
    aebOverrides: {},
    provenanceNote:
      "[SIMULATION_ASSUMPTION] Cấu hình chuẩn phục vụ hồi quy tất định (1750 kg, L=2.80 m, a_max=7.0 m/s²).",
  },

  vf9: {
    id: "vf9",
    name: "VinFast VF 9",
    segment: "SUV điện cỡ lớn hạng E (Dual-Motor AWD)",
    // [SOURCE]: VF 9 Vietnam brochure: length 5118 mm, wheelbase 3150 mm,
    // overall width 2254 mm. The body-only 2004 mm retained below is an explicit
    // simulation assumption: no primary body-only width source was verified.
    massKg: 2870,
    realLengthM: 5.118,
    realWidthM: 2.004,
    overallWidthIncludingMirrorsM: 2.254,
    bodyWidthProvenance: "simulation-assumption",
    dimensionSourceUrls: ["https://shop.vinfastauto.com/on/demandware.static/-/Sites-app_vinfast_vn-Library/default/dwd7a5ae21/raisinghands/documents/VF9_Brochure_VN.pdf"],
    wheelbaseM: 3.15,
    trackWidthM: 1.69,
    // [SIMULATION_ASSUMPTION]: Skateboard 123 kWh battery lowers CG relative to roof height.
    cgHeightM: 0.61,
    frontStaticWeightFrac: 0.50,
    wheelRadiusM: 0.386,
    wheelInertiaKgM2: 1.68,
    maxAccel: 4.2,
    maxDecel: 6.65,
    maxSteerDeg: 33,
    brakeBiasFront: 0.63,
    extraCoastDecel: 0.38, // Mild regenerative braking on pedal lift
    pitchGainRadPerMps2: 0.0082,
    rollGainRadPerMps2: 0.0058,
    suspensionTauSec: 0.22,
    tirePeakSlip: 0.135,
    tireSlideRatio: 0.76,
    aebOverrides: {
      actuatorDelaySec: 0.082,
      prefillActuatorDelaySec: 0.032,
      partialBuildRate: 15.0,
      emergencyBuildRate: 39.0,
      standstillClearance: 1.82,
      warnTtbSec: 1.34,
      partialTtbSec: 0.68,
      emergencyTtbSec: 0.25,
    },
    provenanceNote:
      "[SOURCE] Dài 5.118 m, trục cơ sở 3.15 m, rộng tổng thể cả gương 2.254 m; [SIMULATION_ASSUMPTION] rộng thân 2.004 m chưa xác minh từ nguồn hãng, khối lượng tham chiếu ~2870 kg, phanh tái sinh 0.38 m/s², AEB nạp áp sớm hơn.",
  },

  santafe: {
    id: "santafe",
    name: "Hyundai Santa Fe 2023",
    segment: "SUV gia đình hạng D (TM Facelift)",
    // [SOURCE]: Hyundai Santa Fe (TM PE) public specs: length 4785 mm, width 1900 mm,
    // wheelbase 2765 mm, track ~1637 mm, curb weight ~1835-1910 kg, 235/55R19 tires.
    massKg: 1865,
    realLengthM: 4.785,
    realWidthM: 1.90,
    bodyWidthProvenance: "manufacturer",
    dimensionSourceUrls: ["https://www.hyundai.news/uk/articles/press-releases/hyundai-motor-reveals-powertrain-details-and-features-of-new-santa-fe.html"],
    wheelbaseM: 2.765,
    trackWidthM: 1.637,
    cgHeightM: 0.60,
    frontStaticWeightFrac: 0.57,
    wheelRadiusM: 0.365,
    wheelInertiaKgM2: 1.26,
    maxAccel: 3.25,
    maxDecel: 7.1,
    maxSteerDeg: 35,
    brakeBiasFront: 0.67,
    extraCoastDecel: 0.02,
    pitchGainRadPerMps2: 0.0095,
    rollGainRadPerMps2: 0.0065,
    suspensionTauSec: 0.21,
    tirePeakSlip: 0.13,
    tireSlideRatio: 0.77,
    aebOverrides: {
      actuatorDelaySec: 0.075,
      prefillActuatorDelaySec: 0.030,
      partialBuildRate: 16.0,
      emergencyBuildRate: 44.0,
      standstillClearance: 1.68,
      warnTtbSec: 1.24,
      partialTtbSec: 0.62,
      emergencyTtbSec: 0.22,
    },
    provenanceNote:
      "[SOURCE] Khối lượng ~1865 kg, trục cơ sở 2.765 m; [SIMULATION_ASSUMPTION] cân bằng êm ái gia đình & an toàn FCA (a_max=7.1 m/s²).",
  },

  everest: {
    id: "everest",
    name: "Ford Everest Sport 2023",
    segment: "SUV khung gầm rời Body-on-Frame (Next-Gen T6.2)",
    // [SOURCE]: Ford Everest Sport 2023 public specs: length 4914 mm, width 1923 mm,
    // wheelbase 2900 mm, track 1620 mm, curb weight ~2360-2415 kg, 255/55R20 tires.
    massKg: 2380,
    realLengthM: 4.914,
    realWidthM: 1.923,
    overallWidthIncludingMirrorsM: 2.207,
    bodyWidthProvenance: "manufacturer",
    dimensionSourceUrls: ["https://www.fordservicecontent.com/Ford_Content/vdirsnet/OwnerManual/Home/Content?ProcUid=G2259072&Uid=G2259047&buildtype=web&countryCode=VNM&div=f&languageCode=vi&moidRef=G910634&userMarket=VNM&vFilteringEnabled=False&variantid=9846"],
    wheelbaseM: 2.90,
    trackWidthM: 1.62,
    // [SIMULATION_ASSUMPTION]: Ladder-frame ground clearance (200 mm) raises CG & pitch dive.
    cgHeightM: 0.68,
    frontStaticWeightFrac: 0.54,
    wheelRadiusM: 0.392,
    wheelInertiaKgM2: 1.58,
    maxAccel: 2.95,
    maxDecel: 6.50,
    maxSteerDeg: 34,
    brakeBiasFront: 0.68,
    extraCoastDecel: 0.04,
    pitchGainRadPerMps2: 0.0122,
    rollGainRadPerMps2: 0.0084,
    suspensionTauSec: 0.25,
    tirePeakSlip: 0.14,
    tireSlideRatio: 0.75,
    aebOverrides: {
      actuatorDelaySec: 0.085,
      prefillActuatorDelaySec: 0.035,
      partialBuildRate: 14.5,
      emergencyBuildRate: 38.0,
      standstillClearance: 1.85,
      warnTtbSec: 1.38,
      partialTtbSec: 0.70,
      emergencyTtbSec: 0.26,
    },
    provenanceNote:
      "[SOURCE] Khối lượng ~2380 kg, trục cơ sở 2.90 m (khung rời); [SIMULATION_ASSUMPTION] trọng tâm cao 0.68 m gây chúi đầu lớn khi phanh gấp, cần can thiệp AEB sớm.",
  },

  civic: {
    id: "civic",
    name: "Honda Civic Type R 2023",
    segment: "Hatchback hiệu năng cao (FL5 · Brembo 4-piston)",
    // [SOURCE]: Honda Civic Type R (FL5) public specs: length 4595 mm, width 1890 mm,
    // wheelbase 2735 mm, track ~1625 mm, curb weight 1430 kg, 265/30ZR19 Pilot Sport 4S, Brembo 350 mm front brakes.
    massKg: 1430,
    realLengthM: 4.595,
    realWidthM: 1.89,
    bodyWidthProvenance: "manufacturer",
    dimensionSourceUrls: ["https://www.honda.co.jp/factbook/auto/CIVIC_TYPE_R/202209/220901_CIVIC_TYPE_R.pdf"],
    wheelbaseM: 2.735,
    trackWidthM: 1.625,
    cgHeightM: 0.47,
    frontStaticWeightFrac: 0.60,
    wheelRadiusM: 0.321,
    wheelInertiaKgM2: 0.92,
    maxAccel: 4.4,
    maxDecel: 8.25,
    maxSteerDeg: 33,
    brakeBiasFront: 0.70,
    extraCoastDecel: 0.05,
    pitchGainRadPerMps2: 0.0055,
    rollGainRadPerMps2: 0.0040,
    suspensionTauSec: 0.13,
    tirePeakSlip: 0.115,
    tireSlideRatio: 0.82,
    aebOverrides: {
      actuatorDelaySec: 0.060,
      prefillActuatorDelaySec: 0.022,
      partialBuildRate: 19.0,
      emergencyBuildRate: 54.0,
      standstillClearance: 1.50,
      warnTtbSec: 1.10,
      partialTtbSec: 0.54,
      emergencyTtbSec: 0.18,
    },
    provenanceNote:
      "[SOURCE] Khối lượng 1430 kg, trục cơ sở 2.735 m, phanh Brembo + lốp 265/30ZR19; [SIMULATION_ASSUMPTION] trọng tâm thấp 0.47 m, tăng áp phanh 54 m/s³, giảm tốc đạt 8.25 m/s².",
  },
};

export function getVehiclePhysicsProfile(id: string | undefined): VehiclePhysicsProfile {
  if (id && id in VEHICLE_PHYSICS_PROFILES) {
    return VEHICLE_PHYSICS_PROFILES[id as VehicleProfileId];
  }
  return VEHICLE_PHYSICS_PROFILES.composite;
}

export function formatVehiclePhysicsSummary(profile: VehiclePhysicsProfile): string {
  return `${profile.name} · ${profile.massKg} kg · trục cơ sở ${profile.wheelbaseM.toFixed(2)} m · trọng tâm ${profile.cgHeightM.toFixed(2)} m · phanh tối đa ${profile.maxDecel.toFixed(2)} m/s²`;
}
