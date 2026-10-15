# Quản lý nhà cung cấp

Trong menu 9 chấm, chọn **Nhà cung cấp** để tạo, xem, sửa, xóa; tìm kiếm mã/tên/liên hệ/SĐT/email/mã số thuế và lọc tình trạng.

Bảng MySQL suppliers gồm:
- code VARCHAR(20) PRIMARY KEY; hệ thống cấp NCC001, NCC002… qua catalog_sequences trong transaction.
- name VARCHAR(255) NOT NULL.
- contact_name VARCHAR(100), phone VARCHAR(20), email VARCHAR(255), address VARCHAR(500).
- tax_code VARCHAR(20) UNIQUE NULL.
- bank_account VARCHAR(50), bank_name VARCHAR(150).
- status TINYINT NOT NULL DEFAULT 1 (đang hợp tác); 0 là ngừng hợp tác.
- note TEXT, created_at/updated_at DATETIME tự động.

MySQL không hỗ trợ AUTO_INCREMENT cho VARCHAR. Bộ đếm đảm bảo mã chữ tự tăng, không trùng khi lưu đồng thời và không tái sử dụng sau xóa.

Chỉ tên bắt buộc, không chấp nhận tên toàn dấu cách. Các ô tùy chọn trống/null được lưu NULL. SĐT bỏ dấu cách, dấu ngoặc, dấu gạch; chấp nhận 10–11 số bắt đầu 0 hoặc số quốc tế + mã quốc gia (8–15 số). Email được trim, đổi chữ thường và kiểm tra cấu trúc. Mã số thuế chấp nhận 10/13 chữ số hoặc 10 số-3 số; bỏ dấu gạch để kiểm tra trùng nhất quán. Để trống mã số thuế không xung đột UNIQUE.

Sản phẩm bắt buộc chọn nhà cung cấp. Chỉ nhà cung cấp đang hợp tác được chọn cho sản phẩm mới. Sản phẩm hiện hữu vẫn được sửa nếu giữ nhà cung cấp đã ngừng hợp tác. Nhà cung cấp đang có sản phẩm không thể xóa; API trả 409 và đề nghị ngừng hợp tác.

Mã sản phẩm:
- VAGA → VG001, VG002…
- Tây Bắc TV → TB001, TB002…
- Tên khác: bỏ dấu tiếng Việt và lấy chữ đầu của hai từ đầu; tên một từ lấy hai ký tự đầu.
- Nhà cung cấp có cùng tiền tố dùng chung bộ đếm để bảo đảm mã sản phẩm duy nhất.
- Cấp mã chính thức khi lưu; không cho nhập mã tay.
- Sửa thông tin sản phẩm giữ nguyên mã. Đổi sang nhà cung cấp khác cấp mã mới theo tiền tố mới.
- Đổi tên nhà cung cấp cập nhật tên hiển thị ở sản phẩm, giữ mã sản phẩm đã cấp.

API quản trị: GET/POST /api/suppliers; GET/PUT/DELETE /api/suppliers/:code. Dùng cùng phiên đăng nhập và kiểm tra origin như các API khác.

Migration tự chạy khi backend khởi động hoặc chạy từ backend:

    node --import tsx scripts/migrateProducts.ts .env.cloud

Migration bổ sung products.supplier_code cùng khóa ngoại; tên nhà cung cấp dạng văn bản cũ được chuyển thành bản ghi nhà cung cấp và liên kết lại, không đổi mã sản phẩm cũ.

Kiểm tra CRUD/validation/sinh mã đồng thời trong database thử riêng:

    node --import tsx scripts/testProducts.ts .env.cloud

Script tạo catalog_test_<timestamp>, chạy migration và kiểm tra, sau đó xóa đúng database thử. Không thay đổi dữ liệu nghiệp vụ hoặc tiêu thụ số thứ tự của database chính.