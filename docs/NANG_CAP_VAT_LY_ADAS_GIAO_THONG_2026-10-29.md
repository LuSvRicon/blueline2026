# Nâng cấp vật lý, ADAS và giao thông — 29/10/2026

Đợt triển khai này nâng cấp ba nhóm trên nền mã hiện có. Giữ bộ lập kế hoạch, IDM/MOBIL, các xe/cabin và chức năng giao diện; không thay toàn bộ dự án. Đây chưa phải mô hình động lực học xe thật hoàn chỉnh.

## 1. Vật lý xe

- Manual, ADAS, AI cổ điển và các policy trong Simulation đều chạy qua giới hạn độ bám kết hợp phanh/đánh lái; ADAS/AI không còn được bỏ qua giới hạn như trước.
- Bánh lái có tốc độ thay đổi tối đa 1,2 rad/s trong mô hình có độ bám, thay cho đổi góc tức thời.
- Giới hạn gia tốc dọc không vượt lực bám; loại bỏ phần lực ngang tối thiểu giả khi ngân sách độ bám đã hết.
- Bổ sung ước lượng tỷ lệ tải cầu trước và trạng thái roll/pitch có đáp ứng theo thời gian; lưu/khôi phục cùng phiên ghi. Các trạng thái này hiện phục vụ mô hình/kiểm thử, chưa gắn thêm hiệu ứng nghiêng thân xe vào mesh.
- Chặn đầu vào không hữu hạn hoặc bước thời gian không hợp lệ làm hỏng trạng thái Vehicle.

Giới hạn: vẫn là bicycle có giới hạn lực bám, chưa có vận tốc trượt ngang độc lập, lốp Pacejka, mô hình treo nhiều bậc tự do, khớp rơ-moóc hoặc cấu hình động lực học đã hiệu chỉnh cho từng xe. Ước lượng tải cầu chưa phải bộ giải lực từng lốp.

## 2. ADAS

- Giữ hệ thống giảm tốc trước cua và đưa nó vào thử tích hợp với Vehicle thực sự giới hạn lực bám.
- Cảnh báo giới hạn giữ làn xét cả trạng thái bão hòa độ bám thực của Vehicle.
- BSM xét xe làn bên đang lao lên từ phía sau theo thời gian tiếp cận dưới 4,5 giây, tối đa 100 m trong dữ liệu cảm biến nhận được; không tự tăng tầm cảm biến vật lý. Xe đang đi xa không tạo cảnh báo tiếp cận sớm này.
- Khi AEB đã bắt đầu, mất track ngắn hạn không tự hủy lần dừng đang thực hiện. Giữ dừng và nhả khi điều kiện an toàn/thao tác người lái phù hợp; lỗi cảm biến tường minh vẫn đi qua nhánh suy giảm hiện có.

Giới hạn: chưa thay cảm biến bằng mô phỏng quang học/radar đầy đủ, chưa hiệu chỉnh theo ECU hay hệ thống xe thương mại. APA/RPA và các trợ giúp khác được giữ và hồi quy, không công bố đã viết lại hoặc nâng thành hệ thống xe thật trong đợt này.

## 3. Giao thông và người đi bộ

- Người đi bộ thông thường dự đoán thời điểm đi vào từng hành lang xe, thay cho chỉ xét một khoảng thời gian cố định chung cho cả đường.
- Người đã bắt đầu sang đường biết dừng trước hành lang bị xe chiếm, vận tốc cảm biến và hoạt ảnh đi bộ dừng tương ứng; tiếp tục khi khoảng trống mở ra.
- Xe đứng yên tại chỗ sang đường được xét như vật cản. Tình huống lao ra có chủ ý vẫn tách bằng trigger để kiểm tra phản ứng khẩn cấp.
- NPC dự đoán người đang đi vào làn tại thời điểm xe đến; tầm xét phía trước tăng theo khoảng phanh.
- NPC cùng chiều và ngược chiều có tốc độ mục tiêu theo độ cong làn và độ bám khô/ướt, có xem trước khoảng phanh. Cache hình học vô hiệu hóa khi đổi mặt đường, tốc độ đặt, vị trí/làn hoặc tốc độ đủ lớn để tránh tính lại toàn bộ ở mỗi frame.
- Dữ liệu xe người lái gửi vào bộ đi bộ dùng vận tốc có dấu khi lùi.

