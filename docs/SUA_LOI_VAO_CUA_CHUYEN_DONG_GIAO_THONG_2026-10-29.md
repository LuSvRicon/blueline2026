# Sửa vào cua, chuyển động và giao thông — 29/10/2026

## Trạng thái xác minh

Đã sửa mã nguồn và kiểm tra bằng các bài chạy mô phỏng. Chưa xác nhận bằng cách trực tiếp chơi trên trình duyệt trong đợt này: hai lần mở bằng công cụ đều trả về `Local browser use is disabled in Work settings`. Người dùng đang làm việc từ xa; không yêu cầu họ xác nhận lại hoặc giả định rằng quyền đã được bật. Không có ảnh/video sau sửa hoặc số đo FPS GPU mới.

## Nguyên nhân và thay đổi

### 1. Giảm tốc trước cua

- ACC trước đây luôn giới hạn phanh thông thường ở khoảng 2,8 m/s². Khi bật ACC từ một đoạn thẳng ở tốc độ cao gần cua, quãng đường còn lại có thể không đủ cho mức phanh này dù vẫn đủ cho một mức phanh mạnh hơn.
- Bổ sung tính mức giảm tốc theo khoảng cách đến từng đoạn cong. Khi cần, ACC yêu cầu phanh mạnh hơn trong giới hạn của xe và mặt đường. Không đánh dấu phanh qua cua thành AEB tránh va chạm.
- Cảnh báo giới hạn giữ làn xét thêm 1,5 giây đường phía trước, thay vì đợi lốp đã đạt giới hạn ngay tại cua.
- Phanh chân vẫn hủy ACC. Khi ACC tắt hoặc người lái dùng ga để vượt quyền ACC, giữ làn không tự chiếm điều khiển chân ga/phanh. Nếu chạy quá nhanh đến mức không còn đủ độ bám/quãng phanh, mô hình vẫn có thể lệch làn và yêu cầu người lái giảm tốc; không tăng độ bám vô hạn để che lỗi.
- Trường hợp hồi quy: bắt đầu tại s=150 m, 140 km/h, đường nhỏ, không dùng biển tốc độ để che lỗi, ACC điều tốc và giữ làn với giới hạn bám bật. Trước sửa, lệch tâm lớn nhất khoảng 14,7 m ở đường khô và 29,6 m khi mu=0,72. Sau sửa, 12 tổ hợp phố/đường nhỏ, 100/120/140 km/h, mu=1/0,72 đều lệch tối đa không quá 0,034 m và không bão hòa độ bám. Đây là phép thử sức ép bộ điều khiển, không phải tốc độ khuyến nghị cho đường nhỏ.

### 2. Chuyển động hình ảnh

- Thêm `RenderMotion`: nội suy vị trí/góc quay giữa hai bước vật lý cho xe người lái, xe nền và người đi bộ. Camera chính, camera phụ và cảm biến hiển thị dùng cùng vị trí xe đã nội suy.
- Đạo hàm tăng/giảm tốc và dịch chuyển ngang phục vụ hoạt ảnh được tính theo bước vật lý, tránh thay đổi giả do một khung hình không có bước vật lý rồi khung tiếp theo có hai bước.
- Ngừng nội suy qua tạm dừng/reset; góc quay đi theo góc ngắn nhất qua ±π. Không ghi vị trí hiển thị trở lại vật lý/cảm biến/va chạm.
- Giữ nguyên mức chi tiết cao; gắn nhiều mô hình nhập vào từng khung hình, tối đa một xe nền mỗi khung, để giảm đợt công việc dồn vào một khung. HUD/radar cập nhật tối đa 30 Hz, tách khỏi nhịp dựng hình chính.
- Kiểm tra đều bước hiển thị ở 30/60/75/120/144/165 Hz. Đây là kiểm tra phép nội suy, **không phải kết quả đo FPS thực tế** và chưa chứng minh GPU máy người dùng hết giật.
- Giảm việc quét lại toàn cung đường khi xác định tọa độ theo đường của đối tượng cảm biến: vật thể đứng yên dùng kết quả đã có, vật thể di chuyển gần dùng chỉ số mẫu đường gần nhất từ bước trước, vật thể mới hoặc dịch chuyển xa vẫn quét toàn bộ. Vị trí xe người lái được tính một lần trong bước cảm biến, thay vì lặp cho mỗi vật thể tĩnh.
- `projection-cache-test` đối chiếu **56.000** quan sát di chuyển trên cả 7 bản đồ, hai chiều, các độ lệch ngang, nhiễu, qua điểm nối vòng và dịch chuyển xa; kết quả khớp chính xác với phép quét toàn bộ. Đo riêng 9.600 truy vấn vật thể tĩnh trên bản đồ cao tốc trong lượt kiểm tra: khoảng 92,4 ms khi quét toàn bộ và 2,3 ms khi dùng cache. Đây chỉ là phép đo CPU của khâu tìm vị trí, không phải tốc độ khung hình toàn game.

