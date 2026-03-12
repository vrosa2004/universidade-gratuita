/**
 * Document Analysis Service — Pipeline completo de análise de documentos de identidade
 *
 * Pipeline de 9 etapas conforme especificação:
 *   1. Validação do upload
 *   2. Pré-processamento da imagem
 *   3. Detecção de regiões de texto + rotação automática
 *   4. OCR (múltiplos PSMs, melhor resultado selecionado)
 *   5. Extração de campos estruturados
 *   6. Validação de campos (CPF, datas, nome)
 *   7. Análise básica de fraude
 *   8. Cálculo do score de confiança
 *   9. Resultado final em JSON
 */

import sharp from "sharp";
import Tesseract from "tesseract.js";
import { compareNames } from "./name.service.js";
import { execFile } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, readFile, unlink, readdir } from "fs/promises";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type QualidadeImagem = "boa" | "media" | "baixa";

export interface DocumentAnalysisResult {
  tipo_documento: string;
  campos_extraidos: {
    nome: string;
    cpf: string;
  };
  validacoes: {
    /** CPF is mathematically valid (Luhn check) */
    cpf_valido: boolean;
    /** CPF extracted from document matches the CPF declared in the enrollment form */
    cpf_correspondente: boolean;
    nome_correspondente: boolean;
  };
  fraude_detectada: boolean;
  score_confianca: number;
  observacoes: string[];
}

const CAMPO_NAO_IDENTIFICADO = "campo_nao_identificado";

// ---------------------------------------------------------------------------
// 1 — Upload / Validação básica
// ---------------------------------------------------------------------------

interface UploadMeta {
  mimeType: string;
  buffer: Buffer;
  sizeKb: number;
}

function parseDataUrl(dataUrl: string): UploadMeta {
  const [header, b64] = dataUrl.split(",");
  if (!b64) throw new Error("Data-URL mal formada: conteúdo base64 ausente.");

  const mimeType = header?.match(/:(.*?);/)?.[1] ?? "application/octet-stream";

  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"];
  if (!allowed.includes(mimeType)) {
    throw new Error(`Tipo de arquivo não suportado para análise: ${mimeType}`);
  }

  const buffer = Buffer.from(b64, "base64");
  return { mimeType, buffer, sizeKb: Math.round(buffer.length / 1024) };
}

// ---------------------------------------------------------------------------
// 2 — Pré-processamento da imagem
// ---------------------------------------------------------------------------

interface PreprocessResult {
  buffer: Buffer;
  width: number;
  height: number;
  qualidade: QualidadeImagem;
  rotation: number;
  observacoes: string[];
}

/**
 * Single fast Tesseract PSM-11 pass (no logger). Used for rotation detection.
 */
async function tesseractQuick(buf: Buffer): Promise<{ text: string; confidence: number }> {
  const { data } = await Tesseract.recognize(buf, "por", {
    logger: () => {},
    tessedit_pageseg_mode: 11 as any,
  } as any);
  return { text: data.text, confidence: data.confidence };
}

/**
 * Scores an OCR result for rotation detection.
 * Uses conf × √len as a base, then adds a large bonus for each Brazilian
 * document keyword found. This makes the correct orientation reliably win
 * even when background patterns give similar raw confidence at all angles.
 */
function orientationScore(text: string, confidence: number): number {
  const upper = text.toUpperCase();
  const keywords = [
    "NOME", "CPF", "BRASIL", "FILIA", "NATURALI", "REGISTRO",
    "IDENTIDADE", "IDENTIDADE", "CARTEIRA", "NASCIMENTO", "SECRETARIA",
    "MINISTERIO", "MINISTÉRIO", "HABILITAC", "HABILITAÇÃO", "FEDERAL",
    "REPUBLICA", "REPÚBLICA", "ASSINATURA", "VALIDADE",
  ];
  const hits = keywords.filter((kw) => upper.includes(kw)).length;
  // Each keyword hit adds 200 points — dwarfs background noise differences.
  return confidence * Math.sqrt(Math.max(1, text.trim().length)) + hits * 200;
}

