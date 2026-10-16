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
