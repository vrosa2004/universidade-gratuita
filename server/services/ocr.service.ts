/**
 * OCR Service
 * Extracts plain text from base64 data-URLs (images or PDFs).
 * - Images  → pre-processed with sharp (grayscale + CLAHE + sharpen) then Tesseract.js
 * - PDFs    → pdf2json (embedded text extraction); falls back to REVISAO_MANUAL
 *             if the PDF has no selectable text (scanned).
 *
 * Optimizações aplicadas:
 *  1. Tesseract PSM 6 e PSM 4 agora rodam em paralelo (Promise.all).
 *  2. OCR de páginas PDF escanadas agora roda em paralelo por página.
 *  3. preprocessImage faz early-exit para imagens já em boa resolução,
 *     evitando o pipeline completo de sharp + CLAHE desnecessariamente.
 *  4. Worker pool de Tesseract reutilizável para evitar overhead de
 *     inicialização a cada chamada.
 */

import Tesseract from "tesseract.js";
import { createRequire } from "module";
import sharp from "sharp";

const require = createRequire(import.meta.url);

const OCR_TIMEOUT_MS = 60_000; // 60 s max por documento

/** Result returned by every extractor. */
export interface OcrExtractionResult {
  text: string;
  /** 0-100 confidence score; PDFs via text-layer return 80 por convenção. */
  confidence: number;
  /** MIME type detectado do header da data-URL. */
  mimeType: string;
}

// ── Worker pool ──────────────────────────────────────────────────────────────

/**
 * Pool de workers Tesseract reutilizáveis.
 * Evita overhead de inicialização (~300-500ms) a cada chamada de OCR.
 * Dois workers permitem rodar PSM 6 e PSM 4 verdadeiramente em paralelo.
 */
const POOL_SIZE = 2;
let workerPool: Tesseract.Worker[] | null = null;
let workerIndex = 0;

async function getWorkerPool(): Promise<Tesseract.Worker[]> {
  if (workerPool) return workerPool;

  workerPool = await Promise.all(
    Array.from({ length: POOL_SIZE }, () =>
      Tesseract.createWorker("por", 1, { logger: () => {} })
    )
  );

  console.log(`[OCR] Worker pool inicializado com ${POOL_SIZE} workers.`);
  return workerPool;
}

/**
 * Devolve o próximo worker disponível em round-robin.
 * Round-robin simples é suficiente pois os dois passes são disparados juntos.
 */
async function acquireWorker(): Promise<Tesseract.Worker> {
  const pool = await getWorkerPool();
  const worker = pool[workerIndex % POOL_SIZE];
  workerIndex++;
  return worker;
}

/**
 * Libera todos os workers do pool (use ao encerrar o processo).
 */
