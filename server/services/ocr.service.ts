/**
 * OCR Service
 * Extracts plain text from base64 data-URLs (images or PDFs).
 * - Images  → pre-processed with sharp (grayscale + CLAHE + sharpen) then Tesseract.js
 * - PDFs    → pdf2json (embedded text extraction); falls back to REVISAO_MANUAL
 *             if the PDF has no selectable text (scanned).
 */

import Tesseract from "tesseract.js";
import { createRequire } from "module";
import sharp from "sharp";

const require = createRequire(import.meta.url);

const OCR_TIMEOUT_MS = 60_000; // 60 s max per document (preprocessing adds ~5s)

/** Result returned by every extractor. */
export interface OcrExtractionResult {
  text: string;
  /** 0-100 confidence score; PDFs via text-layer return 80 by convention. */
  confidence: number;
  /** MIME type detected from the data-URL header. */
  mimeType: string;
}

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
 * Pre-process image with sharp for better OCR:
 *  1. Ensure minimum 2000px width (Tesseract needs ~300 DPI)
 *  2. Convert to greyscale
 *  3. CLAHE – adaptive local contrast enhancement (better than normalize for docs)
 *  4. Moderate sharpen to crisp text edges
 *
 * Returns a PNG buffer (lossless, no JPEG artefacts).
 */
async function preprocessImage(raw: Buffer): Promise<Buffer> {
  try {
    const meta = await sharp(raw).metadata();
    const w = meta.width ?? 1;
    // Upscale if image is too small (< 1500px wide) — Tesseract needs ~300 DPI
    const scaleUp = w < 1500 ? Math.min(4, Math.ceil(1500 / w)) : 1;

    let pipeline = sharp(raw);
    if (scaleUp > 1) {
      pipeline = pipeline.resize({ width: w * scaleUp, kernel: "lanczos3" });
    }
    return await pipeline
      .greyscale()
      .clahe({ width: 8, height: 8, maxSlope: 4 }) // adaptive local contrast
      .sharpen({ sigma: 1.0, m1: 1.0, m2: 5 })
      .png()
      .toBuffer();
  } catch (err: any) {
    console.warn("[OCR] Pre-processamento falhou, usando imagem original:", err?.message);
    return raw;
  }
}

/**
 * Run a single Tesseract pass with the given PSM mode.
 * Returns { text, confidence }.
 */
async function tesseractPass(
  imageBuffer: Buffer,
  psm: number
): Promise<{ text: string; confidence: number }> {
  const result = await Tesseract.recognize(imageBuffer, "por", {
    logger: () => {},
    tessedit_pageseg_mode: psm as any,
    preserve_interword_spaces: "1",
  } as any);
  return { text: result.data.text, confidence: result.data.confidence };
}

async function extractFromImage(
  buffer: Buffer,
  mimeType: string
): Promise<OcrExtractionResult> {
  console.log(`[OCR] Iniciando extração de imagem (${(buffer.length / 1024).toFixed(1)} KB)...`);

  const work = async () => {
    // Pre-process for better OCR quality
    const processed = await preprocessImage(buffer);
    console.log(`[OCR] Imagem pré-processada (${(processed.length / 1024).toFixed(1)} KB PNG).`);

    // First pass: PSM 6 (single uniform block) – best for payslips/forms
    const pass1 = await tesseractPass(processed, 6);
    console.log(`[OCR] PSM-6 confiança: ${pass1.confidence.toFixed(1)}% | chars: ${pass1.text.length}`);

    // Second pass: PSM 4 (single column) – useful if layout is column-heavy
    const pass2 = await tesseractPass(processed, 4);
    console.log(`[OCR] PSM-4 confiança: ${pass2.confidence.toFixed(1)}% | chars: ${pass2.text.length}`);

    // Pick the pass with higher (confidence × text_length) score
    const score = (p: { text: string; confidence: number }) =>
      p.confidence * Math.sqrt(p.text.length);
    const best = score(pass1) >= score(pass2) ? pass1 : pass2;
    console.log(`[OCR] Melhor passagem: PSM-${score(pass1) >= score(pass2) ? 6 : 4}`);

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
  // ── Phase 1: Try text extraction with pdf2json ───────────────────────────
  const text = await extractPdfText(buffer);
  if (text && text.length >= 20) {
    console.log(`[OCR] PDF com texto embutido. Chars: ${text.length}`);
    console.log(`[OCR] Primeiros 600 chars:\n---\n${text.slice(0, 600)}\n---`);
    return { text, confidence: 80, mimeType };
  }

  // ── Phase 2: Scanned PDF → pdftoppm + Tesseract ──────────────────────────
  console.log("[OCR] PDF sem texto embutido — tentando OCR via pdftoppm...");
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ocr-pdf-"));
  try {
    const pdfPath = path.join(tmpDir, "input.pdf");
    await fs.promises.writeFile(pdfPath, buffer);

    // Limit to first 3 pages to keep processing time reasonable (payslips are 1–2 pages)
    await execFileAsync("pdftoppm", [
      "-r", "200",    // 200 DPI is enough for OCR
      "-l", "3",      // first 3 pages only
      "-png",
      pdfPath,
      path.join(tmpDir, "page"),
    ]);

    const pageFiles = (await fs.promises.readdir(tmpDir))
      .filter(f => f.endsWith(".png"))
      .sort()
      .map(f => path.join(tmpDir, f));

    if (pageFiles.length === 0) {
      throw new Error("pdftoppm não gerou nenhuma imagem de página.");
    }

    console.log(`[OCR] ${pageFiles.length} página(s) convertida(s) para PNG.`);

    const textParts: string[] = [];
    let totalConfidence = 0;
    for (const pgFile of pageFiles) {
      const imgBuf = await fs.promises.readFile(pgFile);
      const processed = await preprocessImage(imgBuf);
      const pass1 = await tesseractPass(processed, 6);
      const pass2 = await tesseractPass(processed, 4);
      const best = pass1.confidence >= pass2.confidence ? pass1 : pass2;
      textParts.push(best.text);
      totalConfidence += best.confidence;
      console.log(`[OCR] Página: confiança ${best.confidence.toFixed(1)}%, chars ${best.text.length}`);
    }

    const combinedText = textParts.join("\n").trim();
    const avgConf = totalConfidence / pageFiles.length;
    console.log(`[OCR] PDF escaneado extraído. Total chars: ${combinedText.length}, conf média: ${avgConf.toFixed(1)}%`);
    console.log(`[OCR] Primeiros 600 chars:\n---\n${combinedText.slice(0, 600)}\n---`);
    return { text: combinedText, confidence: avgConf, mimeType };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Extract embedded text from a PDF buffer using pdf2json. Returns null / "" if no text. */
function extractPdfText(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("pdf2json timeout")), 30_000);
    try {
      const PDFParser = require("pdf2json");
      const pdfParser = new PDFParser(null, 1);

      pdfParser.on("pdfParser_dataError", (err: any) => {
        clearTimeout(timer);
        resolve(""); // treat errors as "no text"
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
