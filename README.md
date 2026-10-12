# Demo TeleVaga

Ứng dụng web quản lý hội thoại Telegram, nhiều bot, sản phẩm, luồng mua ngay và thông báo hàng loạt. Nhân viên thao tác trên web; khách hàng tương tác với bot trong Telegram.

## Chức năng hiện có

- **Quản lý bot:** thêm, cập nhật, kiểm tra token, bật/tắt và xem trạng thái; chạy nhiều bot bằng long polling.
- **Hội thoại:** chọn bot, tìm kiếm, phân loại, theo dõi chưa đọc, ghim và quản lý thông tin người dùng.
- **Tin nhắn:** gửi văn bản, ảnh, video, tài liệu; cập nhật qua Socket.IO; hỗ trợ emoji, tìm kiếm, ghim, reaction và chuyển tiếp trong ứng dụng.
- **Nhóm và topic:** hiển thị nhóm, các topic đã lưu và tạo topic Telegram khi bot có quyền phù hợp.
- **Sản phẩm:** danh sách và chi tiết có emoji, giá và trạng thái tồn kho.
- **Mua ngay:** xác minh khách hàng, nhập thông tin nhận hàng và số lượng, chỉnh sửa/hủy, xác nhận đơn và trừ tồn kho.
- **Tra cứu:** kiểm tra đơn và xem tối đa 10 đơn gần nhất của khách đã xác minh.
- **Thông báo:** bản nháp, gửi ngay, đặt lịch, chọn nhóm nhận, đính kèm ảnh/liên kết và theo dõi kết quả.
- **Bảo trì:** cấu hình thông điệp và tùy chọn thông báo khi bật/tắt bảo trì.

### Phạm vi hiện tại

- **Thêm vào giỏ** chỉ minh họa và hiện thông báo nhỏ; không lưu giỏ. Phần xem giỏ hàng và Mini App đã được bỏ.
- **Mua ngay** mua một loại sản phẩm với số lượng khách nhập; đơn mới chưa thanh toán, phí vận chuyển được xác nhận sau.
- AI có API và `AIPanel.tsx`, nhưng panel chưa được gắn vào màn hình chính. Giao diện hiện không có nút giả lập tin nhắn.
- Reaction, ghim và xóa tin tác động lên dữ liệu ứng dụng, chưa đồng bộ các thao tác tương ứng lên Telegram. Tạo nhóm trong web tạo nhóm nội bộ, không tạo nhóm Telegram thật.

Hướng dẫn chi tiết gửi thông báo: [BROADCAST.md](BROADCAST.md).

## Công nghệ và cấu trúc

Frontend dùng Next.js 16, React, TypeScript và Tailwind CSS. Backend dùng Node.js, Express, TypeScript, Socket.IO, MySQL và Google GenAI.

```text
Demo_TeleVagaa/
├── backend/
│   ├── src/
│   │   ├── config/       # Cấu hình môi trường
│   │   ├── controllers/  # Xử lý yêu cầu API
│   │   ├── database/     # MySQL và JSON dự phòng
│   │   ├── routes/       # Các endpoint
│   │   ├── services/     # Telegram, bán hàng, AI, broadcast
│   │   └── index.ts      # Khởi động backend
│   ├── scripts/          # Đồng bộ menu và kiểm thử mua hàng
│   ├── data/             # JSON, khóa mã hóa, uploads, bản sao lưu
│   └── .env.example
├── frontend/
│   └── src/
│       ├── app/          # Trang chính và bố cục
│       ├── components/   # Hội thoại, quản lý bot, thông báo
│       ├── hooks/        # Socket.IO
│       ├── lib/          # API client
│       └── types/
└── BROADCAST.md
```

## Chuẩn bị

- Node.js từ **20.9.0** trở lên theo yêu cầu của phiên bản Next.js được cài trong dự án, kèm npm.
- MySQL và schema nghiệp vụ nếu cần sản phẩm, mua hàng và tra cứu đơn.
- Bot token từ `@BotFather` nếu cần gửi nhận Telegram thật.

Các lệnh dưới đây dùng PowerShell trên Windows. Dùng `npm.cmd` để tránh lỗi chặn `npm.ps1` do Execution Policy.

### Cài dependencies

Chạy từ thư mục gốc:

```powershell
cd backend
npm.cmd install
cd ../frontend
npm.cmd install
cd ..
```

### Cấu hình backend

