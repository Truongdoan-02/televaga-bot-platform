import { Chat, Message, User, ManagedBot, BotActionButton, AISummary, AISuggestion } from '@/types';

import { authenticatedFetch } from './auth';

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';
export const broadcastImageSrc = (imageUrl: string) => imageUrl.startsWith('/uploads/') ? `${BASE_URL}${imageUrl}` : imageUrl;
export const uploadBroadcastImage = async (file: File): Promise<{ imageUrl: string }> => {
  const response = await authenticatedFetch(`${BASE_URL}/api/broadcasts/images`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  if (response.status === 413) throw new Error('Ảnh tối đa 10 MB.');
  const result = await response.json();
  if (!result.success) throw new Error(result.error || 'Không tải được ảnh.');
  return result.data;
};

export interface BroadcastInput {
  title: string; content: string; botId: string; audience: string; parseMode: string;
  imageUrl: string; buttonText: string; buttonUrl: string; scheduledAt: string | null;
}
export interface BroadcastItem extends BroadcastInput {
  id: string; createdAt: string; status: string; total: number; sent: number; failed: number;
}
export interface BroadcastDetail extends BroadcastItem {
  recipients: { chatId: string; name: string; status: string; error?: string }[];
}
export interface MaintenanceSettings { enabled: boolean; message: string; notifyStart: boolean; notifyEnd: boolean }
export const fetchBroadcasts = () => apiFetch<{ items: BroadcastItem[]; maintenance: MaintenanceSettings }>('/api/broadcasts');
export const fetchBroadcastDetail = (id: string) => apiFetch<BroadcastDetail>(`/api/broadcasts/${id}`);
export const fetchBroadcastAudience = (botId: string, audience: string) => apiFetch<{ count: number }>(`/api/broadcasts/audience?${new URLSearchParams({ botId, audience })}`);
export const createBroadcast = (input: BroadcastInput, sendNow: boolean) => apiFetch<BroadcastDetail>('/api/broadcasts', { method: 'POST', body: JSON.stringify({ ...input, sendNow }) });
export const broadcastAction = (id: string, action: string) => apiFetch<BroadcastDetail>(`/api/broadcasts/${id}/action`, { method: 'POST', body: JSON.stringify({ action }) });
export const updateMaintenance = (settings: MaintenanceSettings, botId: string) => apiFetch<MaintenanceSettings>('/api/broadcasts/maintenance', { method: 'PUT', body: JSON.stringify({ ...settings, botId }) });

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await authenticatedFetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'API error');
  return json.data as T;
}

// ── Chats ──────────────────────────────────────────────
export const fetchChats = (category?: string, search?: string, botId?: string): Promise<Chat[]> => {
  const params = new URLSearchParams();
  if (category && category !== 'all') params.set('category', category);
  if (search) params.set('search', search);
  if (botId) params.set('botId', botId);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<Chat[]>(`/api/chats${qs}`);
};

export const fetchChatById = (id: string): Promise<Chat> =>
  apiFetch<Chat>(`/api/chats/${id}`);

export const deleteChat = (id: string): Promise<void> =>
  apiFetch<void>(`/api/chats/${id}`, { method: 'DELETE' });

