/**
 * Shows word-level high-confidence tokens from the pipeline OCR.
 */
import { readFileSync } from "fs";
import sharp from "sharp";
import Tesseract from "tesseract.js";

const imagePath = process.argv[2] ?? "/home/vinicius/Downloads/CNH-e.pdf.jpg";
const raw = readFileSync(imagePath);

const buf = await sharp(raw)
  .rotate()
  .greyscale()
  .clahe({ width: 8, height: 8, maxSlope: 4 })
  .sharpen({ sigma: 1.0, m1: 1.0, m2: 5 })
  .png()
  .toBuffer();

const { data } = await Tesseract.recognize(buf, "por", {
  logger: () => {},
  tessedit_pageseg_mode: 6,
  preserve_interword_spaces: "1",
});

console.log(`conf=${data.confidence.toFixed(1)}%`);
console.log("hocr type:", typeof data.hocr, data.hocr?.constructor?.name);
console.log("blocks type:", typeof data.blocks, data.blocks?.constructor?.name);
if (data.blocks && typeof data.blocks === 'object') {
  console.log("blocks keys:", Object.keys(data.blocks));
}
if (data.hocr && typeof data.hocr === 'object') {
  console.log("hocr keys:", Object.keys(data.hocr));
  // Get the actual HOCR string
  const hocrStr = data.hocr.get?.() ?? data.hocr.data ?? data.hocr.text ?? data.hocr.toString?.();
  console.log("hocr str length:", typeof hocrStr === 'string' ? hocrStr.length : 'not a string');
  console.log("hocr str first 300:", typeof hocrStr === 'string' ? JSON.stringify(hocrStr.slice(0,300)) : JSON.stringify(hocrStr));
}

