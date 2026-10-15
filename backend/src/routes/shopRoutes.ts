import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shopCatalog } from '../services/shopService.js';
const router=Router();
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/view',(_req,res)=>res.sendFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../public/shop.html')));
router.get('/catalog',async(req,res)=>{
  const botId=typeof req.query.botId==='string'?req.query.botId:'';
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(botId)){res.status(400).json({success:false,error:'Liên kết Shop không hợp lệ.'});return;}
  try{
    const data=await shopCatalog(botId);
    if(!data){res.status(404).json({success:false,error:'Shop hiện chưa hoạt động.'});return;}
    res.json({success:true,data});
  }catch{res.status(503).json({success:false,error:'Không tải được danh mục. Vui lòng thử lại.'});}
});
export default router;