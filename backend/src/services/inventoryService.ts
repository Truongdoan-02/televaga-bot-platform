import mysql from 'mysql2/promise';
import { randomUUID, createHash } from 'node:crypto';
import { config } from '../config/index.js';
import { db } from '../database/connection.js';
export class InventoryError extends Error { constructor(message: string, public statusCode = 400) { super(message); } }
const maxQuantity = 2147483647;
export async function migrateInventory(pool: mysql.Pool) {
  await pool.query("CREATE TABLE IF NOT EXISTS product_inventory (product_id BIGINT UNSIGNED PRIMARY KEY, unit VARCHAR(20) NOT NULL DEFAULT 'cái', stock_quantity INT UNSIGNED NOT NULL DEFAULT 0, quantity_reserved INT UNSIGNED NOT NULL DEFAULT 0, minimum_quantity INT UNSIGNED NOT NULL DEFAULT 0, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_inventory_product FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE, CHECK(stock_quantity>=quantity_reserved))");
  await pool.query("CREATE TABLE IF NOT EXISTS inventory_transactions (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, code VARCHAR(40) NOT NULL UNIQUE, product_id BIGINT UNSIGNED NOT NULL, type VARCHAR(20) NOT NULL, quantity_change INT NOT NULL, reserved_change INT NOT NULL DEFAULT 0, quantity_before INT UNSIGNED NOT NULL, quantity_after INT UNSIGNED NOT NULL, reserved_before INT UNSIGNED NOT NULL DEFAULT 0, reserved_after INT UNSIGNED NOT NULL DEFAULT 0, unit_cost DECIMAL(12,2) NULL, supplier_code VARCHAR(20) NULL, order_id BIGINT UNSIGNED NULL, reference_code VARCHAR(100) NULL UNIQUE, note TEXT, created_by VARCHAR(100) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_inventory_tx_product FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT, INDEX idx_inventory_tx_product(product_id,created_at))");
  await pool.query("CREATE TABLE IF NOT EXISTS inventory_orders (order_id BIGINT UNSIGNED PRIMARY KEY, order_code VARCHAR(100) NOT NULL, state VARCHAR(20) NOT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)");
  await pool.query("CREATE TABLE IF NOT EXISTS inventory_documents (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,code VARCHAR(30) NOT NULL UNIQUE,type VARCHAR(20) NOT NULL,note TEXT NOT NULL,reference_code CHAR(36) NOT NULL UNIQUE,payload_hash CHAR(64) NOT NULL,created_by VARCHAR(100) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  await pool.query("CREATE TABLE IF NOT EXISTS inventory_document_items (document_id BIGINT UNSIGNED NOT NULL,product_id BIGINT UNSIGNED NOT NULL,product_code VARCHAR(50) NOT NULL,product_name VARCHAR(200) NOT NULL,quantity INT UNSIGNED NULL,unit_cost DECIMAL(12,2) NULL,quantity_before INT UNSIGNED NOT NULL,quantity_after INT UNSIGNED NOT NULL,reserved_before INT UNSIGNED NOT NULL,reserved_after INT UNSIGNED NOT NULL,unit_before VARCHAR(20) NOT NULL,unit_after VARCHAR(20) NOT NULL,minimum_before INT UNSIGNED NOT NULL,minimum_after INT UNSIGNED NOT NULL,PRIMARY KEY(document_id,product_id),FOREIGN KEY(document_id) REFERENCES inventory_documents(id) ON DELETE RESTRICT,FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT)");
  const [docColumns]=await pool.query<mysql.RowDataPacket[]>("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='inventory_transactions' AND column_name='document_id'");
  if(!docColumns.length)await pool.query('ALTER TABLE inventory_transactions ADD COLUMN document_id BIGINT UNSIGNED NULL, ADD CONSTRAINT fk_inventory_tx_document FOREIGN KEY(document_id) REFERENCES inventory_documents(id) ON DELETE RESTRICT');
  const [columns] = await pool.query<mysql.RowDataPacket[]>("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='products' AND column_name='stock_quantity'");
  if (columns.length) {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      await c.query('SELECT id FROM products FOR UPDATE');
      await c.query('INSERT IGNORE INTO product_inventory(product_id,stock_quantity) SELECT id,GREATEST(stock_quantity,0) FROM products');
      const [different] = await c.query<mysql.RowDataPacket[]>('SELECT p.id FROM products p LEFT JOIN product_inventory i ON i.product_id=p.id WHERE i.product_id IS NULL OR i.stock_quantity<>GREATEST(p.stock_quantity,0)');
      if (different.length) throw new InventoryError('Tồn kho đã thay đổi trong lúc chuyển dữ liệu. Dừng backend cũ trước khi chạy migration.', 409);
      await c.query("INSERT IGNORE INTO inventory_transactions(code,product_id,type,quantity_change,quantity_before,quantity_after,reference_code,note,created_by) SELECT CONCAT('OPEN-',product_id),product_id,'opening',stock_quantity,0,stock_quantity,CONCAT('opening:',product_id),'Chuyển tồn kho từ products','migration' FROM product_inventory WHERE stock_quantity>0");
      await c.commit();
    } catch (error) { await c.rollback(); throw error; } finally { c.release(); }
    const [checks] = await pool.query<mysql.RowDataPacket[]>("SELECT tc.CONSTRAINT_NAME,cc.CHECK_CLAUSE FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME='products' AND tc.CONSTRAINT_TYPE='CHECK'");
    for (const check of checks) if (String(check.CHECK_CLAUSE).includes('stock_quantity')) await pool.query('ALTER TABLE products DROP CHECK ??', [check.CONSTRAINT_NAME]);
    await pool.query('ALTER TABLE products DROP COLUMN stock_quantity');
  } else await pool.query('INSERT IGNORE INTO product_inventory(product_id) SELECT id FROM products');
}
export async function applyInventory(c: mysql.PoolConnection, productId: string | number, type: string, quantityChange: number, reservedChange: number,
  meta: { reference: string; note: string; actor: string; orderId?: number; supplierCode?: string; unitCost?: number | null; documentId?: number }) {
  const [products] = await c.query<mysql.RowDataPacket[]>('SELECT id FROM products WHERE id=? FOR UPDATE', [productId]);
  if (!products.length) throw new InventoryError('Không tìm thấy sản phẩm.', 404);
  await c.query('INSERT IGNORE INTO product_inventory(product_id) VALUES (?)', [productId]);
  const [rows] = await c.query<mysql.RowDataPacket[]>('SELECT * FROM product_inventory WHERE product_id=? FOR UPDATE', [productId]);
  const row = rows[0], before = Number(row.stock_quantity), reserved = Number(row.quantity_reserved);
  const after = before + quantityChange, reservedAfter = reserved + reservedChange;
  if (![after,reservedAfter].every(v => Number.isInteger(v) && v>=0 && v<=maxQuantity) || after<reservedAfter) throw new InventoryError('Không đủ hàng có thể bán hoặc số lượng vượt giới hạn.', 409);
  const code = 'KHO-' + randomUUID();
  await c.query('UPDATE product_inventory SET stock_quantity=?,quantity_reserved=? WHERE product_id=?', [after,reservedAfter,productId]);
  await c.query('INSERT INTO inventory_transactions(code,product_id,type,quantity_change,reserved_change,quantity_before,quantity_after,reserved_before,reserved_after,unit_cost,supplier_code,order_id,reference_code,note,created_by,document_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [code,productId,type,quantityChange,reservedChange,before,after,reserved,reservedAfter,meta.unitCost??null,meta.supplierCode||null,meta.orderId||null,meta.reference,meta.note,meta.actor,meta.documentId??null]);
  return { code, before, after, reservedAfter };
}
export interface InventoryInput { productId: string; type: 'receipt'|'issue'|'count'|'return'; quantity: number; note: string; reference: string; unitCost: number|null }
export function validateInventory(b: Record<string, unknown>): InventoryInput {
  if (!b || typeof b !== 'object' || !/^[1-9][0-9]{0,19}$/.test(String(b.productId))) throw new InventoryError('Chọn sản phẩm hợp lệ.');
  if (!['receipt','issue','count','return'].includes(String(b.type))) throw new InventoryError('Loại giao dịch không hợp lệ.');
  if (typeof b.quantity !== 'number' || !Number.isInteger(b.quantity) || b.quantity< (b.type==='count'?0:1) || b.quantity>maxQuantity) throw new InventoryError('Số lượng phải là số nguyên hợp lệ.');
  if (typeof b.note !== 'string' || !b.note.trim() || b.note.length>10000) throw new InventoryError('Vui lòng nhập lý do/ghi chú (tối đa 10.000 ký tự).');
  if (typeof b.reference !== 'string' || !/^[a-f0-9-]{36}$/i.test(b.reference)) throw new InventoryError('Mã yêu cầu không hợp lệ. Mở lại form để thử lại.');
  if (b.type==='receipt' && b.unitCost == null) throw new InventoryError('Vui lòng nhập giá nhập/đơn vị.');
  if (b.unitCost != null && (typeof b.unitCost !== 'number' || !Number.isFinite(b.unitCost) || b.unitCost<0 || b.unitCost>9999999999.99 || Math.abs(b.unitCost*100-Math.round(b.unitCost*100))>0.0001)) throw new InventoryError('Giá nhập không hợp lệ.');
  return { productId: String(b.productId),type:b.type as InventoryInput['type'],quantity:b.quantity,note:b.note.trim(),reference:b.reference,unitCost:b.unitCost as number|null??null };
}
export interface InventoryDocumentInput {
  type:'receipt'|'issue'|'count'|'return'|'settings'; note:string;reference:string;
  items:{productId:string;quantity:number|null;unitCost:number|null;unit:string|null;minimumQuantity:number|null}[];
}
export function validateInventoryDocument(value:unknown):InventoryDocumentInput {
  if(!value||typeof value!=='object')throw new InventoryError('Phiếu kho không hợp lệ.');
  const b=value as Record<string,unknown>;
  if(!['receipt','issue','count','return','settings'].includes(String(b.type)))throw new InventoryError('Loại phiếu không hợp lệ.');
  if(typeof b.note!=='string'||!b.note.trim()||b.note.length>10000)throw new InventoryError('Vui lòng nhập lý do/ghi chú.');
  if(typeof b.reference!=='string'||!/^[a-f0-9-]{36}$/i.test(b.reference))throw new InventoryError('Mã yêu cầu không hợp lệ.');
  if(!Array.isArray(b.items)||b.items.length<1||b.items.length>100)throw new InventoryError('Mỗi phiếu cần từ 1 đến 100 sản phẩm.');
  const seen=new Set<string>();
  const items=b.items.map(value=>{
    if(!value||typeof value!=='object')throw new InventoryError('Dòng sản phẩm không hợp lệ.');
    const item=value as Record<string,unknown>;
    if(typeof item.productId!=='string'||!/^[1-9][0-9]{0,19}$/.test(item.productId)||seen.has(item.productId))throw new InventoryError('Chọn sản phẩm hợp lệ, không trùng trong cùng phiếu.');
    seen.add(item.productId);
    if(b.type==='settings'){
      if(typeof item.unit!=='string'||!item.unit.trim()||item.unit.trim().length>20||typeof item.minimumQuantity!=='number'||!Number.isInteger(item.minimumQuantity)||item.minimumQuantity<0||item.minimumQuantity>maxQuantity)throw new InventoryError('Đơn vị tồn/ngưỡng cảnh báo không hợp lệ.');
      return {productId:item.productId,quantity:null,unitCost:null,unit:item.unit.trim(),minimumQuantity:item.minimumQuantity};
    }
    const validated=validateInventory({...item,type:b.type,note:b.note,reference:b.reference});
    return {productId:validated.productId,quantity:validated.quantity,unitCost:b.type==='receipt'?validated.unitCost:null,unit:null,minimumQuantity:null};
  }).sort((a,b)=>BigInt(a.productId)<BigInt(b.productId)?-1:1);
  return {type:b.type as InventoryDocumentInput['type'],note:b.note.trim(),reference:b.reference,items};
}
export async function applyOrderInventory(c:mysql.PoolConnection,orderId:string,action:string){
  if(!['fulfill','cancel','return'].includes(action))throw new InventoryError('Thao tác đơn không hợp lệ.');
      const [actualOrders]=await c.query<mysql.RowDataPacket[]>('SELECT id,status FROM orders WHERE id=? FOR UPDATE',[orderId]);
      if(!actualOrders.length)throw new InventoryError('Không tìm thấy đơn hàng.',404);
      const [rows]=await c.query<mysql.RowDataPacket[]>('SELECT * FROM inventory_orders WHERE order_id=? FOR UPDATE',[orderId]);
      const order=rows[0];if(!order)throw new InventoryError('Đơn này chưa có dữ liệu giữ hàng trong hệ thống tồn kho mới.',409);
      const next=action==='fulfill'?'fulfilled':action==='cancel'?'cancelled':'returned';
      if(order.state===next)return;
      if((action==='return'&&order.state!=='fulfilled')||(action!=='return'&&order.state!=='reserved'))throw new InventoryError('Trạng thái đơn không phù hợp.',409);
      const [items]=await c.query<mysql.RowDataPacket[]>('SELECT product_id,SUM(quantity) AS quantity FROM order_items WHERE order_id=? GROUP BY product_id ORDER BY product_id',[orderId]);
      if(!items.length||items.some(i=>!i.product_id))throw new InventoryError('Đơn thiếu thông tin sản phẩm.',409);
      for(const item of items)await applyInventory(c,item.product_id,action,action==='fulfill'?-Number(item.quantity):action==='return'?Number(item.quantity):0,action==='return'?0:-Number(item.quantity),
        {reference:'order:'+orderId+':'+action+':'+item.product_id,note:action==='return'?'Nhận lại toàn bộ hàng của đơn':action==='fulfill'?'Xuất kho giao đơn':'Hủy đơn, giải phóng giữ hàng',actor:'admin',orderId:Number(orderId)});
      await c.query('UPDATE inventory_orders SET state=? WHERE order_id=?',[next,orderId]);
      await c.query('UPDATE orders SET status=? WHERE id=?',[action==='fulfill'?'SHIPPING':'CANCELLED',orderId]);

}

export class InventoryService {
  constructor(private pool: mysql.Pool|null=null) {}
  async initialize() {
    if (!db.isMySQLActive()) return;
    this.pool=mysql.createPool({...config.database,connectionLimit:3});
  }
  private connection() { if(!this.pool)throw new InventoryError('Tồn kho cần kết nối MySQL.',503);return this.pool; }
  async list() {
    const [rows]=await this.connection().query<mysql.RowDataPacket[]>("SELECT p.id AS productId,p.sku AS code,p.name,p.image_url AS imageUrl,p.packaging AS quantity,p.price AS salePrice,COALESCE(s.name,p.supplier) AS supplier,i.unit,i.stock_quantity AS onHand,i.quantity_reserved AS reserved,i.stock_quantity-i.quantity_reserved AS available,i.minimum_quantity AS minimumQuantity FROM products p JOIN product_inventory i ON i.product_id=p.id LEFT JOIN suppliers s ON s.code=p.supplier_code ORDER BY p.name,p.id");
    return rows.map(r=>({...r,productId:String(r.productId),salePrice:Number(r.salePrice),onHand:Number(r.onHand),reserved:Number(r.reserved),available:Number(r.available),minimumQuantity:Number(r.minimumQuantity)}));
  }
  async history(productId?: string) {
    const [rows]=await this.connection().query<mysql.RowDataPacket[]>('SELECT t.*,p.sku AS product_code,p.name AS product_name,d.code AS document_code FROM inventory_transactions t JOIN products p ON p.id=t.product_id LEFT JOIN inventory_documents d ON d.id=t.document_id'+(productId?' WHERE t.product_id=?':'')+' ORDER BY t.id DESC LIMIT 500',productId?[productId]:[]);
    return rows;
  }
  async configure(productId: string, body: {unit?:unknown;minimumQuantity?:unknown}) {
    if(typeof body.unit!=='string'||!body.unit.trim()||body.unit.trim().length>20||typeof body.minimumQuantity!=='number'||!Number.isInteger(body.minimumQuantity)||body.minimumQuantity<0||body.minimumQuantity>maxQuantity)throw new InventoryError('Đơn vị tồn và ngưỡng cảnh báo không hợp lệ.');
    const [r]=await this.connection().query<mysql.ResultSetHeader>('UPDATE product_inventory SET unit=?,minimum_quantity=? WHERE product_id=?',[body.unit.trim(),body.minimumQuantity,productId]);
    if(!r.affectedRows)throw new InventoryError('Không tìm thấy sản phẩm.',404);
  }
  async transact(input:InventoryInput) {
    const c=await this.connection().getConnection();
    try {
      await c.beginTransaction();
      const [products]=await c.query<mysql.RowDataPacket[]>('SELECT supplier_code FROM products WHERE id=? FOR UPDATE',[input.productId]);
      if(!products.length)throw new InventoryError('Không tìm thấy sản phẩm.',404);
      const [prior]=await c.query<mysql.RowDataPacket[]>('SELECT * FROM inventory_transactions WHERE reference_code=?',[input.reference]);
      if(prior.length) {
        const r=prior[0];
        const expected=input.type==='count'?Number(r.quantity_before)+Number(r.quantity_change):Math.abs(Number(r.quantity_change));
        if(String(r.product_id)!==input.productId||r.type!==input.type||expected!==input.quantity||r.note!==input.note|| (r.unit_cost==null?null:Number(r.unit_cost))!==input.unitCost)throw new InventoryError('Mã yêu cầu đã được sử dụng cho giao dịch khác.',409);
        await c.commit();return {code:r.code};
      }
      const [rows]=await c.query<mysql.RowDataPacket[]>('SELECT stock_quantity FROM product_inventory WHERE product_id=? FOR UPDATE',[input.productId]);
      const change=input.type==='count'?input.quantity-Number(rows[0]?.stock_quantity||0):input.type==='issue'?-input.quantity:input.quantity;
      const result=await applyInventory(c,input.productId,input.type,change,0,{reference:input.reference,note:input.note,actor:'admin',supplierCode:input.type==='receipt'?products[0].supplier_code:undefined,unitCost:input.unitCost});
      await c.commit();return result;
    }catch(error){await c.rollback();throw error;}finally{c.release();}
  }
  async documents() {
    const [rows]=await this.connection().query<mysql.RowDataPacket[]>('SELECT d.*,COUNT(i.product_id) AS item_count FROM inventory_documents d JOIN inventory_document_items i ON i.document_id=d.id GROUP BY d.id ORDER BY d.id DESC LIMIT 200');
    return rows.map(r=>({...r,id:String(r.id),item_count:Number(r.item_count)}));
  }
  async document(id:string) { return this.readDocument(this.connection(),id); }
  private async readDocument(connection:mysql.Pool|mysql.PoolConnection,id:string) {
    const [rows]=await connection.query<mysql.RowDataPacket[]>('SELECT * FROM inventory_documents WHERE id=?',[id]);
    if(!rows.length)throw new InventoryError('Không tìm thấy phiếu kho.',404);
    const [items]=await connection.query<mysql.RowDataPacket[]>('SELECT * FROM inventory_document_items WHERE document_id=? ORDER BY product_id',[id]);
    return {...rows[0],id:String(rows[0].id),item_count:items.length,items:items.map(r=>({...r,product_id:String(r.product_id)}))};
  }
  async createDocument(body:unknown) {
    const input=validateInventoryDocument(body);
    const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const c=await this.connection().getConnection();
    try {
      await c.beginTransaction();
      // Always lock products in numerical order so multi-product operations cannot deadlock each other.
      for(const item of input.items){
        const [rows]=await c.query<mysql.RowDataPacket[]>('SELECT id FROM products WHERE id=? FOR UPDATE',[item.productId]);
        if(!rows.length)throw new InventoryError('Một sản phẩm trong phiếu không còn tồn tại.',404);
      }
      const [prior]=await c.query<mysql.RowDataPacket[]>('SELECT id,payload_hash FROM inventory_documents WHERE reference_code=?',[input.reference]);
      if(prior.length){
        if(prior[0].payload_hash!==hash)throw new InventoryError('Yêu cầu đã được dùng cho phiếu khác. Mở phiếu mới để tiếp tục.',409);
        await c.commit();return await this.readDocument(c,String(prior[0].id));
      }
      const prefixes:Record<string,string>={receipt:'NK',issue:'XK',count:'KK',return:'TH',settings:'CH'};
      const namespace='inventory:'+input.type;
      await c.query('INSERT INTO catalog_sequences(namespace,sequence_value) VALUES (?,0) ON DUPLICATE KEY UPDATE sequence_value=sequence_value',[namespace]);
      const [seq]=await c.query<mysql.RowDataPacket[]>('SELECT sequence_value FROM catalog_sequences WHERE namespace=? FOR UPDATE',[namespace]);
      const next=Number(seq[0].sequence_value)+1;
      if(!Number.isSafeInteger(next))throw new InventoryError('Đã hết dải mã phiếu.',409);
      await c.query('UPDATE catalog_sequences SET sequence_value=? WHERE namespace=?',[next,namespace]);
      const code=prefixes[input.type]+String(next).padStart(6,'0');
      const [insert]=await c.query<mysql.ResultSetHeader>('INSERT INTO inventory_documents(code,type,note,reference_code,payload_hash,created_by) VALUES (?,?,?,?,?,?)',[code,input.type,input.note,input.reference,hash,'admin']);
      for(const item of input.items){
        const [products]=await c.query<mysql.RowDataPacket[]>('SELECT sku,name,supplier_code,price FROM products WHERE id=?',[item.productId]);
        const [rows]=await c.query<mysql.RowDataPacket[]>('SELECT * FROM product_inventory WHERE product_id=? FOR UPDATE',[item.productId]);
        if(!rows.length)throw new InventoryError('Sản phẩm chưa có dữ liệu tồn kho.',409);
        const before=rows[0];let after=Number(before.stock_quantity);
        const unitCost=input.type==='issue'?Number(products[0].price):item.unitCost;
        if(input.type==='settings')await c.query('UPDATE product_inventory SET unit=?,minimum_quantity=? WHERE product_id=?',[item.unit,item.minimumQuantity,item.productId]);
        else {
          const change=input.type==='count'?item.quantity!-after:input.type==='issue'?-item.quantity!:item.quantity!;
          const result=await applyInventory(c,item.productId,input.type,change,0,{reference:input.reference+':'+item.productId,note:input.note,actor:'admin',unitCost,supplierCode:input.type==='receipt'?products[0].supplier_code:undefined,documentId:insert.insertId});
          after=result.after;
        }
        await c.query('INSERT INTO inventory_document_items(document_id,product_id,product_code,product_name,quantity,unit_cost,quantity_before,quantity_after,reserved_before,reserved_after,unit_before,unit_after,minimum_before,minimum_after) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [insert.insertId,item.productId,products[0].sku,products[0].name,item.quantity,unitCost,before.stock_quantity,after,before.quantity_reserved,before.quantity_reserved,before.unit,input.type==='settings'?item.unit:before.unit,before.minimum_quantity,input.type==='settings'?item.minimumQuantity:before.minimum_quantity]);
      }
      await c.commit();return await this.readDocument(c,String(insert.insertId));
    }catch(error){
      await c.rollback();
      if((error as {code?:string}).code==='ER_DUP_ENTRY'){
        const [prior]=await c.query<mysql.RowDataPacket[]>('SELECT id,payload_hash FROM inventory_documents WHERE reference_code=?',[input.reference]);
        if(prior[0]?.payload_hash===hash)return await this.readDocument(c,String(prior[0].id));
        throw new InventoryError('Mã yêu cầu đã được dùng. Mở phiếu mới để tiếp tục.',409);
      }
      throw error;
    }finally{c.release();}
  }
  async orders() {
    const [rows]=await this.connection().query<mysql.RowDataPacket[]>('SELECT o.order_id,o.order_code,o.state,o.updated_at,GROUP_CONCAT(CONCAT(p.sku,CHAR(32),oi.quantity) SEPARATOR 0x2C20) AS products FROM inventory_orders o JOIN order_items oi ON oi.order_id=o.order_id JOIN products p ON p.id=oi.product_id GROUP BY o.order_id,o.order_code,o.state,o.updated_at ORDER BY o.order_id DESC LIMIT 200');
    return rows;
  }
  async orderAction(orderId:string,action:string) {
    const c=await this.connection().getConnection();
    try{await c.beginTransaction();await applyOrderInventory(c,orderId,action);await c.commit();}
    catch(error){await c.rollback();throw error;}finally{c.release();}
  }
}
export const inventoryService=new InventoryService();