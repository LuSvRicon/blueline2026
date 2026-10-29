# Bảng điều khiển BlueLine — 28/10/2026

## Thay đổi

- Gom truyền động, đồng hồ vận hành, hỗ trợ lái, bàn đạp và camera thành một cụm nổi phía dưới. Dùng nền graphite, viền sáng nhẹ và phân cấp thông tin rõ hơn.
- PRND có mô tả tiếng Việt và đèn trạng thái. Nút động cơ/phanh đỗ có biểu tượng riêng, phản ánh trạng thái thực trong mô phỏng.
- Đồng hồ có vạch tốc độ, cung tốc độ, vòng tua, số và giới hạn tốc độ. Thanh vòng tua lấy dữ liệu thực của phiên mô phỏng.
- Khoảng cách xe trước nổi bật bằng màu vàng; giữ nguyên thước khoảng cách vàng trên radar. Tốc độ ACC, SET/RES/HỦY và chọn cự ly nằm cạnh radar.
- Bàn đạp có mặt kim loại/rãnh cao su dựng bằng CSS, phản hồi thao tác và lực phanh người lái/ADAS. Vô-lăng nhỏ xoay theo đầu vào lái.
- Camera 360° nằm trong cụm dưới ở desktop; còn nút đổi góc, thu gọn và tự mở góc sau khi chọn R. Ở màn hình nhỏ, camera vẫn có thể thu gọn riêng.
- Ngăn hệ thống ADAS vẫn mở/đóng độc lập. Bổ sung ngữ nghĩa switch, nhãn truy cập và điều khiển bàn phím cho các tab.
- Sửa lỗi chồng nút ACC ở màn hình hẹp, mặt bàn đạp bị chật và khung ADAS còn hiện trong chế độ Gọn HUD.

## Phạm vi mã nguồn

Các component được giữ lại và cập nhật: `CockpitLayout.ts`, `HUD.ts`, `ADASPanel.ts`, `CenterConsoleControls.ts`, `PedalControls.ts`. Ba stylesheet mới được import sau `game.css`: `dashboard-controls.css`, `dashboard-adas.css`, `dashboard.css`.

Không thay đổi thuật toán điều khiển xe, cảm biến, va chạm hay bộ điều khiển ADAS trong đợt thiết kế này. Các số liệu hiển thị vẫn gắn với trạng thái mô phỏng hiện có.

## Đã kiểm tra

Build production: `npm run build` — đạt.

Lệnh kiểm thử:

```text
node scripts/test.mjs drive-input-test driver-feedback-test driving-systems-test record-replay-test cockpit-view-test
```

Cả 5 nhóm đạt: bàn phím/nguồn điều khiển, đèn/xi nhan/ACC/cự ly/hủy bằng phanh, PRND/EPB/AEB/RCTA/va chạm, camera cabin và ghi/phát lại. Đây là kiểm thử tự động phù hợp với thay đổi UI, không phải chứng nhận mọi hành vi của toàn bộ mô phỏng.

Kiểm tra trực tiếp trên trình duyệt:

- Bố cục 1920×1080 và 1280×720; các ngưỡng hẹp 870×720, 840×720 và 390×844. Đã kiểm tra góc bám xe và cabin.
- Đổi tốc độ ACC thành 72 km/h, cự ly thành 2,0 s; HỦY, RES và giữ bàn đạp phanh để hủy ACC.
- Chọn R sau khi thu gọn camera: màn hình tự mở lại góc sau.
- P tự giữ phanh đỗ; tắt/đề máy; thử đổi số khi máy tắt bị từ chối; chuyển N/D hoạt động.
- Chuyển Manual/ADAS/AI; điều khiển truyền động và bàn đạp bị vô hiệu hóa khi AI điều khiển.
- Mở/đóng ngăn ADAS; Gọn HUD chỉ còn đồng hồ nhỏ sau khi sửa xung đột CSS.
- Thêm xe dừng bằng công cụ tình huống, quan sát số đo vàng và thước radar cập nhật theo xe phía trước.

Ảnh thực tế: `media/dashboard-redesign-2026-10-28.jpg`, `media/dashboard-cabin-2026-10-28.jpg`.

## Giới hạn còn lại

- Vite vẫn cảnh báo chunk Three.js khoảng 510 kB; build thành công.
- Màn hình điện thoại dọc có ít không gian quan sát hơn desktop do các điều khiển phải xếp nhiều hàng; có thể thu gọn camera hoặc HUD. Chưa kiểm tra đầy đủ mọi kích thước màn hình và thao tác cảm ứng trên thiết bị thật.
- Lượt này hoàn thiện bảng điều khiển. Chất lượng hình học/vật liệu cabin, môi trường và phương tiện vẫn phụ thuộc mô hình 3D hiện có.
- Các ADAS tiếp tục là mô hình học/thử tình huống; không phải hệ thống an toàn được kiểm định trên xe thật. Chưa tái kiểm thử mọi tổ hợp kịch bản AI/ADAS trong đợt UI này.
