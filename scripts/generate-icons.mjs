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

// Browser-tab favicon.ico (16/32/48 px PNGs, transparent background) for browsers without SVG
// favicon support. Modern browsers use src/app/icon.svg (a copy of public/brand/mark.svg).
{
  const { writeFileSync } = await import("node:fs");
  const sizes = [16, 32, 48];
  const pngs = [];
  const tab = await (await chromium.launch()).newPage();
  for (const size of sizes) {
    await tab.setViewportSize({ width: size, height: size });
    await tab.setContent(
      `<body style="margin:0;background:transparent"><img src="${dataUri}" style="width:${size}px;height:${size}px;display:block" /></body>`,
    );
    pngs.push(await tab.screenshot({ omitBackground: true }));
  }
  await tab.context().browser().close();
  // ICO container: header, one directory entry per image, then the PNG data.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map((png, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(sizes[i] % 256, 0);
    e.writeUInt8(sizes[i] % 256, 1);
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  writeFileSync("src/app/favicon.ico", Buffer.concat([header, ...entries, ...pngs]));
  console.log("wrote src/app/favicon.ico");
}
