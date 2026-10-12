import { createElement, type ReactNode } from 'react';

const tags: Record<string, string> = { b: 'b', strong: 'strong', i: 'i', em: 'em', u: 'u', ins: 'u', s: 's', strike: 's', del: 's', code: 'code', pre: 'pre', blockquote: 'blockquote', a: 'a', span: 'span', 'tg-spoiler': 'span' };

export default function TelegramHtmlPreview({ text, html }: { text: string; html: boolean }) {
  if (!html || typeof DOMParser === 'undefined') return <>{text}</>;
  // Keep only Telegram formatting tags before parsing; never mount user HTML or attributes.
  const source = text.replace(/<\/?([a-z][\w-]*)\b[^>]*>/gi, (tag, name: string) => tags[name.toLowerCase()] ? tag : '');
  const document = new DOMParser().parseFromString(source, 'text/html');
  const render = (node: Node, key: number): ReactNode => {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return null;
    const element = node as Element;
    const name = element.tagName.toLowerCase();
    const children = Array.from(node.childNodes).map(render);
    if (!tags[name]) return children;
    if (name === 'a') {
      const href = element.getAttribute('href') || '';
      if (!/^(https?:\/\/|tg:\/\/|mailto:)/i.test(href)) return children;
      return <a key={key} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
    }
    const spoiler = name === 'tg-spoiler' || name === 'span' && element.classList.contains('tg-spoiler');
    return createElement(tags[name], { key, ...(spoiler ? { className: 'telegram-spoiler' } : {}) }, children);
  };
  return <>{Array.from(document.body.childNodes).map(render)}</>;
}
