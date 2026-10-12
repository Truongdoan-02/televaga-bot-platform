'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Sparkles,
  MessageSquareText,
  Bot,
  RefreshCw,
  Send,
  Copy,
  CheckCircle2,
  AlertCircle,
  Clock,
  ThumbsUp,
  Zap,
  BookOpen,
} from 'lucide-react';
import { Chat, Message, AISummary, AISuggestion, AIChatMessage } from '@/types';
import {
  summarizeChat,
  getReplySuggestions,
  chatWithAI,
} from '@/lib/api';

type AIPanelTab = 'summary' | 'suggest' | 'chat';

interface AIPanelProps {
  chat: Chat | null;
  onUseReply: (text: string) => void;
}

const sentimentConfig: Record<string, { emoji: string; className: string }> = {
  'Tích cực': { emoji: '😊', className: 'positive' },
  'Trung tính': { emoji: '😐', className: 'neutral' },
  'Căng thẳng / Khiếu nại': { emoji: '😠', className: 'negative' },
};

const statusConfig: Record<string, { className: string; emoji: string }> = {
  'Đang giải quyết': { className: 'processing', emoji: '🔄' },
  'Cần báo giá': { className: 'quote', emoji: '💰' },
  'Chờ khách phản hồi': { className: 'waiting', emoji: '⏳' },
  'Hoàn thành': { className: 'done', emoji: '✅' },
};

const toneConfig: Record<string, { icon: string; className: string }> = {
  professional: { icon: '🎯', className: 'tone-professional' },
  quick: { icon: '⚡', className: 'tone-quick' },
  consultative: { icon: '🏆', className: 'tone-consultative' },
};

function CopiedToast() {
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: '#1e2d3d', border: '1px solid rgba(82,136,193,0.3)',
      borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8,
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)', animation: 'popIn 0.2s ease',
    }}>
      <CheckCircle2 size={16} style={{ color: '#34d399' }} />
      <span style={{ fontSize: 13, color: 'var(--tg-text-primary)' }}>Đã sao chép!</span>
    </div>
  );
}

