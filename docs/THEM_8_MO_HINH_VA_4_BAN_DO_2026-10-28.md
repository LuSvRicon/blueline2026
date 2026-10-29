# Tích hợp 8 tài nguyên và bổ sung đường — 28/10/2026

## Kết quả

Giữ nguyên danh mục bốn xe người lái VF 9, Santa Fe, Everest, Civic và các cabin/ADAS hiện có. Các xe này tiếp tục được chọn trong **Đổi xe**, đồng thời lần lượt được dùng làm ô tô giao thông. Không gắn ADAS người lái cho mọi NPC: NPC vẫn dùng IDM/MOBIL và các tình huống giao thông của mô phỏng.

Tích hợp từ tám GLB do người dùng cung cấp, không tải thêm tài nguyên hay mua mô hình:

| File đầu vào | Cách sử dụng thực tế |
|---|---|
| OLA Electric Scooter | Xe máy trong giao thông, có người lái mô phỏng, bánh quay và đèn sự kiện |
| Low-Poly Motorcycle #2 | Tách hai mẫu đứng cạnh nhau thành hai biến thể xe máy, căn lại hướng chạy |
| Tata Signa Cargo Truck | Xe tải container, chuẩn hóa dài 15,3 m; kích thước giao thông/va chạm tương ứng |
| City Bus | Xe buýt 12 m; tách vùng bánh khỏi hình học ghép và gắn đèn phanh/đèn trước |
| Hanoi Tube Houses Block | Các cụm nhà phố được lặp bằng InstancedMesh bên ngoài hành lang giao thông; điều chỉnh màu mặt tiền |
| Modular Road Pack + 4K | Tái sử dụng vật liệu PBR mặt đường trên lưới đường liên tục hiện có |
| Modular City Road Pack | Trích mô hình ghế/trạm dừng; giữ đèn tín hiệu của mô phỏng, không dùng đèn tín hiệu tĩnh từ bộ kit |
| Modular Roads Pack | Trích đoạn đường thẳng, căn tỷ lệ làm đường tiếp cận phụ bên đường |

Các bộ kit được trích phần phù hợp, không đặt cả bàn trưng bày các mảnh đường lên đường chạy. Tuyến chính vẫn được dựng theo ReferencePath để cảm biến, điều khiển, làn, biển báo và va chạm xe cùng dùng một hệ tọa độ.

Tổng file gốc khoảng 194 MB, bản phục vụ web khoảng 4,4 MB. Texture tối đa 1024, WebP, meshopt, giảm lưới có giới hạn sai số; không gọi bản runtime này là texture 4K. File gốc trong Downloads không bị thay đổi. Nguồn, tác giả, CC BY 4.0, dung lượng và SHA256 của từng file gốc nằm trong `public/models/world/ATTRIBUTION.json`; giao diện cũng có mục ghi công. Giấy phép Civic cũ CC BY-NC-SA vẫn được giữ nguyên.

## Bản đồ và giao thông

Giữ Phố đô thị, Đại lộ ngoại ô, Đường vành đai. Bổ sung:

| Bản đồ | Bố trí | Biển giới hạn mô phỏng | Giao thông nền |
|---|---|---|---|
| Cao tốc | 3 làn mỗi chiều, dải phân cách | 100 km/h | Ô tô, xe tải, buýt; không xe máy/người đi bộ/đèn đỏ trong kịch bản thường |
| Quốc lộ | 2 làn mỗi chiều | 70 km/h | Ô tô, xe máy, xe buýt, xe tải |
| Đường hai chiều | 1 làn mỗi chiều, vạch vàng | 50 km/h | Có xe ngược chiều, AI không chọn làn đối diện để vượt |
| Khu dân cư | 1 làn mỗi chiều, rộng 3,2 m/làn | 30 km/h | Xe máy và ô tô; không sinh xe tải lớn/buýt trong giao thông nền |

Giới hạn trên là cấu hình bản đồ giả lập, không phải tuyên bố quy định pháp luật cho một tuyến đường thật. Biển báo không tự ép người lái thủ công tuân thủ nếu không bật chức năng hỗ trợ tương ứng.

Road phân biệt số làn cùng chiều và làn ngược chiều. Xe ngược chiều có tốc độ dọc đường âm, hướng thân quay 180 độ, theo xe trước theo hướng di chuyển và nhường người đang băng đường. Cảm biến nhận vận tốc có dấu; hình học va chạm vẫn dùng thân xe quay đúng hướng. Người đi bộ kiểm tra khoảng trống cho cả hai hướng. Hệ thống ghi/phát lại lưu các trạng thái này.

Đô thị tương tác mặc định 48 phương tiện, bố trí tập trung trong khu vực trước xe thay vì rải thưa trên cả vòng. Mật độ giữ lại khi đổi chế độ lái/đặt lại; thanh điều chỉnh cho phép 0–80. Các kịch bản phòng thí nghiệm giữ bố trí có seed riêng. Sửa vùng trống phía sau lúc sinh xe để tránh xe đang chạy nhanh xuất hiện sát xe người lái đang đứng yên.

