import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink } from 'node:fs/promises';
import { storeBroadcastImage, broadcastImagePath, isBroadcastImage } from './broadcastImages.js';
import { validateBroadcast } from './broadcastService.js';

test('uploaded images are saved and invalid formats, sizes and paths are rejected', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=', 'base64');
  const url = await storeBroadcastImage(png);
  try {
    assert.equal(isBroadcastImage(url), true);
    assert.deepEqual(await readFile(broadcastImagePath(url)), png);
    const input = { title: 'Sale', content: 'Content', botId: 'bot', audience: 'all', imageUrl: url };
    assert.equal(validateBroadcast(input).imageUrl, url);
    assert.throws(() => validateBroadcast({ ...input, buttonText: 'Buy', buttonUrl: url }));
    assert.throws(() => broadcastImagePath('/uploads/../../.env'));
    await assert.rejects(storeBroadcastImage(Buffer.from('<script>invalid</script>')));
    await assert.rejects(storeBroadcastImage(Buffer.alloc(10 * 1024 * 1024 + 1)));
  } finally { await unlink(broadcastImagePath(url)); }
});
