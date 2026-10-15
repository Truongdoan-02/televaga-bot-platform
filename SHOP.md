# Shop Telegram

Sản phẩm hệ thống gửi một danh sách tóm tắt tối đa 8 sản phẩm với hai nút:
- Shop: mở Telegram Mini App trong chat riêng khi URL Shop dùng HTTPS.
- Shop Web: mở website mua hàng, mặc định https://vaga.vn/products.

Shop có toàn bộ sản phẩm đang bán, ảnh, giá, định lượng, tình trạng tồn, tìm kiếm và cửa sổ Chi tiết. Hàng ngừng bán không xuất hiện. Hàng hết hàng vẫn có thể xem, nút Mua ngay bị khóa.

Mua ngay mở liên kết https://t.me/<bot_username>?start=buy_<product_id> và đóng cửa sổ Shop để tiếp tục đặt hàng trong cuộc trò chuyện với bot. Bot kiểm tra lại sản phẩm, tồn, bảo trì, rồi dùng đúng luồng xác minh liên hệ, nhận tên/điện thoại/địa chỉ/số lượng và xác nhận đơn hiện có. Không tạo đơn chỉ từ thông tin phía trình duyệt.

GET /api/shop/view?botId=<managed_bot_id> phục vụ giao diện công khai.
GET /api/shop/catalog?botId=<managed_bot_id> chỉ trả dữ liệu sản phẩm công khai và tên/username của bot đã được cấu hình; không trả token, nhà cung cấp hoặc dữ liệu quản trị. Không yêu cầu đăng nhập quản trị.

## Cấu hình
PUBLIC_BACKEND_URL phải là URL công khai của backend, có HTTPS để mở Mini App trên Telegram thật.
Có thể đặt TELEGRAM_SHOP_URL=https://<public-domain>/api/shop/view để ghi đè URL Shop.
SHOP_WEB_URL cấu hình website mua hàng, mặc định https://vaga.vn/products.

Gateway production hiện có chuyển /api về backend nên trang Shop và API cùng hoạt động qua domain của ứng dụng. File backend/public/shop.html phải được giữ trong gói triển khai. localhost chỉ dùng thử trên máy; Telegram trên điện thoại không truy cập được localhost của máy phát triển. Khi URL chưa có HTTPS, nút Shop dùng liên kết trình duyệt để tránh gửi web_app không hợp lệ.

Trong nhóm, Shop dẫn về chat riêng qua /start shop để khách mở Mini App và đặt hàng. Bot cần có username và được bật ở nơi xử lý tin nhắn để mua hàng. Danh mục công khai vẫn xem được khi bot ở cloud tạm dừng polling; không bật cùng token ở cả local và cloud.

Kiểm tra:
    node --import tsx --test src/services/shopService.test.ts
    node --import tsx scripts/testPurchaseFlow.ts

Tài liệu Telegram: https://core.telegram.org/bots/webapps và https://core.telegram.org/bots/features#deep-linking