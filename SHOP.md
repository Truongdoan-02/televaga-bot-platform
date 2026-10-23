# Shop Telegram

Shop Mini App hiển thị danh mục đang bán, ảnh, giá, định lượng, tìm kiếm và chi tiết khi bấm vào sản phẩm. Nút Thêm vào giỏ cập nhật giỏ theo từng Shop trong localStorage; hàng hết không thêm được. Giỏ có sửa số lượng, xóa dòng và tổng tiền.

Nút Mua ngay duy nhất nằm cạnh Tiếp tục mua sắm trong giỏ, mở form họ tên, số điện thoại và địa chỉ nhận hàng. Đặt hàng tạo một đơn nhiều sản phẩm; thành công hiển thị mã TV-… và nút tra cứu. Phí vận chuyển được xác nhận sau; đơn mới chưa thanh toán.

## API và lưu dữ liệu

- GET /api/shop/view?botId=… phục vụ giao diện công khai.
- GET /api/shop/catalog?botId=… trả thông tin sản phẩm công khai, không có token/nhà cung cấp.
- POST /api/shop/orders nhận botId, initData, requestId UUID, name, phone, address và items[{productId,quantity,priceMinor}].
- POST /api/shop/orders/lookup nhận botId, initData và orderCode; chỉ trả đơn Shop thuộc tài khoản Telegram đã ký.

Backend xác minh chữ ký Telegram initData bằng token của đúng bot và auth_date tối đa một giờ. Dữ liệu user ID phía trình duyệt không được dùng làm danh tính. Phiên hết hạn cần mở lại Mini App. Danh mục công khai vẫn xem được ngoài Telegram; đặt hàng và tra cứu yêu cầu mở bằng nút Shop trong Telegram.

Đơn và các mặt hàng dùng orders/order_items hiện có. Cùng transaction: khóa sản phẩm theo thứ tự ID, kiểm tra giá và tồn có thể bán, tạo đơn, giữ hàng trong product_inventory, ghi inventory_transactions và inventory_orders. Nếu một dòng không hợp lệ, toàn bộ thao tác rollback. shop_order_requests giữ scope tài khoản + requestId + payload hash + orderId để nhiều lần gửi cùng yêu cầu trả lại một đơn. Không ghép khách hàng bằng số điện thoại tự nhập; chỉ tái sử dụng tài khoản liên kết đã xác minh hoặc tạo hồ sơ Shop riêng.

Nội dung yêu cầu đang chờ được giữ trong sessionStorage để thử lại khi mất mạng; giỏ chỉ xóa các mặt hàng đã đặt sau khi nhận phản hồi thành công. Mã đơn có thể tra cứu bằng nút Tra cứu đơn trên đầu Shop.

## Cấu hình

PUBLIC_BACKEND_URL dùng HTTPS công khai. TELEGRAM_SHOP_URL có thể ghi đè đường dẫn /api/shop/view. SHOP_WEB_URL mặc định https://vaga.vn/products. Gateway chuyển /api về backend; backend/public/shop.html phải có trong gói triển khai.

Checkout Mini App hoạt động độc lập polling. Không bật cùng token ở cả local và cloud. Luồng mua sản phẩm cũ qua /start buy_<id> trong bot vẫn hoạt động.

## Kiểm tra

    node --import tsx --test src/services/shopService.test.ts src/services/shopOrderService.test.ts
    node --import tsx scripts/testShopOrders.ts
    node --import tsx scripts/testPurchaseFlow.ts

Test Shop Orders tạo database riêng từ schema hiện tại, kiểm tra đơn nhiều mặt hàng, chống trùng đồng thời, rollback, tranh chấp tồn, giá và phân quyền tra cứu, rồi xóa database thử.

Tài liệu xác thực: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
Danh mục có nút Mua ngay từng sản phẩm: mở thẳng form nhận hàng cho 1 đơn vị của sản phẩm đó, dùng cùng API checkout. Mua nhanh không thêm hoặc trừ sản phẩm trong giỏ; giỏ vẫn đặt chung nhiều sản phẩm.

Thanh công cụ xếp ngang: Tra cứu đơn, Giỏ hàng, Shop Web, Lịch sử mua. POST /api/shop/orders/history xác thực initData, trả 20 đơn Shop mới nhất của đúng tài khoản và bot; nextCursor cho trang tiếp. Lịch sử có nút mở chi tiết từng đơn.

## Quản trị đơn hàng

Menu 9 chấm trong hệ thống web có mục Đơn hàng: tìm mã/tên/điện thoại, lọc trạng thái, chi tiết mặt hàng và địa chỉ nhận, phân trang 50 đơn.

API /api/orders (GET danh sách), /api/orders/:id (GET chi tiết), /api/orders/:id/action (POST) nằm sau requireAdmin và requireTrustedOrigin. Thao tác kèm expectedStatus để ngăn cập nhật từ màn hình cũ.

Duyệt NEW → CONFIRMED; chuẩn bị CONFIRMED → PACKING; giao CONFIRMED/PACKING → SHIPPING; hoàn tất SHIPPING → DELIVERED; hủy NEW/CONFIRMED/PACKING → CANCELLED. Giao/hủy dùng cùng applyOrderInventory với màn tồn kho trong transaction, tránh xử lý tồn hai lần khi gửi lại. Đơn cũ chưa có dữ liệu giữ hàng không được xuất kho tự động.

Lịch sử Shop đọc trạng thái trực tiếp từ orders, có Làm mới và tự tải lại sau 15 giây khi đang mở trang đầu. Không tự gửi tin nhắn bot khi quản trị đổi trạng thái.
Carousel đầu Shop lấy ảnh từ catalog sản phẩm, tự chuyển 4,5 giây, vuốt tay/nút/chấm chọn ảnh và mở chi tiết khi bấm. Bỏ qua sản phẩm không có ảnh hoặc ảnh lỗi; tạm dừng khi tương tác, mở dialog, ẩn trang hoặc bật giảm chuyển động.