### 3. Xe dừng và kẹt đường

- Va chạm giữa các xe thông thường trước đây đặt `disabled=true` vĩnh viễn. Nay xe dừng tối thiểu 3 giây rồi kiểm tra toàn bộ phần thân quét trên đường đi tiếp. Chỉ tiếp tục bằng vận động IDM khi đường trống và hướng xe đủ thẳng.
- Không xóa xe, dịch chuyển xe hay tắt va chạm để thông đường. Xe hỏng theo tình huống, xe cắt ngang bị va chạm, xe đâm vật thể cố định hoặc người đi bộ vẫn giữ trạng thái dừng. Chưa có hệ thống cứu hộ/di dời các xe này.
- Xe đổi làn có thể bị chặn sau khi đã chọn làn đích. Nếu đứng giữa hai làn quá 1,2 giây, xe hủy ý định nhập làn, chọn lại làn đang thực sự chiếm; mọi chuyển động trở lại vẫn chịu kiểm tra thân xe quét.
- Một bài chạy dài đã phát hiện xe con đứng giữa hai làn quá lâu, sau đó bị đuôi xe tải quét trúng tại 244,25 giây. Bổ sung xử lý hủy nhập làn và điều kiện hồi quy về thời gian chờ giữa làn; không bỏ kiểm tra va chạm để làm bài thử qua.
- Lượt chạy dài tiếp theo phát hiện xe tải/xe buýt va quệt tại 237,90 giây. Danh sách xe chiếm làn có chỗ giả định hàng xóm rộng 1,9–2 m, bỏ sót phần thân xe tải mà xe buýt rộng 2,55 m có thể chạm. Đã thay bằng bề rộng phương tiện thực và thêm biên quét đuôi của thân xe dài trên đường cong. Bài thử riêng đặt xe tải d=1,2 m giữa hai làn, xe buýt chạy tới ở làn bên cạnh; xe buýt phải xếp hàng trước xe tải, không va chạm.
- Phép thử một seed khác tiếp tục bắt va quệt xe máy nhập làn/xe tải ở 110,43 giây. Đã bổ sung dự báo thân xe có hướng quay trong 3,6 giây cho AI giao thông: xe phía sau giảm tốc khi dự báo đường quét của nó trùng với xe phía trước, bao gồm đường cong và chuyển làn. Lệnh phanh vẫn tích phân theo thời gian, trong giới hạn 8 m/s² sẵn có của mô hình NPC; không dùng thao tác đặt tốc độ bằng 0 hoặc bỏ bộ va chạm để làm bài dự báo đạt. Bài thử riêng kiểm tra cả giới hạn thay đổi tốc độ từng bước và không va chạm.
- Phần dự báo được lưu ngắn hạn 0,1 giây và tái tính khi đổi làn, để hạn chế chi phí CPU. Đây là logic dự báo của tác nhân giao thông trong mô phỏng, không phải một cảm biến đọc ý định của người lái thật.
- Phương tiện cắt ngang chưa được kích hoạt, đang đứng ngoài đường (ví dụ tình huống chỉ chạy khi vào R), không còn tạo dự báo cắt ngang giả cho xe đang đi D. Người đi bộ đang chờ ngoài hành lang xe chạy không tạo quỹ đạo sang đường giả.
- Vận tốc ngang gửi vào cảm biến được tính theo chuyển động đã thực hiện. Trước đó công thức vẫn dùng yêu cầu nhập làn chưa giới hạn (có thể khoảng 9 m/s) dù xe thực sự chỉ dịch ngang tối đa 1,1 m/s; dự báo tạt đầu vì vậy có thể gây phanh không hợp lý. Bổ sung kiểm tra đối chiếu vận tốc cảm biến với dịch chuyển d thực tế theo từng bước.
- Thêm trạng thái nguyên nhân dừng: chờ xe/đèn đỏ/đèn vàng/người đi bộ/xe cắt ngang/đón trả khách/va chạm/xe hỏng/nhập làn. Cụm thông tin xe trước hiển thị lý do khi xe đó đứng yên; tooltip phân biệt dữ liệu AI của mô phỏng với nhận định từ cảm biến ADAS.

