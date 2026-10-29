# Kiểm thử toàn diện BlueLine — 29/10/2026

## Kết quả bàn giao

- Đã chạy cả **38 nhóm test cũ**, đạt trong 565,3 giây. Các bài cũ đạt vẫn chưa bao phủ các lỗi tương tác mới tìm thấy dưới đây.
- Bổ sung **5 nhóm test mới**, mở rộng test bàn phím hiện có; lượt đầy đủ **43/43 nhóm đạt**, 572,6 giây. Gồm ma trận **690 tổ hợp hợp lệ** trên 7 bản đồ và ma trận **120 lượt tình huống**, cùng các bài chạy dài riêng về AEB, đường, học và tiến hóa AI.
- Sau hai bổ sung nhỏ ở xử lý timeline đầu phiên và bật âm thanh bất đồng bộ, chạy lại các nhóm audio, timeline, replay và ADAS runtime liên quan: đạt. Các log riêng được lưu cùng log toàn bộ.
- Build/typecheck bản bàn giao đạt. Còn cảnh báo gói Three.js core khoảng 552 kB; chưa phải lỗi chạy.
- Đã kiểm tra ứng dụng thật tại `http://127.0.0.1:5173/`, không chỉ biên dịch source. Lần đọc console cuối không ghi nhận `error`/`warn` trong phiên kiểm tra.

Không dùng các kết quả này để khẳng định đã chứng minh mọi đầu vào/tổ hợp có thể xảy ra đều đúng. Các giới hạn kiểm chứng và phần còn cần cải thiện nằm cuối báo cáo.

## Lỗi tìm được và đã sửa

| Nhóm | Lỗi/hành vi cũ | Sửa và bằng chứng |
|---|---|---|
| Phím giữ | Reset, blur hoặc auto-repeat có thể khôi phục ga/lái đã xóa | Xóa và chặn lệnh cũ theo revision; test event handler đã thất bại với bản trước sửa và đạt với bản mới |
| Focus cài đặt | Tay cầm có thể tiếp tục ra lệnh khi đang chỉnh input/dropdown; nhấn bàn đạp chưa thoát focus | Chặn nguồn điều khiển khi chỉnh form, chuyển focus khi thao tác bàn đạp; test mới và kiểm tra nhập W trong ô tốc độ không làm xe chạy |
| Bàn đạp cảm ứng | Nhả một ngón làm mất lệnh của ngón khác; sự kiện tab ẩn/reset có thể để lệnh cũ sống lại | Quản lý pointer riêng và revision; fixture nhiều pointer/tab ẩn/reset đạt. Chưa thử điện thoại cảm ứng thật |
| Điều khiển khi replay | PRND, đề máy, EPB, bàn đạp và phím xi nhan còn thay trạng thái | Khóa UI/handler khi phát lại; nhìn trực tiếp thấy nút PRND/đề máy/EPB/bàn đạp bị disabled |
| Bộ nhớ ADAS sau replay | ACC đã bị chân phanh hủy có thể tự bật lại; tốc độ đặt/headway/config bị lấy từ phiên khác | Lưu/khôi phục bộ nhớ ADAS, AEB hold, ALC, quyết định đèn vàng; hỗ trợ bản ghi cũ; kiểm tra tiếp tục từ replay vẫn giữ ACC đã hủy |
| Rear AEB | Phanh nhầm xe sau đang đi xa nhanh hơn tốc độ lùi | Xét vận tốc đóng, vẫn phanh với chướng ngại đứng yên/nguy cơ cắt ngang |
| NPC–người đi bộ | Người đi bộ có thể xuyên xe NPC đứng yên; xe nhanh vượt qua người giữa hai bước | Thêm va chạm quét cho cặp này, dừng/tách tại tiếp xúc, đếm sự cố nền riêng; test đứng yên và xe 40 m/s với bước 0,5 s đạt |
| Camera 360 | Vùng cắt nguồn âm khi canvas chính thấp hơn widget; renderer có thể mất trạng thái khi render phụ lỗi | Co vùng render giữ tỷ lệ và khôi phục target/viewport/scissor bằng finally; thử 6 tổ hợp DPR/chiều cao, thành công và lỗi render |
| Âm thanh tắt | Kéo âm lượng có thể nâng gain dù âm thanh đang tắt | Gain đầu ra giữ 0 khi disabled, nhớ mức âm lượng; test Web Audio contract đạt |
| Đồng bộ xi nhan | Tiếng relay dùng thời gian AudioContext, đèn dùng thời gian mô phỏng | Dùng cùng pha `indicatorOn(sim.metrics.time)`, kiểm tra pause/replay/đổi bên bằng fixture |
| API âm thanh bất đồng bộ | Lệnh bật cũ hoàn tất resume có thể ghi đè lệnh tắt mới | Revision cho yêu cầu bật/tắt; test deferred-resume đạt. Nút UI vốn khóa trong lúc chờ, nên đây chủ yếu là lỗi API/lifecycle |
| Timeline phiên ghi | Phát lại theo tỷ lệ index sai với timestamp không đều; import lỗi có thể thay dở bản ghi hợp lệ | Tìm theo timestamp; validate toàn bộ trước thay thế, kiểm tra thời gian hữu hạn/tăng dần/số lượng; không phát snapshot tương lai trước timestamp đầu |
| Đồng hồ responsive | Một số kích thước cabin 840–1179 px ẩn hẳn tốc độ HUD; lưới dock quá rộng trong vài trạng thái | Hiện số tốc độ gọn, bố trí lại cột và giữ ga/phanh/PRND trong màn hình; đo DOM và chụp ảnh ở nhiều kích thước |

