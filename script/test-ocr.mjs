/**
 * Teste OCR — rode com:
 *   node script/test-ocr.mjs /caminho/para/arquivo.png [householdSize]
 *
 * O script faz login como 'admin/123', chama /api/debug/ocr e imprime o resultado.
 */

import { readFileSync } from "fs";
import { extname } from "path";

const FILE_PATH  = process.argv[2];
const HOUSEHOLD  = parseInt(process.argv[3] ?? "1") || 1;
const BASE_URL   = "http://localhost:5000";

if (!FILE_PATH) {
  console.error("Uso: node script/test-ocr.mjs <arquivo> [nPessoas]");
  process.exit(1);
}

// ── 1. Detecta MIME ────────────────────────────────────────────────────────
const EXT_MIME = {
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf":  "application/pdf",
};
const mime = EXT_MIME[extname(FILE_PATH).toLowerCase()];
if (!mime) {
  console.error("Extensão não suportada. Use .png, .jpg ou .pdf");
  process.exit(1);
}

// ── 2. Converte para data-URL ──────────────────────────────────────────────
const b64 = readFileSync(FILE_PATH).toString("base64");
const dataUrl = `${mime};base64,${b64}`;   // sem "data:" prefix – adicionamos abaixo
const fullDataUrl = `data:${dataUrl}`;

console.log(`Arquivo: ${FILE_PATH} (${(b64.length / 1024).toFixed(1)} KB base64, MIME: ${mime})`);

// ── 3. Login ───────────────────────────────────────────────────────────────
const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "123" }),
});

if (!loginRes.ok) {
  console.error("Falha no login:", await loginRes.text());
  process.exit(1);
}

const cookie = loginRes.headers.get("set-cookie");
if (!cookie) {
  console.error("Nenhum cookie de sessão retornado.");
  process.exit(1);
}
const sid = cookie.split(";")[0]; // connect.sid=...
console.log("Login OK. Cookie:", sid.slice(0, 40) + "...");

// ── 4. Chama /api/debug/ocr ───────────────────────────────────────────────
console.log("\nEnviando para OCR...");
const ocrRes = await fetch(`${BASE_URL}/api/debug/ocr`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: sid },
  body: JSON.stringify({ base64: fullDataUrl, householdSize: HOUSEHOLD }),
});

const result = await ocrRes.json();

// ── 5. Impressão formatada ────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════");
console.log("OCR STATUS  :", ocrRes.status, ocrRes.ok ? "✅" : "❌");
if (!ocrRes.ok) {
  console.log("ERRO:", result);
  process.exit(1);
}

console.log("MIME        :", result.mimeType);
console.log("CONFIANÇA   :", result.confidence + "%");
console.log("CHARS       :", result.textLength);
console.log("─── TEXTO BRUTO (primeiros 800) ───────────");
console.log(result.rawText?.slice(0, 800));
console.log("─── CANDIDATOS (com prioridade) ───────────");
if (result.candidatos?.length) {
  for (const c of result.candidatos) {
    const icon = c.priority === 1 ? "🟢" : c.priority === 2 ? "🔵" : "⚪";
    console.log(`  ${icon} P${c.priority} ${c.value.padStart(14)} | ${c.label}`);
  }
} else {
  console.log("  (nenhum candidato retornado)");
}
console.log("─── RESULTADO ─────────────────────────────");
const r = result.resultado;
if (r) {
  const status = { APROVADO: "✅ APROVADO", REPROVADO: "❌ REPROVADO", REVISAO_MANUAL: "⚠️  REVISÃO MANUAL" }[r.status] ?? r.status;
  console.log(`  Status      : ${status}`);
  console.log(`  Renda total : R$ ${Number(r.rendaTotal).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(`  Per capita  : R$ ${Number(r.rendaPerCapita).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(`  Limite      : R$ ${Number(r.limitePermitido).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  if (r.valorSelecionado) {
    const pLabel = { 1: "líquido", 2: "bruto", 3: "genérico" }[r.valorSelecionado.priority] ?? "?";
    console.log(`  Base usada  : [${pLabel}] "${r.valorSelecionado.label}"`);
  }
  if (r.motivo) console.log(`  Motivo      : ${r.motivo}`);
} else {
  console.log(JSON.stringify(result, null, 2));
}
console.log("═══════════════════════════════════════════");
