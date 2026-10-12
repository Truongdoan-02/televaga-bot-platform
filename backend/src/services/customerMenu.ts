export const CUSTOMER_MENU = [
  { id: 'vaga_products', code: 'CONSULT', label: '🛍️ Sản phẩm hệ thống', action: 'consult', actionCode: 'SHOW_PRODUCTS', enabled: true, sortOrder: 0 },
  { id: 'vaga_orders', code: 'ORDER', label: '📦 Tra cứu đơn', action: 'order_lookup', actionCode: 'LOOKUP_ORDER', enabled: true, sortOrder: 1 },
  { id: 'vaga_history', code: 'HISTORY', label: '🧾 Lịch sử mua', action: 'purchase_history', actionCode: 'PURCHASE_HISTORY', enabled: true, sortOrder: 2 },
  { id: 'vaga_website', code: 'WEBSITE', label: '🌐 Mua qua website', action: 'url', actionCode: 'OPEN_WEBSITE', url: 'https://vaga.vn/products', enabled: true, sortOrder: 3 },
  { id: 'vaga_support', code: 'PHONE_SUPPORT', label: '☎️ Liên hệ hỗ trợ', action: 'phone_support', actionCode: 'PHONE_SUPPORT', enabled: true, sortOrder: 4 },
];
