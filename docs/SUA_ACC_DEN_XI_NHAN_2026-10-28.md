# Sửa ACC, đèn tín hiệu, xi-nhan và bàn phím — 28/10/2026

Giữ dự án TypeScript/Vite/Three.js và các bộ lập kế hoạch, mô hình xe, traffic, ghi/phát lại đang hoạt động. Bản sao trước sửa: `backups/2026-10-28-acc-signals/`.

## Lỗi và thay đổi

### Xi-nhan / chuyển làn

- Sửa xi-nhan NPC: chuyển sang d dương là bên phải của tài xế, trước đây đèn báo ngược.
- Khi ALC đang chuyển làn mà người lái bật xi-nhan phía đối diện, hủy hướng cũ, xác nhận lại yêu cầu mới; không tiếp tục đánh lái theo xi-nhan cũ.
- Chuyển làn thủ công tự tắt xi-nhan khi xe đã vào làn mới theo đúng hướng, gần tâm làn và ổn định hướng trong 0,2 giây.
- Cụm đồng hồ và đèn thân xe dùng chung chu kỳ nháy 0,78 giây.
- Đầu vào bàn phím giữ riêng ý định tiếp quản; góc lái nhỏ do giới hạn ở tốc độ cao vẫn nhường quyền cho người lái. Giữ làn chờ 1 giây sau thao tác lái để tránh giật vô-lăng về ngay khi nhả phím.

### Đèn xanh / đỏ / vàng

- Nguyên nhân hiển thị sai: `TrafficLightView` tái sử dụng hình học theo tọa độ nhưng giữ đối tượng đèn cũ sau reset/đổi tình huống. Đồng hồ đèn cũ ngừng chạy trong khi bộ điều khiển dùng đối tượng mới. Đã nối lại đối tượng mới mỗi lần cập nhật; tái sử dụng hình học, giải phóng tài nguyên khi cần dựng lại.
- Dừng theo đèn trong ADAS vẫn là hỗ trợ riêng **TLA khi ACC đang bật**, có công tắc; ACC không mặc định là hệ thống nhận diện mọi đèn giao thông ngoài đời.
- Tính khoảng dừng theo đầu xe và vạch sơn nằm trước cột đèn 1,2 m. Đường cong giảm tốc có phần bù thời gian tăng áp suất phanh; tránh vượt vạch do giả định lực phanh đạt tức thì.
- Đèn xanh bỏ yêu cầu dừng theo đèn; xe tiếp tục nếu ACC vẫn hoạt động và không có nguy cơ khác/đang chờ RES.
- Đèn vàng quyết định theo quãng đường phanh còn đủ hay không; giữ quyết định trong cùng pha để tránh bật/tắt lệnh phanh khi đến gần.

### ACC / điều khiển khoảng cách, tốc độ

- Ô **Tốc độ ACC** ở cụm điều khiển dưới màn hình: nhập 10–140 km/h hoặc dùng nút −/+ 5 km/h. Enter xác nhận rồi trả quyền phím cho việc lái. Tốc độ ACC được lưu riêng với tốc độ đặt của AI.
- **Giữ cách** có 6 lựa chọn: 1,0 / 1,3 / 1,6 / 2,0 / 2,5 / 3,0 giây. Hiện khoảng mục tiêu theo mét với tốc độ hiện tại; khoảng hở khi đứng yên là 3 m.
- SET lấy tốc độ hiện tại; RES phục hồi; HỦY ngừng ga tự động. Chỉnh tốc độ khi ACC đã hủy không tự bật lại ACC.
- Bất kỳ lực phanh chân dương nào cũng hủy ACC. Không chấp nhận RES khi vẫn giữ phanh. Nhả phanh không tự tăng ga lại; vẫn giữ tốc độ đã đặt để người dùng chủ động RES.
- Đạp phanh tạo giảm tốc theo mô hình vật lý, không gán tốc độ về 0 tức thì. Nhả một lần phanh ngắn khi xe còn tốc độ thì xe có thể tiếp tục trôi; giữ phanh sẽ dừng. AEB có thể bổ sung phanh nếu lực chân chưa đủ cho nguy cơ trước mặt.
- Thay công thức targetSpeed khiến xe trước xa nhưng chậm vẫn kéo tốc độ mục tiêu xuống mạnh. Theo khoảng trống và tốc độ áp sát để có biên giảm tốc; giới hạn giảm tốc ACC thông thường và tốc độ thay đổi gia tốc. AEB vẫn có quyền phanh mạnh khi thật sự cần.
- Tách hiển thị nguyên nhân: ACC giảm về tốc độ đặt, ACC giữ khoảng cách, TLA dừng đèn, AEB khẩn cấp, giữ dừng AEB, ISA và phanh chân. “ACC đã hủy” xuất hiện cả trên HUD/cụm điều khiển và đồng hồ cabin.

### Phanh nhầm / cảm biến

- Giảm ngưỡng khoảng cách cứng quá lớn của AEB, tính nhu cầu theo tốc độ áp sát, ma sát và quãng đường phanh. Cảnh báo sớm FCW không đồng nghĩa phải phanh khẩn cấp ngay. Giữ kiểm tra bổ sung lực phanh chân khi lực người dùng không đủ.
- Lỗi đo vận tốc trước đây: track mới mặc định tốc độ 0; nhiễu vị trí cũng có thể tạo vận tốc ngang lớn giả, khiến xe làn bên bị dự báo như đang cắt vào.
- Chế độ ADAS nay có phép đo vận tốc radar **mô phỏng** với nhiễu, cùng ràng buộc tầm nhìn/FOV/rơi mẫu của Sensor. Kalman kết hợp phép đo vị trí và vận tốc. Vận tốc ngang được xét cùng độ bất định; xe chuyển làn/cắt ngang vẫn có vận tốc ngang theo động học traffic.
- Không có fallback sang dữ liệu chuẩn khi mất track. Các thuật toán này vẫn dùng cảm biến mô phỏng, chưa phải mô hình radar điện từ hay xử lý ảnh thật.
- Luồng cảm biến của AI cổ điển/học lái được giữ nguyên. Lượt kiểm thử tổng hợp phát hiện việc lọc vận tốc ảnh hưởng AI học lái; đã giới hạn lọc mới vào chế độ ADAS và chạy lại kiểm thử học lái đạt với hành vi cũ.

