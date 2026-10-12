import dotenv from 'dotenv';
// Load environment variables from .env file
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'televaga_demo',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    mode: process.env.TELEGRAM_MODE || 'mock',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
    publicBackendUrl: (process.env.PUBLIC_BACKEND_URL || `http://localhost:${process.env.PORT || '5000'}`).replace(/\/$/, ''),
  },
  botTokenEncryptionKey: process.env.BOT_TOKEN_ENCRYPTION_KEY || '',
  mockMode: process.env.MOCK_MODE
    ? process.env.MOCK_MODE === 'true'
    : process.env.TELEGRAM_MODE !== 'polling',
};
