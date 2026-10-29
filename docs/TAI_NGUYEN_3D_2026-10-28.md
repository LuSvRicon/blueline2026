# Tài nguyên 3D — 28/10/2026

Đã tích hợp Car Concept (GLB, 11,8 MB) của Eric Chadwick / Darmstadt Graphics Group GmbH, 2024, giấy phép CC BY 4.0. Nguồn: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept . README nguồn, giấy phép và điều khoản logo Khronos được lưu cùng mô hình trong `public/models/car-concept/`; có ghi công trong Cài đặt mô phỏng.

Đây là xe concept, không phải VinFast hay Kia. Mô hình được chuyển trục, căn kích thước ngoại thất theo hộp xe hiện có, tách bánh xe và đèn; vật liệu mỗi xe độc lập, hình học được dùng chung. Kính dùng phản xạ đơn giản để giảm chi phí render trong gương. Giữ bộ vật lý/ADAS hiện có và cabin cũ; nội thất chưa đồng nhất với thiết kế ngoại thất concept.

Áp dụng cho xe người lái và tối đa 3 ô tô giao thông ở gần. Các xe còn lại dùng mô hình dự phòng hiện có để giới hạn số draw call. Tải thất bại vẫn dùng xe dự phòng. Chưa có điều chỉnh mức đồ họa/LOD hoàn chỉnh và chưa benchmark FPS trên nhiều GPU.

Mặt đường: hạt vật liệu nhỏ hơn, lọc mipmap/anisotropic, bump và độ nhám theo thời tiết. Nhà: bảng màu vật liệu đa dạng hơn, tầng trệt kính, gờ tầng, cột góc và chi tiết mái bằng InstancedMesh. Đây vẫn là kiến trúc dựng bằng mã, chưa thay bằng bộ phố Việt Nam có texture PBR đầy đủ.

Chưa triển khai: bộ mô hình chính xác VF 7, VF 8, VF 9, Kia; xe buýt/xe máy/người đi bộ chất lượng cao; hoạt ảnh người có skeleton; bộ công trình và mặt đường scan thực tế. Không đổi tên xe concept thành mẫu xe hãng.

Kiểm tra: build production đạt; detailed-vehicle-test (trục/kích thước, vật liệu, bánh, đèn, vòng đời geometry), render-geometry-test, cockpit-view-test, dynamics-collision-test và weather-test đạt. Đã xem trực tiếp xe ngoài đường, camera cabin và camera 360; góc orbit có thể kéo/xoay/phóng gần. Thêm hỗ trợ URL `cam=orbit`.

Giới hạn: GLB tăng dung lượng tải lần đầu; Vite vẫn cảnh báo chunk Three.js lớn. Chưa kiểm thử toàn bộ tình huống ADAS hay xác nhận chất lượng như game thương mại. Ảnh thực tế: `media/xe-glb-2026-10-28.jpg`.
