# BlueLine v0.6 — nâng cấp vận hành, giao thông và khoang lái

Ngày thực hiện: 27/10/2026. Bản sao nguồn trước thay đổi: `backups/2026-10-27-upgrade/`.

## Nội dung đã triển khai

### 1. Truyền động và phanh

- Số N ngắt truyền động, giữ động lượng và hướng chuyển động. Xe trôi giảm tốc theo lực cản, đạp ga ở N không đẩy xe. Phanh chân vẫn dừng xe.
- Vào P và đổi chiều D/R bị khóa khi xe còn chạy; có thể chuyển D → N khi đang chạy và N → D khi còn trôi cùng chiều.
- Phiên ghi giữ hướng trôi, kể cả R → N. Tệp xuất có mã bản đồ trong mỗi khung trạng thái.
- Cả Manual và ADAS tắt ACC ưu tiên lực phanh chân khi giữ hai bàn đạp. ADAS vẫn có thể bù phanh theo nguy cơ.
- Đường mưa có hệ số bám mô hình 0,72; đường khô là 1,0. Sương mù giảm tầm nhìn, không tự biến đường khô thành đường ướt. Khoảng dừng AEB và lực giảm tốc dùng hệ số mặt đường; số liệu gia tốc thể hiện lực thực sự áp dụng.
- Manual có giới hạn lực bám ngang theo mô hình vòng tròn ma sát đơn giản. Khi yêu cầu góc lái quá lớn ở tốc độ cao, xe không quay với gia tốc ngang vô hạn; HUD báo giảm độ bám.
- Bộ lập kế hoạch/ADAS/học AI tiếp tục dùng mô hình lái động học đã có để giữ tương thích với bộ điều khiển. Đây chưa phải hệ động lực học lốp thống nhất cho mọi chế độ.
- HUD và đồng hồ cabin có vòng tua ước lượng từ tốc độ, trạng thái truyền động và ga. Âm động cơ tổng hợp dùng cùng nguồn vòng tua; đây không phải mô hình mô-men động cơ/hộp số cơ khí.

### 2. Tiếp xúc và đổi làn

- `core/collision.ts`: kiểm tra hình chữ nhật có góc xoay bằng SAT; kiểm tra quét chuyển động giữa hai vị trí và chia đoạn góc xoay.
- Xe chủ dừng tại thời điểm tiếp xúc với xe hoặc người đi bộ, thay vì chờ đến khi hai vị trí cuối đã lồng vào nhau. Phương tiện cắt ngang bị dừng ở vị trí tiếp xúc; hướng thân xe và kích thước vuông góc được tính đến.
- Có xử lý nhiều tiếp xúc và sửa dữ liệu khởi đầu bị chồng nhiều thân xe. Trong trường hợp khởi tạo không hợp lệ, hệ thống tìm vị trí gần nhất đã kiểm tra không còn chồng lấn; đây là bước sửa trạng thái, không phải mô phỏng biến dạng va chạm.
- Bước đổi làn của AI có kiểm tra bổ sung khoảng trống trước/sau tại làn đích. Kiểm thử va chạm mới đã phát hiện và dẫn đến sửa một trường hợp xe chủ chuyển vào vùng thân xe chạy sát bên.
- Danh sách láng giềng của giao thông dùng vùng thân xe thực sự chiếm, thay vì chỉ dùng tên làn đích khi một xe đang chuyển làn.
- Bộ giải tiếp xúc mới xử lý xe chủ với các actor. Chưa có bộ giải va chạm động lực học riêng cho mọi cặp NPC–NPC hoặc các tòa nhà/đồ vật trang trí.

### 3. Giao thông và tình huống

- Người đi bộ bình thường chờ khoảng trống an toàn, tính cả xe chủ và tín hiệu đèn. Bỏ điều kiện tự bước xuống đường sau ba giây chờ. Người đi bộ băng ngang có chủ ý vẫn là nhóm tình huống nguy hiểm riêng.
- Xe đi dọc dự đoán đường đi của phương tiện cắt ngang để nhường. Cơ chế tạo xe cắt ngang tại đèn đỏ trước đây chưa được gọi trong vòng mô phỏng; nay được nối vào các tình huống đèn tín hiệu/giờ cao điểm.
- Xe cắt ngang theo tín hiệu phải có pha đỏ cho luồng chính, đủ thời gian qua đường và không có xe đang chắn vùng giao nhau trước khi bắt đầu. Actor đã bắt đầu được phép đi hết đường.
- Kịch bản ùn tắc khởi động đứng yên. Việc bắt đầu ở 50 km/h sát hàng xe dừng từng tạo trạng thái không đủ quãng đường phanh khi có hệ số bám đường ướt.
- Sửa ngưỡng Rear AEB theo khoảng dừng và kích thước chiếu thực của phương tiện cắt ngang. Lần hồi quy đầu đã phát hiện ngưỡng cũ quá ngắn sau khi đổi sang thân xe có góc xoay; đã tăng bộ đệm và thử lại RCTA/Rear AEB.

