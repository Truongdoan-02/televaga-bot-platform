import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { User, Chat, Message, AISummary, AISuggestion, ManagedBot, BotActionButton } from '../types/index.js';
import { decryptBotToken, encryptBotToken } from '../services/botTokenCrypto.js';
import { initialUsers, initialChats, initialMessages } from './initialData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const JSON_DB_FILE = path.join(DATA_DIR, 'database.json');

interface DatabaseStore {
  users: User[];
  bots: StoredManagedBot[];
  chats: Chat[];
  messages: Message[];
  summaries: AISummary[];
  suggestions: { chatId: string; suggestions: AISuggestion[]; createdAt: string }[];
}

interface StoredManagedBot {
  id: string;
  name: string;
  tokenCiphertext: string;
  tokenIv: string;
  tokenAuthTag: string;
  tokenHint: string;
  actionButtons?: BotActionButton[];
  flowPrompts?: Record<string, string>;
  telegramBotId?: string;
  username?: string;
  isEnabled: boolean;
  mode: ManagedBot['mode'];
  status: ManagedBot['status'];
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

class DatabaseService {
  private pool: mysql.Pool | null = null;
  private isUsingMySQL = false;
  private localStore: DatabaseStore = {
    users: [],
    bots: [],
    chats: [],
    messages: [],
    summaries: [],
    suggestions: [],
  };

