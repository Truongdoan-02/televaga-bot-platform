const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
const env = dotenv.parse(fs.readFileSync(path.join(root, '.env.cloud')));
async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) throw new Error('Provide a SQL backup file.');
  if (!env.DB_PASSWORD) throw new Error('Cloud DB_PASSWORD is missing.');
  const ca = path.resolve(root, env.DB_SSL_CA_FILE || 'data/aiven-ca.pem');
  const connection = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, connectTimeout: 10000, ssl: { ca: fs.readFileSync(ca, 'utf8'), rejectUnauthorized: true } });
  let temporary;
  try {
    const [tables] = await connection.query('SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE()');
    if (tables.length) throw new Error('Target database is not empty. Import refused.');
    const quote = value => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'televaga-import-'));
    const options = path.join(temporary, 'client.cnf');
    const settings = { host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD };
    fs.writeFileSync(options, '[client]\n' + Object.entries(settings).map(([key, value]) => key + '=' + quote(value)).join('\n') + '\n', { mode: 0o600 });
    const windowsClient = 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe';
    const executable = process.env.MYSQL_CLIENT_PATH || (process.platform === 'win32' && fs.existsSync(windowsClient) ? windowsClient : 'mysql');
    // Managed MySQL uses the importing account for views instead of local root definers.
    const sanitized = path.join(temporary, 'import.sql');
    const source = fs.readFileSync(file, 'utf8').replace(/^([ \t]*\/\*!\d{5}\s+)DEFINER=\x60[^\x60]+\x60@\x60[^\x60]+\x60\s*/gm, '$1');
    fs.writeFileSync(sanitized, source, { mode: 0o600 });
    const input = fs.openSync(sanitized, 'r');
    let result;
    try { result = spawnSync(executable, ['--defaults-extra-file=' + options, '--ssl-mode=VERIFY_IDENTITY', '--ssl-ca=' + ca, '--default-character-set=utf8mb4', '--binary-mode=1', env.DB_NAME], { stdio: [input, 'ignore', 'pipe'], maxBuffer: 1024 * 1024 }); }
    finally { fs.closeSync(input); }
    if (result.error || result.status !== 0) {
      const error = String(result.stderr || '').match(/ERROR \d+[^\n]*/)?.[0] || result.error?.code || 'unknown';
      throw new Error('Import failed: ' + error + '. Do not rerun over partially imported data.');
    }
    const [botTables] = await connection.query("SHOW TABLES LIKE 'managed_bots'");
    if (botTables.length) await connection.query('UPDATE managed_bots SET is_enabled = 0');
    for (const table of ['products','customers','orders','order_items','chats','messages','managed_bots']) {
      const [rows] = await connection.query('SELECT COUNT(*) AS count FROM ' + mysql.escapeId(table));
      console.log(table + ': ' + rows[0].count + ' rows');
    }
    console.log('PASS: SQL imported. Cloud managed bots disabled to avoid duplicate polling.');
  } finally {
    await connection.end();
    if (temporary && path.dirname(temporary) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith('televaga-import-')) fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
