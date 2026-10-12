import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { Message, AISummary, AISuggestion, AIChatMessage } from '../types/index.js';

class AIService {
  private aiClient: GoogleGenAI | null = null;

  constructor() {
    if (config.gemini.apiKey && config.gemini.apiKey.trim() !== '') {
      try {
        this.aiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
        console.log(`[AIService]  Google GenAI initialized with model: ${config.gemini.model}`);
      } catch (err) {
        console.error('[AIService] Failed to initialize Google GenAI SDK:', err);
      }
    } else {
      console.log('[AIService] ℹ  GEMINI_API_KEY is not set. Using intelligent Vietnamese Mock AI Engine.');
    }
  }

  /**
   * Summarize conversation into key points, customer goals, current status, and recommended actions
   */
  async summarizeConversation(chatId: string, chatTitle: string, messages: Message[]): Promise<AISummary> {
    if (messages.length === 0) {
      return {
        id: `sum_${uuidv4().slice(0, 8)}`,
        chatId,
        customerGoal: 'Chưa có đủ tin nhắn để phân tích nhu cầu.',
        mainQuestions: ['Hội thoại mới bắt đầu'],
        currentStatus: 'Đang giải quyết',
        recommendedAction: 'Gửi lời chào mở đầu và hỏi thăm nhu cầu của khách.',
        sentiment: 'Trung tính',
        summaryText: 'Cuộc trò chuyện chưa có tin nhắn trao đổi cụ thể.',
        createdAt: new Date().toISOString(),
      };
    }

    const conversationTranscript = messages
      .map((m) => `${m.isOutgoing ? '[Nhân viên/CSKH]' : `[Khách hàng ${m.senderName || 'Ẩn danh'}]`}: ${m.text}`)
      .join('\n');

    // If Gemini API is available, call Gemini 3.8 Flash
    if (this.aiClient && config.gemini.apiKey) {
      try {
        const prompt = `Bạn là trợ lý AI chuyên nghiệp phân tích hội thoại Telegram cho hệ thống CSKH doanh nghiệp TeleVaga.
Hãy phân tích đoạn hội thoại Telegram sau đây giữa Nhân viên CSKH và Khách hàng (${chatTitle}):

${conversationTranscript}

Hãy trả về DUY NHẤT một chuỗi JSON hợp lệ (không kèm Markdown backticks \`\`\`json) với cấu trúc sau:
{
  "customerGoal": "Mục tiêu hoặc nhu cầu chính mà khách hàng đang tìm kiếm",
  "mainQuestions": ["Vấn đề 1", "Vấn đề 2"],
  "currentStatus": "Đang giải quyết" hoặc "Cần báo giá" hoặc "Chờ khách phản hồi" hoặc "Hoàn thành",
  "recommendedAction": "Hành động tiếp theo nhân viên nên làm ngay",
  "sentiment": "Tích cực" hoặc "Trung tính" hoặc "Căng thẳng / Khiếu nại",
  "summaryText": "Đoạn tóm tắt ngắn gọn 2-3 câu về tiến trình cuộc trao đổi"
}`;

        const response = await this.aiClient.models.generateContent({
          model: config.gemini.model,
          contents: prompt,
        });

        const rawText = response.text || '';
        const cleanedText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanedText);

        return {
          id: `sum_${uuidv4().slice(0, 8)}`,
          chatId,
          customerGoal: parsed.customerGoal || 'Nhu cầu tư vấn dịch vụ',
          mainQuestions: Array.isArray(parsed.mainQuestions) ? parsed.mainQuestions : ['Tìm hiểu dịch vụ'],
          currentStatus: parsed.currentStatus || 'Đang giải quyết',
          recommendedAction: parsed.recommendedAction || 'Tiếp tục theo dõi và phản hồi',
          sentiment: parsed.sentiment || 'Trung tính',
          summaryText: parsed.summaryText || 'Đã phân tích hội thoại thành công.',
          createdAt: new Date().toISOString(),
        };
      } catch (err) {
        console.warn('[AIService] Gemini API error, falling back to smart local analyzer:', err);
      }
    }

