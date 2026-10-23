import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { storeUpload } from '../services/uploadStore.js';
import { db } from '../database/connection.js';
import { telegramService } from '../services/telegramService.js';

export const getMessages = async (req: Request, res: Response): Promise<void> => {
  try {
    const chatId = String(req.params.chatId);
    const messages = await db.getMessages(chatId);
    res.json({ success: true, data: messages });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const sendMessage = async (req: Request, res: Response): Promise<void> => {
  try {
    const chatId = String(req.params.chatId);
    const { text, replyToId } = req.body;

    if (!text || !text.trim()) {
      res.status(400).json({ success: false, error: 'Text cannot be empty' });
      return;
    }

    const message = await telegramService.sendMessage(chatId, text.trim(), { replyToId });
    res.json({ success: true, data: message });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const toggleReaction = async (req: Request, res: Response): Promise<void> => {
  try {
    const chatId = String(req.params.chatId);
    const messageId = String(req.params.messageId);
    const { emoji } = req.body;
    if (typeof emoji !== 'string' || !['❤️', '👍', '👎', '🔥', '🥰', '👏', '😁'].includes(emoji)) {
      res.status(400).json({ success: false, error: 'Unsupported reaction' });
      return;
    }
    const message = await db.getMessageById(chatId, messageId);
    if (!message) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }
    const updated = await telegramService.toggleMessageReaction(chatId, messageId, emoji);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const setMessagePinned = async (req: Request, res: Response): Promise<void> => {
  try {
    const chatId = String(req.params.chatId);
    const messageId = String(req.params.messageId);
    const message = await db.getMessageById(chatId, messageId);
    if (!message) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }
    const isPinned = Boolean(req.body.isPinned);
    if (isPinned && !message.isPinned) {
      const pinnedCount = (await db.getMessages(chatId)).filter((item) => item.isPinned).length;
      if (pinnedCount >= 3) {
        res.status(409).json({ success: false, error: 'Chỉ ghim tối đa 3 tin nhắn trong một cuộc trò chuyện' });
        return;
      }
    }
    const updated = await db.updateMessage(chatId, messageId, {
      reactions: message.reactions || {},
      isPinned,
    });
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteMessage = async (req: Request, res: Response): Promise<void> => {
  try {
    const chatId = String(req.params.chatId);
    const messageId = String(req.params.messageId);
    const deleted = await db.deleteMessage(chatId, messageId);
    if (!deleted) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }
    res.json({ success: true, data: { id: messageId } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const forwardMessage = async (req: Request, res: Response): Promise<void> => {
  try {
    const chatId = String(req.params.chatId);
    const messageId = String(req.params.messageId);
    const { targetChatId } = req.body;
    const source = await db.getMessageById(chatId, messageId);
    const target = typeof targetChatId === 'string' ? await db.getChatById(targetChatId) : null;
    if (!source || !target) {
      res.status(404).json({ success: false, error: 'Message or destination chat not found' });
      return;
    }
    const forwarded = await telegramService.sendMessage(targetChatId, source.text, {
      forwardedFrom: source.forwardedFrom || source.senderName || 'Tin nhắn được chuyển tiếp',
    });
    res.json({ success: true, data: forwarded });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};




export const uploadMessageMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    const chatId = String(req.params.chatId);
    const chat = await db.getChatById(chatId);
    const fileData = req.body;
    if (!chat) {
      res.status(404).json({ success: false, error: 'Chat not found' });
      return;
    }
    if (!Buffer.isBuffer(fileData) || fileData.length === 0) {
      res.status(400).json({ success: false, error: 'File is empty or missing' });
      return;
    }
    if (fileData.length > 50 * 1024 * 1024) {
      res.status(413).json({ success: false, error: 'File size cannot exceed 50 MB' });
      return;
    }

    const mimeType = String(req.get('Content-Type') || 'application/octet-stream').split(';')[0].toLowerCase();
    const encodedCaption = String(req.get('X-Message-Caption') || '');
    let caption = '';
    try { caption = decodeURIComponent(encodedCaption); } catch { caption = encodedCaption; }
    caption = caption.trim().slice(0, 1024);
    const encodedName = String(req.get('X-File-Name') || 'file');
    let originalName = 'file';
    try { originalName = decodeURIComponent(encodedName); } catch { originalName = 'file'; }
    originalName = path.basename(originalName).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').slice(0, 180) || 'file';
    if (mimeType.startsWith('image/') && fileData.length > 10 * 1024 * 1024) {
      res.status(413).json({ success: false, error: 'Ảnh gửi qua Telegram không được vượt quá 10 MB' });
      return;
    }
    const extension = path.extname(originalName);
    const storedName = randomUUID() + extension;
    await storeUpload('/uploads/' + storedName, fileData, mimeType);

    const mediaType = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : 'document';
    const message = await telegramService.sendMedia(chatId, {
      data: fileData,
      mimeType,
      fileName: originalName,
      fileSize: fileData.length,
      mediaUrl: '/uploads/' + storedName,
      mediaType,
      caption,
    });
    res.json({ success: true, data: message });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
