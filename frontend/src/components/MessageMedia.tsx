'use client';

import { useState } from 'react';
import { File as FileIcon } from 'lucide-react';
import { Message } from '@/types';
import { assetUrl } from '@/lib/assets';

export default function MessageMedia({ message, selectionMode }: { message: Message; selectionMode: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!message.mediaUrl) return null;
  const url = assetUrl(message.mediaUrl);
  const name = message.fileName || message.text || 'T?p ??nh k?m';
  let type = message.type;
  // Older messages saved media sent as a Telegram document with this type.
  if (type === 'document') {
    const filename = message.fileName || message.mediaUrl.split(/[?#]/)[0];
    if (/\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(filename)) type = 'image';
    else if (/\.(mp4|webm|mov|m4v)$/i.test(filename)) type = 'video';
    else if (/\.(mp3|ogg|oga|wav|m4a|aac|flac|opus)$/i.test(filename)) type = 'audio';
  }
  const stopSelection = (event: React.MouseEvent) => {
    if (!selectionMode) event.stopPropagation();
    else event.preventDefault();
  };
  return <div>
    {!failed && type === 'image' && <a href={url} target="_blank" rel="noreferrer" onClick={stopSelection} title="M? ?nh k?ch th??c ??y ??">
      <img src={url} alt={name} loading="lazy" onError={() => setFailed(true)} style={{ display: 'block', width: 'min(360px, 65vw)', maxHeight: 360, borderRadius: 10, objectFit: 'contain', marginBottom: 5 }} />
    </a>}
    {!failed && type === 'video' && <video src={url} controls playsInline preload="metadata" onClick={stopSelection} onError={() => setFailed(true)} style={{ display: 'block', width: 'min(360px, 65vw)', maxHeight: 360, borderRadius: 10, marginBottom: 5 }} />}
    {!failed && type === 'audio' && <audio src={url} controls preload="metadata" onClick={stopSelection} onError={() => setFailed(true)} style={{ display: 'block', width: 'min(300px, 60vw)' }} />}
    {failed && <div style={{ fontSize: 12, marginBottom: 6 }}>Kh?ng xem ???c t?p n?y. B?n c? th? m? ho?c t?i t?p b?n d??i.</div>}
    <a href={url} download={name} target="_blank" rel="noreferrer" onClick={stopSelection} style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 320, padding: '8px 4px', color: 'inherit', textDecoration: 'none', fontSize: 12 }}>
      <FileIcon size={18} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    </a>
  </div>;
}