Bốn kịch bản mới, đưa danh mục lên 20:

| Kịch bản | Actor/logic thực sự có trong mô phỏng |
| --- | --- |
| Khu vực trường học | Biển 30 km/h, xe buýt dừng, hai người đi bộ chờ sang đường |
| Phố chợ đông xe máy | Giao thông chậm, biển 30 km/h, xe máy cắt ngang, người đi bộ |
| Công trường thu hẹp làn | Xe tải đứng chắn làn và biển 30 km/h, buộc giảm tốc/chờ hoặc đổi làn khi đủ khoảng trống |
| Lùi xe · xe máy cắt ngang | Bắt đầu ở P với phanh đỗ; chọn R kích hoạt actor phía sau, RCTA và Rear AEB ở chế độ ADAS |

Có thêm hai nút tạo sự kiện cắt ngang phía sau từ trái/phải. Chúng chờ số R để người dùng có thể tự dựng bài thử lùi.

### 4. Bản đồ

| Bản đồ | Hình học và chiều dài xấp xỉ |
| --- | --- |
| Phố đô thị | Tuyến phố vòng có góc giao lộ, 2.371 m |
| Đại lộ ngoại ô | Tuyến dài hơn, góc cua rộng hơn, 3.288 m |
| Đường vành đai | Vòng ellipse lớn, 3.292 m, không có giao lộ tại góc |

Có lựa chọn bản đồ ở menu khởi động và trong cài đặt. Đổi bản đồ bắt đầu phiên mới bằng tải lại trang. Cảm biến, giao thông, đường, cảnh và camera đều được tạo từ bản đồ đã chọn.

Đây là ba tuyến dựng theo tham số; chưa có mạng đường toàn cầu, dữ liệu địa lý thật, tuyến rẽ nhiều nhánh hoặc luật giao thông đầy đủ theo quốc gia.

### 5. Cabin, phương tiện, đường và con người

- Thay các khối táp-lô rời bằng một thể tích liền có bề mặt uốn theo ngang cabin, phần nhô cụm đồng hồ và vật liệu vân nhỏ.
- Vô lăng có trục quay chung: vành, chấu và cụm nút quay cùng nhau theo góc lái. Sửa trục quay cũ khiến vành và chấu không chuyển động thống nhất.
- Cụm đồng hồ cabin lấy tốc độ, số, vòng tua, phanh đỗ và cảnh báo AEB từ trạng thái mô phỏng.
- Màn hình dẫn đường cabin vẽ tuyến đường và phương tiện hiện tại, thay cho tuyến vẽ cố định. Sửa hướng trái/phải của phép chiếu trên bản đồ nhỏ cho khớp camera lái.
- Giữ gương phản chiếu và đèn điểm mù thật sự gắn với trạng thái BSM. Nội thất chỉ bật trong góc cabin; khi dựng camera 360°, xe chủ được chuyển tạm sang vỏ ngoài đầy đủ rồi khôi phục góc cabin.
- Thêm chuyển động gạt mưa theo trạng thái mưa và thời gian mô phỏng; đứng yên khi mô phỏng tạm dừng.
- Xe giao thông giữ màu sơn, không đổi toàn bộ thân xe thành màu cảnh báo phát sáng. Xe hỏng dùng đèn cảnh báo; xe cắt ngang quay đúng chiều chuyển động và có bánh xe quay.
- Pool xe dùng mã actor để giữ mesh qua các lần đổi thứ tự. Các mesh bị loại được giải phóng geometry/material để hạn chế tài nguyên GPU tồn dư sau thay đổi mật độ/tình huống.
- Người đi bộ có đầu, thân, tay, chân và chu kỳ bước theo quãng đường thực đi. Bỏ việc biến cả người thành khối phát sáng khi băng qua đường.
- Mặt đường có pháp tuyến hướng lên, vật liệu PBR/vân nhựa đường, vỉa hè và mép bó vỉa. Mưa thay đổi độ nhám/màu mặt đường. Cửa sổ tòa nhà giảm độ sáng ban ngày.
- Sửa việc đổi ngày/đêm làm mất cấu hình mưa/sương mù.

Tất cả vẫn là mô hình tự dựng bằng hình học, chưa phải tài sản xe/cabin được nghệ sĩ dựng ở mức game thương mại. Những thay đổi này chưa được kiểm chứng hình ảnh trên trình duyệt ở lượt này.

### 6. Giao diện và tùy chỉnh

