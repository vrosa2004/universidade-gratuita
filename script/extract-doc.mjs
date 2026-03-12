/**
 * Extrai documento do banco e salva em disco para diagnóstico.
 * Usage: node script/extract-doc.mjs <docId> [outputPath]
 */
import { createRequire } from "module";
import { writeFileSync } from "fs";
import "dotenv/config";

const require = createRequire(import.meta.url);
const pg = require("pg");
const { Pool } = pg;

async function main() {
  const docId = parseInt(process.argv[2]);
  const outPath = process.argv[3] ?? `/tmp/doc-${docId}.jpg`;
  if (!docId) { console.error("Uso: node script/extract-doc.mjs <docId> [outputPath]"); process.exit(1); }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query("SELECT url, name FROM documents WHERE id = $1", [docId]);
  await pool.end();

  if (!rows.length) { console.error("Documento não encontrado."); process.exit(1); }
  const { url, name } = rows[0];
  if (!url || !url.startsWith("data:")) { console.error("URL inválida:", url?.slice(0, 50)); process.exit(1); }
  const base64 = url.replace(/^data:[^;]+;base64,/, "");
  writeFileSync(outPath, Buffer.from(base64, "base64"));
  console.log(`Salvo: ${outPath}  (${name})`);
}

main().catch(e => { console.error(e); process.exit(1); });
