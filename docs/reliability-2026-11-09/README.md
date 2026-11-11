# Kiểm tra độ tin cậy BlueLine ngày 11/11/2026

Đợt kiểm tra diễn ra từ 09 đến 11/11/2026. BlueLine dùng mô hình ADAS giả lập để nghiên cứu và lái thử. Hiệu năng trên xe thật chưa được kiểm định.

## Phần đã thay đổi

- **Cảm biến có thời gian xử lý thật trong mô phỏng:** dữ liệu được chụp, xếp hàng, rồi mới giao cho bộ theo dõi sau 55 ms khi dùng camera + radar hoặc 35 ms khi chỉ dùng radar. Không dùng vật cản từ trạng thái thật để lấp khoảng chờ này trong chế độ cảm biến. Đây là chính sách chờ cùng một lượt đo của BlueLine, chưa phải bộ hợp nhất bất đồng bộ đầy đủ của một ECU thực tế.
- **Bộ theo dõi:** cập nhật phép đo theo đúng thời điểm chụp và dự báo về thời điểm hiện tại, gồm vận tốc Doppler và xu hướng giảm tốc. Không cộng độ trễ vào vị trí hai lần; không ngoại suy xe đã phanh dừng thành xe chạy lùi. Mất cảm biến, phát lại hoặc đổi chế độ xóa dữ liệu cũ đang chờ.
- **AEB trên đường mưa:** trước khi sửa, bài thử xe trước phanh gấp còn khoảng 0,137 m. Sau sửa, bài thử đó đạt khoảng 1,70 m, không va chạm và giữ phanh khi dừng. Dự báo có thêm biên sai số vị trí/vận tốc và biên cho thời điểm bắt đầu phanh bị trễ. Hằng số dự phòng là giả định hiệu chỉnh mô phỏng, không phải thông số ECU hãng.
- Tín hiệu giảm tốc của xe máy dẫn đầu dao động quanh ngưỡng và làm dự báo FCW nhảy 1,65 m/s². Bản sửa tăng dần phần dự phòng theo mức giảm tốc đo được. Trong ca Civic trên đại lộ ngoại ô, số lần cảnh báo bật lại trong vòng 0,5 giây giảm từ năm xuống không. Bộ kiểm tra phối hợp ADAS đầy đủ cũng đạt trên bản cuối. Log của lượt phát hiện lỗi nằm trong `before-fcw-smoothing/`.
- **Bao hình từng mẫu xe:** dài/rộng/trục cơ sở riêng cho Civic, Santa Fe, Everest, VF9 được dùng trong điều khiển, khoảng trống, va chạm và đỗ xe; bản sao 3D khớp cùng bao hình. Xem [nguồn và giới hạn kích thước](../vehicle-envelope-2026-11-09.md).
- **Giảm cấp phát thừa:** chỉ tạo ảnh chụp đầy đủ phiên lái khi đang ghi. Chế độ ghi và phát lại vẫn được giữ.
- **Dựng cảnh:** chia nhà, cây và đồ vật tĩnh thành các cụm không gian để mỗi camera tự loại phần ngoài góc nhìn. Giữ nguyên hình học, vật liệu và texture. Trong fixture dùng nhà Hà Nội thật, số tam giác được gửi vẽ giảm từ 1.300.488 xuống 433.496; con số này không phải mức tăng FPS đã được chứng minh trên mọi thiết bị.
- **Gương cabin:** phân lượt cho gương lâu chưa cập nhật nhất. Sửa lỗi gương trái chiếm mọi lượt ở FPS thấp, khiến gương phải/gương giữa bị đen. Vẫn giới hạn một lượt dựng gương cho mỗi khung hình chính.
- **Trả quyền lái sau cài đặt:** nút X của bảng điều khiển nhả khóa phím ngay trong sự kiện đóng, không chờ lần dựng hình tiếp theo. Mở bảng cũng khóa đầu vào ngay. Đã đọc trực tiếp trạng thái DOM trước/sau đóng trên bản dựng: `true → false`, bảng `hidden=false → true` (`browser-input-interlock.json`).
- Cửa sổ hẹp dùng bố cục dọc cho từng bàn đạp và đặt góc vô lăng dưới hàng nút. Đồng hồ co theo ô, cần số có khoảng tách, năm góc camera và nút tạm dừng nằm trong khung. Đã kiểm tra trên bản dựng ở 840×768, 870×768, 1024×768, 1280×720, 1920×1080 và 844×390 ở chế độ điện thoại xoay ngang. Xem `compact-layout-verification.json`, `compact-dashboard.png` và `final-landscape.png`.
- Cloudflare báo lỗi cài sạch do esbuild 0.21 không khớp yêu cầu của Vite 8. Nâng esbuild dùng cho bộ kiểm thử lên 0.28.2 và chạy `npm ci` bằng npm 10.9.9. Riêng đổi esbuild cho bản dựng trùng SHA-256 của cả 22 tệp. Khi ghép sửa bố cục, phần JavaScript vẫn khớp sau khi chuẩn hóa tên tệp CSS đã đổi. Xem `cloudflare-clean-install-before.log`, `before-compact-build-manifest.json` và `build-manifest.json`.
- **Phục hồi GPU:** ngừng tiến thời gian mô phỏng trong lúc mất hình, nhả phím đang giữ, dựng lại ánh sáng và bộ xử lý hình ảnh; dọn tài nguyên nếu khôi phục thất bại và hiện nút tải lại. Không đổi lựa chọn tạm dừng của người lái.
- **Đo hiệu năng:** bảng thông số phím G hiển thị khoảng khung hình thực, P95, số khung giật, bộ nhớ nếu trình duyệt cung cấp, tài nguyên dựng cảnh và số lần khôi phục. Có xuất JSON. Khoảng giật không bị che bởi giới hạn bước vật lý.
- **Đồ họa:** khởi tạo ở chi tiết cao nhất, bỏ bộ chọn chất lượng khỏi cài đặt theo yêu cầu trước đó. API chất lượng cũ vẫn tồn tại để các kiểm thử riêng tương thích.

