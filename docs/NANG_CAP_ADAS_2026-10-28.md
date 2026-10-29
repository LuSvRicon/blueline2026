# Nâng cấp ADAS và kiểm thử — 28/10/2026

## Phạm vi và kiến trúc

Đã sửa trực tiếp dự án TypeScript/Vite/Three.js hiện có, không đổi sang React hoặc viết lại planner, mô hình xe, traffic, Kalman, âm thanh và ghi/phát lại. Bản sao trước đợt sửa nằm ở `backups/2026-10-28-adas-expansion/`. Báo cáo chẩn đoán trước sửa vẫn được giữ tại `RASOAT_LOI_ADAS_2026-10-28.md`.

| Module | Trách nhiệm sau đợt sửa |
| --- | --- |
| `src/sim/ADAS.ts` | ACC/SET/RES/CANCEL, giữ dừng, FCW/AEB, ALC dự báo 5 giây, LDW/LKA, TSR/ISA, trạng thái cảm biến/làn |
| `src/sim/ProximitySafety.ts` | Đo khoảng hở thân xe trước/sau/hai bên; dự báo RCTA; phát hiện vật cản đứng yên cho Rear AEB, tính theo hướng thân xe |
| `src/sim/ExtendedAssistance.ts` | Mô hình BCA, ELK, PMC, FDA, SEA, HBA và cảnh báo tài xế với đầu vào giả lập |
| `src/sim/ParkingAssist.ts` | Quét ô đã kẻ, kiểm tra quỹ đạo, điều khiển đỗ qua động học xe, APA và RPA giữ để chạy |
| `src/sim/Simulation.ts` | Phân quyền lệnh lái/phanh, PRND/đề máy/EPB, khóa cửa, lỗi cảm biến, tích hợp mô hình và snapshot phát lại |
| `src/render/ParkingView.ts` | Ô đỗ và quỹ đạo tiến/lùi lấy trực tiếp từ dữ liệu điều khiển đỗ |
| `src/ui/ADASPanel.ts` | Ba trang Hệ thống / Đỗ xe / Thử nghiệm, điều khiển ACC, công tắc riêng, yêu cầu mở cửa |
| `src/render/CarFleet.ts`, `CockpitInstruments.ts`, `src/ui/HUD.ts` | Đèn pha/cốt thực trong cảnh 3D, đèn gương SEA/BSM, trạng thái can thiệp trên đồng hồ và HUD |
| `src/audio/SimulationAudio.ts` | Điểm phát âm thanh cảnh báo tài xế, FDA, cảm biến đỗ xe cùng các cảnh báo cũ |

## Lỗi đã sửa

- FCW/AEB: cùng một tập vật cản cho cùng quyết định khi đảo thứ tự mảng. Mỗi nguy cơ được đánh giá độc lập; ACC vẫn chọn mục tiêu gần nhất.
- AEB: không còn báo phanh khẩn cấp 100% khi khởi tạo với hai xe đứng yên cách nhau 5,35 m. Có trạng thái giữ dừng sau sự kiện phanh, tách khỏi cảnh báo đang phanh khẩn cấp. AEB hủy ACC để tránh tự tăng tốc lại khi nhả ga sau tình huống khẩn cấp.
- RCTA: trái/phải thống nhất với gương BSM, góc nhìn người lái và dữ liệu tình huống cắt ngang. Vật thể đang đi ra xa vùng lùi không bị báo như thể đang lao vào.
- Rear AEB: có kiểm tra vật cản phía sau đứng yên; không còn dùng riêng bộ lọc chuyển động cắt ngang để quyết định mọi tình huống phanh sau.
- ALC: nhường thao tác lái hoặc phanh của người dùng; hủy không tự tái kích hoạt với xi-nhan cũ. Hết thời gian được báo hủy, không báo hoàn tất. Kiểm tra xe trước/sau và xe máy chuyển động ngang trong cửa sổ 5 giây, có kiểm tra lại trong quá trình chuyển làn. Tâm tham chiếu chuyển dần trong 3,6 giây theo đường cong bậc năm, tránh lệnh đánh lái đột ngột sang tâm làn bên cạnh.
- LDW: không cảnh báo phía người lái đang chủ động bật xi-nhan; xi-nhan phía đối diện không che cảnh báo lệch làn.
- Cảm biến: không lấy dữ liệu chuẩn thay thế khi danh sách track rỗng. Track mới không bị loại chỉ vì đã có track khác được xác nhận. Lỗi cảm biến và mất vạch làn có trạng thái không khả dụng/yêu cầu tiếp quản.
- Lực phanh: thanh áp suất tính cả lệnh giảm tốc ACC/ISA và các can thiệp mới, không chỉ AEB.
- Đỗ xe: nhả nút/mất tín hiệu sẽ phanh; người lái đạp phanh/ga hoặc đánh lái sẽ hủy. Phát lại không tiếp tục chạy bộ đỗ nếu không có quỹ đạo. Ô đỗ hợp lệ không bị tính là đi ra khỏi đường.
- Nút giữ APA/RPA nhận focus đúng để có thể giữ Enter, tránh việc Enter vô tình kích hoạt lại nút quét ô trước đó.

