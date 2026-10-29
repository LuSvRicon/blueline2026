# ADAS BlueLine: nghiên cứu, áp dụng và giới hạn

Ngày đối chiếu: 29/10/2026. Cấu hình: `blueline-composite-2026-10`.

Đây là cấu hình thí nghiệm tổng hợp nhiều nguồn. Bốn mẫu xe 3D hiện dùng chung động lực và bộ điều khiển; chọn VF9/Civic/Santa Fe/Everest **không** nạp ECU hoặc thông số được hãng hiệu chuẩn. Không gọi cấu hình này là bản sao 100% của xe nào.

## Nguồn và phạm vi

- **Kia EV9 26MY**: bản tiếng Anh RHD có mã `MV_EV_en_IN_26MY`, công bố trên website Kia India; nội dung có điều kiện theo trang bị/thị trường. Không suy rộng mọi mục thành trang bị của EV9 Việt Nam. [Mục lục chính thức](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/index.html).
- **Kia EV6**: tài liệu tiếng Anh trên Kia India, dùng riêng cho pha/cốt; không trộn ngưỡng EV6 thành ngưỡng được xác nhận của EV9.
- **Tesla Model Y, tài liệu en_GB**: Traffic Light and Stop Sign Control, phụ thuộc thị trường, tùy chọn, phần cứng/phần mềm. Chỉ tham chiếu cơ chế xác nhận đèn xanh; không phải FSD và không tự rẽ qua giao lộ.
- **Volvo EX90 2025, US, mốc tài liệu 24w36**: Emergency Stop Assist. Tài liệu công khai mô tả hành vi và quyền tiếp quản, không công bố toàn bộ thời gian hiệu chuẩn.
- **Toyota RAV4 Nhật, 17/12/2025 / BMW USA Emergency Stop Assistant**: tham khảo dừng trong làn hoặc lề cao tốc khi điều kiện cho phép. Toyota có điều kiện trang bị/dịch vụ; biến thể BMW trong FAQ yêu cầu người trong xe kích hoạt. EDSS BlueLine kết hợp kích hoạt không phản hồi với chuyển từng làn; không sao chép toàn bộ điều kiện của hai hệ thống.
- **Toyota Prius/Prius PHV, Nhật, thông báo 01/07/2020**: phân biệt hạn chế nhầm ga với phanh vật cản. Không coi PMC đơn giản hiện tại là Toyota Plus Support.
- **Euro NCAP**: dùng để tham khảo tình huống/đánh giá độc lập. BlueLine chưa được chứng nhận và kết quả mô phỏng không phải điểm thử xe thật.

## Đối chiếu toàn bộ nhóm đang có

