/** Observable behaviour references are listed in docs/ADAS_THAM_CHIEU_2026-10-29.md.
 * This is a composite laboratory profile, NOT an OEM ECU calibration. */
export const ASSISTANCE_REFERENCE = {
  id: 'blueline-composite-2026-10',
  name: 'BlueLine · tham chiếu nhiều hãng',
  accMaxKph: 180, accMinSetKph: 30,
  laneDepartureMinKph: 60,
  // All-speed BlueLine profile: motion, not a fixed speed threshold, starts
  // the manoeuvre. The minimum path length preserves low-speed geometry.
  alcMinPathMetres: 18, alcNominalSeconds: 3.6,
  highBeamOnKph: 40, highBeamOffKph: 25,
  rctaMaxKph: 8, rctaTargetMinKph: 5, rctaRange: 25,
  // Public manuals do not disclose these calibrations. These values are BlueLine's.
  stopGoResumeSeconds: 3, attentionWarningSeconds: 2, handsWarningSeconds: 5,
  takeoverAttentionSeconds: 10, takeoverHandsSeconds: 15,
  stopAttentionSeconds: 15, stopHandsSeconds: 20,
} as const;

export interface SensorAvailability { camera: boolean; frontRadar: boolean; rearRadar: boolean; ultrasonic: boolean }
export interface OperatingConditions {
  gear: 'P' | 'R' | 'N' | 'D'; engineOn: boolean; epb: boolean;
  doorsClosed: boolean; beltFastened: boolean; escAvailable: boolean; absActive: boolean;
  handsOn: boolean; hazards: boolean; motorway: boolean;
}
export interface AvailabilityFrame {
  sensorsAvailable?: boolean;
  sensorAvailability?: Partial<SensorAvailability>;
  conditions?: Partial<OperatingConditions>;
  laneConfidence?: number;
}
export function assistanceAvailability(frame: AvailabilityFrame) {
  const sensors: SensorAvailability = { camera: true, frontRadar: true, rearRadar: true, ultrasonic: true, ...frame.sensorAvailability };
  if (frame.sensorsAvailable === false) for (const key of Object.keys(sensors) as (keyof SensorAvailability)[]) sensors[key] = false;
  const conditions: OperatingConditions = { gear: 'D', engineOn: true, epb: false, doorsClosed: true, beltFastened: true,
    escAvailable: true, absActive: false, handsOn: true, hazards: false, motorway: false, ...frame.conditions };
  const lane = sensors.camera && (frame.laneConfidence ?? 1) >= .6;
  // Deliberately conservative fault model: no claim of OEM degraded sensor fusion.
  const forward = sensors.camera && sensors.frontRadar;
  const cruiseReason = !conditions.engineOn ? 'Chưa khởi động' : conditions.gear !== 'D' ? 'Cần số D' : conditions.epb ? 'Phanh đỗ đang bật' :
    !conditions.doorsClosed ? 'Cửa đang mở' : !conditions.beltFastened ? 'Chưa cài dây an toàn' : !conditions.escAvailable ? 'ESC không sẵn sàng' :
    conditions.absActive ? 'ABS đang can thiệp' : !forward ? 'Camera/radar trước không sẵn sàng' : '';
  return { sensors, conditions, lane, forward, cruise: cruiseReason === '', cruiseReason };
}
