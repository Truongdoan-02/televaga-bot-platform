import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { config } from '../src/config/index.js';
import { bnkDataService } from '../src/services/bnkDataService.js';
import { telegramService } from '../src/services/telegramService.js';
import { db } from '../src/database/connection.js';
import { socketService } from '../src/services/socketService.js';

// Session-local temporary tables exercise real MySQL transactions without changing live data.
const connection = await mysql.createConnection(config.database);
const service = bnkDataService as any;
try {
  for (const table of ['customers', 'channel_connections', 'customer_channels', 'conversations', 'products', 'product_inventory', 'inventory_transactions', 'inventory_orders', 'orders', 'order_items']) {
    const [ddl] = await connection.query<mysql.RowDataPacket[]>(`SHOW CREATE TABLE ${table}`);
    const temporaryDdl = String(ddl[0]['Create Table']).replace('CREATE TABLE', 'CREATE TEMPORARY TABLE')
      .split('\n').filter(line => !line.includes('FOREIGN KEY')).join('\n').replace(/,\n\)/, '\n)');
    await connection.query(temporaryDdl);
  }
  await connection.query(`CREATE TEMPORARY TABLE purchase_drafts (
    scope_key CHAR(64) PRIMARY KEY, intent CHAR(12) NOT NULL, cancel_intent CHAR(12) NOT NULL DEFAULT '', product_id BIGINT UNSIGNED NOT NULL,
    state VARCHAR(20) NOT NULL, recipient_name VARCHAR(150) NOT NULL DEFAULT '',
    recipient_phone VARCHAR(25) NOT NULL DEFAULT '', shipping_address VARCHAR(300) NOT NULL DEFAULT '',
    price_minor BIGINT NOT NULL DEFAULT 0, quantity INT UNSIGNED NOT NULL DEFAULT 0, expires_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
  service.pool = {
    query: connection.query.bind(connection),
    getConnection: async () => ({
      query: connection.query.bind(connection), beginTransaction: connection.beginTransaction.bind(connection),
      commit: connection.commit.bind(connection), rollback: connection.rollback.bind(connection), release() {},
    }),
  };
  service.ready = true;
  await connection.query("INSERT INTO customers (id, customer_code, name, phone) VALUES (1, 'TEST', 'Initial', '0900000000')");
  await connection.query("INSERT INTO channel_connections (id, connection_code, channel, display_name, external_account_id) VALUES (1, 'TEST', 'TELEGRAM', 'Test', 'bot')");
  await connection.query("INSERT INTO customer_channels (customer_id, connection_id, external_user_id, external_chat_id, verified_at) VALUES (1, 1, 'user', 'chat', NOW())");
  await connection.query("INSERT INTO products (id, category_id, sku, name, price, is_active) VALUES (1, 1, 'TEST', 'Test product', 100, 1)");
  await connection.query('INSERT INTO product_inventory(product_id,stock_quantity) VALUES (1,5)');
  const draft = () => bnkDataService.getPurchaseDraft('user', 'chat', 'bot');
  const input = (text: string) => bnkDataService.processPurchaseInput('user', 'chat', 'bot', text);
  const order = (d: NonNullable<Awaited<ReturnType<typeof draft>>>) => bnkDataService.createProductOrder({
    productId: d.productId, telegramUserId: 'user', telegramChatId: 'chat', telegramBotId: 'bot',
    purchaseIntent: d.intent, expectedPriceMinor: d.priceMinor,
  });
  await bnkDataService.startPurchaseDraft('user', 'chat', 'bot', 1);
  assert.equal((await order((await draft())!)).status, 'draft_required');
  assert.equal(await input('First recipient'), 'PHONE');
  assert.equal(await input('invalid phone'), 'invalid');
  assert.equal(await input('0912345678'), 'ADDRESS');
  assert.equal(await input('First address'), 'QUANTITY');
  assert.equal(await input('0'), 'invalid_quantity');
  assert.equal(await input('-1'), 'invalid_quantity');
  assert.equal(await input('1.5'), 'invalid_quantity');
  assert.equal(await input('6'), 'insufficient_stock');
  assert.equal((await order((await draft())!)).status, 'draft_required');
  assert.equal(await input('2'), 'CONFIRM');
  const original = (await draft())!;
  assert.equal(await bnkDataService.changePurchaseDraft('other', 'chat', 'bot', original.intent, true), false);
  assert.equal(await bnkDataService.changePurchaseDraft('user', 'chat', 'bot', original.intent, true), true);
  assert.equal((await order(original)).status, 'draft_required');
  await input('Edited recipient'); await input('0923456789'); await input('Edited address'); await input('2');
  const edited = (await draft())!;
  const telegram = telegramService as any;
  const originalSend = telegram.sendMessage;
  const sent: any[] = [];
  telegram.sendMessage = async (...args: any[]) => { sent.push(args); };
  try {
    await telegram.sendPurchaseConfirmation({ id: 'test-chat' }, '', 1, edited.intent, 'user', 'chat', 'bot');
    assert.equal(sent.length, 1);
    assert.ok(sent[0][1].includes(edited.name) && sent[0][1].includes(edited.phone) && sent[0][1].includes(edited.address));
    const buttons = sent[0][2].replyMarkup.inline_keyboard.flat();
    assert.ok(buttons.some((button: any) => button.callback_data === `purchase_edit:${edited.intent}`));
    assert.ok(buttons.some((button: any) => button.callback_data.startsWith('purchase_confirm:')));
  } finally { telegram.sendMessage = originalSend; }
  const created = await order(edited);
  assert.equal(created.status, 'created');
  assert.equal(created.quantity, 2);
  assert.equal(created.amount, 200);
  const [items] = await connection.query<mysql.RowDataPacket[]>('SELECT quantity, unit_price, line_total FROM order_items');
  assert.equal(items[0].quantity, 2);
  assert.equal(Number(items[0].line_total), 200);
  assert.equal((await order(edited)).status, 'existing');
  const [first] = await connection.query<mysql.RowDataPacket[]>('SELECT name, phone, address FROM customers WHERE id = 1');
  assert.deepEqual([first[0].name, first[0].phone, first[0].address], ['Edited recipient', '0923456789', 'Edited address']);
  await bnkDataService.startPurchaseDraft('user', 'chat', 'bot', 1);
  await input('Another recipient'); await input('0934567890'); await input('Another address'); await input('1');
  assert.equal((await order((await draft())!)).status, 'created');
  const [profile] = await connection.query<mysql.RowDataPacket[]>('SELECT name, phone, address FROM customers WHERE id = 1');
  assert.deepEqual(profile, first);
  const [orders] = await connection.query<mysql.RowDataPacket[]>('SELECT recipient_name, recipient_phone, shipping_address FROM orders ORDER BY id');
  assert.equal(orders.length, 2);
  assert.equal(orders[1].recipient_name, 'Another recipient');
  assert.equal(orders[1].recipient_phone, '0934567890');
  assert.equal(orders[1].shipping_address, 'Another address');
  await bnkDataService.startPurchaseDraft('user', 'chat', 'bot', 1);
  await input('Cancel recipient'); await input('0945678901'); await input('Cancel address'); await input('1');
  const cancelled = (await draft())!;
  assert.equal(await bnkDataService.changePurchaseDraft('user', 'chat', 'bot', cancelled.intent, false), true);
  assert.equal((await order(cancelled)).status, 'draft_required');
  await bnkDataService.startPurchaseDraft('user', 'chat', 'bot', 1);
  await input('Expired recipient'); await input('0945678901'); await input('Expired address'); await input('1');
  const expired = (await draft())!;
  await connection.query('UPDATE purchase_drafts SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE)');
  assert.equal((await order(expired)).status, 'draft_required');
  await bnkDataService.startPurchaseDraft('user', 'chat', 'bot', 1);
  await input('Stock test'); await input('0945678901'); await input('Stock address'); await input('2');
  const stockDraft = (await draft())!;
  await connection.query('UPDATE product_inventory SET stock_quantity=quantity_reserved+1 WHERE product_id=1');
  assert.equal((await order(stockDraft)).status, 'out_of_stock');
  const [counts] = await connection.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM orders');
  assert.equal(counts[0].n, 2);
  await connection.query('UPDATE product_inventory SET stock_quantity=quantity_reserved+2 WHERE product_id=1');
  const [stock] = await connection.query<mysql.RowDataPacket[]>('SELECT stock_quantity-quantity_reserved AS stock_quantity FROM product_inventory WHERE product_id=1');
  assert.equal(stock[0].stock_quantity, 2);
  // Cancel remains usable from the initial confirmation after entering edit mode.
  await bnkDataService.startPurchaseDraft('user', 'chat', 'bot', 1);
  await input('Edit cancel'); await input('0945678901'); await input('Address'); await input('1');
  const beforeEdit = (await draft())!;
  assert.equal(await bnkDataService.changePurchaseDraft('user', 'chat', 'bot', beforeEdit.intent, true), true);
  assert.equal(await bnkDataService.changePurchaseDraft('user', 'chat', 'bot', beforeEdit.cancelIntent, false), true);
  assert.equal(await input('Should not be collected'), null);
  // An old cancel button cannot cancel a new purchase.
  await bnkDataService.startPurchaseDraft('user', 'chat', 'bot', 1);
  assert.equal(await bnkDataService.changePurchaseDraft('user', 'chat', 'bot', beforeEdit.cancelIntent, false), false);
  assert.equal((await draft())!.state, 'NAME');
  await bnkDataService.resetCustomerFlow('other', 'chat', 'bot');
  assert.equal((await draft())!.state, 'NAME');
  await bnkDataService.resetCustomerFlow('user', 'chat', 'bot');
  assert.equal((await draft())!.state, 'CANCELLED');
  assert.equal(await input('/start'), null);
  // Exercise command routing through the webhook handler, without network or persistent chat writes.
  const restores: (() => void)[] = [];
  const stub = (target: any, key: string, value: any) => {
    const previous = target[key]; target[key] = value; restores.push(() => { target[key] = previous; });
  };
  let menuCount = 0;
  const responses: string[] = [];
  stub(db, 'getChats', async () => []);
  stub(db, 'getUserByTelegramId', async () => ({ avatarUrl: 'test' }));
  stub(db, 'upsertTelegramUser', async (value: any) => value);
  stub(db, 'upsertTelegramChat', async (value: any) => value);
  stub(db, 'getMessageById', async () => null);
  stub(db, 'addMessage', async () => {});
  stub(db, 'getManagedBotById', async () => ({ telegramBotId: 'bot' }));
  stub(socketService, 'broadcastNewMessage', () => {});
  stub(telegram, 'sendMessage', async (_chat: string, text: string) => { responses.push(text); });
  stub(telegram, 'sendActionMenu', async () => { menuCount++; });
  try {
    for (const command of ['/start', '/cancel@TestBot']) {
      await bnkDataService.startPurchaseDraft('user', 'chat', 'bot', 1);
      await input('Editing name');
      await telegramService.handleWebhookUpdate({ message: {
        message_id: command === '/start' ? 100 : 101, text: command,
        from: { id: 'user', first_name: 'Test' }, chat: { id: 'chat', type: 'private' },
      } }, { botId: 'managed-test', token: 'test' });
      assert.equal((await draft())!.state, 'CANCELLED');
    }
    assert.equal(menuCount, 1);
    assert.equal(responses.length, 1);
    assert.ok(!responses.some(text => text.includes('Thông tin chưa hợp lệ')));
    const shopPurchases:any[]=[];let shopLists=0;
    stub(telegram,'beginProductPurchase',async(...args:any[])=>{shopPurchases.push(args);});
    stub(telegram,'sendProductCards',async()=>{shopLists++;});
    for(const [index,text] of ['/start buy_1','/start shop'].entries()){
      await telegramService.handleWebhookUpdate({message:{message_id:200+index,text,from:{id:'user',first_name:'Test'},chat:{id:'chat',type:'private'}}},{botId:'managed-test',token:'test'});
    }
    assert.equal(shopPurchases.length,1);
    assert.deepEqual(shopPurchases[0].slice(1,4),[1,'user','chat']);
    assert.equal(shopLists,1);
  } finally { restores.reverse().forEach(restore => restore()); }
  console.log('PASS: purchase flow, recipients, edit, cancel, expiry, ownership, duplicate confirmation and stock.');
} finally {
  service.pool = null; service.ready = false;
  await connection.end();
}
