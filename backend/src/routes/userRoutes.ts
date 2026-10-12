import { Router } from 'express';
import { getUsers } from '../controllers/chatController.js';

const router = Router();
router.get('/', getUsers);
export default router;
