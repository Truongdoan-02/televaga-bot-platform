'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import ChatList from '@/components/ChatList';
import CreateGroupDialog from '@/components/CreateGroupDialog';
import ChatWindow from '@/components/ChatWindow';
import UserInfoPanel from '@/components/UserInfoPanel';
import BotManagement from '@/components/BotManagement';
import Notifications from '@/components/Notifications';
import ProductManagement from '@/components/ProductManagement';
import SupplierManagement from '@/components/SupplierManagement';
import InventoryManagement from '@/components/InventoryManagement';
import { useSocket } from '@/hooks/useSocket';
import {
  fetchChats,
  fetchChatById,
  fetchMessages,
  sendMessage,
  markChatAsRead,
  updateChat,
  deleteChat,
  toggleMessageReaction,
  setMessagePinned,
  deleteMessage,
  forwardMessage,
  uploadChatMedia,
  openDirectChat,
  fetchManagedBots,
  createForumTopic,
  syncForumTopics,
} from '@/lib/api';
import { Chat, ManagedBot, Message, User } from '@/types';

export default function HomePage() {
  const [activeSection, setActiveSection] = useState<'chats' | 'bots' | 'notifications' | 'products' | 'suppliers' | 'inventory'>('chats');
  const [chats, setChats] = useState<Chat[]>([]);
  const [managedBots, setManagedBots] = useState<ManagedBot[]>([]);
  const [selectedBotId, setSelectedBotId] = useState('');
  const [botSelectionReady, setBotSelectionReady] = useState(false);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [category, setCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [showUserInfo, setShowUserInfo] = useState(false);
  const [openForumId, setOpenForumId] = useState<string | null>(null);
  const [forumTopicsLoading, setForumTopicsLoading] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ── Load chats ──────────────────────────────────────
  const loadChats = useCallback(async () => {
    if (!botSelectionReady || !selectedBotId) {
      setChats([]);
      setChatsLoading(false);
      return;
    }
    try {
      const data = await fetchChats(category, searchQuery, selectedBotId);
      setChats(data);
    } catch (err) {
      console.error('Failed to load chats:', err);
    } finally {
      setChatsLoading(false);
    }
  }, [botSelectionReady, category, searchQuery, selectedBotId]);

  useEffect(() => {
    if (!botSelectionReady) return;
    setChatsLoading(true);
    const timer = setTimeout(() => loadChats(), searchQuery ? 400 : 0);
    return () => clearTimeout(timer);
  }, [botSelectionReady, category, searchQuery, selectedBotId, loadChats]);

  useEffect(() => {
    if (activeSection !== 'chats') return;
    fetchManagedBots().then((bots) => {
      setManagedBots(bots);
      const firstEnabledBotId = bots.find((bot) => bot.isEnabled)?.id || '';
      setSelectedBotId((current) => current || firstEnabledBotId);
      setBotSelectionReady(true);
    }).catch((error) => {
      console.error('Failed to load managed bots:', error);
      setBotSelectionReady(true);
      setChats([]);
      setChatsLoading(false);
    });
  }, [activeSection]);

  const handleBotChange = useCallback((botId: string) => {
    setSelectedBotId(botId);
    setActiveChatId(null);
    setActiveChat(null);
    setMessages([]);
    setShowUserInfo(false);
    setOpenForumId(null);
  }, []);

  const handleCreateTopic = useCallback(async (chatId: string) => {
    const name = window.prompt('Tên topic mới');
    if (!name?.trim()) return;
    try {
      await createForumTopic(chatId, name.trim());
      await loadChats();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Không tạo được topic');
    }
  }, [loadChats]);

  const handleExpandGroup = useCallback(async (chatId: string): Promise<boolean> => {
    try {
      const result = await syncForumTopics(chatId);
      await loadChats();
      return result.isForum;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Không tải được topic của nhóm');
      return false;
    }
  }, [loadChats]);

  // ── Load messages ───────────────────────────────────
  const loadMessages = useCallback(async (chatId: string) => {
    setMessagesLoading(true);
    try {
      const [chat, msgs] = await Promise.all([
        fetchChatById(chatId),
        fetchMessages(chatId),
      ]);
      setActiveChat(chat);
      setMessages(msgs);
      await markChatAsRead(chatId);
      setChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, unreadCount: 0 } : c))
      );
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const handleChatSelect = useCallback(
    (chatId: string) => {
      const selectedChat = chats.find((chat) => chat.id === chatId);
      if (openForumId && selectedChat?.parentChatId !== openForumId && selectedChat?.id !== openForumId) {
        setOpenForumId(null);
      }
      if (chatId === activeChatId) return;
      setActiveChatId(chatId);
      setActiveChat(selectedChat || null);
      setMessages([]);
      setTypingUser(null);
      loadMessages(chatId);
    },
    [activeChatId, chats, loadMessages, openForumId]
  );

  const handleOpenForum = useCallback(async (group: Chat) => {
    if (openForumId === group.id) {
      setOpenForumId(null);
      return;
    }
    setForumTopicsLoading(true);
    try {
      const isForum = group.isForum || chats.some((chat) => chat.parentChatId === group.id)
        ? true
        : await handleExpandGroup(group.id);
      if (!isForum) {
        setOpenForumId(null);
        handleChatSelect(group.id);
        return;
      }
      if (activeChatId !== group.id) handleChatSelect(group.id);
      setOpenForumId(group.id);
    } finally {
      setForumTopicsLoading(false);
    }
  }, [activeChatId, chats, handleChatSelect, handleExpandGroup, openForumId]);

  // ── Send message ────────────────────────────────────
  const handleSendMessage = useCallback(
    async (text: string, replyToId?: string) => {
      if (!activeChatId) return;
      try {
        const msg = await sendMessage(activeChatId, text, replyToId);
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        setChats((prev) =>
          prev.map((c) =>
            c.id === activeChatId ? { ...c, lastMessage: msg, updatedAt: msg.createdAt } : c
          )
        );
      } catch (err) {
        console.error('Failed to send message:', err);
      }
    },
    [activeChatId]
  );

  const handleSendFile = useCallback(async (file: File, caption?: string) => {
    if (!activeChatId) return;
    const message = await uploadChatMedia(activeChatId, file, caption);
    setMessages((prev) => prev.some((item) => item.id === message.id) ? prev : [...prev, message]);
    setChats((prev) => prev.map((chat) => chat.id === activeChatId ? { ...chat, lastMessage: message, updatedAt: message.createdAt } : chat));
  }, [activeChatId]);

  const handleReactMessage = useCallback(async (messageId: string, emoji: string) => {
    if (!activeChatId) return;
    const updated = await toggleMessageReaction(activeChatId, messageId, emoji);
    setMessages((prev) => prev.map((message) => message.id === messageId ? updated : message));
  }, [activeChatId]);

  const handlePinMessage = useCallback(async (message: Message, isPinned: boolean) => {
    if (!activeChatId) return;
    const updated = await setMessagePinned(activeChatId, message.id, isPinned);
    setMessages((prev) => prev.map((item) => item.id === message.id ? updated : item));
  }, [activeChatId]);

  const handleDeleteMessages = useCallback(async (messageIds: string[]) => {
    if (!activeChatId) return;
    await Promise.all(messageIds.map((id) => deleteMessage(activeChatId, id)));
    setMessages((prev) => prev.filter((message) => !messageIds.includes(message.id)));
  }, [activeChatId]);

  const handleForwardMessages = useCallback(async (messageIds: string[], targetChatId: string) => {
    if (!activeChatId) return;
    const forwarded = await Promise.all(messageIds.map((id) => forwardMessage(activeChatId, id, targetChatId)));
    if (targetChatId === activeChatId) {
      setMessages((prev) => [...prev, ...forwarded.filter((msg) => !prev.some((item) => item.id === msg.id))]);
    }
  }, [activeChatId]);

  const handleChatAction = useCallback(async (chat: Chat, action: 'pin' | 'mute' | 'delete') => {
    try {
      if (action === 'delete') {
        await deleteChat(chat.id);
        setChats((prev) => prev.filter((item) => item.id !== chat.id));
        if (activeChatId === chat.id) {
          setActiveChatId(null);
          setActiveChat(null);
          setMessages([]);
          setShowUserInfo(false);
        }
        return;
      }
      const updated = await updateChat(chat.id, action === 'pin' ? { isPinned: !chat.isPinned } : { isMuted: !chat.isMuted });
      setChats((prev) => prev.map((item) => item.id === chat.id ? { ...item, ...updated } : item).sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }));
    } catch (error) {
      console.error('Failed to update chat:', error);
    }
  }, [activeChatId]);

  const handleUpdateChatInfo = useCallback(async (updates: Partial<Chat>) => {
    if (!activeChatId) return;
    await updateChat(activeChatId, updates);
    const refreshed = await fetchChatById(activeChatId);
    setActiveChat(refreshed);
    setChats((prev) => prev.map((item) => item.id === activeChatId ? { ...item, ...refreshed } : item));
  }, [activeChatId]);

  const handleGroupCreated = useCallback(async (chat: Chat) => {
    setShowCreateGroup(false);
    setCategory('all');
    setSearchQuery('');
    setChats((prev) => [chat, ...prev.filter((item) => item.id !== chat.id)]);
    setActiveChatId(chat.id);
    setMessages([]);
    setTypingUser(null);
    setShowUserInfo(false);
    await loadMessages(chat.id);
  }, [loadMessages]);

  const handleOpenUserChat = useCallback(async (userId: string) => {
    try {
      const chat = await openDirectChat(userId, activeChat?.botId);
      setChats((prev) => [chat, ...prev.filter((item) => item.id !== chat.id)]);
      setShowUserInfo(false);
      handleChatSelect(chat.id);
    } catch (error) {
        console.error('Failed to open member chat:', error);
    }
  }, [activeChat?.botId, handleChatSelect]);

  // ── Socket realtime ─────────────────────────────────
  const handleNewMessage = useCallback(
    (msg: Message) => {
      if (msg.chatId === activeChatId) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        markChatAsRead(msg.chatId).catch(() => {});
      }
    },
    [activeChatId]
  );

  const handleChatActivity = useCallback(
    (data: { chatId: string; lastMessage: Message; timestamp: string; avatarUrl?: string; title?: string; sender?: User }) => {
      if (!chats.some((chat) => chat.id === data.chatId)) {
        void loadChats();
        return;
      }
      setActiveChat((current) => {
        if (current?.id !== data.chatId) return current;
        const participants = current.participants || [];
        const sender = data.sender;
        return {
          ...current,
          avatarUrl: data.avatarUrl || current.avatarUrl,
          title: data.title || current.title,
          participants: sender
            ? [...participants.filter((participant) => participant.id !== sender.id), sender]
            : participants,
        };
      });
      setChats((prev) => {
        const updated = prev.map((c) =>
          c.id === data.chatId
            ? {
                ...c,
                lastMessage: data.lastMessage,
                avatarUrl: data.avatarUrl || c.avatarUrl,
                title: data.title || c.title,
                updatedAt: data.timestamp,
                unreadCount:
                  c.id === activeChatId
                    ? 0
                    : !data.lastMessage.isOutgoing
                    ? c.unreadCount + 1
                    : c.unreadCount,
              }
            : c
        );
        return [...updated].sort((a, b) => {
          if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
      });
    },
    [activeChatId, chats, loadChats]
  );

  const handleUserTyping = useCallback(
    (data: { chatId: string; userId: string; isTyping: boolean }) => {
      if (data.chatId !== activeChatId) return;
      if (data.isTyping) {
        const chat = chats.find((c) => c.id === data.chatId);
        setTypingUser(chat?.title || 'Khách hàng');
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => setTypingUser(null), 4000);
      } else {
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        setTypingUser(null);
      }
    },
    [activeChatId, chats]
  );

  const handleChatMarkedRead = useCallback((data: { chatId: string }) => {
    setChats((prev) =>
      prev.map((c) => (c.id === data.chatId ? { ...c, unreadCount: 0 } : c))
    );
  }, []);

  const handleChatStructureChanged = useCallback(() => { void loadChats(); }, [loadChats]);

  useSocket({
    activeChatId,
    onNewMessage: handleNewMessage,
    onChatActivity: handleChatActivity,
    onUserTyping: handleUserTyping,
    onChatMarkedRead: handleChatMarkedRead,
    onChatStructureChanged: handleChatStructureChanged,
  });

  return (
    <div className={`app-shell${activeSection === 'chats' && activeChatId && !openForumId ? ' mobile-chat-open' : ''}${activeSection !== 'chats' ? ' mobile-bots-open' : ''}`} style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <ChatList
        chats={chats}
        managedBots={managedBots}
        selectedBotId={selectedBotId}
        onBotChange={handleBotChange}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        activeChatId={activeChatId}
        category={category}
        searchQuery={searchQuery}
        loading={chatsLoading}
        onChatSelect={handleChatSelect}
        onCategoryChange={setCategory}
        onSearchChange={setSearchQuery}
        onChatAction={handleChatAction}
        onCreateGroup={() => setShowCreateGroup(true)}
        onOpenForum={(chat) => void handleOpenForum(chat)}
        forumGroup={openForumId ? chats.find((chat) => chat.id === openForumId) || null : null}
        forumTopics={openForumId ? chats
          .filter((chat) => chat.parentChatId === openForumId)
          .sort((a, b) => {
            const activityTime = (chat: Chat) => new Date(chat.lastMessage?.createdAt || chat.updatedAt).getTime() || 0;
            return activityTime(b) - activityTime(a);
          }) : []}
        forumTopicsLoading={forumTopicsLoading}
        onCloseTopics={() => setOpenForumId(null)}
        onSelectTopic={(chatId) => {
          handleChatSelect(chatId);
          if (window.matchMedia('(max-width: 760px)').matches) setOpenForumId(null);
        }}
        onCreateTopic={(chatId) => void handleCreateTopic(chatId)}
      />

      {activeSection === 'inventory' ? <InventoryManagement /> : activeSection === 'suppliers' ? <SupplierManagement /> : activeSection === 'products' ? <ProductManagement /> : activeSection === 'bots' ? <BotManagement /> : activeSection === 'notifications' ? <Notifications /> : <>
      {showCreateGroup && <CreateGroupDialog onClose={() => setShowCreateGroup(false)} onCreated={(chat) => void handleGroupCreated(chat)} />}

      <ChatWindow
        chat={activeChat}
        chats={chats}
        messages={messages}
        loading={messagesLoading}
        typingUser={typingUser}
        onSendMessage={handleSendMessage}
        onSendFile={handleSendFile}
        onReactMessage={handleReactMessage}
        onPinMessage={handlePinMessage}
        onDeleteMessages={handleDeleteMessages}
        onForwardMessages={handleForwardMessages}
        onOpenUserInfo={() => setShowUserInfo((v) => !v)}
        onOpenSenderChat={handleOpenUserChat}
        onBackToChats={() => { setOpenForumId(null); setShowUserInfo(false); setActiveChatId(null); setActiveChat(null); setMessages([]); }}
        onOpenTopics={() => {
          const group = activeChat?.parentChatId
            ? chats.find((item) => item.id === activeChat.parentChatId)
            : activeChat?.type === 'group' ? activeChat : undefined;
          if (group) void handleOpenForum(group);
        }}
      />

      <UserInfoPanel
        chat={activeChat}
        messages={messages}
        onUpdateChat={handleUpdateChatInfo}
        onOpenMemberChat={(member) => void handleOpenUserChat(member.id)}
        isOpen={showUserInfo}
        onClose={() => setShowUserInfo(false)}
      />

      </>}
    </div>
  );
}
