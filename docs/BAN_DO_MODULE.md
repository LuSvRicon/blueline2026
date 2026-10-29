# Bản đồ module BlueLine và kết quả kiểm tra

## ADAS theo tài liệu tham chiếu — 29/10/2026

Xem [nghiên cứu và đối chiếu từng nhóm ADAS](ADAS_THAM_CHIEU_2026-10-29.md) và [báo cáo thay đổi/kiểm chứng/giới hạn](BAO_CAO_ADAS_2026-10-29.md). Thêm chính sách điều kiện/cảm biến độc lập, tách LFA/LKA, điều kiện ALC, ISA ba chế độ, xác nhận đèn, phanh BCA khi rời chỗ, giám sát tài xế và lưu trạng thái replay. Sửa nhận nhầm ranh giới đường trong pipeline cảm biến sau lái thử thực tế. Đây là cấu hình tổng hợp BlueLine; mô hình xe 3D không mang ECU hãng. Các ghi chép phía dưới giữ nguyên theo thời điểm kiểm tra trước.

## Đã kiểm tra cabin trên trình duyệt — 28/10/2026

Xem [kiểm tra trực tiếp cabin](KIEM_TRA_CABIN_TRUC_TIEP_2026-10-28.md): sửa CSS đẩy bàn đạp khỏi màn hình, gắn camera 360° vào dock, hiệu chỉnh gương/cột lái và kiểm tra ngày/đêm cùng ba kích thước màn hình. Build và 8 bộ hồi quy liên quan đạt; mỹ thuật vẫn chưa đạt mức game thương mại.

## Hiệu chỉnh cabin — 28/10/2026

Xem [báo cáo cabin](CABIN_2026-10-28.md): tách `CarInterior`, `CockpitRig`, `CockpitInstruments`, thêm `CabinLookControls`; sửa tỷ lệ góc nhìn, vùng che khuất đồng hồ/gương/BSM, gạt mưa và hướng camera trái/phải. Có thêm hai bộ kiểm tra; đã chạy 8 bộ liên quan và build. Chưa kiểm tra được hình ảnh do quyền trình duyệt vẫn tắt.

## Cập nhật v0.6

Xem [báo cáo nâng cấp v0.6](NANG_CAP_V06.md) để biết trạng thái hiện tại: ba bản đồ, 20 kịch bản, 21 bộ kiểm thử, truyền động N/trôi xe, tiếp xúc thân xe có góc xoay và quét chuyển động, táp-lô/vô lăng/màn hình dẫn đường mới cùng các giới hạn kiểm chứng. Các phần bên dưới giữ lại ghi chép của lần rà soát trước.

Cập nhật: 27-10-2026

## Kiến trúc chạy

- Ứng dụng TypeScript chạy hoàn toàn trên trình duyệt, dùng Vite và Three.js; không có backend.
- `src/main.ts` ghép mô phỏng, cảnh 3D, HUD, bảng điều khiển và vòng lặp khung hình cố định.
- `src/sim/Simulation.ts` là điểm tích hợp headless: trạng thái xe, nhận biết, hành vi, lập kế hoạch, điều khiển, giao thông, người đi bộ, số liệu và các chính sách học được.
- `src/core/` cung cấp toán học, ma trận, đại số tuyến tính và đa thức độc lập với giao diện.

## Bản đồ module và trạng thái