### 4. Xe tải che khuất sai xe ở làn bên cạnh

- Đợt hồi quy đầu phát hiện AI cổ điển có thể đâm đuôi xe ở phố đông. Tại 33,15 giây, cảm biến chỉ báo xe tải ở làn bên cạnh và bỏ mất xe cùng làn.
- Nguyên nhân: góc che khuất dùng nửa chiều dài xe tải thay cho đường bao thân xe nhìn từ mắt cảm biến; chỉ kiểm tra tâm góc của mục tiêu. Xe tải dài vì thế có thể che nhầm nhiều làn.
- Thay bằng phép chiếu bốn góc thân xe có hướng quay thực tế. Chỉ bỏ mục tiêu khi toàn bộ khoảng góc của nó bị vật phía trước che. Mục tiêu còn lộ một phần vẫn được nhận biết; không tắt chức năng che khuất hay đưa vật thể hoàn toàn bị che vào cảm biến.
- Kích thước dùng cho che khuất tách với kích thước quy chiếu theo đường dùng cho bộ theo dõi. Tầm nhìn, mất tín hiệu và nhiễu vẫn được giữ lại.
- Bổ sung `sensor-visibility-test`: xe dài ở làn bên, che hoàn toàn/che một phần, thân xe quay ngang, giới hạn tầm cảm biến và công tắc che khuất.

## Kiểm tra

- Build production: đạt. Cảnh báo kích thước gói Three.js khoảng 552 kB vẫn còn.
- `acc-curve-recovery-test`: 12 tổ hợp tiếp cận cua; quyền ưu tiên ga/phanh; cảnh báo cua sớm.
- `render-motion-test`: nhịp dựng hình khác nhau, góc ±π, pause/reset, không thay đổi trạng thái vật lý.
- `runtime-recovery-test`: tạo một va chạm từ phía sau thật trong Simulation, xe dừng rồi tự đi tiếp; chưa đi khi đường bị chặn; xe hỏng giữ nguyên; tình huống R chưa kích hoạt không gây phanh giả trong D.
- Fixture RCTA cũ chỉ đặt lệnh cắt ngang nhưng chưa đánh dấu xe máy đang chuyển động. Sau khi tách vận tốc thật khỏi lệnh dự kiến, fixture được bổ sung `crossingStarted=true` cho ca **xe máy đang cắt ngang**, giữ nguyên các yêu cầu phải cảnh báo trái và Rear AEB phải chặn lùi ngay. Ca **chưa kích hoạt** được kiểm tra riêng và phải có vận tốc cảm biến bằng 0. Không nới ngưỡng an toàn hoặc bỏ kiểm tra RCTA để vượt bài thử.
- `traffic-flow-test` sau sửa dự báo: 3 seed × khô/mưa × 300 giây, 48 xe nền. Không va chạm nền; trung bình mỗi xe đi 3.340–3.556 m, không phải kết quả do đóng băng tất cả xe. Nhật ký `runtime-repair-2026-10-29/predictive-flow.log`, đạt 2 nhóm trong 188,8 giây.
- Các lượt hồi quy trung gian giữ cả lỗi phát hiện và kết quả chạy lại. Không coi những lượt còn lỗi là bộ đạt.

