# Thông báo & Broadcast

## Sử dụng

1. Mở tab **Thông báo**, chọn **Tạo broadcast**.
2. Chọn một bot Telegram đang bật, nhóm khách nhận và kiểm tra số người nhận.
3. Nhập tiêu đề, nội dung, chọn ảnh JPG/PNG/WebP từ máy (tùy chọn, tối đa 10 MB), tên nút và URL mở khi bấm nút (tùy chọn).
4. Mặc định lưu bản nháp. Chọn **Gửi ngay sau khi tạo** hoặc **Đặt lịch gửi** để đưa vào hàng đợi. Có thể gửi bản nháp và hủy các tin chưa gửi từ danh sách.
5. Mở chi tiết để xem kết quả của từng khách và lý do lỗi.

Nhóm nhận lấy từ hội thoại riêng đã có trong hệ thống, phân tách theo bot và loại trùng Telegram chat ID. Nhóm VIP/Sales/Hỗ trợ theo phân loại hội thoại; hoạt động trong 30 ngày dựa trên thời điểm cập nhật hội thoại. Danh sách được chốt khi tạo đợt gửi.

Có thêm nhóm nhận **Tất cả: khách, nhóm, kênh và topic** và **Nhóm, kênh và topic**. Các lựa chọn này bao gồm hội thoại đã lưu của bot, loại trùng theo cặp Telegram chat ID/topic ID. Tin topic được gửi với `message_thread_id` để đến đúng chủ đề. Bot cần còn quyền gửi tin tại nơi nhận; lỗi quyền gửi được ghi trong chi tiết đợt gửi.

Giao diện hỗ trợ văn bản thường và HTML. Bản xem trước hiện nguyên văn cú pháp và ảnh đã tải lên. Tổng tiêu đề và nội dung tối đa 4096 ký tự, hoặc 1024 khi gửi kèm ảnh. Ảnh lưu trong `backend/data/uploads` và được tải trực tiếp lên Telegram khi gửi; không cần URL công khai. Lỗi định dạng hoặc khách chặn bot được lưu trong chi tiết kết quả. Các đợt cũ dùng URL ảnh/MarkdownV2 vẫn được hỗ trợ ở backend.

## Bảo trì

Bật bảo trì chặn mua mới và xác nhận đặt hàng trên Telegram, vẫn cho tra cứu đơn và lịch sử mua. Có thể tùy chọn gửi thông báo bắt đầu/kết thúc bảo trì tới khách của một bot được chọn. Lưu cấu hình khi trạng thái không đổi sẽ không tạo thêm thông báo.

Thông báo bảo trì bao gồm cả chat riêng, nhóm, kênh và topic đã lưu của bot được chọn. Các đợt đã tạo giữ nguyên danh sách nhận; phạm vi mới áp dụng cho đợt tạo tiếp theo.

## Vận hành

- Dữ liệu lưu tại `backend/data/broadcasts.json`, ghi thay thế qua tệp tạm; cần giữ thư mục này qua các lần triển khai.
- Hàng đợi chạy trong tiến trình backend, dành cho một instance. Máy chủ cần chạy để xử lý lịch; lịch quá hạn được tiếp tục khi khởi động lại.
- Gửi lần lượt, cách nhau khoảng 1,1 giây, có xử lý phản hồi Telegram 429. Mỗi người chỉ được gửi một lần trong một đợt. Tin đang gửi khi máy chủ dừng được đánh dấu cần kiểm tra để tránh tự gửi trùng.
- Hủy dừng các tin chưa gửi; tin đang gửi có thể hoàn tất. Không thu hồi các tin đã gửi.
- Backend dùng cơ chế truy cập hiện có của ứng dụng; không bổ sung hệ thống tài khoản/phân quyền mới.

## Kiểm tra

```powershell
cd backend
node --import tsx --test src/services/broadcastService.test.ts
npm.cmd run build
cd ../frontend
npm.cmd run build
node node_modules/eslint/bin/eslint.js src/components/Notifications.tsx
```

Kiểm thử dùng bộ gửi giả lập, không gửi tin Telegram thật.
