'use client';

import { assetUrl } from '@/lib/assets';

import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AdminLogoutButton } from './AdminGate';
import { Chat, ManagedBot } from '@/types';
import { getMessageContent } from './MessageText';
import { Bell, ArrowLeft, Bot, Search, UsersRound, MessageSquare, Pin, VolumeX, Trash2, ChevronDown, Check, Hash, Megaphone, MoreVertical, Sparkles } from 'lucide-react';

interface ChatListProps {
  chats: Chat[];
  managedBots: ManagedBot[];
  selectedBotId: string;
  onBotChange: (botId: string) => void;
  activeSection: 'chats' | 'bots' | 'notifications';
  onSectionChange: (section: 'chats' | 'bots' | 'notifications') => void;
  activeChatId: string | null;
  category: string;
  searchQuery: string;
  loading: boolean;
  onChatSelect: (chatId: string) => void;
  onCategoryChange: (cat: string) => void;
  onSearchChange: (q: string) => void;
  onChatAction: (chat: Chat, action: 'pin' | 'mute' | 'delete') => void;
  onCreateGroup: () => void;
  onOpenForum: (chat: Chat) => void;
  forumGroup?: Chat | null;
  forumTopics?: Chat[];
  forumTopicsLoading?: boolean;
  onCloseTopics?: () => void;
  onSelectTopic?: (chatId: string) => void;
  onCreateTopic?: (chatId: string) => void;
  compact?: boolean;
}

const CATEGORIES = [
  { key: 'all', label: '💬 Tất cả' },
  { key: 'support', label: '🛠 Hỗ trợ' },
  { key: 'sales', label: '💼 Sales' },
  { key: 'vip', label: '⭐ VIP' },
  { key: 'unread', label: '🔵 Chưa đọc' },
];

const AVATAR_COLORS = [
  '#4f81c7', '#43a89f', '#c05c7e', '#7c62b5', '#e07654', '#6ab04c', '#7f8c8d',
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(title: string): string {
  const words = title.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Hôm qua';
  } else if (diffDays < 7) {
    return d.toLocaleDateString('vi-VN', { weekday: 'short' });
  }
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

function ChatItemSkeleton() {
  return (
    <div className="chat-item" style={{ cursor: 'default' }}>
      <div className="skeleton" style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0 }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="skeleton" style={{ height: 14, width: '60%', borderRadius: 4 }} />
        <div className="skeleton" style={{ height: 12, width: '85%', borderRadius: 4 }} />
      </div>
    </div>
  );
}

interface ChatItemProps {
  chat: Chat;
  isActive: boolean;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  compact?: boolean;
}