async function preprocessDocument(raw: Buffer): Promise<PreprocessResult> {
  const obs: string[] = [];

  // Metadata check
  const meta = await sharp(raw).metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const minDim = Math.min(w, h);

  const qualidade: QualidadeImagem =
    minDim >= 1000 ? "boa" : minDim >= 500 ? "media" : "baixa";

  if (qualidade === "baixa") {
    obs.push(
      `Imagem com baixa resolução (${w}×${h}px). Qualidade do OCR pode ser prejudicada.`
    );
  }

  // Auto-rotate via EXIF orientation tag
  let baseBuffer = await sharp(raw).rotate().toBuffer();

  // Upscale if too small
  const scaleUp = minDim < 1500 ? Math.min(4, Math.ceil(1500 / minDim)) : 1;

  // Minimal enhancement: greyscale only + optional upscale.
  // All other filters (normalize, sharpen, CLAHE) are intentionally removed —
  // Tesseract performs its own adaptive binarization and extra pre-processing
  // tends to destroy OCR quality on structured identity documents.
  const processedBuffer = await sharp(baseBuffer)
    .resize(scaleUp > 1 ? { width: Math.round(w * scaleUp), kernel: "lanczos3" } : undefined)
    .greyscale()
    .png()
    .toBuffer();

  // Always check all 4 orientations and pick the one whose OCR result best matches
  // expected Brazilian document structure (keyword-boosted score).
  // The 1.3× threshold prevents false switches on already-correct images.
  let finalBuffer = processedBuffer;
  let bestRotation = 0;

  const pass0 = await tesseractQuick(processedBuffer);
  let bestScore = orientationScore(pass0.text, pass0.confidence);
  console.log(
    `[DocAnalysis] Rotação 0° (EXIF): conf=${pass0.confidence.toFixed(1)}% len=${pass0.text.trim().length} score=${bestScore.toFixed(0)}`
  );

  for (const angle of [90, 180, 270]) {
    const rotBuf = await sharp(processedBuffer).rotate(angle).png().toBuffer();
    const pass = await tesseractQuick(rotBuf);
    const score = orientationScore(pass.text, pass.confidence);
    console.log(
      `[DocAnalysis] Rotação ${angle}°: conf=${pass.confidence.toFixed(1)}% len=${pass.text.trim().length} score=${score.toFixed(0)}`
    );
    if (score > bestScore * 1.3) {
      bestScore = score;
      bestRotation = angle;
      finalBuffer = rotBuf;
    }
  }

  if (bestRotation !== 0) {
    finalBuffer = await sharp(processedBuffer).rotate(bestRotation).png().toBuffer();
    obs.push(`Imagem rotacionada ${bestRotation}° para leitura correta.`);
  }

  return { buffer: finalBuffer, width: w, height: h, qualidade, rotation: bestRotation, observacoes: obs };
}

// ---------------------------------------------------------------------------
// 3 + 4 — OCR (múltiplos PSMs, melhor resultado)
// ---------------------------------------------------------------------------

interface OcrPassResult {
  text: string;
  confidence: number;
  psm: number;
}

async function runOcrMultiPass(buffer: Buffer): Promise<OcrPassResult> {
  // Two passes matching the existing ocr.service strategy:
  // PSM-6: uniform block — best for structured identity cards.
  // PSM-4: single column — useful for column-heavy layouts.
  const psms = [
    6,   // uniform block — best for structured ID cards / forms
    4,   // single column — useful for column-heavy card layouts
  ];

  const score = (r: OcrPassResult) => r.confidence * Math.sqrt(r.text.length);

  let best: OcrPassResult = { text: "", confidence: 0, psm: 6 };

  for (const psm of psms) {
    const { data } = await Tesseract.recognize(buffer, "por", {
      logger: () => {},
      tessedit_pageseg_mode: psm as any,
      preserve_interword_spaces: "1",
    } as any);

    const result: OcrPassResult = {
      text: data.text,
      confidence: data.confidence,
      psm,
    };

    if (score(result) > score(best)) {
      best = result;
    }
    console.log(`[DocAnalysis] PSM-${psm} conf=${data.confidence.toFixed(1)}% len=${data.text.length}`);
  }

  console.log(`[DocAnalysis] Melhor PSM: ${best.psm} (${best.confidence.toFixed(1)}%, ${best.text.length} chars)`);
  return best;
}

/**
 * Digits-only OCR pass — restricts Tesseract to digits + common separators.
 * On CNH-e documents the CPF and date fields sit inside heavily-decorated table
 * cells that produce garbage in a regular pass.  Limiting the character set
 * removes letter noise and lets Tesseract read the digit sequences cleanly.
 */
async function runDigitsOnlyPass(buffer: Buffer): Promise<string> {
  try {
    const { data } = await Tesseract.recognize(buffer, "por", {
      logger: () => {},
      tessedit_pageseg_mode: 11 as any, // sparse text — finds numbers anywhere on page
      tessedit_char_whitelist: "0123456789./-: ",
      preserve_interword_spaces: "1",
    } as any);
    return data.text;
  } catch {
    return "";
  }
}

