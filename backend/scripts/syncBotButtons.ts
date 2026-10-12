import mysql from 'mysql2/promise';
import { mkdir, writeFile } from 'node:fs/promises';
import { config } from '../src/config/index.js';
import { CUSTOMER_MENU } from '../src/services/customerMenu.js';

const connection = await mysql.createConnection(config.database);
try {
  const [schema] = await connection.query('SHOW CREATE TABLE bot_buttons');
  const [rows] = await connection.query('SELECT * FROM bot_buttons');
  await mkdir('data/backups', { recursive: true });
  const backup = `data/backups/bot_buttons_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(backup, JSON.stringify({ schema, rows }, null, 2), { flag: 'wx' });
  console.log(`Backup: ${backup}`);
  const [columns] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT COLUMN_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'bot_buttons' AND column_name = 'action_code'"
  );
  const current = String(columns[0]?.COLUMN_TYPE || '');
  if (!/^enum\(/i.test(current)) throw new Error('Unexpected bot_buttons.action_code schema');
  const missing = ['PURCHASE_HISTORY', 'OPEN_WEBSITE', 'PHONE_SUPPORT'].filter(code => !current.includes(`'${code}'`));
  if (missing.length) {
    const expanded = current.slice(0, -1) + ',' + missing.map(code => `'${code}'`).join(',') + ')';
    await connection.query(`ALTER TABLE bot_buttons MODIFY COLUMN action_code ${expanded} NOT NULL`);
  }
  await connection.beginTransaction();
  try {
    for (const button of CUSTOMER_MENU) {
      await connection.query(
        `INSERT INTO bot_buttons (button_code, label, action_code, response_text, sort_order, is_active)
         VALUES (?, ?, ?, NULL, ?, 1)
         ON DUPLICATE KEY UPDATE label = VALUES(label), action_code = VALUES(action_code),
           response_text = NULL, sort_order = VALUES(sort_order), is_active = 1`,
        [button.code, button.label, button.actionCode, button.sortOrder]
      );
    }
    // Preserve old rows and event references, but remove obsolete menu actions.
    await connection.query("UPDATE bot_buttons SET is_active = 0 WHERE button_code IN ('GUIDE', 'AGENT')");
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  const [updated] = await connection.query('SELECT id, button_code, label, action_code, sort_order, is_active FROM bot_buttons ORDER BY sort_order, id');
  console.log(JSON.stringify(updated, null, 2));
} finally { await connection.end(); }