Sao chép tệp mẫu từ thư mục gốc, rồi thay mật khẩu MySQL và token Telegram bằng giá trị của bạn:

```powershell
Copy-Item backend/.env.example backend/.env
```

Chỉ chạy lệnh sao chép khi chưa có `.env`. Nếu đã có tệp, giữ các giá trị đang sử dụng và chỉ bổ sung những mục cần thiết. Tệp mẫu mặc định dùng bot môi trường với `TELEGRAM_MODE=polling`; nếu quản lý bot qua giao diện, dùng lựa chọn bên dưới.

```env
PORT=5000
CLIENT_URL=http://localhost:3000

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=televaga_demo

# Có thể để trống token môi trường nếu thêm và bật bot trong Quản lý bot.
TELEGRAM_BOT_TOKEN=
# Bot thêm qua giao diện có chế độ polling riêng.
# Chuyển sang polling nếu dùng TELEGRAM_BOT_TOKEN ở trên.
TELEGRAM_MODE=mock
PUBLIC_BACKEND_URL=http://localhost:5000
TELEGRAM_WEBHOOK_SECRET=

# Đặt khóa riêng, ổn định trước khi lưu bot.
BOT_TOKEN_ENCRYPTION_KEY=replace_with_your_own_stable_secret

# Không bắt buộc; để trống sẽ dùng xử lý AI mô phỏng.
GEMINI_API_KEY=
# GEMINI_MODEL=your_available_model_id
```

Backend mặc định thử MySQL tại `localhost:3306`, user `root`, database `televaga_demo`, kể cả khi không khai báo các biến DB. Nếu kết nối thất bại, dữ liệu ứng dụng chuyển sang `backend/data/database.json`.

**Các nghiệp vụ bán hàng cần MySQL.** Backend chỉ tự tạo/cập nhật một số bảng ứng dụng và bản nháp mua, không tự thiết lập toàn bộ schema nghiệp vụ. Các chức năng này dùng `products`, `customers`, `channel_connections`, `customer_channels`, `conversations`, `orders`, `order_items`, `support_requests`, `employees`, `employee_shifts`, `bot_buttons`, `button_events` và `faq_articles` với cấu trúc phù hợp. Tệp `src/database/schema.sql` không phải bộ khởi tạo đầy đủ các bảng này.

Nếu log báo `Missing BNK tables`, cần chuẩn bị schema nghiệp vụ trước khi thử mua hàng. JSON dự phòng không thay thế các bảng bán hàng.

### Cấu hình frontend

Khi chưa có `frontend/.env.local`, sao chép mẫu từ thư mục gốc:

```powershell
Copy-Item frontend/.env.example frontend/.env.local
```

Giá trị mặc định:

```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:5000
```

Nếu đổi cổng hoặc địa chỉ, cập nhật `NEXT_PUBLIC_BACKEND_URL` và `CLIENT_URL` theo đúng backend/frontend. Khởi động lại sau khi sửa biến môi trường; frontend cần build lại khi dùng bản production.

## Khởi động local

Mở hai terminal từ thư mục gốc.

**Terminal 1 — backend:**

```powershell
cd backend
npm.cmd run dev
```

**Terminal 2 — frontend:**

```powershell
cd frontend
npm.cmd run dev
```

- Giao diện: <http://localhost:3000>
- Kiểm tra backend và chế độ lưu trữ: <http://localhost:5000/health>
- Trạng thái tổng hợp Telegram: <http://localhost:5000/api/telegram/status>

Hai endpoint trạng thái không thay thế trạng thái riêng từng bot. Với nhiều bot, xem **Quản lý bot** hoặc `GET /api/bots/:id/runtime`.

## Kết nối bot Telegram

1. Mở **Quản lý bot**, thêm tên và token.
2. Kiểm tra token và bật bot. Backend chạy polling cho từng bot được bật ở chế độ `polling`.
3. Mở bot trong Telegram và gửi `/start` bằng chat riêng.
4. Trên web, chọn đúng bot để xem hội thoại và phản hồi khách.

Có thể cấu hình bot đơn bằng `TELEGRAM_BOT_TOKEN` và `TELEGRAM_MODE=polling`. Khi cùng token đã được quản lý và bật, backend tránh chạy đồng thời hai vòng polling cho token đó. Không chạy thêm backend khác polling cùng token.