export async function terminateWorkerPool(): Promise<void> {
  if (!workerPool) return;
  await Promise.all(workerPool.map((w) => w.terminate()));
  workerPool = null;
  console.log("[OCR] Worker pool encerrado.");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Main entry point.
 * Accepts a base64 data-URL like `data:image/png;base64,...` or
 * `data:application/pdf;base64,...` and returns extracted text.
 */
export async function extractTextFromDataUrl(
  dataUrl: string
): Promise<OcrExtractionResult> {
  const [header, b64Data] = dataUrl.split(",");
  const mimeType = header?.match(/:(.*?);/)?.[1] ?? "application/octet-stream";

  if (!b64Data) {
    throw new Error("Data-URL mal formada: conteúdo base64 ausente.");
  }

  const buffer = Buffer.from(b64Data, "base64");

  if (mimeType === "application/pdf") {
    return extractFromPdf(buffer, mimeType);
  }

  if (mimeType.startsWith("image/")) {
    return extractFromImage(buffer, mimeType);
  }

  throw new Error(`Tipo de arquivo não suportado para OCR: ${mimeType}`);
}

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Pre-processa imagem com sharp para melhor qualidade de OCR.
 *
 * Otimização: imagens já em boa resolução (≥1500px) pulam o pipeline
 * completo (CLAHE + sharpen) e passam apenas por greyscale → PNG,
 * economizando ~1-3s de processamento por chamada.
 *
 * Pipeline completo (imagens pequenas):
 *  1. Upscale para mínimo de 1500px de largura (Tesseract precisa ~300 DPI)
 *  2. Greyscale
 *  3. CLAHE – contraste adaptativo local (melhor que normalize para docs)
 *  4. Sharpen moderado para realçar bordas do texto
 *
 * Retorna buffer PNG (lossless, sem artefatos JPEG).
 */
async function preprocessImage(raw: Buffer): Promise<Buffer> {
  try {
    const meta = await sharp(raw).metadata();
    const w = meta.width ?? 1;

    // ── Early exit: imagem já em boa resolução ──
    // Pula CLAHE + sharpen (pesados) e faz só greyscale → PNG.
    if (w >= 1500) {
      return await sharp(raw).greyscale().png().toBuffer();
    }

    // ── Pipeline completo para imagens pequenas ──
    const scaleUp = Math.min(4, Math.ceil(1500 / w));
    return await sharp(raw)
      .resize({ width: w * scaleUp, kernel: "lanczos3" })
      .greyscale()
      .clahe({ width: 8, height: 8, maxSlope: 4 })
      .sharpen({ sigma: 1.0, m1: 1.0, m2: 5 })
      .png()
      .toBuffer();
  } catch (err: any) {
    console.warn("[OCR] Pré-processamento falhou, usando imagem original:", err?.message);
    return raw;
  }
}

/**
 * Roda um passe Tesseract com o PSM indicado usando um worker do pool.
 *
 * Usa worker reutilizável para evitar overhead de inicialização.
 */
async function tesseractPass(
  imageBuffer: Buffer,
  psm: number
): Promise<{ text: string; confidence: number }> {
  const worker = await acquireWorker();
  const result = await worker.recognize(imageBuffer, {
    tessedit_pageseg_mode: psm as any,
    preserve_interword_spaces: "1",
  } as any);
  return { text: result.data.text, confidence: result.data.confidence };
}

/**
 * Roda PSM 6 e PSM 4 em paralelo e retorna o melhor resultado.
 * Antes: sequencial (~2× o tempo de OCR).
 * Agora: paralelo (tempo = max(PSM6, PSM4) em vez de PSM6 + PSM4).
 */
async function bestTesseractPass(
  imageBuffer: Buffer
): Promise<{ text: string; confidence: number }> {
  const [pass1, pass2] = await Promise.all([
    tesseractPass(imageBuffer, 6),
    tesseractPass(imageBuffer, 4),
  ]);

  console.log(`[OCR] PSM-6 confiança: ${pass1.confidence.toFixed(1)}% | chars: ${pass1.text.length}`);
  console.log(`[OCR] PSM-4 confiança: ${pass2.confidence.toFixed(1)}% | chars: ${pass2.text.length}`);

  const score = (p: { text: string; confidence: number }) =>
    p.confidence * Math.sqrt(p.text.length);

  const usedPsm = score(pass1) >= score(pass2) ? 6 : 4;
  console.log(`[OCR] Melhor passagem: PSM-${usedPsm}`);

  return score(pass1) >= score(pass2) ? pass1 : pass2;
}

async function extractFromImage(
  buffer: Buffer,
  mimeType: string
): Promise<OcrExtractionResult> {
  console.log(`[OCR] Iniciando extração de imagem (${(buffer.length / 1024).toFixed(1)} KB)...`);

  const work = async () => {
    const processed = await preprocessImage(buffer);
    console.log(`[OCR] Imagem pré-processada (${(processed.length / 1024).toFixed(1)} KB PNG).`);

    // PSM 6 e PSM 4 agora rodam em paralelo
    const best = await bestTesseractPass(processed);

    return { ...best, mimeType };
  };

  const withTimeout = Promise.race([
    work(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("OCR timeout após 60s")), OCR_TIMEOUT_MS)
    ),
  ]);

  try {
    const result = await withTimeout;
    console.log(`[OCR] Extração concluída. Confiança: ${result.confidence.toFixed(1)}%. Tamanho do texto: ${result.text.length} chars.`);
    console.log(`[OCR] Primeiros 600 chars:\n---\n${result.text.slice(0, 600)}\n---`);
    return result;
  } catch (err: any) {
    console.error("[OCR] Tesseract falhou:", err?.message ?? err);
    throw err;
  }
}

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const execFileAsync = promisify(execFile);

