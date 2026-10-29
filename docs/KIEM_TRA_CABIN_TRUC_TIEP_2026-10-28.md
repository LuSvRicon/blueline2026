# Kiểm tra cabin trực tiếp trên trình duyệt — 28/10/2026

Đã mở được ứng dụng bằng công cụ trình duyệt trong lượt này. Máy chủ Vite ban đầu chưa chạy (`ERR_CONNECTION_REFUSED`); đã khởi động lại tại `http://127.0.0.1:5173/`. Các ghi chú quyền trình duyệt bị tắt trong báo cáo trước phản ánh trạng thái ở lượt trước, không còn là trở ngại của lượt này.

## Lỗi nhìn thấy và đã sửa

1. **Bàn đạp nằm ngoài màn hình:** quy tắc cũ `#ui.cockpit-mode .speedo` có độ ưu tiên cao hơn CSS mới, khiến đồng hồ 2D vẫn chiếm một ô và đẩy bàn đạp sang hàng bên dưới. Bỏ quy tắc cũ; kiểm tra lại vị trí thực tế trong DOM và ảnh chụp.
2. **ADAS bị ép rộng 210 px trên màn hình nhỏ:** quy tắc responsive cũ theo ID ghi đè chiều rộng trong dock. Cho panel tự chiếm đúng ô grid; sửa vùng thông báo và số liệu ở màn hình 1024 px.
3. **Camera 360° che màn hình trung tâm:** ở cabin desktop từ 881 px, camera chuyển vào ô riêng bên phải cụm điều khiển dưới. Cảnh 3D được render trước vào một vùng tạm của renderer hiện có, sao chép ngay sang canvas camera, rồi render khung nhìn lái chính. Camera không còn phụ thuộc vào một lỗ trong HUD nằm trên kính chắn gió.
4. **Vô lăng/cột lái/gương giữa sai vị trí:** điều chỉnh mắt người lái, độ cúi camera và trục lái; cột lái đi xuống sau vô lăng. Thu ngắn chân gương giữa và đặt mặt gương phía trong kính.
5. **Màn hình có khối viền dày/rời:** giảm độ dày viền, nối phần bệ đồng hồ vào táp-lô, hạ màn hình trung tâm và kiểm tra không bị bệ che mặt hiển thị.
6. **Gương phản chiếu phần trong cabin:** hiệu chỉnh góc ngang và độ ngẩng để nhìn ra sau/ra ngoài, thêm kiểm tra hướng tia phản xạ. Tăng render target gương từ 256×128 lên 1024×512 để giảm răng cưa trên hình phản chiếu nhỏ.
7. **Nhìn xuyên khoảng trống dưới táp-lô:** thêm vách khoang chân và tấm ốp hai bên nối với sàn.
8. **Thời gian cách xe hiển thị hàng chục giây khi đã dừng:** giữ khoảng cách mét màu vàng, hiển thị “Đã dừng” khi có xe trước và tốc độ dưới 0,5 m/s. Không thay đổi thuật toán ADAS.

## Kiểm tra trực tiếp đã thực hiện

| Ca kiểm tra | Quan sát |
| --- | --- |
| Cabin 1280×720, 1920×1080, 1024×768 | PRND, ADAS, bàn đạp, camera nằm trong màn hình; đồng hồ 2D trùng lặp được ẩn trong cabin; camera không che cảnh lái |
| Ban ngày / ban đêm | Có hình cabin, đồng hồ và gương; ban đêm nội thất tối hơn, đồng hồ vẫn sáng |
| Bàn phím W rồi S | Quan sát tốc độ tăng trên đồng hồ, sau phanh trở về 0; đây là thao tác kiểm tra ngắn, không phải kiểm thử mọi phím/hardware |
| Số R trong bài lùi xe | Đồng hồ hiện R, camera tự chuyển góc sau, thông báo RCTA xuất hiện khi xe máy cắt ngang |
| Bài điểm mù | Đã quan sát đèn gương phải sáng khi xe máy trong vùng cảnh báo; giữ lại khoảnh khắc bằng tạm dừng. Sau khi phương tiện ra khỏi vùng, đèn trở về trạng thái không cảnh báo |
| Cài đặt BSM | Nút tắt đổi `aria-pressed` về false; bật lại về true và đóng bảng được |
| Xe chết máy phía trước | Cụm đồng hồ, khoảng cách vàng, cảnh báo/phanh và camera 360° cập nhật khi tiếp cận rồi dừng |
| Console trình duyệt | Không ghi nhận mục error/warn trong phiên kiểm tra sau sửa |

Đã khôi phục viewport mặc định sau khi kiểm tra các kích thước khác. Ảnh thực tế sau sửa: [cabin-verified-2026-10-28.jpg](media/cabin-verified-2026-10-28.jpg).

## Build và hồi quy

- `npm run build`: đạt sau thay đổi cuối, có TypeScript.
- Tám bộ headless đạt: `render-geometry-test`, `cockpit-view-test`, `cabin-look-test`, `drive-input-test`, `driving-systems-test`, `adas-brake-test`, `lights-test`, `weather-test`.
- Bài cabin bổ sung kiểm tra hướng nhìn thực của gương, mặt gương giữa, mặt màn hình mới và việc đưa hình camera sang canvas nằm dưới viewport chính.
- Lượt này không chạy lại toàn bộ 23 bộ và không kiểm thử toàn bộ kịch bản trực tiếp trên trình duyệt.

## Đánh giá còn tồn tại

Bố cục và thao tác cabin đã dùng được trong các ca trên. Chất lượng mỹ thuật vẫn đơn giản: hình học và vật liệu thủ tục, táp-lô/gương/ghế còn ít chi tiết, cảnh thành phố dạng khối, chưa có tay tài xế, vải/da được dựng chi tiết hoặc hệ thống treo/biến dạng thân xe kiểu game thương mại. Nội thất ban đêm khá tối. Chưa đo FPS/GPU sau tăng độ phân giải gương, chưa kiểm tra điện thoại, vô lăng/tay cầm thật hoặc xác nhận âm thanh bằng nghe trực tiếp.

ADAS là mô hình mô phỏng, chưa phải hệ thống an toàn đã kiểm định cho xe thật. Các giới hạn vật lý và giao thông đã ghi ở báo cáo v0.6 vẫn còn. Không kết luận ứng dụng hết lỗi hoặc đạt chất lượng game thương mại từ các kiểm tra này.

Bản nguồn trước lượt sửa trực quan được giữ tại `backups/2026-10-28-cabin-visual/`.
