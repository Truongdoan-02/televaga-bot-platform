import { Router } from 'express';
import {
  getChats,
  getChatById,
  updateChat,
  markAsRead,
  deleteChat,
  createGroupChat,
  openDirectChat,
  createForumTopic,
  syncForumTopics,
} from '../controllers/chatController.js';

const router = Router();

router.get('/', getChats);
router.post('/groups', createGroupChat);
router.post('/direct', openDirectChat);
router.post('/:id/topics', createForumTopic);
router.post('/:id/topics/sync', syncForumTopics);
router.get('/:id', getChatById);
router.patch('/:id', updateChat);
router.delete('/:id', deleteChat);
router.post('/:id/read', markAsRead);

export default router;
