import mysql from 'mysql2/promise';
import { config } from '../config/index.js';
import { db } from '../database/connection.js';
import { applyOrderInventory,InventoryError } from './inventoryService.js';
export class OrderAdminError extends Error{constructor(message:string,public statusCode=400){super(message);}}
const states=['NEW','CONFIRMED','PACKING','SHIPPING','DELIVERED','CANCELLED'];
export class OrderAdminService{
 constructor(private pool:mysql.Pool|null=null){}
 async initialize(){if(db.isMySQLActive())this.pool=mysql.createPool({...config.database,connectionLimit:5});}
 private connection(){if(!this.pool)throw new OrderAdminError('Chưa kết nối được dữ liệu đơn hàng.',503);return this.pool;}
 private id(value:unknown){if(typeof value!=='string'||!/^[1-9]\d{0,19}$/.test(value))throw new OrderAdminError('Mã đơn không hợp lệ.');return value;}
 async list(search:unknown='',status:unknown='',cursor:unknown=undefined){
  if(typeof search!=='string'||search.length>100||typeof status!=='string'||(status&&!states.includes(status)))throw new OrderAdminError('Bộ lọc đơn hàng không hợp lệ.');
  if(cursor!==undefined)this.id(cursor);
  const filters:string[]=[],params:unknown[]=[];
  if(search.trim()){filters.push('(o.order_code LIKE ? OR o.recipient_name LIKE ? OR o.recipient_phone LIKE ?)');for(let i=0;i<3;i++)params.push('%'+search.trim()+'%');}
  if(status){filters.push('o.status=?');params.push(status);}
  if(cursor){filters.push('o.id<?');params.push(cursor);}
  const [rows]=await this.connection().query<mysql.RowDataPacket[]>(`SELECT o.id,o.order_code,o.status,o.payment_status,o.recipient_name,o.recipient_phone,o.created_at,o.shipping_fee,o.discount_amount,COALESCE(t.amount,0) AS amount,COALESCE(t.quantity,0) AS quantity FROM orders o LEFT JOIN (SELECT order_id,SUM(quantity*unit_price) AS amount,SUM(quantity) AS quantity FROM order_items GROUP BY order_id) t ON t.order_id=o.id ${filters.length?'WHERE '+filters.join(' AND '):''} ORDER BY o.id DESC LIMIT 51`,params);
  return {orders:rows.slice(0,50).map(row=>({id:String(row.id),code:String(row.order_code),status:String(row.status),paymentStatus:String(row.payment_status),name:String(row.recipient_name||''),phone:String(row.recipient_phone||''),createdAt:row.created_at,quantity:Number(row.quantity),amount:Number(row.amount),total:Number(row.amount)+Number(row.shipping_fee)-Number(row.discount_amount)})),nextCursor:rows.length>50?String(rows[49].id):null};
 }
 private async read(c:Pick<mysql.Pool,'query'>,id:string){
  const [rows]=await c.query<mysql.RowDataPacket[]>('SELECT o.*,i.state AS inventory_state FROM orders o LEFT JOIN inventory_orders i ON i.order_id=o.id WHERE o.id=?',[id]);
  if(!rows.length)throw new OrderAdminError('Không tìm thấy đơn hàng.',404);
  const row=rows[0];const [lines]=await c.query<mysql.RowDataPacket[]>('SELECT product_id,product_name,quantity,unit_price FROM order_items WHERE order_id=? ORDER BY id',[id]);
  const items=lines.map(line=>({productId:line.product_id==null?'':String(line.product_id),name:String(line.product_name),quantity:Number(line.quantity),price:Number(line.unit_price),amount:Number(line.quantity)*Number(line.unit_price)}));const amount=items.reduce((sum,line)=>sum+line.amount,0);
  return {id:String(row.id),code:String(row.order_code),status:String(row.status),paymentStatus:String(row.payment_status),name:String(row.recipient_name||''),phone:String(row.recipient_phone||''),address:String(row.shipping_address||''),note:String(row.note||''),carrier:String(row.carrier||''),trackingCode:String(row.tracking_code||''),createdAt:row.created_at,inventoryState:row.inventory_state||null,quantity:items.reduce((sum,line)=>sum+line.quantity,0),items,amount,shippingFee:Number(row.shipping_fee),discount:Number(row.discount_amount),total:amount+Number(row.shipping_fee)-Number(row.discount_amount)};
 }
 async detail(id:unknown){return this.read(this.connection(),this.id(id));}
 async action(id:unknown,value:unknown){
  const orderId=this.id(id);if(!value||typeof value!=='object')throw new OrderAdminError('Thao tác không hợp lệ.');
  const body=value as Record<string,unknown>;
  const transitions:Record<string,{from:string[];to:string}>={approve:{from:['NEW'],to:'CONFIRMED'},pack:{from:['CONFIRMED'],to:'PACKING'},ship:{from:['CONFIRMED','PACKING'],to:'SHIPPING'},deliver:{from:['SHIPPING'],to:'DELIVERED'},cancel:{from:['NEW','CONFIRMED','PACKING'],to:'CANCELLED'}};
  const rule=typeof body.action==='string'&&Object.prototype.hasOwnProperty.call(transitions,body.action)?transitions[body.action]:undefined;
  if(!rule||typeof body.expectedStatus!=='string'||!states.includes(body.expectedStatus))throw new OrderAdminError('Thao tác hoặc trạng thái đơn không hợp lệ.');
  const c=await this.connection().getConnection();
  try{
   await c.beginTransaction();const [rows]=await c.query<mysql.RowDataPacket[]>('SELECT status FROM orders WHERE id=? FOR UPDATE',[orderId]);if(!rows.length)throw new OrderAdminError('Không tìm thấy đơn hàng.',404);
   const status=String(rows[0].status);
   if(status!==rule.to){
    if(status!==body.expectedStatus||!rule.from.includes(status))throw new OrderAdminError('Trạng thái đơn đã thay đổi hoặc không phù hợp. Vui lòng tải lại đơn.',409);
    const [stock]=await c.query<mysql.RowDataPacket[]>('SELECT state FROM inventory_orders WHERE order_id=? FOR UPDATE',[orderId]);
    if(body.action==='ship')await applyOrderInventory(c,orderId,'fulfill');
    else if(body.action==='cancel'&&stock.length)await applyOrderInventory(c,orderId,'cancel');
    else if(stock.length&&((body.action==='deliver'&&stock[0].state!=='fulfilled')||(body.action!=='deliver'&&stock[0].state!=='reserved')))throw new OrderAdminError('Trạng thái giữ hàng không phù hợp. Vui lòng kiểm tra tồn kho.',409);
    await c.query('UPDATE orders SET status=? WHERE id=?',[rule.to,orderId]);
   }
   const result=await this.read(c,orderId);await c.commit();return result;
  }catch(error){await c.rollback();if(error instanceof InventoryError)throw new OrderAdminError(error.message,error.statusCode);throw error;}finally{c.release();}
 }
}
export const orderAdminService=new OrderAdminService();