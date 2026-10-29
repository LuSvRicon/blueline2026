// Shared scenario catalogue used by the launch menu and the control panel.

import { ScenarioName } from "../traffic/TrafficManager.ts";

export interface ScenarioEntry {
  id: ScenarioName;
  label: string;
}

export const SCENARIOS: ScenarioEntry[] = [
  { id: "highway", label: "Đường vành đai" },
  { id: "trucks", label: "Đoàn xe tải" },
  { id: "stalled", label: "Xe chết máy" },
  { id: "cutin", label: "Xe nhập làn gấp" },
  { id: "dense", label: "Đông phương tiện" },
  { id: "crossing", label: "Người đi bộ qua đường" },
  { id: "occluded", label: "Người đi bộ khuất tầm nhìn" },
  { id: "jaywalker", label: "Người đi bộ băng ngang" },
  { id: "blindspot", label: "Điểm mù xe máy" },
  { id: "lights", label: "🚦 Đèn giao thông" },
  { id: "rush", label: "🌆 Giờ cao điểm" },
  { id: "motorcycle-weave", label: "Xe máy luồn làn" },
  { id: "bus-stop", label: "Xe buýt đón khách" },
  { id: "traffic-jam", label: "Ùn tắc giao thông" },
  { id: "truck-breakdown", label: "Xe tải hỏng giữa đường" },
  { id: "vietnam-rush", label: "🇻🇳 Phố Việt Nam giờ cao điểm" },
];