| Nhóm | Hành vi tham chiếu | Áp dụng / phạm vi hiện tại |
|---|---|---|
| ACC / Stop & Go | Điều kiện D, cảm biến và hệ thống ổn định; phanh hủy; có đặt/phục hồi tốc độ | Giữ thuật toán bám xe, giới hạn giật và khoảng cách thật. Bổ sung lý do không sẵn sàng khi cửa/dây/ESC/ABS/cảm biến không đủ điều kiện. Nhả phanh không tự bật lại. SET tối thiểu 30, tối đa 180 km/h. Dừng lâu cần RES; mốc 3 s là BlueLine. |
| LFA | Giữ giữa làn liên tục, khác LKA | Đổi nhãn cũ vốn gộp cả hai. Giữ Stanley + bù độ cong và mô hình giới hạn bám đường đã hoạt động. LFA không phụ thuộc việc ACC bị người lái hủy. |
| LKA / LDW | Chống lệch/cảnh báo ở tốc độ đủ cao; xi-nhan thể hiện chủ ý đổi làn | LKA riêng từ 60 km/h, chỉ sửa khi dự báo sắp vượt mép làn; tắt LFA không đồng nghĩa mất LKA. LDW xét bề rộng thân xe thay vì chờ tâm xe gần ra khỏi làn. |
| ALC | Hỗ trợ chuyển làn cần ACC + LFA, làn mục tiêu, điều kiện đường, tay người lái và khoảng trống | Theo yêu cầu người dùng, hiện không còn ngưỡng khởi đầu 80/15 km/h. Mặc định hỗ trợ trên đường nhiều làn cùng chiều; giới hạn chỉ cao tốc là tùy chọn riêng. Quỹ đạo theo quãng đường và độ cong, dự báo trước/sau 5–12 s thích ứng tốc độ; đứng yên thì chờ. Mất radar sau/tay/làn hoặc phanh vẫn hủy. Đây là cấu hình BlueLine, chưa phải hiệu chuẩn mọi dải tốc độ của EV9 hay ECU OEM. [Hành vi và kiểm thử](ALC_MOI_DAI_TOC_DO_2026-10-29.md). |
| HDA / ùn tắc | Phối hợp điều khiển dọc và ngang | Thêm trạng thái tổng hợp ACC + LFA trên cao tốc / theo xe dưới 40 km/h. Đây là trạng thái của hai bộ điều khiển đang chạy, không phải tính năng mới chỉ gắn tên. Ngưỡng ùn tắc 40 là BlueLine. |
| Giảm tốc trước cua | Một số hệ thống dùng bản đồ/định tuyến để điều chỉnh tốc độ | Tách công tắc CSA khỏi LFA. BlueLine xem trước độ cong của đường mô phỏng và giới hạn ma sát, không có GPS/bản đồ dẫn đường thật. |
| FCW / AEB / hỗ trợ lực phanh | Cảnh báo và phanh để tránh hoặc giảm mức độ va chạm; khác ACC | Giữ TTC kết hợp khoảng cách dừng, xét nhiều vật cản, đường quét thân xe khi lái tay, bù lực phanh và giữ dừng. Phanh chân hủy ACC nhưng không xóa AEB. Thông số TTC/áp lực là BlueLine, không phải bản hiệu chuẩn Kia. |
| BSM | Nhận biết xe cạnh/sau và cảnh báo trên gương | Giữ đèn gương gắn vào trạng thái cảm biến thật trong mô phỏng. Tách lỗi radar sau khỏi camera trước. Vùng cảnh báo/tốc độ vẫn là mô hình tổng hợp, chưa sao chép đầy đủ ngưỡng theo từng hãng. |
| BCA | Có hệ thống cảnh báo và can thiệp khi va chạm bên hông; cơ cấu can thiệp thay đổi theo hãng/phiên bản | Bổ sung phanh rời chỗ dưới 3 km/h khi có ý định đi về phía xe điểm mù đang đến trên 5 km/h; cần radar sau và ESC sẵn sàng. Sửa hỗ trợ lái để giữ thành phần bù độ cong khi vào cua. Chưa có phanh từng bánh hoặc hiệu chuẩn mô-men vô-lăng OEM. Không đồng nhất với mọi biến thể BCA của Kia. |
| ELK | Can thiệp khi nguy cơ vượt giới hạn đường | Sửa ranh giới về phần đường cùng chiều, không dùng toàn bộ bề rộng gồm cả làn ngược chiều. Giữ bù độ cong. Chưa có toàn bộ nhánh tránh xe đối diện/rào phân cách trong ECU thật. |
| TSR | Nhận biết biển, có thể bị hạn chế bởi camera | Camera lỗi làm TSR không sẵn sàng. Đầu vào vẫn là dữ liệu biển trong thế giới 3D; chưa OCR ảnh hoặc hiểu biển phụ. |
| ISA | Có thông tin, cảnh báo và hỗ trợ thay đổi tốc độ | Có ba lựa chọn: giới hạn, chỉ cảnh báo và đề xuất để người lái nhấn áp dụng vào ACC. Chỉ cảnh báo/đề xuất không tự phanh hoặc đổi tốc độ đặt. Biển ngoài dải đặt ACC không thể được áp dụng bằng nút xác nhận. Chế độ giới hạn hiện tại là mở rộng BlueLine; không tuyên bố là đúng mọi chi tiết ISLA Kia. Ga hết có thể vượt giới hạn; không vượt ưu tiên AEB. |
| USS / camera 360 | Quan sát và khoảng cách đỗ xe | Giữ camera render thế giới thật của mô phỏng và khoảng cách thân xe. Siêu âm lỗi chỉ làm nhóm liên quan không sẵn sàng. Không phải ảnh ghép hiệu chỉnh từ bốn camera vật lý. |
| RCTA / RCCA | Cảnh báo xe tiến đến từ bên hông khi R, dưới 8 km/h; cảnh báo được cả khi xe mình đứng yên | Áp dụng điều kiện tốc độ, chuyển động hướng vào/ra và phân biệt trái/phải. Tầm bên 25 m, xe mục tiêu trên 5 km/h theo tài liệu. Hình học vùng sau/TTC là xấp xỉ BlueLine. Không biến vật đứng yên thành cảnh báo cắt ngang. Tách trạng thái sẵn sàng với cảnh báo; camera báo cần giảm tốc khi vượt 8 km/h. |
| Rear AEB / phanh vật cản khi lùi | Cần phân biệt phanh xe cắt ngang với phanh vật cản đỗ xe | Tách kênh radar sau và siêu âm; công tắc Rear AEB độc lập AEB trước. Giữ phanh khi giữ ga trước vật cản, tránh nhấp nhả/tăng tốc lại. Phanh vật cản bao phủ toàn dải lùi tối đa 16,2 km/h của BlueLine, không bị vô hiệu bởi ngưỡng RCTA 8 km/h. |
| PMC | Hạn chế gia tốc nhầm ga có thể khác phanh vật cản; Toyota có biến thể không cần vật cản | Giữ mô hình gần vật cản + ga lớn + tốc độ thấp và phanh thực. Tách phụ thuộc siêu âm. Chưa học nhận dạng thao tác nhầm ga hoặc tái hiện Plus Support khi không có vật cản. |
| FDA | Nhắc khi xe trước rời chỗ, không tự hiểu đây là lệnh xuất phát | Giữ kiểm tra xe trước từng đứng yên rồi đi xa dần; loại người đi bộ khỏi vai trò xe dẫn. Thời gian/khoảng cách nhắc là BlueLine. |
| SEA | Cảnh báo khi mở cửa; có biến thể gắn khóa trẻ em điện tử | Giữ cảnh báo và khóa thao tác mở hai bên trong mô phỏng. Tắt tính năng hoặc radar lỗi không còn khóa cửa vô điều kiện. Chưa mô phỏng bốn cửa/khóa trẻ em, mở từ ngoài hay xác nhận cưỡng bức như xe tham chiếu. |
| DAW / EDSS | Cảnh báo tăng cấp, dừng có kiểm soát trong làn hoặc tấp lề theo điều kiện; người lái có thể tiếp quản | Trên cao tốc có làn khẩn cấp 3,5 m, giảm tốc rồi kiểm tra xe trước/sau và chuyển từng làn sang phải, vào lề rồi phanh dừng, P + EPB + đèn khẩn cấp. Không có khoảng trống/cảm biến/làn phù hợp thì dừng trong làn. Phản hồi mới bằng ga/phanh/lái hủy điều khiển; sửa nhận biết cả phím lái mượt và bàn đạp tăng lực từ từ. Lưu bộ đếm/quỹ đạo trong replay. Đầu vào tài xế giả lập; không nhận dạng mặt/mắt hay chẩn đoán đột quỵ. [Hành vi, kiểm thử và giới hạn EDSS](LAN_KHAN_CAP_EDSS_2026-10-29.md). |
| HBA | Bật pha trên 40 km/h, hạ dưới 25; gặp xe trước/đối diện thì hạ | Thêm hysteresis để không bật/tắt liên tục quanh một ngưỡng. Giữ liên kết với cường độ/tầm đèn 3D đã có. Khoảng trống 2 s, cự ly 150 m và tắt trong thời tiết xấu là hiệu chỉnh BlueLine. |
| TLA | Có hệ thống dừng đỏ/xanh đi; Tesla TACC/Autosteer có chế độ xác nhận xanh | Giữ chế độ tiêu chuẩn đang hoạt động và thêm chế độ xác nhận riêng. Xanh không có xe dẫn cần nhấp ga; theo xe đang chạy có thể qua; chuyển đỏ xóa xác nhận. Không tự rẽ và không coi mọi xe đều có tính năng này. |
| APA | Cảm biến tìm chỗ, tự D/R/lái/ga/phanh; giữ nút chạy, nhả dừng; xong P + EPB | Giữ quỹ đạo thật qua động lực xe và kiểm tra va chạm. Thêm cửa/dây/động cơ/camera/siêu âm; không cho đỗ ghi đè phanh khẩn cấp hoặc phanh chân. **Chỉ ô song song** gần đường thẳng. |
| RPA | Điều khiển từ xa với nút giữ và kiểm tra xung quanh | Chuẩn bị từ P, có thể khởi động máy, tiến/lùi thẳng 6 m, mất heartbeat phanh. **Chưa có chìa khóa/điện thoại thật, kiểm tra khoảng cách người dùng, tự tìm chuồng hoặc summon.** |