export const updateChat = (id: string, updates: Partial<Chat>): Promise<Chat> =>
  apiFetch<Chat>(`/api/chats/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });

export const markChatAsRead = (id: string): Promise<void> =>
  apiFetch<void>(`/api/chats/${id}/read`, { method: 'POST' });

export const fetchUsers = (): Promise<User[]> => apiFetch<User[]>('/api/users');

export const createGroupChat = (title: string, memberIds: string[]): Promise<Chat> =>
  apiFetch<Chat>('/api/chats/groups', { method: 'POST', body: JSON.stringify({ title, memberIds }) });

export const openDirectChat = (userId: string, botId?: string): Promise<Chat> =>
  apiFetch<Chat>('/api/chats/direct', { method: 'POST', body: JSON.stringify({ userId, botId }) });

export const createForumTopic = (chatId: string, name: string): Promise<Chat> =>
  apiFetch<Chat>(`/api/chats/${chatId}/topics`, { method: 'POST', body: JSON.stringify({ name }) });

export const syncForumTopics = (chatId: string): Promise<{ isForum: boolean; topics: Chat[] }> =>
  apiFetch<{ isForum: boolean; topics: Chat[] }>(`/api/chats/${chatId}/topics/sync`, { method: 'POST' });

export const fetchManagedBots = (): Promise<ManagedBot[]> => apiFetch<ManagedBot[]>('/api/bots');

export const createManagedBot = (name: string, token: string): Promise<ManagedBot> =>
  apiFetch<ManagedBot>('/api/bots', { method: 'POST', body: JSON.stringify({ name, token }) });

export const updateManagedBot = (id: string, name: string, token?: string): Promise<ManagedBot> =>
  apiFetch<ManagedBot>(`/api/bots/${id}`, { method: 'PATCH', body: JSON.stringify({ name, token }) });

export const validateManagedBot = (id: string): Promise<ManagedBot> =>
  apiFetch<ManagedBot>(`/api/bots/${id}/validate`, { method: 'POST' });

export const setManagedBotEnabled = (id: string, isEnabled: boolean): Promise<ManagedBot> =>
  apiFetch<ManagedBot>(`/api/bots/${id}/enabled`, { method: 'PATCH', body: JSON.stringify({ isEnabled }) });

export const fetchBotActionButtons = (id: string): Promise<BotActionButton[]> =>
  apiFetch<BotActionButton[]>(`/api/bots/${id}/buttons`);

export const saveBotActionButtons = (id: string, buttons: BotActionButton[]): Promise<BotActionButton[]> =>
  apiFetch<BotActionButton[]>(`/api/bots/${id}/buttons`, { method: 'PUT', body: JSON.stringify({ buttons }) });

export const fetchBotFlowPrompts = (id: string): Promise<Record<string, string>> =>
  apiFetch<Record<string, string>>(`/api/bots/${id}/flow-prompts`);

export const saveBotFlowPrompts = (id: string, prompts: Record<string, string>): Promise<Record<string, string>> =>
  apiFetch<Record<string, string>>(`/api/bots/${id}/flow-prompts`, { method: 'PUT', body: JSON.stringify({ prompts }) });

// ── Messages ──────────────────────────────────────────
export const fetchMessages = (chatId: string): Promise<Message[]> =>
  apiFetch<Message[]>(`/api/chats/${chatId}/messages`);

export const uploadChatMedia = async (chatId: string, file: File, caption = ''): Promise<Message> => {
  const response = await authenticatedFetch(`${BASE_URL}/api/chats/${chatId}/messages/media`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Message-Caption': encodeURIComponent(caption) },
    body: file,
  });
  const json = await response.json();
  if (!json.success) throw new Error(json.error || 'Không thể gửi tệp');
  return json.data as Message;
};

export const sendMessage = (chatId: string, text: string, replyToId?: string): Promise<Message> =>
  apiFetch<Message>(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text, replyToId }),
  });

export const toggleMessageReaction = (chatId: string, messageId: string, emoji: string): Promise<Message> =>
  apiFetch<Message>(`/api/chats/${chatId}/messages/${messageId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  });

export const setMessagePinned = (chatId: string, messageId: string, isPinned: boolean): Promise<Message> =>
  apiFetch<Message>(`/api/chats/${chatId}/messages/${messageId}/pin`, {
    method: 'PATCH',
    body: JSON.stringify({ isPinned }),
  });

export const deleteMessage = (chatId: string, messageId: string): Promise<void> =>
  apiFetch<void>(`/api/chats/${chatId}/messages/${messageId}`, { method: 'DELETE' });

export const forwardMessage = (chatId: string, messageId: string, targetChatId: string): Promise<Message> =>
  apiFetch<Message>(`/api/chats/${chatId}/messages/${messageId}/forward`, {
    method: 'POST',
    body: JSON.stringify({ targetChatId }),
  });

// ── AI ────────────────────────────────────────────────
export const summarizeChat = (chatId: string): Promise<AISummary> =>
  apiFetch<AISummary>(`/api/ai/summarize/${chatId}`, { method: 'POST' });

export const getCachedSummary = (chatId: string): Promise<AISummary | null> =>
  apiFetch<AISummary | null>(`/api/ai/summary/${chatId}`);

export const getReplySuggestions = (chatId: string): Promise<AISuggestion[]> =>
  apiFetch<AISuggestion[]>(`/api/ai/suggest/${chatId}`, { method: 'POST' });

export const chatWithAI = (query: string, chatId?: string): Promise<{ reply: string }> =>
  apiFetch<{ reply: string }>(`/api/ai/chat`, {
    method: 'POST',
    body: JSON.stringify({ query, chatId }),
  });

