'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Package, Plus, RefreshCw, Pencil, Trash2, Eye, X } from 'lucide-react';
import { createProduct, deleteProduct, fetchProducts, fetchProduct, updateProduct, Product, ProductInput, ProductStatus, Supplier, fetchSuppliers, fetchNextProductCode, uploadProductImage, productImageSrc } from '@/lib/api';
import './products.css';

const labels: Record<ProductStatus, string> = { in_stock: 'Còn hàng', out_of_stock: 'Hết hàng', discontinued: 'Ngừng bán' };
const empty: ProductInput = { code: '', name: '', quantity: '', price: 0, supplier: '', supplierCode: '', status: 'in_stock', description: '', imageUrl: '' };
const message = (error: unknown) => error instanceof Error ? error.message : 'Không thể xử lý sản phẩm.';

const units = ['ml', 'l', 'g', 'kg'] as const;
type QuantityUnit = typeof units[number];
function splitQuantity(quantity: string) {
  const match = quantity.trim().match(/^(\d+(?:[.,]\d+)?)\s*(ml|kg|g|l)$/i);
  return match ? { amount: match[1].replace(',', '.'), unit: match[2].toLowerCase() as QuantityUnit } : null;
}
function ProductThumbnail({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span className="product-image-placeholder">{failed ? 'Ảnh lỗi' : 'Chưa có ảnh'}</span>;
  return <a href={productImageSrc(url)} target="_blank" rel="noreferrer" className="product-thumbnail-link" aria-label={'Xem ảnh ' + name}>
    <Image unoptimized src={productImageSrc(url)} alt={name} width={64} height={64} className="product-thumbnail" onError={() => setFailed(true)} />
  </a>;
}
export default function ProductManagement() {
  const [items, setItems] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editor, setEditor] = useState<{ id?: string; readOnly: boolean } | null>(null);
  const [form, setForm] = useState<ProductInput>(empty);
  const [quantityAmount, setQuantityAmount] = useState('');
  const [codePreview, setCodePreview] = useState<{ supplierCode: string; code: string; error?: string } | null>(null);
  const [quantityUnit, setQuantityUnit] = useState<QuantityUnit>('ml');
  const [deleting, setDeleting] = useState<Product | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const deleteRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    Promise.all([fetchProducts(), fetchSuppliers()]).then(([data, vendors]) => { if (active) { setItems(data); setSuppliers(vendors); } })
      .catch(error => { if (active) setError(message(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (editor) dialogRef.current?.showModal(); else dialogRef.current?.close();
  }, [editor]);
  useEffect(() => {
    if (deleting) deleteRef.current?.showModal(); else deleteRef.current?.close();
  }, [deleting]);

  const originalSupplierCode = editor?.id ? items.find(item => item.id === editor.id)?.supplierCode : undefined;
  const keepExistingCode = Boolean(editor?.id && form.supplierCode === originalSupplierCode);
  useEffect(() => {
    if (!editor || !form.supplierCode || keepExistingCode) return;
    let active = true;
    const supplierCode = form.supplierCode;
    fetchNextProductCode(supplierCode).then(({ code }) => {
      if (active) setCodePreview({ supplierCode, code });
    }).catch(error => {
      if (active) setCodePreview({ supplierCode, code: '', error: message(error) });
    });
    return () => { active = false; };
  }, [editor, form.supplierCode, keepExistingCode]);
  async function refresh() {
    setLoading(true); setError('');
    try { const [data, vendors] = await Promise.all([fetchProducts(), fetchSuppliers()]); setItems(data); setSuppliers(vendors); } catch (error) { setError(message(error)); }
    finally { setLoading(false); }
  }
  async function open(item: Product, readOnly: boolean) {
    setBusy(true); setError('');
    try {
      const [data, vendors] = await Promise.all([fetchProduct(item.id), fetchSuppliers()]);
      setSuppliers(vendors);
      const parsed = splitQuantity(data.quantity);
      setQuantityAmount(parsed?.amount || '');
      setQuantityUnit(parsed?.unit || 'ml');
      setForm(!parsed && data.quantity ? { ...data, description: [data.description, data.quantity].filter(Boolean).join('\n') } : data);
      setEditor({ id: data.id, readOnly });
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  async function selectImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy || editor?.readOnly) return;
    setError('');
    if (!file.size || file.size > 10 * 1024 * 1024) { setError('Ảnh phải có dung lượng từ 1 byte đến 10 MB.'); return; }
    if (file.type && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Chọn ảnh JPG, PNG hoặc WebP.'); return; }
    setBusy(true); setUploading(true);
    try {
      const { imageUrl } = await uploadProductImage(file);
      setForm(current => ({ ...current, imageUrl }));
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); setUploading(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !editor || editor.readOnly) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (!form.supplierCode) throw new Error('Vui lòng chọn nhà cung cấp.');
      const amount = Number(quantityAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Định lượng phải là số lớn hơn 0.');
      const input = { ...form, quantity: amount + ' ' + quantityUnit };
      const saved = editor.id ? await updateProduct(editor.id, input) : await createProduct(input);
      setItems(current => [saved, ...current.filter(item => item.id !== saved.id)]);
      setEditor(null); setNotice('Đã lưu sản phẩm.');
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await deleteProduct(deleting.id);
      setItems(current => current.filter(item => item.id !== deleting.id));
      setDeleting(null); setNotice('Đã xóa sản phẩm.');
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  const field = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) => setForm(current => ({ ...current, [key]: value }));
  const visible = items.filter(item => (!status || item.status === status) &&
    [item.code, item.name, item.supplier].some(value => value.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi'))));
  return (
    <main className="products-page">
      <header className="products-header">
        <div><span className="products-eyebrow">TELEVAGA · DANH MỤC</span><h1><Package size={27} /> Quản lý sản phẩm</h1><p>{items.length} sản phẩm trong danh mục</p></div>
        <div className="products-actions">
          <button disabled={loading || busy} onClick={() => void refresh()}><RefreshCw size={16} /> Làm mới</button>
          <button className="primary" disabled={busy} onClick={() => { setError(''); setForm({ ...empty }); setCodePreview(null); setQuantityAmount(''); setQuantityUnit('ml'); setEditor({ readOnly: false }); }}><Plus size={17} /> Thêm sản phẩm</button>
        </div>
      </header>
      {error && !editor && !deleting && <p className="products-error" role="alert">{error}</p>}
      {notice && <p className="products-notice" role="status">{notice}</p>}
      <div className="products-filters">
        <input aria-label="Tìm sản phẩm" placeholder="Tìm mã, tên hoặc nhà cung cấp…" value={search} onChange={e => setSearch(e.target.value)} />
        <select aria-label="Lọc tình trạng" value={status} onChange={e => setStatus(e.target.value)}><option value="">Tất cả tình trạng</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      </div>
      <div className="products-table-wrap">
        <table className="products-table">
          <thead><tr>{['Ảnh sản phẩm', 'Mã sản phẩm', 'Tên sản phẩm', 'Định lượng', 'Giá', 'Nhà cung cấp', 'Tình trạng', 'Mô tả sản phẩm', 'Đường dẫn ảnh sản phẩm', 'Thao tác'].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead>
          <tbody>{loading ? <tr><td colSpan={10}>Đang tải sản phẩm…</td></tr> : visible.length ? visible.map(item => <tr key={item.id}>
            <td className="product-image-cell"><ProductThumbnail key={item.imageUrl} url={item.imageUrl} name={item.name} /></td><td><strong>{item.code}</strong></td><td>{item.name}</td><td>{item.quantity}</td>
            <td className="products-price">{item.price.toLocaleString('vi-VN')} ₫</td><td>{item.supplier || '—'}</td>
            <td><span className={`product-status ${item.status}`}>{labels[item.status]}</span></td>
            <td><span className="products-description" title={item.description}>{item.description || '—'}</span></td>
            <td>{item.imageUrl ? <a href={productImageSrc(item.imageUrl)} target="_blank" rel="noreferrer" className="products-image-link">{item.imageUrl}</a> : '—'}</td>
            <td><div className="products-actions"><button aria-label={`Xem ${item.name}`} title="Xem chi tiết" disabled={busy} onClick={() => void open(item, true)}><Eye size={16} /></button><button aria-label={`Sửa ${item.name}`} title="Sửa" disabled={busy} onClick={() => void open(item, false)}><Pencil size={16} /></button><button className="danger" aria-label={`Xóa ${item.name}`} title="Xóa" disabled={busy} onClick={() => { setError(''); setDeleting(item); }}><Trash2 size={16} /></button></div></td>
          </tr>) : <tr><td colSpan={10}>{items.length ? 'Không tìm thấy sản phẩm phù hợp.' : 'Chưa có sản phẩm. Bấm “Thêm sản phẩm” để bắt đầu.'}</td></tr>}</tbody>
        </table>
      </div>
      <dialog ref={dialogRef} className="products-dialog" aria-labelledby="product-editor-title" onCancel={event => { if (busy) event.preventDefault(); else setEditor(null); }} onClose={() => setEditor(null)}>
        <form onSubmit={save}>
          <header className="products-header"><h2 id="product-editor-title">{editor?.readOnly ? 'Chi tiết sản phẩm' : editor?.id ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}</h2><button type="button" aria-label="Đóng" disabled={busy} onClick={() => setEditor(null)}><X size={19} /></button></header>
          {error && <p className="products-error" role="alert">{error}</p>}
          <fieldset disabled={busy || editor?.readOnly} className="products-form">
            <label>Mã sản phẩm<input readOnly value={keepExistingCode ? form.code : !form.supplierCode ? 'Chọn nhà cung cấp để sinh mã' : codePreview?.supplierCode === form.supplierCode ? codePreview.code : 'Đang lấy mã…'} />
              {!keepExistingCode && codePreview?.supplierCode === form.supplierCode && codePreview.error && <small role="alert">{codePreview.error}</small>}
            </label>
            <label>Tên sản phẩm *<input autoFocus required maxLength={200} value={form.name} onChange={e => field('name', e.target.value)} /></label>
            <div className="product-quantity-field">
              <label htmlFor="product-quantity-amount">Định lượng *</label>
              <div className="product-quantity-inputs">
                <input id="product-quantity-amount" required type="number" min="0.000001" step="any" placeholder="Ví dụ: 200" value={quantityAmount} onChange={e => setQuantityAmount(e.target.value)} />
                <select aria-label="Đơn vị định lượng" value={quantityUnit} onChange={e => setQuantityUnit(e.target.value as QuantityUnit)}>{units.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select>
              </div>
            </div>
            <label>Giá (VNĐ) *<input required type="number" min="0" max="9999999999.99" step="0.01" value={Number.isNaN(form.price) ? '' : form.price} onChange={e => field('price', e.target.value === '' ? NaN : Number(e.target.value))} /></label>
            <label>Nhà cung cấp *<select required value={form.supplierCode} onChange={e => { setCodePreview(null); field('supplierCode', e.target.value); }}>
              <option value="">Chọn nhà cung cấp</option>
              {suppliers.filter(supplier => supplier.status === 1 || supplier.code === form.supplierCode).map(supplier => <option key={supplier.code} value={supplier.code} disabled={supplier.status === 0}>{supplier.name} · {supplier.code}{supplier.status === 0 ? ' (Ngừng hợp tác)' : ''}</option>)}
            </select>{!suppliers.some(supplier => supplier.status === 1) && <small>Thêm nhà cung cấp đang hợp tác trong menu Nhà cung cấp trước khi tạo sản phẩm.</small>}</label>
            <label>Kinh doanh<select value={form.status === 'discontinued' ? 'discontinued' : 'in_stock'} onChange={e => field('status', e.target.value as ProductStatus)}><option value="in_stock">Đang bán</option><option value="discontinued">Ngừng bán</option></select><small>Còn/hết hàng được tính từ tồn kho. Sản phẩm mới bắt đầu với tồn bằng 0.</small></label>
            <label className="wide">Mô tả sản phẩm<textarea rows={4} maxLength={10000} placeholder="Thông tin sản phẩm, quy cách đóng gói (ví dụ: hộp 30 viên)…" value={form.description} onChange={e => field('description', e.target.value)} /></label>
            <div className="wide product-image-editor">
              <label>Đường dẫn ảnh sản phẩm<input type="text" inputMode="url" maxLength={2048} placeholder="https://…" value={form.imageUrl} onChange={e => field('imageUrl', e.target.value)} /></label>
              {!editor?.readOnly && <div className="products-actions">
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label="Chọn ảnh sản phẩm từ máy" onChange={event => void selectImage(event)} />
                <button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()}>{uploading ? 'Đang tải ảnh…' : 'Chọn ảnh từ máy'}</button>
                {form.imageUrl && <button type="button" disabled={busy} onClick={() => field('imageUrl', '')}>Bỏ ảnh</button>}
                <small>JPG, PNG, WebP · tối đa 10 MB</small>
              </div>}
              {form.imageUrl && <ProductThumbnail key={form.imageUrl} url={form.imageUrl} name={form.name || 'Ảnh sản phẩm'} />}
            </div>
          </fieldset>
          <footer className="products-actions"><button type="button" disabled={busy} onClick={() => setEditor(null)}>Đóng</button>{!editor?.readOnly && <button className="primary" disabled={busy} type="submit">{uploading ? 'Đang tải ảnh…' : busy ? 'Đang lưu…' : 'Lưu sản phẩm'}</button>}</footer>
        </form>
      </dialog>
      <dialog ref={deleteRef} className="products-dialog products-delete" aria-labelledby="product-delete-title" onCancel={event => { if (busy) event.preventDefault(); else setDeleting(null); }} onClose={() => setDeleting(null)}>
        <h2 id="product-delete-title">Xóa sản phẩm?</h2><p>Bạn muốn xóa “{deleting?.name}” ({deleting?.code})? Thao tác này không thể hoàn tác.</p>
        {error && <p className="products-error" role="alert">{error}</p>}
        <footer className="products-actions"><button autoFocus disabled={busy} onClick={() => setDeleting(null)}>Hủy</button><button className="danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Đang xóa…' : 'Xóa sản phẩm'}</button></footer>
      </dialog>
    </main>
  );
}