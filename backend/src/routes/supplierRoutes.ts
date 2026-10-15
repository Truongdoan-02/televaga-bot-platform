import { Router, Request, Response } from 'express';
import { supplierService, SupplierError, validateSupplier } from '../services/supplierService.js';
const router = Router();
const handle = (action: (req: Request) => Promise<unknown>, status = 200) => async (req: Request, res: Response) => {
  try {
    if (req.params.code !== undefined && !/^NCC[0-9]{3,17}$/.test(String(req.params.code))) throw new SupplierError('Mã nhà cung cấp không hợp lệ.');
    res.status(status).json({ success: true, data: await action(req) });
  } catch (error) {
    if (error instanceof SupplierError) res.status(error.statusCode).json({ success: false, error: error.message });
    else { console.error('[Suppliers]', error); res.status(500).json({ success: false, error: 'Không thể xử lý nhà cung cấp. Vui lòng thử lại.' }); }
  }
};
router.get('/', handle(() => supplierService.list()));
router.get('/next-code', handle(async () => ({ code: await supplierService.nextCode() })));
router.get('/:code', handle(req => supplierService.get(String(req.params.code))));
router.post('/', handle(req => supplierService.save(validateSupplier(req.body)), 201));
router.put('/:code', handle(req => supplierService.save(validateSupplier(req.body), String(req.params.code))));
router.delete('/:code', handle(async req => { await supplierService.delete(String(req.params.code)); return null; }));
export default router;