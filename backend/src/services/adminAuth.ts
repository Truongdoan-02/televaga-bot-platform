import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type RequestHandler } from 'express';
import { config } from '../config/index.js';

const email = (process.env.ADMIN_EMAIL || 'admin@gmail.com').trim().toLowerCase();
const salt = randomBytes(32);
const passwordHash = scryptSync(process.env.ADMIN_PASSWORD || '123456', salt, 64);
const ttl = 8 * 60 * 60 * 1000;
const sessions = new Map<string, number>();
const attempts = new Map<string, { count: number; expires: number }>();
const cookieName = 'televaga_admin';
const secure = process.env.AUTH_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
const sameSite = process.env.AUTH_COOKIE_SAME_SITE === 'none' ? 'None' : 'Lax';
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
function tokenFromCookie(cookie = ''): string {
  return cookie.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
}
export function adminSession(cookie?: string): string | null {
  const key = digest(tokenFromCookie(cookie));
  const expires = sessions.get(key);
  if (!expires || expires <= Date.now()) { sessions.delete(key); return null; }
  return key;
}
const sweep = setInterval(() => {
  for (const [key, expires] of sessions) if (expires <= Date.now()) sessions.delete(key);
  for (const [key, value] of attempts) if (value.expires <= Date.now()) attempts.delete(key);
}, 60_000);
sweep.unref();
const cookie = (token: string, age: number) => cookieName + '=' + token + '; HttpOnly; Path=/; SameSite=' + sameSite + '; Max-Age=' + age + (secure ? '; Secure' : '');
export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!adminSession(req.headers.cookie)) { res.status(401).json({ success: false, error: 'Vui lòng đăng nhập quản trị.' }); return; }
  next();
};
export const requireTrustedOrigin: RequestHandler = (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('Origin') !== config.clientUrl) {
    res.status(403).json({ success: false, error: 'Nguồn yêu cầu không hợp lệ.' }); return;
  }
  next();
};
export function createAuthRouter(onLogout: (session: string) => void) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/login', (req: Request, res) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let attempt = attempts.get(key);
    if (!attempt || attempt.expires <= Date.now()) { attempt = { count: 0, expires: Date.now() + 15 * 60_000 }; attempts.set(key, attempt); }
    if (attempt.count >= 10) { res.set('Retry-After', String(Math.ceil((attempt.expires - Date.now()) / 1000))); res.status(429).json({ success: false, error: 'Thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.' }); return; }
    attempt.count++;
    const input = typeof req.body?.password === 'string' ? req.body.password : '';
    const inputEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (input.length > 256 || !timingSafeEqual(scryptSync(input, salt, 64), passwordHash) || inputEmail !== email) {
      res.status(401).json({ success: false, error: 'Email hoặc mật khẩu không đúng.' }); return;
    }
    attempts.delete(key);
    const previous = adminSession(req.headers.cookie);
    if (previous) { sessions.delete(previous); onLogout(previous); }
    const token = randomBytes(32).toString('hex');
    sessions.set(digest(token), Date.now() + ttl);
    res.setHeader('Set-Cookie', cookie(token, ttl / 1000));
    res.json({ success: true, data: { email, role: 'admin' } });
  });
  router.get('/me', requireAdmin, (_req, res) => { res.json({ success: true, data: { email, role: 'admin' } }); });
  router.post('/logout', (req, res) => {
    const session = adminSession(req.headers.cookie);
    if (session) { sessions.delete(session); onLogout(session); }
    res.setHeader('Set-Cookie', cookie('', 0));
    res.json({ success: true });
  });
  return router;
}
