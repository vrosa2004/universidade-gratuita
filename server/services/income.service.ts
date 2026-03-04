/**
 * Income Service
 *
 * Em vez de somar todos os valores do documento (o que causaria valores
 * discrepantes num holerite que lista bruto + descontos + líquido), a lógica
 * usa **prioridade contextual**:
 *
 *   P1 → líquido / total a receber  (renda que a pessoa de fato recebe)
 *   P2 → bruto / salário / vencimento (renda bruta declarada)
 *   P3 → qualquer valor monetário sem contexto claro
 *
 * O valor final é o MAIOR candidato da prioridade mais alta encontrada.
 * Para múltiplas fontes de renda num mesmo documento (ex: extrato INSS com
 * vários benefícios), os valores P1 são SOMADOS entre si.
 */

// Centralizados em shared/schema — re-exportados para retrocompatibilidade
import { SALARIO_MINIMO, LIMITE_MULTIPLICADOR } from "../../shared/schema.js";
export { SALARIO_MINIMO, LIMITE_MULTIPLICADOR } from "../../shared/schema.js";

// ── Public types ──────────────────────────────────────────────────────────────

export type OcrIncomeStatus = "APROVADO" | "REPROVADO" | "REVISAO_MANUAL";

/** Candidate value found in OCR text */
export interface ValueCandidate {
  value: number;
  /** Excerpt of text that generated this match */
  label: string;
  /** 1 = líquido/receber (highest), 2 = bruto/salário, 3 = genérico */
  priority: 1 | 2 | 3;
}

export interface OcrIncomeResult {
  rendaTotal: number;
  rendaPerCapita: number;
  limitePermitido: number;
  status: OcrIncomeStatus;
  observacao: string;
  /** Only when status === 'REVISAO_MANUAL' */
  motivo?: string;
  /** Raw values found before priority selection */
  valoresEncontrados: number[];
  /** Value actually used as income, with its label */
  valorSelecionado?: { value: number; label: string; priority: number };
}

// ── Priority keyword tables ───────────────────────────────────────────────────

// P1: net pay — what the person actually receives
const P1_KEYWORDS =
  /(?:l[ií]quido|total\s+a\s+receber|total\s+l[ií]quido|valor\s+a\s+receber|pagamento\s+l[ií]quido|sal[aá]rio\s+l[ií]quido|rend[ai]mentos?\s+l[ií]quidos?)/i;

// P2: gross pay / declared income
const P2_KEYWORDS =
  /(?:sal[aá]rio(?:\s+base)?|sal[aá]rio\s+bruto|vencimento(?:s)?|total\s+de\s+proventos|proventos|renda\s+bruta|total\s+bruto|base\s+de\s+c[aá]lculo|remunera[cç][aã]o|total\s+geral|compet[eê]ncia|bruto)/i;

// Keywords that indicate additional earnings to be summed with base salary
const EARNINGS_KEYWORDS =
  /(?:comiss[aã]o|gratifica[cç][aã]o|hora\s+extra|adicional|bonus|b[oô]nus|insalubridade|periculosidade|abono|aux[ií]lio)/i;

// Keywords whose values are DISCOUNTS — must not be counted as income
const DISCOUNT_KEYWORDS =
  /(?:desconto|inss|irrf|ir\b|fgts|plano\s+de\s+sa[úu]de|vale\s+transporte|vale\s+refei[cç][aã]o|faltas?|adiantamento|contribui[cç][aã]o)/i;

// ── Monetary value regex ──────────────────────────────────────────────────────
//
// Valid Brazilian monetary value MUST end in ,NN (decimal comma + 2 digits).
// This rejects OCR artifacts like "275000", "22000" that lack a decimal separator.
//
// Two alternatives:
//   Alt 1 — properly formatted: 1.234,56 / 12.345,67  (with thousands dots)
//   Alt 2 — OCR missing thousands dot: 2500,00 / 12500,00  (4+ raw digits + comma)
//
// The R$/RS prefix (and the entire prefix group) is OPTIONAL — many holerites
// list values without currency symbols in the value columns.
//
const MONEY_RE =
  /(?:R[$S§|]\s{0,3})?(\d{1,3}(?:\.\d{3})*,\d{2}|\d{4,},\d{2})/g;

