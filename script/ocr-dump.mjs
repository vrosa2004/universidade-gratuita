/**
 * Raw OCR dump — shows exactly what Tesseract reads from a document.
 * Run this when CPF or Name extraction fails to diagnose the issue.
 *
 * Usage:
 *   npx tsx script/ocr-dump.mjs <image-or-pdf-path>
 *
 * Example:
 *   npx tsx script/ocr-dump.mjs /home/vinicius/Downloads/rg-verso.jpg
 */
import { readFileSync, writeFileSync } from "fs";
import { extname } from "path";
import Tesseract from "tesseract.js";
import sharp from "sharp";
import { execFile } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile as writeFileAsync, readFile, unlink, readdir } from "fs/promises";

const imagePath = process.argv[2];
if (!imagePath) {
  console.error("Uso: npx tsx script/ocr-dump.mjs <caminho-da-imagem-ou-pdf>");
  process.exit(1);
}

const ext = extname(imagePath).toLowerCase();
const mimeMap = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf" };
const mime = mimeMap[ext] ?? "image/jpeg";

let buffer = readFileSync(imagePath);
console.log(`\n[OCR-Dump] Arquivo: ${imagePath} (${mime}, ${Math.round(buffer.length / 1024)} KB)`);

// PDF → PNG conversion
if (mime === "application/pdf") {
  console.log("[OCR-Dump] Convertendo PDF para PNG via pdftoppm...");
  const uid = `pdf_${Date.now()}`;
  const pdfPath = join(tmpdir(), `${uid}.pdf`);
  const outPrefix = join(tmpdir(), uid);
  await writeFileAsync(pdfPath, buffer);
  await new Promise((resolve, reject) => {
    execFile("pdftoppm", ["-png", "-r", "300", "-f", "1", "-l", "1", pdfPath, outPrefix], (err) => {
      if (err) reject(err); else resolve();
    });
  });
  const files = await readdir(tmpdir());
  const outFile = files.find((f) => f.startsWith(uid) && f.endsWith(".png"));
  buffer = await readFile(join(tmpdir(), outFile));
  await Promise.all([unlink(pdfPath).catch(() => {}), unlink(join(tmpdir(), outFile)).catch(() => {})]);
  console.log("[OCR-Dump] PDF convertido\n");
}

// Preprocess: auto-rotate via EXIF, greyscale, normalize
const processed = await sharp(buffer).rotate().greyscale().normalize({ lower: 2, upper: 98 }).toBuffer();
const meta = await sharp(processed).metadata();
console.log(`[OCR-Dump] Imagem processada: ${meta.width}×${meta.height}px\n`);

// Run all PSM modes
const psms = [6, 4, 3, 11];
for (const psm of psms) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`PSM ${psm}`);
  console.log("=".repeat(60));
  const { data } = await Tesseract.recognize(processed, "por", {
    logger: () => {},
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: "1",
  });
  console.log(`Confiança: ${data.confidence.toFixed(1)}%  |  Chars: ${data.text.length}`);
  console.log("\n--- TEXTO OCR ---");
  console.log(data.text);
  console.log("--- FIM ---");
}

// Digits-only pass
console.log(`\n${"=".repeat(60)}`);
console.log("PSM 11 — SOMENTE DÍGITOS (whitelist: 0-9 . - / :)");
console.log("=".repeat(60));
const { data: digData } = await Tesseract.recognize(processed, "por", {
  logger: () => {},
  tessedit_pageseg_mode: 11,
  tessedit_char_whitelist: "0123456789./-: ",
  preserve_interword_spaces: "1",
});
console.log(`Confiança: ${digData.confidence.toFixed(1)}%`);
console.log("\n--- TEXTO DÍGITOS ---");
console.log(digData.text);
console.log("--- FIM ---\n");

console.log("\nCopie o texto acima e envie para diagnóstico.");
