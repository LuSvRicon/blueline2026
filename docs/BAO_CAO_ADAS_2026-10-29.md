# Kết quả nghiên cứu và cập nhật ADAS — 29/10/2026

## Đã thay đổi

- Thêm `AssistancePolicy.ts` làm nơi định nghĩa điều kiện và thông số tham chiếu. Có phân biệt số lấy từ tài liệu với số hiệu chỉnh riêng.
- Tách LFA giữ giữa làn khỏi LKA chống lệch làn; thêm LKA theo dự báo mép thân xe, ngưỡng 60 km/h và ý định xi-nhan. Giữ Stanley/bù độ cong, điều khiển xe, dự báo và hệ thống va chạm đang hoạt động.
- ACC có liên động cửa/dây an toàn/ESC/ABS và lỗi cảm biến; phanh chân vẫn hủy ACC, không tự khôi phục sau khi nhả. Giữ các mức khoảng cách, SET/RES và giới hạn giật khi phanh thông thường.
- ALC mặc định cao tốc từ 80 km/h, cần ACC/LFA, tay người lái, camera/làn và radar sau. Giao lộ có đèn, người đi bộ phía trước và cảnh báo va chạm chặn yêu cầu. Vẫn kiểm tra xe lao lên từ phía sau trong 5 s; thêm lý do bị chặn.
- Tách điều tốc trước cua thành công tắc CSA. Hiển thị trạng thái phối hợp ACC/LFA trên cao tốc và trong ùn tắc.
- Tách lỗi camera, radar trước, radar sau và siêu âm. Đây là lỗi chức năng giả lập trên pipeline cảm biến tổng hợp, không phải phần cứng/cảm biến mới.
- Sửa lỗi tìm được từ lái thử cao tốc: dải phân cách/lan can đã biết trong bản đồ được phân loại riêng và ghép hình học ngang theo bản đồ, thay vì có thể thành ô tô lệch vào làn do nhiễu. Tracker không ghép lẫn ranh giới/xe/người. Vật cản công trường vẫn vào nhận biết; ranh giới vẫn tham gia AEB, cảm biến đỗ và va chạm. Đây là mô hình dùng thông tin bản đồ mô phỏng, không phải bộ nhận dạng ảnh thực.
- BCA giữ thành phần bù độ cong khi sửa lái; bổ sung phanh khi rời chỗ về phía xe điểm mù đang đến. ELK xét đúng phần đường cùng chiều thay vì cả làn đối diện.
- RCTA có miền vận hành khi R dưới 8 km/h và phân biệt xe đi vào/ra. Tách “sẵn sàng” khỏi “có cảnh báo”. Camera báo giảm tốc khi vượt miền RCTA.
- Rear AEB độc lập công tắc AEB trước. Phanh vật cản khi lùi không bị ngắt bởi ngưỡng 8 km/h của RCTA; giữ dừng chống nhấp nhả khi người lái giữ ga.
- ISA có giới hạn, chỉ cảnh báo và đề xuất tốc độ để người lái xác nhận. Hai chế độ sau không tự đổi tốc độ đặt hay tự phanh. Không cho nút xác nhận hứa áp dụng biển ngoài dải đặt ACC.
- Có chế độ xử lý đèn tiêu chuẩn và chế độ xác nhận xanh riêng. Không áp đặt hành vi Tesla lên mọi cấu hình; không tự rẽ giao lộ.
- Dừng khi tài xế không phản hồi có trạng thái tăng cấp, phanh/giữ, đèn khẩn cấp thật và quyền tiếp quản qua thao tác mới. Bộ đếm/trạng thái và đầu vào thí nghiệm được ghi/phục hồi trong replay.
- HBA có ngưỡng bật/tắt 40/25 km/h và hạ pha ngay khi phát hiện xe. Giữ kết nối đèn 3D đã có.
- APA/RPA bổ sung liên động cảm biến/cửa/dây/động cơ, RPA chuẩn bị từ P. Lệnh đỗ không được ghi đè phanh chân hoặc phanh an toàn mạnh hơn.
- Cài đặt có nguồn/giới hạn, trạng thái không sẵn sàng, các chế độ ISA/đèn/ALC và nhóm thử lỗi riêng. Sửa phần cuộn làm mất nút đóng/tab. Đồng bộ cảnh báo âm thanh và HUD cho phanh BCA/ISA.

