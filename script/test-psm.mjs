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

for (const psm of [6, 4, 11]) {
  const { data } = await Tesseract.recognize(buf, "por", {
    logger: () => {},
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: "1",
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log(`PSM-${psm}  conf=${data.confidence.toFixed(1)}%  len=${data.text.length}`);
  console.log("=".repeat(60));

  const INTERESTING = /\d{4,}|[0-9]{2}[\/\-][0-9]{2}|CPF|EMISS|NASC|DATA|NOME|RODRIGUES|VINICIUS|[A-Z]{3,}<</i;
  data.text.split("\n").forEach((l, i) => {
    const t = l.trim();
    if (t && INTERESTING.test(t)) console.log(`${String(i).padStart(3)}: ${JSON.stringify(t)}`);
  });
}
