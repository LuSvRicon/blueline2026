# Nâng cấp vật lý, giao thông và ADAS — 28/10/2026

Đợt triển khai này giữ bốn xe người lái, cabin và các chức năng đang có. Đây là một bước nâng cấp cho ba nhóm yêu cầu, chưa phải hoàn thành mô phỏng xe thật.

## 1. Va chạm công trình

- Thêm `StaticWorld`: vật cản cố định dạng hộp xoay trên mặt phẳng, có lưới không gian để truy vấn vùng gần xe.
- Nhà cao tầng thủ tục, các cụm nhà ống Hà Nội, thân cây và ghế/trạm dừng đăng ký vật cản theo cùng vị trí, tỷ lệ và hướng của hình dựng.
- Cao tốc có vật cản liên tục cho dải phân cách và lan can, chia đoạn theo đường cong. Nhà thủ tục dùng seed cảnh quan cố định để hình học/vật cản tái lập khi tải lại.
- Xe người lái và xe nền dùng kiểm tra quét giữa vị trí cũ/mới với công trình. Khi tiếp xúc: dừng ở điểm tiếp xúc, sửa chồng lấn; không chỉ cắt tốc độ sau khi đã xuyên qua.
- Vật cản tĩnh đi qua cảm biến và tracker trong chế độ cảm biến. Chế độ đối chiếu ground truth nhận vật cản tĩnh riêng; khi cảm biến lỗi vẫn không tự thay bằng ground truth.
- Lan can song song ngoài hành lang xe chạy được lọc khỏi mục tiêu theo dõi xa; vật cản gần xe hoặc trong hành lang, và trường hợp người lái đang đánh lái, vẫn được xét. Va chạm vật lý không phụ thuộc bộ lọc này.

Giới hạn: hộp va chạm nhà ống đại diện cả cụm, chưa khớp từng ô cửa/sân trong; thân cây dùng tiết diện hộp nhỏ. Va chạm là mô hình mặt phẳng, dừng/separate thân cứng, chưa có phá hủy, lực va đập, leo lề hay treo bánh theo chiều cao. Vật cản GLB đăng ký khi tài nguyên đã tải và được đặt vào cảnh. Ẩn nhà trong lớp hiển thị không xóa vật cản vật lý.

## 2. Giao thông

- Giữ IDM/MOBIL; thêm điều kiện khoảng trống làn đích trong 4 giây cho đổi làn tự động, xét cả xe lao tới từ sau.
- Giữ các tình huống tạt đầu/luồn lách có chủ ý để thử ADAS, thay vì làm biến mất mọi nguy cơ bằng cách buộc NPC tránh xe người lái.
- Khoảng trống lúc sinh giao thông nền đủ cho xe tải dài, tránh xuất hiện chồng thân xe ngay từ đầu.
- Thêm xử lý va chạm quét giữa các xe nền. Nếu thật sự đụng nhau, xe bị dừng và đánh dấu hỏng; không âm thầm đi xuyên hoặc dịch sang làn khác để né.
- Dùng broad phase theo ô không gian, kiểm tra chi tiết theo thứ tự ổn định; chỉ xét các cặp có thể tiếp xúc.
- Số sự cố của xe nền lưu trong bản ghi/phát lại; có chú thích khi trỏ vào số va chạm trong bảng điểm. Không đánh đồng số này với va chạm xe người lái.

Giới hạn: chưa có phục hồi/cứu hộ tai nạn nền tự động; va chạm có thể tạo ùn tắc. Chưa có khớp đầu kéo/rơ-moóc, mô hình lốp Pacejka, trượt ngang hoặc chuyển tải trọng/treo chi tiết. Giữ mô hình bicycle và giới hạn độ bám đang dùng. Người đi bộ vẫn theo mô hình sang đường, chưa có AI đi bộ toàn mạng phố.

## 3. ADAS

- Giữ thuật toán TTC, nhu cầu khoảng dừng, bù lực phanh, ưu tiên chân phanh, hủy ACC và giữ dừng AEB.
- Khi người lái điều khiển vô-lăng hoặc tắt giữ làn, AEB xét hành lang thân xe dự đoán theo mô hình bicycle trong tọa độ thế giới. Tránh giả định xe luôn theo vạch đường trong khi người lái đang rẽ sang bên.
- Khi giữ làn, tiếp tục dùng hành lang Frenet đã được kiểm thử.
- Nhật ký AEB và chú thích cảnh báo hiển thị nguyên nhân: vật cắt vào đường chạy, thiếu khoảng cách dừng, hoặc giữ dừng trước vật cản.

Giới hạn: dự đoán giữ tốc độ/góc lái trong một khoảng thời gian hữu hạn; không phải thuật toán tái tạo mọi ý định của người lái. Bài thử có khoảng phanh đủ không chứng minh tránh được mọi tình huống tạt đầu bất khả thi. Đây vẫn là ADAS mô phỏng, chưa kiểm định trên xe thật.

## Kiểm tra

- Build và typecheck đạt. Vẫn có cảnh báo Three.js core khoảng 552 kB.
- Bài mới `static-traffic-adas-test`: xe tiến/lùi nhanh bị chặn bởi tường mỏng; AEB trước vật cản tĩnh trong trời quang/mưa với cảm biến và ground truth; hai NPC đổi chỗ qua nhau giữa hai bước bị chặn; phân biệt đánh lái vào và tránh vật cản; lưu/khôi phục số sự cố nền.
- Các bài AEB xe trước phanh gấp, AEB giữ ga, ADAS regression, PRND/RCTA, APA/RPA, va chạm động, cabin GLB và tài nguyên 3D đã được chạy lại trong đợt triển khai.
- Ma trận 690 tổ hợp hợp lệ, mỗi lượt 20 giây, đã đạt với mô hình va chạm mới trước các tối ưu broad phase/bộ lọc lan can.
- Sau tối ưu, build đạt và lượt hồi quy cuối đạt 8/8 nhóm trong 130 giây: `adas-regression-test`, `dynamics-collision-test`, `imported-cabin-test`, `view-quality-test`, `road-profiles-test`, `scenario-matrix-test`, `static-traffic-adas-test`, `record-replay-test`. Ma trận tình huống trong lượt này gồm 120 lượt chạy xác định, mỗi lượt 20 giây; không ghi nhận va chạm hoặc ra khỏi đường của xe người lái trong phạm vi bài thử. Chưa chạy lại toàn bộ 37 nhóm test trên phiên bản cuối.
- Các bài kiểm tra số va chạm xe người lái không đồng nghĩa mọi NPC đều không có tai nạn. Có bài riêng chủ động gây tiếp xúc để kiểm tra phản ứng vật lý.
- Kiểm tra trình duyệt với cảnh có xe đứng trước: xe dừng ở 0 km/h, khoảng cách hiển thị 3,7 m, chỉ số xe người lái là 0 va chạm, không có cảnh báo/lỗi console được ghi nhận trong phiên kiểm tra. Đây là bằng chứng dừng của ACC trong cảnh này; kiểm thử giữ ga/AEB nằm ở bài tự động riêng. Ảnh thực tế: `docs/media/vat-ly-adas-2026-10-28.jpg`.

Bản sao mã trước đợt nâng cấp: `backups/2026-10-28-physics-traffic-adas/src`.