## Bổ sung logic đang hoạt động trong mô hình

| Hệ thống | Hành vi đã triển khai | Giới hạn cần hiểu đúng |
| --- | --- | --- |
| ACC | SET lấy tốc độ hiện tại; RES phục hồi tốc độ đặt; HỦY, đạp phanh, AEB hoặc lỗi cảm biến hủy ga tự động. Sau giữ dừng trên 3 giây cần RES. | Một chính sách mô phỏng cụ thể; không đại diện mọi hãng xe. |
| LKA/LDW | Ngừng hỗ trợ/cảnh báo dựa trên vạch khi chất lượng làn thấp. | Chất lượng làn là đầu vào phòng thí nghiệm, chưa đo từ ảnh. |
| ISA | Giới hạn cả ga thủ công trong chế độ ADAS dù ACC tắt; ga hết hành trình tạm vượt ISA, AEB vẫn ưu tiên. | Biển lấy từ dữ liệu thế giới, chưa OCR. Chưa có haptic trên bàn đạp vật lý. |
| USS / Rear AEB | Khoảng hở trước, sau, trái, phải; cảnh báo khoảng cách trên camera và nhịp bíp theo khoảng cách. Phanh khi lùi vào vật cản đứng yên/cắt ngang. | Phạm vi hình học lý tưởng, không mô phỏng sóng siêu âm. Công tắc Rear AEB riêng, vẫn phụ thuộc công tắc AEB chính. |
| BCA | Hỗ trợ lái hạn chế vào trong khi có nguy cơ điểm mù và người lái đang đánh lái về phía đó; lái mạnh của người dùng vẫn được ưu tiên. | Mô hình cơ bản; không phải bộ điều khiển tránh va chạm mọi tình huống. |
| ELK | Can thiệp lái giới hạn khi dự báo vượt mép đường, có vạch/cảm biến hợp lệ. | Chưa mô phỏng lề đường/vỉa hè/đối tượng cạnh đường từ ảnh. |
| PMC | Ngắt ga và phanh khi đạp ga lớn ở tốc độ thấp, có vật cản sát hướng D/R. | Quy tắc ngưỡng mô phỏng, chưa phân loại ý định tài xế. |
| FDA | Nhắc khi xe trước đã khởi hành sau khi xe chủ đứng chờ. | Liên kết mục tiêu bằng vị trí/vận tốc, chưa có ID nhận diện xe đầu ổn định qua che khuất dài. |
| SEA | Cảnh báo xe áp sát bên cửa; chặn yêu cầu mở cửa nguy hiểm. Cửa mở khóa chọn D/R. Đèn gương dùng trạng thái SEA cùng BSM. | Cửa mở hiện là trạng thái và liên động truyền động; chưa có hoạt ảnh cánh cửa 3D. |
| HBA | Tự bật pha khi chạy ban đêm trên đường trống sau thời gian xác nhận; hạ cốt ngay khi có xe trước/đối diện, trời mưa/sương mù hoặc giảm tốc. Thay đổi spotlight thật trong cảnh. | Giao thông được biết qua đối tượng cảm biến, chưa phát hiện đèn xe bằng camera. |
| DAW / giám sát tài xế | Đầu vào giả lập: mất tập trung, bỏ tay, mệt mỏi; cảnh báo, yêu cầu tiếp quản, giảm tốc có giữ phanh sau dừng khi tiếp tục mất tập trung. | **Chưa có DMS nhận diện mắt/khuôn mặt hoặc đo lực tay thật.** Checkbox ghi rõ đây là đầu vào thử nghiệm. |
| APA | Tìm ô song song đã kẻ còn trống; kiểm tra đường vào, giới hạn cong và thân xe; tự tiến D, phanh, chuyển R, đánh lái lùi vào ô; hoàn thành ở P/EPB. | Bãi tập/đoạn đường có độ cong nhỏ; chưa tự tìm mọi khoảng trống không kẻ, chưa đỗ vuông góc/chéo/chỗ rất chật hoặc nhiều lần tiến-lùi. |
| RPA | Tiến/lùi thẳng tối đa 6 m, khởi động từ P khi cần, giữ để chạy; nhả nút/mất heartbeat 0,3 giây phanh; kết thúc P/EPB. | Điều khiển từ xa **giả lập bằng UI**, chưa có app chìa khóa/điện thoại độc lập hoặc giao thức kết nối xe thật. |

