import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import AdminGate from '@/components/AdminGate';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Hệ Thống TeleVaga',
  description:
    'Hệ thống quản lý hội thoại Telegram thông minh với AI tóm tắt, gợi ý câu trả lời và trợ lý AI tích hợp trực tiếp vào giao diện.',
  keywords: ['telegram', 'quản lý chat', 'AI CSKH', 'TeleVaga', 'Gemini AI'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" className="dark">
      <body className={`${inter.variable} font-sans antialiased`}>
        <AdminGate>{children}</AdminGate>
      </body>
    </html>
  );
}
