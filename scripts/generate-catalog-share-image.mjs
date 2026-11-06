import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Regenerate the committed image with node scripts/generate-catalog-share-image.mjs.
const markSource = await readFile(new URL("../public/brand/mark.svg", import.meta.url));
const mark = await sharp(markSource, { density: 360 })
  .resize(240, 240)
  .png()
  .toBuffer();

const backdrop = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#edf2df"/>
  <circle cx="600" cy="315" r="188" fill="none" stroke="#d2debb" stroke-width="2"/>
  <circle cx="600" cy="315" r="244" fill="none" stroke="#d2debb" stroke-width="2"/>
  <circle cx="600" cy="315" r="307" fill="none" stroke="#d2debb" stroke-width="2"/>
  <circle cx="356" cy="315" r="13" fill="#173e32"/>
  <circle cx="844" cy="315" r="13" fill="#173e32"/>
</svg>`);

await sharp(backdrop)
  .composite([{ input: mark, gravity: "centre" }])
  .png({ compressionLevel: 9 })
  .toFile(fileURLToPath(new URL("../public/assets/catalog-share.png", import.meta.url)));