export type ProductStatus = 'in_stock' | 'out_of_stock' | 'discontinued';
export interface ProductInput {
  code: string; name: string; quantity: string; price: number; supplier: string; supplierCode: string;
  status: ProductStatus; description: string; imageUrl: string;
}
export interface Product extends ProductInput { id: string }
export const fetchProducts = () => apiFetch<Product[]>('/api/products');
export const fetchProduct = (id: string) => apiFetch<Product>(`/api/products/${encodeURIComponent(id)}`);
export const createProduct = (input: ProductInput) => apiFetch<Product>('/api/products', { method: 'POST', body: JSON.stringify(input) });
export const updateProduct = (id: string, input: ProductInput) => apiFetch<Product>(`/api/products/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
export const deleteProduct = (id: string) => apiFetch<null>(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
export interface SupplierInput {
  name: string; contactName: string; phone: string; email: string; address: string;
  taxCode: string; bankAccount: string; bankName: string; status: 0 | 1; note: string;
}
export interface Supplier extends SupplierInput { code: string; createdAt: string; updatedAt: string; productPrefix: string }
export const fetchSuppliers = () => apiFetch<Supplier[]>('/api/suppliers');
export const fetchSupplier = (code: string) => apiFetch<Supplier>('/api/suppliers/' + encodeURIComponent(code));
export const createSupplier = (input: SupplierInput) => apiFetch<Supplier>('/api/suppliers', { method: 'POST', body: JSON.stringify(input) });
export const updateSupplier = (code: string, input: SupplierInput) => apiFetch<Supplier>('/api/suppliers/' + encodeURIComponent(code), { method: 'PUT', body: JSON.stringify(input) });
export const deleteSupplier = (code: string) => apiFetch<null>('/api/suppliers/' + encodeURIComponent(code), { method: 'DELETE' });
export const fetchNextSupplierCode = () => apiFetch<{ code: string }>('/api/suppliers/next-code');

export const fetchNextProductCode = (supplierCode: string) => apiFetch<{ code: string }>('/api/products/next-code?' + new URLSearchParams({ supplierCode }));

export const productImageSrc = (imageUrl: string) => imageUrl.startsWith('/uploads/') ? BASE_URL + imageUrl : imageUrl;
export const uploadProductImage = async (file: File): Promise<{ imageUrl: string }> => {
  const response = await authenticatedFetch(BASE_URL + '/api/products/images', {
    method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
  });
  if (response.status === 413) throw new Error('Ảnh tối đa 10 MB.');
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || 'Không tải được ảnh.');
  return result.data;
};
export interface InventoryItem { salePrice: number; productId: string; code: string; name: string; imageUrl: string; quantity: string; supplier: string; unit: string; onHand: number; reserved: number; available: number; minimumQuantity: number }
export interface InventoryTransaction { id: number; code: string; product_id: string; product_code: string; product_name: string; type: string; quantity_change: number; reserved_change: number; quantity_before: number; quantity_after: number; reserved_before: number; reserved_after: number; unit_cost: number|null; note: string; created_by: string; created_at: string; order_id: number|null; document_id: string|null; document_code: string|null }
export interface InventoryOrder { order_id: number; order_code: string; state: string; products: string; updated_at: string }
export interface InventoryInput { productId: string; type: 'receipt'|'issue'|'count'|'return'; quantity: number; note: string; reference: string; unitCost: number|null }
export const fetchInventory = () => apiFetch<InventoryItem[]>('/api/inventory');
export const fetchInventoryHistory = (productId='') => apiFetch<InventoryTransaction[]>('/api/inventory/history'+(productId?'?'+new URLSearchParams({productId}):''));
export const fetchInventoryOrders = () => apiFetch<InventoryOrder[]>('/api/inventory/orders');
export const createInventoryTransaction = (input:InventoryInput) => apiFetch<{code:string}>('/api/inventory/transactions',{method:'POST',body:JSON.stringify(input)});
export const updateInventorySettings = (id:string,unit:string,minimumQuantity:number) => apiFetch<null>('/api/inventory/'+encodeURIComponent(id)+'/settings',{method:'PUT',body:JSON.stringify({unit,minimumQuantity})});
export const inventoryOrderAction = (id:number,action:string) => apiFetch<null>('/api/inventory/orders/'+id+'/action',{method:'POST',body:JSON.stringify({action})});
export type InventoryDocumentType = InventoryInput['type']|'settings';
export interface InventoryDocumentInput { type:InventoryDocumentType;note:string;reference:string;items:{productId:string;quantity?:number;unitCost?:number|null;unit?:string;minimumQuantity?:number}[] }
export interface InventoryDocument { id:string;code:string;type:InventoryDocumentType;note:string;created_by:string;created_at:string;item_count:number }
export interface InventoryDocumentLine { product_id:string;product_code:string;product_name:string;quantity:number|null;unit_cost:number|null;quantity_before:number;quantity_after:number;reserved_before:number;reserved_after:number;unit_before:string;unit_after:string;minimum_before:number;minimum_after:number }
export interface InventoryDocumentDetail extends InventoryDocument { items:InventoryDocumentLine[] }
export const fetchInventoryDocuments = () => apiFetch<InventoryDocument[]>('/api/inventory/documents');
export const fetchInventoryDocument = (id:string) => apiFetch<InventoryDocumentDetail>('/api/inventory/documents/'+encodeURIComponent(id));
export const createInventoryDocument = (input:InventoryDocumentInput) => apiFetch<InventoryDocumentDetail>('/api/inventory/documents',{method:'POST',body:JSON.stringify(input)});