## Nghiên cứu

Xem [bảng đối chiếu toàn bộ nhóm và nguồn chính thức](ADAS_THAM_CHIEU_2026-10-29.md). Nguồn chính là Kia EV9/EV6, Tesla Model Y, Volvo EX90, Toyota và Euro NCAP. Các nguồn khác mẫu/năm/thị trường được ghi tách biệt.

## Kiểm tra đã thực hiện

- Build/typecheck chạy được sau các giai đoạn. Vite còn cảnh báo chunk Three.js khoảng 552 kB; không phải lỗi build.
- Thêm `adas-reference-test`: điều kiện ACC; lỗi cảm biến độc lập; LFA/LKA; ALC từ chối đường thường/giao lộ/người đi bộ/xe sau; ISA; xác nhận xanh; HBA; BCA; dừng tài xế, tiếp quản và replay; phanh lùi và đỗ.
- Các bài hiện có tiếp tục kiểm tra gia tốc/áp lực, khoảng cách thật, va chạm, giới hạn bám đường, điều khiển phím và quỹ đạo đỗ; không chỉ xét đèn cảnh báo.
- Lượt đầy đủ đầu: **49/51 nhóm đạt** trong 954,3 s. Hai nhóm không đạt là `driver-feedback-test` và `adas-features-test`: fixture ALC cũ chưa khai báo phạm vi thí nghiệm hoặc vẫn đặt tại giao lộ có đèn. Sửa fixture, giữ các khẳng định về quỹ đạo/xi-nhan/khoảng trống; chạy lại hai nhóm đạt. Có kiểm tra mới riêng cho miền hoạt động mặc định.
- Lượt đầy đủ tiếp theo: **51/51 nhóm đạt** trong 612,8 s, lưu tại [ADAS_TESTS_STAGE2_2026-10-29.log](ADAS_TESTS_STAGE2_2026-10-29.log). Sau đó thử trình duyệt cao tốc tìm được lỗi ranh giới nói trên; thêm `adas-motorway-domain-test` để tái hiện. Không coi kết quả 51 nhóm trước sửa là xác nhận cho bản sửa cảm biến cuối.
- Bài mới trước sửa: chuyển làn được khi dùng tham chiếu trực tiếp nhưng bị hủy với cảm biến có nhiễu. Sau sửa: cả hai đều hoàn tất từ làn 1 sang 2, tự tắt xi-nhan, không va chạm; bài kiểm tra công trường chặn chuyển làn và hướng vào dải phân cách vẫn kích hoạt AEB cũng đạt.
- Sau sửa cảm biến/ranh giới, build và lượt hồi quy cuối **52/52 nhóm đạt trong 624,5 s**. Bao gồm 120 lượt kịch bản cố định, ma trận 690 tổ hợp bản đồ/kịch bản/chế độ/thời tiết, kiểm tra giữ làn tốc độ cao, phanh, bàn phím, đỗ, ghi/phát lại, mô hình 3D, giao thông và học AI. Những ma trận này dùng seed/thời lượng xác định, không bao phủ vô hạn mọi thao tác.
- Nhật ký lần đầu: [ADAS_TESTS_2026-10-29.log](ADAS_TESTS_2026-10-29.log). Nhật ký lượt cuối: [ADAS_TESTS_FINAL_2026-10-29.log](ADAS_TESTS_FINAL_2026-10-29.log).

## Kiểm tra trực tiếp trên trình duyệt

Đã vào trang `127.0.0.1:5174`, thao tác UI và bàn phím qua trình duyệt; quyền truy cập hiện đã dùng được.

