import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import mysql from 'mysql2/promise';
import { config } from '../config/index.js';
import { db } from '../database/connection.js';
import { applyInventory } from './inventoryService.js';

export class ShopOrderError extends Error {
  constructor(message:string,public statusCode=400){super(message);}
}
export function telegramShopUser(initData:unknown,token:string,now=Math.floor(Date.now()/1000)):string {
  const invalid=()=>new ShopOrderError('Vui lòng đóng và mở lại Shop từ Telegram để xác thực tài khoản.',401);
  if(typeof initData!=='string'||!initData||initData.length>16384)throw invalid();
  const params=new URLSearchParams(initData);
  if(new Set(params.keys()).size!==[...params.keys()].length)throw invalid();
  const hash=params.get('hash')||'';params.delete('hash');
  if(!/^[a-f0-9]{64}$/i.test(hash))throw invalid();
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  const check=[...params.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>key+'='+value).join('\n');
  const expected=createHmac('sha256',secret).update(check).digest();
  if(!timingSafeEqual(expected,Buffer.from(hash,'hex')))throw invalid();
  const date=Number(params.get('auth_date'));
  if(!Number.isInteger(date)||date>now+30||now-date>3600)throw invalid();
  let user;try{user=JSON.parse(params.get('user')||'null');}catch{throw invalid();}
  if(!user||!Number.isSafeInteger(user.id)||user.id<1||user.is_bot)throw invalid();
  return String(user.id);
}
export interface ShopOrderInput {
  requestId:string;name:string;phone:string;address:string;
  items:{productId:string;quantity:number;priceMinor:number}[];
}
export function validateShopOrder(value:unknown):ShopOrderInput {
  if(!value||typeof value!=='object')throw new ShopOrderError('Thông tin đặt hàng không hợp lệ.');
  const b=value as Record<string,unknown>;
  const text=(key:string,max:number)=>{if(typeof b[key]!=='string'||!(b[key] as string).trim()||(b[key] as string).length>max)throw new ShopOrderError('Vui lòng nhập đầy đủ họ tên, số điện thoại và địa chỉ nhận hàng.');return (b[key] as string).trim();};
  const name=text('name',150),phone=text('phone',25).replace(/[\s().-]/g,''),address=text('address',300);
  if(!/^(?:0[35789]\d{8}|\+?84[35789]\d{8})$/.test(phone))throw new ShopOrderError('Vui lòng nhập số điện thoại Việt Nam hợp lệ.');
  if(typeof b.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(b.requestId))throw new ShopOrderError('Phiên đặt hàng không hợp lệ. Vui lòng mở lại giỏ.');
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)throw new ShopOrderError('Giỏ hàng cần từ 1 đến 100 sản phẩm.');
  const seen=new Set<string>();
  const items=b.items.map(value=>{if(!value||typeof value!=='object')throw new ShopOrderError('Sản phẩm không hợp lệ.');const item=value as Record<string,unknown>;
    if(typeof item.productId!=='string'||!/^[1-9]\d{0,14}$/.test(item.productId)||seen.has(item.productId))throw new ShopOrderError('Sản phẩm không hợp lệ hoặc bị trùng.');seen.add(item.productId);
    if(typeof item.quantity!=='number'||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>999)throw new ShopOrderError('Số lượng mỗi sản phẩm phải từ 1 đến 999.');
    if(typeof item.priceMinor!=='number'||!Number.isSafeInteger(item.priceMinor)||item.priceMinor<0||item.priceMinor>999999999999)throw new ShopOrderError('Giá sản phẩm không hợp lệ.');
    return {productId:item.productId,quantity:item.quantity,priceMinor:item.priceMinor};
  }).sort((a,b)=>Number(a.productId)-Number(b.productId));
  if(items.reduce((sum,item)=>sum+BigInt(item.quantity)*BigInt(item.priceMinor),0n)>BigInt(Number.MAX_SAFE_INTEGER))throw new ShopOrderError('Tổng tiền vượt giới hạn cho phép.');
  return {requestId:b.requestId.toLowerCase(),name,phone,address,items};
}
export async function migrateShopOrders(pool:mysql.Pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS shop_order_requests (
    scope_key CHAR(64) NOT NULL, request_id CHAR(36) NOT NULL, payload_hash CHAR(64) NOT NULL,
    order_id BIGINT UNSIGNED NULL UNIQUE, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(scope_key,request_id), FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT)`);
}
export class ShopOrderService {
  constructor(private pool:mysql.Pool|null=null){}
  async initialize(){if(!db.isMySQLActive())return;this.pool=mysql.createPool({...config.database,connectionLimit:5});await migrateShopOrders(this.pool);}
  private connection(){if(!this.pool)throw new ShopOrderError('Chưa kết nối được hệ thống đơn hàng. Vui lòng thử lại.',503);return this.pool;}
  private scope(botId:string,userId:string){return createHash('sha256').update(JSON.stringify([botId,userId])).digest('hex');}
  private async read(c:Pick<mysql.Pool,'query'>,scope:string,code:string){
    const [rows]=await c.query<mysql.RowDataPacket[]>(`SELECT o.id,o.order_code,o.status,o.payment_status,o.recipient_name,o.recipient_phone,o.shipping_address,o.shipping_fee,o.discount_amount,o.carrier,o.tracking_code,o.created_at
      FROM orders o JOIN shop_order_requests r ON r.order_id=o.id WHERE r.scope_key=? AND o.order_code=? LIMIT 1`,[scope,code]);
    if(!rows.length)throw new ShopOrderError('Không tìm thấy đơn hàng thuộc tài khoản này.',404);
    const row=rows[0];
    const [lines]=await c.query<mysql.RowDataPacket[]>('SELECT product_id,product_name,quantity,unit_price FROM order_items WHERE order_id=? ORDER BY id',[row.id]);
    const items=lines.map(line=>({productId:String(line.product_id),name:String(line.product_name),quantity:Number(line.quantity),price:Number(line.unit_price),amount:Number(line.quantity)*Number(line.unit_price)}));
    return {orderCode:String(row.order_code),status:String(row.status),paymentStatus:String(row.payment_status),name:String(row.recipient_name),phone:String(row.recipient_phone),address:String(row.shipping_address),createdAt:row.created_at,carrier:row.carrier||'',trackingCode:row.tracking_code||'',shippingFee:Number(row.shipping_fee),discount:Number(row.discount_amount),items,amount:items.reduce((sum,line)=>sum+line.amount,0)};
  }
  async lookup(botId:string,userId:string,code:unknown){
    if(typeof code!=='string'||!/^TV-[A-F0-9]{24}$/i.test(code.trim()))throw new ShopOrderError('Vui lòng nhập mã đơn hàng hợp lệ.');
    return this.read(this.connection(),this.scope(botId,userId),code.trim().toUpperCase());
  }
  async create(botId:string,userId:string,telegramBotId:string,input:ShopOrderInput){
    const pool=this.connection(),scope=this.scope(botId,userId);
    const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const code='TV-'+createHash('sha256').update(scope+':'+input.requestId).digest('hex').slice(0,24).toUpperCase();
    const c=await pool.getConnection();
    try{
      await c.beginTransaction();
      // A durable request row serializes retries before any stock or customer writes.
      await c.query('INSERT INTO shop_order_requests(scope_key,request_id,payload_hash) VALUES (?,?,?) ON DUPLICATE KEY UPDATE request_id=VALUES(request_id)',[scope,input.requestId,hash]);
      const [prior]=await c.query<mysql.RowDataPacket[]>('SELECT payload_hash,order_id FROM shop_order_requests WHERE scope_key=? AND request_id=? FOR UPDATE',[scope,input.requestId]);
      if(prior[0].payload_hash!==hash)throw new ShopOrderError('Yêu cầu này đã được dùng cho thông tin đơn khác. Vui lòng mở lại giỏ.',409);
      if(prior[0].order_id){const result=await this.read(c,scope,code);await c.commit();return result;}
      const checked=[];
      // Numerical product order matches all other stock operations to avoid deadlocks.
      for(const item of input.items){
        const [rows]=await c.query<mysql.RowDataPacket[]>(`SELECT p.id,p.name,p.price,i.stock_quantity-i.quantity_reserved AS available FROM products p JOIN product_inventory i ON i.product_id=p.id WHERE p.id=? AND p.is_active=1 AND p.status<>'discontinued' FOR UPDATE`,[item.productId]);
        const p=rows[0];if(!p)throw new ShopOrderError('Một sản phẩm đã ngừng bán. Vui lòng cập nhật giỏ.',409);
        if(Math.round(Number(p.price)*100)!==item.priceMinor)throw new ShopOrderError('Giá '+p.name+' đã thay đổi. Vui lòng cập nhật giỏ và kiểm tra lại.',409);
        if(Number(p.available)<item.quantity)throw new ShopOrderError(p.name+' không đủ hàng. Vui lòng giảm số lượng.',409);
        checked.push({...item,name:String(p.name),price:Number(p.price)});
      }
      // A typed delivery phone never grants access to an existing customer's orders.
      const [linked]=await c.query<mysql.RowDataPacket[]>(`SELECT cc.customer_id FROM customer_channels cc JOIN channel_connections ch ON ch.id=cc.connection_id WHERE ch.channel='TELEGRAM' AND ch.external_account_id=? AND cc.external_user_id=? AND cc.verified_at IS NOT NULL LIMIT 1`,[telegramBotId,userId]);
      let customerId=linked[0]?.customer_id;
      if(!customerId){const customerCode='SHOP-'+scope.slice(0,24).toUpperCase();
        const [insert]=await c.query<mysql.ResultSetHeader>('INSERT INTO customers(customer_code,name,phone,address) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[customerCode,input.name,input.phone,input.address]);customerId=insert.insertId;}
      const [order]=await c.query<mysql.ResultSetHeader>(`INSERT INTO orders(order_code,customer_id,status,payment_status,recipient_name,recipient_phone,shipping_address,shipping_fee,discount_amount) VALUES (?,?,'NEW','UNPAID',?,?,?,0,0)`,[code,customerId,input.name,input.phone,input.address]);
      for(const item of checked){
        await c.query('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price) VALUES (?,?,?,?,?)',[order.insertId,item.productId,item.name,item.quantity,item.price]);
        await applyInventory(c,item.productId,'reserve',0,item.quantity,{reference:'order:'+order.insertId+':reserve:'+item.productId,note:'Giữ hàng cho đơn Shop Telegram',actor:'telegram',orderId:order.insertId});
      }
      await c.query("INSERT INTO inventory_orders(order_id,order_code,state) VALUES (?,?,'reserved')",[order.insertId,code]);
      await c.query('UPDATE shop_order_requests SET order_id=? WHERE scope_key=? AND request_id=?',[order.insertId,scope,input.requestId]);
      const result=await this.read(c,scope,code);await c.commit();return result;
    }catch(error){await c.rollback();throw error;}finally{c.release();}
  }
}
export const shopOrderService=new ShopOrderService();