Giới hạn: chưa có mạng đi bộ toàn phố, tái lập ý định người thật, cứu hộ NPC sau tai nạn, đường có cao độ hay hành trình liên kết nhiều tuyến. Xe NPC vẫn là mô hình Frenet/IDM, không dùng cùng bộ giải lốp với ego.

## Kiểm thử và thay đổi kỳ vọng cũ

- `handling-traffic-test` mới kiểm tra lực bám chung, giới hạn tốc độ bánh lái, đáp ứng tải khi phanh, ACC vào cua khô/ướt, đi bộ chờ/tiếp tục, BSM tiếp cận, NPC qua cua trong mưa và AEB không bỏ dở khi mất track.
- Bài tích hợp ACC đặt 140 km/h, chạy 65 giây từ trạng thái nghỉ trên phố đô thị: sai số làn tối đa khoảng 0,035 m ở trời quang và mưa trong fixture không có giao thông; ACC tự giảm tốc qua cua. Không phải phép thử giữ nguyên 140 km/h trong cua.
- Bài test cũ yêu cầu xe giữ khoảng 150 km/h quanh cua đô thị gắt được bỏ khỏi kỳ vọng tích hợp vật lý. Các phép so sánh điều khiển động học riêng vẫn giữ và ghi rõ chế độ. Cao tốc/vành đai vẫn có thử tích hợp tốc độ cao.
- Bài phanh độc lập chuyển vị trí xuất phát sang đoạn thẳng, để kiểm tra khoảng dừng và AEB thay vì đồng thời yêu cầu bám một cua đã vượt khả năng bám ở frame đầu.
- Bài va chạm người đi bộ ép trigger tiếp tục kiểm tra phản ứng tiếp xúc; bài riêng kiểm tra người thường biết nhường trước khi va chạm.
- Các lỗi phát hiện trong lượt hồi quy đầu được giữ trong log ban đầu; xem log cuối để đánh giá bản bàn giao. Có sửa thiếu import của tối ưu cache và chạy lại các bài liên quan sau đó.

Kết quả: lượt đầy đủ **44/44 nhóm đạt**, 801,3 giây, gồm ma trận **690 tổ hợp hợp lệ**, **120 lượt tình huống**, học mạng và tiến hóa AI. Sau đồng bộ hoạt ảnh người đang nhường đường và sửa dấu phản ứng tải khi phanh lùi, các bài render/handling/replay tương ứng cũng đạt. Build/typecheck cuối đạt; còn cảnh báo Three.js core khoảng 552 kB.

Kiểm tra trình duyệt trong mưa: ACC dừng phía sau giao thông nền, khoảng cách đọc được 3,5–3,7 m, xe người lái 0 va chạm; lần đọc console không có error/warn. Đây là một phiên cụ thể, không chứng minh toàn bộ NPC không có tai nạn. Ảnh: [rain-stop.jpg](handling-2026-10-29/rain-stop.jpg).

AI học máy vẫn là chế độ thử nghiệm, giữ lớp bảo vệ/giới hạn đường cũ và cần hiệu chỉnh tiếp với mô hình mới; kết quả học đạt assertion không phải chứng minh mọi thân xe luôn cách lề đủ rộng. Chưa đo FPS/GPU trên nhiều thiết bị.

Log: [full-suite-final.log](handling-2026-10-29/full-suite-final.log), [targeted-final.log](handling-2026-10-29/targeted-final.log), [chassis-final.log](handling-2026-10-29/chassis-final.log), [cache-final.log](handling-2026-10-29/cache-final.log), [build.log](handling-2026-10-29/build.log).

Bản sao trước sửa: `backups/2026-10-29-handling/`.
