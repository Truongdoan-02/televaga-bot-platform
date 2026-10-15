import { Router, raw, Request, Response, ErrorRequestHandler } from 'express';
import { storeProductImage, ImageValidationError } from '../services/broadcastImages.js';
import { productService, ProductError, validateProduct } from '../services/productService.js';
const router = Router();
const handle = (action: (req: Request) => Promise<unknown>, status = 200) => async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (id !== undefined && (typeof id !== 'string' || !/^[1-9][0-9]{0,19}$/.test(id))) throw new ProductError('Mã định danh không hợp lệ.');
    res.status(status).json({ success: true, data: await action(req) });
  } catch (error) {
    if (error instanceof ProductError) res.status(error.statusCode).json({ success: false, error: error.message });
    else { console.error('[Products]', error); res.status(500).json({ success: false, error: 'Không thể xử lý sản phẩm. Vui lòng thử lại.' }); }
  }
};
router.post('/images', raw({ type: () => true, limit: '10mb' }), async (req, res) => {
  try { res.status(201).json({ success: true, data: { imageUrl: await storeProductImage(req.body) } }); }
  catch (error) {
    if (error instanceof ImageValidationError) res.status(400).json({ success: false, error: error.message });
    else { console.error('[Product image]', error); res.status(500).json({ success: false, error: 'Không tải được ảnh. Vui lòng thử lại.' }); }
  }
});
const uploadError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error.type === 'entity.too.large') res.status(413).json({ success: false, error: 'Ảnh tối đa 10 MB.' });
  else next(error);
};
router.use('/images', uploadError);
router.get('/', handle(() => productService.list()));
router.get('/next-code', handle(async req => ({ code: await productService.nextCode(typeof req.query.supplierCode === 'string' ? req.query.supplierCode : '') })));
router.get('/:id', handle(req => productService.get(String(req.params.id))));
router.post('/', handle(req => productService.save(validateProduct(req.body)), 201));
router.put('/:id', handle(req => productService.save(validateProduct(req.body), String(req.params.id))));
router.delete('/:id', handle(async req => { await productService.delete(String(req.params.id)); return null; }));
export default router;