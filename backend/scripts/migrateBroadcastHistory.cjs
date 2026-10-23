const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
async function main() {
  const env = dotenv.parse(fs.readFileSync(path.join(root, '.env.cloud')));
  const runtime = dotenv.parse(fs.readFileSync(path.join(root, 'data/backups/render.env')));
  const origin = 'https://televaga-demo.onrender.com';
  const login = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ email: runtime.ADMIN_EMAIL || 'admin@gmail.com', password: runtime.ADMIN_PASSWORD }), signal: AbortSignal.timeout(60000) });
  if (!login.ok) throw new Error('Login HTTP ' + login.status);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('No session cookie');
  const headers = { Cookie: cookie, Origin: origin };
  const response = await fetch(origin + '/api/broadcasts', { headers });
  if (!response.ok) throw new Error('History HTTP ' + response.status);
  const result = await response.json();
  const items = [];
  for (const summary of result.data.items) {
    const r = await fetch(origin + '/api/broadcasts/' + encodeURIComponent(summary.id), { headers });
    if (!r.ok) throw new Error('Detail HTTP ' + r.status);
    items.push((await r.json()).data);
  }
  // Do not migrate while delivery is in progress; a captured snapshot could resend recipients.
  if (items.some(i => ['queued', 'sending'].includes(i.status) || i.recipients.some(r => r.status === 'sending'))) throw new Error('Wait for active broadcasts to finish before migration.');
  const payload = JSON.stringify({ items, maintenance: result.data.maintenance });
  const backup = path.join(root, 'data/backups/broadcast-history-' + Date.now() + '.json');
  fs.writeFileSync(backup, payload, { mode: 0o600 });
  const connection = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, ssl: { ca: fs.readFileSync(path.resolve(root, env.DB_SSL_CA_FILE || 'data/aiven-ca.pem'), 'utf8'), rejectUnauthorized: true } });
  try {
    await connection.query('CREATE TABLE IF NOT EXISTS broadcast_state (id TINYINT PRIMARY KEY, payload LONGTEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)');
    const [rows] = await connection.query('SELECT id FROM broadcast_state WHERE id = 1');
    if (rows.length) throw new Error('Durable history already exists; refusing to overwrite it. Backup captured.');
    await connection.query('INSERT INTO broadcast_state (id, payload) VALUES (1, ?)', [payload]);
    const [saved] = await connection.query('SELECT payload FROM broadcast_state WHERE id = 1');
    if (saved[0].payload !== payload) throw new Error('Verification failed');
    console.log(JSON.stringify({ migratedBroadcasts: items.length, recipients: items.reduce((n, i) => n + i.recipients.length, 0), verified: true }));
  } finally { await connection.end(); await fetch(origin + '/api/auth/logout', { method: 'POST', headers }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
