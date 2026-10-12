'use client';

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { Message } from '@/types';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';

let globalSocket: Socket | null = null;

function getSocket(): Socket {
  if (!globalSocket || !globalSocket.connected) {
    globalSocket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }
  return globalSocket;
}

interface UseSocketOptions {
  activeChatId?: string | null;
  onNewMessage?: (message: Message) => void;
  onChatActivity?: (data: { chatId: string; lastMessage: Message; timestamp: string }) => void;
  onUserTyping?: (data: { chatId: string; userId: string; isTyping: boolean }) => void;
  onChatMarkedRead?: (data: { chatId: string }) => void;
  onChatStructureChanged?: (data: { parentChatId: string }) => void;
}

export function useSocket({
  activeChatId,
  onNewMessage,
  onChatActivity,
  onUserTyping,
  onChatMarkedRead,
  onChatStructureChanged,
}: UseSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const prevChatIdRef = useRef<string | null>(null);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    const handleNewMessage = (message: Message) => {
      onNewMessage?.(message);
    };
    const handleChatActivity = (data: { chatId: string; lastMessage: Message; timestamp: string }) => {
      onChatActivity?.(data);
    };
    const handleTyping = (data: { chatId: string; userId: string; isTyping: boolean }) => {
      onUserTyping?.(data);
    };
    const handleChatRead = (data: { chatId: string }) => {
      onChatMarkedRead?.(data);
    };
    const handleChatStructureChanged = (data: { parentChatId: string }) => onChatStructureChanged?.(data);

    socket.on('new_message', handleNewMessage);
    socket.on('chat_activity', handleChatActivity);
    socket.on('user_typing', handleTyping);
    socket.on('chat_marked_read', handleChatRead);
    socket.on('chat_structure_changed', handleChatStructureChanged);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('chat_activity', handleChatActivity);
      socket.off('user_typing', handleTyping);
      socket.off('chat_marked_read', handleChatRead);
      socket.off('chat_structure_changed', handleChatStructureChanged);
    };
  }, [onNewMessage, onChatActivity, onUserTyping, onChatMarkedRead, onChatStructureChanged]);

  // Join/leave chat rooms
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    if (prevChatIdRef.current) {
      socket.emit('leave_chat', prevChatIdRef.current);
    }
    if (activeChatId) {
      socket.emit('join_chat', activeChatId);
      prevChatIdRef.current = activeChatId;
    }
  }, [activeChatId]);

  const emitTyping = useCallback((chatId: string, isTyping: boolean, userName?: string) => {
    socketRef.current?.emit('typing', { chatId, isTyping, userName });
  }, []);

  return { emitTyping };
}
