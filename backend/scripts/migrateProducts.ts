import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { migrateProducts } from '../src/services/productService.js';

const envFile = process.argv[2];
if (!envFile) throw new Error('Usage: node --import tsx scripts/migrateProducts.ts .env.cloud');
const env = dotenv.parse(fs.readFileSync(envFile));
const caPath = env.DB_SSL_CA_FILE ? path.resolve(path.dirname(envFile), env.DB_SSL_CA_FILE) : undefined;
const ca = caPath ? fs.readFileSync(caPath, 'utf8') : env.DB_SSL_CA?.replace(/\\n/g, '\n');
const pool = mysql.createPool({
  host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : undefined, connectionLimit: 2,
});
try {
  await migrateProducts(pool);
  const [references] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM order_items WHERE product_id IN (SELECT id FROM products WHERE sku IN ('BNK-DEMO-001','BNK-DEMO-002','BNK-DEMO-003','BNK-DEMO-004','BNK-DEMO-005') AND name LIKE 'BNK Demo %')");
  // Preserve the product name, quantity and price snapshots in historical orders.
  if (Number(references[0].total) > 0) {
    const [columns] = await pool.query<mysql.RowDataPacket[]>("SELECT IS_NULLABLE FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='order_items' AND column_name='product_id'");
    if (columns[0]?.IS_NULLABLE === 'NO') {
      await pool.query('ALTER TABLE order_items DROP FOREIGN KEY fk_item_product');
      await pool.query('ALTER TABLE order_items MODIFY product_id BIGINT UNSIGNED NULL');
      await pool.query('ALTER TABLE order_items ADD CONSTRAINT fk_item_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL');
    }
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [demos] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,sku,name FROM products WHERE sku IN ('BNK-DEMO-001','BNK-DEMO-002','BNK-DEMO-003','BNK-DEMO-004','BNK-DEMO-005') AND name LIKE 'BNK Demo %' FOR UPDATE");
    if (demos.length) {
      const ids = demos.map(row => row.id);
      await connection.query('UPDATE order_items SET product_id=NULL WHERE product_id IN (?)', [ids]);
      const [tables] = await connection.query<mysql.RowDataPacket[]>("SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='purchase_drafts'");
      if (tables.length) await connection.query('DELETE FROM purchase_drafts WHERE product_id IN (?)', [ids]);
      await connection.query('DELETE FROM products WHERE id IN (?)', [ids]);
    }
    await connection.commit();
    console.log('Product and supplier schema upgraded. Removed demo products:', demos.length);
    console.log('Historical order names, quantities and prices preserved.');
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
} finally { await pool.end(); }