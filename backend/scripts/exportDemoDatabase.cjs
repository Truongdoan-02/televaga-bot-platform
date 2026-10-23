const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const directory = path.resolve(__dirname, '../data/backups');
fs.mkdirSync(directory, { recursive: true });
const filename = path.join(directory, 'mysql-demo-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sql');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'televaga-dump-'));
const options = path.join(temporary, 'client.cnf');
const quote = value => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
const settings = { host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || '3306', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' };
fs.writeFileSync(options, '[client]\n' + Object.entries(settings).map(([key, value]) => key + '=' + quote(value)).join('\n') + '\n', { mode: 0o600 });
const defaultWindows = 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqldump.exe';
const executable = process.env.MYSQLDUMP_PATH || (process.platform === 'win32' && fs.existsSync(defaultWindows) ? defaultWindows : 'mysqldump');
try {
  const result = spawnSync(executable, ['--defaults-extra-file=' + options, '--single-transaction', '--no-tablespaces', '--set-gtid-purged=OFF', '--skip-add-drop-table', '--result-file=' + filename, process.env.DB_NAME || 'televaga_demo'], { stdio: ['ignore', 'ignore', 'pipe'] });
  if (result.error || result.status !== 0) { if (fs.existsSync(filename)) fs.unlinkSync(filename); throw new Error('Database export failed. Check local MySQL and MYSQLDUMP_PATH. No credentials are printed.'); }
  console.log('Database backup created: ' + filename);
  console.log('Contains private data. Keep outside Git. Import only into an empty demo database.');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
