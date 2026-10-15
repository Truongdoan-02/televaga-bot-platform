import mysql from 'mysql2/promise';
import { config } from '../config/index.js';
import { db } from '../database/connection.js';
import { isProductImage } from './broadcastImages.js';
import { migrateInventory } from './inventoryService.js';
import { allocateCode, migrateSuppliers, SupplierService, supplierPrefix } from './supplierService.js';

export type ProductStatus = 'in_stock' | 'out_of_stock' | 'discontinued';
export interface ProductInput {
  code: string; name: string; quantity: string; price: number; supplier: string; supplierCode: string;
  status: ProductStatus; description: string; imageUrl: string;
}
export interface Product extends ProductInput { id: string }
export class ProductError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}
export function validateProduct(value: unknown): ProductInput {
  if (!value || typeof value !== 'object') throw new ProductError('Dữ liệu sản phẩm không hợp lệ.');
  const body = value as Record<string, unknown>;
  const text = (key: string, max: number, required = false) => {
    if (typeof body[key] !== 'string') throw new ProductError('Thông tin sản phẩm không hợp lệ.');
    const value = (body[key] as string).trim();
    if ((required && !value) || value.length > max) throw new ProductError('Thông tin bị thiếu hoặc vượt quá độ dài cho phép.');
    return value;
  };
  const code = typeof body.code === 'string' ? body.code.trim() : '', name = text('name', 200, true);
  const supplierCode = text('supplierCode', 20, true);
  if (!/^NCC[0-9]{3,17}$/.test(supplierCode)) throw new ProductError('Vui lòng chọn nhà cung cấp hợp lệ.');
  const rawQuantity = text('quantity', 150, true), supplier = '';
  const measurement = rawQuantity.match(/^(\d+(?:[.,]\d+)?)\s*(ml|kg|g|l)$/i);
  if (!measurement || !Number.isFinite(Number(measurement[1].replace(',', '.'))) || Number(measurement[1].replace(',', '.')) <= 0) {
    throw new ProductError('Định lượng phải lớn hơn 0 và có đơn vị ml, l, g hoặc kg. Quy cách hộp/viên nhập trong mô tả.');
  }
  const quantity = Number(measurement[1].replace(',', '.')) + ' ' + measurement[2].toLowerCase();
  const description = text('description', 10000), imageUrl = text('imageUrl', 2048);
  if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price < 0 || body.price > 9999999999.99 ||
      Math.abs(body.price * 100 - Math.round(body.price * 100)) > 0.0001) throw new ProductError('Giá phải từ 0 đến 9.999.999.999,99 và tối đa 2 chữ số thập phân.');
  if (!['in_stock', 'out_of_stock', 'discontinued'].includes(String(body.status))) throw new ProductError('Tình trạng không hợp lệ.');
  if (imageUrl && !isProductImage(imageUrl)) {
    try { if (!['http:', 'https:'].includes(new URL(imageUrl).protocol)) throw new Error(); }
    catch { throw new ProductError('Đường dẫn ảnh phải là URL http hoặc https.'); }
  }
  return { code, name, quantity, price: body.price, supplier, supplierCode, status: body.status as ProductStatus, description, imageUrl };
}

