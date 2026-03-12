/**
 * Dumps the full raw Tesseract OCR text for an image file.
 * Usage: npx tsx script/dump-ocr.mjs <image-path>
 */
import { readFileSync } from "fs";
import sharp from "sharp";
import Tesseract from "tesseract.js";

const imagePath = process.argv[2];
if (!imagePath) { console.error("Uso: npx tsx script/dump-ocr.mjs <imagem>"); process.exit(1); }

const raw = readFileSync(imagePath);
const meta = await sharp(raw).metadata();
console.log(`Dimensões: ${meta.width} × ${meta.height} (${meta.format})\n`);

const processed = await sharp(raw)
  .rotate()
  .greyscale()
  .clahe({ width: 8, height: 8, maxSlope: 4 })
  .sharpen({ sigma: 1.0, m1: 1.0, m2: 5 })
  .png()
  .toBuffer();

const { data } = await Tesseract.recognize(processed, "por", {
  logger: () => {},
  tessedit_pageseg_mode: 6,
  preserve_interword_spaces: "1",
});

console.log(`Confiança: ${data.confidence.toFixed(1)}%  |  Chars: ${data.text.length}\n`);
console.log("═══════════════════ TEXTO COMPLETO ═══════════════════");
console.log(data.text);
console.log("═══════════════════════════════════════════════════════");
