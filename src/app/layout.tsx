// C:\Users\Admin\vta\src\app\layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // ブラウザのタブ名
  title: "Virtual_TA",
  description: "AIによる学習支援システム",
  
  // URLプレビュー用の設定（ここが重要です）
  openGraph: {
    title: "Virtual_TA",
    description: "AIによる学習支援システム",
    url: "https://vta-seven.vercel.app",
    siteName: "Virtual_TA",
    locale: "ja_JP",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja"> {/* 言語を日本語に設定 */}
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}