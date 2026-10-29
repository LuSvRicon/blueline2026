# Kiểm thử tổng thể BlueLine — 28/10/2026

## Kết quả thực tế

- Chạy đủ 35 nhóm có sẵn bằng `npm test`, bao gồm điều khiển, ADAS, đỗ xe APA/RPA, cảm biến, giao thông Việt Nam, cabin, tài nguyên GLB, đèn đỏ, thời tiết, ghi/phát lại, học mô phỏng và tiến hóa mạng nơ-ron. Lượt đầu: 34 PASS, 1 FAIL (smoke, đoàn xe tải không giữ tình huống vượt).
- Sửa đoàn xe tải thử nghiệm giữ làn; chạy lại smoke: PASS, AI có chuyển làn vượt, không va chạm hay ra khỏi đường trong lượt thử. Không đổi hành vi MOBIL của các xe tải giao thông thông thường.
- Chạy lại `scenario-matrix-test` và `view-quality-test` sau sửa: PASS. Chạy lại `learn-test` do bài học có tình huống xe tải: PASS, mạng chạy đường thường và đoàn xe tải không va chạm trong bài thử. Bài tiến hóa mạng đã PASS trong lượt đầy đủ; không huấn luyện lại không cần thiết.
- Bổ sung nhóm thứ 36 `network-matrix-test`: PASS, 690 tổ hợp hợp lệ (7 bản đồ × các tình huống được hỗ trợ × AI/ADAS × quang/mưa/sương), 20 giây mô phỏng/tổ hợp, seed 20261028. Kiểm tra trạng thái hữu hạn, số va chạm xe người lái và thời gian ra khỏi đường bằng 0.
- Build TypeScript/Vite: PASS. Còn cảnh báo dung lượng Three.js core khoảng 552 kB; đây không phải lỗi chạy.

## Sửa và tối ưu

1. Đoàn xe tải trong bài thử có cooldown đổi làn dài, để tình huống yêu cầu người lái AI vượt xe không biến mất do xe tải tự đổi làn.
2. Camera 360° dựng ảnh phụ tối đa 30 lần/giây, ngừng dựng cảnh phụ khi người dùng thu gọn camera. Tần số vật lý, cảm biến và khung hình chính được giữ nguyên. Chưa có số đo GPU trước/sau để tuyên bố mức tăng FPS.
3. Camera nổi trên màn hình hẹp giảm còn 150 px, vùng ảnh cao 88 px; nút chọn góc vẫn dùng được. Đo DOM trên 390×844 xác nhận chiều rộng camera 150 px và không tràn ngang.

## Kiểm tra trình duyệt

- Cabin Civic: thấy gương trái, phải và gương giữa có cảnh phía sau.
- Giữ W: xe tăng tốc lên khoảng 25 km/h; giữ S: xe về 0 km/h.
- Đổi cả VF9, Santa Fe, Everest, Civic qua nút chọn: mỗi mẫu đều báo đã tải.
- Chọn lần lượt camera trước, sau, trái, phải, 360°: nút tương ứng active.
- Chọn P, tắt động cơ, thử D: bị từ chối đúng khóa khởi động. Nổ máy, chọn R: camera sau tự active; có lời nhắc nhả phanh đỗ. Đưa về D và nhả phanh đỗ sau kiểm tra.
- Menu chuyển sang cao tốc, quốc lộ, đường hai chiều, khu dân cư; xác nhận URL và tên bản đồ sau điều hướng. Các bản đồ cũ được kiểm tra bằng nhóm bản đồ và ma trận 690 lượt.
- Kích thước 390×844, 768×1024, 1280×720, 1920×1080: quan sát/đo DOM; không tràn ngang, các nút PRND/động cơ/phanh đỗ vẫn có vùng hiển thị. Khôi phục kích thước trình duyệt sau thử.
- Nhật ký trình duyệt tại các lần đọc không có error; lần đọc cảnh cabin và năm camera cũng không có warn.

## Giới hạn kiểm chứng

Đây là kiểm thử có phạm vi xác định, không phải bằng chứng mọi tổ hợp đầu vào đều đúng. 690 lượt có thời lượng 20 giây, không thay thế chạy đường dài với nhiều seed, lái tùy ý hay kiểm tra mọi tương tác vật lý. Các nhóm chạy dài hơn nằm riêng trong bộ test (AEB, đường, mật độ giao thông).

Chưa đo FPS chuẩn theo GPU/điện thoại, chưa cầm tay cầm thật, chưa nghe và đánh giá chất lượng âm thanh bằng tai. Gamepad được kiểm tra bằng đầu vào mô phỏng; âm thanh chưa được kiểm chứng trọn vẹn. Chưa kiểm định mọi va chạm giữa các NPC với nhau. Nhà/cây/công trình chưa có vật lý va chạm đầy đủ, container vẫn là thân cứng, bản đồ là vòng đường phẳng. Chất lượng cabin/nhân vật/nhà phố vẫn phụ thuộc mô hình nguồn; chưa đạt mức đồ họa game AAA.

ADAS vẫn là mô hình mô phỏng, chưa phải hệ thống xe thật đã kiểm định. Chưa có cơ sở gọi ứng dụng hoàn hảo hoặc đảm bảo không xảy ra lỗi mới.

