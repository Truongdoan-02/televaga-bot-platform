# Demo miễn phí: Render + Aiven MySQL

## Trạng thái
Đã triển khai demo tại https://televaga-demo.onrender.com/login trên Render Free, kết nối MySQL Aiven qua TLS. Database nghiệp vụ đã được chuyển; kiểm thử online đăng nhập, API, WebSocket và đăng xuất đều đạt. Hai bot cloud đang tắt; dừng backend local trước khi bật bot cùng token trên cloud. Dashboard: https://dashboard.render.com/web/srv-db6q7g0m7kps73au0bug.

## 1. Tạo MySQL Free
Đăng nhập https://console.aiven.io/ và tạo **MySQL – Free**, tránh chọn gói trial/paid. Lấy host, port, user, password, database và CA certificate từ Overview. Không đưa thông tin bí mật vào Git hoặc chat.

Gói miễn phí hiện có 1 GB dung lượng. Chọn vùng gần Singapore nếu có trong lựa chọn Free.

## 2. Chuyển database
Dừng thao tác tạo đơn trong lúc chụp dữ liệu demo. Chạy từ thư mục gốc:

~~~powershell
node backend/scripts/exportDemoDatabase.cjs
~~~

SQL được lưu vào backend/data/backups (đã bị Git bỏ qua), lấy đủ schema và dữ liệu database trong backend/.env. Import SQL vào database Aiven **trống** bằng MySQL Workbench: tạo connection với thông số Aiven, SSL Verify Identity và CA certificate, rồi Data Import / Import from Self-Contained File. Chọn đúng database đích, không import lên database đang có dữ liệu. File schema.sql trong repo không có đủ schema bán hàng.

Giữ nguyên khóa BOT_TOKEN_ENCRYPTION_KEY đang dùng. Nếu backend/.env không có khóa, khóa hiện tại nằm ở backend/data/bot-token.key. Tôi đã chuẩn bị giá trị tương đương dạng base64: trong backend/data/backups/render-bot-key.env; sao chép giá trị sau dấu = vào biến BOT_TOKEN_ENCRYPTION_KEY trên Render. Tệp này là bí mật, không đưa vào Git hoặc chat. Không tự thay bằng khóa mới khi đã import managed_bots. Có thể thêm lại bot thủ công trên database demo mới nếu không chuyển các token cũ.

## 3. Render Free
Đưa các thay đổi lên repository GitHub, sau đó Render → New → Blueprint → chọn repository → render.yaml. Cấu hình chỉ tạo một web service plan free, không tạo database trả phí. Auto deploy đang tắt để chủ động kiểm soát chuyển bot.

Điền các biến mà Blueprint yêu cầu:

| Biến | Giá trị |
| --- | --- |
| ADMIN_PASSWORD | Mật khẩu admin mong muốn (local hiện dùng 123456) |
| BOT_TOKEN_ENCRYPTION_KEY | Khóa ổn định khớp bot đã import |
| DB_HOST / DB_PORT / DB_USER / DB_PASSWORD | Thông số Aiven |
| DB_NAME | Database Aiven đã import |
| DB_SSL_CA | Toàn bộ PEM CA certificate (xuống dòng thật hoặc literal \n) |

Gateway lấy CLIENT_URL và PUBLIC_BACKEND_URL từ RENDER_EXTERNAL_URL, chạy frontend/backend cùng origin. Cookie Secure + SameSite=Lax, không phụ thuộc cookie bên thứ ba. Build ép NEXT_PUBLIC_BACKEND_URL rỗng để trình duyệt gọi cùng origin; local vẫn dùng frontend/.env.local hiện tại.

DB_REQUIRED và BNK_REQUIRED bật: deploy sẽ báo lỗi nếu MySQL/TLS không hoạt động hoặc thiếu schema nghiệp vụ. Không chuyển sang JSON để che lỗi. Backend có thể tạo/cập nhật bảng ứng dụng trên database demo, nên dùng bản sao dành riêng cho demo.

## 4. Kiểm tra trước khi chạy bot
Mở URL Render: /health trả status ok, /login cho đăng nhập, /api/bots không cookie trả 401. Kiểm tra bot, sản phẩm và tạo đơn thử bằng dữ liệu thử nghiệm. Dừng backend local trước khi bật bot cùng token trên Render để tránh hai tiến trình polling. TELEGRAM_MODE=mock chỉ tắt bot môi trường; bot quản lý đã bật trong database có thể tự polling khi khởi động.

## Giới hạn
Render Free ngủ sau 15 phút không có truy cập; bot không nhận tin trong lúc ngủ. Không dùng thủ thuật giữ thức. JSON và tệp chỉ có trên ổ Render không được lưu bền. Uploads, avatar và media Telegram hiện được lưu trong MySQL theo các khối 1 MB, có cache local; vẫn đọc được sau restart/deploy. Dung lượng media dùng chung giới hạn 1 GB của MySQL Free, nên chỉ dùng cho demo nhỏ. Phiên đăng nhập mất khi backend khởi động lại.

Tài liệu: https://render.com/docs/free và https://aiven.io/docs/products/mysql/concepts/mysql-free-tier

### Broadcast history persistence

Broadcast history, recipient delivery states, scheduled broadcasts, and maintenance settings are stored atomically in MySQL table `broadcast_state`. The legacy `data/broadcasts.json` file is imported only when no database state exists; local development without MySQL still uses the file. Database read/write errors are surfaced instead of silently falling back to ephemeral storage. Interrupted deliveries are marked unknown and are not automatically resent. Render Free sleep still delays scheduled delivery until the service resumes.

Before deploying this migration to an existing disk-only service, run `node backend/scripts/migrateBroadcastHistory.cjs` while no broadcasts are sending. It saves a private backup and imports live API history into MySQL without overwriting existing durable history. Previously lost history cannot be reconstructed by this migration.
