'use client';

import React, { useEffect, useState } from 'react';
import { Bot, CheckCircle2, CircleAlert, KeyRound, Plus, Power, RefreshCw, Save, X } from 'lucide-react';
import { createManagedBot, fetchManagedBots, setManagedBotEnabled, updateManagedBot, validateManagedBot } from '@/lib/api';
import { ManagedBot } from '@/types';

type EditorMode = 'create' | 'edit' | null;

export default function BotManagement() {
  const [bots, setBots] = useState<ManagedBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<EditorMode>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checking, setChecking] = useState(false);
  const [changingEnabled, setChangingEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => fetchManagedBots()
      .then((items) => { if (active) setBots(items); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Không tải được danh sách bot'); })
      .finally(() => { if (active) setLoading(false); });
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const selectBot = (bot: ManagedBot) => {
    setSelectedId(bot.id);
    setMode('edit');
    setName(bot.name);
    setToken('');
    setError('');
    setNotice('');
  };

  const startCreate = () => {
    setSelectedId(null);
    setMode('create');
    setName('');
    setToken('');
    setError('');
    setNotice('');
  };

  const closeEditor = () => {
    setMode(null);
    setSelectedId(null);
    setName('');
    setToken('');
    setError('');
  };

  const saveBot = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving || (mode === 'create' && !token.trim())) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'create') {
        const created = await createManagedBot(name.trim(), token.trim());
        setBots((current) => [created, ...current]);
        setSelectedId(created.id);
        setMode('edit');
        setName(created.name);
        setToken('');
        setNotice('Đã thêm bot. Token được ẩn sau khi lưu.');
      } else if (mode === 'edit' && selectedId) {
        const updated = await updateManagedBot(selectedId, name.trim(), token.trim() || undefined);
        setBots((current) => current.map((bot) => bot.id === updated.id ? updated : bot));
        setName(updated.name);
        setToken('');
        setNotice('Đã lưu thay đổi.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không lưu được thông tin bot');
    } finally {
      setSaving(false);
    }
  };

  const checkConnection = async () => {
    if (!selectedId || checking) return;
    setChecking(true);
    setError('');
    setNotice('');
    try {
      const updated = await validateManagedBot(selectedId);
      setBots((current) => current.map((bot) => bot.id === updated.id ? updated : bot));
      setNotice(`Đã xác thực với Telegram${updated.username ? `: @${updated.username}` : ''}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không xác thực được token');
      try {
        const latest = await fetchManagedBots();
        setBots(latest);
      } catch { /* Giữ lỗi xác thực để hiển thị */ }
    } finally {
      setChecking(false);
    }
  };

  const toggleEnabled = async () => {
    if (!selectedBot || changingEnabled) return;
    setChangingEnabled(true);
    setError('');
    setNotice('');
    try {
      const updated = await setManagedBotEnabled(selectedBot.id, !selectedBot.isEnabled);
      setBots((current) => current.map((bot) => bot.id === updated.id ? updated : bot));
      setNotice(updated.isEnabled ? 'Đã bật trạng thái bot.' : 'Đã tắt trạng thái bot.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không đổi được trạng thái bot');
    } finally {
      setChangingEnabled(false);
    }
  };

  const statusLabel = (bot: ManagedBot) => bot.status === 'error' ? 'Lỗi xác thực' : bot.status === 'connected' ? 'Đã xác thực' : bot.status === 'disabled' ? 'Đã tắt' : 'Chưa kiểm tra';

  const selectedBot = bots.find((bot) => bot.id === selectedId);

  return (
    <main className="bot-management-page">
      <header className="bot-management-header">
        <div>
          <div className="bot-management-eyebrow">TELEVAGA</div>
          <h1>Quản lý bot</h1>
          <p>Danh sách bot và thông tin token được lưu trong hệ thống.</p>
        </div>
        <button type="button" className="bot-primary-button" onClick={startCreate}><Plus size={18} /> Thêm bot</button>
      </header>

      <div className="bot-management-content">
        <section className="bot-list-panel">
          <div className="bot-list-heading"><strong>Bot đang quản lý</strong><span>{bots.length}</span></div>
          {loading ? <div className="bot-empty-state">Đang tải danh sách bot...</div> : bots.length ? (
            <div className="bot-list-items">
              {bots.map((bot) => <button type="button" key={bot.id} className={'bot-list-item' + (selectedId === bot.id ? ' selected' : '')} onClick={() => selectBot(bot)}>
                <span className="bot-list-icon"><Bot size={20} /></span>
                <span className="bot-list-copy"><strong>{bot.name}</strong><small><KeyRound size={12} /> {bot.tokenHint}</small></span>
                <span className={'bot-saved-status bot-status-' + bot.status}>{bot.isEnabled ? 'Đang bật' : statusLabel(bot)}</span>
              </button>)}
            </div>
          ) : <div className="bot-empty-state"><Bot size={30} /><strong>Chưa có bot nào</strong><span>Thêm bot đầu tiên bằng tên và token.</span></div>}
        </section>

        <section className="bot-editor-panel">
          {mode ? <>
            <form onSubmit={(event) => void saveBot(event)}>
            <div className="bot-editor-heading">
              <div><span>{mode === 'create' ? 'BOT MỚI' : 'THÔNG TIN BOT'}</span><h2>{mode === 'create' ? 'Thêm bot' : 'Chỉnh sửa bot'}</h2></div>
              <button type="button" className="bot-close-button" onClick={closeEditor} aria-label="Đóng"><X size={19} /></button>
            </div>
            {mode === 'edit' && selectedBot && <div className="bot-current-token"><KeyRound size={16} /><span>Token hiện tại: <strong>{selectedBot.tokenHint}</strong></span></div>}
            {mode === 'edit' && selectedBot && <div className={'bot-telegram-status bot-status-' + selectedBot.status}>
              {selectedBot.status === 'connected' ? <CheckCircle2 size={17} /> : selectedBot.status === 'error' ? <CircleAlert size={17} /> : <Bot size={17} />}
              <span><strong>{statusLabel(selectedBot)}</strong>{selectedBot.username ? ` · @${selectedBot.username}` : ''}{selectedBot.telegramBotId ? ` · ID ${selectedBot.telegramBotId}` : ''}{selectedBot.runtime?.polling ? ' · Polling đang chạy' : selectedBot.isEnabled ? ' · Worker chưa chạy' : ''}{selectedBot.runtime?.lastUpdateAt ? ` · Nhận cập nhật ${new Date(selectedBot.runtime.lastUpdateAt).toLocaleTimeString('vi-VN')}` : ''}{selectedBot.runtime?.lastError ? ` · Lỗi polling: ${selectedBot.runtime.lastError}` : selectedBot.lastError ? ` · ${selectedBot.lastError}` : ''}</span>
            </div>}
            <label className="bot-form-label">Tên bot<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Ví dụ: Bot hỗ trợ khách hàng" /></label>
            <label className="bot-form-label">{mode === 'create' ? 'Token bot' : 'Token mới (để trống nếu giữ token hiện tại)'}<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="new-password" placeholder={mode === 'create' ? 'Dán token bot tại đây' : 'Dán token mới để thay đổi'} required={mode === 'create'} /></label>
            <p className="bot-token-note">Token được ẩn sau khi lưu. Bot đang bật sẽ nhận tin qua worker riêng; menu nút được gửi khi khách nhắn /start.</p>
            {error && <div className="bot-form-error" role="alert">{error}</div>}
            {notice && <div className="bot-form-notice" role="status">{notice}</div>}
            {mode === 'edit' && selectedBot && <div className="bot-management-actions">
              <button type="button" className="bot-secondary-button" onClick={() => void checkConnection()} disabled={checking || saving}>{checking ? 'Đang kiểm tra...' : <><RefreshCw size={15} /> Kiểm tra kết nối</>}</button>
              <button type="button" className="bot-secondary-button" onClick={() => void toggleEnabled()} disabled={changingEnabled || selectedBot.status === 'error' || (!selectedBot.isEnabled && selectedBot.status !== 'connected' && !selectedBot.telegramBotId)}>
                <Power size={15} /> {changingEnabled ? 'Đang cập nhật...' : selectedBot.isEnabled ? 'Tắt bot' : 'Bật bot'}
              </button>
            </div>}
            <div className="bot-form-actions"><button type="button" className="bot-secondary-button" onClick={closeEditor}>Hủy</button><button type="submit" className="bot-primary-button" disabled={saving || !name.trim() || (mode === 'create' && !token.trim())}>{saving ? 'Đang lưu...' : <><Save size={16} /> Lưu bot</>}</button></div>
            </form>
          </> : <div className="bot-editor-placeholder"><Bot size={42} /><strong>Quản lý thông tin bot</strong><span>Chọn một bot trong danh sách để sửa tên hoặc token, hoặc nhấn “Thêm bot”.</span></div>}
        </section>
      </div>
    </main>
  );
}