## Danh mục nguồn cụ thể

1. [EV9: điều kiện SCC](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00773.html), [bật SCC, đặt tối thiểu 30](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00774.html), [phục hồi](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00779.html), [tạm hủy](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00784.html).
2. [EV9: phân biệt LFA và LKA](https://www.kia.com/content/dam/kwcms/kme/se/sv/assets/contents/utility/specifications/ev9/kia-ev9-keyfacts.pdf).
3. [EV9: điều kiện ALC](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00830.html), [hủy ALC](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00833.html), [HDA](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00815.html), [HDA standby](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00827.html).
4. [EV9: giới hạn điều tốc theo định tuyến](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00803.html).
5. [EV9: FCA](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00627.html), [phanh khẩn cấp và dải tốc độ theo đối tượng](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00637.html), [giới hạn](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00663.html).
6. [EV9: cảnh báo điểm mù](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00683.html), [phanh BCA khi rời chỗ](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00684.html).
7. [EV9: các cách ISA](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00719.html), [giới hạn nhận biết biển](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00730.html).
8. [EV9: RCTA cảnh báo](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00868.html), [phanh cắt ngang](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00869.html), [kết thúc giữ phanh](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00870.html).
9. [EV9: nhắc xe trước rời chỗ](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00737.html), [giới hạn DAW/FDA](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00741.html).
10. [EV9 RHD 25MY: SEA/khóa trẻ em, trang 567](https://www.kia.com/content/dam/kia2/in/en/service/owners-manual/EV9-Owners-Manual.pdf). Dùng phiên bản 25MY này cho phần mô tả khóa cửa, không khẳng định mọi 26MY có cùng trang bị.
11. [Toyota: Plus Support và ICS, 2020](https://global.toyota/en/newsroom/corporate/33012068.html).
12. [Kia EV6: HBA](https://www.kia.com/content/dam/kia2/in/en/content/ev6-manual/topics/chapter5_20_6.html).
13. [Tesla Model Y: điều khiển đèn và biển dừng](https://www.tesla.com/ownersmanual/modely/en_gb/GUID-A701F7DC-875C-4491-BC84-605A77EA152C.html).
14. [Volvo EX90: Emergency Stop Assist](https://www.volvocars.com/us/support/car/ex90/24w36/article/47d2c97fd33effd3c0a8cc3718c999b7-85596e53922f2e19c0a8cc42679c08ea-8664b2fa77a7e089c0a8296870d1a409/47d2c97fd33effd3c0a8cc3718c999b7-808b6dfdf00162f1c0a8b0975d7ed410-8664b2fa77a7e089c0a8296870d1a409/47d2c97fd33effd3c0a8cc3718c999b7-e6113e73efebc320c0a8b0971179c732-8664b2fa77a7e089c0a8296870d1a409/).
15. [EV9: RSPA2](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00923.html), [thao tác đỗ](https://www.kia.com/content/dam/kia2/in/en/content/ev9-manual/topics/t00934.html).
16. [Euro NCAP EV9 2023 Safety Assist](https://www.euroncap.com/assessments/kia/ev9/1052/), [EV3 2025 Assisted Driving](https://www.euroncap.com/assessments/kia/ev3/a026/). Hai loại đánh giá khác nhau. Cùng tên HDA2 không đảm bảo cùng hành vi qua mẫu xe; EV3 được thử không tự điều tốc qua cua/giao lộ.
17. [Toyota RAV4 Nhật: Driver Emergency Response System, 17/12/2025](https://global.toyota/en/newsroom/toyota/43740895.html), [thông báo giới thiệu, 21/05/2025](https://global.toyota/en/newsroom/toyota/42758168.html). Không suy rộng trang bị/thị trường Nhật thành mọi xe ở Việt Nam.
18. [BMW USA: Emergency Stop Assistant](https://faq.bmwusa.com/s/article/Driver-assistance-systems-Intelligent-driving-Emergency-Stop-Assistant-Operating-principle-ENIS5). Biến thể trong FAQ được kích hoạt bằng người trong xe, khác kích hoạt tự động DMS của BlueLine.

## Những khác biệt cố ý và chưa được hoàn tất

- AEB và phanh lùi BlueLine tiếp tục giữ trước vật cản khi giữ ga, theo yêu cầu chống bò/đâm của dự án. Một số hệ thống hãng cho phép ga mạnh hủy can thiệp, chỉ giữ khoảng 2 s hoặc can thiệp một lần. **Không mô tả cơ chế giữ của BlueLine là bản sao đúng các hệ thống đó.**
- Phát hiện hiện là proxy thế giới + nhiễu/theo dõi/che khuất. Các nút lỗi camera/radar/siêu âm ngắt quyền của từng nhóm, không tạo phần cứng hoặc hợp nhất cảm biến mới.
- Các lan can/dải phân cách có sẵn trong bản đồ được đánh dấu là ranh giới và dùng bề rộng/tọa độ ngang bản đồ để tránh nhiễu biến chúng thành xe trong làn. Đây là đầu vào bản đồ lý tưởng của mô phỏng. Vật cản công trường không được miễn kiểm tra; bài tích hợp kiểm tra cả chặn chuyển làn và AEB hướng vào ranh giới.
- Dải AEB thực của từng hãng khác nhau theo xe đang chạy/đứng yên/người đi bộ/xe máy. Chưa áp dụng toàn bộ ngưỡng và mức giảm tốc theo từng thị trường; BlueLine đang giữ lớp tránh va chạm bảo thủ. Không bảo đảm tránh được va chạm nếu thiếu khoảng dừng/độ bám.
- Chưa mô phỏng đầy đủ mô-men EPS, ESC/ABS từng bánh, nhiệt/lốp/hệ số đường đo được, radar multipath hoặc camera nhận ảnh. Nút ESC/ABS chỉ là đầu vào phòng thí nghiệm để thử điều kiện hoạt động.
- Chưa có toàn bộ biến thể junction-turning/crossing FCA, evasive steering, đỗ vuông góc/chéo, tự thoát ô, triệu hồi tìm đường, theo bản đồ/GPS hoặc dự đoán người đi bộ như xe thương mại. Không thêm công tắc tự nhận là đã có các nhánh này.
- Cần nguồn/chứng cứ theo đúng năm, phiên bản, thị trường và firmware trước khi có cấu hình mang tên xe. Không lấy brochure của một thị trường để hứa chức năng ở Việt Nam.

## Kiểm chứng

- `scripts/adas-motorway-domain-test.ts` chạy ALC với pipeline cảm biến/vật thể bản đồ thực của mô phỏng, kiểm tra đường trống, rào công trường và phanh hướng vào dải phân cách. Bài này tái hiện lỗi tìm được khi lái trên trình duyệt.

- Bộ mới: `scripts/adas-reference-test.ts` kiểm tra điều kiện ACC, mất cảm biến độc lập, miền ALC, LFA/LKA, ISA, xác nhận đèn, HBA hysteresis, tài xế không phản hồi/tiếp quản/replay, RCTA, phanh lùi và liên động đỗ.
- Các fixture RCTA cũ từng dùng tốc độ lùi 72 km/h được sửa về tốc độ lùi có nghĩa. Các bài kiểm tra quỹ đạo ALC ở đô thị/tốc độ thấp dùng rõ chế độ **thí nghiệm**, không dùng để xác nhận miền vận hành cao tốc.
- Các bài kiểm tra phanh vẫn đo khoảng cách thực, va chạm, lực phanh và tốc độ; không thay bằng chỉ kiểm tra đèn báo.
- Kết quả chạy đầy đủ và kiểm tra trình duyệt được ghi riêng trong báo cáo thực hiện; không suy từ build thành “mọi tình huống đã đúng”.
