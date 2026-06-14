import type { Metadata, Viewport } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const TITLE = "Ebook → Summaries & Flashcards";
const DESCRIPTION =
  "Turn an ebook into summaries, Anki flashcards, discussion questions, and a character guide — using the LLM provider of your choice.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Ebook Summarizer",
  keywords: [
    "ebook",
    "summary",
    "flashcards",
    "Anki",
    "study guide",
    "epub",
    "pdf",
    "LLM",
    "Claude",
  ],
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "Ebook Summarizer",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1821" },
  ],
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
