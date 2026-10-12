import { Router } from 'express';
import {
  summarizeChat,
  getCachedSummary,
  getReplySuggestions,
  chatWithAssistant,
} from '../controllers/aiController.js';

const router = Router();

// Summarize a conversation
router.post('/summarize/:chatId', summarizeChat);
router.get('/summary/:chatId', getCachedSummary);

// Reply suggestions for a conversation
router.post('/suggest/:chatId', getReplySuggestions);

// Direct AI assistant chat
router.post('/chat', chatWithAssistant);

export default router;