// ── Main extraction ───────────────────────────────────────────────────────────

/**
 * Extract structured monetary candidates from OCR text.
 *
 * Holerite rows typically contain TWO monetary values per line:
 *   [code] [description] [reference/hours] [VALUE]  [E/D]
 *   e.g.:  001 SALARIO BASE  220,00  2.500,00  E
 *
 * The LAST monetary value in a line is the actual payment amount;
 * earlier values are reference (hours, percentage, days).
 * If only ONE value exists in the line, it is the payment amount.
 *
 * Lines flagged as discounts (INSS, IRRF, etc.) are skipped.
 */
export function extractValueCandidates(text: string): ValueCandidate[] {
  const norm = text
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/ {2,}/g, " ");

  console.log("[Income] Texto (primeiros 600):", norm.slice(0, 600));

  const candidates: ValueCandidate[] = [];

  const lines = norm.split("\n");
  for (const line of lines) {
    // Skip discount lines entirely
    if (DISCOUNT_KEYWORDS.test(line)) {
      console.log(`[Income] SKIP desconto: "${line.trim().slice(0, 60)}"`);
      continue;
    }

    // Collect ALL monetary values on this line
    const lineMatches: number[] = [];
    MONEY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MONEY_RE.exec(line)) !== null) {
      const val = parseBrazilianNumber(m[1]);
      // Reject nulls, values below R$ 100 and above R$ 200k (not a salary)
      if (val === null || val < 100 || val > 200_000) continue;
      lineMatches.push(val);
    }

    if (lineMatches.length === 0) continue;

    // In a holerite row the LAST value is the payment; earlier = reference (hours/%)
    const paymentValue = lineMatches[lineMatches.length - 1];

    const priority: 1 | 2 | 3 = P1_KEYWORDS.test(line) ? 1
      : (P2_KEYWORDS.test(line) || EARNINGS_KEYWORDS.test(line)) ? 2
      : 3;
    const label = line.trim().slice(0, 80);

    console.log(
      `[Income] P${priority} → R$ ${paymentValue}` +
      (lineMatches.length > 1 ? ` (ref ignorada: ${lineMatches.slice(0, -1).join(", ")})` : "") +
      ` | "${label}"`
    );

    candidates.push({ value: paymentValue, label, priority });
  }

  return candidates;
}

/**
 * For backward-compat: returns a flat number[] (all unique values).
 */
