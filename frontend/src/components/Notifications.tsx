'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, Plus, RefreshCw, Send, X, Search, Megaphone, CheckCircle2, Clock3, AlertCircle, Wrench, Eye } from 'lucide-react';
import { broadcastAction, createBroadcast, fetchBroadcastAudience, fetchBroadcastDetail, fetchBroadcasts, fetchManagedBots, updateMaintenance, type BroadcastItem, type BroadcastDetail, type BroadcastInput, type MaintenanceSettings } from '@/lib/api';
import { ManagedBot } from '@/types';
import Image from 'next/image';
import TelegramHtmlPreview from './TelegramHtmlPreview';
import { uploadBroadcastImage, broadcastImageSrc } from '@/lib/api';
import './notifications.css';

const statuses: Record<string, string> = { draft: 'Bản nháp', scheduled: 'Đã đặt lịch', queued: 'Chờ gửi', sending: 'Đang gửi', completed: 'Hoàn tất', partial: 'Có lỗi', cancelled: 'Đã hủy' };
const audiences: Record<string, string> = { everyone: 'Tất cả: khách, nhóm, kênh và topic', groups: 'Nhóm, kênh và topic', all: 'Tất cả khách hàng (chat riêng)', active: 'Hoạt động trong 30 ngày', vip: 'Khách VIP', sales: 'Nhóm Sales', support: 'Nhóm Hỗ trợ' };
const initial: BroadcastInput = { title: '', content: '', botId: '', audience: 'all', parseMode: '', imageUrl: '', buttonText: '', buttonUrl: '', scheduledAt: null };
const date = (value: string | null) => value ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' }) : '—';