  async initialize(): Promise<void> {
    console.log('[Database] Initializing database service...');

    // Try connecting to MySQL if configured
    try {
      if (config.database.user) {
        console.log(`[Database] Attempting connection to MySQL (${config.database.host}:${config.database.port})...`);
        
        // Connect to server to verify / create DB
        if (process.env.DB_AUTO_CREATE !== 'false') {
        const rootConn = await mysql.createConnection({
          host: config.database.host,
          port: config.database.port,
          user: config.database.user,
          password: config.database.password,
          connectTimeout: 3000,
          ssl: config.database.ssl,
        });

        await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${config.database.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await rootConn.end();
        }

        this.pool = mysql.createPool({
          host: config.database.host,
          port: config.database.port,
          user: config.database.user,
          password: config.database.password,
          database: config.database.database,
          ssl: config.database.ssl,
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
        });

        await this.initMySQLTables();
        this.isUsingMySQL = true;
        await this.purgeDemoData();
        console.log(`[Database]  Connected to MySQL database: "${config.database.database}" successfully!`);
        await this.seedMySQLIfEmpty();
        return;
      }
    } catch (err: any) {
      if (process.env.DB_REQUIRED === 'true') throw err;
      console.warn(`[Database]  MySQL connection unavailable (${err.message}).`);
    }

    if (process.env.DB_REQUIRED === 'true') throw new Error('MySQL is required for this deployment.');

    // Fallback to local persistent JSON DB
    console.log('[Database] ℹ  Falling back to persistent Local JSON Database.');
    this.initLocalStore();
  }

  private async initMySQLTables() {
    if (!this.pool) return;
    const queries = [
      `CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        telegram_id VARCHAR(64) UNIQUE,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100),
        username VARCHAR(100),
        phone_number VARCHAR(30),
        avatar_url TEXT,
        bio TEXT,
        is_bot BOOLEAN DEFAULT FALSE,
        is_online BOOLEAN DEFAULT FALSE,
        last_seen VARCHAR(100),
        created_at VARCHAR(100),
        updated_at VARCHAR(100)
      )`,
      `CREATE TABLE IF NOT EXISTS managed_bots (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        token_ciphertext TEXT NOT NULL,
        token_iv VARCHAR(64) NOT NULL,
        token_auth_tag VARCHAR(64) NOT NULL,
        token_hint VARCHAR(32) NOT NULL,
        action_buttons JSON NULL,
        flow_prompts JSON NULL,
        telegram_bot_id VARCHAR(64),
        username VARCHAR(100),
        is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        mode VARCHAR(20) NOT NULL DEFAULT 'polling',
        status VARCHAR(20) NOT NULL DEFAULT 'configured',
        last_error TEXT,
        created_at VARCHAR(100),
        updated_at VARCHAR(100)
      )`,
      `CREATE TABLE IF NOT EXISTS chats (
        id VARCHAR(64) PRIMARY KEY,
        telegram_chat_id VARCHAR(64),
        bot_id VARCHAR(64) NULL,
        parent_chat_id VARCHAR(64) NULL,
        message_thread_id BIGINT NULL,
        topic_name VARCHAR(255) NULL,
        is_forum BOOLEAN NOT NULL DEFAULT FALSE,
        type VARCHAR(20) DEFAULT 'direct',
        title VARCHAR(255) NOT NULL,
        avatar_url TEXT,
        category VARCHAR(20) DEFAULT 'all',
        is_pinned BOOLEAN DEFAULT FALSE,
        is_muted BOOLEAN DEFAULT FALSE,
        unread_count INT DEFAULT 0,
        participant_ids JSON,
        created_at VARCHAR(100),
        updated_at VARCHAR(100)
      )`,
      `CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(64) PRIMARY KEY,
        chat_id VARCHAR(64) NOT NULL,
        sender_id VARCHAR(64) NOT NULL,
        sender_name VARCHAR(150),
        text TEXT,
        type VARCHAR(20) DEFAULT 'text',
        media_url TEXT,
        file_name VARCHAR(255),
        file_size VARCHAR(50),
        is_outgoing BOOLEAN DEFAULT FALSE,
        status VARCHAR(20) DEFAULT 'sent',
        reply_to_id VARCHAR(64),
        reactions JSON,
        is_pinned BOOLEAN DEFAULT FALSE,
        forwarded_from VARCHAR(150),
        created_at VARCHAR(100)
      )`
    ];

    for (const query of queries) {
      await this.pool.query(query);
    }

    await this.migrateManagedBotsTable();
    await this.migrateChatBotOwnership();

    // Upgrade databases created before message actions were added.
    const messageColumns = [
      ['entities', 'JSON NULL'],
      ['reactions', 'JSON NULL'],
      ['is_pinned', 'BOOLEAN NOT NULL DEFAULT FALSE'],
      ['forwarded_from', 'VARCHAR(150) NULL'],
    ] as const;
    for (const [column, definition] of messageColumns) {
      const [rows]: any = await this.pool.query(
        'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [config.database.database, 'messages', column]
      );
      if (rows.length === 0) {
        await this.pool.query(`ALTER TABLE messages ADD COLUMN ${column} ${definition}`);
      }
    }
    const [actionButtonColumns]: any = await this.pool.query(
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [config.database.database, 'managed_bots', 'action_buttons']
    );
    if (actionButtonColumns.length === 0) await this.pool.query('ALTER TABLE managed_bots ADD COLUMN action_buttons JSON NULL');
  }

  private async migrateManagedBotsTable(): Promise<void> {
    if (!this.pool) return;
    const [columnRows]: any = await this.pool.query(
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [config.database.database, 'managed_bots']
    );
    const columns = new Set<string>(columnRows.map((row: any) => row.COLUMN_NAME));
    const additions: [string, string][] = [
      ['token_ciphertext', 'TEXT NULL'],
      ['token_iv', 'VARCHAR(64) NULL'],
      ['token_auth_tag', 'VARCHAR(64) NULL'],
      ['token_hint', "VARCHAR(32) NOT NULL DEFAULT ''"],
      ['telegram_bot_id', 'VARCHAR(64) NULL'],
      ['username', 'VARCHAR(100) NULL'],
      ['is_enabled', 'BOOLEAN NOT NULL DEFAULT FALSE'],
      ['mode', "VARCHAR(20) NOT NULL DEFAULT 'polling'"],
      ['status', "VARCHAR(20) NOT NULL DEFAULT 'configured'"],
      ['last_error', 'TEXT NULL'],
      ['action_buttons', 'JSON NULL'],
      ['flow_prompts', 'JSON NULL'],
    ];
    for (const [column, definition] of additions) {
      if (!columns.has(column)) await this.pool.query(`ALTER TABLE managed_bots ADD COLUMN ${column} ${definition}`);
    }

    if (columns.has('token')) {
      const [legacyRows]: any = await this.pool.query('SELECT id, token, token_ciphertext FROM managed_bots');
      for (const row of legacyRows) {
        if (typeof row.token !== 'string' || !row.token || row.token_ciphertext) continue;
        const encrypted = encryptBotToken(row.token);
        await this.pool.query(
          'UPDATE managed_bots SET token_ciphertext = ?, token_iv = ?, token_auth_tag = ?, token_hint = ?, token = ? WHERE id = ?',
          [encrypted.tokenCiphertext, encrypted.tokenIv, encrypted.tokenAuthTag, encrypted.tokenHint, '', row.id]
        );
      }
      await this.pool.query('ALTER TABLE managed_bots DROP COLUMN token');
    }
    await this.pool.query('ALTER TABLE managed_bots MODIFY token_ciphertext TEXT NOT NULL, MODIFY token_iv VARCHAR(64) NOT NULL, MODIFY token_auth_tag VARCHAR(64) NOT NULL');
  }

  private async migrateChatBotOwnership(): Promise<void> {
    if (!this.pool) return;
    const [columns]: any = await this.pool.query(
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [config.database.database, 'chats', 'bot_id']
    );
    if (!columns.length) await this.pool.query('ALTER TABLE chats ADD COLUMN bot_id VARCHAR(64) NULL');
    const [indexes]: any = await this.pool.query(
      `SELECT INDEX_NAME, NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'chats' AND COLUMN_NAME = 'telegram_chat_id'`,
      [config.database.database]
    );
    for (const index of indexes) {
      if (index.INDEX_NAME !== 'PRIMARY' && Number(index.NON_UNIQUE) === 0) {
        await this.pool.query(`ALTER TABLE chats DROP INDEX \`${String(index.INDEX_NAME).replace(/`/g, '')}\``);
      }
    }
    const [botIndexes]: any = await this.pool.query(
      'SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?',
      [config.database.database, 'chats', 'idx_chats_bot_updated']
    );
    if (!botIndexes.length) await this.pool.query('CREATE INDEX idx_chats_bot_updated ON chats (bot_id, updated_at)');
    const topicColumns: [string, string][] = [
      ['parent_chat_id', 'VARCHAR(64) NULL'],
      ['message_thread_id', 'BIGINT NULL'],
      ['topic_name', 'VARCHAR(255) NULL'],
      ['is_forum', 'BOOLEAN NOT NULL DEFAULT FALSE'],
    ];
    for (const [column, definition] of topicColumns) {
      const [rows]: any = await this.pool.query(
        'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [config.database.database, 'chats', column]
      );
      if (!rows.length) await this.pool.query(`ALTER TABLE chats ADD COLUMN ${column} ${definition}`);
    }
  }