const ChatItem = React.memo(function ChatItem({ chat, isActive, onClick, onContextMenu, compact = false }: ChatItemProps) {
  const initials = getInitials(chat.title);
  const color = getAvatarColor(chat.title);
  const timeStr = chat.lastMessage
    ? formatTime(chat.lastMessage.createdAt)
    : formatTime(chat.updatedAt);

  const lastMsgText = useMemo(() => {
    if (!chat.lastMessage) return 'Chưa có tin nhắn';
    const prefix = chat.lastMessage.isOutgoing ? 'Bạn: ' : '';
    return prefix + getMessageContent(chat.lastMessage).text;
  }, [chat.lastMessage]);

  return (
    <div
      className={`chat-item${isActive ? ' active' : ''}${compact ? ' compact' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={compact ? chat.title : undefined}
      style={compact ? { justifyContent: 'center', gap: 0, minHeight: 64, padding: '8px 10px' } : undefined}
    >
      <div className="avatar">
        {chat.topicName ? (
          <div className="avatar-placeholder" style={{ background: '#46566b' }}>#</div>
        ) : chat.avatarUrl ? (
          <img className="avatar-img" src={assetUrl(chat.avatarUrl)} alt={chat.title} />
        ) : (
          <div className="avatar-placeholder" style={{ background: color }}>
            {chat.type === 'group' ? '👥' : initials}
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 1, right: 1 }}>
        </div>
        {compact && chat.unreadCount > 0 && <span style={{ position: 'absolute', right: -4, bottom: -3, minWidth: 19, height: 19, padding: '0 4px', display: 'grid', placeItems: 'center', borderRadius: 10, background: 'var(--tg-accent)', color: '#fff', fontSize: 10, fontWeight: 700 }}>{chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span>}
      </div>

      {!compact && <div className="chat-item-content">
        <div className="chat-item-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}>
            {chat.isPinned && (
              <Pin size={11} style={{ color: '#a78bfa', flexShrink: 0 }} />
            )}
            {chat.isMuted && (
              <VolumeX size={11} style={{ color: 'var(--tg-text-muted)', flexShrink: 0 }} />
            )}
            <span className="chat-item-name">{chat.title}</span>
          </div>
          <span className="chat-item-time">{timeStr}</span>
        </div>

        <div className="chat-item-preview">
          <span className={`chat-item-last-msg${chat.lastMessage?.isOutgoing ? ' outgoing' : ''}`}>
            {lastMsgText}
          </span>
          {chat.unreadCount > 0 && (
            <span className="unread-badge">{chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span>
          )}
        </div>
      </div>}
    </div>
  );
});

export default function ChatList({
  chats,
  managedBots,
  selectedBotId,
  onBotChange,
  activeSection,
  onSectionChange,
  activeChatId,
  category,
  searchQuery,
  loading,
  onChatSelect,
  onCategoryChange,
  onSearchChange,
  onChatAction,
  onCreateGroup,
  onOpenForum,
  forumGroup = null,
  forumTopics = [],
  forumTopicsLoading = false,
  onCloseTopics,
  onSelectTopic,
  onCreateTopic,
  compact = false,
}: ChatListProps) {
  const [contextMenu, setContextMenu] = React.useState<{ chat: Chat; x: number; y: number } | null>(null);
  const [botMenuOpen, setBotMenuOpen] = React.useState(false);
  const enabledBots = managedBots.filter((bot) => bot.isEnabled);
  const selectedBot = enabledBots.find((bot) => bot.id === selectedBotId);

  const openContextMenu = (event: React.MouseEvent, chat: Chat) => {
    event.preventDefault();
    setContextMenu({ chat, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 220)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 155)) });
  };

  const runChatAction = (action: 'pin' | 'mute' | 'delete') => {
    if (!contextMenu) return;
    const chat = contextMenu.chat;
    setContextMenu(null);
    if (action === 'delete' && !window.confirm('Xóa cuộc hội thoại “' + chat.title + '” cùng toàn bộ tin nhắn?')) return;
    onChatAction(chat, action);
  };

  const renderChat = (chat: Chat) => (
    <div key={chat.id}>
      <ChatItem
        chat={chat}
        isActive={chat.id === activeChatId}
        onClick={() => {
          if (!chat.parentChatId && chat.type === 'group') {
            onOpenForum(chat);
            return;
          }
          onChatSelect(chat.id);
        }}
        onContextMenu={(event) => openContextMenu(event, chat)}
      />
    </div>
  );

  if (compact) {
    return (
      <aside className="sidebar compact" aria-label="Các cuộc hội thoại" style={{ width: 88, minWidth: 88, flex: '0 0 88px', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--tg-bg-secondary)', borderRight: '1px solid var(--tg-border)' }}>
        <div className="chat-list" style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {loading ? Array.from({ length: 5 }).map((_, i) => <ChatItemSkeleton key={i} />) : chats.filter((chat) => !chat.parentChatId).map((chat) => {
            const isActive = chat.id === activeChatId || chats.some((item) => item.id === activeChatId && item.parentChatId === chat.id);
            return <div key={chat.id} style={{ borderLeft: isActive ? '3px solid var(--tg-accent)' : '3px solid transparent' }}>
              <ChatItem chat={chat} isActive={isActive} compact onClick={() => chat.type === 'group' ? onOpenForum(chat) : onChatSelect(chat.id)} onContextMenu={(event) => openContextMenu(event, chat)} />
            </div>;
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="section-switch" role="tablist" aria-label="Khu vực làm việc" style={{ display: 'flex', flexShrink: 0, gap: 5, margin: '10px 12px 0', padding: 4, border: '1px solid var(--tg-border)', borderRadius: 12, background: 'var(--tg-bg-tertiary)' }}>
        <button type="button" role="tab" aria-selected={activeSection === 'bots'} className={activeSection === 'bots' ? 'active' : ''} onClick={() => { setContextMenu(null); onSectionChange('bots'); }} style={{ display: 'flex', flex: 1, minWidth: 0, height: 34, alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 8px', border: 0, borderRadius: 9, background: activeSection === 'bots' ? 'var(--tg-bg-active)' : 'transparent', color: activeSection === 'bots' ? '#a9c9f0' : 'var(--tg-text-secondary)', font: 'inherit', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }}><Bot size={16} /> Quản lý bot</button>
        <button type="button" role="tab" aria-selected={activeSection === 'chats'} className={activeSection === 'chats' ? 'active' : ''} onClick={() => { setContextMenu(null); onSectionChange('chats'); }} style={{ display: 'flex', flex: 1, minWidth: 0, height: 34, alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 8px', border: 0, borderRadius: 9, background: activeSection === 'chats' ? 'var(--tg-bg-active)' : 'transparent', color: activeSection === 'chats' ? '#a9c9f0' : 'var(--tg-text-secondary)', font: 'inherit', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }}><MessageSquare size={16} /> Chat</button>
        <button type="button" role="tab" aria-selected={activeSection === 'notifications'} className={activeSection === 'notifications' ? 'active' : ''} onClick={() => { setContextMenu(null); onSectionChange('notifications'); }} style={{ display: 'flex', flex: 1, minWidth: 0, height: 34, alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 8px', border: 0, borderRadius: 9, background: activeSection === 'notifications' ? 'var(--tg-bg-active)' : 'transparent', color: activeSection === 'notifications' ? '#a9c9f0' : 'var(--tg-text-secondary)', font: 'inherit', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }}><Bell size={16} /> Thông báo</button>
      </div>
      {activeSection === 'chats' ? <>
      {/* Header */}
      <div className="sidebar-header">
        <div className="search-bar">
          <Search size={15} style={{ color: 'var(--tg-text-muted)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Tìm kiếm hội thoại..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <button
          className="icon-btn"
          title="Tạo Nhóm"
          onClick={onCreateGroup}
          style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--tg-accent-light)', color: 'var(--tg-accent)' }}
        >
          <UsersRound size={18} />
        </button>
      </div>

      {/* Category Tabs */}
      <div className="category-tabs">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            className={`category-tab${category === cat.key ? ' active' : ''}`}
            onClick={() => onCategoryChange(cat.key)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {forumGroup ? <>
        <div className="sidebar-forum-heading" style={{ minHeight: 64, flex: '0 0 64px', display: 'flex', alignItems: 'center', gap: 9, padding: '0 12px', borderBottom: '1px solid var(--tg-border)', boxSizing: 'border-box' }}>
          <div className="sidebar-forum-avatar" style={{ width: 38, height: 38, flex: '0 0 38px', overflow: 'hidden', display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'var(--tg-bg-active)', fontSize: 19 }}>
            {forumGroup.avatarUrl ? <img src={assetUrl(forumGroup.avatarUrl)} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} /> : <span>👥</span>}
          </div>
          <button type="button" className="icon-btn" title="Quay lại danh sách hội thoại" onClick={onCloseTopics} style={{ width: 30, height: 30, flex: '0 0 30px' }}><ArrowLeft size={18} /></button>
          <div className="sidebar-forum-title" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}><strong style={{ overflow: 'hidden', fontSize: 14, fontWeight: 650, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{forumGroup.title}</strong><span style={{ color: 'var(--tg-text-muted)', fontSize: 11 }}>{forumTopics.length} topic</span></div>
          {forumGroup.isForum && <button type="button" className="icon-btn" title="Tạo topic" onClick={() => onCreateTopic?.(forumGroup.id)}><MoreVertical size={17} /></button>}
        </div>
        <div className="sidebar-forum-topics" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 8px 12px', overscrollBehavior: 'contain', boxSizing: 'border-box' }}>
          {forumTopicsLoading ? Array.from({ length: 3 }).map((_, i) => <ChatItemSkeleton key={i} />) : forumTopics.length ? forumTopics.map((topic) => {
            const name = topic.topicName || topic.title;
            const lowerName = name.toLocaleLowerCase();
            const TopicIcon = /sale|bán hàng/.test(lowerName) ? Megaphone : /ai|marketing/.test(lowerName) ? Sparkles : Hash;
            const time = topic.lastMessage ? formatTime(topic.lastMessage.createdAt) : (topic.topicName === 'General' ? 'Hôm qua' : formatTime(topic.updatedAt));
            const preview = topic.lastMessage
              ? `${topic.lastMessage.isOutgoing ? 'Bạn: ' : ''}${getMessageContent(topic.lastMessage).text || 'Đã gửi tệp'}`
              : 'Chưa có tin nhắn';
            const isActive = topic.id === activeChatId;
            return <button type="button" key={topic.id} className={`sidebar-forum-topic${isActive ? ' active' : ''}`} onClick={() => onSelectTopic?.(topic.id)} style={{ width: '100%', minHeight: 64, display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px', border: 0, borderRadius: 11, background: isActive ? 'var(--tg-bg-active)' : 'transparent', color: 'var(--tg-text-primary)', textAlign: 'left', cursor: 'pointer', boxSizing: 'border-box' }}>
              <span className="sidebar-forum-topic-icon" style={{ width: 36, height: 36, flex: '0 0 36px', display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'var(--tg-accent-light)', color: 'var(--tg-accent)' }}><TopicIcon size={17} /></span>
              <span className="sidebar-forum-topic-copy" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}><span className="sidebar-forum-topic-title" style={{ overflow: 'hidden', fontSize: 12, fontWeight: 650, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span><span className="sidebar-forum-topic-preview" style={{ overflow: 'hidden', color: 'var(--tg-text-muted)', fontSize: 10, lineHeight: 1.35, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview}</span></span>
              <span className="sidebar-forum-topic-meta" style={{ alignSelf: 'stretch', display: 'flex', flex: '0 0 auto', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'flex-start', gap: 8, paddingTop: 2 }}><time style={{ color: 'var(--tg-text-muted)', fontSize: 9, whiteSpace: 'nowrap' }}>{time}</time>{topic.unreadCount > 0 && <span className="unread-badge">{topic.unreadCount > 99 ? '99+' : topic.unreadCount}</span>}</span>
            </button>;
          }) : <div className="empty-state" style={{ padding: '28px 16px' }}><p style={{ fontSize: 12, color: 'var(--tg-text-muted)', textAlign: 'center' }}>Nhóm chưa có topic nào</p></div>}
        </div>
      </> : <div className="chat-list">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <ChatItemSkeleton key={i} />)
        ) : chats.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px 20px' }}>
            <MessageSquare size={36} style={{ color: 'var(--tg-text-muted)' }} />
            <p style={{ fontSize: 13, color: 'var(--tg-text-muted)', textAlign: 'center' }}>
              {searchQuery ? 'Không tìm thấy hội thoại phù hợp' : 'Chưa có hội thoại nào'}
            </p>
          </div>
        ) : (
          chats.filter((chat) => !chat.parentChatId).map((chat) => renderChat(chat))
        )}
      </div>}
      </> : <div className="bot-sidebar-hint">{activeSection === 'notifications' ? <Bell size={25} /> : <Bot size={25} />}<strong>{activeSection === 'notifications' ? 'Thông báo' : 'Quản lý bot'}</strong><span>{activeSection === 'notifications' ? 'Thông báo hệ thống' : 'Danh sách bot và cấu hình token'}</span></div>}

      {contextMenu && createPortal(
        <div onClick={() => setContextMenu(null)} onContextMenu={(event) => { event.preventDefault(); setContextMenu(null); }} style={{ position: 'fixed', inset: 0, zIndex: 10000 }}>
          <div onClick={(event) => event.stopPropagation()} style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, width: 220, padding: 6, border: '1px solid #374151', borderRadius: 12, background: '#202b38', boxShadow: '0 12px 32px rgba(0,0,0,.45)' }}>
            <button style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', border: 0, borderRadius: 8, background: 'transparent', color: '#e8eef5', textAlign: 'left', cursor: 'pointer' }} onClick={() => runChatAction('pin')}><Pin size={17} /> {contextMenu.chat.isPinned ? 'Unpin from Top' : 'Pin to Top'}</button>
            <button style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', border: 0, borderRadius: 8, background: 'transparent', color: '#e8eef5', textAlign: 'left', cursor: 'pointer' }} onClick={() => runChatAction('mute')}><VolumeX size={17} /> {contextMenu.chat.isMuted ? 'Unmute' : 'Mute...'}</button>
            <button style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', border: 0, borderRadius: 8, background: 'transparent', color: '#ff6b6b', textAlign: 'left', cursor: 'pointer' }} onClick={() => runChatAction('delete')}><Trash2 size={17} /> Delete Chat</button>
          </div>
        </div>,
        document.body
      )}

      {activeSection === 'chats' && <div style={{ position: 'relative', padding: '10px 14px 0', flexShrink: 0 }}>
        {botMenuOpen && <>
          <button type="button" aria-label="Đóng danh sách bot" onClick={() => setBotMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50, border: 0, padding: 0, background: 'transparent' }} />
          <div role="listbox" aria-label="Chọn bot để xem hội thoại" style={{ position: 'absolute', zIndex: 51, left: 14, right: 14, bottom: 'calc(100% + 6px)', maxHeight: 'min(50vh, 280px)', overflowY: 'auto', padding: 5, border: '1px solid var(--tg-border)', borderRadius: 12, background: 'var(--tg-bg-secondary, #232e3c)', boxShadow: '0 10px 28px rgba(0,0,0,.4)', boxSizing: 'border-box' }}>
            {enabledBots.length ? enabledBots.map((bot) => ({ id: bot.id, label: bot.name + (bot.username ? ` · @${bot.username}` : '') })).map((option) => (
              <button key={option.id || 'all'} type="button" role="option" aria-selected={selectedBotId === option.id} onClick={() => { onBotChange(option.id); setBotMenuOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0, minHeight: 38, padding: '0 9px', border: 0, borderRadius: 8, background: selectedBotId === option.id ? 'var(--tg-bg-active, #30465c)' : 'transparent', color: 'var(--tg-text-primary)', textAlign: 'left', font: 'inherit', fontSize: 12, cursor: 'pointer' }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.label}</span>
                {selectedBotId === option.id && <Check size={15} style={{ flexShrink: 0, color: 'var(--tg-accent)' }} />}
              </button>
            )) : <div style={{ padding: '10px 9px', color: 'var(--tg-text-muted)', fontSize: 12 }}>Chưa có bot đang bật</div>}
          </div>
        </>}
        <button type="button" aria-label="Chọn bot để xem hội thoại" aria-haspopup="listbox" aria-expanded={botMenuOpen} onClick={() => setBotMenuOpen((open) => !open)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', minWidth: 0, minHeight: 40, padding: '0 11px', border: '1px solid var(--tg-border)', borderRadius: 10, background: 'var(--tg-bg-tertiary)', color: 'var(--tg-text-primary)', textAlign: 'left', font: 'inherit', fontSize: 12, cursor: 'pointer', boxSizing: 'border-box' }}>
          <Bot size={17} style={{ color: 'var(--tg-accent)', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedBot ? `${selectedBot.name}${selectedBot.username ? ` · @${selectedBot.username}` : ''}` : 'Chưa có bot đang bật'}</span>
          <ChevronDown size={15} style={{ flexShrink: 0, transform: botMenuOpen ? 'rotate(180deg)' : undefined }} />
        </button>
        {managedBots.every((bot) => !bot.isEnabled) && <div style={{ padding: '6px 2px 0', color: 'var(--tg-text-muted)', fontSize: 10 }}>Bật bot trong Quản lý bot để lọc hội thoại theo bot.</div>}
      </div>}

      {/* Footer brand */}
      <div style={{
        padding: '10px 16px',
        borderTop: '1px solid var(--tg-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14,
        }}>🚀</div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tg-text-primary)' }}>Demo_TeleVaga</div>
          <div style={{ fontSize: 10, color: 'var(--tg-text-muted)' }}>AI-Powered</div>
        </div>
        <AdminLogoutButton />
      </div>
    </aside>
  );
}