async function extractFromPdf(
  buffer: Buffer,
  mimeType: string
): Promise<OcrExtractionResult> {
  // ── Fase 1: tenta extração de texto com pdf2json ─────────────────────────
  const text = await extractPdfText(buffer);
  if (text && text.length >= 20) {
    console.log(`[OCR] PDF com texto embutido. Chars: ${text.length}`);
    console.log(`[OCR] Primeiros 600 chars:\n---\n${text.slice(0, 600)}\n---`);
    return { text, confidence: 80, mimeType };
  }

  // ── Fase 2: PDF escaneado → pdftoppm + Tesseract ─────────────────────────
  console.log("[OCR] PDF sem texto embutido — tentando OCR via pdftoppm...");
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ocr-pdf-"));

  try {
    const pdfPath = path.join(tmpDir, "input.pdf");
    await fs.promises.writeFile(pdfPath, buffer);

    // Limita às primeiras 3 páginas (holerites são 1-2 páginas)
    await execFileAsync("pdftoppm", [
      "-r", "200",
      "-l", "3",
      "-png",
      pdfPath,
      path.join(tmpDir, "page"),
    ]);

    const pageFiles = (await fs.promises.readdir(tmpDir))
      .filter((f) => f.endsWith(".png"))
      .sort()
      .map((f) => path.join(tmpDir, f));

    if (pageFiles.length === 0) {
      throw new Error("pdftoppm não gerou nenhuma imagem de página.");
    }

    console.log(`[OCR] ${pageFiles.length} página(s) convertida(s) para PNG.`);

    /**
     * Otimização: páginas processadas em paralelo com Promise.all.
     * Antes: loop sequencial — cada página esperava a anterior terminar.
     * Agora: todas as páginas rodam ao mesmo tempo (tempo ≈ página mais lenta).
     */
    const pageResults = await Promise.all(
      pageFiles.map(async (pgFile) => {
        const imgBuf = await fs.promises.readFile(pgFile);
        const processed = await preprocessImage(imgBuf);

        // PSM 6 e PSM 4 também em paralelo dentro de cada página
        const best = await bestTesseractPass(processed);

        console.log(`[OCR] Página ${path.basename(pgFile)}: confiança ${best.confidence.toFixed(1)}%, chars ${best.text.length}`);
        return best;
      })
    );

    const combinedText = pageResults.map((r) => r.text).join("\n").trim();
    const avgConf =
      pageResults.reduce((sum, r) => sum + r.confidence, 0) / pageResults.length;

    console.log(`[OCR] PDF escaneado extraído. Total chars: ${combinedText.length}, conf média: ${avgConf.toFixed(1)}%`);
    console.log(`[OCR] Primeiros 600 chars:\n---\n${combinedText.slice(0, 600)}\n---`);

    return { text: combinedText, confidence: avgConf, mimeType };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Extrai texto embutido de um buffer PDF via pdf2json. Retorna "" se não houver texto. */
function extractPdfText(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("pdf2json timeout")), 30_000);
    try {
      const PDFParser = require("pdf2json");
      const pdfParser = new PDFParser(null, 1);

      pdfParser.on("pdfParser_dataError", () => {
        clearTimeout(timer);
        resolve("");
      });

      pdfParser.on("pdfParser_dataReady", (pdfData: any) => {
        clearTimeout(timer);
        try {
          const pages: any[] = pdfData?.Pages ?? pdfData?.formImage?.Pages ?? [];
          const parts: string[] = [];
          for (const page of pages) {
            for (const textItem of page.Texts ?? []) {
              for (const run of textItem.R ?? []) {
                parts.push(decodeURIComponent(run.T ?? ""));
              }
            }
            parts.push("\n");
          }
          resolve(parts.join(" ").trim());
        } catch {
          resolve("");
        }
      });

      pdfParser.parseBuffer(buffer);
    } catch (err) {
      clearTimeout(timer);
      resolve("");
    }
  });
}