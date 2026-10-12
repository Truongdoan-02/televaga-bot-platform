import { Router } from 'express';
import {
  getMessages,
  sendMessage,
  toggleReaction,
  setMessagePinned,
  deleteMessage,
  forwardMessage,
  uploadMessageMedia,
} from '../controllers/messageController.js';

const router = Router({ mergeParams: true });

router.get('/', getMessages);
router.post('/', sendMessage);
router.post('/media', uploadMessageMedia);
router.post('/:messageId/reactions', toggleReaction);
router.patch('/:messageId/pin', setMessagePinned);
router.post('/:messageId/forward', forwardMessage);
router.delete('/:messageId', deleteMessage);

export default router;
