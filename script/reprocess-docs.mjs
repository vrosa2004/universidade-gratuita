/**
 * Re-runs OCR on income_proof documents that have null or REVISAO_MANUAL ocr_data.
 * Usage:
 *   node script/reprocess-docs.mjs          # all unprocessed/manual docs
 *   node script/reprocess-docs.mjs 18 20    # specific doc IDs
 */
import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import "dotenv/config";

const require = createRequire(import.meta.url);
const pg = require("pg");
const { Pool } = pg;

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// ── Dynamically import compiled TS services via tsx ───────────────────────────
// We call the server's /api/debug/ocr endpoint instead of importing TS directly,
// since tsx compilation from script is tricky. Use HTTP if server is up.

const BASE = "http://localhost:5000";

async function loginAsAdmin() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "123" }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const sid = setCookie.split(";")[0]; // "connect.sid=..."
  if (!sid) throw new Error("No session cookie");
  return sid;
}

async function ocrViaApi(base64url, cookie) {
  const res = await fetch(`${BASE}/api/debug/ocr`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ base64: base64url, householdSize: 1 }),
  });
  if (!res.ok) throw new Error(`OCR API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Determine which doc IDs to process
  const specifiedIds = process.argv.slice(2).map(Number).filter(Boolean);

  let rows;
  if (specifiedIds.length > 0) {
    const { rows: r } = await pool.query(
      `SELECT id, enrollment_id, url, ocr_data FROM documents WHERE id = ANY($1) AND type='income_proof' ORDER BY id`,
      [specifiedIds]
    );
    rows = r;
  } else {
    const { rows: r } = await pool.query(
      `SELECT id, enrollment_id, url, ocr_data FROM documents
       WHERE type='income_proof'
         AND (ocr_data IS NULL OR ocr_data->>'status' = 'REVISAO_MANUAL')
       ORDER BY id`
    );
    rows = r;
  }

  if (rows.length === 0) {
    console.log("Nenhum documento para reprocessar.");
    await pool.end();
    return;
  }

  console.log(`Reprocessando ${rows.length} documento(s)...\n`);

  const cookie = await loginAsAdmin();

  for (const doc of rows) {
    if (!doc.url || doc.url === "mock" || !doc.url.startsWith("data:")) {
      console.log(`Doc ${doc.id}: URL inválida ou mock — pulando`);
      continue;
    }

    console.log(`\n── Doc ${doc.id} (matrícua ${doc.enrollment_id}) ──`);
    const mimeMatch = doc.url.match(/^data:([^;]+);base64,/);
    console.log(`   MIME: ${mimeMatch?.[1] ?? "desconhecido"}, tamanho URL: ${Math.round(doc.url.length / 1024)}KB`);

    try {
      const result = await ocrViaApi(doc.url, cookie);
      console.log(`   Confiança: ${result.confidence}%  Chars: ${result.textLength}`);
      console.log(`   Status: ${result.resultado.status}  Renda: R$ ${result.resultado.rendaTotal.toFixed(2)}`);
      if (result.resultado.motivo) console.log(`   Motivo: ${result.resultado.motivo}`);

      // Build ocr_data JSON matching what routes.ts stores
      const ocrData = {
        status: result.resultado.status,
        rendaTotal: result.resultado.rendaTotal,
        rendaPerCapita: result.resultado.rendaPerCapita,
        limitePermitido: result.resultado.limitePermitido,
        observacao: result.resultado.observacao,
        motivo: result.resultado.motivo,
        ocrConfidence: result.confidence,
        textLength: result.textLength,
        valoresEncontrados: result.resultado.valoresEncontrados,
        valorSelecionado: result.resultado.valorSelecionado,
      };

      await pool.query(
        `UPDATE documents SET ocr_data = $1 WHERE id = $2`,
        [JSON.stringify(ocrData), doc.id]
      );
      console.log(`   ✅ DB atualizado`);
    } catch (err) {
      console.error(`   ❌ Erro: ${err.message}`);
    }
  }

  // Recalculate family income for all affected enrollments
  const enrollmentIds = [...new Set(rows.map((r) => r.enrollment_id))];
  console.log(`\nRecalculando renda para matrículas: ${enrollmentIds.join(", ")}`);
  for (const eid of enrollmentIds) {
    try {
      const res = await fetch(`${BASE}/api/enrollments/${eid}/recalculate`, {
        method: "POST",
        headers: { Cookie: cookie },
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`  Matrícula ${eid}: rendaTotal=${data.rendaTotal ?? "?"} status=${data.ocrStatus ?? "?"}`);
      } else {
        console.log(`  Matrícula ${eid}: recalculate endpoint retornou ${res.status} (pode não existir — OK)`);
      }
    } catch (err) {
      console.log(`  Matrícula ${eid}: ${err.message}`);
    }
  }

  await pool.end();
  console.log("\nConcluído.");
}

main().catch((e) => { console.error(e); process.exit(1); });
