# Quản lý tồn kho

Mở menu 9 chấm → Tồn kho.

## Dữ liệu
- product_inventory: product_id (PK/FK), unit, stock_quantity (thực tế), quantity_reserved (đang giữ), minimum_quantity (ngưỡng cảnh báo), updated_at.
- inventory_transactions: id, code, product_id, type, quantity_change, reserved_change, quantity_before/after, reserved_before/after, unit_cost, supplier_code, order_id, reference_code (UNIQUE), note, created_by, created_at.
- inventory_orders: order_id (PK), order_code, state (reserved/fulfilled/cancelled/returned), updated_at.

Có thể bán = stock_quantity − quantity_reserved. Định lượng ml/g/kg/l của sản phẩm không phải đơn vị tồn. Đơn vị tồn được cấu hình riêng như chai, túi, hộp, cái.

## Sử dụng
- Nhập kho: số lượng nguyên dương, giá nhập tùy chọn; nhà cung cấp lấy từ sản phẩm.
- Xuất kho thủ công: số lượng nguyên dương, không vượt số có thể bán.
- Kiểm kê: nhập số thực đếm (có thể bằng 0), xem chênh lệch và ghi lý do; không được thấp hơn số đang giữ.
- Trả hàng thủ công: chỉ nhập lại hàng thực nhận và đủ điều kiện bán; không dùng đồng thời với nhận trả cùng đơn để tránh cộng hai lần.
- Cấu hình: đơn vị tồn và ngưỡng cảnh báo. Đổi tên đơn vị không quy đổi số lượng.
- Giao dịch nhập/xuất/kiểm kê/trả hàng đều phải có lý do. Lịch sử không sửa/xóa; điều chỉnh bằng giao dịch mới.
- Tìm sản phẩm, lọc hàng sắp hết; lịch sử lọc sản phẩm/loại/ngày trên tối đa 500 giao dịch gần nhất (giờ Bangkok).
- Sản phẩm mới có tồn 0. Còn/hết hàng tính từ số có thể bán. Ngừng bán được giữ nguyên dù kho còn hàng.
- Sản phẩm có lịch sử kho không được xóa; chuyển Ngừng bán.

## Đơn Telegram
- Đơn mới tạo sẽ giữ hàng trong cùng transaction tạo đơn, chưa giảm tồn thực tế.
- Tab Đơn giữ hàng: Xuất giao giảm tồn và giải phóng giữ hàng; trạng thái đơn thành SHIPPING.
- Hủy giữ hàng giải phóng hàng, không giảm tồn; trạng thái đơn thành CANCELLED.
- Nhận trả hàng áp dụng cho toàn bộ đơn đã xuất giao, chỉ sau khi thực nhận hàng đủ điều kiện bán. Cộng lại tồn một lần, trạng thái kho returned và đơn CANCELLED; không tự hoàn tiền.
- Xác nhận lặp lại không trừ/cộng kho hai lần. Mọi thay đổi tồn đều khóa hàng và ghi lịch sử trong transaction.
- Đơn cũ trước migration đã được trừ kho theo cơ chế cũ nên không được tự tạo giữ hàng ngược lại. Tab chỉ xử lý đơn mới có inventory_orders.
- Thực hiện các thao tác đơn qua tab này/API, không sửa trực tiếp orders.status trong database; sửa database trực tiếp không tự cập nhật tồn.

## Migration và kiểm tra
Từ backend:

    node --import tsx scripts/migrateInventory.ts .env
    node --import tsx scripts/migrateInventory.ts .env.cloud

Migration chuyển nguyên số tồn từ products.stock_quantity sang product_inventory.stock_quantity, ghi Tồn đầu kỳ, kiểm tra rồi bỏ cột cũ và check constraint liên quan. Dừng backend phiên bản cũ trước migration; khởi động lại bằng mã mới sau migration. Schema mới không tạo lại cột products.stock_quantity.

    node --import tsx scripts/testProducts.ts .env.cloud
    node --import tsx scripts/testPurchaseFlow.ts

Test thứ nhất dùng database thử riêng tự xóa; test luồng mua dùng bảng tạm trên kết nối local, không sửa dữ liệu nghiệp vụ.

API quản trị: GET /api/inventory, GET /api/inventory/history, GET /api/inventory/orders, POST /api/inventory/transactions, PUT /api/inventory/:id/settings, POST /api/inventory/orders/:orderId/action. Có cùng xác thực và kiểm tra origin với các API khác.
## Phiếu kho nhiều sản phẩm
Các nút Nhập kho, Xuất kho, Kiểm kê, Trả hàng và Cấu hình nằm chung ở đầu trang. Bảng tồn không còn nút thao tác riêng từng sản phẩm.

Mỗi lần xác nhận lập một phiếu chứa 1–100 sản phẩm không trùng nhau:
- NK000001: nhập kho; từng dòng có số lượng và giá nhập tùy chọn.
- XK000001: xuất kho.
- KK000001: kiểm kê; từng dòng là số thực đếm.
- TH000001: trả hàng thủ công.
- CH000001: cấu hình nhiều sản phẩm; từng dòng có đơn vị tồn và ngưỡng cảnh báo.

Có thể thêm từng dòng hoặc Thêm tất cả sản phẩm. Lý do/ghi chú dùng chung cả phiếu. Chọn đúng đơn vị tồn; thay đổi tên đơn vị không tự quy đổi lượng.

Bảng inventory_documents lưu id, code, type, note, reference_code UNIQUE, payload_hash, created_by, created_at.
Bảng inventory_document_items lưu document_id + product_id (khóa chính ghép), mã/tên sản phẩm chụp tại thời điểm lập, quantity, unit_cost, quantity_before/after, reserved_before/after, unit_before/after, minimum_before/after.
inventory_transactions bổ sung document_id để các dòng lịch sử nhập/xuất liên kết cùng phiếu. Phiếu cấu hình lưu thay đổi trong chi tiết phiếu, không tạo biến động số lượng.

Toàn bộ dòng được ghi trong một transaction. Một dòng lỗi sẽ rollback cả phiếu. Yêu cầu xác nhận lặp lại cùng nội dung chỉ tạo một phiếu. Mã phiếu tăng riêng theo loại. Phiếu đã ghi nhận không sửa/xóa trực tiếp.

Tab Phiếu kho hiển thị tối đa 200 phiếu mới nhất, lọc loại và xem chi tiết. Lịch sử cũ được giữ nguyên, không tự ghép các giao dịch cũ thành một phiếu giả.
API: GET/POST /api/inventory/documents; GET /api/inventory/documents/:documentId.