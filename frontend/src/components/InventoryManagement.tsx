'use client';

import { useEffect,useRef,useState } from 'react';
import Image from 'next/image';
import { Warehouse,RefreshCw } from 'lucide-react';
import { InventoryItem,InventoryTransaction,InventoryOrder,InventoryDocument,InventoryDocumentDetail,InventoryDocumentType,fetchInventoryDocuments,fetchInventoryDocument,createInventoryDocument,fetchInventory,fetchInventoryHistory,fetchInventoryOrders,inventoryOrderAction,productImageSrc } from '@/lib/api';
import './products.css';
const types:Record<string,string>={receipt:'Nhập kho',issue:'Xuất kho',count:'Kiểm kê',return:'Trả hàng',opening:'Tồn đầu kỳ',reserve:'Giữ hàng',fulfill:'Giao hàng',cancel:'Hủy giữ hàng',settings:'Cấu hình'};
const inventoryUnits=['hộp','cái','lọ','chai','túi'];
const states:Record<string,string>={reserved:'Đang giữ hàng',fulfilled:'Đã xuất giao',cancelled:'Đã hủy',returned:'Đã nhận trả'};
const message=(e:unknown)=>e instanceof Error?e.message:'Không xử lý được tồn kho.';
type DraftLine={key:string;productId:string;quantity:string;cost:string;unit:string;minimum:string};
const blankLine=():DraftLine=>({key:crypto.randomUUID(),productId:'',quantity:'',cost:'',unit:'cái',minimum:'0'});
export default function InventoryManagement(){
  const [items,setItems]=useState<InventoryItem[]>([]);
  const [history,setHistory]=useState<InventoryTransaction[]>([]);
  const [orders,setOrders]=useState<InventoryOrder[]>([]);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [tab,setTab]=useState('stock'),[search,setSearch]=useState(''),[low,setLow]=useState(false);
  const [historyProduct,setHistoryProduct]=useState(''),[historyType,setHistoryType]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const [editor,setEditor]=useState<{type:InventoryDocumentType}|null>(null);
  const [lines,setLines]=useState<DraftLine[]>([]);
  const [documents,setDocuments]=useState<InventoryDocument[]>([]);
  const [detail,setDetail]=useState<InventoryDocumentDetail|null>(null);
  const [documentType,setDocumentType]=useState('');
  const [note,setNote]=useState(''),[reference,setReference]=useState('');
  const [orderConfirm,setOrderConfirm]=useState<{order:InventoryOrder;action:string}|null>(null);
  const dialog=useRef<HTMLDialogElement>(null),detailDialog=useRef<HTMLDialogElement>(null),orderDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{let active=true;Promise.all([fetchInventory(),fetchInventoryHistory(),fetchInventoryOrders(),fetchInventoryDocuments()]).then(([a,b,c,d])=>{if(active){setItems(a);setHistory(b);setOrders(c);setDocuments(d);}}).catch(e=>{if(active)setError(message(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  useEffect(()=>{if(editor)dialog.current?.showModal();else dialog.current?.close();},[editor]);
  useEffect(()=>{if(orderConfirm)orderDialog.current?.showModal();else orderDialog.current?.close();},[orderConfirm]);
  useEffect(()=>{if(detail)detailDialog.current?.showModal();else detailDialog.current?.close();},[detail]);
  async function refresh(){setLoading(true);try{const [a,b,c,d]=await Promise.all([fetchInventory(),fetchInventoryHistory(),fetchInventoryOrders(),fetchInventoryDocuments()]);setItems(a);setHistory(b);setOrders(c);setDocuments(d);}catch(e){setError(message(e));}finally{setLoading(false);}}
  function open(type:InventoryDocumentType){setError('');setNotice('');setLines([blankLine()]);setNote('');setReference(crypto.randomUUID());setEditor({type});}
  function changeLine(key:string,patch:Partial<DraftLine>){setLines(current=>current.map(line=>line.key===key?{...line,...patch}:line));}
  function chooseProduct(key:string,productId:string){
    const item=items.find(i=>i.productId===productId);
    changeLine(key,{productId,quantity:editor?.type==='count'&&item?String(item.onHand):'',unit:item?.unit||'cái',minimum:String(item?.minimumQuantity||0)});
  }
  function addAll(){
    setLines(current=>{
      const selected=new Set(current.map(l=>l.productId));
      return [...current.filter(l=>l.productId),...items.filter(i=>!selected.has(i.productId)).map(i=>({...blankLine(),productId:i.productId,quantity:editor?.type==='count'?String(i.onHand):'',unit:i.unit,minimum:String(i.minimumQuantity)}))].slice(0,100);
    });
  }
  async function showDocument(id:string){
    setBusy(true);setError('');
    try{setDetail(await fetchInventoryDocument(id));}catch(e){setError(message(e));}finally{setBusy(false);}
  }
  async function save(event:React.FormEvent){
    event.preventDefault();if(!editor||busy)return;setBusy(true);setError('');
    try{
      if(!lines.length||lines.some(l=>!l.productId))throw new Error('Vui lòng chọn sản phẩm cho tất cả các dòng.');
      if(new Set(lines.map(l=>l.productId)).size!==lines.length)throw new Error('Sản phẩm không được trùng trong cùng phiếu.');
      const saved=await createInventoryDocument({type:editor.type,note,reference,items:lines.map(line=>editor.type==='settings'?{productId:line.productId,unit:line.unit,minimumQuantity:Number(line.minimum)}:{productId:line.productId,quantity:Number(line.quantity),unitCost:editor.type==='receipt'&&line.cost!==''?Number(line.cost):null})});
      setEditor(null);setNotice('Đã lưu phiếu '+saved.code+' gồm '+saved.items.length+' sản phẩm.');setDetail(saved);await refresh();
    }catch(e){setError(message(e));}finally{setBusy(false);}
  }  async function confirmOrder(){if(!orderConfirm||busy)return;setBusy(true);setError('');try{await inventoryOrderAction(orderConfirm.order.order_id,orderConfirm.action);setOrderConfirm(null);setNotice('Đã cập nhật kho theo đơn.');await refresh();}catch(e){setError(message(e));}finally{setBusy(false);}}
  const visible=items.filter(i=>(!low||i.available<=i.minimumQuantity)&&[i.code,i.name,i.supplier].some(s=>(s||'').toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi'))));
  const visibleHistory=history.filter(h=>(!historyProduct||String(h.product_id)===historyProduct)&&(!historyType||h.type===historyType)&&(!from||new Date(h.created_at).getTime()>=new Date(from+'T00:00:00+07:00').getTime())&&(!to||new Date(h.created_at).getTime()<new Date(to+'T23:59:59.999+07:00').getTime()));
  return <main className="products-page">
    <header className="products-header"><div><span className="products-eyebrow">TELEVAGA · KHO HÀNG</span><h1><Warehouse size={27}/>Quản lý tồn kho</h1><p>{items.length} sản phẩm · {items.filter(i=>i.available<=i.minimumQuantity).length} sản phẩm cần bổ sung</p></div><div className="products-actions inventory-header-actions">{(['receipt','issue','count','return','settings'] as const).map(type=><button key={type} disabled={busy||loading||!items.length} onClick={()=>open(type)}>{types[type]}</button>)}<button disabled={busy||loading} onClick={()=>void refresh()}><RefreshCw size={16}/>Làm mới</button></div></header>
    {error&&!editor&&!orderConfirm&&<p role="alert" className="products-error">{error}</p>}{notice&&<p role="status" className="products-notice">{notice}</p>}
    <div className="products-actions inventory-tabs">{[['stock','Tồn kho'],['documents','Phiếu kho'],['history','Lịch sử nhập/xuất'],['orders','Đơn giữ hàng']].map(([key,label])=><button key={key} className={tab===key?'primary':''} onClick={()=>setTab(key)}>{label}</button>)}</div>
    {tab==='stock'&&<><div className="products-filters"><input aria-label="Tìm tồn kho" placeholder="Tìm mã, tên sản phẩm, nhà cung cấp…" value={search} onChange={e=>setSearch(e.target.value)}/><label className="inventory-low"><input type="checkbox" checked={low} onChange={e=>setLow(e.target.checked)}/>Chỉ hàng sắp hết</label></div><div className="products-table-wrap"><table className="products-table"><thead><tr>{['Ảnh','Mã sản phẩm','Tên sản phẩm','Định lượng','Đơn vị tồn','Thực tế','Đang giữ','Có thể bán','Ngưỡng cảnh báo'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>
      {loading?<tr><td colSpan={9}>Đang tải…</td></tr>:visible.length?visible.map(i=><tr key={i.productId}><td>{i.imageUrl?<Image unoptimized src={productImageSrc(i.imageUrl)} width={48} height={48} alt={i.name} style={{objectFit:'contain'}}/>:'—'}</td><td>{i.code}</td><td>{i.name}</td><td>{i.quantity}</td><td>{i.unit}</td><td>{i.onHand}</td><td>{i.reserved}</td><td><span className={'product-status '+(i.available<=i.minimumQuantity?'out_of_stock':'in_stock')}>{i.available}</span></td><td>{i.minimumQuantity}</td></tr>):<tr><td colSpan={9}>Không có sản phẩm phù hợp.</td></tr>}
    </tbody></table></div></>}
    {tab==='documents'&&<><div className="products-filters"><select aria-label="Loại phiếu kho" value={documentType} onChange={e=>setDocumentType(e.target.value)}><option value="">Tất cả phiếu</option>{['receipt','issue','count','return','settings'].map(t=><option key={t} value={t}>{types[t]}</option>)}</select></div><div className="products-table-wrap"><table className="products-table"><thead><tr>{['Mã phiếu','Loại phiếu','Số sản phẩm','Ghi chú','Người lập','Thời gian','Chi tiết'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{documents.filter(d=>!documentType||d.type===documentType).map(d=><tr key={d.id}><td>{d.code}</td><td>{types[d.type]}</td><td>{d.item_count}</td><td>{d.note}</td><td>{d.created_by}</td><td>{new Date(d.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok'})}</td><td><button disabled={busy} onClick={()=>void showDocument(d.id)}>Xem phiếu</button></td></tr>)}{!documents.some(d=>!documentType||d.type===documentType)&&<tr><td colSpan={7}>Chưa có phiếu kho phù hợp.</td></tr>}</tbody></table></div><p className="supplier-form-hint">Hiển thị tối đa 200 phiếu mới nhất. Các giao dịch cũ vẫn nằm trong Lịch sử nhập/xuất.</p></>}
    {tab==='history'&&<><div className="products-filters inventory-history-filters"><select aria-label="Lọc sản phẩm" value={historyProduct} onChange={e=>setHistoryProduct(e.target.value)}><option value="">Tất cả sản phẩm</option>{items.map(i=><option key={i.productId} value={i.productId}>{i.code} · {i.name}</option>)}</select><select aria-label="Loại giao dịch" value={historyType} onChange={e=>setHistoryType(e.target.value)}><option value="">Tất cả giao dịch</option>{Object.entries(types).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><label>Từ ngày<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Đến ngày<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div><p className="supplier-form-hint">Hiển thị tối đa 500 giao dịch gần nhất. Giao dịch đã ghi nhận không sửa/xóa; dùng kiểm kê hoặc giao dịch bù để điều chỉnh.</p><div className="products-table-wrap"><table className="products-table"><thead><tr>{['Thời gian','Mã phiếu / giao dịch','Sản phẩm','Loại','Thay đổi tồn','Tồn trước → sau','Giữ trước → sau','Giá nhập','Đơn hàng','Lý do','Người ghi nhận'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{visibleHistory.map(h=><tr key={h.id}><td>{new Date(h.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok'})}</td><td>{h.document_id?<button disabled={busy} onClick={()=>void showDocument(String(h.document_id))}>{h.document_code||h.code}</button>:h.code}</td><td>{h.product_code} · {h.product_name}</td><td>{types[h.type]||h.type}</td><td>{h.quantity_change>0?'+':''}{h.quantity_change}</td><td>{h.quantity_before} → {h.quantity_after}</td><td>{h.reserved_before} → {h.reserved_after}</td><td>{h.unit_cost==null?'—':Number(h.unit_cost).toLocaleString('vi-VN')+' ₫'}</td><td>{h.order_id||'—'}</td><td>{h.note}</td><td>{h.created_by}</td></tr>)}{!visibleHistory.length&&<tr><td colSpan={11}>Chưa có giao dịch phù hợp.</td></tr>}</tbody></table></div></>}
    {tab==='orders'&&<><p className="supplier-form-hint">Đơn Telegram mới được giữ hàng tự động. Chỉ xác nhận xuất giao khi đã bàn giao hàng; trả hàng chỉ thực hiện khi đã nhận lại toàn bộ hàng đủ điều kiện bán.</p><div className="products-table-wrap"><table className="products-table"><thead><tr>{['Mã đơn','Sản phẩm','Trạng thái kho','Thao tác'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{orders.map(o=><tr key={o.order_id}><td>{o.order_code}</td><td>{o.products}</td><td>{states[o.state]||o.state}</td><td><div className="products-actions">{(o.state==='reserved'?['fulfill','cancel']:o.state==='fulfilled'?['return']:[]).map(a=><button key={a} disabled={busy} onClick={()=>{setError('');setOrderConfirm({order:o,action:a});}}>{a==='fulfill'?'Xuất giao':a==='cancel'?'Hủy giữ hàng':'Nhận trả hàng'}</button>)}</div></td></tr>)}{!orders.length&&<tr><td colSpan={4}>Chưa có đơn giữ hàng mới.</td></tr>}</tbody></table></div></>}
    <dialog ref={dialog} className="products-dialog inventory-document-dialog" aria-labelledby="inventory-editor-title" onCancel={e=>{if(busy)e.preventDefault();else setEditor(null);}} onClose={()=>setEditor(null)}>
      <form onSubmit={save}><h2 id="inventory-editor-title">Phiếu {types[editor?.type||'']?.toLocaleLowerCase('vi')}</h2>
        {error&&<p role="alert" className="products-error">{error}</p>}
        <fieldset className="inventory-document-fields" disabled={busy}>
          <div className="products-table-wrap"><table className="products-table inventory-document-table"><thead><tr><th>Sản phẩm *</th><th>Đơn vị</th><th>Tồn thực tế / đang giữ</th>{editor?.type==='settings'?<><th>Đơn vị tồn mới *</th><th>Ngưỡng cảnh báo *</th></>:<><th>{editor?.type==='count'?'Thực đếm *':'Số lượng *'}</th>{editor?.type==='receipt'&&<th>Giá nhập/đơn vị (VNĐ)</th>}{editor?.type==='count'&&<th>Chênh lệch</th>}</>}<th>Thao tác</th></tr></thead><tbody>
            {lines.map(line=>{const item=items.find(i=>i.productId===line.productId);return <tr key={line.key}>
              <td><select required aria-label="Chọn sản phẩm" value={line.productId} onChange={e=>chooseProduct(line.key,e.target.value)}><option value="">Chọn sản phẩm</option>{items.map(i=><option key={i.productId} value={i.productId} disabled={lines.some(l=>l.key!==line.key&&l.productId===i.productId)}>{i.code} · {i.name}</option>)}</select>{editor?.type==='receipt'&&item&&<small>{item.supplier||'Chưa có nhà cung cấp'}</small>}</td>
              <td>{item?.unit||'—'}</td><td>{item?item.onHand+' / '+item.reserved:'—'}</td>
              {editor?.type==='settings'?<><td><select required aria-label="Đơn vị tồn mới" value={line.unit} onChange={e=>changeLine(line.key,{unit:e.target.value})}>{!inventoryUnits.includes(line.unit)&&<option value={line.unit}>{line.unit} (hiện tại)</option>}{inventoryUnits.map(unit=><option key={unit} value={unit}>{unit}</option>)}</select></td><td><input required aria-label="Ngưỡng cảnh báo" type="number" min={0} max={2147483647} step={1} value={line.minimum} onChange={e=>changeLine(line.key,{minimum:e.target.value})}/></td></>:<><td><input required aria-label={editor?.type==='count'?'Số lượng thực đếm':'Số lượng'} type="number" min={editor?.type==='count'?0:1} max={2147483647} step={1} value={line.quantity} onChange={e=>changeLine(line.key,{quantity:e.target.value})}/></td>{editor?.type==='receipt'&&<td><input aria-label="Giá nhập một đơn vị" type="number" min={0} max={9999999999.99} step="0.01" value={line.cost} onChange={e=>changeLine(line.key,{cost:e.target.value})}/></td>}{editor?.type==='count'&&<td>{item&&line.quantity!==''?Number(line.quantity)-item.onHand:'—'}</td>}</>}
              <td><button type="button" disabled={lines.length===1} onClick={()=>setLines(current=>current.filter(l=>l.key!==line.key))}>Bỏ dòng</button></td>
            </tr>;})}
          </tbody></table></div>
          <div className="products-actions"><button type="button" disabled={lines.length>=100} onClick={()=>setLines(current=>[...current,blankLine()])}>Thêm sản phẩm</button><button type="button" onClick={addAll}>Thêm tất cả sản phẩm</button></div>
          <label className="inventory-document-note">Ghi chú *<textarea required maxLength={10000} rows={3} value={note} onChange={e=>setNote(e.target.value)}/></label>
        </fieldset>
        <footer className="products-actions"><button type="button" disabled={busy} onClick={()=>setEditor(null)}>Đóng</button><button type="submit" className="primary" disabled={busy}>{busy?'Đang lưu…':'Xác nhận '+(types[editor?.type||'']||'').toLocaleLowerCase('vi')}</button></footer>
      </form>
    </dialog>
    <dialog ref={detailDialog} className="products-dialog inventory-document-dialog" aria-labelledby="inventory-detail-title" onCancel={()=>setDetail(null)} onClose={()=>setDetail(null)}>
      <h2 id="inventory-detail-title">{detail?.code} · {types[detail?.type||'']}</h2><p>{detail&&new Date(detail.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok'})} · {detail?.created_by}</p><p>{detail?.note}</p>
      <div className="products-table-wrap"><table className="products-table"><thead><tr>{['Mã sản phẩm','Tên sản phẩm','Số lượng','Đơn vị trước → sau','Tồn trước → sau','Đang giữ','Ngưỡng trước → sau','Giá nhập'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{detail?.items.map(line=><tr key={line.product_id}><td>{line.product_code}</td><td>{line.product_name}</td><td>{line.quantity??'—'}</td><td>{line.unit_before} → {line.unit_after}</td><td>{line.quantity_before} → {line.quantity_after}</td><td>{line.reserved_after}</td><td>{line.minimum_before} → {line.minimum_after}</td><td>{line.unit_cost==null?'—':Number(line.unit_cost).toLocaleString('vi-VN')+' ₫'}</td></tr>)}</tbody></table></div>
      <footer className="products-actions"><button onClick={()=>setDetail(null)}>Đóng</button></footer>
    </dialog>    <dialog ref={orderDialog} className="products-dialog products-delete" aria-labelledby="inventory-order-title" onCancel={e=>{if(busy)e.preventDefault();else setOrderConfirm(null);}} onClose={()=>setOrderConfirm(null)}><h2 id="inventory-order-title">Xác nhận {orderConfirm?.action==='fulfill'?'xuất giao':orderConfirm?.action==='cancel'?'hủy giữ hàng':'nhận trả hàng'}?</h2><p>{orderConfirm?.order.order_code}</p>{error&&<p role="alert" className="products-error">{error}</p>}<footer className="products-actions"><button disabled={busy} onClick={()=>setOrderConfirm(null)}>Đóng</button><button className="primary" disabled={busy} onClick={()=>void confirmOrder()}>Xác nhận</button></footer></dialog>
  </main>;
}