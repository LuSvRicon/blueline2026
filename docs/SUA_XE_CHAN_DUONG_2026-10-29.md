# Sửa xe nền nằm chéo, gây kẹt đường — 29/10/2026

## Nguyên nhân đã tái hiện

Trong cảnh phố Việt Nam mặc định 48 NPC, bài thử mới bắt được va chạm xe buýt–xe máy sau 1,80 giây. Xe dài dùng dịch ngang mũ về làn đích, có thể quay góc 0,5 rad rất nhanh, kể cả khi chạy chậm. Thân xe quét sang xe bên cạnh. Khi xảy ra va chạm, hệ thống dừng/đánh dấu hỏng các actor và giữ nguyên tư thế, tạo vật cản nằm chéo đường giống loại lỗi trong ảnh.

Một lỗi liên quan: khi đã cam kết sang làn đích, xe chỉ xét xe dẫn đầu ở làn đích dù thân vẫn còn ở làn xuất phát; nhiều xe đang cùng nhập làn cũng chưa được xét đầy đủ trong cổng an toàn.

Lượt kiểm tra trước xác nhận xe người lái dừng an toàn trước hàng xe nhưng chưa sửa nguyên nhân gây hàng xe đó. Đếm 0 va chạm của ego không đủ để kết luận giao thông nền đúng.

## Đã sửa

- Giới hạn dịch ngang theo tốc độ tiến và góc chuyển làn riêng cho xe dài, ô tô và xe máy. Xe đứng yên không tự trượt ngang; xe dài không quay thân gắt như trước.
- Xét xe dẫn đầu của cả các làn thân xe còn đang chiếm, thay vì chỉ làn đích.
- Cổng chuyển làn xét cả xe khác đang hướng tới cùng làn.
- Kiểm tra quét toàn thân có hướng trước bước dịch ngang, đối chiếu chuyển động của NPC gần đó. Hoãn bước dịch ngang nếu không đủ khoảng trống; vẫn dùng kiểm tra va chạm thực cho các tiếp xúc/các tình huống ép va chạm.
- Giữ phanh/ACC khi phía trước thực sự có vật cản; không vô hiệu hóa va chạm, không xóa hoặc dịch xe bị đâm để giả vờ đường thông.

## Kiểm thử

- `traffic-flow-test` mới: đã FAIL trước sửa; sau sửa chạy 3 seed (20261028, 1, 9) × quang/mưa, 48 NPC, 300 giây/lượt. Cả 6 lượt không có va chạm nền; NPC đi trung bình 3.253–3.615 m/lượt. Có assertion quãng đường để tránh PASS giả do toàn bộ xe đứng im.
- Tám nhóm liên quan đạt: traffic flow, smoke, Vietnam scenarios, ADAS brake, AEB following, ADAS runtime audit, dynamics collision, record/replay. Lượt này không chạy lại toàn bộ 45 nhóm hiện có.
- Build/typecheck đạt, còn cảnh báo Three.js core khoảng 552 kB.
- Trình duyệt cổng 5174 đã chạy qua khoảng 0,60 km trong hơn một phút; đọc DOM thấy ego 0 va chạm, giao thông nền 0 va chạm, không có warn/error console tại lần kiểm tra. Cả cổng 5173 và 5174 đều phục vụ source có bản sửa.

Log: [regression.log](traffic-blockage-2026-10-29/regression.log), [flow-final.log](traffic-blockage-2026-10-29/flow-final.log). Ảnh: [after-flow.jpg](traffic-blockage-2026-10-29/after-flow.jpg).

## Giới hạn

Bản sửa ngăn nguyên nhân đổi làn sai trong các trường hợp đã kiểm thử, không bảo đảm mọi NPC trong mọi tình huống đều không tai nạn. Xe thực sự đã bị đánh dấu hỏng trong phiên cũ vẫn là vật cản; tải lại/đặt lại tình huống để bắt đầu với trạng thái sạch. Chưa có hệ thống cứu hộ tự động cho actor hỏng. ACC giữ dừng lâu vẫn yêu cầu RES theo quy tắc hiện có; RES không cho phép đi xuyên vật cản.
