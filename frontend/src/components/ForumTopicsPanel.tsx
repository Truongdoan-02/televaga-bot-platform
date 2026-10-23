'use client';

import React from 'react';
import { Bot, Check, ChevronDown, Hash, MessageSquare, Plus, Search, UsersRound, X } from 'lucide-react';
import { Chat, ManagedBot } from '@/types';
import SectionNavigation from './SectionNavigation';

interface ForumTopicsPanelProps {
  group: Chat;
  topics: Chat[];
  activeChatId: string | null;
  loading: boolean;
  onClose: () => void;
  onSelectTopic: (chatId: string) => void;
  onCreateTopic: (chatId: string) => void;
  managedBots: ManagedBot[];
  selectedBotId: string;
  onBotChange: (botId: string) => void;
  activeSection: 'chats' | 'bots' | 'notifications' | 'products' | 'suppliers' | 'inventory' | 'orders';
  onSectionChange: (section: 'chats' | 'bots' | 'notifications' | 'products' | 'suppliers' | 'inventory' | 'orders') => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onCreateGroup: () => void;
  category: string;
  onCategoryChange: (category: string) => void;
}

export default function ForumTopicsPanel({
  group,
  topics,
  activeChatId,
  loading,
  onClose,
  onSelectTopic,
  onCreateTopic,
  managedBots,
  selectedBotId,
  onBotChange,
  activeSection,
  onSectionChange,
  searchQuery,
  onSearchChange,
  onCreateGroup,
  category,
  onCategoryChange,
}: ForumTopicsPanelProps) {
  const [botMenuOpen, setBotMenuOpen] = React.useState(false);
  const enabledBots = managedBots.filter((bot) => bot.isEnabled);
  const selectedBot = enabledBots.find((bot) => bot.id === selectedBotId);
  const categories = [
    { key: 'all', label: '💬 Tất cả' },
    { key: 'support', label: '🛠 Hỗ trợ' },
    { key: 'sales', label: '💼 Sales' },
    { key: 'vip', label: '⭐ VIP' },
    { key: 'unread', label: '🔵 Chưa đọc' },
  ];
  return (
    <aside className="forum-topics-panel" aria-label={`Topic trong ${group.title}`} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--tg-bg-secondary)', borderLeft: '1px solid var(--tg-border)', color: 'var(--tg-text-primary)' }}>
      <SectionNavigation activeSection={activeSection} onSectionChange={onSectionChange} />
      <div className="sidebar-header" style={{ minHeight: 60, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <label className="search-bar" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 12px', border: '1px solid var(--tg-border)', borderRadius: 22, background: 'var(--tg-bg-tertiary)' }}>
          <Search size={15} style={{ color: 'var(--tg-text-muted)', flexShrink: 0 }} />
          <input type="text" placeholder="Tìm kiếm hội thoại..." value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} style={{ width: '100%', minWidth: 0, border: 0, outline: 0, background: 'transparent', color: 'var(--tg-text-primary)', font: 'inherit', fontSize: 12 }} />
        </label>
        <button type="button" title="Tạo nhóm" onClick={onCreateGroup} style={{ width: 38, height: 38, flex: '0 0 38px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '50%', background: 'var(--tg-accent-light)', color: 'var(--tg-accent)', cursor: 'pointer' }}><UsersRound size={18} /></button>
      </div>
      <div className="category-tabs" style={{ display: 'flex', flexShrink: 0, gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--tg-border)', overflowX: 'auto' }}>
        {categories.map((item) => <button key={item.key} type="button" className={`category-tab${category === item.key ? ' active' : ''}`} onClick={() => onCategoryChange(item.key)} style={{ flexShrink: 0, padding: '5px 10px', border: `1px solid ${category === item.key ? 'rgba(82,136,193,.3)' : 'transparent'}`, borderRadius: 16, background: category === item.key ? 'var(--tg-accent-light)' : 'transparent', color: category === item.key ? 'var(--tg-accent)' : 'var(--tg-text-secondary)', font: 'inherit', fontSize: 11, whiteSpace: 'nowrap', cursor: 'pointer' }}>{item.label}</button>)}
      </div>
      <header className="forum-topics-header" style={{ minHeight: 64, padding: '0 14px 0 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--tg-border)' }}>
        <div className="forum-topics-heading" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <strong style={{ overflow: 'hidden', fontSize: 15, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.title}</strong>
          <span style={{ overflow: 'hidden', color: 'var(--tg-text-muted)', fontSize: 11, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.participants?.length || group.participantIds.length} thành viên</span>
        </div>
        <div className="forum-topics-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {group.isForum && <button type="button" title="Tạo topic" aria-label="Tạo topic" onClick={() => onCreateTopic(group.id)} style={{ width: 34, height: 34, display: 'grid', placeItems: 'center', border: 0, borderRadius: 9, background: 'transparent', color: 'var(--tg-text-secondary)', cursor: 'pointer' }}><Plus size={18} /></button>}
          <button type="button" title="Đóng danh sách topic" aria-label="Đóng danh sách topic" onClick={onClose} style={{ width: 34, height: 34, display: 'grid', placeItems: 'center', border: 0, borderRadius: 9, background: 'transparent', color: 'var(--tg-text-secondary)', cursor: 'pointer' }}><X size={19} /></button>
        </div>
      </header>

      <div className="forum-topics-list" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 }}>
        {loading ? (
          <div className="forum-topics-empty" style={{ padding: '24px 12px', color: 'var(--tg-text-muted)', fontSize: 13, textAlign: 'center' }}>Đang tải topic…</div>
        ) : topics.length === 0 ? (
          <div className="forum-topics-empty" style={{ padding: '24px 12px', color: 'var(--tg-text-muted)', fontSize: 13, textAlign: 'center' }}>Nhóm chưa có topic nào.</div>
        ) : topics.map((topic) => {
          const isActive = topic.id === activeChatId;
          const preview = topic.lastMessage
            ? `${topic.lastMessage.isOutgoing ? 'Bạn: ' : ''}${topic.lastMessage.text || 'Đã gửi tệp'}`
            : 'Chưa có tin nhắn';
          return (
            <button
              type="button"
              key={topic.id}
              className={`forum-topic-item${isActive ? ' active' : ''}`}
              onClick={() => onSelectTopic(topic.id)}
              style={{ width: '100%', minHeight: 62, display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', border: 0, borderRadius: 11, background: isActive ? 'var(--tg-bg-active)' : 'transparent', color: 'var(--tg-text-primary)', textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="forum-topic-icon" style={{ width: 38, height: 38, flex: '0 0 38px', display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'var(--tg-accent-light)', color: 'var(--tg-accent)' }}><Hash size={18} /></span>
              <span className="forum-topic-copy" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <strong style={{ overflow: 'hidden', fontSize: 13, fontWeight: 650, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{topic.topicName || topic.title}</strong>
                <span style={{ overflow: 'hidden', color: 'var(--tg-text-muted)', fontSize: 11, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview}</span>
              </span>
              {topic.unreadCount > 0
                ? <span className="forum-topic-unread" style={{ minWidth: 19, height: 19, padding: '0 5px', display: 'grid', placeItems: 'center', borderRadius: 10, background: 'var(--tg-accent)', color: '#fff', fontSize: 10 }}>{topic.unreadCount}</span>
                : isActive
                  ? <Check size={15} className="forum-topic-selected" style={{ flex: '0 0 auto', color: 'var(--tg-text-muted)' }} />
                  : <MessageSquare size={14} className="forum-topic-message-icon" style={{ flex: '0 0 auto', color: 'var(--tg-text-muted)' }} />}
            </button>
          );
        })}
      </div>
      <div style={{ position: 'relative', padding: '10px 14px', borderTop: '1px solid var(--tg-border)', flexShrink: 0 }}>
        {botMenuOpen && <>
          <button type="button" aria-label="Đóng danh sách bot" onClick={() => setBotMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50, border: 0, padding: 0, background: 'transparent' }} />
          <div role="listbox" aria-label="Chọn bot để xem hội thoại" style={{ position: 'absolute', zIndex: 51, left: 14, right: 14, bottom: 'calc(100% + 6px)', maxHeight: 'min(50vh, 280px)', overflowY: 'auto', padding: 5, border: '1px solid var(--tg-border)', borderRadius: 12, background: 'var(--tg-bg-secondary, #232e3c)', boxShadow: '0 10px 28px rgba(0,0,0,.4)', boxSizing: 'border-box' }}>
            {enabledBots.length ? enabledBots.map((bot) => (
              <button key={bot.id} type="button" role="option" aria-selected={selectedBotId === bot.id} onClick={() => { onBotChange(bot.id); setBotMenuOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0, minHeight: 38, padding: '0 9px', border: 0, borderRadius: 8, background: selectedBotId === bot.id ? 'var(--tg-bg-active, #30465c)' : 'transparent', color: 'var(--tg-text-primary)', textAlign: 'left', font: 'inherit', fontSize: 12, cursor: 'pointer' }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bot.name}{bot.username ? ` · @${bot.username}` : ''}</span>
                {selectedBotId === bot.id && <Check size={15} style={{ flexShrink: 0, color: 'var(--tg-accent)' }} />}
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
      </div>
    </aside>
  );
}
