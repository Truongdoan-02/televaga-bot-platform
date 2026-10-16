import { Router,Request,Response } from 'express';
import { orderAdminService,OrderAdminError } from '../services/orderAdminService.js';
const router=Router();
const handle=(action:(req:Request)=>Promise<unknown>)=>async(req:Request,res:Response)=>{try{res.json({success:true,data:await action(req)});}catch(error){if(error instanceof OrderAdminError)res.status(error.statusCode).json({success:false,error:error.message});else{console.error('[Orders]',(error as {code?:string}).code||'unknown');res.status(503).json({success:false,error:'Không xử lý được đơn hàng. Vui lòng thử lại.'});}}};
router.get('/',handle(req=>orderAdminService.list(req.query.search??'',req.query.status??'',req.query.cursor)));
router.get('/:id',handle(req=>orderAdminService.detail(req.params.id)));
router.post('/:id/action',handle(req=>orderAdminService.action(req.params.id,req.body)));
export default router;