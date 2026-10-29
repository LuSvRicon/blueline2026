// Shared scenario catalogue used by the launch menu and the control panel.

import { ScenarioName } from "../traffic/TrafficManager.ts";

export interface ScenarioEntry {
  id: ScenarioName;
  label: string;
  description?: string;
}

export const SCENARIOS: ScenarioEntry[] = [
  { id: "highway", label: "Lưu thông thông thường" },
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
  { id: "school-zone", label: "Khu vực trường học", description: "Giới hạn 30 km/h; quan sát xe buýt dừng và người đi bộ tại vạch sang đường." },
  { id: "market-street", label: "Phố chợ đông xe máy", description: "Đường chậm 30 km/h, xe máy cắt ngang và người đi bộ. Giữ khoảng trống để xử lý." },
  { id: "roadworks", label: "Công trường thu hẹp làn", description: "Xe tải chắn làn phía trước. Giảm tốc và chỉ chuyển làn khi có đủ khoảng trống." },
  { id: "reverse-crossing", label: "Lùi xe · xe máy cắt ngang", description: "Bật Hỗ trợ ADAS, giữ phanh, chọn R rồi nhả phanh đỗ để lùi chậm. Xe máy bắt đầu cắt ngang khi chọn R; có thể thêm lại bằng các nút cắt ngang sau." },
];
