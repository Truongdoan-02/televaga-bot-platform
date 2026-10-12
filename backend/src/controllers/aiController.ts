import { Request, Response } from 'express';
import { db } from '../database/connection.js';
import { aiService } from '../services/aiService.js';

export const summarizeChat = async (req: Request, res: Response): Promise<void> => {
  try {
    const chatId = String(req.params.chatId);
    const chat = await db.getChatById(chatId);
    if (!chat) {
      res.status(404).json({ success: false, error: 'Chat not found' });
      return;
    }

    const messages = await db.getMessages(chatId);
    const summary = await aiService.summarizeConversation(chatId, chat.title, messages);
    await db.saveAISummary(summary);

    res.json({ success: true, data: summary });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getCachedSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const chatId = String(req.params.chatId);
    const summary = await db.getAISummary(chatId);
    res.json({ success: true, data: summary });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getReplySuggestions = async (req: Request, res: Response): Promise<void> => {
  try {
    const chatId = String(req.params.chatId);
    const chat = await db.getChatById(chatId);
    if (!chat) {
      res.status(404).json({ success: false, error: 'Chat not found' });
      return;
    }

    const messages = await db.getMessages(chatId);
    const suggestions = await aiService.suggestReplies(chatId, chat.title, messages);
    await db.saveAISuggestions(chatId, suggestions);

    res.json({ success: true, data: suggestions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const chatWithAssistant = async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, chatId } = req.body;
    if (!query || !query.trim()) {
      res.status(400).json({ success: false, error: 'Query is required' });
      return;
    }

    let chatContext = undefined;
    if (chatId) {
      const chat = await db.getChatById(chatId);
      if (chat) {
        const messages = await db.getMessages(chatId);
        chatContext = { title: chat.title, messages };
      }
    }

    const reply = await aiService.chatWithAssistant(query.trim(), chatContext);
    res.json({ success: true, data: { reply } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
