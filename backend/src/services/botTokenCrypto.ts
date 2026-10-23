import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';

const dataDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const keyFile = path.join(dataDirectory, 'bot-token.key');

export interface EncryptedBotToken {
  tokenCiphertext: string;
  tokenIv: string;
  tokenAuthTag: string;
  tokenHint: string;
}

function getEncryptionKey(): Buffer {
  if (config.botTokenEncryptionKey.startsWith('base64:')) {
    const encoded = config.botTokenEncryptionKey.slice(7);
    if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('Invalid base64 bot encryption key');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw new Error('Bot encryption key must be 32 bytes');
    return key;
  }
  if (config.botTokenEncryptionKey) {
    return createHash('sha256').update(config.botTokenEncryptionKey, 'utf8').digest();
  }

  fs.mkdirSync(dataDirectory, { recursive: true });
  if (!fs.existsSync(keyFile)) {
    fs.writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
  }
  const key = fs.readFileSync(keyFile);
  if (key.length !== 32) throw new Error('Bot token encryption key file is invalid');
  return key;
}

export function encryptBotToken(token: string): EncryptedBotToken {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    tokenCiphertext: ciphertext.toString('base64'),
    tokenIv: iv.toString('base64'),
    tokenAuthTag: cipher.getAuthTag().toString('base64'),
    tokenHint: token.length > 4 ? '••••••••' + token.slice(-4) : '••••',
  };
}

export function decryptBotToken(encrypted: Pick<EncryptedBotToken, 'tokenCiphertext' | 'tokenIv' | 'tokenAuthTag'>): string {
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(encrypted.tokenIv, 'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.tokenAuthTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.tokenCiphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
