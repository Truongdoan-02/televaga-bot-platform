import path from 'node:path';
import { storeUpload } from './uploadStore.js';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/uploads');
export const isBroadcastImage = (value: string) => /^\/uploads\/broadcast_[a-f0-9-]{36}\.(jpg|png|webp)$/.test(value);
export function broadcastImagePath(value: string) {
  if (!isBroadcastImage(value)) throw new Error('Ảnh tải lên không hợp lệ.');
  return path.join(directory, path.basename(value));
}
export async function storeBroadcastImage(data: Buffer) {
  if (!Buffer.isBuffer(data) || !data.length || data.length > 10 * 1024 * 1024) throw new Error('Ảnh phải có dung lượng từ 1 byte đến 10 MB.');
  const extension = data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpg'
    : data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  if (!extension) throw new Error('Chọn ảnh JPG, PNG hoặc WebP.');
  const imageUrl = `/uploads/broadcast_${randomUUID()}.${extension}`;
  await storeUpload(imageUrl, data);
  return imageUrl;
}
