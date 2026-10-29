# Rà soát mô phỏng và nâng cấp giao diện lái — 27/10/2026

## Phạm vi và kết quả

Rà soát luồng khởi động, bố cục HUD, điều khiển bàn phím/chạm/tay cầm, phanh chân, ADAS, camera phụ và các bộ kiểm thử hiện có. Tiếp tục dùng các module lập kế hoạch, điều khiển tự lái, giao thông, cảm biến, ghi/phát lại và dựng cảnh hiện có.

Đã chạy thành công 17 bộ kiểm thử qua `npm test` trong 101,7 giây, sau đó chạy thêm `node scripts/test.mjs scenario-matrix-test` thành công trong 9,8 giây. Tổng cộng 18 bộ kiểm thử khác nhau đạt. Build production kèm kiểm tra TypeScript đạt.

**Chưa kiểm tra trực quan giao diện mới hoặc tương tác WebGL trong trình duyệt ở lượt này:** công cụ trả về “Local browser use is disabled in Work settings”. Không có ảnh chụp kiểm chứng giao diện mới. Kiểm thử sự kiện bàn phím sử dụng EventTarget giả lập trong Node; chưa thay thế kiểm thử trực tiếp trên trình duyệt, điện thoại, hoặc tay cầm vật lý.

## Lỗi đã sửa

| Vấn đề | Hành vi sau thay đổi | Bằng chứng |
| --- | --- | --- |
| Ga làm giảm lực phanh khi cùng giữ hai bàn đạp ở Manual hoặc ADAS tắt ACC | Phanh chân quyết định gia tốc giảm; ADAS vẫn có thể bổ sung phanh | `driving-systems-test`: ga 100%, phanh 50% vẫn giảm tốc bằng 50% lực phanh ở cả hai chế độ |
| Poll tay cầm có thể ghi đè đầu vào từ bàn phím | Một đường xử lý đầu vào theo bước vật lý; ghép riêng các trục ga/phanh/lái | `drive-input-test`: bàn phím đánh lái vẫn giữ ga analog 65% từ tay cầm |
| Lái bằng phím nhảy ngay đến góc vô lăng tối đa | Góc lái tăng/giảm dần, tự trả về giữa; giảm biên độ phím lái khi tốc độ cao | Kiểm thử sự kiện xác nhận góc lái tăng dần và trở về 0 |
| Đầu vào còn giữ sau tạm dừng/mất tiêu điểm/đổi chế độ | Xóa đầu vào; tay cầm cần nhả về trung tính trước khi nhận lại | Kiểm thử blur, pause/resume, đổi chế độ và ngắt tay cầm |
| Phím mũi tên dùng để chỉnh thanh trượt có thể tác động xe | Ô nhập, select và range giữ quyền xử lý bàn phím | Kiểm thử select/range không làm xe tăng ga |
| Mô phỏng chạy sau menu khởi động; Esc có thể tác động hai nơi | Menu giữ mô phỏng ở trạng thái dừng; đóng/tiếp tục khôi phục đúng trạng thái; xử lý Enter/Esc ở menu | Rà soát luồng sự kiện và build; cần xác nhận trên trình duyệt |
| Đặt lại xe lái tay khi xe đang chạy sẵn 50 km/h | Manual/ADAS bắt đầu ở trạng thái đứng yên sau reset | Kiểm thử reset ở cả hai chế độ |
| Cụm UI phủ lên phần dưới của cảnh và che xe | Three.js dành vùng dựng cảnh riêng phía trên dải điều khiển; camera phụ dùng tọa độ canvas thực | Build đạt; cần kiểm chứng hình ảnh WebGL |
| Camera đã thu gọn không tự mở khi chọn R | Vào số R mở camera và chuyển sang góc sau | Rà soát handler; cần kiểm chứng trình duyệt |
| ADAS để lại số liệu/đèn từ chế độ trước | Xóa số khoảng cách và trạng thái cũ khi tắt hỗ trợ | Rà soát handler; cần kiểm chứng trình duyệt |
| Âm động cơ vẫn phát sau khi tắt máy hoặc mô phỏng dừng | Tắt âm động cơ khi Engine OFF; làm im âm động cơ/giao thông/lốp và ngừng tạo cảnh báo khi pause | Rà soát mã; chưa nghe kiểm chứng âm thanh |

## Bố cục và thao tác mới

- `CockpitLayout.ts` sắp xếp các component đang có vào một dải điều khiển: PRND/động cơ/phanh đỗ, đồng hồ tốc độ, radar ADAS và bàn đạp. Bàn đạp phanh ở bên trái, ga bên phải; có nút giữ để đánh lái trên màn hình.
- `game.css` định nghĩa bố cục desktop, màn hình hẹp và chế độ HUD gọn. Thanh điều khiển phía trên có chọn chế độ, góc nhìn, camera phụ, tạm dừng và toàn màn hình.
- Bảng điều khiển đóng mặc định. Tình huống và cài đặt mở qua nút trên thanh công cụ; thống kê mở qua nút Điểm. Phòng AI, thông số kỹ thuật và radar bản đồ vẫn truy cập được qua bảng phụ.
- Bật/tắt từng ADAS qua nút Cài đặt hỗ trợ cạnh radar/bàn đạp. Menu mở ở mép trái; radar và thông tin khoảng cách được giữ trong cụm dưới.
- Camera 360° nằm ở mép phải phía trên, có thể thu gọn và tiếp tục dùng các góc trước/sau/hai bên/toàn cảnh. Đây là cảnh dựng từ mô phỏng.
- Nhãn cự ly trên radar giữ màu vàng, được tăng cỡ chữ; số mét bên cạnh cũng có màu vàng để dễ đọc.
- Ban ngày là mặc định để dễ quan sát; vẫn có chế độ ban đêm trong cài đặt. Các quỹ đạo ứng viên tắt mặc định; dải dẫn đường có công tắc riêng.
- Mất tiêu điểm cửa sổ hoặc chuyển tab sẽ tạm dừng mô phỏng. Có màn hình tiếp tục/đặt lại/hướng dẫn.

