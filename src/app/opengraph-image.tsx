import { ImageResponse } from "next/og";

export const alt = "Ebook → Summaries & Flashcards";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #0d1821 0%, #1b2c3b 100%)",
          color: "#ffffff",
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <div
            style={{
              width: "72px",
              height: "72px",
              borderRadius: "18px",
              background: "linear-gradient(135deg, #ff715b 0%, #7b5e7b 100%)",
            }}
          />
          <div style={{ fontSize: "30px", color: "#89aae6", letterSpacing: "1px" }}>
            STUDY-AID GENERATOR
          </div>
        </div>
        <div
          style={{
            marginTop: "40px",
            display: "flex",
            flexDirection: "column",
            fontSize: "76px",
            fontWeight: 700,
            lineHeight: 1.1,
          }}
        >
          <div>Ebook → Summaries</div>
          <div>&amp; Flashcards</div>
        </div>
        <div style={{ marginTop: "32px", fontSize: "34px", color: "#dceab2", maxWidth: "900px" }}>
          Turn any ebook into summaries, Anki flashcards, discussion questions, and a
          character guide.
        </div>
      </div>
    ),
    { ...size }
  );
}