  private async seedMySQLIfEmpty() {
    if (!this.pool) return;
    const [rows]: any = await this.pool.query('SELECT COUNT(*) as count FROM users');
    if (rows[0].count === 0) {
      console.log('[Database] Seeding initial data into MySQL...');
      for (const u of initialUsers) {
        await this.pool.query(
          `INSERT INTO users (id, telegram_id, first_name, last_name, username, phone_number, avatar_url, bio, is_bot, is_online, last_seen, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [u.id, u.telegramId, u.firstName, u.lastName || null, u.username || null, u.phoneNumber || null, u.avatarUrl || null, u.bio || null, u.isBot, u.isOnline, u.lastSeen || null, u.createdAt, u.updatedAt]
        );
      }

      for (const c of initialChats) {
        await this.pool.query(
          `INSERT INTO chats (id, telegram_chat_id, type, title, avatar_url, category, is_pinned, is_muted, unread_count, participant_ids, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [c.id, c.telegramChatId, c.type, c.title, c.avatarUrl || null, c.category, c.isPinned, c.isMuted, c.unreadCount, JSON.stringify(c.participantIds), c.createdAt, c.updatedAt]
        );
      }

      for (const [chatId, msgs] of Object.entries(initialMessages)) {
        for (const m of msgs) {
          await this.pool.query(
            `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, type, media_url, is_outgoing, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [m.id, m.chatId, m.senderId, m.senderName || null, m.text, m.type, m.mediaUrl || null, m.isOutgoing, m.status, m.createdAt]
          );
        }
      }
      console.log('[Database] Seeded initial MySQL data successfully.');
    }
  }

  private readonly demoChatIds = ['chat_hung_techvn', 'chat_maitran_crm', 'chat_quan_devops', 'chat_vip_support_group', 'chat_ha_marketing'];
  private readonly demoUserIds = ['user_agent_me', 'user_hung_techvn', 'user_maitran_crm', 'user_quan_devops', 'user_ha_marketing'];

  private purgeLocalDemoData(): void {
    const chatIds = new Set(this.demoChatIds);
    const userIds = new Set(this.demoUserIds);
    this.localStore.chats = this.localStore.chats.filter((chat) => !chatIds.has(chat.id));
    this.localStore.messages = this.localStore.messages.filter((message) => !chatIds.has(message.chatId));
    this.localStore.users = this.localStore.users.filter((user) => !userIds.has(user.id));
    this.localStore.summaries = this.localStore.summaries.filter((summary) => !chatIds.has(summary.chatId));
    this.localStore.suggestions = this.localStore.suggestions.filter((item) => !chatIds.has(item.chatId));
    this.persistLocalStore();
  }

  private async purgeDemoData(): Promise<void> {
    if (!this.pool) return;
    const chats = this.demoChatIds;
    const users = this.demoUserIds;
    const marks = (ids: string[]) => ids.map(() => '?').join(', ');
    await this.pool.query('DELETE FROM messages WHERE chat_id IN (' + marks(chats) + ')', chats);
    await this.pool.query('DELETE FROM chats WHERE id IN (' + marks(chats) + ')', chats);
    await this.pool.query('DELETE FROM users WHERE id IN (' + marks(users) + ')', users);
  }

  private initLocalStore() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(JSON_DB_FILE)) {
      try {
        const raw = fs.readFileSync(JSON_DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        const bots: StoredManagedBot[] = (parsed.bots || []).map((bot: any) => {
          const { token: legacyToken, ...metadata } = bot;
          const encrypted = bot.tokenCiphertext && bot.tokenIv && bot.tokenAuthTag
            ? { tokenCiphertext: bot.tokenCiphertext, tokenIv: bot.tokenIv, tokenAuthTag: bot.tokenAuthTag, tokenHint: bot.tokenHint || '••••' }
            : encryptBotToken(typeof legacyToken === 'string' ? legacyToken : '');
          return {
            ...metadata,
            ...encrypted,
            isEnabled: Boolean(bot.isEnabled),
            mode: bot.mode || 'polling',
            status: bot.status || 'configured',
          };
        });
        this.localStore = { ...parsed, bots };
        this.purgeLocalDemoData();
        console.log(`[Database] Loaded ${this.localStore.chats.length} chats from local JSON file.`);
        return;
      } catch (e) {
        console.error('[Database] Failed to read JSON db file, creating new seed:', e);
      }
    }

    // Populate with default seed data
    const allMsgs: Message[] = [];
    Object.values(initialMessages).forEach((list) => allMsgs.push(...list));

    this.localStore = {
      users: [...initialUsers],
      bots: [],
      chats: [...initialChats],
      messages: allMsgs,
      summaries: [],
      suggestions: [],
    };
    this.persistLocalStore();
    console.log('[Database] Initialized new persistent local database.');
  }

  private persistLocalStore() {
    try {
      fs.writeFileSync(JSON_DB_FILE, JSON.stringify(this.localStore, null, 2), 'utf-8');
    } catch (e) {
      console.error('[Database] Error saving local store:', e);
    }
  }

  // --- API METHODS ---

  private toManagedBot(bot: StoredManagedBot): ManagedBot {
    const { tokenCiphertext, tokenIv, tokenAuthTag, ...metadata } = bot;
    return {
      ...metadata,
      token: decryptBotToken({ tokenCiphertext, tokenIv, tokenAuthTag }),
      isEnabled: Boolean(bot.isEnabled),
      mode: bot.mode || 'polling',
      status: bot.status || 'configured',
    };
  }

  private toStoredManagedBot(bot: ManagedBot): StoredManagedBot {
    const { token, ...metadata } = bot;
    return { ...metadata, ...encryptBotToken(token) };
  }

  async getManagedBots(): Promise<ManagedBot[]> {
    if (this.isUsingMySQL && this.pool) {
      const [rows]: any = await this.pool.query('SELECT * FROM managed_bots ORDER BY updated_at DESC');
      return rows.map((row: any) => this.toManagedBot({
        id: row.id,
        name: row.name,
        tokenCiphertext: row.token_ciphertext,
        tokenIv: row.token_iv,
        tokenAuthTag: row.token_auth_tag,
        tokenHint: row.token_hint,
        actionButtons: row.action_buttons
          ? (typeof row.action_buttons === 'string' ? JSON.parse(row.action_buttons) : row.action_buttons)
          : [],
        flowPrompts: row.flow_prompts
          ? (typeof row.flow_prompts === 'string' ? JSON.parse(row.flow_prompts) : row.flow_prompts)
          : {},
        telegramBotId: row.telegram_bot_id || undefined,
        username: row.username || undefined,
        isEnabled: Boolean(row.is_enabled),
        mode: row.mode || 'polling',
        status: row.status || 'configured',
        lastError: row.last_error || undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    }
    return [...(this.localStore.bots || [])]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((bot) => this.toManagedBot(bot));
  }

  async assignUnownedTelegramChatsToBot(botId: string): Promise<void> {
    if (this.isUsingMySQL && this.pool) {
      await this.pool.query("UPDATE chats SET bot_id = ? WHERE bot_id IS NULL AND telegram_chat_id NOT LIKE 'mock_%'", [botId]);
      return;
    }
    let changed = false;
    for (const chat of this.localStore.chats) {
      if (!chat.botId && !chat.telegramChatId.startsWith('mock_')) {
        chat.botId = botId;
        changed = true;
      }
    }
    if (changed) this.persistLocalStore();
  }

  async getManagedBotById(id: string): Promise<ManagedBot | null> {
    return (await this.getManagedBots()).find((bot) => bot.id === id) || null;
  }

  async createManagedBot(name: string, token: string): Promise<ManagedBot> {
    const now = new Date().toISOString();
    const bot: ManagedBot = {
      id: 'bot_' + randomUUID(), name, token, isEnabled: false, mode: 'polling', status: 'configured',
      createdAt: now, updatedAt: now,
    };
    const stored = this.toStoredManagedBot(bot);
    if (this.isUsingMySQL && this.pool) {
      await this.pool.query(
        'INSERT INTO managed_bots (id, name, token_ciphertext, token_iv, token_auth_tag, token_hint, telegram_bot_id, username, is_enabled, mode, status, last_error, created_at, updated_at, action_buttons, flow_prompts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [stored.id, stored.name, stored.tokenCiphertext, stored.tokenIv, stored.tokenAuthTag, stored.tokenHint, null, null, false, stored.mode, stored.status, null, stored.createdAt, stored.updatedAt, JSON.stringify(stored.actionButtons || []), JSON.stringify(stored.flowPrompts || {})]
      );
    } else {
      this.localStore.bots = [...(this.localStore.bots || []), stored];
      this.persistLocalStore();
    }
    return bot;
  }

  async updateManagedBot(id: string, name: string, token?: string, metadata: Partial<Pick<ManagedBot, 'telegramBotId' | 'username' | 'isEnabled' | 'status' | 'lastError'>> = {}): Promise<ManagedBot | null> {
    const existing = (await this.getManagedBots()).find((bot) => bot.id === id);
    if (!existing) return null;
    const updated: ManagedBot = { ...existing, ...metadata, name, token: token?.trim() || existing.token, updatedAt: new Date().toISOString() };
    const stored = this.toStoredManagedBot(updated);
    if (this.isUsingMySQL && this.pool) {
      await this.pool.query(
        'UPDATE managed_bots SET name = ?, token_ciphertext = ?, token_iv = ?, token_auth_tag = ?, token_hint = ?, telegram_bot_id = ?, username = ?, is_enabled = ?, status = ?, last_error = ?, updated_at = ?, action_buttons = ?, flow_prompts = ? WHERE id = ?',
        [stored.name, stored.tokenCiphertext, stored.tokenIv, stored.tokenAuthTag, stored.tokenHint, updated.telegramBotId || null, updated.username || null, updated.isEnabled, updated.status, updated.lastError || null, stored.updatedAt, JSON.stringify(stored.actionButtons || []), JSON.stringify(stored.flowPrompts || {}), id]
      );
    } else {
      this.localStore.bots = (this.localStore.bots || []).map((bot) => bot.id === id ? stored : bot);
      this.persistLocalStore();
    }
    return updated;
  }

  async updateManagedBotFlowPrompts(id: string, flowPrompts: Record<string, string>): Promise<Record<string, string> | null> {
    const bot = (await this.getManagedBots()).find((item) => item.id === id);
    if (!bot) return null;
    const updated = { ...bot, flowPrompts, updatedAt: new Date().toISOString() };
    const stored = this.toStoredManagedBot(updated);
    if (this.isUsingMySQL && this.pool) {
      await this.pool.query('UPDATE managed_bots SET flow_prompts = ?, updated_at = ? WHERE id = ?', [JSON.stringify(flowPrompts), updated.updatedAt, id]);
    } else {
      this.localStore.bots = (this.localStore.bots || []).map((item) => item.id === id ? stored : item);
      this.persistLocalStore();
    }
    return flowPrompts;
  }

  async updateManagedBotActionButtons(id: string, actionButtons: BotActionButton[]): Promise<BotActionButton[] | null> {
    const bot = (await this.getManagedBots()).find((item) => item.id === id);
    if (!bot) return null;
    const updated = { ...bot, actionButtons, updatedAt: new Date().toISOString() };
    const stored = this.toStoredManagedBot(updated);
    if (this.isUsingMySQL && this.pool) {
      await this.pool.query('UPDATE managed_bots SET action_buttons = ?, updated_at = ? WHERE id = ?', [JSON.stringify(actionButtons), updated.updatedAt, id]);
    } else {
      this.localStore.bots = (this.localStore.bots || []).map((item) => item.id === id ? stored : item);
      this.persistLocalStore();
    }
    return actionButtons;
  }

  async getUsers(): Promise<User[]> {
    if (this.isUsingMySQL && this.pool) {
      const [rows]: any = await this.pool.query('SELECT * FROM users');
      return rows.map((r: any) => ({
        id: r.id,
        telegramId: r.telegram_id,
        firstName: r.first_name,
        lastName: r.last_name,
        username: r.username,
        phoneNumber: r.phone_number,
        avatarUrl: r.avatar_url,
        bio: r.bio,
        isBot: Boolean(r.is_bot),
        isOnline: Boolean(r.is_online),
        lastSeen: r.last_seen,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    }
    return this.localStore.users;
  }

  async getUserById(id: string): Promise<User | null> {
    if (this.isUsingMySQL && this.pool) {
      const [rows]: any = await this.pool.query('SELECT * FROM users WHERE id = ?', [id]);
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        id: r.id,
        telegramId: r.telegram_id,
        firstName: r.first_name,
        lastName: r.last_name,
        username: r.username,
        phoneNumber: r.phone_number,
        avatarUrl: r.avatar_url,
        bio: r.bio,
        isBot: Boolean(r.is_bot),
        isOnline: Boolean(r.is_online),
        lastSeen: r.last_seen,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    }
    return this.localStore.users.find((u) => u.id === id) || null;
  }

  async getUserByTelegramId(telegramId: string): Promise<User | null> {
    if (this.isUsingMySQL && this.pool) {
      const [rows]: any = await this.pool.query('SELECT * FROM users WHERE telegram_id = ? LIMIT 1', [telegramId]);
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id,
        telegramId: r.telegram_id,
        firstName: r.first_name,
        lastName: r.last_name || undefined,
        username: r.username || undefined,
        phoneNumber: r.phone_number || undefined,
        avatarUrl: r.avatar_url || undefined,
        bio: r.bio || undefined,
        isBot: Boolean(r.is_bot),
        isOnline: Boolean(r.is_online),
        lastSeen: r.last_seen || undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    }
    return this.localStore.users.find((user) => user.telegramId === telegramId) || null;
  }

  async upsertTelegramUser(user: User): Promise<User> {
    const existing = await this.getUserByTelegramId(user.telegramId);
    const saved: User = existing ? { ...existing, ...user, id: existing.id, createdAt: existing.createdAt } : user;
    if (this.isUsingMySQL && this.pool) {
      await this.pool.query(
        `INSERT INTO users (id, telegram_id, first_name, last_name, username, phone_number, avatar_url, bio, is_bot, is_online, last_seen, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE first_name = VALUES(first_name), last_name = VALUES(last_name), username = VALUES(username), avatar_url = COALESCE(VALUES(avatar_url), avatar_url), is_bot = VALUES(is_bot), is_online = VALUES(is_online), updated_at = VALUES(updated_at)`,
        [saved.id, saved.telegramId, saved.firstName, saved.lastName || null, saved.username || null, saved.phoneNumber || null, saved.avatarUrl || null, saved.bio || null, saved.isBot, saved.isOnline, saved.lastSeen || null, saved.createdAt, saved.updatedAt]
      );
    } else {
      const index = this.localStore.users.findIndex((item) => item.id === saved.id || item.telegramId === saved.telegramId);
      if (index >= 0) this.localStore.users[index] = saved;
      else this.localStore.users.push(saved);
      this.persistLocalStore();
    }
    return saved;
  }

  async upsertTelegramChat(chat: Chat): Promise<Chat> {
    const existing = (await this.getChats(undefined, undefined, chat.botId ?? null)).find((item) =>
      item.telegramChatId === chat.telegramChatId && (chat.parentChatId
        ? item.parentChatId === chat.parentChatId && item.messageThreadId === chat.messageThreadId
        : !item.parentChatId)
    );
    const saved: Chat = existing
      ? { ...existing, ...chat, id: existing.id, participantIds: [...new Set([...existing.participantIds, ...chat.participantIds])] }
      : chat;
    if (this.isUsingMySQL && this.pool) {
      await this.pool.query(
        `INSERT INTO chats (id, telegram_chat_id, bot_id, parent_chat_id, message_thread_id, topic_name, is_forum, type, title, avatar_url, category, is_pinned, is_muted, unread_count, participant_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE parent_chat_id = VALUES(parent_chat_id), message_thread_id = VALUES(message_thread_id), topic_name = VALUES(topic_name), is_forum = VALUES(is_forum), type = VALUES(type), title = VALUES(title), avatar_url = COALESCE(VALUES(avatar_url), avatar_url), participant_ids = VALUES(participant_ids), updated_at = VALUES(updated_at)`,
        [saved.id, saved.telegramChatId, saved.botId || null, saved.parentChatId || null, saved.messageThreadId ?? null, saved.topicName || null, Boolean(saved.isForum), saved.type, saved.title, saved.avatarUrl || null, saved.category, saved.isPinned, saved.isMuted, saved.unreadCount, JSON.stringify(saved.participantIds), saved.createdAt, saved.updatedAt]
      );
    } else {
      const index = this.localStore.chats.findIndex((item) => item.id === saved.id || (
        item.telegramChatId === saved.telegramChatId && item.botId === saved.botId &&
        (saved.parentChatId ? item.parentChatId === saved.parentChatId && item.messageThreadId === saved.messageThreadId : !item.parentChatId)
      ));
      if (index >= 0) this.localStore.chats[index] = saved;
      else this.localStore.chats.push(saved);
      this.persistLocalStore();
    }
    return saved;
  }

  async upsertTelegramTopic(parent: Chat, threadId: number, topicName: string, timestamp: string): Promise<Chat> {
    const key = createHash('sha256').update(`${parent.botId || 'legacy'}:${parent.telegramChatId}:${threadId}`).digest('hex').slice(0, 24);
    return this.upsertTelegramChat({
      id: `chat_topic_${key}`,
      botId: parent.botId,
      parentChatId: parent.id,
      messageThreadId: threadId,
      topicName,
      telegramChatId: parent.telegramChatId,
      type: 'group',
      title: topicName,
      avatarUrl: parent.avatarUrl,
      category: parent.category,
      isPinned: false,
      isMuted: parent.isMuted,
      unreadCount: 0,
      participantIds: parent.participantIds,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async getChats(category?: string, search?: string, botId?: string | null): Promise<Chat[]> {
    let list: Chat[] = [];
    if (this.isUsingMySQL && this.pool) {
      const [rows]: any = await this.pool.query('SELECT * FROM chats ORDER BY is_pinned DESC, updated_at DESC');
      list = rows.map((r: any) => ({
        id: r.id,
        botId: r.bot_id || undefined,
        parentChatId: r.parent_chat_id || undefined,
        messageThreadId: r.message_thread_id === null || r.message_thread_id === undefined ? undefined : Number(r.message_thread_id),
        topicName: r.topic_name || undefined,
        isForum: Boolean(r.is_forum),
        telegramChatId: r.telegram_chat_id,
        type: r.type,
        title: r.title,
        avatarUrl: r.avatar_url,
        category: r.category,
        isPinned: Boolean(r.is_pinned),
        isMuted: Boolean(r.is_muted),
        unreadCount: r.unread_count,
        participantIds: typeof r.participant_ids === 'string' ? JSON.parse(r.participant_ids) : r.participant_ids || [],
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    } else {
      list = [...this.localStore.chats].sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }

    if (botId !== undefined) list = list.filter((chat) => (chat.botId || null) === botId);

    // Attach last message for each chat
    for (const chat of list) {
      const msgs = await this.getMessages(chat.id);
      if (msgs.length > 0) {
        chat.lastMessage = msgs[msgs.length - 1];
      }
    }

    // Filter by category
    if (category && category !== 'all') {
      if (category === 'unread') {
        const unreadTopicParents = new Set(list.filter((chat) => chat.parentChatId && chat.unreadCount > 0).map((chat) => chat.parentChatId!));
        list = list.filter((chat) => chat.unreadCount > 0 || unreadTopicParents.has(chat.id));
      } else {
        list = list.filter((c) => c.category === category);
      }
    }

    // Filter by search query
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.lastMessage && c.lastMessage.text.toLowerCase().includes(q))
      );
    }

    return list;
  }

  async getChatById(id: string): Promise<Chat | null> {
    const chats = await this.getChats();
    return chats.find((c) => c.id === id) || null;
  }

  async getMessages(chatId: string): Promise<Message[]> {
    if (this.isUsingMySQL && this.pool) {
      const [rows]: any = await this.pool.query('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC', [chatId]);
      return rows.map((r: any) => ({
        id: r.id,
        chatId: r.chat_id,
        senderId: r.sender_id,
        senderName: r.sender_name,
        text: r.text,
        entities: typeof r.entities === 'string' ? JSON.parse(r.entities) : (r.entities || undefined),
        type: r.type,
        mediaUrl: r.media_url,
        fileName: r.file_name,
        fileSize: r.file_size,
        isOutgoing: Boolean(r.is_outgoing),
        status: r.status,
        replyToId: r.reply_to_id,
        reactions: typeof r.reactions === 'string' ? JSON.parse(r.reactions) : (r.reactions || {}),
        isPinned: Boolean(r.is_pinned),
        forwardedFrom: r.forwarded_from || undefined,
        createdAt: r.created_at,
      }));
    }
    return this.localStore.messages
      .filter((m) => m.chatId === chatId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async addMessage(msg: Message): Promise<Message> {
    if (this.isUsingMySQL && this.pool) {
      await this.pool.query(
        `INSERT INTO messages (id, chat_id, sender_id, sender_name, text, type, media_url, file_name, file_size, is_outgoing, status, reply_to_id, reactions, is_pinned, forwarded_from, created_at, entities)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [msg.id, msg.chatId, msg.senderId, msg.senderName || null, msg.text, msg.type, msg.mediaUrl || null, msg.fileName || null, msg.fileSize || null, msg.isOutgoing, msg.status, msg.replyToId || null, JSON.stringify(msg.reactions || {}), Boolean(msg.isPinned), msg.forwardedFrom || null, msg.createdAt, JSON.stringify(msg.entities || [])]
      );
      // Update chat's updated_at and unread_count
      const unreadIncrement = msg.isOutgoing ? 0 : 1;
      await this.pool.query(
        `UPDATE chats SET updated_at = ?, unread_count = unread_count + ? WHERE id = ?`,
        [msg.createdAt, unreadIncrement, msg.chatId]
      );
    } else {
      this.localStore.messages.push(msg);
      const chatIndex = this.localStore.chats.findIndex((c) => c.id === msg.chatId);
      if (chatIndex !== -1) {
        this.localStore.chats[chatIndex].updatedAt = msg.createdAt;
        if (!msg.isOutgoing) {
          this.localStore.chats[chatIndex].unreadCount += 1;
        }
      }
      this.persistLocalStore();
    }
    return msg;
  }

  async markMessagesAsRead(chatId: string): Promise<void> {
    if (this.isUsingMySQL && this.pool) {
      await this.pool.query(`UPDATE messages SET status = 'read' WHERE chat_id = ? AND is_outgoing = FALSE`, [chatId]);
      await this.pool.query(`UPDATE chats SET unread_count = 0 WHERE id = ?`, [chatId]);
    } else {
      this.localStore.messages.forEach((m) => {
        if (m.chatId === chatId && !m.isOutgoing) {
          m.status = 'read';
        }
      });
      const chat = this.localStore.chats.find((c) => c.id === chatId);
      if (chat) chat.unreadCount = 0;
      this.persistLocalStore();
    }
  }

  async getMessageById(chatId: string, messageId: string): Promise<Message | null> {
    const messages = await this.getMessages(chatId);
    return messages.find((message) => message.id === messageId) || null;
  }

  async updateMessage(chatId: string, messageId: string, updates: Pick<Message, 'reactions' | 'isPinned'>): Promise<Message | null> {
    const message = await this.getMessageById(chatId, messageId);
    if (!message) return null;
    Object.assign(message, updates);
    if (this.isUsingMySQL && this.pool) {
      await this.pool.query(
        'UPDATE messages SET reactions = ?, is_pinned = ? WHERE id = ? AND chat_id = ?',
        [JSON.stringify(message.reactions || {}), Boolean(message.isPinned), messageId, chatId]
      );
    } else {
      const index = this.localStore.messages.findIndex((item) => item.id === messageId && item.chatId === chatId);
      if (index !== -1) this.localStore.messages[index] = message;
      this.persistLocalStore();
    }
    return message;
  }

  async deleteMessage(chatId: string, messageId: string): Promise<boolean> {
    const message = await this.getMessageById(chatId, messageId);
    if (!message) return false;
    if (this.isUsingMySQL && this.pool) {
      await this.pool.query('DELETE FROM messages WHERE id = ? AND chat_id = ?', [messageId, chatId]);
    } else {
      this.localStore.messages = this.localStore.messages.filter((item) => item.id !== messageId || item.chatId !== chatId);
      this.persistLocalStore();
    }
    return true;
  }

  async createGroupChat(title: string, memberIds: string[]): Promise<Chat> {
    const id = 'chat_group_' + randomUUID();
    const chat: Chat = {
      id,
      telegramChatId: 'mock_group_' + id,
      type: 'group',
      title,
      category: 'all',
      isPinned: false,
      isMuted: false,
      unreadCount: 0,
      participantIds: [...new Set(['user_agent_me', ...memberIds])],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (this.isUsingMySQL && this.pool) {
      await this.pool.query(
        'INSERT INTO chats (id, telegram_chat_id, type, title, avatar_url, category, is_pinned, is_muted, unread_count, participant_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [chat.id, chat.telegramChatId, chat.type, chat.title, null, chat.category, false, false, 0, JSON.stringify(chat.participantIds), chat.createdAt, chat.updatedAt]
      );
    } else {
      this.localStore.chats.push(chat);
      this.persistLocalStore();
    }
    return chat;
  }

  async openDirectChat(user: User, botId?: string): Promise<Chat> {
    const participants = ['user_agent_me', user.id].sort();
    const existing = (await this.getChats(undefined, undefined, botId ?? null)).find((chat) =>
      chat.type === 'direct' && chat.participantIds.length === participants.length &&
      participants.every((id) => chat.participantIds.includes(id))
    );
    if (existing) return existing;

    const botKey = botId ? createHash('sha1').update(botId).digest('hex').slice(0, 10) + '_' : '';
    const id = 'chat_direct_' + botKey + randomUUID();
    const chat: Chat = {
      id,
      botId,
      telegramChatId: botId ? user.telegramId : 'mock_direct_' + id,
      type: 'direct',
      title: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username || 'Người dùng',
      avatarUrl: user.avatarUrl,
      category: 'all',
      isPinned: false,
      isMuted: false,
      unreadCount: 0,
      participantIds: participants,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (this.isUsingMySQL && this.pool) {
      await this.pool.query(
        'INSERT INTO chats (id, telegram_chat_id, bot_id, type, title, avatar_url, category, is_pinned, is_muted, unread_count, participant_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [chat.id, chat.telegramChatId, chat.botId || null, chat.type, chat.title, chat.avatarUrl || null, chat.category, false, false, 0, JSON.stringify(chat.participantIds), chat.createdAt, chat.updatedAt]
      );
    } else {
      this.localStore.chats.push(chat);
      this.persistLocalStore();
    }
    return chat;
  }

  async deleteChat(id: string): Promise<boolean> {
    const chat = await this.getChatById(id);
    if (!chat) return false;
    if (this.isUsingMySQL && this.pool) {
      await this.pool.query('DELETE FROM messages WHERE chat_id = ?', [id]);
      await this.pool.query('DELETE FROM chats WHERE id = ?', [id]);
      this.localStore.summaries = this.localStore.summaries.filter((item) => item.chatId !== id);
      this.localStore.suggestions = this.localStore.suggestions.filter((item) => item.chatId !== id);
    } else {
      this.localStore.chats = this.localStore.chats.filter((item) => item.id !== id);
      this.localStore.messages = this.localStore.messages.filter((item) => item.chatId !== id);
      this.localStore.summaries = this.localStore.summaries.filter((item) => item.chatId !== id);
      this.localStore.suggestions = this.localStore.suggestions.filter((item) => item.chatId !== id);
      this.persistLocalStore();
    }
    return true;
  }

  async updateChat(id: string, updates: Partial<Chat>): Promise<Chat | null> {
    if (this.isUsingMySQL && this.pool) {
      const keys = Object.keys(updates);
      if (keys.length > 0) {
        const setClauses: string[] = [];
        const values: any[] = [];
        if (updates.title !== undefined) { setClauses.push('title = ?'); values.push(updates.title); }
        if (updates.isPinned !== undefined) { setClauses.push('is_pinned = ?'); values.push(updates.isPinned); }
        if (updates.isMuted !== undefined) { setClauses.push('is_muted = ?'); values.push(updates.isMuted); }
        if (updates.category !== undefined) { setClauses.push('category = ?'); values.push(updates.category); }
        if (updates.unreadCount !== undefined) { setClauses.push('unread_count = ?'); values.push(updates.unreadCount); }
        if (updates.participantIds !== undefined) { setClauses.push('participant_ids = ?'); values.push(JSON.stringify(updates.participantIds)); }
        values.push(id);
        if (setClauses.length > 0) {
          await this.pool.query(`UPDATE chats SET ${setClauses.join(', ')} WHERE id = ?`, values);
        }
      }
    } else {
      const chat = this.localStore.chats.find((c) => c.id === id);
      if (chat) {
        Object.assign(chat, updates);
        this.persistLocalStore();
      }
    }
    return this.getChatById(id);
  }

  // AI results are cached in memory with MySQL; no AI tables are required.
  async saveAISummary(summary: AISummary): Promise<void> {
    const idx = this.localStore.summaries.findIndex((s) => s.chatId === summary.chatId);
    if (idx !== -1) this.localStore.summaries[idx] = summary;
    else this.localStore.summaries.push(summary);
    if (!this.isUsingMySQL) this.persistLocalStore();
  }

  async getAISummary(chatId: string): Promise<AISummary | null> {
    return this.localStore.summaries.find((s) => s.chatId === chatId) || null;
  }

  async saveAISuggestions(chatId: string, suggestions: AISuggestion[]): Promise<void> {
    const item = { chatId, suggestions, createdAt: new Date().toISOString() };
    const idx = this.localStore.suggestions.findIndex((s) => s.chatId === chatId);
    if (idx !== -1) this.localStore.suggestions[idx] = item;
    else this.localStore.suggestions.push(item);
    if (!this.isUsingMySQL) this.persistLocalStore();
  }

  async getAISuggestions(chatId: string): Promise<AISuggestion[] | null> {
    return this.localStore.suggestions.find((s) => s.chatId === chatId)?.suggestions || null;
  }

  isMySQLActive(): boolean {
    return this.isUsingMySQL;
  }
}

export const db = new DatabaseService();
