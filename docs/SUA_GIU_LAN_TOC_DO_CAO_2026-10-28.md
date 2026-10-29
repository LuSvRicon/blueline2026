# Sửa giữ làn ở tốc độ cao — 28/10/2026

## Tái hiện lỗi

Bài thử tách riêng vòng điều khiển vô-lăng, giữ nguyên tốc độ, không cho ACC, biển báo hay xử lý va chạm che lỗi bằng cách giảm tốc/dịch chuyển xe. Tại cua đô thị 140 km/h, bản cũ lệch tâm làn tối đa 0,971 m và thân xe vượt vạch. Ở 100 km/h, lệch tối đa 0,686 m. Trên đại lộ 140 km/h, sai số 0,609 m.

Nguyên nhân trong bộ ADAS: tham chiếu ở nửa chiều dài cơ sở không khớp điểm tích phân chuyển động tại tâm xe; không có góc lái bù độ cong rõ ràng; toàn bộ lệnh điều khiển lại bị nhân 0,7. Sai số tăng theo tốc độ và độ cong. Ngoài ra, lấy lại làn gần nhất ở mỗi bước có thể vô tình nhận làn bên cạnh làm mục tiêu khi xe bị đẩy qua vạch.

## Đã sửa

- Điều khiển theo sai số tâm xe và hướng tiếp tuyến; thêm góc lái bù độ cong làn, có tính độ lệch làn so với đường tham chiếu. Giữ hàm Stanley chung và bộ AI hiện có.
- Bỏ hệ số 0,7 làm suy yếu lệnh giữ làn. Người lái đánh lái vẫn tiếp quản ngay; chỉ tái nhận làn sau thời gian nhả điều khiển đang có.
- Giữ mục tiêu làn ổn định khi xe tự trôi lệch; cập nhật sau chuyển làn hỗ trợ hoàn tất hoặc người lái chủ động tiếp quản.
- ACC xem trước cua theo khoảng phanh, giảm tốc theo độ cong và độ bám khô/ướt. Không tự bật ACC đã hủy, không thay đổi tốc độ người dùng đã đặt. Khi ACC tắt hoặc người lái đạp ga vượt ACC, bộ giữ làn không tự chiếm chân phanh để ép tốc độ qua cua.
- Bảng ADAS và HUD giải thích tốc độ mục tiêu qua cua. Nếu tốc độ hiện tại vượt biên độ bám dự kiến, báo giảm tốc/tiếp quản và đổi trạng thái giữ làn sang cảnh báo.

## Kết quả kiểm thử

`scripts/high-speed-lane-test.ts` có các nhóm sau:

1. 15 lượt giữ tốc độ cố định: 5 bản đồ × 60/100/140 km/h, mỗi lượt 45 giây. Lệch ban đầu 0,35 m để thử khả năng thu hồi làn. Không thân xe nào vượt vạch. Sau 5 giây đầu, sai số lớn nhất ở 140 km/h là 0,132 m trên phố đô thị, 0,083 m trên đại lộ, 0,020 m trên vành đai, 0,024 m trên cao tốc, 0,048 m trên quốc lộ.
2. 18 lượt 140 km/h ở các làn 0/1/2 trên 3 bản đồ, bước tích phân 1/30 và 1/120 giây, thêm sai lệch hướng ban đầu. Không vượt vạch; sai số tối đa kể cả giai đoạn thu hồi làn 0,361 m.
3. 6 lượt ACC tiếp cận cua từ đoạn thẳng với tốc độ ban đầu 140 km/h: 3 bản đồ × hệ số bám 1,0/0,6. Bật giới hạn độ bám trong Vehicle cho bài thử này. Không bão hòa độ bám, sai số tối đa 0,029 m. ACC thực sự giảm tốc theo cua; không yêu cầu giữ nguyên 140 km/h qua cua đô thị.
4. Kiểm tra giữ mục tiêu làn sau nhiễu, nhường quyền cho người lái, nhận lại làn mới, mất vạch và cảnh báo tốc độ vượt giới hạn.
5. 3 lượt tích hợp Simulation, giữ ga ở tốc độ cao với ACC/ISA tắt, kiểm tra lệnh giữ làn thực sự đến Vehicle và không bị lớp điều khiển khác thay sai. Đây là phép thử mô hình động học, không chứng minh khả năng ôm cua của xe thật.

Các nhóm hồi quy đã đạt trong đợt sửa: `adas-test`, `adas-regression-test`, `extended-adas-test`, `adas-features-test`, `adas-brake-test`, `aeb-following-test`, `driving-systems-test`, `static-traffic-adas-test`, `driver-feedback-test`, `road-profiles-test`, `scenario-matrix-test`, `record-replay-test`, `lights-test`, `weather-test`. Ma trận gồm 120 lượt tình huống; không ghi nhận va chạm/ra khỏi đường của xe người lái trong phạm vi bài thử.

Build/typecheck bản cuối đạt. Vẫn có cảnh báo kích thước gói Three.js core khoảng 552 kB. Kiểm tra giao diện cao tốc: thay tốc độ đặt ACC thành 140 km/h, bảng ADAS và HUD hiển thị tốc độ mục tiêu qua cua theo hình học đường; số va chạm hiển thị 0, không ghi nhận lỗi/cảnh báo console trong phiên kiểm tra. Ảnh `docs/media/giu-lan-toc-do-cao-2026-10-28.jpg` chứng minh giao diện cảnh báo, không phải bằng chứng xe trong ảnh đang chạy 140 km/h; phép thử tốc độ cao nằm trong các bài tự động ở trên.

## Giới hạn

Đây vẫn là ADAS mô phỏng. Chưa thay mô hình động học ADAS/AI bằng mô hình lốp, treo và trượt ngang đầy đủ. Các phép thử giữ tốc độ cao trên cua gắt nhằm đo ổn định thuật toán; chúng không chứng minh xe thật có đủ lực bám để đi qua cua đó. Khi vào cua quá nhanh do người lái giữ ga hoặc không có đủ khoảng giảm tốc, cảnh báo tiếp quản không phải bảo đảm tránh mọi lần lệch làn.

Bản sao trước sửa: `backups/2026-10-28-high-speed-lane/ADAS.ts`.
