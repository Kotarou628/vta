import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Virtual_TA:受講生用", 
  // ルートのlayout.tsxで設定したテンプレートにより
  // 自動的に「Virtual TA/受講生用」となります
};

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}