| Phím | Tác dụng |
| --- | --- |
| W / ↑ | Ga |
| Space / S / M / ↓ | Phanh chân |
| A / D / ← / → | Đánh lái |
| [ / ] | Xi nhan / yêu cầu chuyển làn có hỗ trợ |
| K | Đổi góc nhìn chính |
| F1 | Mở/đóng bảng điều khiển |
| H | HUD gọn / HUD đầy đủ |
| Esc | Tạm dừng / tiếp tục |
| G | Biểu đồ động lực học |
| R | Đặt lại tình huống |

Phím C/N/V, T/E và B cũ vẫn có sẵn cho phòng AI/so sánh, được bỏ qua khi menu khởi động hoặc trường nhập đang xử lý phím. Các phím hành động không lặp theo key repeat.

## Kiểm thử đã thực hiện

| Bộ kiểm tra | Nội dung và kết quả |
| --- | --- |
| smoke | Các lượt nền: hữu hạn, trong đường, không ghi nhận va chạm |
| all-scenarios-smoke | 16 kịch bản, 30 giây mỗi lượt, không ghi nhận va chạm/ra khỏi đường |
| vietnam-scenario-smoke | 5 kịch bản Việt Nam bổ sung đạt |
| vietnam-scenarios-test | Xe máy luồn làn, xe buýt đón khách, ùn tắc, xe tải hỏng, giờ cao điểm có actor/hành vi đúng cấu hình |
| adas-test | Manual, giữ làn, ACC, FCW/AEB, BSM đạt |
| adas-brake-test | Dừng trước xe, cảm biến/thời tiết/tốc độ khác nhau, xe trước giữ làn đạt |
| driving-systems-test | PRND, engine/EPB, lùi, bù lực phanh, RCTA/Rear AEB, xử lý tiếp xúc, ưu tiên phanh và reset đạt |
| drive-input-test (mới) | Phím, lái tiến triển, chuyển trạng thái, trường nhập và ghép nguồn đầu vào đạt |
| adas-features-test | Chuyển làn thoáng/bị chặn, biển báo/giới hạn tốc độ, lệch làn, cảm biến đỗ xe đạt |
| traffic-profile-test | Hồ sơ Việt Nam và quốc tế khác nhau, điểm mù xe máy đạt |
| scenario-lab-test | Công cụ thêm tình huống thực sự thay đổi mô phỏng |
| record-replay-test | Khôi phục trạng thái ghi/phát lại chính xác trong lượt kiểm tra |
| lights-test | Dừng đèn đỏ, tiếp tục đèn xanh đạt |
| weather-test | Quang/mưa/sương mù, giảm tốc độ mục tiêu theo tầm nhìn đạt |
| road-sign-test | Biển giới hạn tốc độ ảnh hưởng bộ lập kế hoạch |
| learn-test | Huấn luyện và hai lượt đánh giá đạt |
| evo-test | Tiến hóa và lượt đánh giá đạt |
| scenario-matrix-test (mới) | 16 kịch bản × 2 bộ điều khiển (AI cổ điển/ADAS) × 3 thời tiết = 96 lượt xác định, 20 giây/lượt; trạng thái hữu hạn, không ghi nhận va chạm xe chủ hoặc ra khỏi đường |

Các lượt trên có thời lượng, seed và cấu hình cụ thể. Chúng không chứng minh mọi thao tác của người lái hoặc mọi tổ hợp tình huống đều không có lỗi.

## Giới hạn còn lại

- Cần kiểm tra hình ảnh, bố cục trên các kích thước thực tế, bàn phím trong trình duyệt, âm thanh và thiết bị thật khi trình duyệt được bật lại.
- Chưa bổ sung tài sản cabin/xe/thành phố có độ chi tiết như game thương mại ở lượt này. Dựng hình vẫn chủ yếu dùng hình học thủ tục.
- Vật lý vẫn là mô hình xe đạp động học; xử lý va chạm dừng/tách vật thể, chưa có biến dạng thân xe, hệ thống treo hoặc động lực học lốp đầy đủ.
- Bản đồ vẫn là tuyến vòng cố định. Hành vi giao thông Việt Nam là các actor và kịch bản có sẵn, chưa phải mô hình toàn bộ thành phố/quyền ưu tiên giao lộ.
- ADAS là mô hình hỗ trợ lái trong mô phỏng, chưa được kiểm định cho xe thật. AEB không phải cam kết tránh mọi va chạm khi người dùng tạo vật cản ở khoảng cách bất khả thi.
- Tay cầm hỗ trợ mapping `standard`; cần kiểm tra thực tế đối với vô lăng/pedal USB có mapping riêng.

Bản sao các tệp chính trước thay đổi được giữ tại `backups/2026-10-27-gameplay-ui/`. Checkout hiện tại không có `.git`.
