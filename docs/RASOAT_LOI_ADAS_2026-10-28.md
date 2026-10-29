# Rà soát lỗi và phần thiếu của ADAS — 28/10/2026

Đây là lượt đánh giá theo yêu cầu tóm tắt của người dùng. Chỉ đọc mã và chạy các phép thử chẩn đoán trong bộ nhớ; **chưa sửa logic ADAS** trong lượt này. Các kết quả kiểm thử đạt ở các lượt trước không bao quát những ca dưới đây.

## Lỗi/hành vi chưa hợp lý đã tái hiện

### 1. FCW/AEB phụ thuộc thứ tự vật cản

Cho xe chủ chạy 20 m/s. Cùng làn có xe gần ở +25 m, chạy 20 m/s, và xe xa ở +50 m, đứng yên. Cùng đầu vào hình học/vận tốc, chỉ đổi thứ tự mảng vật cản:

| Thứ tự | Khoảng cách lead được chọn | FCW | AEB |
| --- | --- | --- | --- |
| Xe xa rồi xe gần | 20,35 m | true | true |
| Xe gần rồi xe xa | 20,35 m | false | false |

Trong `ADASController.update`, việc chọn lead và cộng dồn cảnh báo/phanh diễn ra trong cùng vòng lặp. Khi thay lead, các cờ cảnh báo đã bật từ vật cản trước không được tính lại. Đảo thứ tự danh sách không nên thay đổi kết quả với cùng cảnh vật. Cần định nghĩa rõ thuật toán chọn mục tiêu/đánh giá đa vật cản, rồi tính quyết định nhất quán.

### 2. RCTA đảo trái/phải so với BSM và góc nhìn lái

Đặt vật thể ở s = egoS − 5 m, d = egoD + 3 m, chuyển động ngang −1 m/s. Phép chiếu hiện có xác nhận vật thể ở bên phải tài xế.

- BSM: trái false, phải true.
- RCTA: trái true, phải false.

Trong `Simulation.rearCrossTraffic`, dấu lateral đang ánh xạ ngược với quy ước hiển thị/BSM. Điều này có thể đưa cảnh báo sang sai bên.

### 3. ALC đang hoạt động không nhường lệnh đánh lái của người dùng

Cho ALC kích hoạt vào làn trống. Hai lần gọi bộ điều khiển với cùng trạng thái xe, một lần input.steer = −1, một lần = +1:

- Trạng thái ALC: active.
- Lệnh lái đầu ra của cả hai: 0,497159313 rad.

Nhánh `alcActive ? correction : ...` bỏ qua thao tác lái người dùng khi ALC active. Chưa có cơ chế phát hiện người dùng giành lại điều khiển để hủy/nhường hỗ trợ. Đây là thiếu sót trong thiết kế ưu tiên điều khiển, không phải lỗi bàn phím không nhận phím.

### 4. LDW vẫn cảnh báo phía đang bật xi nhan

Tắt ALC; đặt xe lệch phải bằng 45% bề rộng làn, bật xi nhan phải. LDW vẫn báo `right`. Logic LDW hiện không xét xi nhan để phân biệt chuyển làn có chủ ý với chệch làn ngoài ý muốn.

### 5. AEB chưa tách rõ phanh khẩn cấp và giữ xe đã dừng

Khởi tạo bộ điều khiển mới, xe chủ và xe trước đều đứng yên, khoảng cách bumper 5,35 m, không ga/phanh: AEB báo true và lực ADAS = 1 (100%). Ngưỡng khoảng cách cứng 6 m kích hoạt ngay cả khi không có tốc độ áp sát. Cần phân biệt trạng thái giữ dừng với cảnh báo đang phanh khẩn cấp; không loại bỏ khả năng giữ phanh sau một lần AEB thực sự.

## Khoảng trống logic xác định qua mã

- **ALC:** kiểm tra khoảng cách tĩnh, chưa đánh giá nguy cơ trong toàn bộ 3–5 giây chuyển làn theo tốc độ xe áp sát. Khi đang chuyển, nhánh hủy sớm chỉ xét một vùng trước xe và chỉ trong giai đoạn đầu. Hết 9 giây cũng đặt `alcComplete` dù xe chưa đạt làn đích; timeout cần có trạng thái thất bại riêng.
- **Rear AEB với vật cản đứng yên:** ca thử vật thể ở −4 m, cùng d, v = vd = 0 cho active false và rearAeb false. Lọc chỉ giữ vật thể cắt ngang là phù hợp cho RCTA nhưng chưa đủ cho một hệ thống phanh tự động phía sau tổng quát.
- **LKA/LDW:** biết sẵn đường/làn từ ReferencePath, chưa có chất lượng nhận diện vạch hoặc trạng thái mất khả năng khi vạch mờ/không nhìn thấy.
- **ACC:** có bám xe/điều khiển tốc độ, nhưng chưa có đầy đủ cơ chế SET/RES/CANCEL và kích hoạt lại theo một mẫu xe tham chiếu.
- **TSR/ISA/đèn giao thông:** đọc thông tin biển/đèn trong thế giới mô phỏng, chưa nhận dạng từ ảnh.
- **Cảm biến:** có nhiễu, rơi mẫu và Kalman, nhưng khi không còn track, `Simulation.obstacles()` lấy ground truth thay thế; chưa có trạng thái mất cảm biến/xuống cấp tương ứng.
- **PARK:** mới khoảng cách phía trước ở tốc độ thấp. Tên “Hỗ trợ đỗ xe” dễ gây hiểu nhầm thành tự đỗ; chưa có APA.
- **Camera 360°:** hiển thị cảnh 3D thực đang chạy, nhưng chưa mô phỏng ghép bốn camera vật lý, méo ảnh và sai số hiệu chỉnh.

## Chưa triển khai

- APA: tìm ô đỗ, lập quỹ đạo và phối hợp D/R, lái, ga, phanh.
- RPA: điều khiển đỗ từ xa, nút giữ và dừng khi nhả/mất kết nối.
- DOA/SEA: cảnh báo/hỗ trợ mở cửa an toàn.
- DAW/DMS: giám sát mệt mỏi, mất tập trung và trạng thái người lái.
- AHB/HBA: tự chuyển chiếu xa/gần theo giao thông.
- FDA/LCDN: nhắc xe trước khởi hành.
- BCA/ELK: can thiệp tránh va chạm điểm mù/giữ làn khẩn cấp chuyên biệt.
- Cảm biến đỗ xe đầy đủ trước/sau/hông và phanh khi đỗ với vật cản đứng yên phía sau.
- PMC chuyên biệt: kiểm soát đạp nhầm ga; không đồng nhất với việc AEB hiện có đè lệnh ga khi nguy hiểm.
- Cơ chế giám sát người lái, yêu cầu tiếp quản và xử lý mất cảm biến đầy đủ.

## Giới hạn kết luận

Các phép thử trên kiểm tra quyết định bộ điều khiển và cách ánh xạ hướng; không khẳng định mọi ca đều đã gây tai nạn trong cảnh 3D. Không có tỷ lệ “giống đời thật” được đo lường. Cần bổ sung các ca này thành kiểm thử hồi quy khi sửa. ADAS tiếp tục là mô hình mô phỏng, chưa phải hệ thống an toàn đã kiểm định trên xe thật.