## Kiểm chứng

Mã nguồn ứng viên được đóng dấu SHA-256 theo `scripts/source-fingerprint.mjs`; văn bản chuẩn hóa LF/CRLF, tài nguyên nhị phân giữ nguyên byte. Bộ chạy báo lỗi nếu mã nguồn hoặc tài nguyên thay đổi trong lúc chạy. Báo cáo cuối phải khớp đầu và cuối cùng một lượt, không gộp các lượt chạy trước/sau sửa thành một kết quả.

- Dấu nguồn ứng viên `8677870e2fc3d6d654efbb2ad9ddde105c6686f23098c3fa9bc4f8eae0893895` cho 214 tệp.
- Toàn bộ **72 nhóm kiểm thử** đạt trên dấu nguồn cuối, gồm **690 tổ hợp** bản đồ, tình huống, chế độ lái và thời tiết, cùng **216 ca** có nhiễu cảm biến. `verification.json` và `full-suite.log` ghi cùng dấu nguồn ở đầu và cuối lượt.
- Phiên phố đô thị 3.600 giây mô phỏng với tối đa 48 xe giao thông đi **41,023 km**. Xe người lái ghi nhận **0 va chạm**, **0 giây ra khỏi đường**, 11 lần ACC tiếp tục và 7 lần ALC hoàn tất. Xem `extended/adas-endurance-results.json`.
- Bản build sản xuất đạt với 22 tệp, tổng dung lượng 29.537.786 byte. Vite vẫn cảnh báo hai gói JavaScript lớn. `build-manifest.json` ghi kích thước và SHA-256 từng tệp theo đúng dấu nguồn trên.
- Đặt `AUDIT_SEEDS=20261109,17,73` và `AUDIT_ENDURANCE_SECONDS=3600` trong shell rồi chạy `npm test` để tái hiện. Mặc định CI dùng 72 ca nhiễu và 60 giây cho phiên chạy liên tục để giới hạn thời gian.
- Lệnh `node docs/reliability-2026-11-09/run-complete-check.mjs` chạy cùng danh sách trong bốn tiến trình độc lập. `verification.json` lưu đủ 72 tên bài, mã thoát và dấu nguồn đầu/cuối. Kết quả từng bài nằm trong `release-shard-1.log` đến `release-shard-4.log`.
- Đã lái thử các bản dựng cục bộ trong Chromium của Codex ở 844×390 và 1920×1080. Đã kiểm tra ga, phanh và lái bằng bàn phím, phanh hủy ACC, giữ và nhả bàn đạp, đóng bảng cài đặt để trả quyền lái, camera 360 song song, chọn R để mở camera lùi và bật RCTA, đổi bốn mẫu xe, hai cabin GLB, ba gương Civic, đèn điểm mù trên gương Everest và khôi phục sau khi mô phỏng mất ngữ cảnh GPU. Xem `phone-landscape.png`, `desktop-cabin.png` và `everest-cabin.png`.
- Trên bản dựng cuối, đã hủy ACC, thêm xe đứng yên ở vành đai trong mưa và giữ W trong 11,2 giây theo thời gian trình duyệt. Cụm đồng hồ hiển thị 0 km/h, phanh người lái 0%, ADAS giữ 100%, khoảng cách cảm biến 10,9 m và thống kê 0 va chạm. `browser-rain-aeb-hold.json` và `browser-rain-aeb-hold.png` lưu lần chạy. Ca xe máy cắt ngang khi lùi đã báo đúng phía trái trên cụm đồng hồ và màn camera, xem `browser-rcta-final.json`.
- Ở chế độ thủ công, đã ghi khi lái bằng W, dừng ghi và phát lại phiên 1.470 khung hình. Giao diện báo âm thanh đang bật ở 100% sau tương tác. Xem `browser-record-replay.json`.
- Phiên lái thử vành đai trong Chromium tích hợp đo 23,2 FPS trung bình và P95 66,7 ms ở 870×764. `browser-runtime.json` ghi phiên hỗn hợp trước đó ở 1920×1080 với trung bình 1,39 FPS khi có lịch khung hình gián đoạn. Các số đo có ảnh hưởng từ trình duyệt tích hợp và kiểm thử chạy nền. Chưa có số đo cô lập phần cứng hoặc trace DevTools riêng.