APA/RPA dùng `Vehicle.step()` và hệ thống va chạm chung, không gán thẳng tọa độ xe tới ô. Khi xuất hiện vật cản trên đường đi, mất cảm biến hoặc người dùng giành điều khiển, lượt đỗ bị hủy và phanh dừng.

## Cách thử

1. Mở ứng dụng, chọn **Hỗ trợ ADAS**. Nhấn **Cài đặt hỗ trợ** ở cụm điều khiển dưới màn hình.
2. Trang **Hệ thống**: bật/tắt từng chức năng. SET/RES/HỦY nằm ngay trên cụm điều khiển. Đạp phanh xong cần RES để phục hồi ACC.
3. Trang **Đỗ xe**: **Mở bãi tập đỗ** bắt đầu phiên mới và chuyển xe sang khu vực có ô đánh dấu. Sau đó **Quét ô đỗ phù hợp**, giữ nút APA/RPA để chạy. Có thể giữ Enter khi nút được chọn; Space/S vẫn là phanh chân.
4. Thử **Chuẩn bị RPA tiến/lùi**, giữ chạy rồi nhả để xác nhận xe phanh. Hủy đỗ sẽ đưa xe về P sau khi dừng.
5. Trang **Thử nghiệm**: bật lỗi cảm biến/mất vạch hoặc trạng thái tài xế giả lập. Khi hết lỗi cảm biến, phải RES để phục hồi ACC; không tự tiếp tục lượt đỗ đã hủy.
6. Để thử RCTA, dùng tình huống xe máy cắt ngang khi lùi hoặc thêm xe cắt ngang từ trái/phải trong bảng tình huống. Để mở cửa, dừng và chọn P.

## Kiểm thử

