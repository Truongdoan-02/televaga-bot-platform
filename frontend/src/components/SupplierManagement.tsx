'use client';

import { useEffect, useRef, useState } from 'react';
import { Truck, Plus, RefreshCw, Pencil, Trash2, Eye, X } from 'lucide-react';
import { Supplier, SupplierInput, fetchSuppliers, fetchSupplier, fetchNextSupplierCode, createSupplier, updateSupplier, deleteSupplier } from '@/lib/api';
import './products.css';

const empty: SupplierInput = { name: '', contactName: '', phone: '', email: '', address: '', taxCode: '', bankAccount: '', bankName: '', status: 1, note: '' };
const fields = [
  { key: 'name', label: 'Tên nhà cung cấp', max: 255, required: true, type: 'text' },
  { key: 'contactName', label: 'Người liên hệ', max: 100, type: 'text' },
  { key: 'phone', label: 'Số điện thoại', max: 20, type: 'tel' },
  { key: 'email', label: 'Email liên hệ', max: 255, type: 'email' },
  { key: 'address', label: 'Địa chỉ', max: 500, type: 'text' },
  { key: 'taxCode', label: 'Mã số thuế', max: 20, type: 'text' },
  { key: 'bankAccount', label: 'Số tài khoản ngân hàng', max: 50, type: 'text' },
  { key: 'bankName', label: 'Tên ngân hàng', max: 150, type: 'text' },
] as const;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Không thể xử lý nhà cung cấp.';
const date = (value: string) => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' });

