import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ebook → Summaries & Flashcards",
  description:
    "Turn an ebook into summaries, Anki flashcards, discussion questions, and a character guide.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-bg text-fg">{children}</body>
    </html>
  );
}
