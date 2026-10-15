import mysql from 'mysql2/promise';
import { config } from '../config/index.js';
import { db } from '../database/connection.js';
export class SupplierError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}
export interface SupplierInput {
  name: string; contactName: string; phone: string; email: string; address: string;
  taxCode: string; bankAccount: string; bankName: string; status: 0 | 1; note: string;
}
export interface Supplier extends SupplierInput { code: string; createdAt: string; updatedAt: string; productPrefix: string }
export function supplierPrefix(name: string): string {
  const words = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'D').toUpperCase().match(/[A-Z0-9]+/g) || [];
  if (words.join('') === 'VAGA') return 'VG';
  const first = words[0] || 'NC', second = words[1];
  return (second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)).padEnd(2, 'X');
}
export function validateSupplier(value: unknown): SupplierInput {
  if (!value || typeof value !== 'object') throw new SupplierError('Dữ liệu nhà cung cấp không hợp lệ.');
  const b = value as Record<string, unknown>;
  const text = (key: string, max: number, required = false) => {
    if (b[key] != null && typeof b[key] !== 'string') throw new SupplierError('Thông tin nhà cung cấp không hợp lệ.');
    const v = ((b[key] as string | undefined) || '').trim();
    if (required && !v) throw new SupplierError('Vui lòng nhập tên nhà cung cấp.');
    if (v.length > max) throw new SupplierError('Thông tin vượt quá độ dài cho phép.');
    return v;
  };
  const name = text('name', 255, true), contactName = text('contactName', 100);
  const rawPhone = text('phone', 20);
  if (rawPhone && !/^\+?[\d ()-]+$/.test(rawPhone)) throw new SupplierError('Số điện thoại không hợp lệ.');
  const phone = rawPhone.replace(/[ ()-]/g, '');
  if (rawPhone && !/^(?:0\d{9,10}|\+84\d{9,10}|\+[1-9]\d{7,14})$/.test(phone)) throw new SupplierError('Số điện thoại phải có 10–11 số bắt đầu bằng 0 hoặc có mã quốc gia (ví dụ +84).');
  const email = text('email', 255).toLowerCase();
  if (email && (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email) || email.includes('..') || email.startsWith('.') || email.split('@')[0].endsWith('.'))) throw new SupplierError('Email không hợp lệ.');
  const taxCode = text('taxCode', 20);
  if (taxCode && !/^(?:\d{10}|\d{13}|\d{10}-\d{3})$/.test(taxCode)) throw new SupplierError('Mã số thuế phải gồm 10 hoặc 13 số (có thể có dấu - trước 3 số cuối).');
  const bankAccount = text('bankAccount', 50);
  if (bankAccount && !/^[A-Za-z0-9][A-Za-z0-9 .-]*$/.test(bankAccount)) throw new SupplierError('Số tài khoản ngân hàng không hợp lệ.');
  if (b.status !== undefined && b.status !== 0 && b.status !== 1) throw new SupplierError('Tình trạng nhà cung cấp không hợp lệ.');
  return { name, contactName, phone, email, address: text('address', 500), taxCode: taxCode.replace('-', ''),
    bankAccount, bankName: text('bankName', 150), status: b.status === 0 ? 0 : 1, note: text('note', 10000) };
}
export async function allocateCode(connection: mysql.PoolConnection, namespace: string, prefix: string, table: 'suppliers' | 'products', column: 'code' | 'sku') {
  await connection.query('INSERT INTO catalog_sequences (namespace, sequence_value) VALUES (?,0) ON DUPLICATE KEY UPDATE sequence_value=sequence_value', [namespace]);
  const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT sequence_value FROM catalog_sequences WHERE namespace=? FOR UPDATE', [namespace]);
  const [existing] = await connection.query<mysql.RowDataPacket[]>('SELECT COALESCE(MAX(CAST(SUBSTRING(??, ?) AS UNSIGNED)),0) AS maximum FROM ?? WHERE ?? REGEXP ?', [column, prefix.length + 1, table, column, '^' + prefix + '[0-9]+$']);
  const next = Math.max(Number(rows[0].sequence_value), Number(existing[0].maximum)) + 1;
  if (!Number.isSafeInteger(next) || (prefix + String(next)).length > 20) throw new SupplierError('Đã hết dải mã tự động.', 409);
  await connection.query('UPDATE catalog_sequences SET sequence_value=? WHERE namespace=?', [next, namespace]);
  return prefix + String(next).padStart(3, '0');
}
export async function migrateSuppliers(pool: mysql.Pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS catalog_sequences (namespace VARCHAR(40) PRIMARY KEY, sequence_value BIGINT UNSIGNED NOT NULL DEFAULT 0)');
  await pool.query("CREATE TABLE IF NOT EXISTS suppliers (code VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PRIMARY KEY, name VARCHAR(255) NOT NULL, contact_name VARCHAR(100) NULL, phone VARCHAR(20) NULL, email VARCHAR(255) NULL, address VARCHAR(500) NULL, tax_code VARCHAR(20) NULL UNIQUE, bank_account VARCHAR(50) NULL, bank_name VARCHAR(150) NULL, status TINYINT NOT NULL DEFAULT 1, note TEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)");
}
export class SupplierService {
  constructor(private pool: mysql.Pool | null = null) {}
  async initialize() {
    if (!db.isMySQLActive()) return;
    const pool = mysql.createPool({ ...config.database, connectionLimit: 3 });
    try { await migrateSuppliers(pool); this.pool = pool; } catch (error) { await pool.end(); throw error; }
  }
  private connection() { if (!this.pool) throw new SupplierError('Quản lý nhà cung cấp cần kết nối MySQL.', 503); return this.pool; }
  private map(row: mysql.RowDataPacket): Supplier {
    const date = (v: unknown) => v instanceof Date ? v.toISOString() : String(v);
    return { code: row.code, name: row.name, contactName: row.contact_name || '', phone: row.phone || '', email: row.email || '',
      address: row.address || '', taxCode: row.tax_code || '', bankAccount: row.bank_account || '', bankName: row.bank_name || '',
      status: Number(row.status) === 1 ? 1 : 0, note: row.note || '', createdAt: date(row.created_at), updatedAt: date(row.updated_at), productPrefix: supplierPrefix(row.name) };
  }
  async nextCode(): Promise<string> {
    const [rows] = await this.connection().query<mysql.RowDataPacket[]>(
      "SELECT GREATEST(COALESCE((SELECT sequence_value FROM catalog_sequences WHERE namespace='suppliers'),0),COALESCE((SELECT MAX(CAST(SUBSTRING(code,4) AS UNSIGNED)) FROM suppliers WHERE code REGEXP '^NCC[0-9]+$'),0)) AS current_value");
    const next = Number(rows[0].current_value) + 1;
    if (!Number.isSafeInteger(next) || ('NCC' + String(next)).length > 20) throw new SupplierError('Đã hết dải mã tự động.', 409);
    return 'NCC' + String(next).padStart(3, '0');
  }
  async list() {
    const [rows] = await this.connection().query<mysql.RowDataPacket[]>('SELECT * FROM suppliers ORDER BY created_at DESC, code DESC');
    return rows.map(row => this.map(row));
  }
  async get(code: string) {
    const [rows] = await this.connection().query<mysql.RowDataPacket[]>('SELECT * FROM suppliers WHERE code=?', [code]);
    if (!rows.length) throw new SupplierError('Không tìm thấy nhà cung cấp.', 404);
    return this.map(rows[0]);
  }
  async save(input: SupplierInput, code?: string) {
    const connection = await this.connection().getConnection();
    try {
      await connection.beginTransaction();
      const values = [input.name, input.contactName || null, input.phone || null, input.email || null, input.address || null,
        input.taxCode || null, input.bankAccount || null, input.bankName || null, input.status, input.note || null];
      if (code) {
        const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT code FROM suppliers WHERE code=? FOR UPDATE', [code]);
        if (!rows.length) throw new SupplierError('Không tìm thấy nhà cung cấp.', 404);
        await connection.query('UPDATE suppliers SET name=?,contact_name=?,phone=?,email=?,address=?,tax_code=?,bank_account=?,bank_name=?,status=?,note=? WHERE code=?', [...values, code]);
      } else {
        code = await allocateCode(connection, 'suppliers', 'NCC', 'suppliers', 'code');
        await connection.query('INSERT INTO suppliers (name,contact_name,phone,email,address,tax_code,bank_account,bank_name,status,note,code) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [...values, code]);
      }
      const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT * FROM suppliers WHERE code=?', [code]);
      await connection.commit(); return this.map(rows[0]);
    } catch (error) {
      await connection.rollback();
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new SupplierError('Mã số thuế đã được dùng bởi nhà cung cấp khác.', 409);
      throw error;
    } finally { connection.release(); }
  }
  async delete(code: string) {
    try {
      const [result] = await this.connection().query<mysql.ResultSetHeader>('DELETE FROM suppliers WHERE code=?', [code]);
      if (!result.affectedRows) throw new SupplierError('Không tìm thấy nhà cung cấp.', 404);
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_ROW_IS_REFERENCED_2') throw new SupplierError('Nhà cung cấp đang có sản phẩm. Chọn Ngừng hợp tác thay vì xóa.', 409);
      throw error;
    }
  }
}
export const supplierService = new SupplierService();