Polling chạy được trên local, không cần HTTPS công khai. Bot đang có webhook phải gỡ webhook trước khi bật polling. Backend có endpoint `/webhook/telegram` cho luồng webhook môi trường; chỉ đổi `TELEGRAM_MODE` không tự đăng ký webhook hoặc cấu hình webhook riêng cho mọi bot đã lưu. Hướng dẫn nhiều bot ở trên sử dụng polling.

Bot nhận cập nhật theo quyền Telegram cấp cho nó. Tạo topic cần quyền phù hợp. Đồng bộ topic hiện trả về các topic đã lưu trong ứng dụng, không phải toàn bộ lịch sử topic Telegram.

### Token và sao lưu

Token bot đã quản lý được mã hóa **AES-256-GCM** trong MySQL hoặc JSON; API trả token đã che. Không đưa token thật hoặc `.env` vào mã nguồn hay tài liệu chia sẻ.

Giữ nguyên `BOT_TOKEN_ENCRYPTION_KEY` khi khởi động lại hoặc chuyển máy. Nếu không cấu hình, backend tạo `backend/data/bot-token.key`; cần sao lưu khóa cùng dữ liệu. Thay hoặc mất khóa có thể khiến token đã lưu không giải mã được.

## Trình diễn sản phẩm và mua hàng

Sau khi MySQL và bot sẵn sàng:

1. Gửi `/start`, chọn **Sản phẩm hệ thống**.
2. Chọn **Chi tiết** hoặc **Mua ngay**.
3. Xác minh contact Telegram khi được yêu cầu; nhập tên, điện thoại, địa chỉ và số lượng.
4. Kiểm tra bản xác nhận, chỉnh sửa/hủy hoặc đặt đơn.
5. Dùng **Tra cứu đơn** hoặc **Lịch sử mua** với cùng tài khoản đã xác minh.

Dữ liệu liên kết qua `order_items.order_id = orders.id`. Xác nhận mua sẽ tạo đơn và trừ tồn kho; dùng dữ liệu thử nghiệm khi trình diễn.

Nếu bảng nút chưa khớp menu hiện tại, chạy trong `backend`:

```powershell
npm.cmd run sync:bot-buttons
```

Lệnh này **cập nhật dữ liệu và cấu trúc bảng `bot_buttons`**, đồng thời lưu bản sao lưu trong `backend/data/backups`. Không cần chạy mỗi lần khởi động.

## Thông báo và AI

Xem [BROADCAST.md](BROADCAST.md) để tạo broadcast, chọn người nhận, đặt lịch và bảo trì. Backend phải chạy để xử lý lịch gửi; hủy đợt gửi không thu hồi tin đã gửi.

API AI có tóm tắt, gợi ý phản hồi và trò chuyện theo ngữ cảnh. Khi có `GEMINI_API_KEY`, dịch vụ thử gọi Gemini với model cấu hình; nếu không có khóa hoặc lời gọi thất bại, có xử lý mô phỏng cục bộ. `aiEnabled` trong `/health` chỉ phản ánh có khóa cấu hình, không xác nhận model hoạt động.

`AIPanel.tsx` chưa gắn vào trang chính. Hai bảng `ai_summaries` và `ai_suggestions` đã được bỏ; khi dùng MySQL, kết quả AI giữ trong bộ nhớ và mất khi khởi động lại backend.

## Build và kiểm tra

**Backend:**

```powershell
cd backend
npm.cmd run build
npx.cmd tsx scripts/testPurchaseFlow.ts
node --import tsx --test src/services/broadcastService.test.ts src/services/broadcastImages.test.ts
```

Kiểm thử mua cần MySQL có schema nghiệp vụ phù hợp, dùng bảng tạm thay vì tạo đơn khách hàng thật. Kiểm thử broadcast dùng bộ gửi giả lập.

**Frontend:**

```powershell
cd frontend
npm.cmd run build
node scripts/messageText.test.cjs
```

Sau khi build, chạy `npm.cmd start` trong mỗi thư mục tương ứng để dùng bản đã build.

## Phạm vi vận hành

API quản trị hiện chưa có lớp đăng nhập và phân quyền tài khoản. CORS giới hạn nguồn gọi từ trình duyệt, không phải cơ chế xác thực. Cần bổ sung kiểm soát truy cập trước khi mở API quản trị ra Internet.

Sao lưu MySQL, `backend/data` và khóa mã hóa bot khi chuyển môi trường. Nội dung tin nhắn, hồ sơ khách, broadcast và tệp tải lên có thể nằm ở các nơi lưu trữ khác nhau.
