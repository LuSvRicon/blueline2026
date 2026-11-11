# Rà soát ADAS BlueLine — 08/11/2026

## Phạm vi và kết quả

Đã đọc luồng cảm biến → tracker → ADAS → hỗ trợ mở rộng → đỗ xe/dừng khẩn cấp → cơ cấu phanh → vật lý/va chạm, kiểm tra 24 công tắc ADAS qua giao diện, và bổ sung kiểm thử hồi quy cho lỗi xác nhận được. Giữ các bộ điều khiển, planner, vật lý, cảm biến và giao diện hiện có; không viết lại dự án.

- Build sản phẩm đạt, kiểm tra TypeScript đạt. Còn cảnh báo kích thước bundle trên 510 kB.
- Bản sửa chốt đã chạy lại **30 nhóm kiểm tra liên quan, đều đạt**, 362,8 giây; xem `final-adas.log`.
- Lượt kiểm tra toàn dự án được bắt đầu trước khi sửa và tiếp tục trong đợt rà soát; kết quả tổng hợp ghi trong `full-suite.log`. Các nhóm liên quan đến mã đã sửa được chạy lại sau khi chốt mã như trên. Không coi đây là hai lần chạy toàn bộ cùng một snapshot.
- Lượt toàn dự án ban đầu đạt **59/60 nhóm**, riêng `learn-test` báo sai tiêu chí mốc loss. Ma trận gồm **690** tổ hợp bản đồ/tình huống/chế độ/thời tiết, mỗi lượt 20 giây mô phỏng; giao thông nền 6 lượt 300 giây; kiểm tra phối hợp ADAS **28 lượt × 60 giây** và 9 tình huống phối hợp chủ động đều đạt.
- Các kiểm tra mới được đăng ký vào `npm test`; danh sách hiện có 64 nhóm.
- Sau sửa cách đo, `learn-test` chạy lại **đạt**, 88 giây (`learn-retest.log`). Như vậy 64 nhóm khác nhau đã được kiểm tra trong đợt này; không tuyên bố có một lượt duy nhất 64/64 trên cùng snapshot. Lượt toàn dự án ban đầu và mọi kết quả chạy lại đều được giữ nguyên.
- Kiểm tra trực tiếp bằng trình duyệt trên bản build cục bộ, gồm kích thước mặc định 870 × 768 và điện thoại ngang 844 × 390. Chưa thử trên phần cứng Android/iPhone thật.
- Theo yêu cầu tiếp theo, đã xuất bản bản build này lên [BlueLine Cloudflare](https://blueline2026.pages.dev/) ngày 08/11/2026, deployment `5ac785c5-96eb-4a43-a17a-a6408b3288ce`. Đã xác nhận trang công khai tải đúng `index-RMQM1OaV.js`, khởi động không lỗi và lượt thử AEB giữ ga dừng cách khoảng 6,5 m, 0 va chạm. Xem `DEPLOYMENT.md` và `live-deployment.jpg`. Mã nguồn chưa được commit/đồng bộ GitHub.

## Các lỗi đã xác nhận và sửa

| Lỗi | Hành vi sau sửa | Bằng chứng |
| --- | --- | --- |
| AEB xoay hai lần kích thước đã chiếu theo đường, bỏ sót đuôi xe buýt/container cắt ngang | Đánh dấu rõ kích thước theo thân xe hoặc theo trục đường; dự báo giữ đủ phần thân đang chiếm làn | Tái hiện trước sửa thất bại; hai luồng ground-truth chẩn đoán và sensor/tracker qua phanh/vật lý đạt, không va chạm trong ca tránh được |
| Track đã ngoại suy tới hiện tại nhưng AEB cộng thêm độ trễ đo | `latencyCompensated` giữ dữ liệu độ trễ để chẩn đoán, tránh ngoại suy lần hai; đầu vào đo thô vẫn được bù một lần | Đầu vào hiện tại có metadata trễ cho kết quả như đầu vào mới; đầu vào thô vẫn được ngoại suy |
| AEB hoàn tất dừng với ngưỡng 12 m nhưng HOLD chỉ giữ dưới 9,5 m | Giữ đúng mục tiêu gây dừng trong khoảng ngưỡng đã dùng; nhả khi xe đó rời hành lang hoặc người lái tiếp quản bằng phanh | Các khoảng 9,6 / 10,5 / 11,8 m với ga giữ liên tục, và kiểm tra nhả khi làn trống |
| Ước lượng khả năng phanh có sàn 1,2 m/s², quá lạc quan trên mặt đường trơn xuống dốc | Chỉ giữ sàn số học 0,05 m/s²; không giả thêm khả năng bám đường | 16 tổ hợp hệ số bám/dốc đối chiếu với mô hình vật lý; trường hợp μ=0,2 và dốc −0,1 rad đạt khoảng 0,42 m/s² |
| BSM/BCA/SEA chỉ xét tâm xe, bỏ sót xe dài đang sát bên | Xét cả phần thân theo chiều dài, giữ kiểm tra xe từ sau lao lên | Xe buýt/container hai phía, xe đi xa, xe chưa xác nhận, xe đang bị vượt |
| Né tự động ESA tiếp tục khi mất radar sau/ESC hoặc tắt hỗ trợ làn | Hủy mục tiêu né khi mất điều kiện, giữ phanh đang yêu cầu | Kiểm tra mất điều kiện giữa thao tác, không chỉ kiểm tra lúc bắt đầu |
| Sau hủy ESA, LFA vẫn giữ làn mục tiêu cũ | Giải phóng quyền điều khiển làn ở cả hai bộ điều khiển, neo lại làn xe thực sự đang chiếm; bảo toàn người lái tiếp quản | Kiểm tra tích hợp radar sau và ESC, kiểm tra lệnh lái sau hủy |
| ESA có thể giảm yêu cầu phanh chân khi AEB tắt | Sau mọi bộ điều khiển, yêu cầu phanh không thấp hơn phanh chân. Độ bám/vòng tròn ma sát vẫn giới hạn lực thực tế | AEB tắt, người lái phanh 60%, ESA hoạt động: lệnh yêu cầu vẫn đủ 60%; bỏ bản sửa thì ca này thất bại |
| TSR/ISA quên giới hạn sau khi đi qua biển | Ghi nhớ giới hạn tới biển thay thế, tắt TSR hoặc reset; tạm mất camera đình chỉ đầu ra nhưng giữ bộ nhớ | Kiểm tra mất tầm nhìn, thay biển, lỗi camera/phục hồi, tắt/bật, reset, ghi/phát lại |
| Chọn biển phụ thuộc thứ tự phần tử trong dữ liệu | Chọn biển gần nhất làm mốc cố định trước khi so sánh các biển cùng vùng | Sáu hoán vị cùng một cảnh cho cùng kết quả |
| ISA vẫn cấp ga ngay tại giới hạn rồi phanh sau khi vượt, gây dao động | Giảm êm yêu cầu truyền động khi tiến gần giới hạn; phanh xử lý quá tốc độ; giữ kickdown/chỉ cảnh báo/đề xuất | Giữ ga một phần 10 giây, không vượt 50,1 km/h với biển 50 trong ca đường phẳng; kickdown và các chế độ khác đạt |
| Cụm cần số hiển thị Rear AEB thành AEB chung | Ưu tiên thông báo phanh phía sau khi Rear AEB can thiệp | Kiểm tra UI tự động và quan sát trực tiếp |

## Bản đồ chức năng đã rà

| Hệ thống hiện có | Module chính | Kiểm tra |
| --- | --- | --- |
| ACC, Stop & Go, giữ khoảng cách, SET/RES/HỦY, CSA | `sim/ADAS.ts`, `AssistancePolicy.ts`, `Simulation.ts` | Phanh chân hủy ACC, nhả phanh không tự bật lại, ga vượt tạm thời/nhả ga, các mức giữ cách, xe trước phanh gấp, cua khô/mưa |
| FCW, AEB, hỗ trợ phanh chân, HOLD | `sim/AEB.ts`, `ADAS.ts`, `vehicle/Vehicle.ts` | Thứ tự vật thể, xe dừng/đang chạy/cắt ngang, người đi bộ, đường trơn, actuator, giới hạn vật lý, lỗi/mất track, bộ điều khiển phối hợp |
| LFA/LKA/LDW, ALC và vào/ra làn khẩn cấp | `sim/ADAS.ts`, `control/Stanley.ts`, `vehicle/Signals.ts` | 92 ca ALC tốc độ/hướng/độ bám/cua, 96 cặp xi-nhan lặp, miền hoạt động, tiếp quản, xe lao lên từ sau; thêm 32 lượt ALC với bốn cấu hình xe, khô/mưa, hai hướng, ban đầu 30/130 km/h |
| BSM, BCA, ELK, ESA, SEA | `sim/ADAS.ts`, `ExtendedAssistance.ts`, `Simulation.ts` | Thân xe dài, cảnh báo/can thiệp hai phía, mở cửa, mất điều kiện giữa thao tác, quyền điều khiển giữa các bộ hỗ trợ |
| TSR/ISA, TLA | `sim/ADAS.ts`, `Simulation.ts`, `world/RoadSign.ts`, `TrafficLight.ts` | Ghi nhớ/thay biển, tính xác định, giới hạn/chỉ cảnh báo/đề xuất, kickdown, đèn đỏ/vàng/xanh và chế độ xác nhận |
| USS, RCTA, Rear AEB, PMC | `sim/ProximitySafety.ts`, `Simulation.ts`, `ExtendedAssistance.ts` | Hai hướng cắt ngang, vật cản cố định, xe rời xa, miền RCTA dưới 8 km/h, phanh lùi độc lập công tắc cảnh báo, giữ ga, cảm biến lỗi |
| APA và RPA | `sim/ParkingAssist.ts`, `Simulation.ts` | Đỗ song song/vuông góc cho bốn cấu hình xe: 8 lượt hoàn tất, sai lệch dưới 0,35 m, P + EPB, không va chạm; nhả nút/watchdog, vật cản đột nhập, hủy/lỗi cảm biến/cửa; RPA tiến/lùi trong bộ đỗ xe có sẵn |
| FDA, DAW/DMS, EDSS/MRB, HBA | `sim/ExtendedAssistance.ts`, `EmergencyPullOver.ts` | Xe trước khởi hành; tài xế không phản hồi/tiếp quản; tấp lề, làn bị chắn, fallback dừng trong làn, P/EPB/hazard; pha/cốt và hysteresis |
| Camera 360°, cảnh báo, âm thanh và điều khiển | `ui/ADASPanel.ts`, `CenterConsoleControls.ts`, `render/ParkingView.ts`, `audio/SimulationAudio.ts` | 24 công tắc qua UI; số R tự bật camera lùi/RCTA; bàn đạp/phím, ghi/phát lại và các kiểm tra âm thanh sẵn có |

## Lái thử trực tiếp

1. Cao tốc / xe chết máy / ADAS: giữ W 8 giây, quan sát AEB dừng và giữ phanh. Bản build cuối hiển thị 0 km/h, khoảng 3,4 m, ADAS 100%, người lái 0%, bộ đếm 0 va chạm. Ảnh `browser-aeb-hold-final.jpg`.
2. Đạp Space tiếp quản: HOLD kết thúc, ACC vẫn ở trạng thái đã hủy; nhả phanh không tự bật ACC.
3. Chọn R, nhả EPB: camera tự về góc lùi, cảnh báo cắt ngang trái hiện đúng. Thêm xe cắt ngang sau từ trái qua công cụ tình huống và tiếp tục giữ ga: quan sát thông báo Rear AEB trên cluster, camera và cụm cần số, tốc độ 0.
4. Thử lùi nhanh: giao diện báo RCTA chỉ sẵn sàng dưới 8 km/h; không đánh đồng miền cảnh báo với mở rộng phanh vật cản khi lùi của BlueLine.
5. 844 × 390: camera lùi, bảng ADAS và bàn đạp vẫn truy cập được, không tràn ngang. Bật/tắt rồi phục hồi từng công tắc: **24/24 đạt**, lưu `browser-toggles.json`.
6. Bãi tập APA: quét ô phù hợp, giữ Enter trên nút chạy để xe thực sự di chuyển, nhả nút: trạng thái phanh/tạm ngừng và tốc độ 0. Tám lượt đỗ hoàn tất được kiểm chứng bằng bộ kiểm tra vật lý; không tuyên bố đã lái tay tám lượt đó trên trình duyệt.
7. Console trình duyệt không có lỗi được công cụ ghi nhận trong phiên kiểm tra, `browser-errors.json` là danh sách rỗng.

## Giới hạn còn tồn tại

- Đây là cấu hình hỗ trợ lái tổng hợp của BlueLine, không phải ECU hay bản hiệu chuẩn chính hãng VF9/Hyundai/Ford/Honda. Bốn cấu hình động lực hiện có vẫn dùng kích thước va chạm được chuẩn hóa trong dự án; chưa phải digital twin từng xe.
- Mục tiêu xuất hiện quá muộn hoặc ngoài tầm/góc cảm biến khi chạy nhanh qua cua, đặc biệt trời mưa và tắt CSA, có thể chỉ được giảm mức va chạm. Ví dụ có ca 90 km/h, khoảng trống 11 m: AEB giảm tốc độ va chạm từ khoảng 78,2 xuống 64,8 km/h. Không dùng ca đó để tuyên bố tránh va chạm hoàn toàn.
- ALC mọi dải tốc độ và vào/ra làn khẩn cấp là lựa chọn mô phỏng theo yêu cầu người dùng. Chức năng tương tự trên xe thật có miền hoạt động khác nhau.
- Thời gian giữ dừng AEB của BlueLine là chính sách riêng. Không khẳng định giống thời gian giữ khoảng hai giây trong ví dụ tài liệu Kia.
- Cảm biến dùng đối tượng/thông tin thế giới mô phỏng, có mô hình phạm vi/nhiễu/che khuất. TSR chưa đọc biển bằng xử lý ảnh. Độ trễ cảm biến hiện chủ yếu là metadata; đã sửa ngoại suy hai lần, chưa xây hàng đợi mẫu đo trễ vật lý. Cơ cấu phanh có độ trễ riêng.
- DMS/DAW dùng trạng thái tài xế được đưa vào bài thử, không nhận dạng mắt hay chẩn đoán đột quỵ. EDSS có thông tin bản đồ/định vị lý tưởng; khi không đủ điều kiện sẽ dừng trong làn.
- ESC hiện có cờ khả dụng để điều kiện hóa ADAS và mô hình độ bám/ABS, chưa có bộ điều khiển ổn định yaw ESC đầy đủ. TCS, Hill Assist và HDC chưa có module riêng.
- Camera 360° là hình dựng cảnh 3D, chưa phải ghép ảnh từ camera thật. Chưa kiểm tra trên điện thoại thật hoặc thiết bị vô-lăng/bàn đạp vật lý.
- Bộ kiểm tra hữu hạn không chứng minh hết mọi tình huống giao thông, mọi hạt giống, tốc độ, thiết bị hoặc tương đương an toàn xe thật.
- Hộp bao vật thể theo trục đường vẫn mang tính bảo thủ với xe đứng chéo; việc sửa hợp đồng kích thước chưa thay thế bằng nhận dạng hình dạng 3D đầy đủ từ cảm biến.

## Sửa bài đo huấn luyện AI phát hiện trong lượt toàn dự án

`learn-test` so sai số cuối với giá trị của epoch đầu, nhưng giá trị đó được đo trong khi mô hình đã học qua hàng trăm lần cập nhật. Đây không phải sai số của mạng chưa học. Bài kiểm tra nay chụp một tập con cố định từ các ví dụ expert và đo trực tiếp trước/sau huấn luyện; giữ yêu cầu giảm ít nhất 40% như ngưỡng gốc, giữ mọi ví dụ huấn luyện, giữ nguyên các kiểm tra xe thật sự chạy highway/trucks. Không thay thuật toán học hoặc mô hình sản phẩm. Tập mẫu này lấy từ dữ liệu huấn luyện, không phải tập holdout độc lập.

Phép đối chứng vô hiệu hóa cập nhật trọng số vẫn bị đánh trượt: sai số 0,0917 → 0,0917. Khi học thật, phép đo cố định đạt 0,0917 → 0,0288 (giảm khoảng 68,6%). Bài kiểm tra chạy lại đạt, 88 giây; sau DAgger, xe đi 0,85 km trên highway và 0,70 km trong đoàn xe tải, đều 0 va chạm trong lượt kiểm tra. Kết quả được lưu riêng tại `learn-retest.log` để giữ nguyên dấu vết lỗi ban đầu, không xóa hoặc sửa log thất bại.

## Nguồn đối chiếu hành vi

- [NHTSA — Driver Assistance Technologies](https://www.nhtsa.gov/vehicle-safety/driver-assistance-technologies): phân biệt cảnh báo với can thiệp, ACC, giữ làn, RCTA và các dạng AEB.
- [Kia — Forward Collision-Avoidance Assist operation](https://www.kia.com/content/dam/kia2/in/en/content/manuals/topics/chapter6_1_2.html): một ví dụ công bố về các mức cảnh báo/phanh, miền tốc độ, kết thúc giữ phanh và giới hạn. Không áp dụng nguyên thông số mẫu xe này cho mọi xe.
- [Volvo — Pilot Assist conditions and limitations](https://www.volvocars.com/us/support/car/v60-cross-country/article/54f1934e3fd57300c0a8b0c1194a56be-69b1d5f35a03429ac0a8b0970ac5ed2e-8664b2fa77a7e089c0a8296870d1a409/): trách nhiệm tiếp quản, giới hạn cảm biến/làn và dừng khi tài xế không phản hồi.

Các nguồn hỗ trợ đối chiếu hành vi quan sát được. Không nguồn nào xác nhận thuật toán hoặc các ngưỡng nội bộ của BlueLine là mã điều khiển của hãng.
