import { telegramMedia } from './telegramMedia.js';
import { storeUpload, readUpload } from './uploadStore.js';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'node:crypto';
import { isBroadcastImage } from './broadcastImages.js';
import path from 'node:path';
import { config } from '../config/index.js';
import { db } from '../database/connection.js';
import { bnkDataService } from './bnkDataService.js';
import { broadcastService, type BroadcastInput } from './broadcastService.js';
import { Message, Chat, User } from '../types/index.js';
import { socketService } from './socketService.js';
import { BOT_FLOW_PROMPT_DEFAULTS, BotFlowPromptKey } from './botFlowPrompts.js';

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: any;
  callback_query?: any;
}

interface ManagedRuntimeStatus {
  polling: boolean;
  startedAt?: string;
  lastUpdateAt?: string;
  lastError?: string;
  consecutiveErrors?: number;
}

class TelegramService {
  private pollingActive = false;
  private telegramConnected = false;
  private botUsername: string | null = null;
  private connectionError: string | null = null;
  private readonly managedPollers = new Map<string, { token: string; active: boolean; controller: AbortController }>();
  private readonly managedRuntime = new Map<string, ManagedRuntimeStatus>();

  private async getFlowPrompt(botId: string | undefined, key: BotFlowPromptKey): Promise<string> {
    if (botId) {
      const bot = await db.getManagedBotById(botId);
      const configured = bot?.flowPrompts?.[key]?.trim();
      if (configured) return configured;
    }
    return BOT_FLOW_PROMPT_DEFAULTS[key];
  }

  getManagedBotRuntimeStatus(botId: string) {
    return this.managedRuntime.get(botId) || { polling: false };
  }
  private readonly avatarCache = new Map<string, string | null>();

  getStatus() {
    const runningManaged = [...this.managedRuntime.values()].filter((runtime) => runtime.polling).length;
    const managedErrors = [...this.managedRuntime.values()].filter((runtime) => runtime.lastError).map((runtime) => runtime.lastError);
    return {
      mode: config.telegram.mode,
      enabled: (config.telegram.mode !== 'mock' && Boolean(config.telegram.botToken)) || runningManaged > 0,
      connected: this.telegramConnected || runningManaged > 0,
      botUsername: this.botUsername,
      error: this.connectionError || managedErrors[0] || null,
      managedBotsPolling: runningManaged,
    };
  }

  async startPolling(): Promise<void> {
    if (config.telegram.mode !== 'polling') return;
    if (!config.telegram.botToken) {
      this.connectionError = 'TELEGRAM_BOT_TOKEN is missing';
      console.error('[Telegram] Polling mode requires TELEGRAM_BOT_TOKEN.');
      return;
    }
    if (this.pollingActive) return;
    if ([...this.managedPollers.values()].some((runner) => runner.active && runner.token === config.telegram.botToken)) return;

    try {
      const bot = await this.apiCall<{ username?: string }>('getMe');
      const webhook = await this.apiCall<{ url?: string }>('getWebhookInfo');
      if (webhook.url) {
        this.connectionError = 'A webhook is already configured; remove it before using polling.';
        console.error('[Telegram] A webhook is configured. Polling cannot run until it is removed.');
        return;
      }
      this.botUsername = bot.username || null;
      this.telegramConnected = true;
      this.connectionError = null;
      this.pollingActive = true;
      console.log(`[Telegram] Connected to @${this.botUsername || 'bot'} using long polling.`);
      void this.pollUpdates();
    } catch (error) {
      this.telegramConnected = false;
      this.connectionError = error instanceof Error ? error.message : 'Telegram connection failed';
      console.error('[Telegram] Could not connect:', this.connectionError);
    }
  }

