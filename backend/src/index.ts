import express from 'express';
import { serveUpload } from './services/uploadStore.js';
import { adminSession, createAuthRouter, requireAdmin, requireTrustedOrigin } from './services/adminAuth.js';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { config } from './config/index.js';
import { db } from './database/connection.js';
import { socketService } from './services/socketService.js';
import chatRoutes from './routes/chatRoutes.js';
import userRoutes from './routes/userRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import botRoutes from './routes/botRoutes.js';
import productRoutes from './routes/productRoutes.js';
import supplierRoutes from './routes/supplierRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import shopRoutes from './routes/shopRoutes.js';
import { inventoryService } from './services/inventoryService.js';
import { supplierService } from './services/supplierService.js';
import { productService } from './services/productService.js';
import broadcastRoutes from './routes/broadcastRoutes.js';
import { broadcastService } from './services/broadcastService.js';
import { telegramService } from './services/telegramService.js';
import { bnkDataService } from './services/bnkDataService.js';


async function bootstrap() {
  // Initialize database
  await db.initialize();
  await supplierService.initialize();
  await productService.initialize();
  await inventoryService.initialize();
  try {
    await bnkDataService.initialize();
  } catch (error) {
    if (process.env.BNK_REQUIRED === 'true') throw error;
    console.error('[BNK] Business-data integration is unavailable:', error instanceof Error ? error.message : error);
  }

  const app = express();
  const httpServer = createServer(app);

  // Setup Socket.IO with CORS
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.clientUrl,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const session = adminSession(socket.request.headers.cookie);
    if (!session || socket.handshake.headers.origin !== config.clientUrl) { next(new Error('Unauthorized')); return; }
    socket.data.adminSession = session;
    next();
  });
  io.on('connection', socket => {
    const timer = setInterval(() => {
      if (!adminSession(socket.request.headers.cookie)) socket.disconnect(true);
    }, 10_000);
    socket.use((_packet, next) => {
      if (!adminSession(socket.request.headers.cookie)) { socket.disconnect(true); next(new Error('Unauthorized')); return; }
      next();
    });
    socket.on('disconnect', () => clearInterval(timer));
  });

  // Initialize socket service
  socketService.init(io);

  // Middleware
  app.use(cors({
    origin: config.clientUrl,
    credentials: true,
  }));
  app.use('/api/shop', shopRoutes);
  app.use('/api', requireTrustedOrigin);
  app.use('/api/chats/:chatId/messages/media', requireAdmin, express.raw({ type: () => true, limit: '50mb' }));
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(session => {
    for (const socket of io.sockets.sockets.values()) if (socket.data.adminSession === session) socket.disconnect(true);
  }));
  app.use('/api', requireAdmin);
  app.use('/uploads', serveUpload);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: db.isMySQLActive() ? 'MySQL' : 'Local JSON',
      mockMode: config.telegram.mode === 'mock',
      aiEnabled: Boolean(config.gemini.apiKey),
      telegram: telegramService.getStatus(),
    });
  });

  app.get('/api/telegram/status', (_req, res) => {
    res.json({ success: true, data: telegramService.getStatus() });
  });

  // API Routes
  app.use('/api/chats', chatRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/chats/:chatId/messages', messageRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/bots', botRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/suppliers', supplierRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/broadcasts', broadcastRoutes);
  await broadcastService.initialize();

  // Telegram Webhook endpoint (for real Telegram Bot integration - Stage 3)
  app.post('/webhook/telegram', async (req, res) => {
    try {
      if (config.telegram.webhookSecret && req.get('X-Telegram-Bot-Api-Secret-Token') !== config.telegram.webhookSecret) {
        res.status(401).json({ ok: false, error: 'Invalid Telegram webhook secret' });
        return;
      }
      await telegramService.handleWebhookUpdate(req.body);
      res.json({ ok: true });
    } catch (err: any) {
      console.error('[Webhook] Error handling Telegram update:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Start server
  httpServer.listen(config.port, () => {
    void telegramService.syncManagedBots();
    console.log('\n');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║   🚀  Demo_TeleVaga Backend Started!         ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  HTTP   ➜  http://localhost:${config.port}           ║`);
    console.log(`║  WS     ➜  ws://localhost:${config.port}             ║`);
    console.log(`║  DB     ➜  ${db.isMySQLActive() ? 'MySQL (Connected)     ' : 'Local JSON (Fallback) '}       ║`);
    console.log(`║  AI     ➜  ${config.gemini.apiKey ? 'Gemini API (Live)     ' : 'Mock AI Engine        '}       ║`);
    console.log(`║  Mode   ➜  ${config.telegram.mode.padEnd(21)}       ║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log('\n');
  });
}

bootstrap().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