## Phạm vi đã kiểm tra

| Hệ thống | Cách kiểm tra | Kết quả/phạm vi |
|---|---|---|
| W, mũi tên, S/Space/xuống, A/D, xi nhan | Event-level test; thao tác trình duyệt W/S/Space/A/D | Test đạt; W tăng tốc, S/Space dừng, A âm/D dương, Space hủy ACC; không tự chạy khi gõ trong ô tốc độ |
| Nhiều nguồn input, pause/blur/reset/focus, pointer/gamepad | Test handler với nguồn giả lập | Đạt; không đồng nghĩa đã cầm tay cầm hoặc điện thoại thật |
| PRND, động cơ, EPB | Test mô phỏng + thao tác UI | P kéo phanh đỗ, tắt máy ở P, D bị từ chối khi chưa đề, R tự chuyển camera; trong ADAS có trạng thái RCTA sẵn sàng |
| Giữ làn tốc độ cao | Test riêng 60/100/140 km/h, sai lệch ban đầu, nhiều làn/bước thời gian, khô/ướt | Đạt trong mô hình/bộ thử hiện tại; thử động học tốc độ cao không phải chứng nhận đủ độ bám xe thật |
| ACC/FCW/AEB/BSM/ALC/LDW/TSR/ISA/RCTA/Rear AEB | Các nhóm ADAS/regression/runtime, ma trận và bài phanh xe trước | Đạt các assertion; UI kiểm tra phanh hủy ACC, RES, camera RCTA; chưa tái hiện trực quan mọi cảnh báo ở mọi xe |
| APA/RPA, BCA/ELK/PMC/SEA/FDA/DMS/HBA | Nhóm parking-assist/extended/driving-systems | Đạt fixture; DMS là trạng thái người vận hành nhập, không phải nhận diện mắt/khuôn mặt thật |
| Va chạm ego/NPC/người/công trình | Test SAT/swept contact, tường mỏng tiến/lùi, tạt ngang, NPC–ped mới | Đạt; chưa có vật lý biến dạng/chấn thương hoặc va đập 3D hoàn chỉnh |
| 7 loại đường, ngược chiều, đèn/biển, giao thông Việt Nam | Ma trận 690, ma trận 120 và các bài đường/giao thông | Đạt ở seed/thời lượng xác định; không bao phủ mọi seed và diễn biến vô hạn |
| 4 xe, 8 asset thế giới | Parse GLB/transform/đèn/bánh/cabin tests; thao tác bộ chọn xe | Các tài nguyên đạt; VF9, Santa Fe, Everest báo đã tải; Civic quan sát cabin trực tiếp trước/sau các lần tải. Không thay GLB bằng ảnh giả |
| Cabin, gương, camera | Geometry/renderer contracts + ảnh thật | Cabin Civic thấy 3 gương có ảnh thế giới; đủ 5 nút camera chọn đúng trạng thái. Một số nhánh exception/DPR thử bằng mock renderer, không phải gây lỗi GPU thật |
| Bố cục | 390×844, 768×1024, 844×390, 1024×768, 1280×720, 1920×1080 | Đo DOM không tràn ngang; các nút chính/đồng hồ có kích thước và nằm trong viewport ở các lần xác nhận. 390 và 844 đo lại sau khi layout ổn định, thay số đo chuyển tiếp |
| Ghi/phát lại/xuất dữ liệu | Record/replay/timeline/runtime tests; ghi/phát clip UI 275 frame | Đạt. UI khóa điều khiển lúc replay; ACC đã hủy vẫn không tự bật sau tiếp tục |
| Web Audio | Test gain/clock/async race + nút bật/tắt/âm lượng UI | Web Audio bật thành công, tắt rồi kéo âm lượng vẫn hiển thị tắt, không console error. Chưa đánh giá âm học bằng tai |
| Mạng nơ-ron/AI tiến hóa | Chạy lại learn-test/evo-test | Đạt; không công bố đây là tự lái thực tế đã kiểm định |

