import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Novel Platform",
  description: "Structured AI-assisted novel creation workspace"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