    // Intelligent Fallback Analysis Engine
    return this.generateSmartMockSummary(chatId, chatTitle, messages);
  }

  /**
   * Suggest 2-3 tailored replies for customer service agents
   */
  async suggestReplies(chatId: string, chatTitle: string, messages: Message[]): Promise<AISuggestion[]> {
    if (messages.length === 0) {
      return [
        {
          tone: 'professional',
          label: 'Chào hỏi chuẩn',
          replyText: `Chào bạn, mình là chuyên viên tư vấn TeleVaga. Mình có thể hỗ trợ gì cho bạn hôm nay ạ?`,
          reason: 'Lời chào chuyên nghiệp mở đầu phiên hỗ trợ',
        },
      ];
    }

    const conversationTranscript = messages
      .slice(-6)
      .map((m) => `${m.isOutgoing ? '[CSKH]' : `[Khách hàng]`}: ${m.text}`)
      .join('\n');

    const lastCustomerMsg = [...messages].reverse().find((m) => !m.isOutgoing)?.text || '';

    // If Gemini API is available
    if (this.aiClient && config.gemini.apiKey) {
      try {
        const prompt = `Bạn là trợ lý AI thông minh cho nhân viên chăm sóc khách hàng Telegram TeleVaga.
Dựa trên ngữ cảnh hội thoại gần đây:
${conversationTranscript}

Tin nhắn gần nhất của khách hàng: "${lastCustomerMsg}"

Hãy tạo 3 gợi ý câu trả lời sẵn bằng tiếng Việt với các phong cách khác nhau:
1. "professional" (Lịch sự, chi tiết, chuyên nghiệp)
2. "quick" (Ngắn gọn, trực tiếp vào vấn đề)
3. "consultative" (Chuyên sâu, tư vấn giải pháp hoặc báo giá)

Trả về DUY NHẤT một mảng JSON (không kèm markdown \`\`\`json):
[
  {
    "tone": "professional",
    "label": "Lịch sự & Chi tiết",
    "replyText": "Nội dung phản hồi...",
    "reason": "Lý do gợi ý câu này"
  },
  {
    "tone": "quick",
    "label": "Nhanh gọn",
    "replyText": "Nội dung phản hồi...",
    "reason": "Lý do gợi ý câu này"
  },
  {
    "tone": "consultative",
    "label": "Tư vấn chuyên sâu",
    "replyText": "Nội dung phản hồi...",
    "reason": "Lý do gợi ý câu này"
  }
]`;

        const response = await this.aiClient.models.generateContent({
          model: config.gemini.model,
          contents: prompt,
        });

        const rawText = response.text || '';
        const cleanedText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanedText);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (err) {
        console.warn('[AIService] Gemini API reply suggestion failed, using smart local engine:', err);
      }
    }

    return this.generateSmartMockSuggestions(lastCustomerMsg, chatTitle);
  }

  /**
   * Dedicated AI Chat Copilot assistant
   */
  async chatWithAssistant(userQuery: string, currentChatContext?: { title: string; messages: Message[] }): Promise<string> {
    let contextStr = '';
    if (currentChatContext && currentChatContext.messages.length > 0) {
      const recent = currentChatContext.messages.slice(-8).map((m) => `${m.isOutgoing ? 'CSKH' : 'Khách'}: ${m.text}`).join('\n');
      contextStr = `\n\n[Ngữ cảnh hội thoại đang chọn với khách "${currentChatContext.title}"]:\n${recent}`;
    }

    if (this.aiClient && config.gemini.apiKey) {
      try {
        const prompt = `Bạn là TeleVaga AI Assistant - trợ lý thông minh đồng hành cùng chuyên viên quản lý hội thoại Telegram.
Bạn am hiểu sâu sắc về: chăm sóc khách hàng đa kênh, Telegram Bot API, hạ tầng kỹ thuật, soạn thảo báo giá và giải quyết khiếu nại.
Trả lời bằng tiếng Việt lịch sự, thông minh, súc tích và có định dạng Markdown đẹp.${contextStr}

Câu hỏi của nhân viên: "${userQuery}"`;

        const response = await this.aiClient.models.generateContent({
          model: config.gemini.model,
          contents: prompt,
        });

        return response.text || 'Xin lỗi, tôi chưa thể trả lời yêu cầu này vào lúc này.';
      } catch (err: any) {
        console.warn('[AIService] Gemini AI Chat error:', err.message);
      }
    }

    // Fallback response generator
    return this.generateMockAssistantResponse(userQuery, currentChatContext?.title);
  }

  // --- SMART LOCAL ENGINES (Rich Vietnamese AI Logic) ---

  private generateSmartMockSummary(chatId: string, chatTitle: string, messages: Message[]): AISummary {
    const textAll = messages.map((m) => m.text).join(' ').toLowerCase();

    let customerGoal = `Trao đổi và tìm hiểu giải pháp cùng hệ thống TeleVaga.`;
    let mainQuestions = ['Quy trình triển khai dịch vụ', 'Hỗ trợ kỹ thuật'];
    let currentStatus: 'Đang giải quyết' | 'Cần báo giá' | 'Chờ khách phản hồi' | 'Hoàn thành' = 'Đang giải quyết';
    let recommendedAction = 'Gửi tin nhắn phản hồi làm rõ các thông số kỹ thuật và nhu cầu thực tế.';
    let sentiment: 'Tích cực' | 'Trung tính' | 'Căng thẳng / Khiếu nại' = 'Trung tính';

    if (textAll.includes('báo giá') || textAll.includes('chi phí') || textAll.includes('gói') || textAll.includes('hợp đồng')) {
      customerGoal = 'Khách hàng có nhu cầu nhận báo giá và ký kết hợp đồng triển khai gói dịch vụ.';
      mainQuestions = ['Chính sách giá & chiết khấu', 'Cam kết chất lượng SLA', 'Thời hạn thanh toán'];
      currentStatus = 'Cần báo giá';
      recommendedAction = 'Soạn bảng báo giá chi tiết và gửi file PDF qua Telegram hoặc email cho khách.';
      sentiment = 'Tích cực';
    } else if (textAll.includes('nghẽn') || textAll.includes('lỗi') || textAll.includes('chậm') || textAll.includes('bảo trì')) {
      customerGoal = 'Khách phản ánh về vấn đề độ trễ đường truyền và kiểm tra trạng thái cụm máy chủ.';
      mainQuestions = ['Hiện tượng trễ tin nhắn giờ cao điểm', 'Kế hoạch nâng cấp và bảo trì hệ thống'];
      currentStatus = 'Đang giải quyết';
      recommendedAction = 'Thông báo phương án tối ưu Socket.IO / cụm máy chủ và cam kết thời gian khắc phục dứt điểm.';
      sentiment = 'Căng thẳng / Khiếu nại';
    } else if (textAll.includes('webhook') || textAll.includes('api') || textAll.includes('bot') || textAll.includes('devops')) {
      customerGoal = 'Tìm hiểu kiến trúc kỹ thuật kết nối Telegram Bot API và cơ chế Webhook/WebSocket.';
      mainQuestions = ['Xác thực bảo mật Webhook SSL', 'Cấu hình realtime WebSocket', 'Giới hạn Rate Limit Telegram'];
      currentStatus = 'Đang giải quyết';
      recommendedAction = 'Gửi tài liệu API Swagger và mẫu code tích hợp Node.js/Python.';
      sentiment = 'Tích cực';
    } else if (textAll.includes('khen') || textAll.includes('cảm ơn') || textAll.includes('tuyệt vời') || textAll.includes('hài lòng')) {
      customerGoal = 'Khách hàng hài lòng với trải nghiệm dịch vụ và đánh giá cao tính năng AI.';
      mainQuestions = ['Phản hồi tích cực về tính năng AI Smart Reply', 'Kế hoạch mở rộng hợp tác'];
      currentStatus = 'Hoàn thành';
      recommendedAction = 'Gửi lời cảm ơn chân thành và đề xuất xin đánh giá / giới thiệu thêm khách hàng mới.';
      sentiment = 'Tích cực';
    }

    const summaryText = `Cuộc hội thoại với ${chatTitle} tập trung vào: ${customerGoal} Hiện tại khách hàng đang trao đổi tích cực với ${messages.length} lượt tin nhắn được ghi nhận.`;

    return {
      id: `sum_${uuidv4().slice(0, 8)}`,
      chatId,
      customerGoal,
      mainQuestions,
      currentStatus,
      recommendedAction,
      sentiment,
      summaryText,
      createdAt: new Date().toISOString(),
    };
  }

  private generateSmartMockSuggestions(lastMsg: string, chatTitle: string): AISuggestion[] {
    const q = lastMsg.toLowerCase();

    if (q.includes('báo giá') || q.includes('gói') || q.includes('sla')) {
      return [
        {
          tone: 'professional',
          label: 'Báo giá Enterprise',
          replyText: `Dạ em đã chuẩn bị xong bảng báo giá gói Enterprise SLA 99.9% kèm tích hợp AI. Em xin phép gửi file chi tiết qua đây cho anh ${chatTitle} tham khảo nhé ạ!`,
          reason: 'Phản hồi trực tiếp vào yêu cầu báo giá của khách',
        },
        {
          tone: 'consultative',
          label: 'Đề xuất buổi demo',
          replyText: `Dạ bên em có chính sách dùng thử gói Enterprise 14 ngày không giới hạn. Em có thể thiết lập buổi demo kỹ thuật ngắn 15 phút với team của anh được không ạ?`,
          reason: 'Kích thích chốt đơn qua buổi demo kỹ thuật',
        },
        {
          tone: 'quick',
          label: 'Gửi bảng tóm tắt',
          replyText: `Gói Enterprise giá 4.500.000đ/tháng hỗ trợ không giới hạn số lượng tin nhắn và đầy đủ AI Copilot ạ.`,
          reason: 'Trả lời nhanh số tiền để khách nắm ngay',
        },
      ];
    }

    if (q.includes('webhook') || q.includes('ngrok') || q.includes('api') || q.includes('ssl')) {
      return [
        {
          tone: 'professional',
          label: 'Giải thích kỹ thuật',
          replyText: `Hệ thống hỗ trợ cả Webhook qua HTTPS tiêu chuẩn lẫn WebSocket (Socket.IO) hai chiều. Khi kết nối bot thật, bạn chỉ cần nhập Bot Token vào cài đặt là hệ thống tự động kích hoạt ạ.`,
          reason: 'Giải đáp chuẩn xác câu hỏi kỹ thuật về webhook/bot',
        },
        {
          tone: 'consultative',
          label: 'Gửi tài liệu API',
          replyText: `Em xin phép gửi bạn tài liệu hướng dẫn cấu hình Webhook và mã nguồn mẫu tích hợp tại kho GitHub TeleVaga để bên mình test thử trước nhé ạ.`,
          reason: 'Hỗ trợ lập trình viên tài liệu cụ thể',
        },
        {
          tone: 'quick',
          label: 'Hỗ trợ test ngay',
          replyText: `Bên mình có thể test trực tiếp tính năng realtime ngay trên giao diện này nhé, độ trễ chỉ dưới 50ms ạ!`,
          reason: 'Khẳng định hiệu năng realtime',
        },
      ];
    }

    if (q.includes('chậm') || q.includes('nghẽn') || q.includes('lỗi')) {
      return [
        {
          tone: 'professional',
          label: 'Cam kết hỗ trợ',
          replyText: `Dạ em xin lỗi vì trải nghiệm chưa trọn vẹn này. Đội ngũ kỹ thuật bên em đang kiểm tra log lưu lượng và sẽ tối ưu ngay bộ đệm tin nhắn để đảm bảo thông suốt ạ.`,
          reason: 'Xoa dịu khiếu nại và cam kết xử lý sự cố',
        },
        {
          tone: 'consultative',
          label: 'Phương án kỹ thuật',
          replyText: `Để giảm tải giờ cao điểm, bên em đề xuất kích hoạt cơ chế Redis Queue kết hợp WebSocket phân tải, giúp xử lý hơn 10.000 msg/giây mượt mà ạ.`,
          reason: 'Đưa ra giải pháp công nghệ thuyết phục',
        },
        {
          tone: 'quick',
          label: 'Cập nhật tiến độ',
          replyText: `Em đã chuyển thông tin cho đội trực hạ tầng, dự kiến hoàn tất kiểm tra trong 10 phút nữa ạ.`,
          reason: 'Thông báo mốc thời gian rõ ràng',
        },
      ];
    }

    return [
      {
        tone: 'professional',
        label: 'Phản hồi chuyên nghiệp',
        replyText: `Dạ vâng, TeleVaga đã ghi nhận thông tin từ anh/chị. Em xin phép hỗ trợ xử lý ngay bây giờ ạ!`,
        reason: 'Phản hồi chuẩn mực tiếp nhận thông tin',
      },
      {
        tone: 'consultative',
        label: 'Tư vấn bổ sung',
        replyText: `Anh/chị có cần bên em phân tích thêm dữ liệu báo cáo hội thoại bằng AI để tối ưu hiệu suất làm việc không ạ?`,
        reason: 'Mở rộng cơ hội giới thiệu tính năng AI cao cấp',
      },
      {
        tone: 'quick',
        label: 'Xác nhận ngắn',
        replyText: `Dạ em hiểu rồi ạ, em đang tiến hành kiểm tra và báo lại ngay nhé!`,
        reason: 'Xác nhận nhanh chóng, thân thiện',
      },
    ];
  }

  private generateMockAssistantResponse(query: string, chatTitle?: string): string {
    const q = query.toLowerCase();

    if (q.includes('báo giá') || q.includes('giá') || q.includes('chi phí')) {
      return `### 📊 Bảng Báo Giá Đề Xuất Cho Khách Hàng ${chatTitle ? `(${chatTitle})` : ''}

Dựa trên nhu cầu hiện tại, đây là các gói cước TeleVaga phù hợp nhất:

1. **Gói Starter (Doanh nghiệp nhỏ / Shop)**:
   - **Giá**: 990.000 VNĐ / tháng
   - Quản lý tối đa 5 tài khoản CSKH Telegram
   - 10.000 tin nhắn / tháng, lưu trữ 3 tháng
   - AI Gợi ý câu trả lời cơ bản

2. **Gói Professional (Khuyên dùng)**:
   - **Giá**: 2.490.000 VNĐ / tháng
   - Quản lý 20 tài khoản CSKH đồng thời
   - Không giới hạn tin nhắn, WebSocket độ trễ thấp
   - **AI Tóm tắt hội thoại + Smart Reply** thời gian thực

3. **Gói Enterprise (Tùy biến cao)**:
   - **Giá**: 4.900.000 VNĐ / tháng
   - Không giới hạn nhân sự, Cụm máy chủ Dedicated
   - Cam kết SLA 99.99%, hỗ trợ tích hợp Webhook/API riêng 24/7

*💡 Mẹo CSKH: Đề xuất khách dùng thử 14 ngày gói Professional để trải nghiệm trước khi ký hợp đồng.*`;
    }

    if (q.includes('tóm tắt') || q.includes('vấn đề') || q.includes('tình trạng')) {
      return `### 📋 Phân Tích Hiện Trạng Hội Thoại ${chatTitle ? `của ${chatTitle}` : ''}

- **Điểm nóng**: Khách hàng đang quan tâm nhiều đến tốc độ phản hồi tin nhắn trong giờ cao điểm và khả năng tự động hóa bằng AI.
- **Tâm lý khách**: Tích cực, có thiện chí hợp tác cao, muốn nhìn thấy kết quả đo lường cụ thể.
- **Khuyến nghị cho nhân sự**:
  1. Trả lời ngay lập tức (dưới 1 phút) để giữ nhiệt độ tương tác.
  2. Sử dụng tính năng **Gợi ý trả lời (Smart Reply)** ở panel bên phải để chọn mẫu câu lịch sự.
  3. Cập nhật thẻ trạng thái hội thoại sang **"Cần báo giá"** hoặc **"Đang xử lý"**.`;
    }

    return `### 🤖 Trợ Lý TeleVaga AI

Chào bạn! Tôi đã phân tích câu hỏi: **"${query}"** ${chatTitle ? `trong bối cảnh hội thoại với **${chatTitle}**` : ''}.

**Gợi ý xử lý tối ưu:**
1. **Tiếp nhận & Lắng nghe**: Xác nhận rõ nhu cầu cụ thể của khách hàng trước khi đưa ra phương án kỹ thuật.
2. **Khai thác giá trị AI**: Tận dụng nút **Tóm tắt hội thoại** để nắm bắt toàn bộ tiến trình trao đổi chỉ trong 3 giây.
3. **Kêu gọi hành động (CTA)**: Đưa ra thời hạn hoặc bước tiếp theo rõ ràng (ví dụ: "Em sẽ gửi file trong 15 phút tới").

Bạn cần tôi soạn thảo văn bản gửi khách hay phân tích số liệu nào khác không?`;
  }
}

export const aiService = new AIService();
