import { createHash, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { config } from '../config/index.js';
import { db } from '../database/connection.js';
import { CUSTOMER_MENU } from './customerMenu.js';

type BnkActionCode = 'SHOW_GUIDE' | 'SHOW_PRODUCTS' | 'LOOKUP_ORDER' | 'REQUEST_AGENT' | 'PURCHASE_HISTORY' | 'OPEN_WEBSITE' | 'PHONE_SUPPORT';

export interface BnkProduct {
  id: number;
  name: string;
  description: string;
  packaging: string;
  price: number;
  stockQuantity: number;
}

export interface PurchaseDraft {
  intent: string; cancelIntent: string; productId: number; state: string; name: string; phone: string; address: string; priceMinor: number; quantity: number;
}

interface VerifiedBuyer {
  customerId: number;
  name: string;
  phone: string;
  address: string;
}

class BnkDataService {
  private pool: mysql.Pool | null = null;
  private ready = false;

  async initialize(): Promise<void> {
    if (!db.isMySQLActive()) {
      console.warn('[BNK] Skipping BNK integration because the application is not using MySQL.');
      return;
    }
    const pool = mysql.createPool({
      ...config.database,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });
    const required = [
      'products', 'customers', 'channel_connections', 'customer_channels', 'conversations',
      'orders', 'support_requests', 'employees', 'employee_shifts', 'bot_buttons', 'button_events', 'faq_articles',
    ];
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND TABLE_NAME IN (?)',
      [required]
    );
    const found = new Set(rows.map((row) => String(row.TABLE_NAME)));
    const missing = required.filter((name) => !found.has(name));
    if (missing.length) {
      await pool.end();
      throw new Error(`Missing BNK tables: ${missing.join(', ')}`);
    }
    const [flowColumns] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_TYPE FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'conversations' AND column_name = 'flow_state'`
    );
    const flowStateType = String(flowColumns[0]?.COLUMN_TYPE || '');
    if (!flowStateType.includes('WAITING_CUSTOMER_NAME') || !flowStateType.includes('WAITING_CUSTOMER_ADDRESS')) {
      await pool.query(
        `ALTER TABLE conversations MODIFY COLUMN flow_state
         ENUM('IDLE','WAITING_ORDER_CODE','WAITING_SUPPORT_CONTENT','WAITING_CUSTOMER_NAME','WAITING_CUSTOMER_ADDRESS')
         NOT NULL DEFAULT 'IDLE'`
      );
    }
    await pool.query(`CREATE TABLE IF NOT EXISTS purchase_drafts (
      scope_key CHAR(64) PRIMARY KEY, intent CHAR(12) NOT NULL, cancel_intent CHAR(12) NOT NULL DEFAULT '',
      product_id BIGINT UNSIGNED NOT NULL, state VARCHAR(20) NOT NULL,
      recipient_name VARCHAR(150) NOT NULL DEFAULT '', recipient_phone VARCHAR(25) NOT NULL DEFAULT '',
      shipping_address VARCHAR(300) NOT NULL DEFAULT '', price_minor BIGINT NOT NULL DEFAULT 0,
      quantity INT UNSIGNED NOT NULL DEFAULT 0,
      expires_at DATETIME NOT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    const [quantityColumns] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'purchase_drafts' AND column_name = 'quantity'");
    if (!quantityColumns.length) await pool.query('ALTER TABLE purchase_drafts ADD COLUMN quantity INT UNSIGNED NOT NULL DEFAULT 0');
    const [cancelColumns] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'purchase_drafts' AND column_name = 'cancel_intent'");
    if (!cancelColumns.length) {
      await pool.query("ALTER TABLE purchase_drafts ADD COLUMN cancel_intent CHAR(12) NOT NULL DEFAULT ''");
      await pool.query("UPDATE purchase_drafts SET cancel_intent = intent WHERE cancel_intent = ''");
    }
    this.pool = pool;
    this.ready = true;
    console.log(`[BNK] Connected to business tables in ${config.database.database}.`);
  }

  isReady(): boolean {
    return this.ready && Boolean(this.pool);
  }

  private getPool(): mysql.Pool {
    if (!this.pool || !this.ready) throw new Error('BNK database is unavailable');
    return this.pool;
  }

  private mapAction(action: string): BnkActionCode | null {
    const menuAction = CUSTOMER_MENU.find(button => button.action === action);
    if (menuAction) return menuAction.actionCode as BnkActionCode;
    if (action === 'reply') return 'SHOW_GUIDE';
    if (action === 'consult') return 'SHOW_PRODUCTS';
    if (action === 'order_lookup') return 'LOOKUP_ORDER';
    if (action === 'human_support') return 'REQUEST_AGENT';
    return null;
  }

  async getCustomerMenu(): Promise<typeof CUSTOMER_MENU> {
    if (!this.isReady()) return CUSTOMER_MENU;
    const [rows] = await this.getPool().query<mysql.RowDataPacket[]>(
      'SELECT button_code, label, action_code, sort_order, is_active FROM bot_buttons ORDER BY sort_order, id'
    );
    return rows.flatMap(row => {
      const definition = CUSTOMER_MENU.find(button => button.code === row.button_code && button.actionCode === row.action_code);
      return definition && row.is_active ? [{ ...definition, label: String(row.label), sortOrder: Number(row.sort_order) }] : [];
    });
  }

  async beginButtonEvent(chatId: string, eventId: string, action: string): Promise<{ duplicate: boolean; disabled?: boolean; buttonId?: number; responseText?: string }> {
    const actionCode = this.mapAction(action);
    if (!actionCode || !this.isReady()) return { duplicate: false };
    const pool = this.getPool();
    const [buttons] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT id, response_text, is_active FROM bot_buttons WHERE action_code = ? ORDER BY sort_order, id LIMIT 1',
      [actionCode]
    );
    const button = buttons[0];
    if (!button || !button.is_active) return { duplicate: false, disabled: true };
    const [result] = await pool.query<mysql.ResultSetHeader>(
      `INSERT IGNORE INTO button_events (chat_id, button_id, external_event_id, status)
       VALUES (?, ?, ?, 'PROCESSING')`,
      [chatId, button.id, eventId]
    );
    return {
      duplicate: result.affectedRows === 0,
      buttonId: Number(button.id),
      responseText: typeof button.response_text === 'string' ? button.response_text.trim() : '',
    };
  }

  async finishButtonEvent(eventId: string, error?: string): Promise<void> {
    if (!this.isReady()) return;
    await this.getPool().query(
      `UPDATE button_events SET status = ?, error_message = ?, processed_at = NOW() WHERE external_event_id = ?`,
      [error ? 'FAILED' : 'SUCCEEDED', error?.slice(0, 4000) || null, eventId]
    );
  }

  async getGuideText(fallback = ''): Promise<string> {
    if (!this.isReady()) return fallback;
    const [rows] = await this.getPool().query<mysql.RowDataPacket[]>(
      'SELECT question, answer FROM faq_articles WHERE is_active = 1 ORDER BY id LIMIT 5'
    );
    const guide = rows.map((row) => `• ${row.question}\n${row.answer}`).join('\n\n');
    return guide || fallback;
  }

  async getProducts(): Promise<BnkProduct[]> {
    if (!this.isReady()) return [];
    const [rows] = await this.getPool().query<mysql.RowDataPacket[]>(
      `SELECT id, name, description, packaging, price, stock_quantity FROM products
       WHERE is_active = 1 ORDER BY name LIMIT 8`
    );
    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      description: String(row.description || ''),
      packaging: String(row.packaging || ''),
      price: Number(row.price),
      stockQuantity: Number(row.stock_quantity),
    }));
  }

  async getPurchaseHistory(telegramUserId: string, telegramChatId: string, telegramBotId: string): Promise<string | null> {
    if (!this.isReady()) return 'Lịch sử mua hiện chưa kết nối được cơ sở dữ liệu. Vui lòng thử lại sau.';
    const buyer = await this.getVerifiedBuyer(telegramUserId, telegramChatId, telegramBotId);
    if (!buyer) return null;
    const [orders] = await this.getPool().query<mysql.RowDataPacket[]>(
      `SELECT o.id, o.order_code,
         COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS amount,
         GROUP_CONCAT(oi.product_name SEPARATOR ', ') AS products
       FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.customer_id = ? GROUP BY o.id, o.order_code ORDER BY o.id DESC LIMIT 10`,
      [buyer.customerId]
    );
    if (!orders.length) return '🧾 Bạn chưa có đơn hàng nào.';
    return ['🧾 Lịch sử mua — tối đa 10 đơn gần nhất:', ...orders.map((order) =>
      `📦 ${order.order_code}\n${order.products || 'Sản phẩm đang cập nhật'}\nTiền hàng: ${Number(order.amount).toLocaleString('vi-VN')}₫`
    )].join('\n\n');
  }

  async getProduct(productId: number): Promise<BnkProduct | null> {
    if (!this.isReady()) return null;
    const [rows] = await this.getPool().query<mysql.RowDataPacket[]>(
      `SELECT id, name, description, packaging, price, stock_quantity FROM products
       WHERE id = ? AND is_active = 1 LIMIT 1`, [productId]
    );
    const row = rows[0];
    return row ? {
      id: Number(row.id), name: String(row.name), description: String(row.description || ''),
      packaging: String(row.packaging || ''), price: Number(row.price), stockQuantity: Number(row.stock_quantity),
    } : null;
  }

  async getVerifiedBuyer(telegramUserId: string, telegramChatId: string, telegramBotId: string): Promise<VerifiedBuyer | null> {
    if (!this.isReady()) return null;
    const [rows] = await this.getPool().query<mysql.RowDataPacket[]>(
      `SELECT c.id AS customer_id, c.name, c.phone, c.address
       FROM customer_channels cc JOIN channel_connections ch ON ch.id = cc.connection_id
       JOIN customers c ON c.id = cc.customer_id
       WHERE ch.channel = 'TELEGRAM' AND ch.external_account_id = ?
         AND cc.external_user_id = ? AND cc.external_chat_id = ? AND cc.verified_at IS NOT NULL LIMIT 1`,
      [telegramBotId, telegramUserId, telegramChatId]
    );
    const row = rows[0];
    return row ? {
      customerId: Number(row.customer_id), name: String(row.name || ''),
      phone: String(row.phone || ''), address: String(row.address || ''),
    } : null;
  }

  private purchaseScope(user: string, chat: string, bot: string): string {
    return createHash('sha256').update(JSON.stringify([bot, user, chat])).digest('hex');
  }

  async getPurchaseDraft(user: string, chat: string, bot: string): Promise<PurchaseDraft | null> {
    if (!this.isReady()) return null;
    const [rows] = await this.getPool().query<mysql.RowDataPacket[]>(
      'SELECT * FROM purchase_drafts WHERE scope_key = ? AND expires_at > NOW()', [this.purchaseScope(user, chat, bot)]);
    const r = rows[0];
    return r ? { intent: r.intent, cancelIntent: r.cancel_intent, productId: Number(r.product_id), state: r.state,
      name: r.recipient_name, phone: r.recipient_phone, address: r.shipping_address, priceMinor: Number(r.price_minor), quantity: Number(r.quantity) } : null;
  }

  async startPurchaseDraft(user: string, chat: string, bot: string, productId: number): Promise<void> {
    const intent = randomUUID().replace(/-/g, '').slice(0, 12);
    await this.getPool().query(`INSERT INTO purchase_drafts (scope_key, intent, cancel_intent, product_id, state, expires_at)
      VALUES (?, ?, ?, ?, 'NAME', DATE_ADD(NOW(), INTERVAL 30 MINUTE))
      ON DUPLICATE KEY UPDATE intent = VALUES(intent), cancel_intent = VALUES(cancel_intent), product_id = VALUES(product_id), state = 'NAME',
      recipient_name = '', recipient_phone = '', shipping_address = '', price_minor = 0, quantity = 0, expires_at = VALUES(expires_at)`,
      [this.purchaseScope(user, chat, bot), intent, intent, productId]);
    await this.getPool().query(`UPDATE conversations cv
      JOIN customer_channels cc ON cc.id = cv.customer_channel_id
      JOIN channel_connections ch ON ch.id = cc.connection_id
      SET cv.flow_state = 'IDLE', cv.flow_expires_at = NULL
      WHERE ch.channel = 'TELEGRAM' AND ch.external_account_id = ?
        AND cc.external_user_id = ? AND cc.external_chat_id = ?
        AND cv.flow_state IN ('WAITING_CUSTOMER_NAME','WAITING_CUSTOMER_ADDRESS')`, [bot, user, chat]);
  }

  async changePurchaseDraft(user: string, chat: string, bot: string, intent: string, edit: boolean): Promise<boolean> {
    if (!this.isReady()) return false;
    const [result] = await this.getPool().query<mysql.ResultSetHeader>(
      `UPDATE purchase_drafts SET state = ?, intent = ?, recipient_name = '', recipient_phone = '', shipping_address = '', quantity = 0,
       expires_at = DATE_ADD(NOW(), INTERVAL 30 MINUTE)
       WHERE scope_key = ? AND ${edit ? "intent = ? AND state = 'CONFIRM'" : "(cancel_intent = ? OR intent = ?) AND state IN ('NAME','PHONE','ADDRESS','QUANTITY','CONFIRM')"} AND expires_at > NOW()`,
      [edit ? 'NAME' : 'CANCELLED', randomUUID().replace(/-/g, '').slice(0, 12), this.purchaseScope(user, chat, bot), intent, ...(!edit ? [intent] : [])]);
    return result.affectedRows > 0;
  }

  async resetCustomerFlow(user: string, chat: string, bot: string): Promise<void> {
    if (!this.isReady()) return;
    await this.getPool().query(`UPDATE purchase_drafts SET state = 'CANCELLED'
      WHERE scope_key = ? AND state IN ('NAME','PHONE','ADDRESS','QUANTITY','CONFIRM')`, [this.purchaseScope(user, chat, bot)]);
    await this.getPool().query(`UPDATE conversations cv
      JOIN customer_channels cc ON cc.id = cv.customer_channel_id JOIN channel_connections ch ON ch.id = cc.connection_id
      SET cv.flow_state = 'IDLE', cv.flow_expires_at = NULL
      WHERE ch.channel = 'TELEGRAM' AND ch.external_account_id = ? AND cc.external_user_id = ? AND cc.external_chat_id = ?`, [bot, user, chat]);
  }

  async processPurchaseInput(user: string, chat: string, bot: string, text: string): Promise<string | null> {
    const draft = await this.getPurchaseDraft(user, chat, bot);
    if (!draft || !['NAME', 'PHONE', 'ADDRESS', 'QUANTITY'].includes(draft.state)) return null;
    if (!await this.getVerifiedBuyer(user, chat, bot)) return null;
    let value = text.trim();
    const limits: Record<string, number> = { NAME: 150, PHONE: 25, ADDRESS: 300, QUANTITY: 10 };
    if (!value || value.startsWith('/') || value.length > limits[draft.state]) return 'invalid';
    if (draft.state === 'PHONE') {
      value = value.replace(/[\s().-]/g, '');
      if (!/^\+?\d{9,15}$/.test(value)) return 'invalid';
    }
    const state = draft.state as 'NAME' | 'PHONE' | 'ADDRESS' | 'QUANTITY';
    const column = { NAME: 'recipient_name', PHONE: 'recipient_phone', ADDRESS: 'shipping_address', QUANTITY: 'quantity' }[state];
    const next = { NAME: 'PHONE', PHONE: 'ADDRESS', ADDRESS: 'QUANTITY', QUANTITY: 'CONFIRM' }[state];
    const product = await this.getProduct(draft.productId);
    if (!product || product.stockQuantity < 1) return 'unavailable';
    if (state === 'QUANTITY') {
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) return 'invalid_quantity';
      if (Number(value) > product.stockQuantity) return 'insufficient_stock';
    }
    const [result] = await this.getPool().query<mysql.ResultSetHeader>(
      `UPDATE purchase_drafts SET ${column} = ?, state = ?, price_minor = ?, expires_at = DATE_ADD(NOW(), INTERVAL 30 MINUTE)
       WHERE scope_key = ? AND intent = ? AND state = ? AND expires_at > NOW()`,
      [value, next, Math.round(product.price * 100), this.purchaseScope(user, chat, bot), draft.intent, draft.state]);
    return result.affectedRows ? next : 'invalid';
  }

  async createProductOrder(input: {
    productId: number;
    telegramUserId: string;
    telegramChatId: string;
    telegramBotId: string;
    purchaseIntent: string;
    expectedPriceMinor: number;
  }): Promise<{ status: 'created' | 'existing' | 'link_required' | 'missing_address' | 'out_of_stock' | 'invalid_product' | 'price_changed' | 'conflict' | 'draft_required'; orderCode?: string; productName?: string; amount?: number; quantity?: number }> {
    const pool = this.getPool();
    const orderCode = `TV-${createHash('sha256').update(`${input.telegramBotId}:${input.telegramUserId}:${input.telegramChatId}:${input.purchaseIntent}`).digest('hex').slice(0, 24).toUpperCase()}`;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existingOrders] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT customer_id FROM orders WHERE order_code = ? LIMIT 1 FOR UPDATE', [orderCode]
      );
      if (existingOrders.length) {
        const buyer = await this.getVerifiedBuyer(input.telegramUserId, input.telegramChatId, input.telegramBotId);
        await connection.commit();
        return buyer && Number(existingOrders[0].customer_id) === buyer.customerId
          ? { status: 'existing', orderCode }
          : { status: 'conflict' };
      }

      const [buyerRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT c.id AS customer_id, c.name, c.phone, c.address
         FROM customer_channels cc JOIN channel_connections ch ON ch.id = cc.connection_id
         JOIN customers c ON c.id = cc.customer_id
         WHERE ch.channel = 'TELEGRAM' AND ch.external_account_id = ?
           AND cc.external_user_id = ? AND cc.external_chat_id = ? AND cc.verified_at IS NOT NULL
         LIMIT 1 FOR UPDATE`,
        [input.telegramBotId, input.telegramUserId, input.telegramChatId]
      );
      if (!buyerRows.length) {
        await connection.rollback();
        return { status: 'link_required' };
      }
      const buyer = buyerRows[0];
      const [drafts] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT * FROM purchase_drafts WHERE scope_key = ? AND intent = ? AND product_id = ?
         AND state = 'CONFIRM' AND expires_at > NOW() FOR UPDATE`,
        [this.purchaseScope(input.telegramUserId, input.telegramChatId, input.telegramBotId), input.purchaseIntent, input.productId]);
      const draft = drafts[0];
      if (!draft || Number(draft.price_minor) !== input.expectedPriceMinor || !Number.isInteger(Number(draft.quantity)) || Number(draft.quantity) < 1) {
        await connection.rollback();
        return { status: 'draft_required' };
      }
      if (!String(draft.shipping_address || '').trim() || !String(draft.recipient_phone || '').trim()) {
        await connection.rollback();
        return { status: 'missing_address' };
      }
      const items = [{ productId: input.productId, quantity: Number(draft.quantity), priceMinor: input.expectedPriceMinor }];
      const checked: { id: number; name: string; price: number; quantity: number }[] = [];
      for (const item of [...items].sort((a, b) => a.productId - b.productId)) {
        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          'SELECT id, name, price, stock_quantity FROM products WHERE id = ? AND is_active = 1 FOR UPDATE', [item.productId]);
        const product = rows[0];
        if (!product) { await connection.rollback(); return { status: 'invalid_product' }; }
        if (Math.round(Number(product.price) * 100) !== item.priceMinor) {
          await connection.rollback(); return { status: 'price_changed', productName: String(product.name) };
        }
        if (!Number.isInteger(item.quantity) || item.quantity < 1 || Number(product.stock_quantity) < item.quantity) {
          await connection.rollback(); return { status: 'out_of_stock', productName: String(product.name) };
        }
        checked.push({ id: item.productId, name: String(product.name), price: Number(product.price), quantity: item.quantity });
      }
      for (const item of checked) await connection.query(
        'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?', [item.quantity, item.id]);
      const [orderInsert] = await connection.query<mysql.ResultSetHeader>(
        `INSERT INTO orders (order_code, customer_id, status, payment_status, recipient_name, recipient_phone, shipping_address, shipping_fee, discount_amount)
         VALUES (?, ?, 'NEW', 'UNPAID', ?, ?, ?, 0, 0)`,
        [orderCode, buyer.customer_id, draft.recipient_name, draft.recipient_phone, draft.shipping_address]
      );
      for (const item of checked) await connection.query(
        'INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)',
        [orderInsert.insertId, item.id, item.name, item.quantity, item.price]);
      // Complete the initial customer profile only; later delivery details belong to the order.
      if (!String(buyer.address || '').trim()) {
        await connection.query('UPDATE customers SET name = ?, phone = ?, address = ? WHERE id = ?',
          [draft.recipient_name, draft.recipient_phone, draft.shipping_address, buyer.customer_id]);
      }
      await connection.query("UPDATE purchase_drafts SET state = 'ORDERED' WHERE scope_key = ? AND intent = ?",
        [this.purchaseScope(input.telegramUserId, input.telegramChatId, input.telegramBotId), input.purchaseIntent]);
      await connection.commit();
      return { status: 'created', orderCode, productName: checked.map(item => `${item.quantity} × ${item.name}`).join(", "), amount: checked.reduce((sum, item) => sum + item.price * item.quantity, 0), quantity: checked.reduce((sum, item) => sum + item.quantity, 0) };
    } catch (error) {
      await connection.rollback();
      // A repeated confirmation reuses the same deterministic order code.
      const [existingOrders] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT o.customer_id, oi.product_name, oi.unit_price, oi.quantity FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.order_code = ? LIMIT 1',
        [orderCode]
      );
      if (existingOrders.length) {
        const buyer = await this.getVerifiedBuyer(input.telegramUserId, input.telegramChatId, input.telegramBotId);
        if (buyer && Number(existingOrders[0].customer_id) === buyer.customerId) {
          return { status: 'existing', orderCode, productName: String(existingOrders[0].product_name), amount: Number(existingOrders[0].unit_price) * Number(existingOrders[0].quantity), quantity: Number(existingOrders[0].quantity) };
        }
        return { status: 'conflict' };
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async createSupportRequest(chatId: string, message = 'Khách yêu cầu gặp nhân viên qua nút Telegram.'): Promise<{ requestCode: string; employeeName?: string; existing: boolean }> {
    const pool = this.getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existingRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT request_code, assigned_employee_id FROM support_requests
         WHERE open_chat_id = ? AND status IN ('WAITING','IN_PROGRESS','WAITING_CUSTOMER') LIMIT 1 FOR UPDATE`,
        [chatId]
      );
      if (existingRows.length) {
        const request = existingRows[0];
        let employeeName: string | undefined;
        if (request.assigned_employee_id) {
          const [employeeRows] = await connection.query<mysql.RowDataPacket[]>('SELECT name FROM employees WHERE id = ?', [request.assigned_employee_id]);
          employeeName = employeeRows[0]?.name;
        }
        await connection.commit();
        return { requestCode: request.request_code, employeeName, existing: true };
      }

      const [eligibleRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT DISTINCT e.id, e.max_open_requests, e.name
         FROM employees e JOIN employee_shifts s ON s.employee_id = e.id
         WHERE e.is_active = 1 AND e.availability = 'ONLINE'
           AND s.start_at <= NOW() AND s.end_at > NOW()
         ORDER BY e.id FOR UPDATE`
      );
      let assignee: mysql.RowDataPacket | undefined;
      for (const candidate of eligibleRows) {
        const [counts] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) AS open_count FROM support_requests
           WHERE assigned_employee_id = ? AND status IN ('WAITING','IN_PROGRESS','WAITING_CUSTOMER')`,
          [candidate.id]
        );
        if (Number(counts[0]?.open_count || 0) < Number(candidate.max_open_requests)) {
          assignee = candidate;
          break;
        }
      }
      const requestCode = `BNK-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      await connection.query(
        `INSERT INTO support_requests
          (request_code, chat_id, assigned_employee_id, department, subject, content, status, priority)
         VALUES (?, ?, ?, 'CUSTOMER_SERVICE', 'Yêu cầu hỗ trợ từ Telegram', ?, ?, 'NORMAL')`,
        [requestCode, chatId, assignee?.id ?? null, message, assignee ? 'IN_PROGRESS' : 'WAITING']
      );
      await connection.commit();
      return { requestCode, employeeName: assignee?.name, existing: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async resolveSupportRequest(chatId: string): Promise<{ resolved: boolean; requestCode?: string }> {
    if (!this.isReady()) return { resolved: false };
    const connection = await this.getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id, request_code FROM support_requests
         WHERE open_chat_id = ? AND status IN ('WAITING','IN_PROGRESS','WAITING_CUSTOMER')
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [chatId]
      );
      if (!rows.length) {
        await connection.commit();
        return { resolved: false };
      }
      await connection.query(
        `UPDATE support_requests SET status = 'RESOLVED', resolved_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [rows[0].id]
      );
      await connection.commit();
      return { resolved: true, requestCode: rows[0].request_code };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async getVerifiedTelegramCustomer(telegramUserId: string, telegramChatId: string, telegramBotId: string): Promise<number | null> {
    const [rows] = await this.getPool().query<mysql.RowDataPacket[]>(
      `SELECT cc.customer_id FROM customer_channels cc
       JOIN channel_connections c ON c.id = cc.connection_id
       WHERE c.channel = 'TELEGRAM' AND c.external_account_id = ?
         AND cc.external_user_id = ? AND cc.external_chat_id = ? AND cc.verified_at IS NOT NULL
       LIMIT 1`,
      [telegramBotId, telegramUserId, telegramChatId]
    );
    return rows.length ? Number(rows[0].customer_id) : null;
  }

  async startOrderLookup(telegramUserId: string, telegramChatId: string, telegramBotId: string): Promise<'link_required' | 'started' | 'unavailable'> {
    if (!this.isReady()) return 'unavailable';
    const customerId = await this.getVerifiedTelegramCustomer(telegramUserId, telegramChatId, telegramBotId);
    if (!customerId) return 'link_required';
    const pool = this.getPool();
    const [channels] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT cc.id FROM customer_channels cc JOIN channel_connections c ON c.id = cc.connection_id
       WHERE c.channel = 'TELEGRAM' AND c.external_account_id = ? AND cc.external_user_id = ?
         AND cc.external_chat_id = ? AND cc.verified_at IS NOT NULL LIMIT 1`,
      [telegramBotId, telegramUserId, telegramChatId]
    );
    if (!channels.length) return 'link_required';
    const [conversations] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id FROM conversations WHERE customer_channel_id = ? AND status <> 'RESOLVED' ORDER BY id DESC LIMIT 1`,
      [channels[0].id]
    );
    let conversationId: number;
    if (conversations.length) {
      conversationId = Number(conversations[0].id);
      await pool.query(
        `UPDATE conversations SET flow_state = 'WAITING_ORDER_CODE', flow_expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE), updated_at = NOW() WHERE id = ?`,
        [conversationId]
      );
    } else {
      const [insert] = await pool.query<mysql.ResultSetHeader>(
        `INSERT INTO conversations (customer_channel_id, flow_state, flow_expires_at) VALUES (?, 'WAITING_ORDER_CODE', DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
        [channels[0].id]
      );
      conversationId = insert.insertId;
    }
    return conversationId ? 'started' : 'unavailable';
  }

  async verifyTelegramContact(input: { telegramUserId: string; telegramChatId: string; telegramUsername?: string; customerName?: string; phone: string; telegramBotId: string; botName: string }): Promise<'verified' | 'new_customer' | 'address_required' | 'ambiguous' | 'already_linked' | 'unavailable'> {
    if (!this.isReady()) return 'unavailable';
    const digits = input.phone.replace(/\D/g, '');
    const ownPhone = digits.startsWith('84') ? `0${digits.slice(2)}` : digits;
    if (!ownPhone) return 'unavailable';
    const connection = await this.getPool().getConnection();
    try {
      await connection.beginTransaction();
      const connectionCode = `TG_${createHash('sha256').update(input.telegramBotId).digest('hex').slice(0, 32)}`;
      await connection.query(
        `INSERT INTO channel_connections (connection_code, channel, display_name, external_account_id, is_active)
         VALUES (?, 'TELEGRAM', ?, ?, 1)
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), is_active = 1`,
        [connectionCode, input.botName.slice(0, 150), input.telegramBotId]
      );
      const [connections] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT id FROM channel_connections WHERE connection_code = ? FOR UPDATE', [connectionCode]
      );
      const connectionId = connections[0]?.id;
      const acceptedPhones = [ownPhone];
      if (ownPhone.startsWith('0')) acceptedPhones.push(`84${ownPhone.slice(1)}`);
      const [customerRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id, name, address FROM customers
         WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', ''), '.', ''), '(', ''), ')', '') IN (?)
         FOR UPDATE`,
        [acceptedPhones]
      );
      if (customerRows.length > 1) {
        await connection.rollback();
        return 'ambiguous';
      }
      const [existing] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT customer_id, verified_at FROM customer_channels WHERE connection_id = ? AND external_user_id = ? FOR UPDATE`,
        [connectionId, input.telegramUserId]
      );
      if (existing.length && existing[0].verified_at && customerRows.length && Number(existing[0].customer_id) !== Number(customerRows[0].id)) {
        await connection.rollback();
        return 'already_linked';
      }
      const isNewCustomer = customerRows.length === 0;
      let customerId: number;
      let customerAddress = '';
      if (isNewCustomer) {
        const customerCode = `TG-${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`;
        const customerName = input.customerName?.trim().slice(0, 150) || `Khách Telegram ${input.telegramUserId.slice(-6)}`;
        const [createdCustomer] = await connection.query<mysql.ResultSetHeader>(
          'INSERT INTO customers (customer_code, name, phone) VALUES (?, ?, ?)',
          [customerCode, customerName, ownPhone]
        );
        customerId = createdCustomer.insertId;
      } else {
        customerId = Number(customerRows[0].id);
        customerAddress = String(customerRows[0].address || '').trim();
      }
      if (existing.length) {
        await connection.query(
          `UPDATE customer_channels SET customer_id = ?, external_chat_id = ?, external_username = ?, verified_at = NOW()
           WHERE connection_id = ? AND external_user_id = ?`,
          [customerId, input.telegramChatId, input.telegramUsername || null, connectionId, input.telegramUserId]
        );
      } else {
        await connection.query(
          `INSERT INTO customer_channels (customer_id, connection_id, external_user_id, external_chat_id, external_username, verified_at)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [customerId, connectionId, input.telegramUserId, input.telegramChatId, input.telegramUsername || null]
        );
      }
      const [channelRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id FROM customer_channels WHERE connection_id = ? AND external_user_id = ?`,
        [connectionId, input.telegramUserId]
      );
      const [openConversations] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT id FROM conversations WHERE customer_channel_id = ? AND status <> 'RESOLVED' LIMIT 1`,
        [channelRows[0].id]
      );
      const [purchaseDrafts] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT scope_key FROM purchase_drafts WHERE scope_key = ? AND state = 'NAME' AND expires_at > NOW()",
        [this.purchaseScope(input.telegramUserId, input.telegramChatId, input.telegramBotId)]);
      const nextState = purchaseDrafts.length ? 'IDLE' : isNewCustomer ? 'WAITING_CUSTOMER_NAME' : customerAddress ? 'IDLE' : 'WAITING_CUSTOMER_ADDRESS';
      if (!openConversations.length) {
        await connection.query(
          `INSERT INTO conversations (customer_channel_id, flow_state, flow_expires_at)
           VALUES (?, ?, IF(? = 'IDLE', NULL, DATE_ADD(NOW(), INTERVAL 30 MINUTE)))`,
          [channelRows[0].id, nextState, nextState]
        );
      } else {
        await connection.query(
          `UPDATE conversations SET flow_state = ?, flow_expires_at = IF(? = 'IDLE', NULL, DATE_ADD(NOW(), INTERVAL 30 MINUTE)), updated_at = NOW()
           WHERE id = ?`,
          [nextState, nextState, openConversations[0].id]
        );
      }
      await connection.commit();
      if (isNewCustomer) return 'new_customer';
      return customerAddress ? 'verified' : 'address_required';
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async processCustomerOnboarding(telegramUserId: string, telegramChatId: string, telegramBotId: string, text: string): Promise<'need_address' | 'complete' | 'too_long' | null> {
    if (!this.isReady()) return null;
    const pool = this.getPool();
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT cv.id AS conversation_id, cc.customer_id, cv.flow_state
       FROM conversations cv JOIN customer_channels cc ON cc.id = cv.customer_channel_id
       JOIN channel_connections ch ON ch.id = cc.connection_id
       WHERE ch.channel = 'TELEGRAM' AND ch.external_account_id = ? AND cc.external_user_id = ?
         AND cc.external_chat_id = ? AND cc.verified_at IS NOT NULL
         AND cv.flow_state IN ('WAITING_CUSTOMER_NAME','WAITING_CUSTOMER_ADDRESS')
         AND cv.flow_expires_at > NOW()
       ORDER BY cv.id DESC LIMIT 1`,
      [telegramBotId, telegramUserId, telegramChatId]
    );
    if (!rows.length) return null;
    const value = text.trim();
    if (!value || value.length > 300) return 'too_long';
    if (rows[0].flow_state === 'WAITING_CUSTOMER_NAME') {
      if (value.length > 150) return 'too_long';
      await pool.query('UPDATE customers SET name = ? WHERE id = ?', [value, rows[0].customer_id]);
      await pool.query(
        `UPDATE conversations SET flow_state = 'WAITING_CUSTOMER_ADDRESS', flow_expires_at = DATE_ADD(NOW(), INTERVAL 30 MINUTE), updated_at = NOW() WHERE id = ?`,
        [rows[0].conversation_id]
      );
      return 'need_address';
    }
    await pool.query('UPDATE customers SET address = ? WHERE id = ?', [value, rows[0].customer_id]);
    await pool.query(
      `UPDATE conversations SET flow_state = 'IDLE', flow_expires_at = NULL, updated_at = NOW() WHERE id = ?`,
      [rows[0].conversation_id]
    );
    return 'complete';
  }

  async processOrderCode(telegramUserId: string, telegramChatId: string, telegramBotId: string, orderCode: string): Promise<string | null> {
    if (!this.isReady()) return null;
    const pool = this.getPool();
    const [channels] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT cc.id, cc.customer_id FROM customer_channels cc JOIN channel_connections c ON c.id = cc.connection_id
       WHERE c.channel = 'TELEGRAM' AND c.external_account_id = ? AND cc.external_user_id = ?
         AND cc.external_chat_id = ? AND cc.verified_at IS NOT NULL LIMIT 1`,
      [telegramBotId, telegramUserId, telegramChatId]
    );
    if (!channels.length) return null;
    const [waiting] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id FROM conversations WHERE customer_channel_id = ? AND flow_state = 'WAITING_ORDER_CODE'
       AND flow_expires_at > NOW() ORDER BY id DESC LIMIT 1`,
      [channels[0].id]
    );
    if (!waiting.length) return null;
    const code = orderCode.trim().slice(0, 40);
    const [orders] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT status, payment_status, carrier, tracking_code FROM orders WHERE order_code = ? AND customer_id = ? LIMIT 1`,
      [code, channels[0].customer_id]
    );
    await pool.query(
      `UPDATE conversations SET flow_state = 'IDLE', flow_expires_at = NULL, updated_at = NOW() WHERE id = ?`,
      [waiting[0].id]
    );
    if (!orders.length) return 'Không tìm thấy đơn hàng thuộc tài khoản đã xác minh này. Hãy kiểm tra mã đơn hoặc liên hệ nhân viên.';
    const order = orders[0];
    const orderStatusLabels: Record<string, string> = {
      NEW: 'Chờ duyệt đơn',
      PENDING: 'Chờ duyệt đơn',
      CONFIRMED: 'Đã duyệt đơn',
      PROCESSING: 'Đang chuẩn bị hàng',
      SHIPPING: 'Đang vận chuyển',
      SHIPPED: 'Đang vận chuyển',
      DELIVERED: 'Giao thành công',
      COMPLETED: 'Giao thành công',
      CANCELLED: 'Đã hủy đơn',
      CANCELED: 'Đã hủy đơn',
      RETURNED: 'Đã hoàn hàng',
    };
    const paymentStatusLabels: Record<string, string> = {
      UNPAID: 'Chưa thanh toán',
      PENDING: 'Chờ xác nhận thanh toán',
      PAID: 'Đã thanh toán',
      PARTIALLY_PAID: 'Đã thanh toán một phần',
      REFUNDED: 'Đã hoàn tiền',
      FAILED: 'Thanh toán thất bại',
    };
    const orderStatus = String(order.status || '').trim().toUpperCase();
    const paymentStatus = String(order.payment_status || '').trim().toUpperCase();
    return [
      `Trạng thái đơn: ${orderStatusLabels[orderStatus] || 'Đang cập nhật'}`,
      `Thanh toán: ${paymentStatusLabels[paymentStatus] || 'Đang cập nhật'}`,
      order.carrier ? `Đơn vị vận chuyển: ${order.carrier}` : '',
      order.tracking_code ? `Mã vận đơn: ${order.tracking_code}` : '',
    ].filter(Boolean).join('\n');
  }
}

export const bnkDataService = new BnkDataService();
