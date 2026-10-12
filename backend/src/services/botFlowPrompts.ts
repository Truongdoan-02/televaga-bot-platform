export const BOT_FLOW_PROMPT_DEFAULTS = {
  welcome: 'Xin chào! Vui lòng chọn nội dung bạn cần hỗ trợ.',
  purchase_contact: 'Để đặt hàng, hãy xác minh số điện thoại đã đăng ký với hồ sơ khách hàng. Telegram chỉ gửi số của chính tài khoản này sau khi bạn đồng ý.',
  contact_button: 'Xác minh số điện thoại',
  order_contact: 'Để tra cứu đơn an toàn, hãy xác minh số điện thoại đã dùng khi đặt hàng. Telegram sẽ gửi số điện thoại của chính tài khoản này cho bot.',
  contact_invalid: 'Để xác minh, hãy gửi số điện thoại của chính tài khoản Telegram trong cuộc trò chuyện riêng với bot.',
  contact_verified: 'Xác minh thành công. Tài khoản Telegram đã được liên kết; bạn có thể chọn Tra cứu đơn hoặc bấm Mua ngay lần nữa để tiếp tục đặt hàng.',
  contact_ambiguous: 'Số điện thoại khớp nhiều hồ sơ nên hệ thống chưa thể liên kết tự động. Hãy liên hệ nhân viên.',
  contact_already_linked: 'Tài khoản Telegram này đã được liên kết với một hồ sơ khác. Hãy liên hệ nhân viên để kiểm tra.',
  contact_unavailable: 'Liên kết tài khoản hiện chỉ hỗ trợ bot đã được cấu hình trong phần Quản lý bot.',
  customer_created: 'Đã tạo hồ sơ khách hàng mới từ số điện thoại bạn chia sẻ. Vui lòng nhập họ tên người nhận hàng.',
  customer_address: 'Vui lòng nhập địa chỉ giao hàng đầy đủ (số nhà, đường, phường/xã, quận/huyện, tỉnh/thành phố).',
  customer_address_matched: 'Số điện thoại đã khớp hồ sơ khách hàng. Vui lòng nhập địa chỉ giao hàng để tiếp tục.',
  customer_saved: 'Đã lưu thông tin khách hàng và địa chỉ giao hàng. Bạn có thể chọn Mua ngay lần nữa để tiếp tục đặt hàng.',
  customer_input_invalid: 'Thông tin quá dài hoặc đang để trống. Vui lòng gửi lại; họ tên tối đa 150 ký tự và địa chỉ tối đa 300 ký tự.',
  order_code: 'Vui lòng gửi mã đơn trong 10 phút. Hệ thống chỉ trả kết quả thuộc tài khoản đã xác minh.',
  purchase_address_missing: 'Hồ sơ đã xác minh nhưng chưa có đủ địa chỉ giao hàng. Vui lòng liên hệ nhân viên để cập nhật trước khi đặt.',
  private_chat_required: 'Để xác minh người mua và địa chỉ giao hàng, vui lòng mở chat riêng với bot rồi chọn Tư vấn sản phẩm.',
} as const;

export type BotFlowPromptKey = keyof typeof BOT_FLOW_PROMPT_DEFAULTS;
export const BOT_FLOW_PROMPT_KEYS = Object.keys(BOT_FLOW_PROMPT_DEFAULTS) as BotFlowPromptKey[];
