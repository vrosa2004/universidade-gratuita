/**
 * Name Service
 *
 * Provides name normalization and comparison utilities used by the
 * document-analysis pipeline to match the name extracted via OCR against
 * the name declared by the student in the enrollment form.
 */

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Strips accents, converts to lowercase, collapses whitespace and removes
 * any character that is not a letter or space (useful for OCR noise).
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')          // keep only letters + spaces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits a normalized name into words, filtering out common noise tokens
 * that appear in OCR output of Brazilian IDs (e.g. single-char remnants).
 */
function nameWords(normalized: string): string[] {
  return normalized.split(' ').filter((w) => w.length > 1);
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface NameComparisonResult {
  /** True when similarity >= threshold (default 0.6) */
  match: boolean;
  /** 0-1 Jaccard overlap between word sets */
  similarity: number;
  /** Words present in extracted name but not in declared name */
  extraWords: string[];
  /** Words present in declared name but not in extracted name */
  missingWords: string[];
}

/**
 * Compares two names using word-set intersection (Jaccard similarity).
 * Case-insensitive, accent-insensitive.
 * Common Portuguese prepositions (da, de, do, das, dos, e) are excluded from
 * both word sets since OCR frequently drops or merges them, making them an
 * unreliable signal.
 * Additionally, if every significant word in the extracted name appears in the
 * declared name (subset match), it counts as a match regardless of Jaccard
 * score — this handles OCR truncation where only some words were read.
 *
 * @param extracted  Name as returned by OCR.
 * @param declared   Name as declared by the student in the enrollment form.
 * @param threshold  Minimum Jaccard similarity (default 0.55).
 */
export function compareNames(
  extracted: string,
  declared: string,
  threshold = 0.55,
): NameComparisonResult {
  const STOPWORDS = new Set(["da", "de", "do", "das", "dos", "des", "e", "a", "o"]);

  const significantWords = (normalized: string) =>
    nameWords(normalized).filter((w) => !STOPWORDS.has(w));

  const wordsA = new Set(significantWords(normalizeName(extracted)));
  const wordsB = new Set(significantWords(normalizeName(declared)));

  // Two words are considered equal if:
  //   a. exact string match, OR
  //   b. one is a substring of the other with ≥ 4 chars
  //      ("rosa" inside "darosa", "rodrigue" inside "rodrigues")
  const softMatch = (a: string, b: string): boolean => {
    if (a === b) return true;
    if (a.length < 4 || b.length < 4) return false;
    return a.includes(b) || b.includes(a);
  };

  const softIntersection = [...wordsA].filter((a) => [...wordsB].some((b) => softMatch(a, b)));
  // Union size counts each unique word once; use exact word counts to keep Jaccard meaningful.
  const union = new Set([...wordsA, ...wordsB]);
  const similarity = union.size === 0 ? 0 : softIntersection.length / union.size;

  // Subset match: if all significant extracted words soft-match a declared word,
  // accept as a match — covers OCR truncation and partial reads.
  const subsetMatch =
    wordsA.size >= 2 && [...wordsA].every((a) => [...wordsB].some((b) => softMatch(a, b)));

  const extraWords   = [...wordsA].filter((a) => ![...wordsB].some((b) => softMatch(a, b)));
  const missingWords = [...wordsB].filter((b) => ![...wordsA].some((a) => softMatch(a, b)));

  return {
    match: similarity >= threshold || subsetMatch,
    similarity: Math.round(similarity * 1000) / 1000,
    extraWords,
    missingWords,
  };
}
