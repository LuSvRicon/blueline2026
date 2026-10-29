# Sửa AEB và cải thiện góc nhìn — 28/10/2026

## Lỗi AEB tái hiện được

Tạo hai xe cùng chạy 25 m/s, khoảng cách cản 28 m; xe trước phanh 8 m/s². Bản cũ va chạm trong cả bốn trường hợp: bật/tắt nhiễu cảm biến × giữ/không giữ ga. Sau va chạm, bộ xử lý tiếp xúc dừng xe ở khoảng 0,13–0,15 m, nên ảnh sau đó có thể hiển thị tốc độ 0 và áp suất phanh 0. Dừng do xử lý va chạm không phải AEB dừng an toàn.

Nguyên nhân tìm thấy: quãng phanh chỉ dựa trên bình phương chênh lệch tốc độ, ngầm giả định xe trước giữ nguyên vận tốc. Nó bỏ sót việc xe trước tiếp tục giảm tốc. Nhánh TTC 2 giây trước đây tăng cảnh báo nhưng chưa trực tiếp kích hoạt AEB. Latch phanh cũng bị xóa khi người lái không đạp ga.

## Sửa logic

- Xét cả quãng dừng xe mình và quãng dừng dự kiến của xe trước, dùng giới hạn phanh 8 m/s² của mô hình giao thông. Chừa khoảng dự phòng theo tốc độ, độ bám đường và sai số cảm biến.
- TTC dưới ngưỡng phanh trực tiếp có thể kích hoạt AEB. Khi người lái chưa phanh, áp dụng yêu cầu phanh đầy đủ; khi phanh thiếu, tính lực bổ sung theo quãng dừng còn lại.
- Giữ áp suất phanh khi đã dừng trước vật cản, kể cả khi nhả rồi đạp lại ga. AEB vẫn hoạt động sau khi ACC đã hủy. Khi xe trước đi và có khoảng trống, trạng thái giữ được nhả; ACC cần được người lái phục hồi.
- Thêm nút tình huống **Xe trước phanh gấp**: xe trước đi cùng tốc độ, giữ làn, phanh 8 m/s² sau một giây. Đây là chuyển động có tích phân theo thời gian, không đặt vận tốc về 0 tức thì.
- Sự kiện **Xe dừng phía trước** chừa khoảng khởi tạo theo tốc độ và mặt đường, tránh tạo một bài thử không còn đủ quãng phanh ngay từ đầu.
- Ẩn dải quỹ đạo của bộ lập kế hoạch khi AEB đang phanh/giữ dừng để không hiển thị nhầm ý định vòng qua vật cản. Tách nhóm hiển thị quỹ đạo để công tắc tắt/bật không bị vòng cập nhật ghi đè.

## Camera, gương và hình ảnh

- Camera bám xe từ 16 m/cao 8,5 m xuống 8,5 m/cao 3,5 m. Bù dịch chuyển xe để tốc độ cao không làm camera bị tụt xa thêm.
- Góc cabin mặc định 120°, có căn hướng riêng cho Civic/Santa Fe và nút **Căn góc nhìn để thấy cả hai gương bên**. Giữ khả năng tự chỉnh FOV; góc hẹp do người dùng lưu trước đó vẫn có thể cắt gương phải.
- Dùng camera 3D riêng cho gương trái/phải/giữa, ống kính riêng và ảnh đảo ngang. Đặt camera bên ngoài thân xe để không bị cabin che; tránh dựng gương lồng nhau và giới hạn lượt dựng phụ 30 Hz. Đây là cách dựng gương trong game, chưa mô phỏng quang học gương cầu chính xác.
- Khử răng cưa MSAA trên render target của chuỗi hậu xử lý: Cân bằng 2 mẫu, Chi tiết cao 4 mẫu nếu WebGL2 hỗ trợ. Chế độ tiết kiệm tắt phần này và bóng đổ.
- Bổ sung bóng đổ mặt đường/xe/nhà, chỉnh ánh sáng và bloom ban ngày; kính cửa sổ nhà dùng vật liệu phản ứng ánh sáng, tách phát sáng ban đêm thay vì cộng sáng cả ban ngày. Tăng chi tiết hạt mặt đường.
- Civic xuất lại từ GLB gốc với tỷ lệ giữ lưới .75, sai số .0002, giới hạn texture 2048; dung lượng 4.011.096 byte. Texture màu nội thất gốc thực tế chỉ 512×512, không phóng lớn rồi gọi là texture độ nét cao. Nguồn và giấy phép giữ trong ATTRIBUTION.json.

## Kết quả kiểm tra

`npm run build` đạt; cảnh báo chunk Three.js 549 kB vẫn còn.

21 bài kiểm tra được chọn đạt, bao gồm ADAS, phanh, giữ khoảng cách, ADAS mở rộng, APA/RPA, điều khiển bàn phím, va chạm, ghi/phát lại, thời tiết, mô hình xe, cabin, gương và camera. `scenario-matrix-test` chạy 120 lượt 20 giây (20 tình huống × 2 bộ điều khiển × 3 thời tiết).

`aeb-following-test` kiểm tra thêm tám tổ hợp ACC đang bật/đã hủy × cảm biến lý tưởng/có nhiễu × giữ/không giữ ga. Sau sửa: 0 va chạm, khoảng cách nhỏ nhất 2,55 m. Hai ca dùng chính sự kiện xe trước phanh gấp ở trời quang/mưa dừng cách 2,67/2,72 m, giữ phanh 100%, vẫn dừng khi nhả/đạp lại ga; đi tiếp được khi xe trước rời đi và nhấn phục hồi ACC. Hai lượt chạy 5 phút, giao thông Việt Nam/quốc tế với mức giữ cách 1 giây, không ghi nhận va chạm.

Kiểm tra trực tiếp đúng `127.0.0.1:5174`: góc bám gần, cabin ban ngày/ban đêm, đủ ba gương; thử tình huống Xe chết máy trong Hỗ trợ ADAS, giữ W. Bản cuối dừng 0 km/h, cảm biến đọc khoảng 3,2 m, ADAS giữ phanh 100%, bảng thống kê 0 va chạm. Giá trị cảm biến có nhiễu nên không xem đây là phép đo hình học chính xác.

Ảnh: [AEB dừng và giữ phanh](media/aeb-dung-giu-phanh-2026-10-28.jpg), [camera bám gần](media/camera-bam-gan-2026-10-28.jpg), [cabin đủ gương](media/cabin-ba-guong-2026-10-28.jpg), [ban đêm](media/cabin-guong-dem-2026-10-28.jpg).

## Giới hạn

Các kiểm tra trên không chứng minh mọi tình huống đều tránh được va chạm. Vật cản xuất hiện trong quãng đường không còn đủ để phanh, cảm biến hỏng hoặc các xe khác chủ động đâm vào vẫn có giới hạn vật lý/mô hình. ADAS là mô phỏng, chưa được kiểm định trên xe thật. Nhà cửa vẫn là tài nguyên thủ tục; độ chi tiết cabin phụ thuộc tệp gốc, chưa đạt mức đồ họa game AAA. Chưa đo hiệu năng chuẩn trên nhiều cấu hình GPU.