### Kết quả cuối cùng và phạm vi

- Build production của mã cuối: **đạt** (`runtime-repair-2026-10-29/build.log`).
- Bộ đầy đủ **50 nhóm** đã được chạy trước sửa thân xe/dự báo cuối: **49 đạt, 1 lỗi `traffic-flow-test`**, trong 1.002 giây. Nhật ký giữ nguyên tại `full-regression-before-wide-body.log`; không gọi lượt này là 50/50 đạt. Lỗi tìm được là các va quệt giao thông đã nêu ở trên.
- Sau sửa bề rộng, ma trận **690** tổ hợp bản đồ/tình huống/bộ điều khiển/thời tiết đã đạt, nhưng bài chạy giao thông dài hạn vẫn tìm ra va quệt khác. Nhật ký `wide-body-final.log` phản ánh đúng lỗi đó. Sau đó bổ sung dự báo thân xe và phanh NPC; không tuyên bố đã lặp lại toàn bộ 690 tổ hợp sau thay đổi dự báo này.
- Với **mã cuối có dự báo thân xe**, `predictive-flow.log` đạt sáu lượt 300 giây/48 xe với 3 seed × khô/mưa, không va chạm nền; `predictive-merge-unit.log` đạt ca xe tải phanh tích phân tránh xe máy đang nhập làn ở cua.
- Lượt hồi quy cuối trên mã đó: **10/10 nhóm đạt trong 362,9 giây**, tại `final-regression.log`: `all-scenarios-smoke`, `adas-brake-test`, `aeb-following-test`, `driving-systems-test`, `dynamics-collision-test`, `road-profiles-test`, `static-traffic-adas-test`, `record-replay-test`, `learn-test`, `evo-test`.
- Giới hạn còn lại: chưa kiểm tra hình ảnh/FPS/thao tác bằng cách chơi trực tiếp; xe container vẫn là thân cứng, chưa có động lực học khớp nối rơ-moóc; chưa có cứu hộ/di dời xe bị hỏng hoặc xe sau va chạm nghiêm trọng. Các kết quả trên không chứng minh mô phỏng hết mọi lỗi hay tương đương một hệ thống trên xe thật.

## Còn cần kiểm tra trực tiếp

1. Lái bàn phím ở đoạn thẳng/cua, ACC bật/tắt, nhấn ga/phanh/xi-nhan; cảm nhận vô-lăng và quyền tiếp quản.
2. FPS và frame pacing khi các mô hình mới tải, chạy trong cabin với gương, camera 360°, trời mưa, mật độ cao.
3. Tầm nhìn/các cảnh dừng đèn, va chạm và phục hồi trên màn hình thật. Nhãn trạng thái giao thông dài trên cửa sổ hẹp chưa được kiểm chứng bằng ảnh.

Không coi bộ kiểm tra terminal là thay thế cho ba phần này. Bản sao các tệp chính trước sửa: `backups/2026-10-29-runtime-repair/`.

Máy chủ phát triển đã được mở lại ở `http://127.0.0.1:5174/`. Kiểm tra HTTP xác nhận các module nội suy, cảm biến và Simulation mới được phục vụ với mã 200; đây chỉ là kiểm tra máy chủ/mã nguồn, không phải bằng chứng đã chơi thử.