  private async apiCall<T>(method: string, body?: Record<string, unknown>, signal?: AbortSignal, token = config.telegram.botToken): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    const payload = await response.json() as TelegramApiResponse<T>;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.description || `Telegram API ${method} failed (${response.status})`);
    }
    return payload.result;
  }

  async syncManagedBots(): Promise<void> {
    const bots = await db.getManagedBots();
    const active = bots.filter((bot) => bot.isEnabled && bot.mode === 'polling');
    const activeIds = new Set(active.map((bot) => bot.id));
    for (const [id, runner] of this.managedPollers) {
      const bot = active.find((item) => item.id === id);
      if (!activeIds.has(id) || bot?.token !== runner.token) {
        runner.active = false;
        runner.controller.abort();
        this.managedPollers.delete(id);
        this.managedRuntime.set(id, { ...this.getManagedBotRuntimeStatus(id), polling: false });
      }
    }
    const activeTokens = new Set(active.map((bot) => bot.token));
    if (config.telegram.botToken && activeTokens.has(config.telegram.botToken)) this.pollingActive = false;
    else if (config.telegram.mode === 'polling' && !this.pollingActive) void this.startPolling();
    for (const bot of active) {
      if (this.managedPollers.has(bot.id)) continue;
      const runner = { token: bot.token, active: true, controller: new AbortController() };
      this.managedPollers.set(bot.id, runner);
      this.managedRuntime.set(bot.id, { polling: true, startedAt: new Date().toISOString() });
      void this.pollManagedBot(bot.id, runner);
    }
  }

  private async pollManagedBot(botId: string, runner: { token: string; active: boolean; controller: AbortController }): Promise<void> {
    try {
      const me = await this.apiCall<{ id: number; username?: string }>('getMe', undefined, undefined, runner.token);
      const webhook = await this.apiCall<{ url?: string }>('getWebhookInfo', undefined, undefined, runner.token);
      if (webhook.url) throw new Error('Bot đang có webhook; hãy xóa webhook trước khi bật polling.');
      if (config.telegram.botToken && config.telegram.botToken === runner.token) {
        await db.assignUnownedTelegramChatsToBot(botId);
      }
      const bot = await db.getManagedBotById(botId);
      if (bot) await db.updateManagedBot(botId, bot.name, undefined, { telegramBotId: String(me.id), username: me.username, status: 'connected', lastError: undefined });
      await this.resetBotMenu(runner.token);
      console.log(`[Telegram] Managed bot @${me.username || botId} connected using long polling.`);
      let offset: number | undefined;
      while (runner.active) {
        try {
          const updates = await this.apiCall<TelegramUpdate[]>('getUpdates', {
            ...(offset === undefined ? {} : { offset }), timeout: 25, allowed_updates: ['message', 'callback_query'],
          }, runner.controller.signal, runner.token);
          const runtime = this.getManagedBotRuntimeStatus(botId);
          if (runtime.lastError || runtime.consecutiveErrors) {
            this.managedRuntime.set(botId, { ...runtime, polling: true, lastError: undefined, consecutiveErrors: 0 });
            const currentBot = await db.getManagedBotById(botId);
            if (currentBot?.isEnabled && currentBot.status === 'error') {
              await db.updateManagedBot(botId, currentBot.name, undefined, { status: 'connected', lastError: undefined });
            }
          }
          for (const update of updates) {
            await this.handleWebhookUpdate(update, { botId, token: runner.token });
            offset = update.update_id + 1;
            this.managedRuntime.set(botId, { ...this.getManagedBotRuntimeStatus(botId), polling: true, lastUpdateAt: new Date().toISOString() });
          }
        } catch (error) {
          if (!runner.active) break;
          const message = error instanceof Error ? error.message : 'Telegram polling failed';
          const runtime = this.getManagedBotRuntimeStatus(botId);
          const repeated = (runtime.consecutiveErrors || 0) + 1;
          this.managedRuntime.set(botId, { ...runtime, polling: true, lastError: message, consecutiveErrors: repeated });
          console.error(`[Telegram] Polling error for ${botId}:`, message);
          const isConflict = /409|conflict|terminated by other getupdates/i.test(message);
          if (isConflict || repeated >= 3) {
            const currentBot = await db.getManagedBotById(botId);
            if (currentBot) await db.updateManagedBot(botId, currentBot.name, undefined, {
              status: 'error', lastError: message, ...(isConflict ? { isEnabled: false } : {}),
            });
          }
          if (isConflict) {
            runner.active = false;
            this.managedRuntime.set(botId, { ...this.getManagedBotRuntimeStatus(botId), polling: false });
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    } catch (error) {
      console.error(`[Telegram] Could not start managed bot ${botId}:`, error instanceof Error ? error.message : error);
      const bot = await db.getManagedBotById(botId);
      this.managedRuntime.set(botId, { ...this.getManagedBotRuntimeStatus(botId), polling: false, lastError: error instanceof Error ? error.message : 'Telegram connection failed' });
      if (bot && runner.active) await db.updateManagedBot(botId, bot.name, undefined, { status: 'error', lastError: error instanceof Error ? error.message : 'Telegram connection failed', isEnabled: false });
    } finally {
      if (this.managedPollers.get(botId) === runner) {
        this.managedPollers.delete(botId);
        this.managedRuntime.set(botId, { ...this.getManagedBotRuntimeStatus(botId), polling: false });
        if (runner.active) void this.syncManagedBots();
      }
    }
  }

  private async pollUpdates(): Promise<void> {
    let offset: number | undefined;
    while (this.pollingActive) {
      try {
        const updates = await this.apiCall<TelegramUpdate[]>('getUpdates', {
          ...(offset === undefined ? {} : { offset }),
          timeout: 25,
          allowed_updates: ['message', 'callback_query'],
        });
        this.telegramConnected = true;
        this.connectionError = null;
        for (const update of updates) {
          await this.handleWebhookUpdate(update);
          offset = update.update_id + 1;
        }
      } catch (error) {
        this.telegramConnected = false;
        this.connectionError = error instanceof Error ? error.message : 'Telegram polling failed';
        console.error('[Telegram] Polling error:', this.connectionError);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }


  private async cacheTelegramAvatar(ownerKey: string, fileId: string, token = config.telegram.botToken): Promise<string | undefined> {
    const cacheKey = ownerKey + ':' + fileId;
    if (this.avatarCache.has(cacheKey)) return this.avatarCache.get(cacheKey) || undefined;
    try {
      const file = await this.apiCall<{ file_path?: string }>('getFile', { file_id: fileId }, undefined, token);
      if (!file.file_path) return undefined;
      const response = await fetch('https://api.telegram.org/file/bot' + token + '/' + file.file_path);
      if (!response.ok) throw new Error('Telegram avatar download failed (' + response.status + ')');
      const extension = path.extname(file.file_path).toLowerCase();
      const safeExtension = ['.jpg', '.jpeg', '.png', '.webp'].includes(extension) ? extension : '.jpg';
      const filename = createHash('sha256').update(ownerKey + ':' + fileId).digest('hex') + safeExtension;
      const avatarUrl = '/uploads/telegram-avatars/' + filename;
      await storeUpload(avatarUrl, Buffer.from(await response.arrayBuffer()));
      this.avatarCache.set(cacheKey, avatarUrl);
      return avatarUrl;
    } catch (error) {
      console.warn('[Telegram] Could not cache avatar for ' + ownerKey + ':', error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  private async getTelegramUserAvatar(telegramUserId: string, token = config.telegram.botToken, ownerKey = 'env'): Promise<string | undefined> {
    const cacheKey = 'user:' + ownerKey + ':' + telegramUserId;
    if (this.avatarCache.has(cacheKey)) return this.avatarCache.get(cacheKey) || undefined;
    try {
      const result = await this.apiCall<{ total_count: number; photos: { file_id: string }[][] }>(
        'getUserProfilePhotos', { user_id: telegramUserId, limit: 1 }, undefined, token
      );
      const photo = result.photos?.[0]?.at(-1);
      if (!photo) { this.avatarCache.set(cacheKey, null); return undefined; }
      const avatarUrl = await this.cacheTelegramAvatar(cacheKey, photo.file_id, token);
      this.avatarCache.set(cacheKey, avatarUrl || null);
      return avatarUrl;
    } catch (error) {
      console.warn('[Telegram] Could not fetch user profile photo for ' + telegramUserId + ':', error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  private async getTelegramChatAvatar(telegramChatId: string, token = config.telegram.botToken, ownerKey = 'env'): Promise<string | undefined> {
    const cacheKey = 'chat:' + ownerKey + ':' + telegramChatId;
    if (this.avatarCache.has(cacheKey)) return this.avatarCache.get(cacheKey) || undefined;
    try {
      const chat = await this.apiCall<{ photo?: { big_file_id?: string; small_file_id?: string } }>(
        'getChat', { chat_id: telegramChatId }, undefined, token
      );
      const fileId = chat.photo?.big_file_id || chat.photo?.small_file_id;
      if (!fileId) { this.avatarCache.set(cacheKey, null); return undefined; }
      const avatarUrl = await this.cacheTelegramAvatar(cacheKey, fileId, token);
      this.avatarCache.set(cacheKey, avatarUrl || null);
      return avatarUrl;
    } catch (error) {
      console.warn('[Telegram] Could not fetch chat photo for ' + telegramChatId + ':', error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  private async getBotForChat(chat: Chat) {
    if (!chat.botId) return null;
    const bot = await db.getManagedBotById(chat.botId);
    if (!bot || !bot.isEnabled) throw new Error('Bot của hội thoại hiện không được bật');
    return bot;
  }

  private async sendActionMenu(chatId: string, threadId: number | undefined, botId: string, token: string, customerName: string): Promise<void> {
    if (!chatId.startsWith('-')) await this.resetBotMenu(token, chatId);
    const bot = await db.getManagedBotById(botId);
    const buttons = await bnkDataService.getCustomerMenu();
    if (!buttons.length) return;
    const inline_keyboard = buttons.map((button) => [{
      text: button.label,
      ...(button.action === 'url' && button.url ? { url: button.url } : { callback_data: `action:${button.id}` }),
    }]);
    const welcomeText = `👋 Xin chào ${customerName}!`;
    const sent = await this.apiCall<any>('sendMessage', {
      chat_id: chatId,
      ...(threadId && threadId > 0 ? { message_thread_id: threadId } : {}),
      text: welcomeText,
      reply_markup: { inline_keyboard },
    }, undefined, token);
    const scopedId = createHash('sha1').update(botId).digest('hex').slice(0, 10);
    const chat = (await db.getChats(undefined, undefined, botId)).find((item) => item.telegramChatId === chatId && (item.messageThreadId || 0) === (threadId || 0));
    if (!chat) return;
    const outgoing: Message = {
      id: `tg_menu_${scopedId}_${sent.message_id}`,
      chatId: chat.id,
      senderId: `bot_${botId}`,
      senderName: bot?.name || 'Trợ lý',
      text: `${welcomeText}\n${buttons.map((button) => `• ${button.label}`).join('\n')}`,
      type: 'text',
      isOutgoing: true,
      status: 'delivered',
      createdAt: new Date((sent.date || Date.now() / 1000) * 1000).toISOString(),
    };
    await db.addMessage(outgoing);
    socketService.broadcastNewMessage(chat.id, outgoing, chat);
  }

  private async sendContactVerificationPrompt(chat: Chat, token: string, purpose: 'order' | 'purchase' = 'order'): Promise<void> {
    const promptText = await this.getFlowPrompt(chat.botId, purpose === 'purchase' ? 'purchase_contact' : 'order_contact');
    const result = await this.apiCall<any>('sendMessage', {
      chat_id: chat.telegramChatId,
      text: promptText,
      reply_markup: {
        keyboard: [[{ text: await this.getFlowPrompt(chat.botId, 'contact_button'), request_contact: true }]],
        is_persistent: true,
        resize_keyboard: true,
      },
    }, undefined, token);
    const outgoing: Message = {
      id: `tg_verify_${createHash('sha1').update(`${chat.botId}:${result.message_id}`).digest('hex').slice(0, 24)}`,
      chatId: chat.id,
      senderId: `bot_${chat.botId || 'telegram'}`,
      senderName: 'Trợ lý',
      text: promptText,
      type: 'text',
      isOutgoing: true,
      status: 'delivered',
      createdAt: new Date((result.date || Date.now() / 1000) * 1000).toISOString(),
    };
    await db.addMessage(outgoing);
    socketService.broadcastNewMessage(chat.id, outgoing, chat);
  }

  private async resetBotMenu(token: string, chatId?: string): Promise<void> {
    try {
      await this.apiCall('setChatMenuButton', {
        ...(chatId ? { chat_id: chatId } : {}), menu_button: { type: 'commands' },
      }, undefined, token);
    } catch { console.warn('[Telegram] Could not restore the standard bot menu.'); }
  }

  private async sendProductCards(chat: Chat, token: string): Promise<void> {
    const products = await bnkDataService.getProducts();
    if (!products.length) {
      await this.sendMessage(chat.id, 'Hiện chưa có sản phẩm đang kinh doanh trong hệ thống.');
      return;
    }
    for (const product of products) {
      const description = product.description.trim() || 'Thông tin đang được cập nhật.';
      const purchaseIntent = uuidv4().replace(/-/g, '').slice(0, 12);
      const text = [
        `📦 ${product.name}`,
        `ℹ️ Công dụng / thông tin: ${description}`,
        `💰 Giá: ${product.price.toLocaleString('vi-VN')}₫`,
      ].join('\n');
      await this.sendMessage(chat.id, text, {
        replyMarkup: {
          inline_keyboard: [[
            { text: '🔎 Chi tiết', callback_data: `product_detail:${product.id}` },
            { text: '🛍️ Mua ngay', callback_data: `product_buy:${product.id}:${purchaseIntent}` },
            { text: '🛒 Thêm vào giỏ', callback_data: `cart:add:${product.id}` },
          ]],
        },
      });
    }
  }

  private async findTelegramAppChat(telegramChatId: string, threadId: number, botId: string): Promise<Chat | null> {
    const chats = await db.getChats(undefined, undefined, botId);
    return chats.find((item) => item.telegramChatId === telegramChatId && (item.messageThreadId || 0) === threadId)
      || chats.find((item) => item.telegramChatId === telegramChatId && !item.parentChatId)
      || null;
  }

  private async sendPurchaseInputPrompt(chat: Chat, userId: string, botId: string, text: string): Promise<void> {
    await this.sendMessage(chat.id, text);
  }

  private async sendPurchaseConfirmation(chat: Chat, token: string, productId: number, purchaseIntent: string, telegramUserId: string, telegramChatId: string, telegramBotId: string): Promise<void> {
    const buyer = await bnkDataService.getVerifiedBuyer(telegramUserId, telegramChatId, telegramBotId);
    if (!buyer) {
      await this.sendContactVerificationPrompt(chat, token, 'purchase');
      return;
    }
    const draft = await bnkDataService.getPurchaseDraft(telegramUserId, telegramChatId, telegramBotId);
    if (!draft || draft.state !== 'CONFIRM' || draft.intent !== purchaseIntent || draft.quantity < 1) return;
    const product = await bnkDataService.getProduct(productId);
    if (!product) {
      await this.sendMessage(chat.id, 'Sản phẩm này hiện không còn kinh doanh.');
      return;
    }
    if (product.stockQuantity < draft.quantity) {
      await this.sendMessage(chat.id, 'Sản phẩm hiện đã hết hàng.');
      return;
    }
    await this.sendMessage(chat.id,
      `Kiểm tra thông tin đơn hàng\nSản phẩm: ${product.name}\nSố lượng: ${draft.quantity}\nĐơn giá: ${(draft.priceMinor / 100).toLocaleString('vi-VN')}₫\nTiền hàng: ${(draft.priceMinor * draft.quantity / 100).toLocaleString('vi-VN')}₫\nNgười nhận: ${draft.name}\nSố điện thoại: ${draft.phone}\nĐịa chỉ: ${draft.address}\nPhí vận chuyển sẽ được xác nhận sau. Đơn chưa được thanh toán.`,
      {
        replyMarkup: {
          inline_keyboard: [[
            { text: 'Đặt hàng', callback_data: `purchase_confirm:${product.id}:${telegramUserId}:${purchaseIntent}:${draft.priceMinor}` },
            { text: 'Chỉnh sửa thông tin', callback_data: `purchase_edit:${purchaseIntent}` },
            { text: 'Hủy', callback_data: `purchase_cancel:${draft.cancelIntent || purchaseIntent}` },
          ]],
        },
      }
    );
  }

  private async handleProductCallback(query: any, botContext: { botId: string; token: string }): Promise<void> {
    if (!query?.id || !query?.message?.chat) return;
    const data = typeof query.data === 'string' ? query.data : '';
    const telegramChatId = String(query.message.chat.id);
    const threadId = Number(query.message.message_thread_id || 0);
    const chat = await this.findTelegramAppChat(telegramChatId, threadId, botContext.botId);
    try {
      if (!data.startsWith('cart:')) await this.apiCall('answerCallbackQuery', { callback_query_id: query.id }, undefined, botContext.token);
    } catch (error) {
      console.warn('[Telegram] Could not acknowledge product callback:', error instanceof Error ? error.message : error);
    }
    if (!chat) return;

    if (data.startsWith('cart:')) {
      await this.apiCall('answerCallbackQuery', {
        callback_query_id: query.id,
        text: data.startsWith('cart:add:') ? '🛒 Nút minh họa — chức năng giỏ hàng sẽ được bổ sung sau.' : 'Chức năng xem giỏ hàng đã tạm bỏ.',
      }, undefined, botContext.token);
      return;
    }

    const detailMatch = data.match(/^product_detail:(\d+)$/);
    if (detailMatch) {
      const product = await bnkDataService.getProduct(Number(detailMatch[1]));
      if (!product) {
        await this.sendMessage(chat.id, 'Sản phẩm này hiện không còn kinh doanh.');
        return;
      }
      const purchaseIntent = uuidv4().replace(/-/g, '').slice(0, 12);
      await this.sendMessage(chat.id, [
        `📦 Chi tiết: ${product.name}`,
        `ℹ️ Công dụng / thông tin: ${product.description.trim() || 'Đang cập nhật.'}`,
        `🏷️ Quy cách: ${product.packaging || 'Đang cập nhật'}`,
        `💰 Giá: ${product.price.toLocaleString('vi-VN')}₫`,
        `${product.stockQuantity > 0 ? '✅' : '❌'} Tình trạng: ${product.stockQuantity > 0 ? 'Còn hàng' : 'Hết hàng'}`,
      ].join('\n'), {
        replyMarkup: { inline_keyboard: [[{ text: '🛍️ Mua ngay', callback_data: `product_buy:${product.id}:${purchaseIntent}` }, { text: '🛒 Thêm vào giỏ', callback_data: `cart:add:${product.id}` }]] },
      });
      return;
    }

    const buyMatch = data.match(/^product_buy:(\d+):([a-f0-9]{12})$/i);
    if ((buyMatch || data.startsWith('purchase_confirm:')) && broadcastService.getMaintenance().enabled) {
      await this.sendMessage(chat.id, broadcastService.getMaintenance().message);
      return;
    }
    if (buyMatch) {
      if (query.message.chat.type !== 'private') {
        await this.sendMessage(chat.id, await this.getFlowPrompt(botContext.botId, 'private_chat_required'));
        return;
      }
      const managedBot = await db.getManagedBotById(botContext.botId);
      const telegramBotId = managedBot?.telegramBotId || managedBot?.username || botContext.botId;
      if (!bnkDataService.isReady()) {
        await this.sendMessage(chat.id, 'Dữ liệu đặt hàng hiện chưa sẵn sàng. Vui lòng thử lại sau.');
        return;
      }
      const product = await bnkDataService.getProduct(Number(buyMatch[1]));
      if (!product || product.stockQuantity < 1) {
        await this.sendMessage(chat.id, 'Sản phẩm hiện không còn hàng.');
        return;
      }
      await bnkDataService.startPurchaseDraft(String(query.from.id), telegramChatId, telegramBotId, product.id);
      const buyer = await bnkDataService.getVerifiedBuyer(String(query.from.id), telegramChatId, telegramBotId);
      if (!buyer) await this.sendContactVerificationPrompt(chat, botContext.token, 'purchase');
      else await this.sendPurchaseInputPrompt(chat, String(query.from.id), telegramBotId, 'Vui lòng nhập họ tên người nhận.');
      return;
    }

    const changeMatch = data.match(/^purchase_(edit|cancel):([a-f0-9]{12})$/i);
    if (changeMatch) {
      const managedBot = await db.getManagedBotById(botContext.botId);
      const telegramBotId = managedBot?.telegramBotId || managedBot?.username || botContext.botId;
      const changed = query.message.chat.type === 'private' && await bnkDataService.changePurchaseDraft(
        String(query.from?.id || ''), telegramChatId, telegramBotId, changeMatch[2], changeMatch[1] === 'edit');
      if (changed && changeMatch[1] === 'edit') {
        await this.sendPurchaseInputPrompt(chat, String(query.from.id), telegramBotId, 'Vui lòng nhập lại họ tên người nhận.');
      } else {
        await this.sendMessage(chat.id, changed ? 'Đã hủy đặt hàng.' : 'Thông tin xác nhận đã hết hạn hoặc đã được xử lý. Vui lòng bấm Mua ngay để bắt đầu lại.');
      }
      return;
    }

    const confirmMatch = data.match(/^purchase_confirm:(\d+):(\d+):([a-f0-9]{12}):(\d{1,12})$/i);
    if (confirmMatch) {
      if (String(query.from?.id || '') !== confirmMatch[2] || query.message.chat.type !== 'private') {
        await this.sendMessage(chat.id, 'Chỉ tài khoản đã bắt đầu thao tác trong chat riêng mới có thể xác nhận đơn.');
        return;
      }
      const managedBot = await db.getManagedBotById(botContext.botId);
      const telegramBotId = managedBot?.telegramBotId || managedBot?.username || botContext.botId;
      const result = await bnkDataService.createProductOrder({
        productId: Number(confirmMatch[1]),
        telegramUserId: String(query.from.id),
        telegramChatId,
        telegramBotId,
        purchaseIntent: confirmMatch[3],
        expectedPriceMinor: Number(confirmMatch[4]),
      });
      if (result.status === 'created') {
        const isDemoProduct = (result.productName || '').toLocaleLowerCase('vi').includes('demo');
        await this.sendMessage(chat.id, `${isDemoProduct ? 'Đã tạo đơn thử nghiệm' : 'Đã tạo đơn'} ${result.orderCode}: ${result.quantity} × ${result.productName}, tiền hàng ${Number(result.amount).toLocaleString('vi-VN')}₫. Đơn chưa thanh toán; phí vận chuyển sẽ được xác nhận sau.`);
      } else if (result.status === 'existing') {
        await this.sendMessage(chat.id, `Thao tác này đã tạo đơn ${result.orderCode} trước đó; hệ thống không tạo đơn trùng.`);
      } else if (result.status === 'link_required') {
        await this.sendContactVerificationPrompt(chat, botContext.token);
      } else if (result.status === 'missing_address') {
        await this.sendMessage(chat.id, 'Hồ sơ khách hàng chưa có đủ địa chỉ và số điện thoại giao hàng. Vui lòng liên hệ nhân viên để cập nhật.');
      } else if (result.status === 'out_of_stock') {
        await this.sendMessage(chat.id, 'Số lượng tồn kho không đủ nên chưa tạo đơn. Vui lòng bấm Mua ngay để chọn lại số lượng.');
      } else if (result.status === 'invalid_product') {
        await this.sendMessage(chat.id, 'Sản phẩm không còn hoạt động nên chưa tạo đơn.');
      } else if (result.status === 'price_changed') {
        await this.sendMessage(chat.id, 'Giá sản phẩm vừa thay đổi nên chưa tạo đơn. Hãy chọn Mua ngay lần nữa để xem giá mới và xác nhận lại.');
      } else if (result.status === 'draft_required') {
        await this.sendMessage(chat.id, 'Thông tin xác nhận đã thay đổi hoặc hết hạn. Vui lòng dùng bản xác nhận mới nhất hoặc bấm Mua ngay để bắt đầu lại.');
      } else if (result.status === 'conflict') {
        await this.sendMessage(chat.id, 'Mã xác nhận này đã được dùng cho một hồ sơ khác. Hãy quay lại danh sách sản phẩm để bắt đầu thao tác mới.');
      }
    }
  }

  private async handleActionButtonCallback(query: any, botContext?: { botId: string; token: string }): Promise<void> {
    if (!query?.id || !query?.message?.chat || !botContext) return;
    const callbackToken = botContext.token;
    try {
      await this.apiCall('answerCallbackQuery', { callback_query_id: query.id }, undefined, callbackToken);
    } catch (error) {
      console.warn('[Telegram] Could not acknowledge button callback:', error instanceof Error ? error.message : error);
    }

    const callbackData = typeof query.data === 'string' ? query.data : '';
    const buttonId = callbackData.startsWith('action:') ? callbackData.slice(7) : '';
    if (!buttonId) return;
    const bot = await db.getManagedBotById(botContext.botId);
    const customerMenu = await bnkDataService.getCustomerMenu();
    const button = customerMenu.find((item) => item.id === buttonId)
      || bot?.actionButtons?.find((item) => item.id === buttonId && item.enabled);
    if (!button) {
      await this.apiCall('sendMessage', {
        chat_id: String(query.message.chat.id),
        ...(Number(query.message.message_thread_id || 0) > 0 ? { message_thread_id: Number(query.message.message_thread_id) } : {}),
        text: 'Nút này hiện không còn hoạt động. Hãy gửi /start để xem menu mới.',
      }, undefined, callbackToken);
      return;
    }

    const telegramChatId = String(query.message.chat.id);
    const allChats = await db.getChats(undefined, undefined, botContext.botId);
    const threadId = Number(query.message.message_thread_id || 0);
    const chat = allChats.find((item) => item.telegramChatId === telegramChatId && (item.messageThreadId || 0) === threadId)
      || allChats.find((item) => item.telegramChatId === telegramChatId && !item.parentChatId);
    if (!chat) return;
    const callbackMessageId = `callback_${createHash('sha1').update(String(query.id)).digest('hex').slice(0, 32)}`;
    if (await db.getMessageById(chat.id, callbackMessageId)) return;
    const eventId = `telegram:${botContext.botId}:${query.id}`.slice(0, 150);
    let eventStarted = false;
    try {
      const event = await bnkDataService.beginButtonEvent(chat.id, eventId, button.action);
      if (event.duplicate) return;
      if (event.disabled) {
        await this.sendMessage(chat.id, 'Chức năng này hiện đã tắt. Hãy gửi /start để xem các lựa chọn đang hoạt động.');
        return;
      }
      eventStarted = Boolean(event.buttonId);

    const customerName = [query.from?.first_name, query.from?.last_name].filter(Boolean).join(' ') || query.from?.username || 'Khách hàng';
    const selected: Message = {
      id: callbackMessageId,
      chatId: chat.id,
      senderId: `tg_user_${query.from?.id || 'unknown'}`,
      senderName: customerName,
      text: button.label,
      type: 'text',
      isOutgoing: false,
      status: 'delivered',
      replyToId: `bot-action:${button.action}`,
      createdAt: new Date().toISOString(),
    };
    await db.addMessage(selected);
    socketService.broadcastNewMessage(chat.id, selected, chat);
    if (chat.parentChatId) socketService.broadcastChatStructureChanged(chat.parentChatId);

    const fallbackText = ('responseText' in button ? button.responseText?.trim() : '') || '';
    let responseText = fallbackText;
    if (button.action === 'reply') responseText = await bnkDataService.getGuideText(eventStarted ? '' : fallbackText);
    else if (button.action === 'consult') {
      await this.sendProductCards(chat, callbackToken);
      responseText = '';
    }
    else if (button.action === 'order_lookup') {
      const managedBot = await db.getManagedBotById(botContext.botId);
      const telegramBotId = managedBot?.telegramBotId || managedBot?.username || botContext.botId;
      if (query.message.chat.type !== 'private') {
        responseText = 'Vui lòng mở cuộc trò chuyện riêng với bot để xác minh tài khoản và tra cứu đơn.';
      } else {
        const lookup = await bnkDataService.startOrderLookup(String(query.from?.id || ''), telegramChatId, telegramBotId);
        if (lookup === 'started') responseText = await this.getFlowPrompt(botContext.botId, 'order_code');
        else if (lookup === 'link_required') {
          await this.sendContactVerificationPrompt(chat, callbackToken);
          responseText = '';
        } else responseText = fallbackText || 'Chức năng tra cứu đơn hiện chưa kết nối được cơ sở dữ liệu.';
      }
    } else if (button.action === 'purchase_history') {
      if (query.message.chat.type !== 'private') {
        responseText = 'Vui lòng mở cuộc trò chuyện riêng với bot để xem lịch sử mua.';
      } else {
        const telegramBotId = bot?.telegramBotId || bot?.username || botContext.botId;
        const history = await bnkDataService.getPurchaseHistory(String(query.from?.id || ''), telegramChatId, telegramBotId);
        if (history === null) {
          await this.sendContactVerificationPrompt(chat, callbackToken);
          responseText = '';
        } else responseText = history;
      }
    } else if (button.action === 'phone_support') {
      await this.apiCall('sendContact', {
        chat_id: telegramChatId,
        ...(threadId > 0 ? { message_thread_id: threadId } : {}),
        phone_number: '0868686868',
        first_name: 'Hỗ trợ VAGA',
      }, undefined, callbackToken);
      responseText = '☎️ Liên hệ hỗ trợ: 0868686868. Nhấn vào số điện thoại trong thẻ liên hệ để gọi.';
    } else if (button.action === 'human_support') {
      const request = await bnkDataService.createSupportRequest(chat.id, `Khách ${customerName} yêu cầu gặp nhân viên qua Telegram.`);
      responseText = request.existing
        ? `Yêu cầu ${request.requestCode} đang được xử lý${request.employeeName ? ` bởi ${request.employeeName}` : ' và đang chờ nhân viên nhận'}.`
        : `Đã ghi nhận yêu cầu ${request.requestCode}${request.employeeName ? ` và chuyển tới ${request.employeeName}` : '; yêu cầu đang ở hàng đợi, sẽ được phân công trong ca trực'}.`;
    } else if (button.action === 'resolve') {
      const resolved = await bnkDataService.resolveSupportRequest(chat.id);
      responseText = resolved.resolved
        ? `Yêu cầu ${resolved.requestCode} đã được đóng. Nếu cần hỗ trợ thêm, hãy nhắn tin tại đây.`
        : 'Hiện không có yêu cầu hỗ trợ đang mở để đóng.';
    }
    if (responseText) await this.sendMessage(chat.id, responseText);
      if (eventStarted) await bnkDataService.finishButtonEvent(eventId);
    } catch (error) {
      if (eventStarted) await bnkDataService.finishButtonEvent(eventId, error instanceof Error ? error.message : 'Không xử lý được thao tác');
      console.error('[BNK] Could not process Telegram button:', error instanceof Error ? error.message : error);
      await this.sendMessage(chat.id, 'Hệ thống chưa xử lý được yêu cầu này. Vui lòng thử lại hoặc chọn Gặp nhân viên.');
    }
  }

  async createForumTopic(chatId: string, topicName: string): Promise<Chat> {
    const parent = await db.getChatById(chatId);
    if (!parent || parent.type !== 'group' || parent.parentChatId) throw new Error('Không tìm thấy nhóm Telegram');
    if (!parent.isForum) throw new Error('Nhóm này chưa bật Forum Topics trên Telegram');
    const bot = await this.getBotForChat(parent);
    if (!bot || bot.mode === 'mock') throw new Error('Bot này không hỗ trợ tạo topic Telegram');
    const result = await this.apiCall<{ message_thread_id: number; name?: string }>('createForumTopic', {
      chat_id: parent.telegramChatId,
      name: topicName.trim().slice(0, 128),
    }, undefined, bot.token);
    const topic = await db.upsertTelegramTopic(parent, result.message_thread_id, result.name || topicName.trim(), new Date().toISOString());
    socketService.broadcastChatStructureChanged(parent.id);
    return topic;
  }

  async syncForumTopics(chatId: string): Promise<{ isForum: boolean; topics: Chat[] }> {
    const parent = await db.getChatById(chatId);
    if (!parent || parent.type !== 'group' || parent.parentChatId) throw new Error('Không tìm thấy nhóm Telegram');
    const bot = await this.getBotForChat(parent);
    const token = bot?.token || config.telegram.botToken;
    if (!token || (!bot && config.telegram.mode === 'mock')) throw new Error('Không thể kết nối Telegram cho nhóm này');
    const telegramChat = await this.apiCall<{ is_forum?: boolean; title?: string }>('getChat', { chat_id: parent.telegramChatId }, undefined, token);
    const isForum = Boolean(telegramChat.is_forum);
    const updated = await db.upsertTelegramChat({ ...parent, isForum, title: telegramChat.title || parent.title, updatedAt: parent.updatedAt });
    let topics: Chat[] = [];
    if (isForum) {
      await db.upsertTelegramTopic(updated, 0, 'General', updated.createdAt);
      topics = (await db.getChats(undefined, undefined, updated.botId ?? null)).filter((chat) => chat.parentChatId === updated.id);
      socketService.broadcastChatStructureChanged(updated.id);
    }
    return { isForum, topics };
  }

  /**
   * Send a message to Telegram (Real API or Mocked)
   */
  async sendBroadcast(chatId: string, input: BroadcastInput): Promise<void> {
    const chat = await db.getChatById(chatId);
    if (!chat || chat.botId !== input.botId) throw new Error('Hội thoại không còn thuộc bot đã chọn.');
    const bot = await this.getBotForChat(chat);
    if (!bot || bot.mode === 'mock') throw new Error('Bot không khả dụng để gửi Telegram.');
    const escapeTitle = (value: string) => input.parseMode === 'MarkdownV2' ? value.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, '\\$&') : value;
    const text = `${escapeTitle(input.title)}\n\n${input.content}`;
    if (text.length > (input.imageUrl ? 1024 : 4096)) throw new Error('Nội dung sau định dạng vượt giới hạn Telegram.');
    const body = {
      chat_id: chat.telegramChatId,
      ...(chat.messageThreadId && chat.messageThreadId > 0 ? { message_thread_id: chat.messageThreadId } : {}),
      ...(input.imageUrl ? { photo: input.imageUrl, caption: text } : { text }),
      ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
      ...(input.buttonUrl ? { reply_markup: { inline_keyboard: [[{ text: input.buttonText, url: input.buttonUrl }]] } } : {}),
    };
    let delivered = false;
    let deliveredContent: { text?: string; caption?: string; entities?: Message['entities']; caption_entities?: Message['entities'] } | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      let requestBody: string | FormData = JSON.stringify(body);
      let headers: Record<string, string> | undefined = { 'Content-Type': 'application/json' };
      if (isBroadcastImage(input.imageUrl)) {
        const form = new FormData();
        for (const [key, value] of Object.entries(body)) {
          if (key !== 'photo') form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
        }
        const asset = await readUpload(input.imageUrl);
        if (!asset) throw new Error('Broadcast image is unavailable');
        const image = asset.data;
        const extension = path.extname(input.imageUrl).slice(1);
        form.append('photo', new Blob([new Uint8Array(image)], { type: extension === 'jpg' ? 'image/jpeg' : `image/${extension}` }), path.basename(input.imageUrl));
        requestBody = form; headers = undefined;
      }
      const response = await fetch(`https://api.telegram.org/bot${bot.token}/${input.imageUrl ? 'sendPhoto' : 'sendMessage'}`, {
        method: 'POST', headers, body: requestBody, signal: AbortSignal.timeout(30000),
      });
      const result = await response.json() as { ok: boolean; description?: string; parameters?: { retry_after?: number }; result?: typeof deliveredContent };
      if (result.ok) { delivered = true; deliveredContent = result.result; break; }
      if (response.status === 429 && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, Math.min(300, Math.max(1, result.parameters?.retry_after || 5)) * 1000));
        continue;
      }
      throw new Error(result.description || `Telegram trả lỗi ${response.status}`);
    }
    if (!delivered) throw new Error('Telegram đang giới hạn gửi tin.');
    const message: Message = {
      id: `broadcast_${uuidv4()}`, chatId, senderId: `bot_${bot.id}`, senderName: bot.name,
      text: deliveredContent?.text ?? deliveredContent?.caption ?? `${input.title}\n\n${input.content}`, type: input.imageUrl ? 'image' : 'text',
      entities: deliveredContent?.entities ?? deliveredContent?.caption_entities,
      ...(input.imageUrl ? { mediaUrl: input.imageUrl } : {}), isOutgoing: true, status: 'delivered', createdAt: new Date().toISOString(),
    };
    // A local logging failure must not turn a delivered Telegram message into a retry candidate.
    try { await db.addMessage(message); socketService.broadcastNewMessage(chatId, message, chat); }
    catch { console.error('[Broadcast] Telegram delivered; could not save conversation message.'); }
  }

  async sendMessage(chatId: string, text: string, options: { replyToId?: string; forwardedFrom?: string; replyMarkup?: Record<string, unknown> } = {}): Promise<Message & { telegramMessageId?: number }> {
    const chat = await db.getChatById(chatId);
    if (!chat) {
      throw new Error(`Chat not found: ${chatId}`);
    }

    const message: Message = {
      id: `msg_${Date.now()}_${uuidv4().slice(0, 4)}`,
      chatId,
      senderId: 'user_agent_me',
      senderName: 'Chăm Sóc Khách Hàng',
      text,
      type: 'text',
      isOutgoing: true,
      status: 'sent',
      replyToId: options.replyToId,
      forwardedFrom: options.forwardedFrom,
      createdAt: new Date().toISOString(),
    };

    const managedBot = await this.getBotForChat(chat);
    const token = managedBot?.token || config.telegram.botToken;
    let telegramMessageId: number | undefined;
    if ((managedBot ? managedBot.mode !== 'mock' : config.telegram.mode !== 'mock') && token && chat.telegramChatId && !chat.telegramChatId.startsWith('mock_')) {
      const sent = await this.apiCall<{ message_id: number }>('sendMessage', {
        chat_id: chat.telegramChatId,
        text,
        ...(chat.messageThreadId && chat.messageThreadId > 0 ? { message_thread_id: chat.messageThreadId } : {}),
        ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      }, undefined, token);
      telegramMessageId = sent.message_id;
      message.status = 'delivered';
    }

    await db.addMessage(message);
    socketService.broadcastNewMessage(chatId, message);

    return { ...message, telegramMessageId };
  }

  async sendMedia(chatId: string, file: { data: Buffer; mimeType: string; fileName: string; fileSize: number; mediaUrl: string; mediaType: 'image' | 'video' | 'document'; caption?: string }): Promise<Message> {
    const chat = await db.getChatById(chatId);
    if (!chat) throw new Error('Chat not found');

    const message: Message = {
      id: 'msg_' + Date.now() + '_' + uuidv4().slice(0, 4),
      chatId,
      senderId: 'user_agent_me',
      senderName: 'Chăm Sóc Khách Hàng',
      text: file.caption?.trim() || file.fileName,
      type: file.mediaType,
      mediaUrl: file.mediaUrl,
      fileName: file.fileName,
      fileSize: String(file.fileSize),
      isOutgoing: true,
      status: 'sent',
      createdAt: new Date().toISOString(),
    };

    const managedBot = await this.getBotForChat(chat);
    const token = managedBot?.token || config.telegram.botToken;
    if ((managedBot ? managedBot.mode !== 'mock' : config.telegram.mode !== 'mock') && token && chat.telegramChatId && !chat.telegramChatId.startsWith('mock_')) {
      const method = file.mediaType === 'image' ? 'sendPhoto' : file.mediaType === 'video' ? 'sendVideo' : 'sendDocument';
      const field = file.mediaType === 'image' ? 'photo' : file.mediaType === 'video' ? 'video' : 'document';
      const form = new FormData();
      form.append('chat_id', chat.telegramChatId);
      if (chat.messageThreadId && chat.messageThreadId > 0) form.append('message_thread_id', String(chat.messageThreadId));
      form.append(field, new Blob([new Uint8Array(file.data)], { type: file.mimeType }), file.fileName);
      if (file.caption?.trim()) form.append('caption', file.caption.trim().slice(0, 1024));
      const response = await fetch('https://api.telegram.org/bot' + token + '/' + method, { method: 'POST', body: form });
      const result = await response.json() as TelegramApiResponse<unknown>;
      if (!response.ok || !result.ok) throw new Error(result.description || 'Telegram API ' + method + ' failed (' + response.status + ')');
      message.status = 'delivered';
    }

    await db.addMessage(message);
    socketService.broadcastNewMessage(chatId, message);
    return message;
  }

  /**
   * Handle incoming Webhook payload from Telegram Bot API
   */
  async handleWebhookUpdate(update: any, botContext?: { botId: string; token: string }): Promise<void> {
    if (update?.callback_query) {
      const callbackData = typeof update.callback_query.data === 'string' ? update.callback_query.data : '';
      if (/^(cart|product_detail|product_buy|purchase_confirm|purchase_cancel|purchase_edit):/.test(callbackData) && botContext) {
        await this.handleProductCallback(update.callback_query, botContext);
      } else {
        await this.handleActionButtonCallback(update.callback_query, botContext);
      }
      return;
    }
    const tgMessage = update.message;
    if (!tgMessage?.chat) return;
    const fromUser = tgMessage.from;
    const topicCreated = tgMessage.forum_topic_created;
    const topicEdited = tgMessage.forum_topic_edited;
    const isTopicService = Boolean(topicCreated || topicEdited);
    if ((!fromUser || fromUser.is_bot) && !isTopicService) return;
    const hasContact = Boolean(tgMessage.contact);
    const attachment = telegramMedia(tgMessage);
    if (typeof tgMessage.text !== 'string' && !isTopicService && !hasContact && !attachment) return;

    const tgChatId = String(tgMessage.chat.id);
    const timestamp = new Date((tgMessage.date || Date.now() / 1000) * 1000).toISOString();
    const ownerKey = botContext?.botId || 'env';
    const chatOwnerKey = botContext ? createHash('sha1').update(botContext.botId).digest('hex').slice(0, 10) : 'legacy';
    const messageOwnerKey = botContext ? chatOwnerKey : 'legacy';
    const botToken = botContext?.token || config.telegram.botToken;
    const existing = (await db.getChats(undefined, undefined, botContext?.botId ?? null)).find((item) =>
      item.telegramChatId === tgChatId && !item.parentChatId
    );
    const title = tgMessage.chat.type === 'private'
      ? [fromUser?.first_name, fromUser?.last_name].filter(Boolean).join(' ') || existing?.title || 'Người dùng'
      : (tgMessage.chat.title || existing?.title || 'Nhóm Telegram');

    let user: User | undefined;
    let userAvatarUrl: string | undefined;
    if (fromUser && !fromUser.is_bot) {
      const telegramUserId = String(fromUser.id);
      const existingUser = await db.getUserByTelegramId(telegramUserId);
      userAvatarUrl = existingUser?.avatarUrl || await this.getTelegramUserAvatar(telegramUserId, botToken, ownerKey);
      user = await db.upsertTelegramUser({
        id: `tg_user_${telegramUserId}`,
        telegramId: telegramUserId,
        firstName: fromUser.first_name || 'Người dùng',
        lastName: fromUser.last_name || undefined,
        username: fromUser.username || undefined,
        avatarUrl: userAvatarUrl,
        isBot: false,
        isOnline: true,
        lastSeen: 'Vừa xong',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    const chatAvatarUrl = existing?.avatarUrl || (tgMessage.chat.type === 'private'
      ? userAvatarUrl
      : await this.getTelegramChatAvatar(tgChatId, botToken, ownerKey));
    const parent = await db.upsertTelegramChat({
      id: existing?.id || `chat_tg_${chatOwnerKey}_${tgChatId}`,
      botId: botContext?.botId,
      telegramChatId: tgChatId,
      type: tgMessage.chat.type === 'private' ? 'direct' : 'group',
      title,
      avatarUrl: chatAvatarUrl,
      category: existing?.category || 'support',
      isPinned: existing?.isPinned || false,
      isMuted: existing?.isMuted || false,
      unreadCount: existing?.unreadCount || 0,
      participantIds: [...new Set([...(existing?.participantIds || ['user_agent_me']), ...(user ? [user.id] : [])])],
      isForum: Boolean(tgMessage.chat.is_forum || existing?.isForum || isTopicService),
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    });

    if (parent.isForum) await db.upsertTelegramTopic(parent, 0, 'General', parent.createdAt);
    if (isTopicService) {
      const threadId = Number(tgMessage.message_thread_id ?? topicCreated?.message_thread_id ?? topicEdited?.message_thread_id);
      if (Number.isFinite(threadId)) {
        const cachedTopic = (await db.getChats(undefined, undefined, parent.botId ?? null)).find((item) => item.parentChatId === parent.id && item.messageThreadId === threadId);
        const name = topicCreated?.name || topicEdited?.name || cachedTopic?.topicName || `Topic ${threadId}`;
        await db.upsertTelegramTopic(parent, threadId, name, timestamp);
        socketService.broadcastChatStructureChanged(parent.id);
      }
      return;
    }

    let destination = parent;
    if (parent.isForum || tgMessage.is_topic_message || tgMessage.message_thread_id !== undefined) {
      const threadId = Number(tgMessage.message_thread_id || 0);
      const knownTopic = (await db.getChats(undefined, undefined, parent.botId ?? null)).find((item) => item.parentChatId === parent.id && item.messageThreadId === threadId);
      const replyTopicName = tgMessage.reply_to_message?.forum_topic_created?.name;
      destination = await db.upsertTelegramTopic(parent, threadId, threadId === 0 ? 'General' : knownTopic?.topicName || replyTopicName || `Topic ${threadId}`, timestamp);
    }

    if (!user) return;
    if (hasContact) {
      const contact = tgMessage.contact;
      if (tgMessage.chat.type !== 'private' || String(contact.user_id || '') !== String(fromUser.id)) {
        await this.sendMessage(destination.id, await this.getFlowPrompt(botContext?.botId, 'contact_invalid'), {
          replyMarkup: { remove_keyboard: true },
        });
        return;
      }
      if (!botContext) {
        await this.sendMessage(destination.id, BOT_FLOW_PROMPT_DEFAULTS.contact_unavailable, {
          replyMarkup: { remove_keyboard: true },
        });
        return;
      }
      const managedBot = await db.getManagedBotById(botContext.botId);
      const telegramBotId = managedBot?.telegramBotId || managedBot?.username || botContext.botId;
      const linkResult = await bnkDataService.verifyTelegramContact({
        telegramUserId: String(fromUser.id),
        telegramChatId: tgChatId,
        telegramUsername: fromUser.username || undefined,
        customerName: [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' '),
        phone: String(contact.phone_number || ''),
        telegramBotId,
        botName: managedBot?.name || 'Telegram bot',
      });
      const draft = await bnkDataService.getPurchaseDraft(String(fromUser.id), tgChatId, telegramBotId);
      if (draft && draft.state === 'NAME' && ['verified', 'new_customer', 'address_required'].includes(linkResult)) {
        await this.sendMessage(destination.id, 'Đã xác minh tài khoản.', { replyMarkup: { remove_keyboard: true } });
        await this.sendPurchaseInputPrompt(destination, String(fromUser.id), telegramBotId, 'Vui lòng nhập họ tên người nhận.');
        return;
      }
      const linkPromptKeys = {
        verified: 'contact_verified', new_customer: 'customer_created', address_required: 'customer_address_matched',
        ambiguous: 'contact_ambiguous', already_linked: 'contact_already_linked', unavailable: 'contact_unavailable',
      } as const;
      await this.sendMessage(destination.id, await this.getFlowPrompt(botContext.botId, linkPromptKeys[linkResult]), { replyMarkup: { remove_keyboard: true } });
      return;
    }
    if (typeof tgMessage.text !== 'string' && !attachment) return;
    const incomingMessage: Message = {
      id: `tg_${messageOwnerKey}_${tgChatId}_${tgMessage.message_id}`,
      chatId: destination.id,
      senderId: user.id,
      senderName: [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' '),
      text: tgMessage.text || tgMessage.caption || attachment?.fileName || '',
      type: attachment?.type || 'text',
      ...(attachment ? { fileName: attachment.fileName, fileSize: String(attachment.fileSize || '') } : {}),
      isOutgoing: false,
      status: 'delivered',
      createdAt: timestamp,
    };
    if (await db.getMessageById(destination.id, incomingMessage.id)) return;
    if (attachment) {
      try {
        const file = await this.apiCall<{ file_path?: string }>('getFile', { file_id: attachment.fileId }, undefined, botToken);
        if (!file.file_path) throw new Error('Telegram file path unavailable');
        const response = await fetch('https://api.telegram.org/file/bot' + botToken + '/' + file.file_path, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error('Telegram file download failed');
        const data = Buffer.from(await response.arrayBuffer());
        const extension = path.extname(attachment.fileName) || path.extname(file.file_path);
        const safeExtension = /^\.[a-zA-Z0-9]{1,10}$/.test(extension) ? extension.toLowerCase() : '';
        const url = '/uploads/telegram_' + createHash('sha256').update(ownerKey + ':' + attachment.fileId).digest('hex') + safeExtension;
        await storeUpload(url, data, attachment.mimeType);
        incomingMessage.mediaUrl = url;
        incomingMessage.fileSize = String(data.length);
      } catch {
        // Preserve the message and keep polling even if Telegram cannot supply the file.
        incomingMessage.text += '\nKhông tải được tệp từ Telegram.';
      }
    }
    await db.addMessage(incomingMessage);
    socketService.broadcastNewMessage(destination.id, incomingMessage, destination, user);
    if (destination.parentChatId) socketService.broadcastChatStructureChanged(destination.parentChatId);
    if (attachment) return;
    const command = tgMessage.text.trim().match(/^\/(start|cancel)(?:@\w+)?(?:\s|$)/i)?.[1]?.toLowerCase();
    if (botContext && command) {
      if (tgMessage.chat.type === 'private') {
        const managedBot = await db.getManagedBotById(botContext.botId);
        const telegramBotId = managedBot?.telegramBotId || managedBot?.username || botContext.botId;
        await bnkDataService.resetCustomerFlow(String(fromUser.id), tgChatId, telegramBotId);
      }
      if (command === 'cancel') {
        await this.sendMessage(destination.id, 'Đã hủy thao tác. Gửi /start để mở menu.', { replyMarkup: { remove_keyboard: true } });
      } else {
        const customerName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || fromUser.username || 'bạn';
        await this.sendActionMenu(tgChatId, destination.messageThreadId, botContext.botId, botToken, customerName);
      }
      return;
    }
    if (botContext && tgMessage.chat.type === 'private') {
      const managedBot = await db.getManagedBotById(botContext.botId);
      const telegramBotId = managedBot?.telegramBotId || managedBot?.username || botContext.botId;
      const purchaseStep = await bnkDataService.processPurchaseInput(String(fromUser.id), tgChatId, telegramBotId, tgMessage.text);
      if (purchaseStep) {
        if (purchaseStep === 'CONFIRM') {
          const draft = await bnkDataService.getPurchaseDraft(String(fromUser.id), tgChatId, telegramBotId);
          if (draft) await this.sendPurchaseConfirmation(destination, botContext.token, draft.productId, draft.intent, String(fromUser.id), tgChatId, telegramBotId);
        } else {
          const prompts: Record<string, string> = {
            PHONE: 'Vui lòng nhập số điện thoại người nhận.',
            ADDRESS: 'Vui lòng nhập địa chỉ giao hàng đầy đủ.',
            QUANTITY: 'Vui lòng nhập số lượng mua.',
            invalid_quantity: 'Vui lòng nhập số lượng là số nguyên lớn hơn 0.',
            insufficient_stock: 'Số lượng vượt quá tồn kho. Vui lòng nhập số lượng ít hơn.',
            invalid: 'Thông tin chưa hợp lệ. Vui lòng nhập lại thông tin đang được yêu cầu (tên tối đa 150 ký tự, số điện thoại 9–15 chữ số, địa chỉ tối đa 300 ký tự).',
            unavailable: 'Sản phẩm hiện không còn hàng. Vui lòng chọn sản phẩm khác.',
          };
          await this.sendPurchaseInputPrompt(destination, String(fromUser.id), telegramBotId, prompts[purchaseStep]);
        }
        return;
      }
      const onboarding = await bnkDataService.processCustomerOnboarding(String(fromUser.id), tgChatId, telegramBotId, tgMessage.text);
      if (onboarding) {
        const onboardingPromptKeys = { need_address: 'customer_address', complete: 'customer_saved', too_long: 'customer_input_invalid' } as const;
        await this.sendMessage(destination.id, await this.getFlowPrompt(botContext.botId, onboardingPromptKeys[onboarding]));
        return;
      }
      const orderResponse = await bnkDataService.processOrderCode(String(fromUser.id), tgChatId, telegramBotId, tgMessage.text);
      if (orderResponse) await this.sendMessage(destination.id, orderResponse);
    }
  }

}

export const telegramService = new TelegramService();
