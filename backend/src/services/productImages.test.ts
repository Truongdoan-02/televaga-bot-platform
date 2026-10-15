import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { unlink } from 'node:fs/promises';
import productRoutes from '../routes/productRoutes.js';
import { db } from '../database/connection.js';
import { uploadFilePath } from './uploadStore.js';
import { isProductImage } from './broadcastImages.js';
import { validateProduct } from './productService.js';

test('product image upload accepts image bytes, persists assets, validates paths and rejects invalid/oversized files', async () => {
  const original = db.saveUploadAsset;
  const saved: { url: string; data: Buffer }[] = [];
  db.saveUploadAsset = async (url, data) => { saved.push({ url, data }); };
  const app = express();
  app.use(express.json());
  app.use('/api/products', productRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server');
  const endpoint = 'http://127.0.0.1:' + address.port + '/api/products/images';
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=', 'base64');
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
    assert.equal(response.status, 201);
    const result = await response.json() as { data: { imageUrl: string } };
    assert.equal(isProductImage(result.data.imageUrl), true);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].data, png);
    const input = { name: 'Ảnh sản phẩm', supplierCode: 'NCC001', quantity: '200 ml', price: 1, status: 'in_stock', description: '', imageUrl: result.data.imageUrl };
    assert.equal(validateProduct(input).imageUrl, result.data.imageUrl);
    for (const imageUrl of ['/uploads/../secret.png', '/uploads/product_invalid.png', 'file:///tmp/a.png', 'javascript:alert(1)']) assert.throws(() => validateProduct({ ...input, imageUrl }));
    const invalid = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: '<script>not an image</script>' });
    assert.equal(invalid.status, 400);
    const empty = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(0) });
    assert.equal(empty.status, 400);
    const oversized = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.alloc(10 * 1024 * 1024 + 1) });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json() as { success: boolean }).success, false);
    assert.equal(saved.length, 1);
  } finally {
    db.saveUploadAsset = original;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const item of saved) await unlink(uploadFilePath(item.url)).catch(() => {});
  }
});