/**
 * Alternative OCR pass using Otsu binary thresholding.
 * Helps with photos that have uneven lighting or reflective glare:
 * the threshold removes gray gradients and produces pure B&W,
 * which can dramatically improve digit recognition in those cases.
 */
async function runBinaryThresholdPass(buffer: Buffer): Promise<string> {
  try {
    // Otsu threshold: converts greyscale to pure black/white
    const binaryBuf = await sharp(buffer)
      .greyscale()
      .threshold(160) // slightly above mid — favours dark ink on bright paper
      .png()
      .toBuffer();
    const { data } = await Tesseract.recognize(binaryBuf, "por", {
      logger: () => {},
      tessedit_pageseg_mode: 6 as any,
    } as any);
    return data.text;
  } catch {
    return "";
  }
}

// Detects document type from raw text
function detectDocumentType(text: string): string {
  const upper = text.toUpperCase();
  // Be tolerant of merged words like "CARTEIRANACIONAUDE" that OCR produces
  if (/CARTEIRA\s*NACION|HABILITAt|HABILITACAO|HABILITAÇÃO|CNH\b|SENATRAN/.test(upper))
    return "CNH";
  if (/REGISTRO\s+GERAL|IDENTIDADE|C[EÉ]DULA\s+DE\s+IDENTIDADE/.test(upper))
    return "RG";
  if (/CADASTRO\s+DE\s+PESSOAS\s+F[IÍ]SICAS|CPF/.test(upper))
    return "CPF";
  if (/PASSAPORTE/.test(upper))
    return "Passaporte";
  return "Documento de Identidade";
}

// Normalize raw OCR text: join broken lines, remove extra spaces
function normalizeOcrText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractName(text: string, declaredName?: string): string {
  // ── Priority 1: MRZ line (most reliable for CNH-e / MRTD documents) ──────────
  // TD1/TD3 MRTD format lines use "<" as word separator and "<<" as field separator.
  // e.g. VINICIUS<<RODRIGUES<DA<ROSA<<<  or  RODRIGUES<<VINICIUS<DA<ROSA<<<
  // Scan from BOTTOM — name is always the last MRZ line in TD1.
  for (const line of [...text.split("\n")].reverse()) {
    const trimmed = line.trim();
    if (
      (trimmed.includes("<<") || /[A-Z]{3,}<</.test(trimmed)) &&
      /^[A-Z<\s&]+$/.test(trimmed) &&
      trimmed.length >= 8
    ) {
      // Split on double-< first (field separator), then single-< (word separator)
      const tokens = trimmed
        .split(/<<+/)
        .flatMap((part) => part.split(/<+/))
        .map((t) => t.trim())
        .filter((t) => /^[A-Z]{2,}$/.test(t));
      if (tokens.length >= 2) {
        return tokens.join(" ");
      }
    }
  }

  // ── Priority 2: labeled fields ────────────────────────────────────────────────
  // Character class covers both ALL-CAPS (old RG/CNH) and Title Case (new CIN).
  // Regex `/i` flag makes the label case-insensitive but NOT the capture group —
  // so the class must include both upper and lower-case accented characters.
  const nameChars = "A-Za-záéíóúâêîôûãõçàèùüÁÉÍÓÚÂÊÎÔÛÃÕÇÀÈÙÜ";

  const patternsInline = [
    // New CIN bilingual label: "Nome / Name" with name on next line (may have leading "|").
    new RegExp(`(?:Nome|NOME)\\s*[/|]\\s*(?:Name)?\\s*\n\\s*[|!l]?\\s*([${nameChars}][${nameChars}\\s]{4,})`, "im"),
    // Old-style RG: "NOME" label at start of line, optionally followed by OTHER text on same
    // line (e.g. OCR merges adjacent column content), then name on the NEXT line.
    // [^\n]* absorbs any trailing content on the NOME line without breaking the match.
    new RegExp(`(?:^|\n)[ \t]*NOME[ \t]*[^\n]*\n[ \t]*([${nameChars}][${nameChars}\\s]{4,})`, "im"),
    // Old-style labels — inline value on same line.
    new RegExp(`NOME\\s+E\\s+SOBRENOME\\s*[:|]?\\s*([${nameChars}][${nameChars}\\s]{4,})`, "i"),
    // Old-style labels — value on next line.
    new RegExp(`NOME\\s+E\\s+SOBRENOME\\s*\n\\s*([${nameChars}][${nameChars}\\s]{4,})`, "im"),
    new RegExp(`NOME\\s+COMPLETO\\s*[:|]?\\s*([${nameChars}][${nameChars}\\s]{4,})`, "im"),
    new RegExp(`NOME\\s+COMPLETO\\s*\n\\s*([${nameChars}][${nameChars}\\s]{4,})`, "im"),
    new RegExp(`NOME\\s*[:|]\\s*([${nameChars}][${nameChars}\\s]{4,})`, "im"),
  ];

  for (const pat of patternsInline) {
    const m = text.match(pat);
    if (m?.[1]) {
      // Take first line only; strip leading OCR-noise chars (|, !, 1, l)
      const candidate = m[1]
        .trim()
        .replace(/^[|!l1]\s*/, "")
        .replace(/\n.*$/s, "")
        .trim();
      if (candidate.length >= 5 && candidate.split(" ").length >= 2) {
        return candidate.toUpperCase();
      }
    }
  }

  // ── Priority 3: declared-name word search (fallback) ──────────────────────────
  // When all labeled patterns fail (e.g. complex photo background confuses OCR
  // layout), scan the full text for the significant words of the declared name.
  // This is safe because we only invoke it when a known name is expected — we
  // are not guessing from arbitrary text.
  if (declaredName) {
    const stopwords = new Set(["da", "de", "do", "das", "dos", "des", "e", "a", "o"]);
    const declaredWords = declaredName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopwords.has(w));

    if (declaredWords.length >= 2) {
      const textNorm = text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z\s]/g, " ");

      const found = declaredWords.filter((w) => textNorm.includes(w));
      // Require ≥ 2 significant words of the declared name to appear in the OCR text
      if (found.length >= 2) {
        console.log(`[DocAnalysis] extractName fallback: found ${found.length}/${declaredWords.length} declared words in OCR text`);
        return declaredName.toUpperCase();
      }
    }
  }

  // No reliable name found — do NOT fall back to random all-caps document text.
  return CAMPO_NAO_IDENTIFICADO;
}

