import { config } from '../config/index.js';
import { productService } from './productService.js';
import { db } from '../database/connection.js';
import { CUSTOMER_MENU } from './customerMenu.js';
export function shopUrl(botId:string) {
  const base=process.env.TELEGRAM_SHOP_URL || config.telegram.publicBackendUrl+'/api/shop/view';
  const url=new URL(base);url.searchParams.set('botId',botId);return url.toString();
}
export function shopWebUrl() {
  const value=process.env.SHOP_WEB_URL || CUSTOMER_MENU.find(button=>button.action==='url')?.url || 'https://vaga.vn/products';
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol))throw new Error('Invalid shop web URL');
  return url.toString();
}
export function productBuyUrl(username:string|undefined,id:string) {
  const name=(username||'').replace(/^@/,'');
  return /^[A-Za-z0-9_]{5,32}$/.test(name)&&/^[1-9][0-9]*$/.test(id)?'https://t.me/'+name+'?start=buy_'+id:null;
}
export async function shopCatalog(botId:string) {
  const bot=await db.getManagedBotById(botId);
  if(!bot)return null;
  // Catalog publication is independent of polling: a paused cloud bot can serve the local bot storefront.
  const products=await productService.list();
  return {name:bot.name,username:bot.username||'',webUrl:shopWebUrl(),products:products.filter(p=>p.status!=='discontinued').map(p=>({
    id:p.id,code:p.code,name:p.name,quantity:p.quantity,price:p.price,description:p.description,imageUrl:p.imageUrl,status:p.status,buyUrl:productBuyUrl(bot.username,p.id)
  }))};
}