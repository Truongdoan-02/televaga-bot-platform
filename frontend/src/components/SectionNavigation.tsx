'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Bell, Bot, MessageSquare, Package, Truck, Warehouse, ClipboardList } from 'lucide-react';

type Section = 'chats' | 'bots' | 'notifications' | 'products' | 'suppliers' | 'inventory' | 'orders';

const sections = [
  { id: 'bots', label: 'Quản lý bot', description: 'Danh sách bot và cấu hình token', icon: Bot },
  { id: 'chats', label: 'Chat', description: 'Quản lý hội thoại, nhóm và topic', icon: MessageSquare },
  { id: 'notifications', label: 'Thông báo', description: 'Thông báo, broadcast và bảo trì', icon: Bell },
  { id: 'products', label: 'Sản phẩm', description: 'Danh mục, giá và tình trạng sản phẩm', icon: Package },
  { id: 'suppliers', label: 'Nhà cung cấp', description: 'Đối tác, liên hệ và thông tin hợp tác', icon: Truck },
  { id: 'orders', label: 'Đơn hàng', description: 'Quản lý và duyệt đơn, cập nhật trạng thái', icon: ClipboardList },
  { id: 'inventory', label: 'Tồn kho', description: 'Nhập, xuất, kiểm kê và lịch sử kho', icon: Warehouse },
] as const;

export default function SectionNavigation({ activeSection, onSectionChange }: {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setExpanded(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [expanded]);

  function selectSection(section: Section) {
    setExpanded(false);
    toggleRef.current?.focus();
    onSectionChange(section);
  }

  return (
    <div className="section-switch section-navigation" ref={containerRef}>
      <div className="section-navigation-row">
        <button ref={toggleRef} type="button" className={`section-navigation-toggle${expanded ? ' active' : ''}`}
          aria-label={expanded ? 'Thu gọn chức năng quản lý' : 'Tất cả chức năng quản lý'}
          title="Tất cả chức năng quản lý" aria-expanded={expanded} aria-controls={panelId}
          onClick={() => setExpanded((value) => !value)}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
            {[3, 9, 15].flatMap((cy) => [3, 9, 15].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" />))}
          </svg>
        </button>
        {sections.filter(section => section.id !== 'products' && section.id !== 'suppliers' && section.id !== 'inventory' && section.id !== 'orders').map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={activeSection === id ? 'active' : ''}
            aria-pressed={activeSection === id} onClick={() => selectSection(id)}>
            <Icon size={16} /><span>{label}</span>
          </button>
        ))}
      </div>
      <div id={panelId} className="section-navigation-panel" hidden={!expanded}>
        <span className="section-navigation-heading">Tất cả chức năng quản lý</span>
        {sections.map(({ id, label, description, icon: Icon }) => (
          <button key={id} type="button" className={activeSection === id ? 'active' : ''}
            aria-pressed={activeSection === id} onClick={() => selectSection(id)}>
            <Icon size={19} />
            <span><strong>{label}</strong><small>{description}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}