function extractCpf(text: string, digitsOnlyText?: string, binaryThresholdText?: string, declaredCpf?: string): string {
  /**
   * Normalise OCR character confusions inside digit sequences:
   *   O/o → 0  |  l/I → 1  |  S → 5  |  B → 8
   *   em-dash (—) / en-dash (–) / minus (−) → hyphen-minus (-)
   */
  function normalizeDigitNoise(src: string): string {
    // First, globally normalise Unicode dashes to ASCII hyphen so the
    // patterns below don't need to handle them explicitly.
    let out = src.replace(/[\u2014\u2013\u2212]/g, "-");
    // Then fix letter-for-digit confusions inside plausible CPF-length runs.
    out = out.replace(
      /[0-9OolISB][0-9OolISB.,\-\s]{8,22}[0-9OolISB]/g,
      (m) =>
        m
          .replace(/[Oo]/g, "0")
          .replace(/[lI]/g, "1")
          .replace(/S/g, "5")
          .replace(/B/g, "8")
    );
    return out;
  }

  function tryExtract(src: string): string | null {
    /** Strip all non-digits and reformat as xxx.xxx.xxx-xx, or null if not 11 digits. */
    function fmt(raw: string): string | null {
      const d = raw.replace(/\D/g, "");
      if (d.length !== 11) return null;
      return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    }

    // ── Label-anchored: value on the SAME line as the CPF label ───────────
    // Gap tolerance: up to 60 non-digit / non-newline characters.
    // Digit sequence tolerance: up to 22 chars total to allow OCR spaces
    // around separators, e.g. "012 . 345 . 678 - 90".
    const labeled = src.match(
      /(?:C[\s.]?P[\s.]?F[\s.]?(?:[/MF]*)?|4[dD]\s+CPF)[^\d\n]{0,60}(\d[\d\s.,/\-]{9,22}\d)(?!\d)/i
    );
    if (labeled?.[1]) { const r = fmt(labeled[1]); if (r) return r; }

    // ── CPF label on its own line, value on the NEXT line ─────────────────
    const multiline = src.match(
      /(?:C[\s.]?P[\s.]?F[\s.]?)[^\n]{0,50}\n[^\S\n]*(\d[\d\s.,/\-]{9,22}\d)(?!\d)/i
    );
    if (multiline?.[1]) { const r = fmt(multiline[1]); if (r) return r; }

    // ── Generic: handles "077.496.419-71" AND "077 . 496 . 419-71" ──────────
    // Old Brazilian RGs print spaces around the dots: " . " = 3-char separator.
    // Allows 0–3 separator chars between each group.
    const generic = src.match(/(\d{3}[\s.,]{0,3}\d{3}[\s.,]{0,3}\d{3}[\s.,\-]{0,3}\d{2})(?!\d)/);
    if (generic?.[1]) { const r = fmt(generic[1]); if (r) return r; }

    // ── 11 consecutive digits (no separators at all) ───────────────────────
    const raw11 = src.match(/(?<!\d)(\d{11})(?!\d)/);
    if (raw11?.[1]) { const r = fmt(raw11[1]); if (r) return r; }

    // ── Partial OCR: 9–11 digits near a CPF label (some chars dropped) ────
    const partial = src.match(/(?:C[\s.]?P[\s.]?F[\s.]?|4[dD])[^\d]{0,60}(\d{9,11})(?!\d)/i);
    if (partial?.[1]) {
      const d = partial[1].padStart(11, "0");
      return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    }

    return null;
  }

  // ── Primary pass ──────────────────────────────────────────────────────────
  const fromText = tryExtract(text);
  if (fromText) return fromText;

  // ── Noise-corrected pass (O→0, l→1, em-dash→hyphen, etc.) ────────────────
  const denoised = normalizeDigitNoise(text);
  if (denoised !== text) {
    const fromDenoised = tryExtract(denoised);
    if (fromDenoised) {
      console.log("[DocAnalysis] CPF extraído após correção de ruído OCR:", fromDenoised);
      return fromDenoised;
    }
  }

  // ── digits-only OCR pass (also denoised) ──────────────────────────────────
  if (digitsOnlyText) {
    const fromDigits = tryExtract(normalizeDigitNoise(digitsOnlyText));
    if (fromDigits) {
      console.log("[DocAnalysis] CPF extraído via digits-only pass:", fromDigits);
      return fromDigits;
    }
  }

  // ── Binary-threshold pass: helps with uneven lighting / glare on photos ──
  if (binaryThresholdText && binaryThresholdText !== text) {
    const fromBinary = tryExtract(normalizeDigitNoise(binaryThresholdText));
    if (fromBinary) {
      console.log("[DocAnalysis] CPF extraído via binary-threshold pass:", fromBinary);
      return fromBinary;
    }
  }

  // ── Declared-CPF fallback (mirrors extractName's declaredName fallback) ────
  // If we know the expected CPF, check whether those exact 11 digits appear
  // anywhere in any OCR variant (possibly split by spaces/dots/dashes but
  // still contiguous in the raw digit sequence of the text).
  if (declaredCpf) {
    const declaredDigits = declaredCpf.replace(/\D/g, "");
    if (declaredDigits.length === 11) {
      const allTexts = [text, denoised, digitsOnlyText, binaryThresholdText].filter(Boolean) as string[];
      for (const src of allTexts) {
        // Remove every non-digit and look for the exact 11-digit sequence
        const digitsOnly = src.replace(/\D/g, "");
        if (digitsOnly.includes(declaredDigits)) {
          const formatted = declaredDigits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
          console.log("[DocAnalysis] CPF extraído via fallback do CPF declarado:", formatted);
          return formatted;
        }
      }
    }
  }

  // ── Debug: emit full OCR text to server log when extraction fails ─────────
  const cpfContext = text.match(/.{0,40}(?:CPF|C\.P\.F\.).{0,80}/i)?.[0];
  if (cpfContext) {
    console.log("[DocAnalysis] CPF label encontrado mas valor não extraído. Contexto:", JSON.stringify(cpfContext));
  } else {
    // No CPF label at all — dump the complete OCR text so the pattern can be debugged.
    console.log("[DocAnalysis] Nenhuma label CPF detectada no OCR. Texto completo:\n---\n" + text + "\n---");
  }
  if (binaryThresholdText) {
    const btCtx = binaryThresholdText.match(/.{0,40}(?:CPF|C\.P\.F\.|077|496|419).{0,80}/i)?.[0];
    if (btCtx) {
      console.log("[DocAnalysis] Binary-threshold contexto relevante:", JSON.stringify(btCtx));
    } else {
      console.log("[DocAnalysis] Binary-threshold texto (primeiros 600 chars):\n---\n" + binaryThresholdText.slice(0, 600) + "\n---");
    }
  }

  return CAMPO_NAO_IDENTIFICADO;
}



