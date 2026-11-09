// Renders the app icon to PNG files in public/icons (used by the GitHub Pages edition,
// which can't generate icons on request). Run: node scripts/generate-icons.mjs
import { writeFile } from "node:fs/promises";
import { createElement as h } from "react";
import { ImageResponse } from "next/og.js";

function icon(size, maskable = false) {
  const glyph = Math.round(size * (maskable ? 0.42 : 0.56));
  return new ImageResponse(
    h(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #8b8ef7 0%, #5b5fd6 100%)",
          borderRadius: maskable ? 0 : Math.round(size * 0.22),
        },
      },
      h(
        "svg",
        { width: glyph, height: glyph, viewBox: "0 0 24 24", fill: "none", stroke: "white", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" },
        h("path", { d: "M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" }),
      ),
    ),
    { width: size, height: size },
  );
}

const files = [
  ["favicon-32.png", 32, false],
  ["apple-touch-icon.png", 180, true],
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["maskable-512.png", 512, true],
];
for (const [name, size, maskable] of files) {
  const buf = Buffer.from(await icon(size, maskable).arrayBuffer());
  await writeFile(new URL(`../public/icons/${name}`, import.meta.url), buf);
  console.log(name, buf.length, "bytes");
}