export async function migrateProducts(pool: mysql.Pool) {
  await migrateSuppliers(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS products (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, category_id BIGINT UNSIGNED NULL,
    sku VARCHAR(50) NOT NULL UNIQUE, name VARCHAR(200) NOT NULL,
    description TEXT, packaging VARCHAR(150), price DECIMAL(12,2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    supplier VARCHAR(200) NOT NULL DEFAULT '', image_url VARCHAR(2048) NOT NULL DEFAULT '',
    status ENUM('in_stock','out_of_stock','discontinued') NOT NULL DEFAULT 'out_of_stock',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  const [columns] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='products'");
  const names = new Set(columns.map(row => row.COLUMN_NAME));
  if (names.has('brand')) await pool.query('ALTER TABLE products DROP COLUMN brand');
  for (const [name, definition] of [
    ['supplier', "VARCHAR(200) NOT NULL DEFAULT ''"],
    ['image_url', "VARCHAR(2048) NOT NULL DEFAULT ''"],
    ['status', "ENUM('in_stock','out_of_stock','discontinued') NOT NULL DEFAULT 'out_of_stock'"],
  ]) if (!names.has(name)) await pool.query(`ALTER TABLE products ADD COLUMN ${name} ${definition}`);
  if (!names.has('status')) await pool.query("UPDATE products SET status=CASE WHEN is_active=0 THEN 'discontinued' ELSE 'out_of_stock' END");
  await pool.query("ALTER TABLE products MODIFY category_id BIGINT UNSIGNED NULL");
  await pool.query('ALTER TABLE products MODIFY supplier VARCHAR(255) NOT NULL DEFAULT ' + "''");
  if (!names.has('supplier_code')) await pool.query('ALTER TABLE products ADD COLUMN supplier_code VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL');
  const [foreignKeys] = await pool.query<mysql.RowDataPacket[]>("SELECT CONSTRAINT_NAME FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name='products' AND column_name='supplier_code' AND referenced_table_name='suppliers'");
  if (!foreignKeys.length) await pool.query('ALTER TABLE products ADD CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_code) REFERENCES suppliers(code) ON DELETE RESTRICT');
  const [legacy] = await pool.query<mysql.RowDataPacket[]>("SELECT DISTINCT supplier FROM products WHERE supplier_code IS NULL AND TRIM(supplier)<>''");
  const suppliers = new SupplierService(pool);
  for (const row of legacy) {
    const [found] = await pool.query<mysql.RowDataPacket[]>('SELECT code FROM suppliers WHERE name=? ORDER BY code LIMIT 1', [row.supplier]);
    const code = found[0]?.code || (await suppliers.save({ name: row.supplier, contactName: '', phone: '', email: '', address: '', taxCode: '', bankAccount: '', bankName: '', status: 1, note: '' })).code;
    await pool.query('UPDATE products SET supplier_code=? WHERE supplier_code IS NULL AND supplier=?', [code, row.supplier]);
  }
  await migrateInventory(pool);
}

export class ProductService {
  constructor(private pool: mysql.Pool | null = null) {}
  async initialize() {
    if (!db.isMySQLActive()) return;
    const pool = mysql.createPool({ ...config.database, connectionLimit: 3 });
    try { await migrateProducts(pool); this.pool = pool; }
    catch (error) { await pool.end(); throw error; }
  }
  private connection() {
    if (!this.pool) throw new ProductError('Quản lý sản phẩm cần kết nối MySQL.', 503);
    return this.pool;
  }
  private map(row: mysql.RowDataPacket): Product {
    return { id: String(row.id), code: row.sku, name: row.name, quantity: row.packaging || '',
      price: Number(row.price), supplier: row.supplier_name || row.supplier || '', supplierCode: row.supplier_code || '', description: row.description || '', imageUrl: row.image_url || '',
      status: !row.is_active || row.status === 'discontinued' ? 'discontinued' : Number(row.available_stock || 0) <= 0 ? 'out_of_stock' : 'in_stock' };
  }
  async nextCode(supplierCode: string): Promise<string> {
    if (!/^NCC[0-9]{3,17}$/.test(supplierCode)) throw new ProductError('Vui lòng chọn nhà cung cấp hợp lệ.');
    const [suppliers] = await this.connection().query<mysql.RowDataPacket[]>('SELECT name,status FROM suppliers WHERE code=?', [supplierCode]);
    if (!suppliers.length || Number(suppliers[0].status) !== 1) throw new ProductError('Nhà cung cấp không tồn tại hoặc đã ngừng hợp tác.');
    const prefix = supplierPrefix(suppliers[0].name);
    const [rows] = await this.connection().query<mysql.RowDataPacket[]>(
      'SELECT GREATEST(COALESCE((SELECT sequence_value FROM catalog_sequences WHERE namespace=?),0),COALESCE((SELECT MAX(CAST(SUBSTRING(sku,?) AS UNSIGNED)) FROM products WHERE sku REGEXP ?),0)) AS current_value',
      ['products:' + prefix, prefix.length + 1, '^' + prefix + '[0-9]+$']);
    const next = Number(rows[0].current_value) + 1;
    if (!Number.isSafeInteger(next) || (prefix + String(next)).length > 20) throw new ProductError('Đã hết dải mã tự động.', 409);
    return prefix + String(next).padStart(3, '0');
  }
  async list(): Promise<Product[]> {
    const [rows] = await this.connection().query<mysql.RowDataPacket[]>('SELECT p.*, s.name AS supplier_name, COALESCE(i.stock_quantity-i.quantity_reserved,0) AS available_stock FROM products p LEFT JOIN suppliers s ON s.code=p.supplier_code LEFT JOIN product_inventory i ON i.product_id=p.id ORDER BY p.updated_at DESC, p.id DESC');
    return rows.map(row => this.map(row));
  }
  async get(id: string): Promise<Product> {
    const [rows] = await this.connection().query<mysql.RowDataPacket[]>('SELECT p.*, s.name AS supplier_name, COALESCE(i.stock_quantity-i.quantity_reserved,0) AS available_stock FROM products p LEFT JOIN suppliers s ON s.code=p.supplier_code LEFT JOIN product_inventory i ON i.product_id=p.id WHERE p.id=?', [id]);
    if (!rows.length) throw new ProductError('Không tìm thấy sản phẩm.', 404);
    return this.map(rows[0]);
  }
  async save(input: ProductInput, id?: string): Promise<Product> {
    const connection = await this.connection().getConnection();
    try {
      await connection.beginTransaction();
      const [suppliers] = await connection.query<mysql.RowDataPacket[]>('SELECT code,name,status FROM suppliers WHERE code=? FOR UPDATE', [input.supplierCode]);
      const supplier = suppliers[0];
      if (!supplier) throw new ProductError('Nhà cung cấp không tồn tại. Vui lòng chọn lại.');
      let old: mysql.RowDataPacket | undefined;
      if (id) {
        const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT id,sku,supplier_code FROM products WHERE id=? FOR UPDATE', [id]);
        old = rows[0];
        if (!old) throw new ProductError('Không tìm thấy sản phẩm.', 404);
      }
      if (Number(supplier.status) !== 1 && (!old || old.supplier_code !== supplier.code)) throw new ProductError('Nhà cung cấp đã ngừng hợp tác. Vui lòng chọn nhà cung cấp khác.');
      const prefix = supplierPrefix(supplier.name);
      const code = old && old.supplier_code === supplier.code ? old.sku : await allocateCode(connection, 'products:' + prefix, prefix, 'products', 'sku');
      const values = [code, input.name, input.quantity, input.price, supplier.name, supplier.code, input.status, input.description, input.imageUrl, input.status !== 'discontinued'];
      if (id) {
        await connection.query('UPDATE products SET sku=?,name=?,packaging=?,price=?,supplier=?,supplier_code=?,status=?,description=?,image_url=?,is_active=? WHERE id=?', [...values, id]);
      } else {
        const [result] = await connection.query<mysql.ResultSetHeader>('INSERT INTO products (sku,name,packaging,price,supplier,supplier_code,status,description,image_url,is_active) VALUES (?,?,?,?,?,?,?,?,?,?)', values);
        id = String(result.insertId);
        await connection.query('INSERT INTO product_inventory(product_id) VALUES (?)', [id]);
      }
      const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT p.*, s.name AS supplier_name, COALESCE(i.stock_quantity-i.quantity_reserved,0) AS available_stock FROM products p LEFT JOIN suppliers s ON s.code=p.supplier_code LEFT JOIN product_inventory i ON i.product_id=p.id WHERE p.id=?', [id]);
      await connection.commit(); return this.map(rows[0]);
    } catch (error) {
      await connection.rollback();
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new ProductError('Mã sản phẩm đã tồn tại. Vui lòng thử lại.', 409);
      throw error;
    } finally { connection.release(); }
  }
  async delete(id: string): Promise<void> {
    try {
      const [result] = await this.connection().query<mysql.ResultSetHeader>('DELETE FROM products WHERE id=?', [id]);
      if (!result.affectedRows) throw new ProductError('Không tìm thấy sản phẩm.', 404);
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_ROW_IS_REFERENCED_2') throw new ProductError('Sản phẩm đã có đơn hàng hoặc lịch sử kho. Chuyển sang Ngừng bán để giữ lịch sử.', 409);
      throw error;
    }
  }
}
export const productService = new ProductService();