import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ebook → Summaries & Flashcards",
    short_name: "Ebook Summarizer",
    description:
      "Turn an ebook into summaries, Anki flashcards, discussion questions, and a character guide.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d1821",
    theme_color: "#0d1821",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
