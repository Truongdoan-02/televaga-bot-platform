import { Router,Request,Response } from 'express';
import { inventoryService,InventoryError,validateInventory } from '../services/inventoryService.js';
const router=Router();
const handle=(action:(req:Request)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
  try {
    for(const value of [req.params.id,req.params.orderId,req.params.documentId,req.query.productId])if(value!==undefined&&!/^[1-9][0-9]{0,19}$/.test(String(value)))throw new InventoryError('Mã định danh không hợp lệ.');
    res.json({success:true,data:(await action(req))??null});
  }catch(error){if(error instanceof InventoryError)res.status(error.statusCode).json({success:false,error:error.message});else{console.error('[Inventory]',error);res.status(500).json({success:false,error:'Không thể xử lý tồn kho. Vui lòng thử lại.'});}}
};
router.get('/',handle(()=>inventoryService.list()));
router.get('/history',handle(req=>inventoryService.history(req.query.productId?String(req.query.productId):undefined)));
router.get('/documents',handle(()=>inventoryService.documents()));
router.get('/documents/:documentId',handle(req=>inventoryService.document(String(req.params.documentId))));
router.post('/documents',handle(req=>inventoryService.createDocument(req.body)));
router.get('/orders',handle(()=>inventoryService.orders()));
router.post('/transactions',handle(req=>inventoryService.transact(validateInventory(req.body))));
router.put('/:id/settings',handle(req=>inventoryService.configure(String(req.params.id),req.body)));
router.post('/orders/:orderId/action',handle(req=>inventoryService.orderAction(String(req.params.orderId),req.body.action)));
export default router;