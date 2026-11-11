# Kích thước thân xe và hình ảnh — 09/11/2026

Trước thay đổi này, bốn xe dùng chiều dài va chạm 4,7 m và chiều rộng 2,0 m, dù trục cơ sở, khối lượng và mô hình phanh khác nhau. Bản cập nhật dùng kích thước thân riêng cho nhận biết khoảng trống, va chạm và đỗ xe; mô hình 3D được khớp với cùng bao hình đó.

| Xe / thế hệ tham chiếu | Dài thân (m) | Rộng thân (m) | Trục cơ sở (m) | Mức xác minh |
| --- | ---: | ---: | ---: | --- |
| VinFast VF 9 | 5,118 | 2,004 | 3,150 | Dài và trục cơ sở có nguồn hãng; rộng thân 2,004 m là ước định mô phỏng chưa xác minh từ nguồn hãng |
| Hyundai Santa Fe TM facelift | 4,785 | 1,900 | 2,765 | Nguồn Hyundai cho thế hệ TM facelift |
| Ford Everest 2023 | 4,914 | 1,923 | 2,900 | Hướng dẫn sử dụng Ford 2023; chiều rộng không gồm gương |
| Honda Civic Type R FL5 | 4,595 | 1,890 | 2,735 | Factbook Honda Nhật Bản 2022 cho FL5 |

Nguồn chính hãng được đối chiếu:

- [Brochure VF 9 Việt Nam](https://shop.vinfastauto.com/on/demandware.static/-/Sites-app_vinfast_vn-Library/default/dwd7a5ae21/raisinghands/documents/VF9_Brochure_VN.pdf): chiều rộng tổng thể công bố 2,254 m, không dùng thay chiều rộng thân trong tính toán va chạm. Chưa tìm được nguồn hãng xác nhận chiều rộng thân 2,004 m, nên không trình bày con số này là thông số hãng đã xác minh.
- [Hyundai — New Santa Fe, powertrain and features](https://www.hyundai.news/uk/articles/press-releases/hyundai-motor-reveals-powertrain-details-and-features-of-new-santa-fe.html): bảng kích thước TM facelift. Không dùng kích thước thế hệ MX5 mới hơn cho asset TM đang có.
- [Ford Everest 2023 — Kích thước xe](https://www.fordservicecontent.com/Ford_Content/vdirsnet/OwnerManual/Home/Content?ProcUid=G2259072&Uid=G2259047&buildtype=web&countryCode=VNM&div=f&languageCode=vi&moidRef=G910634&userMarket=VNM&vFilteringEnabled=False&variantid=9846): dài bản cơ sở 4,914 m, rộng thân 1,923 m, rộng cả gương 2,207 m, trục cơ sở 2,900 m. Tài liệu còn có biến thể dài 4,940 m; asset Sport hiện dùng bản 4,914 m.
- [Honda Civic Type R FL5 — Factbook 09/2022](https://www.honda.co.jp/factbook/auto/CIVIC_TYPE_R/202209/220901_CIVIC_TYPE_R.pdf): số đo danh nghĩa thị trường Nhật. Asset của tác giả không xác định chắc thị trường; các thị trường có thể làm tròn kích thước khác nhau.

## Cách áp dụng

- `Vehicle.dims` là nguồn kích thước hiện hành. Đổi xe cập nhật cả dài, rộng và trục cơ sở; không đổi vị trí hoặc tốc độ xe chỉ vì chọn mẫu khác. Cấu hình kiểm thử `composite` giữ kích thước cũ 4,7 × 2,0 m và khôi phục kích thước tùy chỉnh của fixture khi cần.
- Asset nhập giữ không gian chuẩn hóa 4,6 × 1,9 m để các vị trí vô-lăng, camera cabin và thiết bị gương đã hiệu chỉnh vẫn dùng được. Khi gắn vào xe, bản sao asset được co giãn theo bao hình vật lý của xe đó. Không thay đổi dữ liệu hình học dùng chung giữa nhiều xe.
- `CarFleet` dựng lại phần thân dự phòng và vị trí thiết bị khi kích thước đổi; giữ nhóm cảnh, trạng thái cabin và đèn ban đêm. Texture màn hình và vân nội thất của xe cũ được giải phóng khi đổi xe.
- Các phương tiện giao thông tiếp tục khớp với kích thước actor riêng của chúng. Không tự đổi kích thước actor của mọi xe trên đường chỉ vì đổi xe người lái.

## Phạm vi và giới hạn

Đây là bao hình chữ nhật danh nghĩa cho mô phỏng, không phải CAD hãng hoặc mô hình va chạm đã chứng nhận. Asset cộng đồng không phân tách chắc chắn phần thân, cánh gió và gương ở mọi mẫu: toàn bộ hình học nhập được khớp vào bao hình thân để tránh phần hiển thị vượt quá vật lý một cách khó đoán. Các gương và đèn cảnh báo cabin bổ sung có thể nhô ra ngoài bao hình; va chạm gương gập riêng chưa được mô phỏng. Chiều cao, vị trí trục chính xác trong asset, tải trọng thực, lốp và mô hình hư hỏng chưa được đo kiểm với xe thật. Thay đổi này không chứng minh ADAS có hiệu năng của xe thật.

## Kiểm thử

`scripts/vehicle-envelope-test.ts` đọc bốn GLB đang sử dụng, kiểm tra bao hình hiển thị trùng kích thước va chạm trong sai số 1 cm, tiếp đất, đủ bốn bánh xe, tiếp xúc trước/hông và tiếp xúc liên tục khi quay xe 60°. Với hai cabin có nội thất thật, kiểm tra tia nhìn đường, gương, màn hình và gương không bị cắt ở khung hình ngang máy tính/điện thoại. Kiểm tra đổi mẫu qua `CarFleet`, bảo toàn chế độ cabin/đèn và giải phóng texture thuộc cabin cũ.

Kết quả tại thời điểm cập nhật: bài kiểm tra mới và build đều đạt. Mười nhóm hồi quy liên quan cũng đạt: imported-vehicles, imported-cabin, detailed-vehicle, cockpit-view, parking-assist, aeb-deep-physics, dynamics-collision, adas-coordination-audit (28 lượt × 60 giây mô phỏng và các tình huống phối hợp chủ động), lateral-audit-20261108 (114 kiểm tra, gồm 32 lượt chuyển làn trên bốn mẫu xe ở đường khô/ướt), extended-audit-20261108 (gồm APA song song/vuông góc của cả bốn mẫu). Tổng thời gian chạy mười nhóm: 183,2 giây. Build còn cảnh báo kích thước gói JavaScript lớn; đó là vấn đề tải trang riêng, không phải bằng chứng về độ mượt trên thiết bị.

Các kiểm tra hình học này không đánh giá được chất lượng hình ảnh, tốc độ khung hình GPU hoặc cảm giác lái trên điện thoại thật. Các mục đó cần chạy ứng dụng trực tiếp; không được ghi là đã xác nhận chỉ nhờ kiểm thử terminal.
