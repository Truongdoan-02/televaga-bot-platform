import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { config } from '../src/config/index.js';
import { ShopOrderService,ShopOrderError,migrateShopOrders,validateShopOrder } from '../src/services/shopOrderService.js';
const admin=await mysql.createConnection(config.database);
const name='shop_order_test_'+Date.now();
assert.match(name,/^shop_order_test_\d+$/);
let created=false,pool:mysql.Pool|undefined;
try{
 await admin.query('CREATE DATABASE ??',[name]);created=true;
 pool=mysql.createPool({...config.database,database:name,connectionLimit:5});
 for(const table of ['customers','channel_connections','customer_channels','products','product_inventory','orders','order_items','inventory_transactions','inventory_orders']){
  const [rows]=await admin.query<mysql.RowDataPacket[]>('SHOW CREATE TABLE ??',[table]);
  const ddl=String(rows[0]['Create Table']).split('\n').filter(line=>!line.includes('FOREIGN KEY')).join('\n').replace(/,\n\)/,'\n)');
  await pool.query(ddl);
 }
 await migrateShopOrders(pool);await migrateShopOrders(pool);
 await pool.query("INSERT INTO products(id,sku,name,price,is_active,status) VALUES (1,'TEST1','One',100,1,'in_stock'),(2,'TEST2','Two',200,1,'in_stock')");
 await pool.query('INSERT INTO product_inventory(product_id,stock_quantity) VALUES (1,10),(2,10)');
 const service=new ShopOrderService(pool);
 const input=()=>validateShopOrder({requestId:randomUUID(),name:'Test Buyer',phone:'0912345678',address:'123 Test address',items:[{productId:'1',quantity:2,priceMinor:10000},{productId:'2',quantity:3,priceMinor:20000}]});
 const request=input();
 const results=await Promise.all([service.create('managed-bot','5','123',request),service.create('managed-bot','5','123',request),service.create('managed-bot','5','123',request)]);
 assert.equal(new Set(results.map(r=>r.orderCode)).size,1);const order=results[0];assert.equal(order.items.length,2);assert.equal(order.amount,800);
 const [counts]=await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM orders');assert.equal(Number(counts[0].n),1);
 const [stock]=await pool.query<mysql.RowDataPacket[]>('SELECT product_id,quantity_reserved FROM product_inventory ORDER BY product_id');assert.deepEqual(stock.map(r=>Number(r.quantity_reserved)),[2,3]);
 assert.equal((await service.lookup('managed-bot','5',order.orderCode)).orderCode,order.orderCode);
 await assert.rejects(()=>service.lookup('managed-bot','6',order.orderCode),(e:unknown)=>e instanceof ShopOrderError&&e.statusCode===404);
 await assert.rejects(()=>service.lookup('other-bot','5',order.orderCode),ShopOrderError);
 await assert.rejects(()=>service.create('managed-bot','5','123',{...request,address:'Changed'}),ShopOrderError);
 const bad=input();bad.items[1].quantity=999;
 await assert.rejects(()=>service.create('managed-bot','5','123',bad),ShopOrderError);
 const wrongPrice=input();wrongPrice.items[0].priceMinor=1;
 await assert.rejects(()=>service.create('managed-bot','5','123',wrongPrice),ShopOrderError);
 const [after]=await pool.query<mysql.RowDataPacket[]>('SELECT quantity_reserved FROM product_inventory ORDER BY product_id');assert.deepEqual(after.map(r=>Number(r.quantity_reserved)),[2,3]);
 await pool.query('UPDATE products SET price=101 WHERE id=1');assert.equal((await service.lookup('managed-bot','5',order.orderCode)).items[0].price,100);
 await pool.query("UPDATE orders SET status='SHIPPING' WHERE order_code=?",[order.orderCode]);assert.equal((await service.lookup('managed-bot','5',order.orderCode)).status,'SHIPPING');
 const oversell=input();oversell.items=[{productId:'2',quantity:5,priceMinor:20000}];
 const oversell2={...oversell,requestId:randomUUID()};
 const race=await Promise.allSettled([service.create('managed-bot','5','123',oversell),service.create('managed-bot','6','123',oversell2)]);
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
 console.log('PASS: multi-item order and totals, atomic stock reservation, concurrent retry deduplication, price checks, rollback, stock race, account-bound lookup, and historical prices.');
}finally{if(pool)await pool.end();if(created)await admin.query('DROP DATABASE ??',[name]);await admin.end();console.log('Isolated Shop test database removed.');}