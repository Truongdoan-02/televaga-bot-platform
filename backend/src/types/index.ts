export interface User {
  id: string;
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  phoneNumber?: string;
  avatarUrl?: string;
  bio?: string;
  isBot: boolean;
  isOnline: boolean;
  lastSeen?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedBot {
  id: string;
  name: string;
  token: string;
  telegramBotId?: string;
  username?: string;
  isEnabled: boolean;
  mode: 'polling' | 'webhook' | 'mock';
  status: 'configured' | 'connected' | 'error' | 'disabled';
  lastError?: string;
  actionButtons?: BotActionButton[];
  flowPrompts?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export type BotButtonAction = 'reply' | 'consult' | 'order_lookup' | 'human_support' | 'resolve' | 'url';

export interface BotActionButton {
  id: string;
  label: string;
  action: BotButtonAction;
  responseText?: string;
  url?: string;
  enabled: boolean;
  sortOrder: number;
}

export type ChatType = 'direct' | 'group' | 'channel';
export type ChatCategory = 'all' | 'support' | 'sales' | 'vip' | 'unread';

export interface Chat {
  id: string;
  botId?: string;
  parentChatId?: string;
  parentTitle?: string;
  messageThreadId?: number;
  topicName?: string;
  isForum?: boolean;
  telegramChatId: string;
  type: ChatType;
  title: string;
  avatarUrl?: string;
  category: ChatCategory;
  isPinned: boolean;
  isMuted: boolean;
  unreadCount: number;
  lastMessage?: Message;
  participantIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type MessageType = 'text' | 'image' | 'video' | 'document' | 'audio' | 'system';
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read';

export interface Message {
  entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
  id: string;
  chatId: string;
  senderId: string;
  senderName?: string;
  text: string;
  type: MessageType;
  mediaUrl?: string;
  fileName?: string;
  fileSize?: string;
  isOutgoing: boolean; // true if sent by agent/system, false if from customer
  status: MessageStatus;
  replyToId?: string;
  reactions?: Record<string, string[]>;
  isPinned?: boolean;
  forwardedFrom?: string;
  replyToMessage?: {
    id: string;
    senderName: string;
    text: string;
  };
  createdAt: string;
}

export interface AISummary {
  id: string;
  chatId: string;
  customerGoal: string; // Nhu cầu của khách hàng
  mainQuestions: string[]; // Các câu hỏi / vấn đề nổi bật
  currentStatus: 'Đang giải quyết' | 'Cần báo giá' | 'Chờ khách phản hồi' | 'Hoàn thành'; // Trạng thái xử lý
  recommendedAction: string; // Hành động tiếp theo đề xuất
  sentiment: 'Tích cực' | 'Trung tính' | 'Căng thẳng / Khiếu nại';
  summaryText: string; // Bản tóm tắt đầy đủ
  createdAt: string;
}

export interface AISuggestion {
  tone: 'professional' | 'quick' | 'consultative';
  label: string;
  replyText: string;
  reason: string;
}

export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}
