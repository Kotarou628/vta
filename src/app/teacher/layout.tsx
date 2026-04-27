import { Metadata } from "next";

export const metadata: Metadata = {
  title: "教員・TA用",
  // 自動的に「Virtual TA/教員・TA用」となります
};

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}