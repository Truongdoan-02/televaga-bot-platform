'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, FileText, Link as LinkIcon, Pencil, Phone, Plus, UsersRound, X } from 'lucide-react';
import { Chat, Message, User } from '@/types';
import { fetchUsers } from '@/lib/api';

interface UserInfoPanelProps {
  chat: Chat | null;
  messages: Message[];
  isOpen: boolean;
  onClose: () => void;
  onUpdateChat: (updates: Partial<Chat>) => Promise<void>;
  onOpenMemberChat: (member: User) => void;
}

type InfoTab = 'members' | 'media' | 'files' | 'links' | 'music' | 'gif' | 'voice';
const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';
const AVATAR_COLORS = ['#4f81c7', '#43a89f', '#c05c7e', '#7c62b5', '#e07654', '#6ab04c'];
const displayName = (user: User) => [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
const initials = (title: string) => title.trim().split(/\s+/).map((word) => word[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
const avatarColor = (name: string) => AVATAR_COLORS[Math.abs([...name].reduce((hash, char) => hash * 31 + char.charCodeAt(0), 0)) % AVATAR_COLORS.length];
const mediaUrl = (url?: string) => !url ? '' : url.startsWith('http') ? url : API_BASE + url;
const fileExtension = (message: Message) => (message.fileName || message.mediaUrl || '').split('?')[0].split('.').pop()?.toLowerCase() || '';
const linkPattern = /https?:\/\/[^\s]+/i;

export default function UserInfoPanel({ chat, messages, isOpen, onClose, onUpdateChat, onOpenMemberChat }: UserInfoPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [tab, setTab] = useState<InfoTab>('media');
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [addingMembers, setAddingMembers] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const participants = chat?.participants?.filter((user) => user.id !== 'user_agent_me') || [];
  const participant = participants[0];
  const isGroup = chat?.type === 'group';
  const isInternalGroup = Boolean(chat?.telegramChatId.startsWith('mock_group_'));

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      // Keep information visible when scrolling or selecting another conversation.
      if (target instanceof Element && target.closest('[data-scroll-to-latest], .chat-item, .sidebar-forum-topic')) return;
      if (panelRef.current && target instanceof Node && !panelRef.current.contains(target)) onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    setTab(chat?.type === 'group' ? 'members' : 'media');
    setEditing(false);
    setAddMembersOpen(false);
  }, [chat?.id, chat?.type]);

  const filteredMessages = useMemo(() => {
    if (tab === 'members' || !chat) return [];
    return messages.filter((message) => {
      const ext = fileExtension(message);
      if (tab === 'media') return (message.type === 'image' || message.type === 'video') && Boolean(message.mediaUrl);
      if (tab === 'files') return message.type === 'document' && !['gif', 'mp3', 'm4a', 'ogg', 'wav'].includes(ext);
      if (tab === 'links') return linkPattern.test(message.text);
      if (tab === 'music') return message.type === 'audio' && !['oga', 'ogg', 'opus'].includes(ext);
      if (tab === 'gif') return ext === 'gif' || message.text.toLowerCase().includes('.gif');
      if (tab === 'voice') return message.type === 'audio' && ['oga', 'ogg', 'opus'].includes(ext);
      return false;
    });
  }, [chat, messages, tab]);

  if (!chat || !isOpen) return null;

  const toggleNotifications = async () => {
    try { await onUpdateChat({ isMuted: !chat.isMuted }); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Không cập nhật được thông báo'); }
  };

  const saveName = async () => {
    const name = draftName.trim();
    if (!name || saving) return;
    setSaving(true);
    try { await onUpdateChat({ title: name }); setEditing(false); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Không lưu được tên'); }
    finally { setSaving(false); }
  };

  const openAddMembers = async () => {
    setAddMembersOpen(true);
    setLoadingUsers(true);
    try {
      const users = await fetchUsers();
      setAvailableUsers(users.filter((user) => !chat.participantIds.includes(user.id)));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không tải được thành viên'); }
    finally { setLoadingUsers(false); }
  };

  const addMembers = async () => {
    if (!selectedMemberIds.length || addingMembers) return;
    setAddingMembers(true);
    try {
      await onUpdateChat({ participantIds: [...new Set([...chat.participantIds, ...selectedMemberIds])] });
      setAddMembersOpen(false);
      setSelectedMemberIds([]);
      setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thêm được thành viên'); }
    finally { setAddingMembers(false); }
  };

  const tabs: { key: InfoTab; label: string }[] = [
    ...(isGroup ? [{ key: 'members' as const, label: 'Members' }] : []),
    { key: 'media', label: 'Media' }, { key: 'files', label: 'Files' }, { key: 'links', label: 'Links' },
    { key: 'music', label: 'Music' }, { key: 'gif', label: 'GIF' }, { key: 'voice', label: 'Voice' },
  ];
  const actionButton: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 40, height: 40, border: 0, borderRadius: '50%', background: 'transparent', color: '#eee', cursor: 'pointer', flexShrink: 0 };
  const displayTitle = chat.title;
  const subtitle = isGroup ? chat.participantIds.length + ' members' : participant?.isOnline ? 'online' : 'last seen ' + (participant?.lastSeen || 'recently');

  return (
    <aside ref={panelRef} style={{ position: isMobile ? 'fixed' : 'relative', inset: isMobile ? '0' : undefined, zIndex: isMobile ? 11000 : 30, display: 'flex', flexDirection: 'column', width: isMobile ? '100vw' : 'min(380px, 38vw)', minWidth: isMobile ? 0 : 300, maxWidth: isMobile ? '100vw' : undefined, height: isMobile ? '100dvh' : '100%', flex: isMobile ? '0 0 100vw' : undefined, flexShrink: 0, boxSizing: 'border-box', overflow: 'hidden', borderLeft: isMobile ? 'none' : '1px solid var(--tg-border, #344252)', background: 'var(--tg-bg-secondary, #232e3c)', color: '#f4f4f5' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 64, padding: '0 14px' }}>
        <button style={actionButton} onClick={onClose} title="Close"><X size={23} /></button>
        <strong style={{ flex: 1, fontSize: 20 }}>{isGroup ? 'Group Info' : 'User Info'}</strong>
        <button style={actionButton} onClick={() => { setDraftName(chat.title); setEditing((value) => !value); }} title="Edit name"><Pencil size={21} /></button>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehaviorY: 'contain', paddingBottom: 16 }}>
        <section style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 18px 26px', textAlign: 'center' }}>
          {chat.avatarUrl ? <img src={chat.avatarUrl} alt={displayTitle} style={{ width: 116, height: 116, borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ display: 'grid', placeItems: 'center', width: 116, height: 116, borderRadius: '50%', background: avatarColor(displayTitle), color: '#fff', fontSize: 38, fontWeight: 700 }}>{isGroup ? <UsersRound size={46} /> : initials(displayTitle)}</div>}
          {editing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', marginTop: 18 }}>
              <input autoFocus value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={80} style={{ minWidth: 0, flex: 1, height: 40, padding: '0 10px', border: '1px solid #444', borderRadius: 8, background: 'var(--tg-bg-tertiary, #1c2733)', color: '#fff', fontSize: 15 }} />
              <button onClick={() => void saveName()} disabled={!draftName.trim() || saving} style={{ ...actionButton, background: '#8b72e8' }} title="Save"><Check size={20} /></button>
              <button onClick={() => setEditing(false)} style={actionButton} title="Cancel"><X size={20} /></button>
            </div>
          ) : <strong style={{ width: '100%', marginTop: 20, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 20 }}>{displayTitle}</strong>}
          <span style={{ marginTop: 4, color: isGroup || participant?.isOnline ? '#a78bfa' : '#aaa', fontSize: 14 }}>{subtitle}</span>
          {!isGroup && participant?.username && <span style={{ marginTop: 5, color: '#999', fontSize: 13 }}>@{participant.username}</span>}
        </section>

        <section style={{ margin: '0 12px 14px', padding: '4px 12px', borderRadius: 24, background: 'var(--tg-bg-hover, #2b3a4e)' }}>
          {!isGroup && participant?.phoneNumber && <div style={{ display: 'flex', alignItems: 'center', gap: 13, minHeight: 62 }}><span style={{ display: 'grid', placeItems: 'center', width: 35, height: 35, borderRadius: 10, background: '#50bd75' }}><Phone size={19} color="white" /></span><div><strong style={{ fontSize: 14 }}>{participant.phoneNumber}</strong><div style={{ marginTop: 3, color: '#aaa', fontSize: 13 }}>Phone</div></div></div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, minHeight: 62 }}><span style={{ display: 'grid', placeItems: 'center', width: 35, height: 35, borderRadius: 10, background: '#f04f4f' }}><Bell size={19} color="white" fill="white" /></span><strong style={{ flex: 1, fontSize: 14 }}>Notifications</strong><button role="switch" aria-checked={!chat.isMuted} onClick={() => void toggleNotifications()} style={{ width: 39, height: 22, padding: 2, border: 0, borderRadius: 14, background: chat.isMuted ? '#555' : '#8b72e8', cursor: 'pointer' }}><span style={{ display: 'block', width: 18, height: 18, marginLeft: chat.isMuted ? 0 : 17, borderRadius: '50%', background: '#fff', transition: 'margin .15s' }} /></button></div>
        </section>

        <nav onWheel={(event) => { if (event.currentTarget.scrollWidth > event.currentTarget.clientWidth) event.currentTarget.scrollLeft += event.deltaY; }} style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', flex: '0 0 auto', flexWrap: 'nowrap', gap: 3, margin: '0 12px 14px', padding: 5, overflowX: 'auto', overflowY: 'hidden', borderRadius: 24, background: 'var(--tg-bg-hover, #2b3a4e)', scrollbarWidth: 'thin', scrollbarColor: '#7c8ca3 transparent', overscrollBehaviorX: 'contain' }}>
          {tabs.map((item) => <button key={item.key} onClick={(event) => { setTab(item.key); event.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); }} style={{ flex: '0 0 auto', minHeight: 38, padding: '0 14px', border: 0, borderRadius: 20, background: tab === item.key ? '#302b3e' : 'transparent', color: tab === item.key ? '#9a83ff' : '#c4c4c4', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }}>{item.label}</button>)}
        </nav>

        {error && <div style={{ margin: '0 16px 12px', color: '#ff7777', fontSize: 12 }}>{error}</div>}
        {isGroup && tab === 'members' ? (
          <section style={{ position: 'relative', minHeight: 120, margin: '0 12px', padding: '8px 10px 60px', borderRadius: 24, background: 'var(--tg-bg-hover, #2b3a4e)' }}>
            {participants.map((member) => <button key={member.id} type="button" onClick={() => onOpenMemberChat(member)} title={'Mở cuộc trò chuyện với ' + displayName(member)} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', minHeight: 67, padding: '0 4px', border: 0, borderRadius: 12, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
              {member.avatarUrl ? <img src={member.avatarUrl} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ display: 'grid', placeItems: 'center', width: 48, height: 48, borderRadius: '50%', background: avatarColor(displayName(member)), color: '#fff', fontWeight: 700 }}>{initials(displayName(member))}</div>}
              <div style={{ minWidth: 0 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{displayName(member)}</strong><span style={{ display: 'block', marginTop: 3, color: member.isOnline ? '#a78bfa' : '#aaa', fontSize: 13 }}>{member.isOnline ? 'online' : 'last seen ' + (member.lastSeen || 'recently')}</span></div>
            </button>)}
            {isInternalGroup && <button onClick={() => void openAddMembers()} title="Add Members" style={{ position: 'absolute', right: 12, bottom: 12, display: 'grid', placeItems: 'center', width: 48, height: 48, border: 0, borderRadius: '50%', background: '#8b72e8', color: '#fff', cursor: 'pointer' }}><Plus size={24} /><UsersRound size={16} style={{ position: 'absolute', right: 8, bottom: 7 }} /></button>}
          </section>
        ) : filteredMessages.length ? (
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, padding: '0 12px' }}>
            {filteredMessages.map((message) => {
              const url = mediaUrl(message.mediaUrl);
              if (tab === 'links') return <a key={message.id} href={message.text.match(linkPattern)?.[0]} target="_blank" rel="noreferrer" style={{ gridColumn: '1 / -1', padding: 12, borderRadius: 12, background: 'var(--tg-bg-hover, #2b3a4e)', color: '#9a83ff', overflowWrap: 'anywhere' }}><LinkIcon size={15} style={{ verticalAlign: 'middle', marginRight: 8 }} />{message.text.match(linkPattern)?.[0]}</a>;
              if ((message.type === 'image' || fileExtension(message) === 'gif') && url) return <a key={message.id} href={url} target="_blank" rel="noreferrer"><img src={url} alt={message.fileName || 'Media'} style={{ width: '100%', aspectRatio: '1', borderRadius: 13, objectFit: 'cover' }} /></a>;
              if (message.type === 'video' && url) return <video key={message.id} src={url} controls style={{ width: '100%', borderRadius: 13 }} />;
              return <a key={message.id} href={url || '#'} target="_blank" rel="noreferrer" download={message.fileName || true} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: 12, borderRadius: 12, background: 'var(--tg-bg-hover, #2b3a4e)', color: '#eee', textDecoration: 'none', overflowWrap: 'anywhere' }}><FileText size={19} /><span style={{ fontSize: 12 }}>{message.fileName || message.text}</span></a>;
            })}
          </section>
        ) : <div style={{ padding: '30px 18px', color: '#777', fontSize: 13, textAlign: 'center' }}>No {tab} yet</div>}
      </div>

      {addMembersOpen && <div onClick={() => setAddMembersOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 14000, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(0,0,0,.6)' }}><div onClick={(event) => event.stopPropagation()} style={{ width: 'min(440px, 100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', borderRadius: 16, background: 'var(--tg-bg-hover, #2b3a4e)', color: '#fff', overflow: 'hidden' }}><header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}><strong>Add Members</strong><button onClick={() => setAddMembersOpen(false)} style={actionButton}><X /></button></header><div style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }}>{loadingUsers ? 'Loading...' : availableUsers.map((user) => { const selected = selectedMemberIds.includes(user.id); return <button key={user.id} onClick={() => setSelectedMemberIds((ids) => selected ? ids.filter((id) => id !== user.id) : [...ids, user.id])} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 58, border: 0, background: 'transparent', color: '#fff', textAlign: 'left' }}>{user.avatarUrl ? <img src={user.avatarUrl} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} /> : <span style={{ display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: '50%', background: avatarColor(displayName(user)) }}>{initials(displayName(user))}</span>}<span style={{ flex: 1 }}>{displayName(user)}</span><span style={{ width: 21, height: 21, border: '1px solid #777', borderRadius: 5, background: selected ? '#8b72e8' : 'transparent' }}>{selected && <Check size={18} />}</span></button>; })}</div><footer style={{ display: 'flex', justifyContent: 'flex-end', padding: 14 }}><button disabled={!selectedMemberIds.length || addingMembers} onClick={() => void addMembers()} style={{ padding: '10px 18px', border: 0, borderRadius: 12, background: '#8b72e8', color: '#fff', opacity: selectedMemberIds.length ? 1 : .5 }}>{addingMembers ? 'Adding...' : 'Add'}</button></footer></div></div>}
    </aside>
  );
}