### Bàn phím / đổi tab

- Làm mượt vô-lăng bằng bộ đáp ứng giảm chấn; giảm bước nhảy lúc chạm phím, đảo hướng và trả lái. Giới hạn góc lái số theo tốc độ, với biên gia tốc ngang khoảng 4,5 m/s² cho đầu vào phím.
- Giới hạn tương ứng mô-men lái BCA/ELK ở tốc độ cao. Phanh chân giữ phản hồi trực tiếp; không đưa độ trễ làm mượt vô-lăng vào phanh.
- Bỏ đặt `sim.paused = true` trên blur/visibilitychange. Vẫn nhả các phím/bàn đạp đang giữ để tránh kẹt ga. Escape/nút tạm dừng vẫn hoạt động theo yêu cầu người dùng.
- RPA vẫn nhả lệnh giữ khi mất focus để phanh, độc lập với việc tạm dừng thế giới.
- Khi đóng hẳn trình duyệt hoặc hệ điều hành đình chỉ tab, JavaScript không thể tiếp tục mô phỏng bình thường. Thay đổi này bỏ tự pause/overlay của ứng dụng; không cam kết tiến trình vẫn chạy khi đã đóng trình duyệt.
- Camera được đặt xuống cụm dưới từ chiều rộng 800 px trong cabin, thay vì chỉ từ 881 px; tránh che thêm vùng nhìn ở cửa sổ 870 px đang kiểm tra.

## Bằng chứng kiểm thử

- Build TypeScript/Vite đạt. Vẫn có cảnh báo chunk Three.js khoảng 510 kB; không sửa ngưỡng để giấu cảnh báo.
- Thêm `driver-feedback-test` vào runner (hiện 27 suite). Kiểm tra đối tượng đèn thay thế tại cùng vị trí, màu material thật, dừng/khởi hành theo đèn và pha vàng; kiểm tra tốc độ/khoảng cách ACC, hủy bằng phanh, không tự bật lại; phanh bám xe êm; radar track mới và xi-nhan.
- Ca đèn đỏ ở 36 km/h: xe dừng, đầu xe còn khoảng **1,02 m trước vạch**; chuyển xanh rồi chạy lại.
- Ca bám xe chậm từ khoảng trống rộng: giảm tốc lớn nhất **2,35 m/s²**, jerk lớn nhất **2,50 m/s³**, không AEB hoặc va chạm.
- Khi xe trước chạy 36 km/h, đặt khoảng cách 1 giây / 3 giây cho khoảng hở ổn định khoảng **13 m / 33 m** trong ca kiểm thử.
- Ca giữ ga để ép AEB: vẫn dừng và không va chạm. Bộ ca hiện dừng cách khoảng **8,8 m** ở cấu hình đầu 28 m/s, khoảng **13,2 m** ở cấu hình đầu 40 m/s với cảm biến (xe còn tăng tốc trước khi AEB can thiệp). Đây là kết quả của những ca cụ thể, không phải khoảng dừng cố định ở mọi tốc độ.
- `drive-input-test`: kiểm tra các phím ga/phanh, nhả phím khi mất focus mà không pause, giới hạn lái ở 40 m/s, trả lái và ý định tiếp quản với góc lái nhỏ.
- Lượt tổng hợp đầu: 26/27 suite đạt, `learn-test` thất bại do hồi quy nêu trên. Sau sửa, `learn-test` đạt; xe học lái chạy khoảng 0,83 km ở highway và 0,64 km ở trucks, không va chạm trong phép thử. Không tuyên bố lượt tổng hợp lỗi ban đầu đã đạt.
- Sau sửa, chạy lại các nhóm liên quan, gồm **120 lượt xác định** (20 tình huống × 2 bộ điều khiển × 3 thời tiết), đều đạt với 0 va chạm xe chủ/đi khỏi đường; các ca đèn cũ, maps, camera cabin, AEB, ACC và input đạt. Các ca APA/RPA và ghi/phát lại được chạy lại để kiểm tra tích hợp.
- Kiểm tra trình duyệt: chỉnh ACC lên 65 km/h, chọn 2,5 giây và bấm phanh; giao diện hiện đúng **ACC đã hủy**, giữ nguyên tốc độ đặt; kiểm tra bố cục 870 px và 1280 px. Ảnh: `media/acc-controls-2026-10-28.jpg`.

## Giới hạn

Mô hình ACC/DRCC ở đây là bộ điều khiển giữ tốc độ và bám xe dựa trên khoảng cách/vận tốc giả lập, không có chứng nhận hoặc thông số đồng nhất với một xe thương mại. Chưa kiểm thử phần cứng vô-lăng/bàn đạp, toàn bộ điều kiện đường và mọi tốc độ/ma sát. Không bảo đảm tránh mọi va chạm trong tình huống vật cản xuất hiện quá gần hoặc quãng đường dừng không đủ. Chưa đo FPS/GPU hay đánh giá nghe âm thanh trên nhiều máy.
