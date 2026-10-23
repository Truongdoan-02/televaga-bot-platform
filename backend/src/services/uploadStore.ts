import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import type { RequestHandler } from 'express';
import { db } from '../database/connection.js';
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/uploads');
export function uploadFilePath(url: string): string {
  if (!url.startsWith('/uploads/') || /[\\\x00?#]/.test(url)) throw new Error('Invalid upload path');
  const segments = url.slice(9).split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) throw new Error('Invalid upload path');
  const file = path.resolve(directory, ...segments);
  if (!file.startsWith(directory + path.sep)) throw new Error('Invalid upload path');
  return file;
}
export function uploadMime(url: string): string {
  const types: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.txt': 'text/plain', '.zip': 'application/zip' };
  return types[path.extname(url).toLowerCase()] || 'application/octet-stream';
}
export async function storeUpload(url: string, data: Buffer, mimeType = uploadMime(url)): Promise<void> {
  const file = uploadFilePath(url);
  if (!data.length || data.length > 50 * 1024 * 1024) throw new Error('Upload must be between 1 byte and 50 MB');
  await db.saveUploadAsset(url, data, mimeType);
  // Files are a local cache; MySQL remains authoritative on cloud restarts.
  try { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, data); }
  catch (error) { if (!db.isMySQLActive()) throw error; }
}
export async function readUpload(url: string): Promise<{ data: Buffer; mimeType: string } | null> {
  const file = uploadFilePath(url);
  const stored = await db.getUploadAsset(url);
  if (stored) return stored;
  try { return { data: await readFile(file), mimeType: uploadMime(url) }; }
  catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
}
export function uploadRange(header: string, length: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(length - 1, Number(match[2])) : length - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < length && end >= start ? { start, end } : null;
}
export const serveUpload: RequestHandler = async (req, res, next) => {
  try {
    let url: string;
    try { url = '/uploads' + decodeURIComponent(req.path); uploadFilePath(url); }
    catch { res.sendStatus(400); return; }
    const asset = await readUpload(url);
    if (!asset) { res.sendStatus(404); return; }
    res.set({ 'Content-Type': asset.mimeType, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' });
    if (!/^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm))$/.test(asset.mimeType)) res.attachment(path.basename(url));
    const range = req.get('Range');
    if (range) {
      const selected = uploadRange(range, asset.data.length);
      if (!selected) { res.set('Content-Range', 'bytes */' + asset.data.length).sendStatus(416); return; }
      res.status(206).set('Content-Range', 'bytes ' + selected.start + '-' + selected.end + '/' + asset.data.length).send(asset.data.subarray(selected.start, selected.end + 1)); return;
    }
    res.send(asset.data);
  } catch (error) { next(error); }
};