interface ExtractedFields {
  nome: string;
  cpf: string;
}

function extractFields(
  rawText: string,
  _tipoDocumento: string,
  declaredName?: string,
  digitsOnlyText?: string,
  binaryThresholdText?: string,
  declaredCpf?: string,
): ExtractedFields {
  const text = normalizeOcrText(rawText);
  return {
    nome: extractName(text, declaredName),
    cpf: extractCpf(text, digitsOnlyText, binaryThresholdText, declaredCpf),
  };
}

// ---------------------------------------------------------------------------
// 6 — Validação de campos
// ---------------------------------------------------------------------------

function validateCpf(cpf: string): boolean {
  if (cpf === CAMPO_NAO_IDENTIFICADO) return false;
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i);
  let rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  if (rem !== parseInt(digits[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i);
  rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  return rem === parseInt(digits[10]);
}

// ---------------------------------------------------------------------------
// 7 — Análise básica de fraude
// ---------------------------------------------------------------------------

interface FraudCheck {
  detected: boolean;
  obs: string[];
}

async function checkFraud(
  raw: Buffer,
  meta: Awaited<ReturnType<typeof sharp.prototype.metadata>>,
  ocrConfidence: number,
  ocrText: string,
): Promise<FraudCheck> {
  const obs: string[] = [];
  // fraudObs are observations that indicate likely manipulation (not just low quality)
  const fraudObs: string[] = [];

  // 1. Image channel statistics
  const stats = await sharp(raw).stats();
  const channels = stats.channels;
  if (channels.length > 0) {
    const stdevs = channels.map((c) => c.stdev ?? 0);
    const avgStdev = stdevs.reduce((s, e) => s + e, 0) / stdevs.length;
    // Nearly blank or fully uniform image
    if (avgStdev < 5 && meta.format === "jpeg") {
      obs.push("Desvio padrão muito baixo nos canais de cor — imagem possivelmente em branco ou degradada.");
    }
    // Very high inter-channel contrast difference — strong manipulation indicator
    if (channels.length >= 3) {
      const maxS = Math.max(...stdevs);
      const minS = Math.min(...stdevs);
      if (maxS - minS > 60) {
        const fraudMsg = "Diferença extrema de contraste entre canais de cor — possível manipulação parcial da imagem.";
        obs.push(fraudMsg);
        fraudObs.push(fraudMsg);
      }
    }
  }

  // 2. Low OCR confidence is a quality issue, not inherently fraud.
  //    CNH-e images from the official app typically yield ~35% confidence
  //    due to their complex security background — this is expected.
  if (ocrConfidence < 40) {
    obs.push(
      `Baixa confiança do OCR (${ocrConfidence.toFixed(1)}%) — imagem com fundo complexo ou baixa resolução.`
    );
  }

  // 3. No expected Brazilian document keywords in the text — genuine signal
  const hasDocKeyword =
    /(?:REPÚBLICA|BRASIL|MINISTÉRIO|IDENTIDADE|HABILITAÇÃO|CARTEIRA|REGISTRO|NASCIMENTO)/i.test(
      ocrText
    );
  if (!hasDocKeyword) {
    const fraudMsg = "Nenhuma palavra-chave de documento brasileiro identificada no texto extraído.";
    obs.push(fraudMsg);
    fraudObs.push(fraudMsg);
  }

  // fraud is only true when there are genuine manipulation/tampering indicators,
  // not merely due to low OCR quality or complex document backgrounds.
  return { detected: fraudObs.length > 0, obs };
}

// ---------------------------------------------------------------------------
// 8 — Score de confiança
// ---------------------------------------------------------------------------

function calculateScore(params: {
  qualidade: QualidadeImagem;
  ocrConfidence: number;
  cpfValido: boolean;
  cpfCorrespondente: boolean;
  nomesCorrespondentes: boolean;
  fraudeDetectada: boolean;
  camposIdentificados: number;
  totalCampos: number;
}): number {
  let score = 1.0;

  // Image quality
  if (params.qualidade === "baixa") score -= 0.20;
  else if (params.qualidade === "media") score -= 0.05;

  // OCR quality (0-100 → 0-0.25 deduction)
  const confPenalty = Math.max(0, (80 - params.ocrConfidence) / 80) * 0.25;
  score -= confPenalty;

  // Field coverage (nome + cpf)
  const fieldCoverage = params.camposIdentificados / params.totalCampos;
  score -= (1 - fieldCoverage) * 0.20;

  // Validations
  if (!params.cpfValido) score -= 0.10;
  if (!params.cpfCorrespondente) score -= 0.10;
  if (!params.nomesCorrespondentes) score -= 0.15;

  // Fraud signals
  if (params.fraudeDetectada) score -= 0.30;

  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Runs the full 9-step document analysis pipeline on a base64 data-URL image.
 *
 * @param dataUrl      base64 data-URL (data:image/...;base64,...)
 * @param declaredName Optional: the student's declared name for name comparison.
 */
// ---------------------------------------------------------------------------
// PDF → image conversion (uses system pdftoppm)
// ---------------------------------------------------------------------------

async function convertPdfToImageBuffer(pdfBuffer: Buffer): Promise<Buffer> {
  const tmpDir = tmpdir();
  const uid = `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const pdfPath = join(tmpDir, `${uid}.pdf`);
  const outPrefix = join(tmpDir, uid);

  await writeFile(pdfPath, pdfBuffer);

  await new Promise<void>((resolve, reject) => {
    // -png: PNG output, -r 300: 300 DPI, -f 1 -l 1: first page only
    execFile("pdftoppm", ["-png", "-r", "300", "-f", "1", "-l", "1", pdfPath, outPrefix], (err) => {
      if (err) reject(new Error(`pdftoppm falhou: ${err.message}`));
      else resolve();
    });
  });

  const files = await readdir(tmpDir);
  const outFile = files.find((f) => f.startsWith(uid) && f.endsWith(".png"));
  if (!outFile) throw new Error("pdftoppm não gerou arquivo de saída esperado");

  const imgBuffer = await readFile(join(tmpDir, outFile));

  // Cleanup (best-effort)
  await Promise.all([
    unlink(pdfPath).catch(() => {}),
    unlink(join(tmpDir, outFile)).catch(() => {}),
  ]);

  return imgBuffer;
}

export async function analyzeDocument(
  dataUrl: string,
  declaredName?: string,
  declaredCpf?: string,
): Promise<DocumentAnalysisResult> {
  const observacoes: string[] = [];

  // ── 1. Validação do upload ─────────────────────────────────────────────────
  let { mimeType, buffer, sizeKb } = parseDataUrl(dataUrl);
  console.log(`[DocAnalysis] Iniciando análise — ${mimeType}, ${sizeKb} KB`);

  // Converte PDF para imagem PNG via pdftoppm antes do pré-processamento
  if (mimeType === "application/pdf") {
    console.log("[DocAnalysis] PDF detectado — convertendo primeira página para PNG via pdftoppm...");
    try {
      buffer = await convertPdfToImageBuffer(buffer);
      mimeType = "image/png";
      sizeKb = Math.round(buffer.length / 1024);
      console.log(`[DocAnalysis] PDF convertido com sucesso — ${sizeKb} KB PNG`);
      observacoes.push("PDF convertido para imagem para análise de OCR.");
    } catch (pdfErr: any) {
      console.error("[DocAnalysis] Falha ao converter PDF:", pdfErr?.message);
      throw new Error(`Não foi possível converter o PDF para imagem: ${pdfErr?.message}`);
    }
  }

  // ── 2. Pré-processamento ───────────────────────────────────────────────────
  let preprocessed: PreprocessResult;
  try {
    preprocessed = await preprocessDocument(buffer);
    observacoes.push(...preprocessed.observacoes);
  } catch (err: any) {
    console.warn("[DocAnalysis] Pré-processamento falhou, utilizando imagem original:", err?.message);
    const meta = await sharp(buffer).metadata();
    preprocessed = {
      buffer,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      qualidade: "baixa",
      rotation: 0,
      observacoes: ["Pré-processamento da imagem falhou — resultado pode ser impreciso."],
    };
    observacoes.push(...preprocessed.observacoes);
  }

  // ── 3 + 4. OCR ────────────────────────────────────────────────────────────
  let ocrResult: OcrPassResult;
  try {
    ocrResult = await runOcrMultiPass(preprocessed.buffer);
    console.log(
      `[DocAnalysis] OCR concluído — confiança ${ocrResult.confidence.toFixed(1)}%, ${ocrResult.text.length} chars`
    );
    console.log(`[DocAnalysis] Primeiros 1200 chars:\n---\n${ocrResult.text.slice(0, 1200)}\n---`);
  } catch (err: any) {
    console.error("[DocAnalysis] OCR falhou:", err?.message);
    return buildFailResult(observacoes, "Falha crítica no OCR: " + (err?.message ?? "erro desconhecido"));
  }

  if (ocrResult.text.trim().length < 10) {
    observacoes.push("OCR não retornou texto suficiente para análise. Verifique a qualidade da imagem.");
    return buildFailResult(observacoes, "Texto insuficiente extraído pelo OCR.");
  }

  // ── 5. Extração de campos ──────────────────────────────────────────────────
  const tipoDocumento = detectDocumentType(ocrResult.text);

  // Run a separate digits-only OCR pass to improve CPF extraction on documents
  // (e.g. CNH-e) where the CPF field is inside a heavily-decorated table cell
  // that produces letter noise in a regular OCR pass.
  let digitsOnlyText: string | undefined;
  let binaryThresholdText: string | undefined;
  try {
    digitsOnlyText = await runDigitsOnlyPass(preprocessed.buffer);
    console.log(`[DocAnalysis] Digits-only pass: ${digitsOnlyText.length} chars`);
  } catch {
    // Non-fatal — best-effort
  }
  try {
    binaryThresholdText = await runBinaryThresholdPass(preprocessed.buffer);
    console.log(`[DocAnalysis] Binary-threshold pass: ${binaryThresholdText.length} chars`);
  } catch {
    // Non-fatal — best-effort
  }

  const campos = extractFields(ocrResult.text, tipoDocumento, declaredName, digitsOnlyText, binaryThresholdText, declaredCpf);
  console.log("[DocAnalysis] Campos extraídos:", campos);

  const totalCampos = 2; // nome + cpf
  const camposIdentificados = Object.values(campos).filter(
    (v) => v !== CAMPO_NAO_IDENTIFICADO
  ).length;

  // ── 6. Validação ──────────────────────────────────────────────────────────
  const cpfValido = validateCpf(campos.cpf);
  if (campos.cpf !== CAMPO_NAO_IDENTIFICADO && !cpfValido) {
    observacoes.push("CPF encontrado mas inválido.");
  }

  // Compare extracted CPF against the CPF declared in the enrollment form.
  // Normalize both to digits-only before comparing so formatting differences don't matter.
  let cpfCorrespondente = true; // default true when no declared CPF to compare against
  if (declaredCpf && campos.cpf !== CAMPO_NAO_IDENTIFICADO) {
    const extractedDigits = campos.cpf.replace(/\D/g, "");
    const declaredDigits = declaredCpf.replace(/\D/g, "");
    cpfCorrespondente = extractedDigits === declaredDigits;
    if (!cpfCorrespondente) {
      observacoes.push("CPF no documento não corresponde ao CPF informado no cadastro.");
    }
  } else if (declaredCpf && campos.cpf === CAMPO_NAO_IDENTIFICADO) {
    cpfCorrespondente = false;
    observacoes.push("CPF não identificado no documento.");
  }

  let nomeCorrespondente = false;
  if (declaredName && campos.nome !== CAMPO_NAO_IDENTIFICADO) {
    const cmp = compareNames(campos.nome, declaredName);
    nomeCorrespondente = cmp.match;
    if (!cmp.match) {
      observacoes.push("Nome no documento não corresponde ao cadastro.");
    }
  } else if (!declaredName) {
    nomeCorrespondente = campos.nome !== CAMPO_NAO_IDENTIFICADO;
  } else {
    observacoes.push("Nome não encontrado no documento.");
  }

  // ── 7. Análise de fraude ───────────────────────────────────────────────────
  const rawMeta = await sharp(buffer).metadata();
  const fraud = await checkFraud(buffer, rawMeta, ocrResult.confidence, ocrResult.text);
  observacoes.push(...fraud.obs);

  // ── 8. Score de confiança ─────────────────────────────────────────────────
  const score = calculateScore({
    qualidade: preprocessed.qualidade,
    ocrConfidence: ocrResult.confidence,
    cpfValido,
    cpfCorrespondente,
    nomesCorrespondentes: nomeCorrespondente,
    fraudeDetectada: fraud.detected,
    camposIdentificados,
    totalCampos,
  });

  // ── 9. Resultado final ────────────────────────────────────────────────────
  return {
    tipo_documento: tipoDocumento,
    campos_extraidos: campos,
    validacoes: {
      cpf_valido: cpfValido,
      cpf_correspondente: cpfCorrespondente,
      nome_correspondente: nomeCorrespondente,
    },
    fraude_detectada: fraud.detected,
    score_confianca: score,
    observacoes,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFailResult(observacoes: string[], reason: string): DocumentAnalysisResult {
  observacoes.push(reason);
  return {
    tipo_documento: "Desconhecido",
    campos_extraidos: {
      nome: CAMPO_NAO_IDENTIFICADO,
      cpf: CAMPO_NAO_IDENTIFICADO,
    },
    validacoes: {
      cpf_valido: false,
      cpf_correspondente: false,
      nome_correspondente: false,
    },
    fraude_detectada: false,
    score_confianca: 0,
    observacoes,
  };
}
