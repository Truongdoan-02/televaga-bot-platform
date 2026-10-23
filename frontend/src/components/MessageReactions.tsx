'use client';

import { useState } from 'react';
import { Chat, Message } from '@/types';
import { assetUrl } from '@/lib/assets';

function ReactionAvatar({ name, url }: { name: string; url?: string }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return <span className="reaction-avatar" title={name}>
    {url && failedUrl !== url
      ? <img src={assetUrl(url)} alt={name} onError={() => setFailedUrl(url)} />
      : <span>{name.trim().slice(0, 1).toUpperCase() || '?'}</span>}
  </span>;
}

export default function MessageReactions({ message, chat, onReact }: {
  message: Message;
  chat: Chat;
  onReact: (messageId: string, emoji: string) => void;
}) {
  const grouped = new Map<string, Set<string>>();
  for (const [raw, users] of Object.entries(message.reactions || {})) {
    const emoji = raw.replace(/[\uFE0E\uFE0F]/g, '') === '\u2764' ? '\u2764\uFE0F' : raw;
    const actors = grouped.get(emoji) || new Set<string>();
    users.forEach(user => actors.add(user));
    if (actors.size) grouped.set(emoji, actors);
  }
  if (!grouped.size) return null;
  return <div className={'message-reactions' + (message.isOutgoing ? ' align-right' : '')}>
    {Array.from(grouped, ([emoji, actors]) => {
      const users = [...actors];
      const people = users.filter(id => !id.startsWith('tg_anonymous_')).map(id => {
        const user = chat.participants?.find(person => person.id === id);
        const own = id === 'user_agent_me';
        const directCustomer = !own && chat.type === 'direct' && (chat.participantIds.includes(id) || user);
        return { id, name: user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : own ? 'B\u1ea1n' : directCustomer ? chat.title : 'Ng\u01b0\u1eddi d\u00f9ng Telegram', url: user?.avatarUrl || (directCustomer ? chat.avatarUrl : undefined) };
      });
      return <button key={emoji} className={actors.has('user_agent_me') ? 'active' : ''}
        aria-pressed={actors.has('user_agent_me')} aria-label={`${emoji}: ${users.length}`}
        title={people.map(person => person.name).join(', ') || `${users.length}`}
        onClick={() => onReact(message.id, emoji)}>
        <span className="reaction-emoji">{emoji.startsWith('custom:') ? '\u2728' : emoji}</span>
        {people.length > 0 && users.length <= 3
          ? <span className="reaction-avatars">{people.map(person => <ReactionAvatar key={person.id} name={person.name} url={person.url} />)}</span>
          : <span className="reaction-count">{users.length}</span>}
      </button>;
    })}
  </div>;
}
