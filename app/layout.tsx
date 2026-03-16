import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AVEP — Agent Value Exchange Protocol",
  description: "AI Agent collaboration and task marketplace platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
