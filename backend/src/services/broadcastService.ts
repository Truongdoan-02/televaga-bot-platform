import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { db } from '../database/connection.js';
import { telegramService } from './telegramService.js';
import { isBroadcastImage } from './broadcastImages.js';

export interface BroadcastInput {
  title: string; content: string; botId: string;
  audience: 'all' | 'active' | 'vip' | 'sales' | 'support' | 'everyone' | 'groups';
  parseMode: '' | 'HTML' | 'MarkdownV2';
  imageUrl: string; buttonText: string; buttonUrl: string;
  scheduledAt: string | null;
}
type Recipient = { chatId: string; name: string; status: 'pending' | 'sending' | 'sent' | 'failed' | 'unknown'; error?: string };
export interface Broadcast extends BroadcastInput {
  id: string; createdAt: string;
  status: 'draft' | 'scheduled' | 'queued' | 'sending' | 'completed' | 'partial' | 'cancelled';
  recipients: Recipient[];
}
type Maintenance = { enabled: boolean; message: string; notifyStart: boolean; notifyEnd: boolean };
const filename = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/broadcasts.json');

export function validateBroadcast(input: any): BroadcastInput {
  if (!input || typeof input !== 'object') throw new Error('Dữ liệu không hợp lệ.');
  const text = (key: string) => typeof input[key] === 'string' ? input[key].trim() : '';
  const data: BroadcastInput = {
    title: text('title'), content: text('content'), botId: text('botId'),
    audience: input.audience, parseMode: input.parseMode || '', imageUrl: text('imageUrl'),
    buttonText: text('buttonText'), buttonUrl: text('buttonUrl'), scheduledAt: input.scheduledAt || null,
  };
  if (!data.title || data.title.length > 150 || !data.content || !data.botId) throw new Error('Nhập tiêu đề (tối đa 150 ký tự), nội dung và chọn bot.');
  if (!['all', 'active', 'vip', 'sales', 'support', 'everyone', 'groups'].includes(data.audience)) throw new Error('Nhóm nhận không hợp lệ.');
  if (!['', 'HTML', 'MarkdownV2'].includes(data.parseMode)) throw new Error('Định dạng không hợp lệ.');
  if (`${data.title}\n\n${data.content}`.length > (data.imageUrl ? 1024 : 4096)) throw new Error(data.imageUrl ? 'Tiêu đề và nội dung kèm ảnh tối đa 1024 ký tự.' : 'Tiêu đề và nội dung tối đa 4096 ký tự.');
  for (const [kind, url] of [['image', data.imageUrl], ['button', data.buttonUrl]]) {
    if (!url) continue;
    if (kind === 'image' && isBroadcastImage(url)) continue;
    try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(); }
    catch { throw new Error('Liên kết phải bắt đầu bằng http:// hoặc https://.'); }
  }
  if (Boolean(data.buttonText) !== Boolean(data.buttonUrl) || data.buttonText.length > 64) throw new Error('Nhập đủ tên nút (tối đa 64 ký tự) và liên kết.');
  if (data.scheduledAt && (typeof data.scheduledAt !== 'string' || !Number.isFinite(Date.parse(data.scheduledAt)) || Date.parse(data.scheduledAt) <= Date.now())) throw new Error('Thời gian đặt lịch phải ở tương lai.');
  if (data.scheduledAt) data.scheduledAt = new Date(data.scheduledAt).toISOString();
  return data;
}

export interface BroadcastStorage {
  load(): Promise<string | null>;
  save(payload: string): Promise<void>;
}

