import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as client } from '../../../frontend/node_modules/socket.io-client/build/esm/index.js';
import { adminSession, createAuthRouter, requireAdmin, requireTrustedOrigin } from './adminAuth.ts';
import { config } from '../config/index.ts';

const app = express();
const server = createServer(app);
const sockets = new Server(server);
sockets.use((socket, next) => adminSession(socket.request.headers.cookie) ? next() : next(new Error('Unauthorized')));
app.use('/api', requireTrustedOrigin, express.json());
app.use('/api/auth', createAuthRouter(session => {
  for (const socket of sockets.sockets.sockets.values()) if (adminSession(socket.request.headers.cookie) === null) socket.disconnect(true);
}));
app.get('/api/private', requireAdmin, (_req, res) => res.json({ role: 'admin' }));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let base = 'http://127.0.0.1:' + server.address().port;
let gateway;
let frontend;
if (process.env.TEST_GATEWAY === 'true') {
  const { default: createGateway } = await import('../../../deploy/gateway.cjs');
  frontend = createServer((_req, res) => res.end('frontend-ready'));
  frontend.listen(0, '127.0.0.1'); await once(frontend, 'listening');
  let ready = false;
  gateway = createGateway({ backend: base, frontend: 'http://127.0.0.1:' + frontend.address().port, isReady: () => ready });
  gateway.server.listen(0, '127.0.0.1'); await once(gateway.server, 'listening');
  base = 'http://127.0.0.1:' + gateway.server.address().port;
  assert.equal((await fetch(base + '/health')).status, 503);
  ready = true;
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal(await (await fetch(base + '/login')).text(), 'frontend-ready');
}

const post = (path, body, cookie, origin = config.clientUrl) => fetch(base + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
let socket;
try {
  assert.equal((await fetch(base + '/api/private')).status, 401);
  assert.equal((await post('/api/auth/login', { email: 'admin@gmail.com', password: 'wrong' })).status, 401);
  assert.equal((await post('/api/auth/login', { email: 'admin@gmail.com', password: '123456' }, undefined, 'https://evil.example')).status, 403);
  const login = await post('/api/auth/login', { email: 'admin@gmail.com', password: '123456' });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).data.role, 'admin');
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await fetch(base + '/api/private', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(base + '/api/private', { headers: { Cookie: cookie + 'tampered' } })).status, 401);
  socket = client(base, { transports: ['websocket'], reconnection: false });
  await once(socket, 'connect_error'); socket.disconnect();
  socket = client(base, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false });
  await once(socket, 'connect');
  const disconnected = once(socket, 'disconnect');
  assert.equal((await post('/api/auth/logout', {}, cookie)).status, 200);
  await disconnected;
  assert.equal((await fetch(base + '/api/private', { headers: { Cookie: cookie } })).status, 401);
  for (let i = 0; i < 10; i++) await post('/api/auth/login', { email: 'admin@gmail.com', password: 'wrong' });
  assert.equal((await post('/api/auth/login', { email: 'admin@gmail.com', password: '123456' })).status, 429);
  console.log((gateway ? 'PASS gateway HTTP, readiness, frontend, WebSocket, cookie forwarding; ' : '') + 'PASS: credentials, role, origin, API guard, cookie tampering, socket authentication, logout revocation, rate limit');
} finally { socket?.disconnect(); sockets.close(); server.close(); gateway?.proxy.close(); gateway?.server.close(); frontend?.close(); }