| Phần | Mã nguồn | Chức năng hiện có | Giới hạn đã biết |
|---|---|---|---|
| Đường | `src/world/track.ts`, `ReferencePath.ts`, `Road.ts` | Một đường vòng đô thị bo góc, tọa độ Frenet, độ cong, ba làn | Chỉ có một bản đồ cố định; chưa có mạng lưới đường toàn cầu hoặc bản đồ theo quốc gia |
| Động lực xe | `src/vehicle/Vehicle.ts` | Mô hình xe đạp động học với lái, gia tốc, tốc độ và giới hạn giảm tốc | Mô hình giáo dục, không được hiệu chuẩn như xe thật |
| Lập kế hoạch | `src/planner/FrenetPlanner.ts`, `Trajectory.ts` | Quỹ đạo ứng viên, tốc độ mục tiêu, hàm chi phí và kiểm tra vật cản | Lưới chiếm chỗ hiện phục vụ hiển thị, chưa làm đầu vào cho bộ lập kế hoạch |
| Hành vi/điều khiển | `src/behavior/BehaviorPlanner.ts`, `src/control/` | Đi đều, theo xe, vượt, nhường, dừng; Stanley và PID nối vào luồng tự lái | Pure Pursuit có mã nhưng không phải bộ điều khiển đang dùng chính |
| Phương tiện giao thông | `src/traffic/TrafficManager.ts`, `IDM.ts`, `MOBIL.ts` | Mô hình bám xe/chuyển làn, hồ sơ Việt Nam/quốc tế, ô tô, xe máy, xe buýt, xe tải và xe hỏng | Xe luồn làn/ùn tắc/giờ cao điểm là kịch bản thủ công trên cùng đường mẫu; chưa mô phỏng luật giao thông địa phương đầy đủ |
| Người đi bộ | `src/pedestrian/PedestrianManager.ts`, `src/render/PedestrianView.ts` | Người đi qua vạch, khuất tầm nhìn và băng ngang theo kịch bản | Chưa có mô hình đám đông hoặc tuyến đi bộ tổng quát |
| Nhận biết | `src/perception/Sensor.ts`, `Tracker.ts`, `OccupancyGrid.ts` | Phát hiện có nhiễu và giới hạn tầm nhìn, bộ lọc Kalman vận tốc không đổi, lưới chiếm chỗ; ADAS dùng kênh radar mô phỏng tầm xa 180 m, giảm còn 165/150 m khi mưa/sương và không bị che theo quy tắc camera đơn giản | Đây vẫn là cảm biến phần mềm tổng hợp, không có ảnh camera, đám mây điểm lidar, Doppler radar hay hợp nhất cảm biến vật lý |
| Đèn/biển | `src/world/TrafficLight.ts`, `RoadSign.ts` | Đèn định thời, ràng buộc dừng và biển giới hạn tốc độ thủ tục trong bộ lập kế hoạch cổ điển | Chưa có quyền ưu tiên/rẽ tại giao lộ; biển chưa áp dụng đầy đủ cho lái tay/ADAS |
| AI học | `src/learn/` | MLP, học bắt chước/DAgger, tiến hóa và benchmark | Chính sách học là mô hình trong mô phỏng; dữ liệu não học lưu cục bộ bằng localStorage |
| ADAS | `src/sim/ADAS.ts`, `src/ui/ADASPanel.ts` | ACC stop & go với 5 mức khoảng cách, giữ làn, LDW, FCW hai mức, AEB (xe và người đi bộ), BSM, hỗ trợ chuyển làn theo xi nhan (ALC), TSR + ISA, cảm biến đỗ xe; bảng ADAS vẽ surround view từ track Kalman, hiển thị khoảng cách/TTC và nhật ký can thiệp | Tất cả là mô hình thử nghiệm, chưa đánh giá an toàn; ALC dùng chung bộ Stanley với giữ làn; BSM/ALC dựa trên vật cản đã theo dõi chứ không có radar thật |
| Số liệu/phiên lái | `src/sim/Metrics.ts`, `SessionRecorder.ts`, `src/ui/Scorecard.ts` | Điểm an toàn/êm dịu/hiệu quả, va chạm, quãng đường; ghi khung trạng thái, phát lại, xuất JSON | Phát lại ảnh chụp trạng thái, không phải chạy mô phỏng xác định lại; chưa có nhập tệp |
| Dựng hình | `src/render/` | Đường, thành phố có cửa sổ phát sáng, xe sedan/SUV/hatchback/xe máy/xe buýt/xe tải với bánh quay và đánh lái, thân nghiêng/chúi, đèn phanh, xi nhan, đèn pha, biển số, bóng đổ; IBL theo ngày/đêm; camera bám/cabin/trên/360°, thời tiết | Dựng hình thủ tục, chưa có tài sản môi trường/xe chi tiết hoặc hình ảnh cảm biến |
| Âm thanh | `src/audio/SimulationAudio.ts` | Âm động cơ/tiếng nền, lốp trượt, tiếng xi nhan, cảnh báo FCW/AEB/BSM và tiếng va chạm | Âm thanh Web Audio tổng hợp, chưa dùng mẫu thu và mô hình âm thanh xe |
| Giao diện | `src/ui/`, `index.html` | Menu khởi động chọn chế độ/kịch bản/thời tiết, HUD cụm đồng hồ (vòng tốc độ, số D, biển giới hạn, xi nhan), bảng ADAS, bảng điều khiển, bảng học AI, minimap, scorecard; tham số URL `mode`/`intro=0` | Giao diện desktop hiện có; chưa hoàn tất thiết kế kiểm tra responsive/mobile và rà soát khả năng sử dụng toàn diện |

## Cập nhật v0.4 — bộ ADAS và phương tiện

- **ADAS:** thêm ACC stop & go với 5 mức khoảng cách, LDW, FCW hai mức, ALC theo xi nhan (có kiểm tra làn đích và tự tắt xi nhan), TSR + ISA và cảm biến đỗ xe; bộ điều tốc ADAS dùng PID riêng để không xung đột với bộ điều khiển của bộ lập kế hoạch.
- **Giao diện:** menu khởi động kiểu game (chọn chế độ/kịch bản/thời tiết), HUD cụm đồng hồ có vòng tốc độ, số D, biển giới hạn và xi nhan; bảng ADAS có surround view và nhật ký can thiệp; hiệu ứng chớp đỏ khi va chạm.
- **Phương tiện:** bánh quay và bánh trước đánh lái, thân nghiêng/chúi, đèn phanh, xi nhan, đèn pha ban đêm, biển số, bóng đổ tiếp xúc, ba kiểu dáng ô tô và bảng màu thực tế; IBL ngày/đêm, cửa sổ toà nhà phát sáng.
- **Âm thanh:** tiếng xi nhan, lốp trượt, chime AEB lặp và tiếng va chạm.
- **Kiểm tra:** thêm `scripts/adas-features-test.ts` và lệnh `npm test` chạy toàn bộ 15 bộ kiểm tra headless.

