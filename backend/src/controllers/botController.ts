import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../database/connection.js';
import { BotActionButton, BotButtonAction, ManagedBot } from '../types/index.js';
import { telegramService } from '../services/telegramService.js';
import { BOT_FLOW_PROMPT_KEYS } from '../services/botFlowPrompts.js';

const toPublicBot = (bot: ManagedBot) => ({
  id: bot.id,
  name: bot.name,
  tokenHint: bot.token.length > 4 ? '••••••••' + bot.token.slice(-4) : '••••',
  telegramBotId: bot.telegramBotId,
  username: bot.username,
  isEnabled: bot.isEnabled,
  mode: bot.mode,
  status: bot.status,
  lastError: bot.lastError,
  runtime: telegramService.getManagedBotRuntimeStatus(bot.id),
  createdAt: bot.createdAt,
  updatedAt: bot.updatedAt,
});

export const getManagedBots = async (_req: Request, res: Response): Promise<void> => {
  try {
    const bots = await db.getManagedBots();
    res.json({ success: true, data: bots.map(toPublicBot) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getManagedBotRuntime = async (req: Request, res: Response): Promise<void> => {
  const bot = await db.getManagedBotById(String(req.params.id));
  if (!bot) {
    res.status(404).json({ success: false, error: 'Không tìm thấy bot' });
    return;
  }
  res.json({ success: true, data: telegramService.getManagedBotRuntimeStatus(bot.id) });
};

const BOT_BUTTON_ACTIONS: BotButtonAction[] = ['reply', 'consult', 'order_lookup', 'human_support', 'resolve', 'url'];

export const getManagedBotButtons = async (req: Request, res: Response): Promise<void> => {
  const bot = await db.getManagedBotById(String(req.params.id));
  if (!bot) {
    res.status(404).json({ success: false, error: 'Không tìm thấy bot' });
    return;
  }
  res.json({ success: true, data: bot.actionButtons || [] });
};

export const updateManagedBotButtons = async (req: Request, res: Response): Promise<void> => {
  try {
    const input = req.body.buttons;
    if (!Array.isArray(input) || input.length > 12) {
      res.status(400).json({ success: false, error: 'Danh sách nút không hợp lệ (tối đa 12 nút)' });
      return;
    }
    const buttons: BotActionButton[] = [];
    for (let index = 0; index < input.length; index++) {
      const item = input[index];
      const label = typeof item?.label === 'string' ? item.label.trim() : '';
      if (!label || label.length > 64 || !BOT_BUTTON_ACTIONS.includes(item.action)) {
        res.status(400).json({ success: false, error: `Nút thứ ${index + 1} cần tên (tối đa 64 ký tự) và hành động hợp lệ` });
        return;
      }
      const responseText = typeof item.responseText === 'string' ? item.responseText.trim() : '';
      const url = typeof item.url === 'string' ? item.url.trim() : '';
      if (['reply', 'consult'].includes(item.action) && (!responseText || responseText.length > 4000)) {
        res.status(400).json({ success: false, error: `Nút “${label}” cần nội dung trả lời (tối đa 4.000 ký tự)` });
        return;
      }
      if (item.action === 'url') {
        try { if (new URL(url).protocol !== 'https:') throw new Error(); }
        catch { res.status(400).json({ success: false, error: `Nút “${label}” cần đường dẫn HTTPS hợp lệ` }); return; }
      }
      buttons.push({
        id: typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(item.id) ? item.id : `btn_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        label,
        action: item.action,
        responseText: responseText || undefined,
        url: url || undefined,
        enabled: item.enabled !== false,
        sortOrder: index,
      });
    }
    const saved = await db.updateManagedBotActionButtons(String(req.params.id), buttons);
    if (!saved) { res.status(404).json({ success: false, error: 'Không tìm thấy bot' }); return; }
    res.json({ success: true, data: saved });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getManagedBotFlowPrompts = async (req: Request, res: Response): Promise<void> => {
  const bot = await db.getManagedBotById(String(req.params.id));
  if (!bot) { res.status(404).json({ success: false, error: 'Không tìm thấy bot' }); return; }
  res.json({ success: true, data: bot.flowPrompts || {} });
};

export const updateManagedBotFlowPrompts = async (req: Request, res: Response): Promise<void> => {
  try {
    const input = req.body.prompts;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      res.status(400).json({ success: false, error: 'Cấu hình câu quy trình không hợp lệ' }); return;
    }
    const prompts: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) {
      if (!BOT_FLOW_PROMPT_KEYS.includes(key as typeof BOT_FLOW_PROMPT_KEYS[number])) {
        res.status(400).json({ success: false, error: 'Loại câu quy trình không được hỗ trợ' }); return;
      }
      const maxLength = key === 'contact_button' ? 64 : 2000;
      if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
        res.status(400).json({ success: false, error: `Nội dung “${key}” cần từ 1 đến ${maxLength} ký tự` }); return;
      }
      prompts[key] = value.trim();
    }
    const saved = await db.updateManagedBotFlowPrompts(String(req.params.id), prompts);
    if (!saved) { res.status(404).json({ success: false, error: 'Không tìm thấy bot' }); return; }
    res.json({ success: true, data: saved });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const createManagedBot = async (req: Request, res: Response): Promise<void> => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    if (!name || !token) {
      res.status(400).json({ success: false, error: 'Tên bot và token là bắt buộc' });
      return;
    }
    if (name.length > 120 || token.length > 500) {
      res.status(400).json({ success: false, error: 'Tên bot hoặc token vượt quá độ dài cho phép' });
      return;
    }
    if ((await db.getManagedBots()).some((bot) => bot.token === token)) {
      res.status(409).json({ success: false, error: 'Token này đã được thêm' });
      return;
    }
    const bot = await db.createManagedBot(name, token);
    res.status(201).json({ success: true, data: toPublicBot(bot) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const updateManagedBot = async (req: Request, res: Response): Promise<void> => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : undefined;
    if (!name) {
      res.status(400).json({ success: false, error: 'Tên bot là bắt buộc' });
      return;
    }
    if (name.length > 120 || (token && token.length > 500)) {
      res.status(400).json({ success: false, error: 'Tên bot hoặc token vượt quá độ dài cho phép' });
      return;
    }
    if (token && (await db.getManagedBots()).some((bot) => bot.id !== req.params.id && bot.token === token)) {
      res.status(409).json({ success: false, error: 'Token này đã được thêm cho bot khác' });
      return;
    }
    const bot = await db.updateManagedBot(String(req.params.id), name, token, token ? {
      telegramBotId: undefined, username: undefined, isEnabled: false, status: 'configured', lastError: undefined,
    } : {});
    if (!bot) {
      res.status(404).json({ success: false, error: 'Không tìm thấy bot' });
      return;
    }
    void telegramService.syncManagedBots();
    res.json({ success: true, data: toPublicBot(bot) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const validateManagedBot = async (req: Request, res: Response): Promise<void> => {
  try {
    const bot = (await db.getManagedBots()).find((item) => item.id === String(req.params.id));
    if (!bot) {
      res.status(404).json({ success: false, error: 'Không tìm thấy bot' });
      return;
    }
    const response = await fetch(`https://api.telegram.org/bot${bot.token}/getMe`, {
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json() as { ok?: boolean; description?: string; result?: { id?: number; username?: string } };
    if (!response.ok || !result.ok || !result.result?.id) {
      const message = result.description || 'Telegram không xác thực được token';
      await db.updateManagedBot(bot.id, bot.name, undefined, { status: 'error', lastError: message, isEnabled: false });
      res.status(400).json({ success: false, error: message });
      return;
    }
    const updated = await db.updateManagedBot(bot.id, bot.name, undefined, {
      telegramBotId: String(result.result.id), username: result.result.username,
      status: 'connected', lastError: undefined,
    });
    void telegramService.syncManagedBots();
    res.json({ success: true, data: updated && toPublicBot(updated) });
  } catch (error: any) {
    const message = error.name === 'TimeoutError' ? 'Telegram phản hồi quá lâu, hãy thử lại' : (error.message || 'Không thể kết nối Telegram');
    res.status(502).json({ success: false, error: message });
  }
};

export const setManagedBotEnabled = async (req: Request, res: Response): Promise<void> => {
  try {
    if (typeof req.body.isEnabled !== 'boolean') {
      res.status(400).json({ success: false, error: 'Trạng thái bật/tắt không hợp lệ' });
      return;
    }
    const bot = (await db.getManagedBots()).find((item) => item.id === String(req.params.id));
    if (!bot) {
      res.status(404).json({ success: false, error: 'Không tìm thấy bot' });
      return;
    }
    if (req.body.isEnabled && bot.status !== 'connected' && !bot.telegramBotId) {
      res.status(409).json({ success: false, error: 'Hãy kiểm tra token thành công trước khi bật bot' });
      return;
    }
    const updated = await db.updateManagedBot(bot.id, bot.name, undefined, {
      isEnabled: req.body.isEnabled,
      status: req.body.isEnabled ? 'connected' : (bot.telegramBotId ? 'disabled' : bot.status),
    });
    res.json({ success: true, data: updated && toPublicBot(updated) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
