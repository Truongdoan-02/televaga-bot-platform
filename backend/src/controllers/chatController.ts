import { Request, Response } from 'express';
import { db } from '../database/connection.js';
import { socketService } from '../services/socketService.js';
import { telegramService } from '../services/telegramService.js';

export const getChats = async (req: Request, res: Response): Promise<void> => {
  try {
    const { category, search, botId } = req.query;
    const chats = await db.getChats(category as string, search as string, typeof botId === 'string' ? botId : undefined);
    res.json({ success: true, data: chats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getChatById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const chat = await db.getChatById(id);
    if (!chat) {
      res.status(404).json({ success: false, error: 'Chat not found' });
      return;
    }

    // Attach participants
    const participants = [];
    for (const pId of chat.participantIds) {
      const u = await db.getUserById(pId);
      if (u) participants.push(u);
    }

    const parentTitle = chat.parentChatId ? (await db.getChatById(chat.parentChatId))?.title : undefined;
    res.json({ success: true, data: { ...chat, parentTitle, participants } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const updateChat = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const updates = req.body;
    const updated = await db.updateChat(id, updates);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const markAsRead = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    await db.markMessagesAsRead(id);
    socketService.broadcastChatRead(id);
    res.json({ success: true, message: 'Marked as read' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteChat = async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await db.deleteChat(String(req.params.id));
    if (!deleted) {
      res.status(404).json({ success: false, error: 'Chat not found' });
      return;
    }
    res.json({ success: true, data: { id: String(req.params.id) } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const createGroupChat = async (req: Request, res: Response): Promise<void> => {
  try {
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const memberIds = Array.isArray(req.body.memberIds) ? [...new Set(req.body.memberIds.filter((id: unknown): id is string => typeof id === 'string'))] : [];
    if (!title) {
      res.status(400).json({ success: false, error: 'Group name is required' });
      return;
    }
    if (!memberIds.length) {
      res.status(400).json({ success: false, error: 'Select at least one member' });
      return;
    }
    const users = await db.getUsers();
    const validMembers = users.filter((user) => memberIds.includes(user.id) && !user.isBot && user.id !== 'user_agent_me');
    if (validMembers.length !== memberIds.length) {
      res.status(400).json({ success: false, error: 'One or more members are unavailable' });
      return;
    }
    const chat = await db.createGroupChat(title.slice(0, 80), validMembers.map((user) => user.id));
    res.status(201).json({ success: true, data: chat });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const openDirectChat = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = typeof req.body.userId === 'string' ? req.body.userId : '';
    const botId = typeof req.body.botId === 'string' ? req.body.botId : undefined;
    const user = (await db.getUsers()).find((item) => item.id === userId && item.id !== 'user_agent_me' && !item.isBot);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    if (botId) {
      const bot = await db.getManagedBotById(botId);
      if (!bot?.isEnabled) {
        res.status(409).json({ success: false, error: 'Bot này hiện chưa được bật' });
        return;
      }
    }
    const chat = await db.openDirectChat(user, botId);
    res.json({ success: true, data: chat });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const createForumTopic = async (req: Request, res: Response): Promise<void> => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 128) {
      res.status(400).json({ success: false, error: 'Tên topic phải từ 1 đến 128 ký tự' });
      return;
    }
    const topic = await telegramService.createForumTopic(String(req.params.id), name);
    res.status(201).json({ success: true, data: topic });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message || 'Không tạo được topic' });
  }
};

export const syncForumTopics = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await telegramService.syncForumTopics(String(req.params.id));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message || 'Không tải được topic của nhóm' });
  }
};

export const getUsers = async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = (await db.getUsers())
      .filter((user) => user.id !== 'user_agent_me' && !user.isBot)
      .sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    res.json({ success: true, data: users });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
