import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac,randomUUID } from 'node:crypto';
import { telegramShopUser,validateShopOrder,ShopOrderError } from './shopOrderService.js';
function signed(token:string,date=Math.floor(Date.now()/1000),id=5){const p=new URLSearchParams({auth_date:String(date),user:JSON.stringify({id,first_name:'Test'}),query_id:'query'});const secret=createHmac('sha256','WebAppData').update(token).digest();const check=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');p.set('hash',createHmac('sha256',secret).update(check).digest('hex'));return p.toString();}
test('Telegram checkout identity validates signature, bot binding, freshness and signed user',()=>{
 const token='123:secret',date=1770000000;
 assert.equal(telegramShopUser(signed(token,date),token,date),'5');
 for(const value of ['',signed('other',date),signed(token,date-3601),signed(token,date+31),signed(token,date,0),signed(token,date)+'&auth_date='+date,signed(token,date).replace('query','changed')])assert.throws(()=>telegramShopUser(value,token,date),ShopOrderError);
});
test('checkout validates delivery fields and every cart item',()=>{
 const valid={requestId:randomUUID(),name:'Người nhận',phone:'0912345678',address:'123 đường A',items:[{productId:'2',quantity:3,priceMinor:20000},{productId:'1',quantity:2,priceMinor:10000}]};
 assert.deepEqual(validateShopOrder(valid).items.map(i=>i.productId),['1','2']);
 for(const patch of [{name:''},{phone:'abc'},{address:''},{requestId:'x'},{items:[]},{items:[valid.items[0],valid.items[0]]},{items:[{...valid.items[0],quantity:0}]},{items:[{...valid.items[0],quantity:1.5}]},{items:[{...valid.items[0],priceMinor:-1}]}])assert.throws(()=>validateShopOrder({...valid,...patch}),ShopOrderError);
});
test('Shop order endpoints require signed Telegram identity and use the authenticated account',async()=>{
 const {default:express}=await import('express');const {default:routes}=await import('../routes/shopRoutes.js');const {db}=await import('../database/connection.js');const {shopOrderService}=await import('./shopOrderService.js');const {broadcastService}=await import('./broadcastService.js');
 const old={bot:db.getManagedBotById,create:shopOrderService.create,lookup:shopOrderService.lookup,maintenance:broadcastService.getMaintenance};let creates=0,lookups=0;
 db.getManagedBotById=async()=>({id:'bot',token:'123:secret',telegramBotId:'123'} as any);broadcastService.getMaintenance=()=>({enabled:false} as any);
 shopOrderService.create=async(bot,user,telegram,input)=>{assert.deepEqual([bot,user,telegram],['bot','5','123']);assert.equal(input.items.length,2);creates++;return {orderCode:'TV-0123456789ABCDEF01234567'} as any;};
 shopOrderService.lookup=async(bot,user,code)=>{assert.deepEqual([bot,user],['bot','5']);lookups++;return {orderCode:code} as any;};
 const app=express();app.use('/api/shop',routes);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();if(!address||typeof address==='string')throw Error();const base='http://127.0.0.1:'+address.port;
 const body={botId:'bot',initData:signed('123:secret'),telegramUserId:'999',requestId:randomUUID(),name:'Buyer',phone:'0912345678',address:'Street 123',items:[{productId:'1',quantity:1,priceMinor:10000},{productId:'2',quantity:2,priceMinor:20000}]};
 const post=(path:string,value:any)=>fetch(base+'/api/shop/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
 try{
  assert.equal((await post('orders',{...body,initData:''})).status,401);assert.equal(creates,0);
  assert.equal((await post('orders',{...body,initData:signed('another')})).status,401);assert.equal(creates,0);
  assert.equal((await post('orders',body)).status,200);assert.equal(creates,1);
  assert.equal((await post('orders/lookup',{botId:'bot',initData:body.initData,orderCode:'TV-0123456789ABCDEF01234567'})).status,200);assert.equal(lookups,1);
  broadcastService.getMaintenance=()=>({enabled:true,message:'Bảo trì'} as any);assert.equal((await post('orders',body)).status,503);assert.equal(creates,1);
 }finally{db.getManagedBotById=old.bot;shopOrderService.create=old.create;shopOrderService.lookup=old.lookup;broadcastService.getMaintenance=old.maintenance;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});