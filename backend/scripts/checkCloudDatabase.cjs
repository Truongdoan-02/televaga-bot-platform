const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
const env = dotenv.parse(fs.readFileSync(path.join(root, '.env.cloud')));
async function main() {
  if (!env.DB_PASSWORD) throw new Error('Fill DB_PASSWORD in backend/.env.cloud first.');
  const caPath = path.resolve(root, env.DB_SSL_CA_FILE || 'data/aiven-ca.pem');
  if (!fs.existsSync(caPath)) throw new Error('Download Aiven CA certificate to backend/data/aiven-ca.pem first.');
  const connection = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, connectTimeout: 10000, ssl: { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true } });
  try {
    const [tls] = await connection.query("SHOW STATUS LIKE 'Ssl_cipher'");
    if (!tls[0]?.Value) throw new Error('TLS is required.');
    const [tables] = await connection.query('SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE()');
    const found = new Set(tables.map(row => String(row.TABLE_NAME)));
    const required = ['products','customers','channel_connections','customer_channels','conversations','orders','order_items','support_requests','employees','employee_shifts','bot_buttons','button_events','faq_articles'];
    console.log('PASS: Aiven connection over verified TLS. Table count: ' + tables.length);
    console.log('Missing business tables: ' + (required.filter(name => !found.has(name)).join(', ') || 'none'));
    console.log('Read-only check; no tables or customer data were changed.');
  } finally { await connection.end(); }
}
main().catch(error => {
  console.error(error.code ? 'Cloud database check failed (' + error.code + '). Check host, credentials and CA certificate.' : error.message);
  process.exitCode = 1;
});