### Bài thử va chạm không thể tránh

Kịch bản 79,2 km/h, vật cản đứng yên xuất hiện cách cản trước 13 m cố ý không đủ quãng đường dừng. Với cảm biến vừa khởi động, AEB giảm tốc độ va chạm từ 21,72 xuống 18,56 m/s; mốc tham chiếu được phép phản ứng sớm nhất sau khi cảm biến xử lý xong cũng là 18,56 m/s. Bài thử yêu cầu AEB tác động ngay lượt đo đầu và đạt ít nhất 95% mức giảm tốc mà mốc nhân quả này có thể đạt, không đòi biết trước vật cản.

Trường hợp đã theo dõi mục tiêu từ trước vẫn giữ tiêu chí cũ giảm ít nhất 3,5 m/s: kết quả 21,72 → 18,01 m/s. Không thay đổi tiêu chí không tiếp xúc và khoảng hở của các bài thử tránh va chạm khả thi. Không tăng lực phanh vô hạn hoặc dịch chuyển xe để làm đẹp kết quả.

## Chưa thể kết luận / cần làm tiếp

1. **Hiệu năng còn yếu trong trình duyệt thử.** Cảnh nhiều xe, bóng đổ, gương và camera phụ vẫn tốn nhiều lượt vẽ. Các khoảng khung hình ghi được không đạt mức có thể gọi là mượt; cần đo riêng trên Chrome/Safari và phần cứng thật, rồi tối ưu tiếp việc gộp lượt vẽ, tải tài nguyên và chi phí GPU. Không giảm chất lượng ngầm để che vấn đề.
2. **Chưa kiểm thử điện thoại thật:** chưa có số đo nhiệt, pin, bộ nhớ, đa chạm đồng thời, xoay màn hình, âm thanh và khôi phục nền trên iPhone/Android. Kiểm tra kích thước cửa sổ không thay thế việc này.
3. Phiên endurance một giờ là **thời gian mô phỏng của vật lý/bộ điều khiển**, không phải một giờ trình duyệt/GPU liên tục hoặc toàn bộ tổ hợp tốc độ/bản đồ/tình huống. Phạm vi ma trận nhiễu chính ở 50–60 km/h; giữ các bộ tốc độ cao riêng.
4. Chưa có dữ liệu hiệu chuẩn ECU, camera, radar và lốp từ xe thật. DMS vẫn dựa vào trạng thái mô phỏng; chưa có bộ ESC/TCS điều khiển mô-men quay thân xe đầy đủ. Một cờ “ESC sẵn sàng” không được tính là đã mô phỏng ESC thật.
5. Rộng thân VF9 2,004 m vẫn là ước định được ghi rõ; bao hình chữ nhật chưa phải CAD, chưa có va chạm riêng của gương gập hoặc mô hình biến dạng khi tai nạn. Cabin VF9/Everest vẫn dùng cabin mô phỏng chung vì GLB được cung cấp không có nội thất hoàn chỉnh.
6. Cảnh quan, người đi bộ và một số phương tiện vẫn là asset cộng đồng với chất lượng không đồng đều. Chưa thể gọi đồ họa tương đương các game mô phỏng thương mại hàng đầu.

Không có một bộ kiểm thử hữu hạn nào chứng minh đã loại bỏ mọi lỗi. Báo cáo này phân biệt phần đã đo, phần mô phỏng và phần chưa kiểm chứng.
