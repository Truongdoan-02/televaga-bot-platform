# Quản lý sản phẩm

Mở menu 9 chấm ở góc trái thanh điều hướng và chọn **Sản phẩm**.

Bảng có mã sản phẩm (duy nhất), tên, định lượng (số + đơn vị ml/l/g/kg), giá VNĐ, nhà cung cấp, tình trạng, mô tả và ảnh sản phẩm (URL HTTP/HTTPS hoặc chọn ảnh từ máy). Hỗ trợ tạo, xem chi tiết, sửa, xóa, tìm kiếm theo mã/tên/nhà cung cấp và lọc tình trạng.

API quản trị:
- GET /api/products
- GET /api/products/:id
- POST /api/products
- PUT /api/products/:id
- DELETE /api/products/:id

API dùng cùng phiên đăng nhập và kiểm tra origin như các API quản trị hiện có. Quản lý sản phẩm cần MySQL.

Dùng chung bảng products với luồng mua hàng Telegram, không tạo danh mục sản phẩm tách biệt. Định lượng được lưu chuẩn hóa dạng số và đơn vị trong packaging, mã vào sku. Ngừng bán tắt is_active. Còn/hết hàng tính từ product_inventory.stock_quantity − quantity_reserved. Sửa sản phẩm không thay đổi tồn. Sản phẩm mới bắt đầu tồn 0; nhập hàng ở mục Tồn kho. Định lượng là khối lượng/thể tích (ví dụ 200 ml, 400 ml, 200 g). Quy cách hộp bao nhiêu viên chỉ nhập trong mô tả. Bảng có cột ảnh thu nhỏ; bấm ảnh để xem ảnh gốc.

Schema được bổ sung khi backend khởi động. Với database cũ, chạy từ backend:

    node --import tsx scripts/migrateProducts.ts .env.cloud

Script chỉ xóa đúng các sản phẩm có mã BNK-DEMO-001 đến BNK-DEMO-005 và tên bắt đầu BNK Demo. Khi chúng đã có đơn, giữ các trường tên sản phẩm/giá/số lượng trong order_items, bỏ liên kết sản phẩm trước khi xóa. Các danh mục và dữ liệu nghiệp vụ khác được giữ. Không chạy lại import dữ liệu demo sau migration.

Kiểm tra CRUD và sinh mã trong database thử riêng, tự xóa database thử sau kiểm tra:

    node --import tsx scripts/testProducts.ts .env.cloud

Sản phẩm đã được tham chiếu bởi đơn hàng với khóa ngoại chặn xóa sẽ trả lỗi 409; chọn Ngừng bán để giữ lịch sử.
Nhà cung cấp chọn từ danh mục nhà cung cấp. Mã sản phẩm được cấp tự động theo tiền tố khi lưu (VAGA → VG001, Tây Bắc TV → TB001). Xem SUPPLIERS.md để biết quy tắc sinh mã và liên kết.

Ảnh từ máy: JPG, PNG hoặc WebP, tối đa 10 MB. Bấm Chọn ảnh từ máy trong form tạo/sửa; ảnh tải lên tự điền đường dẫn và hiện xem trước. Bấm Lưu sản phẩm để lưu liên kết ảnh. Bỏ ảnh chỉ gỡ liên kết trong form. API POST /api/products/images nhận dữ liệu ảnh dạng binary, có cùng xác thực quản trị. Ảnh dùng upload_assets và bộ nhớ đệm tệp hiện có để giữ qua lần khởi động cloud.

Cột products.stock_quantity đã bỏ; dữ liệu tồn chuyển sang product_inventory. Xem INVENTORY.md.