- Giữ cụm điều khiển ở đáy và bảng phụ có thể đóng.
- Thêm chỉnh góc nhìn cabin, độ cao ghế, độ nhạy lái, vùng chết tay cầm và ba mức chất lượng dựng hình. Các giá trị được áp dụng thật và lưu trong localStorage khi trình duyệt cho phép.
- Mỗi kịch bản mới có hướng dẫn thao tác. Kịch bản thử lùi không tự lao xe về phía trước khi vừa bắt đầu.
- Camera 360° vẫn có thể hoạt động song song; số R tự mở góc sau. RPM, trạng thái phanh đỗ, động cơ và giảm độ bám có chỉ báo riêng.

## Kiểm thử

- `npm test`: **21/21 bộ đạt**, thời gian 121,5 giây. Bao gồm huấn luyện mạng nơ-ron và tiến hóa AI.
- Ma trận 20 tình huống × 2 bộ điều khiển × 3 thời tiết: **120 lượt xác định, 20 giây/lượt**, trạng thái hữu hạn, không ghi nhận xe chủ va chạm hoặc ra khỏi đường trong các lượt đó.
- Ba bản đồ × AI/ADAS: sáu lượt 20 giây đều tiến triển, không ghi nhận xe chủ va chạm/ra khỏi đường.
- `npm run build`: đạt, có kiểm tra TypeScript trước khi đóng gói.
- Bài thử truyền động/RCTA và bài thử bản đồ/phát lại được chạy lại sau khi sửa các lỗi hồi quy và trạng thái khởi động bài thử lùi; đều đạt.
- Sau khi tách tác động của sương mù khỏi độ bám mặt đường, đã chạy lại `adas-brake-test`, `scenario-matrix-test`, `weather-test`: **3/3 đạt**, thời gian 16,8 giây. Ma trận 120 lượt tiếp tục không ghi nhận xe chủ va chạm/ra khỏi đường.
- Preview tại `http://127.0.0.1:5173/` trả HTTP 200. Đây chỉ là kiểm tra máy chủ phục vụ trang, không chứng minh trình duyệt đã dựng trang thành công.

Các kiểm tra mới:

- `dynamics-collision-test`: quét tiếp xúc giữa hai khung không chồng lấn, giao cắt vuông góc, thân nghiêng, tránh báo tiếp xúc khi đang tách xa, N theo hai hướng, ưu tiên phanh, trạng thái chồng nhiều thân và lực bám đường ướt.
- `render-geometry-test`: kích thước/tính kín/chiều mặt táp-lô, đường kính vô lăng, pháp tuyến mặt đường, phép chiếu bản đồ và việc dispose tài nguyên dùng chung trong một xe. Đây là kiểm tra dữ liệu hình học, không thay thế kiểm chứng hình ảnh.
- `maps-traffic-test`: sáu lượt lái 20 giây trên ba bản đồ với AI/ADAS; người đi bộ chờ an toàn; cắt ngang theo tín hiệu; bài thử RCTA/Rear AEB; dọn biển báo riêng khi đổi kịch bản.
- `scenario-matrix-test`: 20 tình huống × AI/ADAS × quang/mưa/sương = 120 lượt, 20 giây/lượt, seed xác định.
- `record-replay-test`: thêm kiểm tra trôi lùi ở N qua reset, phát lại và tiếp tục mô phỏng.

## Phần chưa kiểm chứng/chưa triển khai

1. Công cụ trình duyệt vẫn trả về `Local browser use is disabled in Work settings`. Chưa có kiểm tra trực quan cabin/HUD mới, FPS trên máy người dùng, thao tác chạm, nghe âm thanh, tay cầm/vô lăng thật hoặc ảnh chụp kết quả.
2. Chưa có mạng đường toàn cầu, mô hình quyền ưu tiên giao lộ nhiều nhánh đầy đủ hoặc hành vi đám đông tự tìm đường. Các luồng giao cắt hiện là actor theo tuyến và pha tín hiệu.
3. Chưa có biến dạng thân xe, va chạm NPC–NPC đầy đủ, vật lý hệ thống treo/lốp nhiều bánh hoặc phản hồi lực vô lăng. Manual có giới hạn lực bám đơn giản; AI/ADAS còn dùng mô hình lái động học.
4. Camera 360° là một góc nhìn từ cảnh 3D; chưa mô phỏng ghép bốn ảnh camera, méo ống kính và sai số hiệu chỉnh như xe thật.
5. Âm thanh vẫn được tổng hợp; chưa dùng bộ mẫu âm động cơ/đường phố thu thực tế.
6. Đổi bản đồ bắt đầu phiên mới, không mang phiên ghi đang nằm trong bộ nhớ sang trang mới. Chưa có nhập tệp phiên lái hoặc bộ dựng bản đồ tự do.

Các kết quả kiểm thử có thời lượng/seed xác định, không phải bằng chứng ứng dụng hết mọi lỗi hay đạt mức “top đầu”. ADAS trong dự án là mô hình mô phỏng, chưa phải hệ thống an toàn đã kiểm định cho xe thật.