## Thay đổi giao thông Việt Nam trong giai đoạn này

Năm kịch bản mới được thêm vào `src/traffic/TrafficManager.ts` và tích hợp vào `src/sim/Simulation.ts`:

1. `motorcycle-weave`: xe máy luồn qua các làn theo chu kỳ kịch bản.
2. `bus-stop`: xe buýt dừng đón khách; thêm người đi bộ gần điểm dừng.
3. `traffic-jam`: hàng phương tiện dừng/di chuyển theo đợt, kèm xe máy ở hồ sơ Việt Nam.
4. `truck-breakdown`: xe tải bất động được đánh dấu cảnh báo.
5. `vietnam-rush`: mật độ phương tiện Việt Nam cao, người đi bộ cắt ngang và đèn giao thông.

Bảng tạo tình huống trực tiếp cũng có nút xe máy luồn làn và xe buýt dừng. Mô hình mới mở rộng actor và chuyển động kịch bản; không có nghĩa là mô phỏng đã tái tạo chính xác mọi thành phố, luật đường bộ hay tập quán lái xe Việt Nam.

## Kiểm tra đã chạy

- `npm run build`: thành công; Vite vẫn cảnh báo gói JavaScript minify vượt ngưỡng 500 kB.
- `npm test`: chạy 15 bộ kiểm tra headless qua `scripts/test.mjs` (esbuild bundle + Node), tất cả đạt.
- `scripts/smoke.ts`: 9 kịch bản nền, không ghi nhận va chạm xe/người đi bộ.
- `scripts/all-scenarios-smoke.ts`: cả 16 kịch bản được chạy theo hồ sơ giao thông phù hợp; không ghi nhận va chạm hoặc thời gian đi lệch đường.
- `scripts/vietnam-scenarios-test.ts`: kiểm tra cấu hình xe máy luồn làn, xe buýt, ùn tắc, xe tải hỏng và giờ cao điểm.
- `scripts/vietnam-scenario-smoke.ts`: chạy mỗi kịch bản mới 2.500 bước; không ghi nhận va chạm hoặc thời gian đi lệch đường.
- `scripts/adas-test.ts`: lái tay, ACC, giữ làn, FCW, AEB, điểm mù và tích hợp AEB.
- `scripts/adas-brake-test.ts`: giữ ga hết cỡ khi AEB phanh trước xe dừng, gồm 40 m/s trong trời quang và sương mù, cả với vật cản cô lập lẫn kịch bản xe chết máy có giao thông Việt Nam; không chạm xe phía trước/xe ở làn kế bên, đồng thời xác nhận xe dẫn đầu không lách làn chỉ vì xe ego áp sát.
- `scripts/adas-features-test.ts`: hỗ trợ chuyển làn với làn trống (đến làn đích, tự tắt xi nhan) và làn bị chiếm (giữ làn, báo bị chặn), TSR + ISA giới hạn tốc độ theo biển, LDW và cảm biến đỗ xe.
- `scripts/traffic-profile-test.ts`: thành phần hồ sơ quốc tế/Việt Nam và bố trí điểm mù xe máy.
- `scripts/scenario-lab-test.ts`: sự kiện xe dừng, xe nhập làn, người đi bộ và xe cắt ngang.
- `scripts/record-replay-test.ts`: ghi/phát lại ảnh chụp trạng thái và xuất JSON.
- `scripts/lights-test.ts`, `weather-test.ts`, `learn-test.ts`, `evo-test.ts`, `road-sign-test.ts`: kiểm tra đèn, thời tiết, học, tiến hóa và biển tốc độ.

Các kết quả trên là kiểm tra phần mềm trong cấu hình mô phỏng, không chứng minh an toàn thực địa.

## Việc còn lại

- Xây dựng mạng lưới đường và bản đồ riêng cho Việt Nam/quốc tế, luật ưu tiên, rẽ và giao thông nhiều giao lộ.
- Bổ sung mô hình hành vi phong phú hơn cho xe máy, xe buýt, ô tô, xe tải và người đi bộ dựa trên dữ liệu thực.
- Kết nối cảm biến hình ảnh/radar/lidar, hợp nhất cảm biến và mô hình xe được hiệu chuẩn.
- Biên tập tình huống tự do, nhập phiên, phát lại xác định lại, tối ưu gói và đánh giá giao diện trên điện thoại.
- Nâng chất lượng tài sản 3D và âm thanh; tăng độ chân thực theo dữ liệu tham chiếu thay vì coi hình dựng thủ tục là tài sản thực.

## Rủi ro và giới hạn repository

- Bản dựng báo cảnh báo kích thước một chunk trên 500 kB; chưa chia nhỏ gói.
- `npm ci` trong đợt kiểm tra trước báo 6 advisory (2 mức vừa, 4 mức cao); chưa nâng phiên bản dependency.
- Checkout hiện không có thư mục `.git`, nên không thể tạo Git diff hoặc commit tại workspace này.
