import { Router,json } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shopCatalog } from '../services/shopService.js';
import { db } from '../database/connection.js';
import { broadcastService } from '../services/broadcastService.js';
import { ShopOrderError,shopOrderService,telegramShopUser,validateShopOrder } from '../services/shopOrderService.js';
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

router.post(['/orders','/orders/lookup'],json({limit:'32kb'}),async(req,res)=>{
  try{
    const body=req.body;
    if(!body||typeof body.botId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(body.botId))throw new ShopOrderError('Liên kết Shop không hợp lệ.');
    const bot=await db.getManagedBotById(body.botId);
    if(!bot)throw new ShopOrderError('Shop không tồn tại.',404);
    const userId=telegramShopUser(body.initData,bot.token);
    if(req.path==='/orders/lookup'){
      res.json({success:true,data:await shopOrderService.lookup(bot.id,userId,body.orderCode)});return;
    }
    const maintenance=broadcastService.getMaintenance();
    if(maintenance.enabled)throw new ShopOrderError(maintenance.message||'Shop đang bảo trì. Vui lòng thử lại sau.',503);
    const input=validateShopOrder(body);
    const result=await shopOrderService.create(bot.id,userId,bot.telegramBotId||bot.token.split(':')[0],input);
    res.json({success:true,data:result});
  }catch(error){
    if(error instanceof ShopOrderError){res.status(error.statusCode).json({success:false,error:error.message});return;}
    console.error('[Shop] Order request failed:',(error as {code?:string}).code||'unknown');
    res.status(503).json({success:false,error:'Chưa xử lý được đơn hàng. Vui lòng thử lại; đơn đã ghi nhận sẽ không bị tạo trùng.'});
  }
});
export default router;