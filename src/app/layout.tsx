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
  // titleをオブジェクト形式にすることで、各ページで名前を補完できるようになります
  title: {
    template: "%s | Virtual TA", // 各ページで設定したタイトルが %s に入ります
    default: "Virtual TA",       // 個別に設定がない場合のデフォルト名
  },
  description: "AIアシスタントによる学習支援システム",
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