export function extractMoneyValues(text: string): number[] {
  const candidates = extractValueCandidates(text);
  const seen = new Set<string>();
  return candidates
    .map((c) => c.value)
    .filter((v) => {
      const k = v.toFixed(2);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

// ── Income calculation ────────────────────────────────────────────────────────

export function calculateIncomeResult(
  input: number[] | ValueCandidate[],
  householdSize: number
): OcrIncomeResult {
  const limitePermitido = round2(SALARIO_MINIMO * LIMITE_MULTIPLICADOR);

  if (input.length === 0) {
    return {
      rendaTotal: 0,
      rendaPerCapita: 0,
      limitePermitido,
      status: "REVISAO_MANUAL",
      observacao: "Nenhum valor monetário identificado no documento.",
      motivo:
        "Reenvie o arquivo com melhor qualidade ou tente uma digitalização mais nítida.",
      valoresEncontrados: [],
    };
  }

  // Normalise input to ValueCandidate[]
  let candidates: ValueCandidate[];
  if (typeof input[0] === "number") {
    candidates = (input as number[]).map((v) => ({
      value: v,
      label: "valor genérico",
      priority: 3 as const,
    }));
  } else {
    candidates = input as ValueCandidate[];
  }

  // ── De-duplicate within each priority group ───────────────────────────────
  const dedupGroup = (group: ValueCandidate[]) => {
    const seen = new Set<string>();
    return group.filter((c) => {
      const k = c.value.toFixed(2);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const p1 = dedupGroup(candidates.filter((c) => c.priority === 1));
  const p2 = dedupGroup(candidates.filter((c) => c.priority === 2));
  const p3 = dedupGroup(candidates.filter((c) => c.priority === 3));

  console.log("[Income] P1:", p1.map((c) => c.value));
  console.log("[Income] P2:", p2.map((c) => c.value));
  console.log("[Income] P3:", p3.map((c) => c.value));

  let rendaTotal: number;
  let valorSelecionado: { value: number; label: string; priority: number };

  if (p1.length > 0) {
    // Multiple P1 = multiple pay sources → SUM (e.g. two jobs, both líquido)
    rendaTotal = round2(p1.reduce((s, c) => s + c.value, 0));
    const best = p1.reduce((a, b) => (a.value > b.value ? a : b));
    valorSelecionado = {
      value: rendaTotal,
      label: p1.length > 1 ? `${p1.length} fontes líquidas somadas` : best.label,
      priority: 1,
    };
    console.log(`[Income] Usando P1 (líquido) → R$ ${rendaTotal}`);
  } else if (p2.length > 0) {
    // Check if any P2 value comes from a "total" line
    // (e.g. "Total Bruto", "Total de Proventos") — that already sums everything.
    // If a total line exists, use its value to avoid double-counting individual lines.
    const TOTAL_LINE = /total/i;
    const totalLine = p2.find((c) => TOTAL_LINE.test(c.label));
    if (totalLine) {
      rendaTotal = totalLine.value;
      valorSelecionado = { value: rendaTotal, label: totalLine.label, priority: 2 };
      console.log(`[Income] Usando P2 linha-total → R$ ${rendaTotal}`);
    } else {
      // No total row: SUM all earnings (salário base + comissão + adicionais etc.)
      rendaTotal = round2(p2.reduce((s, c) => s + c.value, 0));
      const best = p2.reduce((a, b) => (a.value > b.value ? a : b));
      valorSelecionado = {
        value: rendaTotal,
        label: p2.length > 1 ? `${p2.length} proventos somados (sem total)` : best.label,
        priority: 2,
      };
      console.log(`[Income] Usando P2 soma (${p2.length} linhas) → R$ ${rendaTotal}`);
    }
  } else {
    // Fallback: highest generic value
    const best = p3.reduce((a, b) => (a.value > b.value ? a : b));
    rendaTotal = best.value;
    valorSelecionado = { value: rendaTotal, label: best.label, priority: 3 };
    console.log(`[Income] Usando P3 (genérico) → R$ ${rendaTotal}`);
  }

  const size = householdSize > 0 ? householdSize : 1;
  const rendaPerCapita = round2(rendaTotal / size);
  const aprovado = rendaTotal <= limitePermitido;

  const allValues = dedupGroup(candidates).map((c) => c.value);

  return {
    rendaTotal,
    rendaPerCapita,
    limitePermitido,
    status: aprovado ? "APROVADO" : "REPROVADO",
    observacao: `Renda extraída via OCR. Limite: R$ ${limitePermitido.toLocaleString("pt-BR")} (${LIMITE_MULTIPLICADOR}× salário mínimo).`,
    valoresEncontrados: allValues,
    valorSelecionado,
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function parseBrazilianNumber(raw: string): number | null {
  const trimmed = raw.trim();

  let normalised: string;
  if (/,\d{2}$/.test(trimmed)) {
    // 1.234,56 → remove dots, comma → dot
    normalised = trimmed.replace(/\./g, "").replace(",", ".");
  } else if (/\.\d{2}$/.test(trimmed)) {
    // US-style 1,234.56 → remove commas
    normalised = trimmed.replace(/,/g, "");
  } else {
    // integer-like
    normalised = trimmed.replace(/[.,]/g, "");
  }

  const val = parseFloat(normalised);
  return isNaN(val) ? null : val;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
