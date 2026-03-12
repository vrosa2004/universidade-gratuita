/**
 * Re-runs document analysis (OCR) on identity documents (rg_frente / rg_verso)
 * Usage:
 *   node script/reprocess-identity.mjs <userId>
 *   node script/reprocess-identity.mjs 4
 */
import { createRequire } from "module";
import "dotenv/config";

const require = createRequire(import.meta.url);
const pg = require("pg");
const { Pool } = pg;

const BASE = "http://localhost:5000";

async function loginAsAdmin() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "123" }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const sid = setCookie.split(";")[0];
  if (!sid) throw new Error("No session cookie");
  return sid;
}

async function analyzeViaApi(base64url, declaredName, cookie) {
  const res = await fetch(`${BASE}/api/debug/document-analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ base64: base64url, declaredName }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const userId = parseInt(process.argv[2] ?? "4");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { rows } = await pool.query(
    `SELECT d.id, d.type, d.name, e.status, d.url, d.ocr_data,
            e.student_id, u.username, e.cpf
     FROM documents d
     JOIN enrollments e ON e.id = d.enrollment_id
     JOIN users u ON u.id = e.student_id
     WHERE e.student_id = $1
       AND d.type IN ('rg_frente', 'rg_verso')
     ORDER BY d.id`,
    [userId]
  );

  if (rows.length === 0) {
    console.log(`Nenhum documento RG encontrado para usuário ${userId}.`);
    await pool.end();
    return;
  }

  console.log(`Encontrado(s) ${rows.length} documento(s) para usuário ${userId} (${rows[0].username}):\n`);

  // Show current OCR state
  for (const d of rows) {
    const ocr = d.ocr_data;
    console.log(`Doc #${d.id} [${d.type}] enrollment_status=${d.status}`);
    if (ocr?.campos_extraidos) {
      console.log(`  campos_extraidos:`, JSON.stringify(ocr.campos_extraidos));
    } else {
      console.log(`  ocr_data: ${JSON.stringify(ocr)?.slice(0, 120) ?? "null"}`);
    }
  }

  console.log("\n─────────────────────────────────────────");
  console.log("Re-analisando com novo código OCR...\n");

  const cookie = await loginAsAdmin();

  for (const d of rows) {
    if (!d.url || d.url === "mock" || !d.url.startsWith("data:")) {
      console.log(`Doc #${d.id}: URL inválida ou mock — pulando`);
      continue;
    }

    // Get declared name from enrollment
    const { rows: userRows } = await pool.query(
      `SELECT e.name FROM enrollments e WHERE e.student_id = $1 LIMIT 1`,
      [userId]
    );
    const declaredName = userRows[0]?.name ?? undefined;

    console.log(`── Doc #${d.id} [${d.type}] (nome declarado: ${declaredName ?? "não informado"}) ──`);
    const mimeMatch = d.url.match(/^data:([^;]+);base64,/);
    console.log(`   MIME: ${mimeMatch?.[1] ?? "?"}, tamanho: ${Math.round(d.url.length / 1024)}KB`);

    try {
      const result = await analyzeViaApi(d.url, declaredName, cookie);
      console.log(`   doc_type: ${result.doc_type}`);
      console.log(`   campos_extraidos: ${JSON.stringify(result.campos_extraidos)}`);
      console.log(`   validacoes: ${JSON.stringify(result.validacoes)}`);
      if (result.alertas?.length) console.log(`   alertas: ${result.alertas.join(", ")}`);

      // Update DB
      await pool.query(
        `UPDATE documents SET ocr_data = $1 WHERE id = $2`,
        [JSON.stringify(result), d.id]
      );

      // Update enrollment status based on same logic as routes.ts
      const CAMPO = "campo_nao_identificado";
      const camposNI = result.campos_extraidos
        ? Object.entries(result.campos_extraidos).filter(([, v]) => v === CAMPO).map(([k]) => k)
        : [];
      const blockingMissing = camposNI.filter(k => ["nome", "cpf"].includes(k));
      const declaredCpf = d.cpf ?? undefined;

      let newStatus = null;
      let newMsg = null;

      if (result.fraude_detectada || result.score_confianca < 0.40) {
        newStatus = "pending";
        newMsg = `Revisão manual: score baixo (${result.score_confianca}) ou fraude.`;
      } else if (blockingMissing.includes("cpf") && declaredCpf && !camposNI.includes("nome")) {
        newStatus = "pending";
        newMsg = "CPF não pôde ser verificado automaticamente. Em revisão manual.";
      } else if (blockingMissing.length === 0) {
        newStatus = "in_analysis";
        newMsg = null;
      }

      if (newStatus) {
        await pool.query(
          `UPDATE enrollments SET status = $1, system_decision = $2 WHERE id IN (
            SELECT enrollment_id FROM documents WHERE id = $3
          )`,
          [newStatus, newMsg, d.id]
        );
        console.log(`   Status matrícula → ${newStatus}${newMsg ? ": " + newMsg : ""}`);
      }
      console.log(`   ✅ DB atualizado`);
    } catch (err) {
      console.error(`   ❌ Erro: ${err.message}`);
    }
  }

  await pool.end();
  console.log("\nConcluído.");
}

main().catch((e) => { console.error(e); process.exit(1); });