export default function SupplierManagement() {
  const [items, setItems] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [nextCode, setNextCode] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState<SupplierInput>(empty);
  const [editor, setEditor] = useState<{ code?: string; readOnly: boolean } | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const deleteRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true;
    fetchSuppliers().then(data => { if (active) setItems(data); })
      .catch(error => { if (active) setError(errorMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (editor) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [editor]);
  useEffect(() => { if (deleting) deleteRef.current?.showModal(); else deleteRef.current?.close(); }, [deleting]);
  async function refresh() {
    setLoading(true); setError('');
    try { setItems(await fetchSuppliers()); } catch (error) { setError(errorMessage(error)); }
    finally { setLoading(false); }
  }
  async function startCreate() {
    setBusy(true); setError('');
    try {
      const { code } = await fetchNextSupplierCode();
      setNextCode(code); setForm({ ...empty }); setEditor({ readOnly: false });
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function open(item: Supplier, readOnly: boolean) {
    setBusy(true); setError('');
    try { setForm(await fetchSupplier(item.code)); setEditor({ code: item.code, readOnly }); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || editor.readOnly || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (!form.name.trim()) throw new Error('Vui lòng nhập tên nhà cung cấp.');
      const saved = editor.code ? await updateSupplier(editor.code, form) : await createSupplier(form);
      setItems(current => [saved, ...current.filter(item => item.code !== saved.code)]);
      setEditor(null); setNotice('Đã lưu nhà cung cấp ' + saved.code + '.');
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await deleteSupplier(deleting.code);
      setItems(current => current.filter(item => item.code !== deleting.code));
      setDeleting(null); setNotice('Đã xóa nhà cung cấp.');
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  const visible = items.filter(item => (status === '' || String(item.status) === status) &&
    [item.code, item.name, item.contactName, item.phone, item.email, item.taxCode].some(value => value.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi'))));
  return <main className="products-page">
    <header className="products-header"><div><span className="products-eyebrow">TELEVAGA · ĐỐI TÁC</span><h1><Truck size={27} /> Quản lý nhà cung cấp</h1><p>{items.length} nhà cung cấp</p></div>
      <div className="products-actions"><button disabled={busy || loading} onClick={() => void refresh()}><RefreshCw size={16} /> Làm mới</button><button className="primary" disabled={busy} onClick={() => void startCreate()}><Plus size={17} /> Thêm nhà cung cấp</button></div>
    </header>
    {error && !editor && !deleting && <p className="products-error" role="alert">{error}</p>}
    {notice && <p className="products-notice" role="status">{notice}</p>}
    <div className="products-filters"><input aria-label="Tìm nhà cung cấp" placeholder="Tìm mã, tên, liên hệ, SĐT, email, mã số thuế…" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Lọc tình trạng hợp tác" value={status} onChange={e => setStatus(e.target.value)}><option value="">Tất cả tình trạng</option><option value="1">Đang hợp tác</option><option value="0">Ngừng hợp tác</option></select></div>
    <div className="products-table-wrap"><table className="products-table"><thead><tr>{['Mã NCC', ...fields.map(field => field.label), 'Tình trạng', 'Ghi chú', 'Ngày tạo', 'Ngày cập nhật', 'Thao tác'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{loading ? <tr><td colSpan={14}>Đang tải nhà cung cấp…</td></tr> : visible.length ? visible.map(item => <tr key={item.code}>
        <td><strong>{item.code}</strong></td>{fields.map(field => <td key={field.key}>{item[field.key] || '—'}</td>)}
        <td><span className={'product-status ' + (item.status ? 'in_stock' : 'discontinued')}>{item.status ? 'Đang hợp tác' : 'Ngừng hợp tác'}</span></td>
        <td><span className="products-description" title={item.note}>{item.note || '—'}</span></td><td>{date(item.createdAt)}</td><td>{date(item.updatedAt)}</td>
        <td><div className="products-actions"><button disabled={busy} title="Xem chi tiết" aria-label={'Xem ' + item.name} onClick={() => void open(item, true)}><Eye size={16} /></button><button disabled={busy} title="Sửa" aria-label={'Sửa ' + item.name} onClick={() => void open(item, false)}><Pencil size={16} /></button><button disabled={busy} className="danger" title="Xóa" aria-label={'Xóa ' + item.name} onClick={() => { setError(''); setDeleting(item); }}><Trash2 size={16} /></button></div></td>
      </tr>) : <tr><td colSpan={14}>{items.length ? 'Không tìm thấy nhà cung cấp phù hợp.' : 'Chưa có nhà cung cấp. Bấm “Thêm nhà cung cấp” để bắt đầu.'}</td></tr>}</tbody>
    </table></div>
    <dialog ref={dialogRef} className="products-dialog" aria-labelledby="supplier-editor-title" onCancel={e => { if (busy) e.preventDefault(); else setEditor(null); }} onClose={() => setEditor(null)}>
      <form onSubmit={save}><header className="products-header"><h2 id="supplier-editor-title">{editor?.readOnly ? 'Chi tiết nhà cung cấp' : editor?.code ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}</h2><button type="button" aria-label="Đóng" disabled={busy} onClick={() => setEditor(null)}><X size={19} /></button></header>
        {error && <p className="products-error" role="alert">{error}</p>}
        <fieldset disabled={busy || editor?.readOnly} className="products-form">
          <label className="wide">Mã nhà cung cấp<input readOnly value={editor?.code || nextCode} /></label>
          {fields.map(field => <label key={field.key}>{field.label}{'required' in field ? ' *' : ''}<input autoFocus={field.key === 'name'} required={'required' in field} type={field.type} maxLength={field.max} value={form[field.key]}
            onChange={e => setForm(current => ({ ...current, [field.key]: e.target.value }))} /></label>)}
          <label>Tình trạng<select value={form.status} onChange={e => setForm(current => ({ ...current, status: Number(e.target.value) as 0 | 1 }))}><option value={1}>Đang hợp tác</option><option value={0}>Ngừng hợp tác</option></select></label>
          <label className="wide">Ghi chú<textarea rows={4} maxLength={10000} value={form.note} onChange={e => setForm(current => ({ ...current, note: e.target.value }))} /></label>
        </fieldset><p className="supplier-form-hint">Chỉ tên nhà cung cấp là bắt buộc. Các trường còn lại có thể để trống; số điện thoại và email được kiểm tra khi nhập.</p>
        <footer className="products-actions"><button type="button" disabled={busy} onClick={() => setEditor(null)}>Đóng</button>{!editor?.readOnly && <button type="submit" className="primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu nhà cung cấp'}</button>}</footer>
      </form>
    </dialog>
    <dialog ref={deleteRef} className="products-dialog products-delete" aria-labelledby="supplier-delete-title" onCancel={e => { if (busy) e.preventDefault(); else setDeleting(null); }} onClose={() => setDeleting(null)}>
      <h2 id="supplier-delete-title">Xóa nhà cung cấp?</h2><p>Xóa “{deleting?.name}” ({deleting?.code})? Thao tác này không thể hoàn tác.</p>{error && <p className="products-error" role="alert">{error}</p>}
      <footer className="products-actions"><button autoFocus disabled={busy} onClick={() => setDeleting(null)}>Hủy</button><button className="danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Đang xóa…' : 'Xóa nhà cung cấp'}</button></footer>
    </dialog>
  </main>;
}