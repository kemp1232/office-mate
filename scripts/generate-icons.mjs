// Renders PWA / touch icons from the First Mate mark. Run: node scripts/generate-icons.mjs
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const mark = readFileSync(new URL("../public/brand/mark.svg", import.meta.url), "utf8");
const dataUri = `data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`;

// [file, size, mark scale relative to canvas]. Maskable icons keep the mark inside the 80% safe zone.
const icons = [
  ["public/icons/icon-192.png", 192, 0.72],
  ["public/icons/icon-512.png", 512, 0.72],
  ["public/icons/icon-maskable-512.png", 512, 0.56],
  ["src/app/apple-icon.png", 180, 0.66],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, scale] of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:#fff;display:grid;place-items:center;width:${size}px;height:${size}px">
       <img src="${dataUri}" style="width:${size * scale}px;height:${size * scale}px" />
     </body>`,
  );
  await page.screenshot({ path: file, omitBackground: false });
  console.log("wrote", file);
}
await browser.close();