export default function Notifications() {
  const [items, setItems] = useState<BroadcastItem[]>([]);
  const [bots, setBots] = useState<ManagedBot[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceSettings>({ enabled: false, message: '', notifyStart: false, notifyEnd: false });
  const [savedMaintenance, setSavedMaintenance] = useState(false);
  const [maintenanceDirty, setMaintenanceDirty] = useState(false);
  const [maintenanceBot, setMaintenanceBot] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [editor, setEditor] = useState(false);
  const [form, setForm] = useState<BroadcastInput>(initial);
  const [sendNow, setSendNow] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const [schedule, setSchedule] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [detail, setDetail] = useState<BroadcastDetail | null>(null);
  const [uploading, setUploading] = useState(false);
  const enabledBots = bots.filter(bot => bot.isEnabled && bot.mode !== 'mock');
  const refresh = useCallback(async () => {
    const [data, managed] = await Promise.all([fetchBroadcasts(), fetchManagedBots()]);
    setItems(data.items); setBots(managed); setSavedMaintenance(data.maintenance.enabled);
    if (!maintenanceDirty) setMaintenance(data.maintenance);
  }, [maintenanceDirty]);
  useEffect(() => {
    let active = true;
    const load = async () => { try { if (active) await refresh(); } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : 'Không tải được thông báo.'); } finally { if (active) setLoading(false); } };
    void load(); const timer = setInterval(() => void load(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [refresh]);
  useEffect(() => {
    if (!editor || !form.botId) return;
    let active = true;
    fetchBroadcastAudience(form.botId, form.audience).then(data => { if (active) setCount(data.count); }).catch(() => { if (active) setCount(null); });
    return () => { active = false; };
  }, [editor, form.botId, form.audience]);
  useEffect(() => {
    if (!editor && !detail) return;
    const previous = document.activeElement as HTMLElement | null;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy && !uploading) { setEditor(false); setDetail(null); }
      if (event.key !== 'Tab') return;
      const controls = document.querySelector('.broadcast-dialog')?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus(); };
  }, [editor, detail, busy, uploading]);
  const run = async (operation: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await operation(); await refresh(); setNotice(success); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Thao tác thất bại.'); }
    finally { setBusy(false); }
  };
  const openCreate = () => { setForm({ ...initial, botId: enabledBots[0]?.id || '' }); setSendNow(false); setScheduled(false); setSchedule(''); setCount(null); setError(''); setEditor(true); };
  const field = (key: keyof BroadcastInput, value: string) => { setForm(current => ({ ...current, [key]: value })); if (key === 'botId' || key === 'audience') setCount(null); };
  const selectImage = async (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError('Chọn ảnh JPG, PNG hoặc WebP tối đa 10 MB.'); return; }
    setUploading(true); setError('');
    try { const result = await uploadBroadcastImage(file); field('imageUrl', result.imageUrl); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Không tải được ảnh.'); }
    finally { setUploading(false); }
  };
  const changeMaintenance = (changes: Partial<MaintenanceSettings>) => { setMaintenance(current => ({ ...current, ...changes })); setMaintenanceDirty(true); };
  const submit = () => void run(async () => {
    if (scheduled && (!schedule || !Number.isFinite(new Date(schedule).getTime()) || new Date(schedule).getTime() <= Date.now())) throw new Error('Chọn thời gian gửi trong tương lai.');
    await createBroadcast({ ...form, scheduledAt: scheduled ? new Date(schedule).toISOString() : null }, sendNow); setEditor(false);
  }, scheduled ? 'Đã đặt lịch gửi.' : sendNow ? 'Đã đưa thông báo vào hàng đợi.' : 'Đã lưu bản nháp.');
  const visible = items.filter(item => (!filter || item.status === filter) && `${item.title} ${item.content}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')));
  const length = form.title.length + form.content.length + 2, limit = form.imageUrl ? 1024 : 4096;

  return <main className="notifications-page">
    <header className="broadcast-header"><div><div className="broadcast-eyebrow">TELEVAGA · TELEGRAM</div><h1>Thông báo & Broadcast</h1><p>Gửi chương trình sale và cập nhật mới đến khách hàng của từng bot.</p></div><div className="broadcast-actions"><button className="bot-secondary-button" disabled={busy} onClick={() => void run(refresh, 'Đã làm mới.')}><RefreshCw size={16} /> Làm mới</button><button className="bot-primary-button" onClick={openCreate}><Plus size={17} /> Tạo broadcast</button></div></header>
    {error && <div className="bot-form-error" role="alert">{error}</div>}{notice && <div className="bot-form-notice" role="status">{notice}</div>}
    <div className="broadcast-stats"><div><Megaphone size={20} /><span>Tổng đợt gửi<strong>{items.length}</strong></span></div><div><CheckCircle2 size={20} /><span>Tin gửi thành công<strong>{items.reduce((sum, item) => sum + item.sent, 0)}</strong></span></div><div><Clock3 size={20} /><span>Đang chờ / đang gửi<strong>{items.filter(i => ['scheduled', 'queued', 'sending'].includes(i.status)).length}</strong></span></div><div><AlertCircle size={20} /><span>Tin gửi lỗi<strong>{items.reduce((sum, item) => sum + item.failed, 0)}</strong></span></div></div>
    <section className="broadcast-card maintenance-card">
      <div className="broadcast-card-heading"><h2><Wrench size={18} /> Trạng thái hệ thống <span className={`broadcast-badge ${savedMaintenance ? 'partial' : 'completed'}`}>{savedMaintenance ? 'ĐANG BẢO TRÌ' : 'HOẠT ĐỘNG BÌNH THƯỜNG'}</span></h2><button className="bot-secondary-button" disabled={busy || loading} onClick={() => void run(async () => { const value = await updateMaintenance({ ...maintenance, enabled: !savedMaintenance }, maintenanceBot); setMaintenance(value); setMaintenanceDirty(false); }, savedMaintenance ? 'Đã kết thúc bảo trì.' : 'Đã bật bảo trì.')}><Wrench size={15} /> {savedMaintenance ? 'Kết thúc bảo trì' : 'Bật bảo trì'}</button></div>
      <p>Bảo trì chặn tạo đơn mới qua bot. Khách vẫn có thể tra cứu đơn và xem lịch sử mua.</p>
      <p>Thông báo bảo trì được gửi tới chat riêng, nhóm, kênh và các topic đã có trong hệ thống của bot được chọn.</p>
      <label className="broadcast-field">Thông báo gửi cho khách<textarea maxLength={1000} rows={3} value={maintenance.message} onChange={e => changeMaintenance({ message: e.target.value })} /></label>
      <div className="maintenance-options"><label><input type="checkbox" checked={maintenance.notifyStart} onChange={e => changeMaintenance({ notifyStart: e.target.checked })} /> Gửi thông báo khi bắt đầu bảo trì</label><label><input type="checkbox" checked={maintenance.notifyEnd} onChange={e => changeMaintenance({ notifyEnd: e.target.checked })} /> Gửi thông báo khi hoạt động trở lại</label></div>
      <div className="broadcast-actions"><select aria-label="Bot gửi thông báo bảo trì" value={maintenanceBot} onChange={e => setMaintenanceBot(e.target.value)}><option value="">Chọn bot gửi thông báo bảo trì</option>{enabledBots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select><button className="bot-secondary-button" disabled={busy || !maintenanceDirty} onClick={() => void run(async () => { const value = await updateMaintenance({ ...maintenance, enabled: savedMaintenance }, maintenanceBot); setMaintenance(value); setMaintenanceDirty(false); }, 'Đã lưu nội dung bảo trì.')}>Lưu cấu hình</button></div>
    </section>
    <section className="broadcast-card">
      <div className="broadcast-filters"><label><Search size={17} /><input placeholder="Tìm theo tiêu đề hoặc nội dung…" aria-label="Tìm thông báo" value={search} onChange={e => setSearch(e.target.value)} /></label><select aria-label="Lọc trạng thái" value={filter} onChange={e => setFilter(e.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(statuses).filter(([key]) => !['queued', 'sending'].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button className="bot-secondary-button" onClick={() => { setSearch(''); setFilter(''); }}>Xóa lọc</button></div>
      <div className="broadcast-table-wrap"><table className="broadcast-table"><thead><tr><th>Broadcast</th><th>Bot / Nhóm nhận</th><th>Trạng thái</th><th>Tiến độ</th><th>Thành công</th><th>Thất bại</th><th>Lịch gửi (giờ VN)</th><th>Thao tác</th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><td><strong><TelegramHtmlPreview text={item.title} html={item.parseMode === 'HTML'} /></strong><p><TelegramHtmlPreview text={item.content} html={item.parseMode === 'HTML'} /></p><small>Tạo: {date(item.createdAt)}</small></td><td>{bots.find(bot => bot.id === item.botId)?.name || 'Bot đã xóa'}<small>{audiences[item.audience]}</small></td><td><span className={`broadcast-badge ${item.status}`}>{statuses[item.status]}</span></td><td><progress max={item.total || 1} value={item.sent + item.failed} /><small>{item.sent + item.failed}/{item.total}</small></td><td className="broadcast-success">{item.sent}</td><td className="broadcast-failure">{item.failed}</td><td>{date(item.scheduledAt)}</td><td><div className="broadcast-row-actions"><button title="Xem chi tiết" aria-label={`Chi tiết ${item.title}`} onClick={() => void run(async () => setDetail(await fetchBroadcastDetail(item.id)), '')}><Eye size={16} /></button>{['draft', 'scheduled'].includes(item.status) && <button disabled={busy} onClick={() => void run(() => broadcastAction(item.id, 'send'), 'Đã đưa vào hàng đợi gửi.')} title="Gửi đến nhóm nhận"><Send size={16} /></button>}{['draft', 'scheduled', 'queued', 'sending'].includes(item.status) && <button disabled={busy} title="Hủy các tin chưa gửi" onClick={() => void run(() => broadcastAction(item.id, 'cancel'), 'Đã hủy các tin chưa gửi.')}><X size={16} /></button>}</div></td></tr>)}</tbody></table></div>
      {!visible.length && <div className="broadcast-empty"><Bell size={36} /><h3>{loading ? 'Đang tải thông báo…' : items.length ? 'Không có kết quả phù hợp' : 'Tạo thông báo đầu tiên'}</h3><p>Thông báo sale, sản phẩm mới hoặc cập nhật dịch vụ cho khách hàng.</p>{!items.length && !loading && <button className="bot-primary-button" onClick={openCreate}><Plus size={16} /> Tạo broadcast</button>}</div>}
    </section>
    {editor && <div className="broadcast-overlay"><section className="broadcast-dialog" role="dialog" aria-modal="true" aria-labelledby="broadcast-title"><header><div><h2 id="broadcast-title">Tạo broadcast mới</h2><p>Soạn nội dung và chọn khách nhận qua Telegram Bot.</p></div><button className="broadcast-close" aria-label="Đóng" disabled={busy || uploading} onClick={() => setEditor(false)}><X size={20} /></button></header>{error && <div className="bot-form-error" role="alert">{error}</div>}
      <div className="broadcast-compose"><form id="broadcast-form" onSubmit={e => { e.preventDefault(); submit(); }}>
        <label className="broadcast-field">Tiêu đề<input autoFocus required maxLength={150} value={form.title} onChange={e => field('title', e.target.value)} placeholder="🔥 Bão sale cuối tuần tại VAGA" /></label>
        <label className="broadcast-field">Nội dung<textarea required rows={6} value={form.content} maxLength={limit} onChange={e => field('content', e.target.value)} placeholder="Nhập nội dung thông báo dành cho khách hàng…" /><small className={length > limit ? 'broadcast-failure' : ''}>{length}/{limit} ký tự, gồm tiêu đề và xuống dòng</small></label>
        <div className="broadcast-grid"><label className="broadcast-field">Bot gửi<select required value={form.botId} onChange={e => field('botId', e.target.value)}><option value="">Chọn bot</option>{enabledBots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label><label className="broadcast-field">Nhóm người nhận<select value={form.audience} onChange={e => field('audience', e.target.value)}>{Object.entries(audiences).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        <p className="broadcast-recipient-count">{count === null ? 'Chọn bot để tính số người nhận.' : `${count} khách hàng phù hợp đã trò chuyện với bot.`}</p>
        <fieldset className="broadcast-format"><legend>Định dạng nội dung</legend><div className="broadcast-format-options"><label><input type="radio" name="broadcast-format" value="" checked={!form.parseMode} onChange={() => field('parseMode', '')} /><span>Văn bản thường</span></label><label><input type="radio" name="broadcast-format" value="HTML" checked={form.parseMode === 'HTML'} onChange={() => field('parseMode', 'HTML')} /><span>HTML</span></label></div></fieldset>{form.parseMode && <small className="broadcast-help">Tiêu đề và nội dung hỗ trợ thẻ HTML của Telegram, ví dụ &lt;b&gt;in đậm&lt;/b&gt;, &lt;i&gt;in nghiêng&lt;/i&gt;.</small>}
        <label className="broadcast-field">Ảnh đính kèm (không bắt buộc)<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading || busy} onChange={e => { void selectImage(e.target.files?.[0]); e.target.value = ''; }} /><small>{uploading ? 'Đang tải ảnh lên…' : 'Chọn ảnh JPG, PNG hoặc WebP từ máy, tối đa 10 MB.'}</small></label>
        {form.imageUrl && <button type="button" className="bot-secondary-button" disabled={uploading || busy} onClick={() => field('imageUrl', '')}><X size={14} /> Bỏ ảnh</button>}
        <div className="broadcast-grid"><label className="broadcast-field">Nội dung nút<input maxLength={64} value={form.buttonText} onChange={e => field('buttonText', e.target.value)} placeholder="🛍️ Mua ngay" /></label><label className="broadcast-field">URL nút<input type="url" value={form.buttonUrl} onChange={e => field('buttonUrl', e.target.value)} placeholder="https://vaga.vn/products" /></label></div>
        <label className="broadcast-check"><input type="checkbox" checked={scheduled} onChange={e => { setScheduled(e.target.checked); setSendNow(false); }} /> Đặt lịch gửi</label>{scheduled && <><label className="broadcast-field">Thời gian theo múi giờ thiết bị<input type="datetime-local" required value={schedule} onChange={e => setSchedule(e.target.value)} /></label><small className="broadcast-help">Máy chủ cần hoạt động để gửi đúng giờ. Nếu máy chủ dừng, lịch chưa gửi sẽ được xử lý khi khởi động lại.</small></>}
        <label className="broadcast-check"><input type="checkbox" checked={sendNow} onChange={e => { setSendNow(e.target.checked); setScheduled(false); }} /> Gửi ngay sau khi tạo</label>{!sendNow && !scheduled && <small className="broadcast-help">Lưu bản nháp để xem lại và gửi sau.</small>}
      </form><aside className="broadcast-preview"><h3>Xem trước Telegram</h3><div className="telegram-preview"><div className="telegram-preview-bubble">{form.imageUrl && <Image unoptimized src={broadcastImageSrc(form.imageUrl)} alt="Broadcast image" width={360} height={240} style={{ width: '100%', height: 'auto', borderRadius: 8, marginBottom: 12 }} />}<div className="telegram-preview-title"><TelegramHtmlPreview text={form.title || 'Tiêu đề thông báo'} html={form.parseMode === 'HTML'} /></div><div className="telegram-preview-content"><TelegramHtmlPreview text={form.content || 'Nội dung thông báo sẽ hiển thị ở đây.'} html={form.parseMode === 'HTML'} /></div><small>VAGA</small></div>{form.buttonText && <div className="telegram-preview-button">{form.buttonText} ↗</div>}</div><p>Danh sách nhận được chốt theo bot và nhóm nhận khi tạo đợt gửi.</p></aside></div>
      <footer><span>{count ?? '—'} người nhận · {scheduled ? 'Đặt lịch' : sendNow ? 'Gửi ngay' : 'Bản nháp'}</span><button className="bot-secondary-button" disabled={busy || uploading} onClick={() => setEditor(false)}>Hủy</button><button form="broadcast-form" type="submit" className="bot-primary-button" disabled={busy || uploading || !form.botId || count === 0 || length > limit}><Send size={16} /> {busy ? 'Đang lưu…' : scheduled ? 'Đặt lịch gửi' : sendNow ? 'Tạo và gửi ngay' : 'Lưu bản nháp'}</button></footer>
    </section></div>}
    {detail && <div className="broadcast-overlay"><section className="broadcast-dialog broadcast-detail" role="dialog" aria-modal="true" aria-labelledby="broadcast-detail-title"><header><div><h2 id="broadcast-detail-title"><TelegramHtmlPreview text={detail.title} html={detail.parseMode === 'HTML'} /></h2><p>{statuses[detail.status]} · Tạo {date(detail.createdAt)}</p></div><button autoFocus className="broadcast-close" aria-label="Đóng chi tiết" onClick={() => setDetail(null)}><X size={20} /></button></header><div className="broadcast-detail-content"><TelegramHtmlPreview text={detail.content} html={detail.parseMode === 'HTML'} /></div><div className="broadcast-table-wrap"><table className="broadcast-table"><thead><tr><th>Khách hàng</th><th>Kết quả</th><th>Chi tiết lỗi</th></tr></thead><tbody>{detail.recipients.map(recipient => <tr key={recipient.chatId}><td>{recipient.name}</td><td>{({ pending: 'Chờ gửi', sending: 'Đang gửi', sent: 'Thành công', failed: 'Thất bại', unknown: 'Cần kiểm tra' } as Record<string, string>)[recipient.status]}</td><td>{recipient.error || '—'}</td></tr>)}</tbody></table></div><footer><button className="bot-secondary-button" onClick={() => void run(async () => setDetail(await fetchBroadcastDetail(detail.id)), '')}><RefreshCw size={16} /> Cập nhật kết quả</button></footer></section></div>}
  </main>;
}
