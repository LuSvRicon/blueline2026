# Chuyển nội thất Santa Fe và Civic — 28/10/2026

## Đã thay đổi

- Chế độ trong cabin của Hyundai Santa Fe 2023 và Honda Civic Type R 2023 dùng hình học nội thất trong chính GLB đã nhập. Không dựng lại toàn bộ cabin hoặc thay đổi bộ mô phỏng lái.
- Căn riêng vị trí mắt lái, tâm vô-lăng, cụm đồng hồ, màn hình trung tâm và ba mặt gương theo từng mẫu. Nâng/hạ ghế là độ lệch so với vị trí chuẩn của mẫu xe, thay cho nhãn chiều cao tuyệt đối gây hiểu nhầm.
- Tách các tam giác vô-lăng khỏi hình học tĩnh, giữ UV/material và nối góc quay với góc lái mô phỏng. Giới hạn trục và vùng tách là cấu hình thủ công theo hai tài nguyên này.
- Gắn đồng hồ tốc độ/số/trạng thái hỗ trợ và bản đồ từ canvas đang hoạt động vào cabin mới. Đây là màn hình BlueLine bổ sung, không tái tạo phần mềm hay giao diện nguyên bản của hãng.
- Gương phản chiếu cảnh 3D thật. Đèn BSM nằm trên mặt gương, dùng chung vật liệu được cập nhật từ sự kiện điểm mù đang có.
- Kính đổi vật liệu riêng trong lượt dựng cabin, khôi phục vật liệu ngoại thất khi dựng camera 360 hoặc góc nhìn ngoài xe. Giữ cabin chung làm dự phòng cho VF 9 và Everest.
- Giải phóng render target của gương khi đổi xe; không giải phóng nhầm vật liệu BSM dùng chung với cabin dự phòng. Hình học GLB dùng chung vẫn được giữ trong bộ nhớ đệm.

## Kiểm tra

`npm run build` đạt. Còn cảnh báo kích thước chunk Three.js khoảng 549 kB, không phải lỗi biên dịch.

Tám bài kiểm tra đạt:

- `dynamics-collision-test`
- `render-geometry-test`
- `detailed-vehicle-test`
- `imported-vehicles-test`
- `imported-cabin-test`
- `cockpit-view-test`
- `cabin-look-test`
- `drive-input-test`

Bài mới đọc cả hai GLB thật, kiểm tra vùng hình học vô-lăng, tầm nhìn ngang phía trước, màn hình và các mặt gương nhìn thấy từ mắt lái, mẫu điểm ở mép gương chiếu hậu, hướng phản xạ ra sau không bị thân xe che, vật liệu BSM và việc khôi phục kính cho camera ngoài xe. Bộ đọc kiểm thử giữ thuộc tính doubleSided/alphaMode của tài nguyên.

Kiểm tra trực tiếp tại localhost bằng trình duyệt, 1280 × 720, ban ngày: đổi Santa Fe/Civic, quan sát cabin, thử W tăng tốc và Space phanh về 0, thử nút đánh lái Santa Fe, chuyển cabin sang góc nhìn trên cao và trở lại, kiểm tra camera 360 đồng thời. Không coi các kiểm tra này là kiểm thử toàn bộ ADAS hoặc toàn bộ điều kiện thời tiết.

Ảnh thực tế: [Civic](media/civic-cabin-2026-10-28.jpg), [Santa Fe](media/santafe-cabin-2026-10-28.jpg).

## Giới hạn còn lại

- Nội thất Santa Fe trong tệp khá đơn giản và không có texture màu nội thất. Bổ sung màu vật liệu theo nhóm bề mặt để tránh cabin trắng; chưa có chi tiết/texture đạt mức mô hình game chất lượng cao.
- Gương và màn hình là phần bổ sung được căn thủ công; khung phản chiếu chưa phủ chính xác toàn bộ mặt gương cong nguyên bản. Chưa mô phỏng quang học gương lồi.
- Chưa có animation riêng cho cần số, bàn đạp vật lý và cần gạt mưa của hai tài nguyên. HUD PRND/bàn đạp vẫn hoạt động. Không hiển thị cabin thủ công cũ chồng lên nội thất mới để che các thiếu sót này.
- Động lực học và kích thước va chạm vẫn dùng cấu hình xe chung đã có. Chưa phải thông số hay hiệu chỉnh của xe thật.
- Chưa xác nhận nội thất Everest; VF 9 được ghi rõ không có nội thất. Hai mẫu này tiếp tục dùng cabin mô phỏng chung.
- Civic có giấy phép CC BY-NC-SA 4.0; nguồn và tác giả giữ trong màn hình giấy phép và `public/models/imported/ATTRIBUTION.json`. Những bổ sung này không thay đổi giới hạn phi thương mại của tài nguyên.
- ADAS tiếp tục là mô hình mô phỏng, không phải hệ thống đã kiểm định trên xe thật.