// ── Summary Tab ──────────────────────────────────────────
function SummaryTab({ chatId }: { chatId: string }) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<AISummary | null>(null);
  const [error, setError] = useState('');

  const handleSummarize = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await summarizeChat(chatId);
      setSummary(result);
    } catch (e: any) {
      setError(e.message || 'Lỗi tóm tắt hội thoại');
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  // Reset when chatId changes
  useEffect(() => {
    setSummary(null);
    setError('');
  }, [chatId]);

  const sentiment = summary ? (sentimentConfig[summary.sentiment] || sentimentConfig['Trung tính']) : null;
  const status = summary ? (statusConfig[summary.currentStatus] || statusConfig['Đang giải quyết']) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button className="ai-action-btn" onClick={handleSummarize} disabled={loading}>
        {loading ? (
          <>
            <div className="spinner spinner-sm" style={{ borderTopColor: '#a78bfa' }} />
            Đang phân tích hội thoại...
          </>
        ) : (
          <>
            <Sparkles size={15} />
            {summary ? 'Phân tích lại' : 'Tóm tắt hội thoại'}
          </>
        )}
      </button>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 10, fontSize: 12.5, color: '#f87171' }}>
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {summary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, animation: 'fadeIn 0.3s ease' }}>
          {/* Sentiment & Status row */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className={`ai-sentiment-badge ${sentiment?.className}`}>
              {sentiment?.emoji} {summary.sentiment}
            </span>
            <span className={`ai-status-badge ${status?.className}`}>
              {status?.emoji} {summary.currentStatus}
            </span>
          </div>

          {/* Summary text */}
          <div className="ai-card">
            <div className="ai-card-label">📝 Tóm tắt</div>
            <div className="ai-card-value">{summary.summaryText}</div>
          </div>

          {/* Customer goal */}
          <div className="ai-card">
            <div className="ai-card-label">🎯 Nhu cầu khách hàng</div>
            <div className="ai-card-value">{summary.customerGoal}</div>
          </div>

          {/* Main questions */}
          {summary.mainQuestions.length > 0 && (
            <div className="ai-card">
              <div className="ai-card-label">❓ Vấn đề nổi bật</div>
              <ul style={{ paddingLeft: 16, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {summary.mainQuestions.map((q, i) => (
                  <li key={i} style={{ fontSize: 13, color: 'var(--tg-text-primary)', lineHeight: 1.5 }}>{q}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommended action */}
          <div className="ai-card" style={{ borderColor: 'rgba(82,136,193,0.2)', background: 'rgba(82,136,193,0.05)' }}>
            <div className="ai-card-label" style={{ color: '#5288c1' }}>💡 Hành động đề xuất</div>
            <div className="ai-card-value" style={{ color: '#8ab4d0' }}>{summary.recommendedAction}</div>
          </div>

          <div style={{ fontSize: 10.5, color: 'var(--tg-text-muted)', textAlign: 'right' }}>
            Phân tích lúc {new Date(summary.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      )}

      {!summary && !loading && (
        <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--tg-text-muted)', fontSize: 13 }}>
          <Sparkles size={32} style={{ margin: '0 auto 10px', opacity: 0.3, display: 'block' }} />
          Nhấn nút trên để AI phân tích toàn bộ hội thoại này
        </div>
      )}
    </div>
  );
}

// ── Suggestions Tab ──────────────────────────────────────
function SuggestTab({ chatId, onUseReply }: { chatId: string; onUseReply: (t: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [error, setError] = useState('');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getReplySuggestions(chatId);
      setSuggestions(result);
    } catch (e: any) {
      setError(e.message || 'Lỗi tạo gợi ý');
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    setSuggestions([]);
    setError('');
  }, [chatId]);

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button className="ai-action-btn" onClick={handleGenerate} disabled={loading}>
        {loading ? (
          <>
            <div className="spinner spinner-sm" style={{ borderTopColor: '#a78bfa' }} />
            Đang tạo gợi ý...
          </>
        ) : (
          <>
            <MessageSquareText size={15} />
            {suggestions.length > 0 ? 'Tạo lại gợi ý' : 'Gợi ý câu trả lời'}
          </>
        )}
      </button>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 10, fontSize: 12.5, color: '#f87171' }}>
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {suggestions.map((s, i) => {
        const tone = toneConfig[s.tone] || toneConfig.professional;
        return (
          <div key={i} className="suggestion-card animate-fadeIn" style={{ animationDelay: `${i * 0.05}s` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className={`suggestion-tone-badge ${tone.className}`}>
                {tone.icon} {s.label}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => handleCopy(s.replyText, i)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tg-text-muted)', padding: 4, borderRadius: 6, transition: 'color 0.15s', display: 'flex' }}
                  title="Sao chép"
                >
                  {copiedIdx === i ? <CheckCircle2 size={14} style={{ color: '#34d399' }} /> : <Copy size={14} />}
                </button>
                <button
                  onClick={() => onUseReply(s.replyText)}
                  style={{ background: 'var(--tg-accent-light)', border: 'none', cursor: 'pointer', color: 'var(--tg-accent)', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}
                  title="Dùng câu này"
                >
                  <Send size={10} /> Dùng
                </button>
              </div>
            </div>
            <p className="suggestion-text">{s.replyText}</p>
            {s.reason && (
              <p className="suggestion-reason">💡 {s.reason}</p>
            )}
          </div>
        );
      })}

      {suggestions.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--tg-text-muted)', fontSize: 13 }}>
          <MessageSquareText size={32} style={{ margin: '0 auto 10px', opacity: 0.3, display: 'block' }} />
          AI sẽ đề xuất 3 câu trả lời phù hợp nhất cho ngữ cảnh hội thoại
        </div>
      )}
    </div>
  );
}

// ── AI Chat Tab ──────────────────────────────────────────
function AIChatTab({ chatId, chatTitle }: { chatId: string | null; chatTitle?: string }) {
  const [messages, setMessages] = useState<AIChatMessage[]>([
    {
      id: 'sys-0',
      role: 'assistant',
      content: `Xin chào! Tôi là **TeleVaga AI Assistant** 🚀\n\nTôi có thể giúp bạn:\n- 📊 Phân tích và báo giá cho khách hàng\n- 💬 Soạn thảo câu trả lời chuyên nghiệp\n- 🔧 Giải đáp câu hỏi kỹ thuật về hệ thống\n- 📋 Tổng hợp thông tin hội thoại\n\nBạn cần hỗ trợ gì hôm nay?`,
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: AIChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const { reply } = await chatWithAI(text, chatId || undefined);
      const assistantMsg: AIChatMessage = {
        id: `ast-${Date.now()}`,
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `❌ Lỗi: ${e.message || 'Không thể kết nối AI'}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, chatId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickPrompts = chatId
    ? [`Báo giá cho ${chatTitle}`, 'Phân tích tình trạng hội thoại', 'Soạn email follow-up']
    : ['Cách tối ưu CSKH qua Telegram?', 'Gợi ý script sale hiệu quả', 'Best practice WebSocket'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      {/* Messages */}
      <div className="ai-chat-messages" style={{ flex: 1 }}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`ai-chat-bubble ${msg.role} animate-fadeIn`}
            style={{ whiteSpace: 'pre-wrap' }}
          >
            {msg.content}
          </div>
        ))}
        {loading && (
          <div className="ai-chat-bubble assistant animate-fadeIn" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div className="typing-dots">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
            <span style={{ fontSize: 12, color: 'var(--tg-text-muted)' }}>TeleVaga AI đang trả lời...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick prompts */}
      {messages.length < 3 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {quickPrompts.map((p) => (
            <button
              key={p}
              onClick={() => setInput(p)}
              style={{
                background: 'var(--tg-bg-tertiary)',
                border: '1px solid var(--tg-border)',
                borderRadius: 12, padding: '4px 10px', fontSize: 11,
                color: 'var(--tg-text-secondary)', cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(167,139,250,0.4)'; e.currentTarget.style.color = '#a78bfa'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--tg-border)'; e.currentTarget.style.color = 'var(--tg-text-secondary)'; }}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="ai-chat-input-row">
        <textarea
          className="ai-chat-input"
          placeholder="Hỏi AI Copilot..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button className="ai-chat-send-btn" onClick={handleSend} disabled={!input.trim() || loading}>
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Main AI Panel ────────────────────────────────────────
export default function AIPanel({ chat, onUseReply }: AIPanelProps) {
  const [activeTab, setActiveTab] = useState<AIPanelTab>('summary');

  const tabs: { key: AIPanelTab; label: string; icon: React.ReactNode }[] = [
    { key: 'summary', label: 'Tóm tắt', icon: <BookOpen size={13} /> },
    { key: 'suggest', label: 'Gợi ý', icon: <Zap size={13} /> },
    { key: 'chat', label: 'AI Chat', icon: <Bot size={13} /> },
  ];

  return (
    <div className="ai-panel">
      {/* Header */}
      <div className="ai-panel-header">
        <div className="ai-panel-title">
          <Sparkles size={16} />
          AI Copilot
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--tg-text-muted)' }}>
          Gemini 3.8 Flash
        </div>
      </div>

      {/* Tabs */}
      <div className="ai-panel-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`ai-tab${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              {tab.icon} {tab.label}
            </span>
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="ai-panel-body" style={activeTab === 'chat' ? { padding: '12px 16px', display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 } : {}}>
        {!chat && activeTab !== 'chat' ? (
          <div style={{ textAlign: 'center', padding: '32px 12px', color: 'var(--tg-text-muted)', fontSize: 13 }}>
            <Bot size={36} style={{ margin: '0 auto 10px', opacity: 0.25, display: 'block' }} />
            Chọn một hội thoại để sử dụng AI hỗ trợ
          </div>
        ) : activeTab === 'summary' ? (
          <SummaryTab chatId={chat!.id} />
        ) : activeTab === 'suggest' ? (
          <SuggestTab chatId={chat!.id} onUseReply={onUseReply} />
        ) : (
          <AIChatTab chatId={chat?.id || null} chatTitle={chat?.title} />
        )}
      </div>
    </div>
  );
}