Sau khi bật bố trí đô thị, khởi tạo lại từ seed để lượt chạy trong trình duyệt dùng cùng bố trí xác định như bài kiểm thử, thay vì tiếp tục từ trạng thái RNG sau lần sinh giao thông ban đầu. Điều này cũng áp dụng khi quay lại Phố đô thị từ bản đồ khác.

Các tình huống chuyển làn không phù hợp bị khóa khi chỉ có một làn cùng chiều. Cao tốc và đường nhỏ khóa những tình huống không phù hợp với cấu trúc bản đồ. Lựa chọn kịch bản không tương thích qua URL được đưa về lưu thông thường.

Lượt chạy dài phát hiện AI có thể dừng mãi khi xe máy bám phía sau trên đường một làn. Đã sửa ba điểm: phanh bảo vệ phía trước chỉ xét vật phía trước; trạng thái lập kế hoạch không nhận gia tốc âm giả khi xe đã đứng yên và đang giữ phanh; khoảng đệm phía sau được giảm khi quỹ đạo đang tách xa xe sau, vẫn giữ kích thước thân xe và khoảng đệm phía trước. Bài hồi quy riêng kiểm tra cả việc đi tiếp và giữ phát hiện chồng thân xe.

## Kiểm tra

- `npm run build`: PASS. Vẫn có cảnh báo gói Three.js core khoảng 552 kB, không phải lỗi build.
- 16 nhóm kiểm thử hồi quy: PASS trong lượt cuối 82,9 giây, gồm bài mới kiểm tra khoảng đệm phía sau (ADAS, AEB xe trước phanh gấp, PRND/phanh, va chạm quét liên tục, cả bốn GLB người lái, cabin/gương/camera, bàn phím, bản đồ, tài nguyên mới, ghi/phát lại và ma trận tình huống).
- Ma trận cũ: 120 lượt 20 giây (20 tình huống × 2 bộ điều khiển × 3 thời tiết), không va chạm xe người lái/ra khỏi đường trong tập kiểm tra.
- Bốn bản đồ mới: 24 lượt 30 giây (4 × AI/ADAS × quang/mưa/sương), có xe ngược chiều di chuyển thật, AI chọn làn hợp lệ, không va chạm/ra khỏi đường trong tập kiểm tra.
- Đô thị 48 xe: AI và ADAS chạy 180 giây, mật độ giữ qua reset, không va chạm/ra khỏi đường trong tập kiểm tra. Bài kiểm tra mở rộng này được chạy lại sau lượt 16 nhóm nói trên và PASS.
- Đường hai chiều với AI chạy ba phút, di chuyển quá 900 m và không va chạm, kiểm tra hồi quy lỗi đứng chờ khi xe máy ở phía sau. Ghi/phát lại khôi phục chính xác cờ xe ngược chiều, vận tốc âm và vị trí.
- Kiểm tra hình học thực của cả tám file; năm rig xe giao thông đúng kích thước, tiếp đất, có bánh quay và vật liệu đèn được gắn vào cập nhật sự kiện.
- Trình duyệt: 8/8 tài nguyên tải, thấy nhà phố/xe container/buýt trong cảnh, đổi bản đồ bằng menu sang cao tốc và đường hai chiều. Ảnh thực tại `docs/media/do-thi-mo-hinh-moi-2026-10-28.jpg` và `cao-toc-hai-chieu-2026-10-28.jpg`.

## Giới hạn còn lại

- Các bản đồ vẫn là tuyến vòng phẳng, chưa có mạng đường tự chọn rẽ, nút lên/xuống cao tốc hay cầu vượt nhiều tầng.
- Đường tiếp cận phụ/ghế trạm dừng là cảnh quan; AI chưa có tuyến rẽ vào đó. Không tuyên bố đã dựng đầy đủ mọi mảnh trong ba bộ kit.
- Nhà/cây/lan can/dải phân cách chưa có vật lý va chạm đầy đủ; va chạm xe và người vẫn do hệ thống hiện có xử lý.
- Tata dùng một thân xe cứng; chưa có khớp đầu kéo/rơ-moóc hay động lực học container riêng. Người ngồi xe máy vẫn là mô hình thủ tục, tay/chân chưa IK theo từng mẫu. Các bánh được tách/gắn chuyển động theo vị trí gần đúng.
- Ngoài vùng gần xe có thể dùng phương tiện thủ tục dự phòng; mô hình chi tiết tải theo nhu cầu trong phạm vi gần. Cây và một phần nhà cao tầng vẫn là mô hình thủ tục.
- Chưa đo FPS chuẩn trên từng thiết bị, chưa kiểm tra mọi kết hợp tình huống trên mọi bản đồ. ADAS là mô hình thử nghiệm trên web, không phải hệ thống xe thật đã kiểm định.

Mã trước thay đổi được sao lưu tại `backups/2026-10-28-world-assets/src`.
