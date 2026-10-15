import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import express from 'express';
import shopRoutes from '../routes/shopRoutes.js';
import { shopUrl,shopWebUrl,productBuyUrl } from './shopService.js';
import { db } from '../database/connection.js';
import { productService } from './productService.js';
import { telegramService } from './telegramService.js';
import { bnkDataService } from './bnkDataService.js';
import { broadcastService } from './broadcastService.js';

test('shop catalog and view are public but expose only selling product fields; Telegram Shop and Shop Web are distinct',async()=>{
 const originalBot=db.getManagedBotById,originalList=productService.list;
 const service=telegramService as any,send=service.sendMessage;
 const oldShop=process.env.TELEGRAM_SHOP_URL,oldWeb=process.env.SHOP_WEB_URL;
 const outgoing:any[]=[];
 db.getManagedBotById=async()=>({id:'test-bot',isEnabled:true,name:'Shop thử',username:'TestShopBot',token:'SECRET'} as any);
 productService.list=async()=>[
  {id:'1',code:'VG001',name:'Chanh',quantity:'200 ml',price:50000,description:'Thông tin sản phẩm',imageUrl:'/uploads/product_00000000-0000-0000-0000-000000000000.png',status:'in_stock',supplier:'PRIVATE SUPPLIER',supplierCode:'NCC001'},
  {id:'2',code:'VG002',name:'Hết hàng',quantity:'200 g',price:1,description:'',imageUrl:'',status:'out_of_stock',supplier:'',supplierCode:''},
  {id:'3',code:'VG003',name:'Ngừng bán',quantity:'200 g',price:1,description:'',imageUrl:'',status:'discontinued',supplier:'',supplierCode:''},
 ];
 service.sendMessage=async(...args:any[])=>{outgoing.push(args);};
 process.env.TELEGRAM_SHOP_URL='https://shop.example/api/shop/view';process.env.SHOP_WEB_URL='https://vaga.vn/products';
 const app=express();app.use('/api/shop',shopRoutes);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const address=server.address();if(!address||typeof address==='string')throw new Error();
 const base='http://127.0.0.1:'+address.port;
 try{
  assert.equal(productBuyUrl('TestShopBot','1'),'https://t.me/TestShopBot?start=buy_1');
  assert.equal(productBuyUrl('bad/name','1'),null);
  assert.equal(new URL(shopUrl('test-bot')).searchParams.get('botId'),'test-bot');
  assert.equal(shopWebUrl(),'https://vaga.vn/products');
  const response=await fetch(base+'/api/shop/catalog?botId=test-bot');
  assert.equal(response.status,200);
  const data=await response.json() as any;
  assert.equal(data.data.products.length,2);
  assert.equal(data.data.products[0].buyUrl,'https://t.me/TestShopBot?start=buy_1');
  assert.equal('supplier' in data.data.products[0],false);
  assert.equal(JSON.stringify(data).includes('SECRET'),false);
  const view=await fetch(base+'/api/shop/view?botId=test-bot');assert.equal(view.status,200);
  const html=await view.text();assert.ok(html.includes('Mua ngay')&&html.includes('Chi tiết'));
  for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
  await service.sendProductCards({id:'chat',botId:'test-bot',type:'direct'},'SECRET');
  const buttons=outgoing[0][2].replyMarkup.inline_keyboard[0];
  assert.ok(buttons[0].web_app.url.startsWith('https://shop.example/'));
  assert.equal(buttons[1].url,'https://vaga.vn/products');
  assert.ok(outgoing[0][1].includes('Chanh'));
  db.getManagedBotById=async()=>({id:'test-bot',isEnabled:false,name:'Shop thử',username:'TestShopBot'} as any);
  assert.equal((await fetch(base+'/api/shop/catalog?botId=test-bot')).status,200);
  db.getManagedBotById=async()=>null;
  assert.equal((await fetch(base+'/api/shop/catalog?botId=test-bot')).status,404);
 }finally{
  db.getManagedBotById=originalBot;productService.list=originalList;service.sendMessage=send;
  if(oldShop===undefined)delete process.env.TELEGRAM_SHOP_URL;else process.env.TELEGRAM_SHOP_URL=oldShop;
  if(oldWeb===undefined)delete process.env.SHOP_WEB_URL;else process.env.SHOP_WEB_URL=oldWeb;
  server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
 }
});

test('buying from Shop reuses stock checks and verified-buyer purchase flow without creating an order prematurely',async()=>{
 const service=telegramService as any;
 const originals={bot:db.getManagedBotById,ready:bnkDataService.isReady,product:bnkDataService.getProduct,draft:bnkDataService.startPurchaseDraft,buyer:bnkDataService.getVerifiedBuyer,maintenance:broadcastService.getMaintenance,send:service.sendMessage,prompt:service.sendPurchaseInputPrompt};
 let starts=0,prompts=0;
 try{
  db.getManagedBotById=async()=>({id:'bot',isEnabled:true,telegramBotId:'123'} as any);
  bnkDataService.isReady=()=>true;broadcastService.getMaintenance=()=>({enabled:false} as any);
  bnkDataService.getProduct=async()=>({id:1,stockQuantity:3} as any);
  bnkDataService.startPurchaseDraft=async(user,chat,bot,id)=>{assert.deepEqual([user,chat,bot,id],['5','5','123',1]);starts++;};
  bnkDataService.getVerifiedBuyer=async()=>({customerId:1} as any);
  service.sendPurchaseInputPrompt=async()=>{prompts++;};service.sendMessage=async()=>{};
  await service.beginProductPurchase({id:'chat'},1,'5','5',{botId:'bot',token:'secret'});
  assert.equal(starts,1);assert.equal(prompts,1);
  bnkDataService.getProduct=async()=>({id:1,stockQuantity:0} as any);
  await service.beginProductPurchase({id:'chat'},1,'5','5',{botId:'bot',token:'secret'});
  assert.equal(starts,1);
 }finally{
  db.getManagedBotById=originals.bot;bnkDataService.isReady=originals.ready;bnkDataService.getProduct=originals.product;bnkDataService.startPurchaseDraft=originals.draft;bnkDataService.getVerifiedBuyer=originals.buyer;broadcastService.getMaintenance=originals.maintenance;service.sendMessage=originals.send;service.sendPurchaseInputPrompt=originals.prompt;
 }
});