- Build TypeScript + Vite đạt qua các đợt tích hợp. Có cảnh báo kích thước chunk Three.js khoảng 510 kB; chưa tối ưu thêm tải GPU/kích thước tải xuống.
- Toàn bộ **26 suite** đạt trong lượt kiểm thử tổng hợp (195,7 giây), bao gồm planner, traffic, mạng học, neuroevolution, động học/va chạm, UI input, camera/cabin và ghi/phát lại.
- Sau các chỉnh sửa tiếp theo, đã chạy lại các nhóm liên quan và ma trận **120 lượt chạy xác định**, mỗi lượt 20 giây: 20 tình huống × 2 bộ điều khiển × 3 thời tiết. Không ghi nhận va chạm xe chủ hoặc đi khỏi đường trong ma trận này.
- Ba suite hồi quy mới: `adas-regression-test`, `extended-adas-test`, `parking-assist-test` được đăng ký vào `npm test`.
- Lượt chốt sau thay đổi ISA/điều khiển/UI: build đạt và 12 suite liên quan đạt (54,1 giây). Sau chỉnh cuối làm mượt ALC và tắt cảm biến đỗ khi ở P, build và 7 suite chịu ảnh hưởng tiếp tục đạt (2,8 giây); có phép thử kiểm tra ALC không giật lệnh lái ngay khi bắt đầu.
- APA: 3 bản đồ × 2 nguồn đầu vào (dữ liệu chuẩn và cảm biến), hoàn tất bằng động học xe; sai lệch tâm khoảng **0,20–0,21 m**, 0 va chạm trong các ca này. Kiểm tra đủ D/R, P/EPB, vô-lăng thực sự đổi góc, không bị chấm lỗi ra khỏi đường.
- Kiểm tra RPA tiến và lùi, khởi động từ P, dừng khi mất heartbeat, phục hồi khi giữ lại, trở về P; kiểm tra APA dừng khi có vật cản mới, mất cảm biến và tiếp tục sau phát lại không còn quỹ đạo.
- Trình duyệt thật: APA hoàn tất bằng nút giữ, RPA chạy/dừng và hoàn tất bằng Enter; cảnh báo mất cảm biến xuất hiện trên đồng hồ và cụm ADAS. Kiểm tra bố cục 1280×720, 1024×768 và xem giao diện ở 390×844. Màn hình điện thoại vẫn có chữ rất nhỏ; chưa được xem là trải nghiệm lái tối ưu cho điện thoại.
- Không ghi nhận lỗi/warning console trong lượt kiểm tra trình duyệt. Các điểm gắn âm thanh đã được nối, nhưng **chưa có đánh giá nghe âm thanh thực hoặc đo FPS/GPU trên nhiều thiết bị**.

Ảnh đã lưu: `media/adas-sensor-fault-2026-10-28.jpg` (yêu cầu tiếp quản), `media/adas-upgrade-2026-10-28.jpg` (cụm đỗ xe sau lượt thử RPA). Ảnh không thay thế kiểm thử động lực học.

## Phần còn thiếu / chưa được khẳng định

- Nhận diện từ camera thật, mô hình sai số radar/LiDAR vật lý, độ tin cậy/fault toàn bộ ECU và cơ cấu chấp hành.
- DMS sinh trắc học thực, hoạt ảnh cửa, quỹ đạo đỗ mọi kiểu/ô không kẻ/chỗ chật; app RPA độc lập.
- Camera 360 ghép bốn camera với méo ảnh, hiệu chỉnh và vùng che khuất vật lý vẫn chưa triển khai; hiện là camera dựng cảnh 3D có hướng dẫn động và cảnh báo thật từ mô phỏng.
- ALC dự báo vận tốc không đổi, chưa dự đoán ý định mọi người tham gia giao thông; hủy giữa làn vẫn cần tài xế tiếp quản.
- Chưa có mô hình tai nạn/biến dạng xe, va chạm NPC–NPC đầy đủ, thử nghiệm phần cứng hoặc chứng nhận an toàn theo một mẫu xe thương mại.
- Không có bảo đảm AEB tránh được mọi va chạm nếu vật cản xuất hiện quá gần hoặc tốc độ/quãng đường phanh vượt giới hạn vật lý. Cơ chế xử lý va chạm vẫn hoạt động độc lập; không dùng kết quả 0 va chạm của các ca kiểm thử để tuyên bố an toàn tuyệt đối.

Đây là các **mô hình ADAS mô phỏng**, chưa phải hệ thống được kiểm định trên xe thật. Các chức năng đã thêm vẫn có điều kiện hoạt động và giới hạn nêu trên; không tuyên bố đã hoàn tất mọi ADAS hay giống đời thực 100%.
