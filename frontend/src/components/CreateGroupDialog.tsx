'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, UsersRound, X } from 'lucide-react';
import { Chat, User } from '@/types';
import { createGroupChat, fetchUsers } from '@/lib/api';

interface CreateGroupDialogProps {
  onClose: () => void;
  onCreated: (chat: Chat) => void;
}

const AVATAR_COLORS = ['#4f81c7', '#43a89f', '#c05c7e', '#7c62b5', '#e07654', '#6ab04c'];
const displayName = (user: User) => [user.firstName, user.lastName].filter(Boolean).join(' ').trim();

export default function CreateGroupDialog({ onClose, onCreated }: CreateGroupDialogProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [step, setStep] = useState<'members' | 'details'>('members');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    fetchUsers().then(setUsers).catch((error) => setLoadError(error instanceof Error ? error.message : 'Không tải được danh sách thành viên')).finally(() => setLoading(false));
  }, []);

  const filteredUsers = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    if (!value) return users;
    return users.filter((user) => (displayName(user) + ' ' + (user.username || '')).toLocaleLowerCase().includes(value));
  }, [query, users]);
  const selectedUsers = users.filter((user) => selectedIds.includes(user.id));

  const toggleUser = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const getInitials = (user: User) => displayName(user).split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  const getColor = (name: string) => AVATAR_COLORS[Math.abs([...name].reduce((hash, char) => hash * 31 + char.charCodeAt(0), 0)) % AVATAR_COLORS.length];

  const create = async () => {
    if (!title.trim() || selectedIds.length === 0 || creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const chat = await createGroupChat(title.trim(), selectedIds);
      onCreated(chat);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Không tạo được nhóm');
    } finally {
      setCreating(false);
    }
  };

  const buttonStyle: React.CSSProperties = { border: 0, background: 'transparent', color: '#f4f4f5', cursor: 'pointer' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 13000, display: 'grid', placeItems: 'center', padding: 12, background: 'rgba(0,0,0,.58)' }}>
      <section onClick={(event) => event.stopPropagation()} style={{ width: 'min(475px, 100%)', height: 'min(860px, calc(100vh - 24px))', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #303030', borderRadius: 18, background: '#212121', color: '#f5f5f5', boxShadow: '0 20px 55px rgba(0,0,0,.5)' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 18, minHeight: 64, padding: '0 16px' }}>
          <button onClick={() => step === 'details' ? setStep('members') : onClose()} aria-label="Quay lại" style={{ ...buttonStyle, display: 'grid', placeItems: 'center', width: 36, height: 36 }}><ArrowLeft size={23} /></button>
          <div style={{ fontSize: 21, fontWeight: 650 }}>{step === 'members' ? 'Add Members' : 'New Group'}</div>
          {step === 'details' && <span style={{ marginLeft: 'auto', color: '#aaa', fontSize: 13 }}>{selectedIds.length} thành viên</span>}
        </header>

        {step === 'members' ? (
          <>
            <div style={{ padding: '8px 16px 14px', borderBottom: '1px solid #333' }}>
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Who would you like to add?" aria-label="Tìm thành viên" style={{ width: '100%', height: 40, border: 0, outline: 0, background: 'transparent', color: '#f5f5f5', fontSize: 16 }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 7px' }}>
              {loading && <div style={{ padding: 24, color: '#aaa', textAlign: 'center' }}>Đang tải thành viên...</div>}
              {!loading && loadError && <div style={{ padding: 24, color: '#ff7777', textAlign: 'center' }}>{loadError}</div>}
              {!loading && !loadError && users.length === 0 && <div style={{ padding: 24, color: '#aaa', textAlign: 'center' }}>Chưa có thành viên Telegram. Hãy để họ nhắn bot trước.</div>}
              {!loading && !loadError && users.length > 0 && filteredUsers.length === 0 && <div style={{ padding: 24, color: '#aaa', textAlign: 'center' }}>Không tìm thấy thành viên.</div>}
              {filteredUsers.map((user) => {
                const name = displayName(user);
                const selected = selectedIds.includes(user.id);
                return (
                  <button key={user.id} onClick={() => toggleUser(user.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 63, padding: '7px 10px', border: 0, borderRadius: 13, background: selected ? '#2b2b2b' : 'transparent', color: '#f5f5f5', textAlign: 'left', cursor: 'pointer' }}>
                    {user.avatarUrl ? <img src={user.avatarUrl} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} /> : <div style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: '50%', background: getColor(name), color: '#fff', fontWeight: 700, flexShrink: 0 }}>{getInitials(user)}</div>}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 650, fontSize: 15 }}>{name || user.username || 'Người dùng Telegram'}</span>
                      <span style={{ display: 'block', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#aaa', fontSize: 13 }}>{user.isOnline ? 'đang hoạt động' : 'last seen ' + (user.lastSeen || 'gần đây')}</span>
                    </span>
                    <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 22, height: 22, border: selected ? '1px solid #8b72e8' : '2px solid #666', borderRadius: 6, background: selected ? '#8b72e8' : 'transparent', color: '#fff', flexShrink: 0 }}>{selected && <Check size={16} />}</span>
                  </button>
                );
              })}
            </div>
            <footer style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, minHeight: 78, padding: '0 16px' }}>
              <span style={{ marginRight: 'auto', color: '#aaa', fontSize: 13 }}>{selectedIds.length ? selectedIds.length + ' đã chọn' : ''}</span>
              <button disabled={!selectedIds.length} onClick={() => setStep('details')} aria-label="Tiếp tục" style={{ ...buttonStyle, display: 'grid', placeItems: 'center', width: 54, height: 54, borderRadius: '50%', background: selectedIds.length ? '#8774e1' : '#4a4a4a', color: 'white', opacity: selectedIds.length ? 1 : .6 }}><ArrowRight size={24} /></button>
            </footer>
          </>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              <div style={{ display: 'grid', placeItems: 'center', margin: '12px 0 22px' }}><div style={{ display: 'grid', placeItems: 'center', width: 92, height: 92, borderRadius: '50%', background: '#8774e1' }}><UsersRound size={42} /></div></div>
              <label style={{ display: 'block', marginBottom: 8, color: '#aaa', fontSize: 13 }}>Tên nhóm</label>
              <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="Nhập tên nhóm" style={{ width: '100%', height: 48, padding: '0 12px', border: '1px solid #444', borderRadius: 10, outline: 0, background: '#292929', color: '#fff', fontSize: 16 }} />
              <div style={{ margin: '18px 0 8px', color: '#aaa', fontSize: 13 }}>Thành viên ({selectedUsers.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{selectedUsers.map((user) => <span key={user.id} style={{ padding: '7px 10px', borderRadius: 16, background: '#343434', fontSize: 13 }}>{displayName(user)}</span>)}</div>
              <p style={{ marginTop: 22, color: '#aaa', fontSize: 12, lineHeight: 1.5 }}>Nhóm này được tạo trong TeleVaga. Muốn tạo nhóm Telegram thật, hãy tạo nhóm trên Telegram rồi thêm bot vào nhóm.</p>
              {createError && <div style={{ marginTop: 14, color: '#ff7777', fontSize: 13 }}>{createError}</div>}
            </div>
            <footer style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', minHeight: 78, padding: '0 16px' }}>
              <button disabled={!title.trim() || creating} onClick={() => void create()} style={{ ...buttonStyle, display: 'grid', placeItems: 'center', width: 54, height: 54, borderRadius: '50%', background: title.trim() ? '#8774e1' : '#4a4a4a', color: 'white', opacity: title.trim() ? 1 : .6 }}>{creating ? <span className="spinner spinner-sm" /> : <Check size={24} />}</button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