export class BroadcastService {
  private items: Broadcast[] = [];
  private maintenance: Maintenance = { enabled: false, message: '🛠️ Hệ thống đang bảo trì. Vui lòng quay lại sau ít phút. Cảm ơn bạn!', notifyStart: false, notifyEnd: false };
  private busy = false;
  private writes: Promise<void> = Promise.resolve();
  constructor(private storageFile = filename, private delivery = (chatId: string, item: BroadcastInput) => telegramService.sendBroadcast(chatId, item), private interval = 1100, private storage?: BroadcastStorage) {}
  async initialize(startWorker = true) {
    if (!this.storage && this.storageFile === filename && db.isMySQLActive()) {
      this.storage = { load: () => db.loadBroadcastState(), save: payload => db.saveBroadcastState(payload) };
    }
    let payload = this.storage ? await this.storage.load() : null;
    // Import the legacy file once, only if no durable state exists.
    if (payload === null) {
      try { payload = fs.readFileSync(this.storageFile, 'utf8'); }
      catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    }
    if (payload !== null) {
      const saved = JSON.parse(payload);
      if (!Array.isArray(saved.items) || !saved.maintenance || saved.items.some((item: any) => !Array.isArray(item.recipients))) throw new Error('Invalid broadcast state.');
      this.items = saved.items;
      this.maintenance = saved.maintenance;
    }
    // Never automatically resend a recipient whose delivery was interrupted.
    for (const item of this.items) {
      for (const recipient of item.recipients) if (recipient.status === 'sending') {
        recipient.status = 'unknown'; recipient.error = 'Máy chủ dừng khi đang gửi; cần kiểm tra hội thoại trước khi gửi lại.';
      }
      if (item.status === 'sending') item.status = 'queued';
    }
    await this.persist();
    if (startWorker) setInterval(() => { void this.processQueue().catch((error) => console.error('[Broadcast]', error.message)); }, 1000).unref();
  }
  private persist(): Promise<void> {
    const payload = JSON.stringify({ items: this.items, maintenance: this.maintenance }, null, 2);
    const write = this.writes.then(async () => {
      if (this.storage) { await this.storage.save(payload); return; }
      fs.mkdirSync(path.dirname(this.storageFile), { recursive: true });
      fs.writeFileSync(`${this.storageFile}.tmp`, payload);
      fs.renameSync(`${this.storageFile}.tmp`, this.storageFile);
    });
    this.writes = write.catch(() => {});
    return write;
  }
  list() { return this.items.map(({ recipients, ...item }) => ({ ...item, total: recipients.length, sent: recipients.filter(r => r.status === 'sent').length, failed: recipients.filter(r => ['failed', 'unknown'].includes(r.status)).length })); }
  detail(id: string) { const item = this.items.find(i => i.id === id); if (!item) throw new Error('Không tìm thấy thông báo.'); return item; }
  getMaintenance() { return this.maintenance; }
  async recipients(botId: string, audience: string) {
    const chats = await db.getChats(undefined, undefined, botId);
    const seen = new Set<string>();
    return chats.filter(chat => {
      if (chat.botId !== botId || !/^-?\d+$/.test(chat.telegramChatId)) return false;
      const shared = chat.type === 'group' || chat.type === 'channel';
      if (audience === 'groups' && !shared) return false;
      if (!['everyone', 'groups'].includes(audience) && (chat.type !== 'direct' || chat.parentChatId)) return false;
      if (audience === 'active' && Date.parse(chat.updatedAt) < Date.now() - 30 * 86400000) return false;
      if (['vip', 'sales', 'support'].includes(audience) && chat.category !== audience) return false;
      // The parent group, General (0), and Telegram's General thread (1)
      // share one destination. Other topics must remain separate recipients.
      const threadId = chat.messageThreadId && chat.messageThreadId > 1 ? chat.messageThreadId : 0;
      const key = `${chat.telegramChatId}:${threadId}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).map(chat => ({ chatId: chat.id, name: chat.parentTitle ? `${chat.parentTitle} / ${chat.topicName || chat.title}` : chat.title, status: 'pending' as const }));
  }
  async create(input: unknown, sendNow = false) {
    const data = validateBroadcast(input);
    const bot = await db.getManagedBotById(data.botId);
    if (!bot || !bot.isEnabled || bot.mode === 'mock') throw new Error('Chọn bot Telegram đang bật và không ở chế độ mô phỏng.');
    if (sendNow && data.scheduledAt) throw new Error('Chọn gửi ngay hoặc đặt lịch.');
    const recipients = await this.recipients(data.botId, data.audience);
    if (!recipients.length) throw new Error('Không có khách hàng phù hợp đã trò chuyện với bot này.');
    const item: Broadcast = { ...data, id: randomUUID(), createdAt: new Date().toISOString(), recipients, status: data.scheduledAt ? 'scheduled' : sendNow ? 'queued' : 'draft' };
    this.items.unshift(item); await this.persist(); return item;
  }
  async action(id: string, action: string) {
    const item = this.detail(id);
    if (action === 'send' && ['draft', 'scheduled'].includes(item.status)) { item.status = 'queued'; item.scheduledAt = null; }
    else if (action === 'cancel' && ['draft', 'scheduled', 'queued', 'sending'].includes(item.status)) item.status = 'cancelled';
    else throw new Error('Thao tác không phù hợp với trạng thái hiện tại.');
    await this.persist(); return item;
  }
  async updateMaintenance(input: any) {
    if (typeof input?.enabled !== 'boolean' || typeof input.message !== 'string' || !input.message.trim() || input.message.length > 1000 || typeof input.notifyStart !== 'boolean' || typeof input.notifyEnd !== 'boolean') throw new Error('Cấu hình bảo trì không hợp lệ.');
    const previous = this.maintenance;
    const next: Maintenance = { enabled: input.enabled, message: input.message.trim(), notifyStart: input.notifyStart, notifyEnd: input.notifyEnd };
    const notify = previous.enabled !== next.enabled && (next.enabled ? next.notifyStart : next.notifyEnd);
    // Prepare notification before changing maintenance state, so validation errors do not partially apply it.
    if (notify) await this.create({ title: next.enabled ? '🛠️ Thông báo bảo trì' : '✅ Hệ thống hoạt động trở lại', content: next.enabled ? next.message : 'Hệ thống đã hoạt động trở lại. Cảm ơn bạn đã chờ đợi!', botId: input.botId, audience: 'everyone', parseMode: '', imageUrl: '', buttonText: '', buttonUrl: '', scheduledAt: null }, true);
    this.maintenance = next; await this.persist(); return next;
  }
  async processQueue() {
    if (this.busy) return;
    this.busy = true;
    try {
      const item = this.items.find(i => i.status === 'queued' || i.status === 'scheduled' && Date.parse(i.scheduledAt!) <= Date.now());
      if (!item) return;
      item.status = 'sending'; await this.persist();
      for (const recipient of item.recipients) {
        if ((item.status as string) === 'cancelled') break;
        if (recipient.status !== 'pending') continue;
        recipient.status = 'sending'; await this.persist();
        try { await this.delivery(recipient.chatId, item); recipient.status = 'sent'; }
        catch (error: any) { recipient.status = 'failed'; recipient.error = String(error.message || 'Gửi thất bại').slice(0, 300); }
        await this.persist();
        await new Promise(resolve => setTimeout(resolve, this.interval));
      }
      if ((item.status as string) !== 'cancelled') item.status = item.recipients.some(r => r.status !== 'sent') ? 'partial' : 'completed';
      await this.persist();
    } finally { this.busy = false; }
  }
}
export const broadcastService = new BroadcastService();