1. Space phanh xe xuống 0, ACC chuyển hủy và giữ hủy sau khi nhả.
2. Chọn chỉ cảnh báo ISA được áp dụng qua menu. Che camera trước làm nhóm phía trước yêu cầu tiếp quản. Bỏ che phục hồi cảm biến nhưng không tự bật ACC.
3. Tình huống “Xe chết máy”: giữ W tiếp cận, AEB can thiệp 100%; tiếp tục giữ W, xe dừng 0 km/h và khoảng cách hiển thị 12,5 m. [Ảnh](adas-reference-aeb-2026-10-29.jpg).
4. Tình huống “Lùi xe · xe máy cắt ngang”: chọn R, RCTA cảnh báo trái ngay cả khi EPB còn bật. Sau khi nhả EPB/đạp ga trong cửa sổ có nguy hiểm, Rear AEB phanh 100%, tốc độ về 0; camera chuyển góc lùi và hiển thị cảnh báo.
5. Khi lùi trên 8 km/h, phát hiện UI cũ vẫn báo RCTA sẵn sàng; đã sửa theo trạng thái thực. Việc hết cảnh báo khi xe máy đã đi qua không được coi là lỗi phát hiện.
6. Kiểm tra hình ảnh menu ở các kích thước trình duyệt thực tế khoảng 1280×720 và 870×764: nút đóng/tab vẫn truy cập được, phần dài cuộn riêng; bảng điều khiển và camera vẫn render. Không dùng việc render được để kết luận đạt FPS cụ thể.
7. Không ghi nhận console error trong các lần lấy log khi thử phanh. Âm thanh đã kiểm tra đường phát sự kiện bằng test; chưa xác nhận bằng nghe trên loa thật.
8. Cao tốc trống, ACC 90 km/h: trước sửa thấy ALC bị hủy dù không có xe; sau sửa và tải lại trang, xe chuyển sang làn phải, xi-nhan tự tắt, tiếp tục bám làn. [Ảnh sau chuyển làn](adas-reference-alc-2026-10-29.jpg).
9. Bản cuối: chọn ISA “Đề xuất tốc độ”, tốc độ đặt vẫn 58; nhấn “Áp dụng biển 50 km/h vào ACC”, đồng hồ chuyển 50 và ACC vẫn giữ trạng thái đã hủy. Xác nhận không tự khôi phục truyền động khi chỉ chỉnh tốc độ. [Ảnh giao diện](adas-reference-settings-2026-10-29.jpg).

## Còn thiếu / chưa thể tuyên bố hoàn tất

- Không có profile ECU chính hãng cho bốn mẫu xe, dữ liệu firmware, kiểm định trên xe thật hoặc bảo đảm tránh mọi va chạm.
- Chưa tái hiện toàn bộ nhánh AEB giao lộ, tự né khẩn cấp, mô-men EPS/phanh từng bánh, nhận diện camera/mắt thật hoặc GPS/bản đồ định tuyến thật.
- APA chỉ song song; RPA chỉ tiến/lùi thẳng, chưa đỗ vuông góc/chéo/tự thoát ô/tự tìm chuồng/summon.
- Ngưỡng BSM/SEA, suy luận nhầm ga, tốc độ thấp của ALC và nhiều cơ chế tự hủy/giữ phanh vẫn là mô hình tổng hợp; bảng nghiên cứu ghi rõ khác biệt với từng nguồn.
- Trong lái thử có lúc xe giao thông phía sau rất gần che camera bám theo. Đây là hạn chế góc camera/che khuất còn tồn tại, chưa sửa trong đợt ADAS này.
- Chưa có đo FPS/GPU độc lập, nghe âm thanh trên thiết bị thật hoặc chạy vô hạn mọi tổ hợp tình huống. Các ma trận hiện tại có seed và thời lượng xác định.

Đã giữ bản trước khi sửa tại `backups/2026-10-29-adas-reference/`. Không xóa module lập kế hoạch, AI giao thông, điều khiển hay các mô hình xe.
