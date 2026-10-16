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
  const html=await view.text();assert.ok(html.includes('Mua ngay')&&html.includes('Thêm vào giỏ')&&html.includes('cart-open'));
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
test('Shop cart quantities, totals, persistence, isolation, removal and product details',async()=>{
 const fs=await import('node:fs/promises');
 const html=await fs.readFile(new URL('../../public/shop.html',import.meta.url),'utf8');
 const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
 const stored=new Map<string,string>();
 const products=[{id:'1',name:'Chanh',code:'VG001',quantity:'1 lọ',price:50000,status:'in_stock',description:'Mô tả',imageUrl:'',buyUrl:'https://t.me/TestShopBot?start=buy_1'},{id:'2',name:'Hết hàng',code:'VG002',quantity:'1 lọ',price:10000,status:'out_of_stock',description:'',imageUrl:'',buyUrl:null}];
 function node(){return {children:[] as any[],textContent:'',value:'',hidden:false,disabled:false,open:false,append(...items:any[]){this.children.push(...items);},replaceChildren(...items:any[]){this.children=items;},setAttribute(){},showModal(){this.open=true;},close(){this.open=false;}} as any;}
 async function start(botId:string){const elements=new Map<string,any>();const document={getElementById(id:string){if(!elements.has(id))elements.set(id,node());return elements.get(id);},createElement:node};const context=vm.createContext({document,window:{location:{}},location:{search:'?botId='+botId},URLSearchParams,localStorage:{getItem:(key:string)=>stored.get(key)||null,setItem:(key:string,value:string)=>stored.set(key,value)},fetch:async()=>({ok:true,json:async()=>({success:true,data:{products,name:'Shop',username:'TestShopBot',webUrl:'https://vaga.vn'}})})});await new vm.Script(script).runInContext(context);return {context,get:document.getElementById};}
 const app=await start('bot-a');const card=app.get('list').children[0];const content=card.children[1];const buttons=content.children[4].children;
 assert.equal(buttons[0].textContent,'Thêm vào giỏ');assert.equal(app.get('cart-count').textContent,0);
 content.children[0].onclick();assert.equal(app.get('detail').open,true);assert.equal(app.get('detail-name').textContent,'Chanh');assert.equal(app.get('cart-count').textContent,0);
 buttons[0].onclick();buttons[0].onclick();assert.equal(app.get('cart-count').textContent,2);assert.match(app.get('cart-total').textContent,/100.000/);
 app.get('cart-open').onclick();assert.equal(app.get('cart').open,true);
 const controls=app.get('cart-items').children[0].children[2];const quantity=controls.children[0].children[0];quantity.value='3';quantity.onchange();assert.equal(app.get('cart-count').textContent,3);assert.match(app.get('cart-total').textContent,/150.000/);
 const reopened=await start('bot-a');assert.equal(reopened.get('cart-count').textContent,3);const other=await start('bot-b');assert.equal(other.get('cart-count').textContent,0);
 assert.equal(app.get('list').children[1].children[1].children[4].children[0].disabled,true);
 quantity.value='-1';quantity.onchange();assert.equal(app.get('cart-count').textContent,3);
 app.get('cart-items').children[0].children[2].children[1].onclick();assert.equal(app.get('cart-count').textContent,0);assert.match(app.get('cart-items').children[0].textContent,/trống/);
});
test('Shop checkout form places the whole cart once, survives a lost response, and shows order code',async()=>{
 const fs=await import('node:fs/promises');const {randomUUID}=await import('node:crypto');
 const html=await fs.readFile(new URL('../../public/shop.html',import.meta.url),'utf8');const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
 const local=new Map<string,string>(),session=new Map<string,string>(),elements=new Map<string,any>();
 function node(){return {children:[] as any[],textContent:'',value:'',disabled:false,open:false,append(...items:any[]){this.children.push(...items);},replaceChildren(...items:any[]){this.children=items;},setAttribute(){},showModal(){this.open=true;},close(){this.open=false;}} as any;}
 const document={getElementById(id:string){if(!elements.has(id))elements.set(id,node());return elements.get(id);},createElement:node};const get=document.getElementById;
 const products=[{id:'1',name:'One',code:'ONE',price:100,quantity:'1 lọ',status:'in_stock',description:'',imageUrl:''},{id:'2',name:'Two',code:'TWO',price:200,quantity:'1 lọ',status:'in_stock',description:'',imageUrl:''}];
 const posted:any[]=[];let complete:any,attempt=0;
 const context=vm.createContext({document,crypto:{randomUUID},window:{Telegram:{WebApp:{ready(){},expand(){},initData:'SIGNED'}}},location:{search:'?botId=test'},URLSearchParams,localStorage:{getItem:(k:string)=>local.get(k)||null,setItem:(k:string,v:string)=>local.set(k,v)},sessionStorage:{getItem:(k:string)=>session.get(k)||null,setItem:(k:string,v:string)=>session.set(k,v),removeItem:(k:string)=>session.delete(k)},fetch:async(url:string,options:any)=>{
  if(!options?.method)return {ok:true,json:async()=>({success:true,data:{products,name:'Shop',username:'TestShopBot',webUrl:'https://vaga.vn'}})};
  posted.push(JSON.parse(options.body));if(attempt++===0)throw new Error('Network lost');
  return new Promise(resolve=>{complete=()=>resolve({ok:true,json:async()=>({success:true,data:{orderCode:'TV-0123456789ABCDEF01234567',name:'Buyer',phone:'0912345678',address:'123 Street',items:[{name:'One',quantity:2,price:100},{name:'Two',quantity:1,price:200}],amount:400}})});});
 }});
 await new vm.Script(script).runInContext(context);
 const add=(index:number)=>get('list').children[index].children[1].children[4].children[0].onclick();add(0);add(0);add(1);
 assert.equal(get('list').children[0].children[1].children[4].children.length,2);
 assert.equal(get('cart-items').children[0].children[2].children.length,2);
 get('checkout-open').onclick();assert.equal(get('checkout').open,true);assert.match(get('checkout-summary').textContent,/2 × One/);assert.match(get('checkout-summary').textContent,/1 × Two/);
 get('recipient-name').value='Buyer';get('recipient-phone').value='0912345678';get('recipient-address').value='123 Street';
 await get('checkout-form').onsubmit({preventDefault(){}});assert.equal(posted.length,1);assert.equal(get('cart-count').textContent,3);assert.equal(get('order-success').open,false);assert.equal(get('checkout-fields').disabled,true);
 const promise=get('checkout-form').onsubmit({preventDefault(){}});await get('checkout-form').onsubmit({preventDefault(){}});assert.equal(posted.length,2);assert.equal(posted[0].requestId,posted[1].requestId);assert.equal(posted[1].items.length,2);assert.equal(posted[1].initData,'SIGNED');
 complete();await promise;
 assert.equal(get('cart-count').textContent,0);assert.equal(get('order-success').open,true);assert.equal(get('success-code').textContent,'TV-0123456789ABCDEF01234567');assert.match(get('success-summary').textContent,/400/);assert.equal(session.size,0);
 get('success-lookup').onclick();assert.equal(get('order-lookup').open,true);assert.equal(get('lookup-code').value,'TV-0123456789ABCDEF01234567');
 get('lookup-close').onclick();add(0);add(0);add(1);
 get('list').children[0].children[1].children[4].children[1].onclick();
 assert.equal(get('checkout').open,true);assert.match(get('checkout-summary').textContent,/1 × One/);assert.equal(get('checkout-summary').textContent.includes('Two'),false);assert.equal(get('cart-count').textContent,3);
 assert.equal(get('checkout-back').textContent,'Tiếp tục mua sắm');
 get('checkout-back').onclick();assert.equal(get('cart').open,false);
 get('list').children[0].children[1].children[4].children[1].onclick();
 get('recipient-name').value='Buyer';get('recipient-phone').value='0912345678';get('recipient-address').value='123 Street';
 const direct=get('checkout-form').onsubmit({preventDefault(){}});assert.equal(posted[2].items.length,1);assert.equal(posted[2].items[0].productId,'1');assert.equal(posted[2].items[0].quantity,1);
 complete();await direct;assert.equal(get('cart-count').textContent,3);

});