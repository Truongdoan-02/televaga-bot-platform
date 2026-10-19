'use client';

import { assetUrl } from '@/lib/assets';

import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from 'react';
import {
  Send, CheckCheck, Check, Clock, Users, MoreVertical, Reply, Copy, Pin, Search, X, ChevronLeft, ChevronUp, ChevronDown, CalendarDays,
  Forward, CheckCircle2, Download, Trash2, Smile, CheckSquare, Square, List, Paperclip, Image as ImageIcon, File as FileIcon,
} from 'lucide-react';
import { Chat, Message } from '@/types';
import MessageText from './MessageText';
import MessageMedia from './MessageMedia';


const REACTIONS = ['❤️', '👍', '👎', '🔥', '🥰', '👏', '😁'];
const CHAT_EMOJIS = ['😀','😃','😄','😁','😆','😅','😂','🤣','🥲','😊','😇','🙂','🙃','😉','😍','🥰','😘','😋','😛','🤗','🤔','🤨','😐','🙄','😏','😴','🥳','😭','😤','😡','🤯','😎','🤓','🥺','😱','🤝','🙏','👏','🙌','👍','👎','👌','✌️','🤞','💪','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕','💞','💯','🔥','✨','🎉','🎂','🌹','🌸','☀️','🌙','⭐','⚡','☕','🍰','🍕','🍻','✅','❌','💡','💬','📌','🎁','🚀','🐱','🐶','🌈'];

interface ChatWindowProps {
  chat: Chat | null;
  chats: Chat[];
  messages: Message[];
  loading: boolean;
  typingUser: string | null;
  onSendMessage: (text: string, replyToId?: string) => Promise<void>;
  onSendFile: (file: File, caption?: string) => Promise<void>;
  onReactMessage: (messageId: string, emoji: string) => Promise<void>;
  onPinMessage: (message: Message, isPinned: boolean) => Promise<void>;
  onDeleteMessages: (messageIds: string[]) => Promise<void>;
  onForwardMessages: (messageIds: string[], targetChatId: string) => Promise<void>;
  onOpenUserInfo: () => void;
  onOpenSenderChat: (userId: string) => void;
  onBackToChats?: () => void;
  onOpenTopics?: () => void;
  externalInput?: string;
  onExternalInputConsumed?: () => void;
}

