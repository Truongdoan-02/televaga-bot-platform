import { Server as SocketIOServer, Socket } from 'socket.io';
import { Chat, Message, User } from '../types/index.js';

class SocketService {
  private io: SocketIOServer | null = null;

  init(ioServer: SocketIOServer) {
    this.io = ioServer;

    this.io.on('connection', (socket: Socket) => {
      console.log(`[Socket.IO] Client connected: ${socket.id}`);

      // Client joins a specific chat room
      socket.on('join_chat', (chatId: string) => {
        socket.join(`chat_${chatId}`);
        console.log(`[Socket.IO] Socket ${socket.id} joined room chat_${chatId}`);
      });

      // Client leaves a specific chat room
      socket.on('leave_chat', (chatId: string) => {
        socket.leave(`chat_${chatId}`);
      });

      // User typing indicator
      socket.on('typing', ({ chatId, isTyping, userName }: { chatId: string; isTyping: boolean; userName?: string }) => {
        socket.to(`chat_${chatId}`).emit('user_typing', {
          chatId,
          isTyping,
          userName: userName || 'Khách hàng',
        });
      });

      socket.on('disconnect', () => {
        console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
      });
    });
  }

  broadcastNewMessage(chatId: string, message: Message, chatInfo?: Pick<Chat, 'avatarUrl' | 'title'>, sender?: User) {
    if (!this.io) return;
    // Emit to active chat room
    this.io.to(`chat_${chatId}`).emit('new_message', message);
    // Also emit global chat list update so sidebar immediately shows latest message and moves to top
    this.io.emit('chat_activity', {
      chatId,
      lastMessage: message,
      timestamp: message.createdAt,
      avatarUrl: chatInfo?.avatarUrl,
      title: chatInfo?.title,
      sender,
    });
  }

  broadcastTyping(chatId: string, userId: string, isTyping: boolean) {
    if (!this.io) return;
    this.io.to(`chat_${chatId}`).emit('user_typing', {
      chatId,
      userId,
      isTyping,
    });
  }

  broadcastMessageStatusUpdate(chatId: string, messageId: string, status: string) {
    if (!this.io) return;
    this.io.to(`chat_${chatId}`).emit('message_status_updated', {
      chatId,
      messageId,
      status,
    });
  }

  broadcastChatRead(chatId: string) {
    if (!this.io) return;
    this.io.emit('chat_marked_read', { chatId });
  }

  broadcastChatStructureChanged(parentChatId: string) {
    this.io?.emit('chat_structure_changed', { parentChatId });
  }
}

export const socketService = new SocketService();
