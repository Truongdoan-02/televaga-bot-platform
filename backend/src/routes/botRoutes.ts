import { Router } from 'express';
import { createManagedBot, getManagedBotButtons, getManagedBotFlowPrompts, getManagedBotRuntime, getManagedBots, setManagedBotEnabled, updateManagedBot, updateManagedBotButtons, updateManagedBotFlowPrompts, validateManagedBot } from '../controllers/botController.js';

const router = Router();

router.get('/', getManagedBots);
router.post('/', createManagedBot);
router.patch('/:id', updateManagedBot);
router.post('/:id/validate', validateManagedBot);
router.get('/:id/runtime', getManagedBotRuntime);
router.patch('/:id/enabled', setManagedBotEnabled);
router.get('/:id/buttons', getManagedBotButtons);
router.put('/:id/buttons', updateManagedBotButtons);
router.get('/:id/flow-prompts', getManagedBotFlowPrompts);
router.put('/:id/flow-prompts', updateManagedBotFlowPrompts);

export default router;
