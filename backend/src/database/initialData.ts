import { User, Chat, Message } from '../types/index.js';

// New installations start empty; chats and users are created from real Telegram updates.
export const initialUsers: User[] = [];
export const initialChats: Chat[] = [];
export const initialMessages: Record<string, Message[]> = {};
