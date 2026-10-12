import React from 'react';
import { Message } from '@/types';

type Entity = NonNullable<Message['entities']>[number];
const tagTypes: Record<string, string> = { b: 'bold', strong: 'bold', i: 'italic', em: 'italic', u: 'underline', ins: 'underline', s: 'strikethrough', strike: 'strikethrough', del: 'strikethrough', code: 'code', pre: 'pre', a: 'text_link', blockquote: 'blockquote' };

function decodeText(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (original, code: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (!code.startsWith('#')) return named[code.toLowerCase()] ?? original;
    const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : original;
  });
}

// Older broadcast records contain the HTML source instead of Telegram's response.
// Parse only known formatting tags; never insert message HTML into the DOM.
function legacyBroadcast(message: Message): { text: string; entities: Entity[] } {
  const entities: Entity[] = [];
  const stack: Array<{ tag: string; entity: Entity }> = [];
  let text = '';
  for (const token of message.text.split(/(<\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|a|blockquote)\b[^>]*>)/gi)) {
    const match = token.match(/^<(\/)?([a-z]+)\b[^>]*>$/i);
    if (!match || !tagTypes[match[2].toLowerCase()]) { text += decodeText(token); continue; }
    const tag = match[2].toLowerCase();
    if (!match[1]) {
      const url = token.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1];
      stack.push({ tag, entity: { type: tagTypes[tag], offset: text.length, length: 0, url: url ? decodeText(url) : undefined } });
    } else {
      const index = stack.map(item => item.tag).lastIndexOf(tag);
      if (index < 0) continue;
      const [item] = stack.splice(index, 1);
      entities.push({ ...item.entity, length: text.length - item.entity.offset });
    }
  }
  return { text, entities };
}

export function getMessageContent(message: Message): { text: string; entities?: Entity[] } {
  if (!message.isOutgoing && message.id.startsWith('callback_') && message.text.startsWith('Khách chọn: ')) {
    return { text: message.text.slice('Khách chọn: '.length) };
  }
  return !message.entities && message.id.startsWith('broadcast_')
    ? legacyBroadcast(message) : message;
}

export default function MessageText({ message }: { message: Message }) {
  const { text, entities = [] } = getMessageContent(message);
  const valid = entities.filter(entity => Number.isInteger(entity.offset) && Number.isInteger(entity.length) && entity.offset >= 0 && entity.length > 0 && entity.offset + entity.length <= text.length);
  const boundaries = [...new Set([0, text.length, ...valid.flatMap(entity => [entity.offset, entity.offset + entity.length])])].sort((a, b) => a - b);
  return <>{boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    let node: React.ReactNode = text.slice(start, end);
    for (const entity of valid.filter(entity => entity.offset <= start && entity.offset + entity.length >= end)) {
      switch (entity.type) {
        case 'bold': node = <strong>{node}</strong>; break;
        case 'italic': node = <em>{node}</em>; break;
        case 'underline': node = <u>{node}</u>; break;
        case 'strikethrough': node = <s>{node}</s>; break;
        case 'code': case 'pre': node = <code>{node}</code>; break;
        case 'blockquote': node = <span className="telegram-quote">{node}</span>; break;
        case 'text_link': case 'url': {
          const url = entity.url || text.slice(entity.offset, entity.offset + entity.length);
          if (/^(https?:\/\/|tg:\/\/|mailto:)/i.test(url)) node = <a href={url} target="_blank" rel="noopener noreferrer">{node}</a>;
          break;
        }
      }
    }
    return <React.Fragment key={start}>{node}</React.Fragment>;
  })}</>;
}
