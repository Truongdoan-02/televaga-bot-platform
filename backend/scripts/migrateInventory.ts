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
  const [beforeColumns] = await pool.query<mysql.RowDataPacket[]>("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='products' AND column_name='stock_quantity'");
  const [before] = await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS total'+(beforeColumns.length?',COALESCE(SUM(stock_quantity),0) AS stock':'')+' FROM products');
  await migrateProducts(pool);
  const [after] = await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS total,COALESCE(SUM(i.stock_quantity),0) AS stock FROM products p JOIN product_inventory i ON i.product_id=p.id');
  if(Number(before[0].total)!==Number(after[0].total)||(beforeColumns.length&&Number(before[0].stock)!==Number(after[0].stock)))throw new Error('Stock verification failed');
  console.log('PASS: stock migrated, product count preserved, products.stock_quantity removed. Products='+after[0].total+', stock='+after[0].stock);
} finally {await pool.end();}