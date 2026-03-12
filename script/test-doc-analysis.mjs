/**
 * Test script for the document analysis pipeline.
 * Usage: node script/test-doc-analysis.mjs <image-path> [declared-name]
 *
 * Example:
 *   node script/test-doc-analysis.mjs /tmp/cnh.jpg "VINICIUS RODRIGUES DA ROSA"
 */
import { readFileSync } from "fs";
import { extname } from "path";

const imagePath = process.argv[2];
const declaredName = process.argv[3] ?? undefined;

if (!imagePath) {
  console.error("Uso: node script/test-doc-analysis.mjs <caminho-da-imagem> [nome-declarado]");
  process.exit(1);
}

const ext = extname(imagePath).toLowerCase();
const mimeMap = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};
const mime = mimeMap[ext] ?? "image/jpeg";

console.log(`\n[Test] Carregando imagem: ${imagePath} (${mime})`);
const raw = readFileSync(imagePath);
const dataUrl = `data:${mime};base64,${raw.toString("base64")}`;
console.log(`[Test] Tamanho base64: ${(dataUrl.length / 1024).toFixed(1)} KB\n`);

const { analyzeDocument } = await import("../server/services/document-analysis.service.js");

console.log("[Test] Iniciando análise...\n");
const t0 = Date.now();
try {
  const result = await analyzeDocument(dataUrl, declaredName);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[Test] Concluído em ${elapsed}s\n`);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`\n[Test] ERRO após ${elapsed}s:`);
  console.error(err);
}