const AVATAR_COLORS = ['#4f81c7', '#43a89f', '#c05c7e', '#7c62b5', '#e07654', '#6ab04c'];
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
function formatMsgTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });
}
const CHAT_TIME_ZONE = 'Asia/Ho_Chi_Minh';
function localDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHAT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function formatDateSep(iso: string): string {
  const d = new Date(iso);
  const todayKey = localDateKey(new Date());
  const [year, month, day] = todayKey.split('-').map(Number);
  const yesterdayKey = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
  const messageDateKey = localDateKey(d);
  if (messageDateKey === todayKey) return 'Hôm nay';
  if (messageDateKey === yesterdayKey) return 'Hôm qua';
  return d.toLocaleDateString('vi-VN', { timeZone: CHAT_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
}
function StatusIcon({ status }: { status: Message['status'] }) {
  if (status === 'sending') return <Clock size={11} />;
  if (status === 'sent') return <Check size={11} />;
  if (status === 'delivered') return <CheckCheck size={11} style={{ opacity: 0.6 }} />;
  if (status === 'read') return <CheckCheck size={11} style={{ color: '#64d2ff' }} />;
  return null;
}
interface MsgGroup {
  isOutgoing: boolean;
  senderId: string;
  senderName?: string;
  messages: Message[];
}
function groupMessages(messages: Message[]): MsgGroup[] {
  const groups: MsgGroup[] = [];
  for (const msg of messages) {
    const last = groups[groups.length - 1];
    if (last && last.senderId === msg.senderId && localDateKey(new Date(last.messages[0].createdAt)) === localDateKey(new Date(msg.createdAt))) last.messages.push(msg);
    else groups.push({ isOutgoing: msg.isOutgoing, senderId: msg.senderId, senderName: msg.senderName, messages: [msg] });
  }
  return groups;
}

export default function ChatWindow({
  chat, chats, messages, loading, typingUser, onSendMessage, onSendFile, onReactMessage,
  onPinMessage, onDeleteMessages, onForwardMessages, onOpenUserInfo, onOpenSenderChat,
  onBackToChats, onOpenTopics,
  externalInput, onExternalInputConsumed,
}: ChatWindowProps) {
  const [inputText, setInputText] = useState('');
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const photoVideoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState('');
  const [messageSearchDate, setMessageSearchDate] = useState('');
  const [pinnedListOpen, setPinnedListOpen] = useState(false);
  const [showPinnedBanner, setShowPinnedBanner] = useState(true);
  const [pendingPin, setPendingPin] = useState<Message | null>(null);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const messageSearchRef = useRef<HTMLInputElement>(null);
  const messageSearchDateRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [menu, setMenu] = useState<{ message: Message; x: number; y: number } | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [forwardIds, setForwardIds] = useState<string[] | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const followLatestRef = useRef(true);
  const initializedChatRef = useRef<string | null>(null);
  const attachmentPreviewUrl = useMemo(() => attachedFile ? URL.createObjectURL(attachedFile) : '', [attachedFile]);

  useEffect(() => () => {
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
  }, [attachmentPreviewUrl]);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const previousMessageStateRef = useRef<{ count: number; lastId: string | null }>({ count: 0, lastId: null });
  const previousTypingUserRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const element = messagesAreaRef.current;
    if (!element) return;
    const updateBackgroundBounds = () => {
      const rect = element.getBoundingClientRect();
      const size = `${rect.width}px ${rect.height}px`;
      const position = `${rect.left}px ${rect.top}px`;
      element.style.setProperty('--chat-bg-size', size);
      element.style.setProperty('--chat-bg-position', position);
      element.style.backgroundSize = `${size}, ${size}`;
      element.style.backgroundPosition = `${position}, ${position}`;
    };
    updateBackgroundBounds();
    const observer = new ResizeObserver(updateBackgroundBounds);
    observer.observe(element);
    window.addEventListener('resize', updateBackgroundBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateBackgroundBounds);
    };
  }, [chat?.id]);

  useEffect(() => {
    setMessageSearch('');
    setMessageSearchDate('');
    setMessageSearchOpen(false);
    setPinnedListOpen(false);
    setShowPinnedBanner(true);
    setPendingPin(null);
    setActiveSearchIndex(0);
    setReplyTo(null);
    setSelectionMode(false);
    setSelectedIds([]);
    setForwardIds(null);
    setMenu(null);
    setEmojiPickerOpen(false);
  }, [chat?.id]);

  useEffect(() => {
    if (externalInput) {
      setInputText(externalInput);
      onExternalInputConsumed?.();
      textareaRef.current?.focus();
    }
  }, [externalInput, onExternalInputConsumed]);

  useEffect(() => {
    if (!attachmentMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !attachmentMenuRef.current?.contains(event.target)) {
        setAttachmentMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [attachmentMenuOpen]);

  useEffect(() => {
    if (!emojiPickerOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !emojiPickerRef.current?.contains(event.target)) setEmojiPickerOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [emojiPickerOpen]);

  const updateScrollPosition = useCallback(() => {
    const area = messagesAreaRef.current;
    if (!area) return;
    const nearBottom = area.scrollHeight - area.scrollTop - area.clientHeight <= 80;
    followLatestRef.current = nearBottom;
    setShowScrollToLatest(!nearBottom);
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const area = messagesAreaRef.current;
    if (!area) return;
    followLatestRef.current = true;
    area.scrollTo({ top: area.scrollHeight, behavior });
    if (behavior === 'instant') updateScrollPosition();
  }, [updateScrollPosition]);

  useLayoutEffect(() => {
    if (loading || !chat) {
      initializedChatRef.current = null;
      followLatestRef.current = true;
      setShowScrollToLatest(false);
      return;
    }
    const lastId = messages[messages.length - 1]?.id || null;
    const previous = previousMessageStateRef.current;
    const initialMessagesLoaded = initializedChatRef.current !== chat.id || (previous.count === 0 && messages.length > 0);
    const newMessageAdded = messages.length > previous.count && lastId !== previous.lastId;
    const typingStarted = Boolean(typingUser) && typingUser !== previousTypingUserRef.current;

    if (initialMessagesLoaded) {
      initializedChatRef.current = chat.id;
      scrollToLatest('instant');
    } else if ((newMessageAdded || typingStarted) && followLatestRef.current) {
      scrollToLatest('instant');
    }
    updateScrollPosition();

    previousMessageStateRef.current = { count: messages.length, lastId };
    previousTypingUserRef.current = typingUser;
  }, [chat, loading, messages, typingUser, scrollToLatest, updateScrollPosition]);

  useEffect(() => {
    const area = messagesAreaRef.current;
    const content = messagesContentRef.current;
    if (!area || !content || loading) return;
    const observer = new ResizeObserver(() => {
      if (followLatestRef.current) scrollToLatest('instant');
      updateScrollPosition();
    });
    observer.observe(area);
    observer.observe(content);
    return () => observer.disconnect();
  }, [chat?.id, loading, scrollToLatest, updateScrollPosition]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }, [inputText]);

  const showError = useCallback((error: unknown) => {
    setActionError(error instanceof Error ? error.message : 'Không thể thực hiện thao tác');
    window.setTimeout(() => setActionError(''), 3500);
  }, []);

  const handleFileSelect = useCallback((file: File) => {
    if (file.type.startsWith('image/') && file.size > 10 * 1024 * 1024) {
      showError(new Error('Ảnh gửi qua Telegram không được vượt quá 10 MB'));
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      showError(new Error('Kích thước tệp tối đa là 50 MB'));
      return;
    }
    setAttachedFile(file);
    setAttachmentMenuOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [showError]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if ((!text && !attachedFile) || sending || uploading || !chat) return;
    if (attachedFile && text.length > 1024) {
      showError(new Error('Nội dung đi kèm tệp tối đa 1.024 ký tự'));
      return;
    }
    setSending(true);
    try {
      if (attachedFile) {
        setUploading(true);
        await onSendFile(attachedFile, text);
        setAttachedFile(null);
        if (photoVideoInputRef.current) photoVideoInputRef.current.value = '';
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        await onSendMessage(text, replyTo?.id);
      }
      setInputText('');
      setReplyTo(null);
    } catch (error) {
      showError(error);
    } finally {
      setUploading(false);
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [inputText, attachedFile, sending, uploading, chat, replyTo, onSendMessage, onSendFile, showError]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const openMenu = (event: React.MouseEvent | React.KeyboardEvent, message: Message) => {
    event.preventDefault();
    const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
    const x = 'clientX' in event && event.clientX ? event.clientX : (rect?.right || 420);
    const y = 'clientY' in event && event.clientY ? event.clientY : (rect?.bottom || 240);
    setMenu({ message, x: Math.min(x, window.innerWidth - 245), y: Math.min(y, window.innerHeight - (message.mediaUrl ? 400 : 350)) });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const copyMessages = async (ids: string[]) => {
    const text = messages.filter((message) => ids.includes(message.id)).map((message) => message.text).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setActionError('Đã sao chép nội dung tin nhắn');
      window.setTimeout(() => setActionError(''), 2200);
    } catch (error) {
      showError(error);
    }
  };

  const downloadMedia = async (message: Message) => {
    setMenu(null);
    if (!message.mediaUrl) return;
    try {
      const response = await fetch(assetUrl(message.mediaUrl));
      if (!response.ok) throw new Error('Không tải được tệp. Vui lòng thử lại.');
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = message.fileName || message.mediaUrl.split(/[?#]/)[0].split('/').pop() || 'download';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (error) {
      showError(error);
    }
  };

  const handleAction = async (action: 'reply' | 'copy' | 'pin' | 'forward' | 'select' | 'delete', message: Message) => {
    setMenu(null);
    if (action === 'reply') {
      setReplyTo(message);
      textareaRef.current?.focus();
    } else if (action === 'copy') {
      await copyMessages([message.id]);
    } else if (action === 'pin') {
      if (!message.isPinned && pinnedMessages.length >= 3) {
        setPendingPin(message);
        setPinnedListOpen(true);
        return;
      }
      try {
        await onPinMessage(message, !message.isPinned);
      } catch (error) {
        showError(error);
      }
    } else if (action === 'forward') {
      setForwardIds([message.id]);
    } else if (action === 'select') {
      setSelectionMode(true);
      setSelectedIds((current) => current.includes(message.id) ? current : [...current, message.id]);
    } else if (window.confirm('Xóa tin nhắn này?')) {
      try {
        await onDeleteMessages([message.id]);
      } catch (error) {
        showError(error);
      }
    }
  };

  const runBulkDelete = async () => {
    if (!selectedIds.length || !window.confirm('Xóa ' + selectedIds.length + ' tin nhắn đã chọn?')) return;
    setActionBusy(true);
    try {
      await onDeleteMessages(selectedIds);
      setSelectedIds([]);
      setSelectionMode(false);
    } catch (error) {
      showError(error);
    } finally {
      setActionBusy(false);
    }
  };

  const runForward = async (targetChatId: string) => {
    if (!forwardIds?.length) return;
    setActionBusy(true);
    try {
      await onForwardMessages(forwardIds, targetChatId);
      setForwardIds(null);
      setSelectionMode(false);
      setSelectedIds([]);
    } catch (error) {
      showError(error);
    } finally {
      setActionBusy(false);
    }
  };

  const searchMatches = useMemo(() => {
    const query = messageSearch.trim().toLocaleLowerCase();
    if (!query && !messageSearchDate) return [];
    return messages.filter((message) => {
      const matchesText = !query || message.text.toLocaleLowerCase().includes(query);
      const date = new Date(message.createdAt);
      const messageDate = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
      return matchesText && (!messageSearchDate || messageDate === messageSearchDate);
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [messages, messageSearch, messageSearchDate]);

  const pinnedMessages = useMemo(() => messages.filter((message) => message.isPinned).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()), [messages]);

  const goToSearchResult = useCallback((index: number) => {
    if (!searchMatches.length) return;
    const next = (index + searchMatches.length) % searchMatches.length;
    setActiveSearchIndex(next);
    window.setTimeout(() => document.getElementById('message-' + searchMatches[next].id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  }, [searchMatches]);

  const moveSearchResult = useCallback((direction: -1 | 1) => {
    goToSearchResult(activeSearchIndex + direction);
  }, [activeSearchIndex, goToSearchResult]);

  const highlightSearchText = (text: string) => {
    const query = messageSearch.trim();
    const index = query ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
    if (index < 0) return text;
    return <>{text.slice(0, index)}<mark style={{ background: '#c7e7ff', color: '#17212b', borderRadius: 3, padding: '0 2px' }}>{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>;
  };

  const groupedContent = useMemo(() => {
    const content: Array<{ type: 'separator'; date: string } | { type: 'group'; group: MsgGroup }> = [];
    let lastDate = '';
    for (const group of groupMessages(messages)) {
      if (!group.messages.length) continue;
      const msgDate = formatDateSep(group.messages[0].createdAt);
      if (msgDate !== lastDate) {
        content.push({ type: 'separator', date: msgDate });
        lastDate = msgDate;
      }
      content.push({ type: 'group', group });
    }
    return content;
  }, [messages]);

  if (!chat) {
    return (
      <div className="chat-window">
        <div className="empty-state">
          <div className="empty-state-icon">💬</div>
          <div className="empty-state-title">Chọn một hội thoại</div>
          <div className="empty-state-sub">Chọn một cuộc trò chuyện ở danh sách bên trái để bắt đầu nhắn tin và sử dụng AI hỗ trợ.</div>
        </div>
      </div>
    );
  }

  const initials = getInitials(chat.title);
  const color = getAvatarColor(chat.title);

  return (
    <div className="chat-window">
      <div className="chat-window-header" style={{ position: 'relative' }}>
        {onBackToChats && <button type="button" className="mobile-chat-back" onClick={onBackToChats} aria-label="Quay lại danh sách hội thoại" title="Quay lại"><ChevronLeft size={22} /></button>}
        <div style={{ cursor: 'pointer', flexShrink: 0 }} onClick={onOpenUserInfo}>
          {chat.avatarUrl ? <img src={assetUrl(chat.avatarUrl)} alt={chat.title} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} /> :
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700 }}>{chat.type === 'group' ? '👥' : initials}</div>}
        </div>
        <div className="chat-header-info" style={{ cursor: 'pointer' }} onClick={onOpenUserInfo}>
          <div className="chat-header-name">{chat.parentTitle ? `${chat.parentTitle} · ${chat.topicName || chat.title}` : chat.title}</div>
          <div className="chat-header-status">{chat.parentChatId ? <><Users size={11} /> Topic · {chat.participantIds.length} thành viên</> : chat.type === 'group' ? <><Users size={11} /> {chat.participantIds.length} thành viên</> : <span className="online">● Đang hoạt động</span>}</div>
        </div>
        <div className="chat-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {onOpenTopics && (chat.type === 'group' || chat.parentChatId) && <button type="button" className="mobile-topics-toggle" onClick={onOpenTopics} aria-label="Mở topic nhóm" title="Topic nhóm"><List size={18} /></button>}
          {messageSearchOpen && (
            <div style={{ position: 'absolute', zIndex: 50, left: '50%', top: 4, transform: 'translateX(-50%)', width: 'min(680px, calc(100% - 32px))', overflow: 'hidden', border: '1px solid #343434', borderRadius: 18, background: '#212121', boxShadow: '0 12px 36px rgba(0,0,0,.48)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '0 12px 0 18px', borderBottom: '1px solid #333' }}>
                <Search size={21} style={{ color: '#a78bfa', flexShrink: 0 }} />
                <input style={{ minWidth: 40, flex: 1, border: 0, outline: 0, background: 'transparent', color: '#f5f5f5', fontSize: 16 }} ref={messageSearchRef} value={messageSearch} onChange={(event) => { setMessageSearch(event.target.value); setActiveSearchIndex(0); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); moveSearchResult(event.shiftKey ? -1 : 1); } if (event.key === 'Escape') { setMessageSearchOpen(false); setMessageSearch(''); setMessageSearchDate(''); } }} placeholder="Tìm kiếm" aria-label="Tìm tin nhắn trong cuộc trò chuyện" />
                <span style={{ minWidth: 38, color: '#aaa', fontSize: 12, textAlign: 'center' }}>{searchMatches.length ? activeSearchIndex + 1 : 0}/{searchMatches.length}</span>
                <button className="icon-btn" onClick={() => moveSearchResult(-1)} disabled={!searchMatches.length} title="Kết quả trước"><ChevronUp size={21} /></button>
                <button className="icon-btn" onClick={() => moveSearchResult(1)} disabled={!searchMatches.length} title="Kết quả tiếp"><ChevronDown size={21} /></button>
                <button className="icon-btn" onClick={() => { setMessageSearchOpen(false); setMessageSearch(''); setMessageSearchDate(''); }} title="Đóng tìm kiếm"><X size={22} /></button>
                <button className="icon-btn" onClick={() => { const picker = messageSearchDateRef.current as (HTMLInputElement & { showPicker?: () => void }) | null; picker?.showPicker?.(); }} title="Chọn ngày"><CalendarDays size={21} /></button>
                <input ref={messageSearchDateRef} type="date" value={messageSearchDate} onChange={(event) => { setMessageSearchDate(event.target.value); setActiveSearchIndex(0); }} aria-label="Lọc tin nhắn theo ngày" style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', left: '50%' }} />
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', padding: '4px 8px 8px' }}>
                {searchMatches.length ? searchMatches.map((message, index) => (
                  <button key={message.id} onClick={() => goToSearchResult(index)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '9px 10px', border: 0, borderRadius: 13, background: index === activeSearchIndex ? '#303030' : 'transparent', color: '#f1f1f1', textAlign: 'left', cursor: 'pointer' }}>
                    {chat.avatarUrl ? <img src={assetUrl(chat.avatarUrl)} alt="" style={{ width: 50, height: 50, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} /> : <div style={{ width: 50, height: 50, borderRadius: '50%', background: color, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, flexShrink: 0 }}>{initials}</div>}
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 14, fontWeight: 650 }}><span>{message.senderName || chat.title}</span><span style={{ color: '#888', fontSize: 12, fontWeight: 400 }}>{formatMsgTime(message.createdAt)}</span></span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, color: '#ddd' }}>{highlightSearchText(message.text)}</span>
                    </span>
                  </button>
                )) : <div style={{ padding: '20px 12px', color: '#999', fontSize: 13, textAlign: 'center' }}>{messageSearchDate ? 'Không có tin nhắn vào ngày đã chọn' : 'Nhập từ khóa hoặc chọn ngày để tìm tin nhắn'}</div>}
              </div>
            </div>
          )}
          {pinnedMessages.length > 0 && <button className="icon-btn" onClick={() => setPinnedListOpen(true)} title="Xem tin nhắn đã ghim" aria-label="Xem tin nhắn đã ghim" style={{ position: 'relative' }}><Pin size={18} /><span style={{ position: 'absolute', right: -3, top: -3, minWidth: 15, height: 15, padding: '0 3px', borderRadius: 10, background: '#8774e1', color: 'white', fontSize: 9, lineHeight: '15px', textAlign: 'center' }}>{pinnedMessages.length}</span></button>}
          {!messageSearchOpen && <button className="icon-btn" onClick={() => { setMessageSearchOpen(true); window.setTimeout(() => messageSearchRef.current?.focus(), 0); }} title="Tìm kiếm tin nhắn"><Search size={18} /></button>}
          <button className="icon-btn" onClick={onOpenUserInfo} title="Thông tin"><MoreVertical size={18} /></button>
        </div>
      </div>

      {showPinnedBanner && pinnedMessages.length > 0 && (() => {
        const pinned = pinnedMessages[pinnedMessages.length - 1];
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, margin: '8px 18px 0', padding: '7px 12px', borderRadius: 16, background: '#202b38', boxShadow: '0 3px 12px rgba(0,0,0,.12)' }}>
            <button onClick={() => document.getElementById('message-' + pinned.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} style={{ display: 'flex', flex: 1, minWidth: 0, flexDirection: 'column', gap: 3, padding: '2px 8px', border: 0, borderLeft: '3px solid #8774e1', background: 'transparent', color: '#e8eef5', textAlign: 'left', cursor: 'pointer' }}>
              <span style={{ color: '#a78bfa', fontSize: 13, fontWeight: 600 }}>Pinned message{pinnedMessages.length > 1 ? ' #' + pinnedMessages.length : ''}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{pinned.text}</span>
            </button>
            <button className="icon-btn" onClick={() => setPinnedListOpen(true)} title="Xem danh sách tin đã ghim" aria-label="Xem danh sách tin đã ghim" style={{ width: 34, height: 34, color: '#e8eef5' }}><List size={19} /></button>
            <button className="icon-btn" onClick={() => setShowPinnedBanner(false)} title="Ẩn tin đã ghim" aria-label="Ẩn tin đã ghim" style={{ width: 34, height: 34, color: '#e8eef5' }}><X size={20} /></button>
          </div>
        );
      })()}

      <div className="messages-viewport">
      <div ref={messagesAreaRef} className="messages-area" onScroll={updateScrollPosition} onClick={() => menu && setMenu(null)}>
        {selectionMode && (
          <div className="message-selection-toolbar">
            <button className="icon-btn" onClick={() => { setSelectionMode(false); setSelectedIds([]); }} title="Thoát chọn"><X size={17} /></button>
            <strong>{selectedIds.length} đã chọn</strong>
            <button className="icon-btn" disabled={!selectedIds.length} onClick={() => void copyMessages(selectedIds)} title="Sao chép"><Copy size={16} /></button>
            <button className="icon-btn" disabled={!selectedIds.length} onClick={() => setForwardIds(selectedIds)} title="Chuyển tiếp"><Forward size={16} /></button>
            <button className="icon-btn danger" disabled={!selectedIds.length || actionBusy} onClick={() => void runBulkDelete()} title="Xóa"><Trash2 size={16} /></button>
          </div>
        )}
        {loading ? <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}><div className="spinner" /></div> : (
          <div ref={messagesContentRef} className="messages-content">
            {groupedContent.map((item, idx) => {
              if (item.type === 'separator') return <div key={'sep-' + idx} className="date-separator"><span>{item.date}</span></div>;
              const group = item.group;
              const senderColor = getAvatarColor(group.senderName || group.senderId);
              const senderInitials = getInitials(group.senderName || 'U');
              const sender = chat.participants?.find((participant) => participant.id === group.senderId);
              const senderAvatarUrl = sender?.avatarUrl || (chat.type === 'direct' ? chat.avatarUrl : undefined);
              return (
                <div key={'grp-' + idx} className={'message-group ' + (group.isOutgoing ? 'outgoing' : 'incoming') + ' animate-fadeIn'}>
                  {!group.isOutgoing && group.senderName && <button type="button" className="sender-name-label" onClick={() => chat.type === 'group' && onOpenSenderChat(group.senderId)} style={{ padding: '0 4px', border: 0, background: 'transparent', color: 'var(--tg-accent)', fontSize: 12, fontWeight: 600, textAlign: 'left', cursor: chat.type === 'group' ? 'pointer' : 'default' }}>{group.senderName}</button>}
                  {group.messages.map((message, mi) => {
                    const reply = message.replyToId ? messages.find((item) => item.id === message.replyToId) : null;
                    const chosen = selectedIds.includes(message.id);
                    return (
                      <div id={'message-' + message.id} key={message.id} className={'message-row ' + (group.isOutgoing ? 'outgoing' : 'incoming') + (chosen ? ' selected' : '')}
                        onContextMenu={(event) => openMenu(event, message)}>
                        {!group.isOutgoing && mi === group.messages.length - 1 && (
                          <button type="button" className="message-avatar" onClick={() => chat.type === 'group' && onOpenSenderChat(group.senderId)} aria-label={'Mở chat với ' + (group.senderName || 'thành viên')} title={chat.type === 'group' ? 'Nhắn tin riêng' : undefined} style={{ display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: '50%', background: 'transparent', cursor: chat.type === 'group' ? 'pointer' : 'default' }}>
                            {senderAvatarUrl ? <img src={assetUrl(senderAvatarUrl)} alt="" /> : <div style={{ background: senderColor }}>{senderInitials}</div>}
                          </button>
                        )}
                        {!group.isOutgoing && mi < group.messages.length - 1 && <div className="message-avatar-spacer" />}
                        {selectionMode && <button className="message-select-check" onClick={() => toggleSelected(message.id)} aria-label={chosen ? 'Bỏ chọn tin nhắn' : 'Chọn tin nhắn'}>{chosen ? <CheckSquare size={18} /> : <Square size={18} />}</button>}
                        <div className="message-bubble-wrap">
                          <div className="message-hover-actions">
                            {REACTIONS.slice(0, 6).map((emoji) => <button key={emoji} onClick={() => onReactMessage(message.id, emoji).catch(showError)} aria-label={'Thả cảm xúc ' + emoji}>{emoji}</button>)}
                            <button onClick={(event) => openMenu(event, message)} aria-label="Thao tác tin nhắn"><MoreVertical size={15} /></button>
                          </div>
                          <div className={'bubble ' + (group.isOutgoing ? 'outgoing' : 'incoming') + (message.mediaUrl && message.type === 'image' ? ' bubble-with-image' : '') + (selectionMode ? ' selectable' : '') + (messageSearch.trim() && message.text.toLocaleLowerCase().includes(messageSearch.trim().toLocaleLowerCase()) ? ' search-match' + (searchMatches[activeSearchIndex]?.id === message.id ? ' search-match-active' : '') : '')}
                            onClick={() => selectionMode && toggleSelected(message.id)}>
                            {message.isPinned && <div className="message-pin-label"><Pin size={12} /> Đã ghim</div>}
                            {message.forwardedFrom && <div className="message-forwarded-label"><Forward size={12} /> Đã chuyển tiếp từ {message.forwardedFrom}</div>}
                            {reply && <div className="reply-quote"><strong>{reply.senderName || (reply.isOutgoing ? 'Bạn' : chat.title)}</strong><span>{reply.text}</span></div>}
                            {message.mediaUrl && <MessageMedia key={message.mediaUrl} message={message} selectionMode={selectionMode} />}
                            {(!message.mediaUrl || message.text !== message.fileName) && <div className="bubble-text"><MessageText message={message} /></div>}
                            <div className="bubble-meta"><span className="bubble-time">{formatMsgTime(message.createdAt)}</span>{group.isOutgoing && <span className="bubble-status"><StatusIcon status={message.status} /></span>}</div>
                          </div>
                          {Object.entries(message.reactions || {}).filter(([, users]) => users.length > 0).length > 0 && (
                            <div className={'message-reactions' + (group.isOutgoing ? ' align-right' : '')}>
                              {Object.entries(message.reactions || {}).filter(([, users]) => users.length > 0).map(([emoji, users]) => (
                                <button key={emoji} className={users.includes('user_agent_me') ? 'active' : ''} onClick={() => onReactMessage(message.id, emoji).catch(showError)}>{emoji} <span>{users.length}</span></button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {typingUser && <div className="typing-indicator animate-fadeIn"><div className="typing-dots"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div><span>{typingUser} đang nhập...</span></div>}
          </div>
        )}
        {menu && (
          <div className="message-context-backdrop" onClick={() => setMenu(null)}>
            <div className="message-context-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
              <div className="context-reaction-row">{REACTIONS.slice(0, 6).map((emoji) => <button key={emoji} onClick={() => { setMenu(null); onReactMessage(menu.message.id, emoji).catch(showError); }}>{emoji}</button>)}</div>
              <button onClick={() => void handleAction('reply', menu.message)}><Reply size={17} /> Trả lời</button>
              {menu.message.mediaUrl && <button onClick={() => void downloadMedia(menu.message)}><Download size={17} /> Tải xuống</button>}
              <button onClick={() => void handleAction('copy', menu.message)}><Copy size={17} /> Sao chép</button>
              <button onClick={() => void handleAction('pin', menu.message)}><Pin size={17} /> {menu.message.isPinned ? 'Bỏ ghim' : 'Ghim'}</button>
              <button onClick={() => void handleAction('forward', menu.message)}><Forward size={17} /> Chuyển tiếp</button>
              <button onClick={() => void handleAction('select', menu.message)}><CheckCircle2 size={17} /> Chọn</button>
              <button className="danger" onClick={() => void handleAction('delete', menu.message)}><Trash2 size={17} /> Xóa</button>
            </div>
          </div>
        )}
        {actionError && <div className="message-action-toast"><Smile size={15} /> {actionError}</div>}
      </div>

      {!loading && showScrollToLatest && <button type="button" className="scroll-to-latest" data-scroll-to-latest onClick={() => scrollToLatest()} aria-label="Về tin nhắn mới nhất" title="Về tin nhắn mới nhất"><ChevronDown size={25} /></button>}
      </div>

      {pinnedListOpen && (
        <div onClick={() => { setPinnedListOpen(false); setPendingPin(null); }} style={{ position: 'fixed', inset: 0, zIndex: 12000, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(0,0,0,.55)' }}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: 'min(520px, 100%)', maxHeight: 'min(620px, 85vh)', overflow: 'hidden', border: '1px solid #3b4654', borderRadius: 16, background: '#202b38', color: '#e8eef5', boxShadow: '0 18px 48px rgba(0,0,0,.45)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid #374151' }}>
              <div><strong>Tin nhắn đã ghim</strong>{pendingPin && <div style={{ marginTop: 4, color: '#aeb8c4', fontSize: 12 }}>Chỉ ghim tối đa 3 tin nhắn. Chọn một tin để gỡ ghim và thay bằng tin mới.</div>}</div>
              <button className="icon-btn" onClick={() => { setPinnedListOpen(false); setPendingPin(null); }} title="Đóng"><X size={19} /></button>
            </div>
            <div style={{ maxHeight: 'min(500px, 68vh)', overflowY: 'auto', padding: 8 }}>
              {pinnedMessages.map((pinned) => (
                <div key={pinned.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                  <button onClick={() => { document.getElementById('message-' + pinned.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setPinnedListOpen(false); setPendingPin(null); }} style={{ flex: 1, minWidth: 0, padding: 4, border: 0, background: 'transparent', color: '#e8eef5', textAlign: 'left', cursor: 'pointer' }}>
                    <span style={{ display: 'block', marginBottom: 4, color: '#a78bfa', fontSize: 12 }}>Pinned message #{pinnedMessages.indexOf(pinned) + 1}</span>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{pinned.text}</span>
                  </button>
                  <button onClick={async () => { try { await onPinMessage(pinned, false); if (pendingPin) await onPinMessage(pendingPin, true); setPinnedListOpen(false); setPendingPin(null); } catch (error) { showError(error); } }} style={{ flexShrink: 0, padding: '8px 10px', border: '1px solid #536274', borderRadius: 9, background: pendingPin ? '#715bd6' : 'transparent', color: '#f4f1ff', cursor: 'pointer', fontSize: 12 }}>{pendingPin ? 'Gỡ và thay thế' : 'Gỡ ghim'}</button>
                </div>
              ))}
              {!pinnedMessages.length && <div style={{ padding: 18, color: '#9aa6b2', textAlign: 'center' }}>Chưa có tin nhắn nào được ghim</div>}
            </div>
          </div>
        </div>
      )}

      {replyTo && <div className="reply-compose-bar"><div><strong>Trả lời {replyTo.senderName || (replyTo.isOutgoing ? 'chính bạn' : chat.title)}</strong><span>{replyTo.text}</span></div><button className="icon-btn" onClick={() => setReplyTo(null)} aria-label="Hủy trả lời"><X size={17} /></button></div>}
      {attachedFile && <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, padding: '10px 16px', borderTop: '1px solid var(--tg-border)', background: 'var(--tg-bg-secondary)' }}>
        {attachedFile.type.startsWith('image/') ? <img src={attachmentPreviewUrl} alt={attachedFile.name} style={{ width: 58, height: 58, flexShrink: 0, objectFit: 'cover', borderRadius: 8 }} /> : attachedFile.type.startsWith('video/') ? <video src={attachmentPreviewUrl} muted playsInline style={{ width: 74, height: 58, flexShrink: 0, objectFit: 'cover', borderRadius: 8 }} /> : <span style={{ display: 'grid', placeItems: 'center', width: 58, height: 58, flexShrink: 0, borderRadius: 8, background: 'var(--tg-bg-hover)', color: 'var(--tg-accent)' }}><FileIcon size={26} /></span>}
        <div style={{ flex: 1, minWidth: 0 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{attachedFile.name}</strong><span style={{ color: 'var(--tg-text-muted)', fontSize: 11 }}>{(attachedFile.size / (1024 * 1024)).toFixed(2)} MB · Sẽ gửi kèm nội dung đã nhập</span></div>
        <button type="button" className="icon-btn" onClick={() => { setAttachedFile(null); if (photoVideoInputRef.current) photoVideoInputRef.current.value = ''; if (fileInputRef.current) fileInputRef.current.value = ''; }} disabled={uploading} aria-label="Bỏ tệp đính kèm" title="Bỏ tệp đính kèm"><X size={18} /></button>
      </div>}
      <div className="message-input-area">
        <div ref={attachmentMenuRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button className="icon-btn" onClick={() => setAttachmentMenuOpen((open) => !open)} disabled={uploading} title="Đính kèm tệp" aria-label="Đính kèm tệp" style={{ width: 40, height: 40, color: 'var(--tg-accent)' }}>{uploading ? <span className="spinner spinner-sm" /> : <Paperclip size={22} />}</button>
          {attachmentMenuOpen && (
            <div style={{ position: 'absolute', bottom: 52, left: 0, zIndex: 100, width: 244, padding: 7, border: '1px solid #343434', borderRadius: 15, background: '#212121', boxShadow: '0 12px 32px rgba(0,0,0,.42)' }}>
              <button onClick={() => { setAttachmentMenuOpen(false); photoVideoInputRef.current?.click(); }} style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '11px 12px', border: 0, borderRadius: 9, background: 'transparent', color: '#f3f3f3', textAlign: 'left', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}><ImageIcon size={20} /> Photo or Video</button>
              <button onClick={() => { setAttachmentMenuOpen(false); fileInputRef.current?.click(); }} style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '11px 12px', border: 0, borderRadius: 9, background: 'transparent', color: '#f3f3f3', textAlign: 'left', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}><FileIcon size={20} /> File</button>
            </div>
          )}
          <input ref={photoVideoInputRef} type="file" accept="image/*,video/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) handleFileSelect(file); }} />
          <input ref={fileInputRef} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) handleFileSelect(file); }} />
        </div>
        <div className="message-input-wrapper">
          <div className="emoji-picker-anchor" ref={emojiPickerRef}>
            <button type="button" className={'emoji-picker-trigger' + (emojiPickerOpen ? ' active' : '')} onMouseDown={(event) => event.preventDefault()} onClick={() => setEmojiPickerOpen((open) => !open)} title="Chèn emoji" aria-label="Chèn emoji" aria-expanded={emojiPickerOpen}><Smile size={20} /></button>
            {emojiPickerOpen && <div className="emoji-picker-popover" role="dialog" aria-label="Chọn emoji">
              <div className="emoji-picker-title">Emoji</div>
              <div className="emoji-picker-grid">{CHAT_EMOJIS.map((emoji, index) => <button type="button" key={emoji + index} onMouseDown={(event) => event.preventDefault()} onClick={() => {
                const textarea = textareaRef.current;
                const start = textarea?.selectionStart ?? inputText.length;
                const end = textarea?.selectionEnd ?? start;
                const next = inputText.slice(0, start) + emoji + inputText.slice(end);
                setInputText(next);
                setEmojiPickerOpen(false);
                requestAnimationFrame(() => { textarea?.focus(); textarea?.setSelectionRange(start + emoji.length, start + emoji.length); });
              }} aria-label={'Chèn ' + emoji}>{emoji}</button>)}</div>
            </div>}
          </div>
          <textarea ref={textareaRef} className="message-textarea" placeholder="Nhắn tin..." value={inputText} onChange={(event) => setInputText(event.target.value)} onKeyDown={handleKeyDown} rows={1} />
        </div>
        <button className="send-btn" onClick={() => void handleSend()} disabled={(!inputText.trim() && !attachedFile) || sending || uploading} title={attachedFile ? 'Gửi tệp và tin nhắn' : 'Gửi (Enter)'}>{sending || uploading ? <div className="spinner spinner-sm" style={{ borderTopColor: 'white' }} /> : <Send size={18} />}</button>
      </div>

      {forwardIds && (
        <div className="forward-dialog-backdrop" onClick={() => !actionBusy && setForwardIds(null)}>
          <div className="forward-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="forward-dialog-header"><div><strong>Chuyển tiếp tin nhắn</strong><span>{forwardIds.length} tin nhắn được chọn</span></div><button className="icon-btn" onClick={() => setForwardIds(null)} aria-label="Đóng"><X size={17} /></button></div>
            <div className="forward-chat-list">{chats.filter((item) => item.id !== chat.id).map((item) => <button key={item.id} disabled={actionBusy} onClick={() => void runForward(item.id)}><span className="forward-chat-avatar">{getInitials(item.title)}</span><span>{item.title}</span><Forward size={15} /></button>)}</div>
            {actionBusy && <div className="forward-loading">Đang chuyển tiếp…</div>}
          </div>
        </div>
      )}
    </div>
  );
}
