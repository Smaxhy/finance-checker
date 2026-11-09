import { ImageResponse } from "next/og";

/** The app mark (⌘ glyph on the indigo accent), rendered to PNG at any size. */
export function brandIcon(size: number, { maskable = false }: { maskable?: boolean } = {}) {
  // Maskable icons need their content inside the central 80% "safe zone".
  const glyph = Math.round(size * (maskable ? 0.42 : 0.56));
  const radius = maskable ? 0 : Math.round(size * 0.22);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #8b8ef7 0%, #5b5fd6 100%)",
          borderRadius: radius,
        }}
      >
        <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
