import { Router, raw } from 'express';
import { storeBroadcastImage } from '../services/broadcastImages.js';
import { broadcastService } from '../services/broadcastService.js';
const router = Router();
router.post('/images', raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: '10mb' }), async (req, res) => {
  try { res.status(201).json({ success: true, data: { imageUrl: await storeBroadcastImage(req.body) } }); }
  catch (error: any) { res.status(400).json({ success: false, error: error.message }); }
});
router.get('/', (_req, res) => res.json({ success: true, data: { items: broadcastService.list(), maintenance: broadcastService.getMaintenance() } }));
router.get('/audience', async (req, res) => {
  try { const recipients = await broadcastService.recipients(String(req.query.botId || ''), String(req.query.audience || 'all')); res.json({ success: true, data: { count: recipients.length } }); }
  catch { res.status(500).json({ success: false, error: 'Không tải được nhóm nhận.' }); }
});
router.put('/maintenance', async (req, res) => {
  try { res.json({ success: true, data: await broadcastService.updateMaintenance(req.body) }); }
  catch (error: any) { res.status(400).json({ success: false, error: error.message }); }
});
router.post('/', async (req, res) => {
  try { res.status(201).json({ success: true, data: await broadcastService.create(req.body, req.body.sendNow === true) }); }
  catch (error: any) { res.status(400).json({ success: false, error: error.message }); }
});
router.get('/:id', (req, res) => {
  try { res.json({ success: true, data: broadcastService.detail(String(req.params.id)) }); }
  catch (error: any) { res.status(404).json({ success: false, error: error.message }); }
});
router.post('/:id/action', async (req, res) => {
  try { res.json({ success: true, data: await broadcastService.action(String(req.params.id), req.body.action) }); }
  catch (error: any) { res.status(400).json({ success: false, error: error.message }); }
});
export default router;
