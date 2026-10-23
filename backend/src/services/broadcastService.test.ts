import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BroadcastService, validateBroadcast } from './broadcastService.js';
import { db } from '../database/connection.js';

const input = { title: 'Sale', content: 'Nội dung', botId: 'bot1', audience: 'all', parseMode: '', imageUrl: '', buttonText: '', buttonUrl: '', scheduledAt: null };
test('validates Telegram limits, URL buttons and future schedules', () => {
  assert.equal(validateBroadcast(input).title, 'Sale');
  assert.throws(() => validateBroadcast({ ...input, imageUrl: 'https://example.com/a.jpg', content: 'x'.repeat(1020) }));
  assert.throws(() => validateBroadcast({ ...input, buttonText: 'Buy' }));
  assert.throws(() => validateBroadcast({ ...input, buttonText: 'Buy', buttonUrl: 'javascript:alert(1)' }));
  assert.throws(() => validateBroadcast({ ...input, scheduledAt: '2020-01-01' }));
});
test('recipient isolation, deduplication, failed sends, scheduling, cancellation and recovery', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vaga-broadcast-test-'));
  const storage = path.join(directory, 'broadcasts.json');
  const originalChats = db.getChats, originalBot = db.getManagedBotById;
  const calls: string[] = [];
  const delivery = async (id: string) => { calls.push(id); if (id === 'two') throw new Error('Bot blocked'); };
  try {
    db.getManagedBotById = async () => ({ id: 'bot1', isEnabled: true, mode: 'polling' } as any);
    db.getChats = async () => [
      { id: 'one', botId: 'bot1', type: 'direct', telegramChatId: '1', title: 'One', category: 'vip', updatedAt: new Date().toISOString() },
      { id: 'duplicate', botId: 'bot1', type: 'direct', telegramChatId: '1', title: 'Duplicate' },
      { id: 'two', botId: 'bot1', type: 'direct', telegramChatId: '2', title: 'Two', category: 'sales', updatedAt: '2020-01-01' },
      { id: 'other', botId: 'bot2', type: 'direct', telegramChatId: '3', title: 'Other bot' },
      { id: 'group', botId: 'bot1', type: 'group', telegramChatId: '-4', title: 'Group', isForum: true },
      { id: 'generalZero', botId: 'bot1', type: 'group', telegramChatId: '-4', messageThreadId: 0, parentChatId: 'group', title: 'General' },
      { id: 'generalOne', botId: 'bot1', type: 'group', telegramChatId: '-4', messageThreadId: 1, parentChatId: 'group', title: 'General' },
      { id: 'topic', botId: 'bot1', type: 'group', telegramChatId: '-4', messageThreadId: 12, parentChatId: 'group', title: 'Topic' },
      { id: 'topicDuplicate', botId: 'bot1', type: 'group', telegramChatId: '-4', messageThreadId: 12, parentChatId: 'group', title: 'Duplicate topic' },
      { id: 'channel', botId: 'bot1', type: 'channel', telegramChatId: '-5', title: 'Channel' },
    ] as any;
    const service = new BroadcastService(storage, delivery, 0); await service.initialize(false);
    assert.deepEqual((await service.recipients('bot1', 'all')).map(r => r.chatId), ['one', 'two']);
    assert.deepEqual((await service.recipients('bot1', 'vip')).map(r => r.chatId), ['one']);
    assert.deepEqual((await service.recipients('bot1', 'everyone')).map(r => r.chatId), ['one', 'two', 'group', 'topic', 'channel']);
    assert.deepEqual((await service.recipients('bot1', 'groups')).map(r => r.chatId), ['group', 'topic', 'channel']);
    const draft = await service.create(input); await service.processQueue(); assert.equal(calls.length, 0);
    await service.action(draft.id, 'send'); await Promise.all([service.processQueue(), service.processQueue()]);
    assert.deepEqual(calls, ['one', 'two']); assert.equal(service.detail(draft.id).status, 'partial');
    assert.equal(service.list()[0].sent, 1); assert.equal(service.list()[0].failed, 1);
    await assert.rejects(() => service.action(draft.id, 'send'));
    const scheduled = await service.create({ ...input, scheduledAt: new Date(Date.now() + 60000).toISOString() });
    await service.processQueue(); assert.equal(calls.length, 2);
    await service.action(scheduled.id, 'cancel'); await service.processQueue(); assert.equal(calls.length, 2);
    const due = await service.create({ ...input, audience: 'vip', scheduledAt: new Date(Date.now() + 60000).toISOString() });
    due.scheduledAt = new Date(Date.now() - 1000).toISOString();
    await service.processQueue(); assert.equal(calls.length, 3); assert.equal(service.detail(due.id).status, 'completed');
    const interrupted = await service.create(input, true);
    interrupted.status = 'sending'; interrupted.recipients[0].status = 'sending';
    fs.writeFileSync(storage, JSON.stringify({ items: [interrupted], maintenance: service.getMaintenance() }));
    const restored = new BroadcastService(storage, delivery, 0); await restored.initialize(false);
    await restored.processQueue();
    assert.equal(restored.detail(interrupted.id).recipients[0].status, 'unknown');
    assert.deepEqual(calls, ['one', 'two', 'one', 'two']);
    await restored.updateMaintenance({ enabled: true, message: 'Bảo trì', notifyStart: false, notifyEnd: false });
    assert.equal(restored.getMaintenance().enabled, true);
    assert.equal(calls.length, 4);
    await restored.updateMaintenance({ enabled: false, message: 'Bảo trì', notifyStart: false, notifyEnd: true, botId: 'bot1' });
    const total = restored.list().length;
    assert.equal(restored.list()[0].audience, 'everyone');
    assert.equal(restored.list()[0].total, 5);
    await restored.updateMaintenance({ enabled: false, message: 'Bảo trì', notifyStart: false, notifyEnd: true, botId: 'bot1' });
    assert.equal(restored.list().length, total, 'repeated maintenance saves do not create duplicate notifications');
  } finally {
    db.getChats = originalChats; db.getManagedBotById = originalBot;
    fs.rmSync(directory, { recursive: true });
  }
});

test('durable storage restores history and maintenance without the local file or resending completed recipients', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vaga-durable-test-'));
  let payload: string | null = null;
  const storage = { load: async () => payload, save: async (value: string) => { payload = value; } };
  const record = { ...input, id: 'saved', createdAt: new Date().toISOString(), status: 'completed', recipients: [{ chatId: 'one', name: 'One', status: 'sent' }] };
  const maintenance = { enabled: true, message: 'Maintenance', notifyStart: false, notifyEnd: false };
  fs.writeFileSync(path.join(directory, 'old.json'), JSON.stringify({ items: [record], maintenance }));
  let calls = 0;
  try {
    const first = new BroadcastService(path.join(directory, 'old.json'), async () => { calls++; }, 0, storage);
    await first.initialize(false);
    assert.ok(payload, 'legacy history migrated into durable storage');
    const restored = new BroadcastService(path.join(directory, 'missing.json'), async () => { calls++; }, 0, storage);
    await restored.initialize(false);
    assert.equal(restored.detail('saved').recipients[0].status, 'sent');
    assert.equal(restored.getMaintenance().enabled, true);
    await restored.processQueue();
    assert.equal(calls, 0);
    const broken = new BroadcastService(path.join(directory, 'missing.json'), async () => {}, 0, { load: async () => { throw new Error('Database unavailable'); }, save: async () => {} });
    await assert.rejects(() => broken.initialize(false), /Database unavailable/);
  } finally {
    fs.unlinkSync(path.join(directory, 'old.json'));
    fs.rmdirSync(directory);
  }
});