## Những phần còn hạn chế hoặc chưa xác minh

1. **Đồ họa:** cây, nhà, mặt đường và nhân vật vẫn còn đơn giản; kiểm tra runtime không biến chất lượng asset thành đồ họa game AAA. VF9/Everest không có nội thất gốc trong GLB, vẫn dùng cabin chung. Bốn xe dùng động lực học mô phỏng chung, chưa có thông số lốp/treo/động cơ riêng đã hiệu chỉnh cho từng mẫu.
2. **Màn hình rất thấp:** 844×390 có đủ nút nhưng cảnh quan sát cabin còn ít không gian; bố cục đầy đủ chưa thoải mái bằng màn hình desktop. Cần thiết kế chế độ lái cảm ứng ngang chuyên biệt nếu dùng điện thoại để chơi thường xuyên.
3. **Hiệu năng:** chưa có benchmark FPS, GPU memory, tải dài nhiều giờ trên phần cứng thật; chưa kết luận 60 FPS ổn định. Chưa thử phục hồi WebGL context thực trên thiết bị/GPU lỗi.
4. **Phần cứng:** gamepad và multi-touch mới được kiểm tra bằng event fixture, chưa có tay cầm/vô-lăng/pedal vật lý hoặc điện thoại thật. Chưa kiểm thử mọi trình duyệt, màn hình cảm ứng, cấu hình âm thanh, full-screen và quyền hệ thống.
5. **Replay:** giữ đúng trạng thái đã ghi và bộ nhớ ADAS đã bổ sung. Chưa lưu trọn trạng thái RNG/tracker/AI và bộ nhớ DMS để bảo đảm việc tiếp tục chạy sau phát lại giống từng bước với phiên gốc. Timeline generic chưa xác thực toàn bộ schema vật lý của file bên ngoài.
6. **Vật lý:** tiếp xúc chủ yếu trên mặt phẳng, dừng/tách thân, chưa có lốp/treo/biến dạng đầy đủ hoặc khớp rơ-moóc. NPC gặp tai nạn chưa có cứu hộ/phục hồi, có thể làm ùn tắc. Collider nhà ống đại diện cả cụm; chưa khớp mọi cửa/sân trong.
7. **Phạm vi ADAS:** cảm biến và các trợ giúp là mô hình mô phỏng. Chưa kiểm định xe thật; các lượt test có seed và thời lượng hữu hạn không bảo đảm tránh va chạm trong mọi tình huống vật lý bất khả thi.

## Bằng chứng và cách chạy lại

- Log 38 nhóm cũ: [full-suite-initial.log](qa-2026-10-29/full-suite-initial.log).
- Log đầy đủ 43 nhóm: [full-suite-final.log](qa-2026-10-29/full-suite-final.log).
- Bản build cuối: [build-final.log](qa-2026-10-29/build-final.log).
- Kiểm tra cuối audio/replay: [audio-final.log](qa-2026-10-29/audio-final.log), [replay-final.log](qa-2026-10-29/replay-final.log).
- Ảnh cabin: [final-cabin.jpg](qa-2026-10-29/final-cabin.jpg); [điện thoại dọc](qa-2026-10-29/ui-390x844.jpg); [màn hình thấp](qa-2026-10-29/ui-844x390.jpg).
- Số đo bố cục: [viewports.json](qa-2026-10-29/viewports.json).

Chạy `npm run build` và `npm test` để chạy toàn bộ. Các bài mới là `audio-runtime-test`, `adas-runtime-audit-test`, `pedal-console-input-test`, `render-runtime-test`, `session-timeline-test`. Có thể truyền tên nhóm cho `node scripts/test.mjs <tên-nhóm>` khi xác minh một lỗi cụ thể.
