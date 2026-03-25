export interface AddressValidationResult {
  enderecoExtraido: string;
  enderecoNormalizadoDeclarado: string;
  enderecoNormalizadoExtraido: string;
  scoreCorrespondencia: number;
  corresponde: boolean;
}

function isLikelySameHouseNumber(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length !== b.length) return false;
  if (a.length < 2 || a.length > 6) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diff += 1;
    if (diff > 1) return false;
  }
  return diff === 1;
}

function isLikelyGarbageLine(line: string): boolean {
  const compact = line.replace(/\s+/g, "");
  if (compact.length < 20) return false;

  const longBase64Like = /[A-Za-z0-9+/=]{120,}/.test(compact);
  const hasFewSpaces = (line.match(/\s/g)?.length ?? 0) <= 1;
  const alphaNumRatio = (compact.match(/[A-Za-z0-9]/g)?.length ?? 0) / compact.length;

  return longBase64Like || (hasFewSpaces && alphaNumRatio > 0.9 && compact.length > 80);
}

const STOPWORDS = new Set([
  "RUA", "R", "AV", "AVENIDA", "TRAVESSA", "TV", "ESTRADA", "RODOVIA", "ALAMEDA", "PRACA", "PRAÇA",
  "NUM", "NUMERO", "N", "NO", "NRO", "BAIRRO", "CEP", "BRASIL", "UF", "AP", "APTO", "BLOCO", "CASA",
  "LOTE", "QD", "QUADRA", "KM", "SN", "S", "N",
]);

function normalizeAddress(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeAddress(value: string): string[] {
  return normalizeAddress(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function normalizeTokenForOcr(token: string): string {
  return token
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/5/g, "S")
    .replace(/8/g, "B");
}

function tokensFuzzyOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let matches = 0;

  const bNorm = b.map((token) => normalizeTokenForOcr(token));
  for (const tokenRaw of a) {
    const token = normalizeTokenForOcr(tokenRaw);
    const found = bNorm.some((other) => {
      if (token === other) return true;
      if (token.length >= 5 && other.length >= 5) {
        return token.startsWith(other.slice(0, 4)) || other.startsWith(token.slice(0, 4));
      }
      return false;
    });
    if (found) matches += 1;
  }

  return matches;
}

function hasLongTokenMatch(declaredTokens: string[], extractedTokens: string[]): boolean {
  if (declaredTokens.length === 0 || extractedTokens.length === 0) return false;
  const extractedNormalized = extractedTokens.map((token) => normalizeTokenForOcr(token));
  return declaredTokens.some((tokenRaw) => {
    const token = normalizeTokenForOcr(tokenRaw);
    if (token.length < 6) return false;
    return extractedNormalized.some((other) => {
      if (token === other) return true;
      return token.startsWith(other.slice(0, 5)) || other.startsWith(token.slice(0, 5));
    });
  });
}

export function extractAddressFromText(text: string): string {
  const addresses = extractAddressesFromText(text);
  return addresses.length > 0 ? addresses[0] : "campo_nao_identificado";
}

/**
 * Extrai múltiplos endereços candidatos do texto (até 5 melhores candidatos)
 */
export function extractAddressesFromText(text: string): string[] {
  const cleanText = text
    .replace(/\0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, " ");

  const rawLines = cleanText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 6)
    .filter((line) => !isLikelyGarbageLine(line));

  const inlineAddressRegex = /\b(RUA|R\.|R\b|AVENIDA|AV\.|AV\b|TRAVESSA|TV\.|TV\b|ESTRADA|RODOVIA|ALAMEDA|PRACA|PRAÇA|LARGO|VILA|SITIO|SÍTIO|CAMINHO|PASSAGEM|BECO|PATIO|PÁTIO|TRAV\.?|PRAIA)\b[^\n]{6,180}/gi;
  const inlineMatches = Array.from(cleanText.matchAll(inlineAddressRegex))
    .map((m) => (m[0] ?? "").trim())
    .filter((line) => line.length >= 10 && !isLikelyGarbageLine(line));

  const mergedLineMatches: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const current = rawLines[i] ?? "";
    const next = rawLines[i + 1] ?? "";
    if (/\b(RUA|R\.|R\b|AVENIDA|AV\.|AV\b|TRAVESSA|TV\.|TV\b|ESTRADA|RODOVIA|ALAMEDA|PRACA|PRAÇA|LARGO|VILA|SITIO|SÍTIO|CAMINHO|PASSAGEM|BECO|PATIO|PÁTIO|TRAV\.?|PRAIA)\b/i.test(current)) {
      const merged = `${current} ${next}`.replace(/\s+/g, " ").trim();
      if (merged.length >= 10 && merged.length <= 220) {
        mergedLineMatches.push(merged);
      }
    }
  }

  const slidingWindowMatches: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const l1 = rawLines[i] ?? "";
    const l2 = rawLines[i + 1] ?? "";
    const l3 = rawLines[i + 2] ?? "";
    const merged = `${l1} ${l2} ${l3}`.replace(/\s+/g, " ").trim();
    if (merged.length < 16 || merged.length > 260) continue;

    const hasStreetType = /\b(RUA|R\.|R\b|AVENIDA|AV\.|AV\b|TRAVESSA|TV\.|TV\b|ESTRADA|RODOVIA|ALAMEDA|PRACA|PRAÇA|LARGO|VILA|SITIO|SÍTIO|CAMINHO|PASSAGEM|BECO|PATIO|PÁTIO|TRAV\.?|PRAIA)\b/i.test(merged);
    const hasAddressClue = /(\d|CEP|ENDERECO|ENDEREÇO|BAIRRO|CIDADE|MUNICIPIO|MUNICÍPIO|SC|SANTA CATARINA|BRUSQUE)/i.test(merged);
    if (hasStreetType || hasAddressClue) {
      slidingWindowMatches.push(merged);
    }
  }

  const candidatesPool = [...rawLines, ...inlineMatches, ...mergedLineMatches, ...slidingWindowMatches];

  // Padrões exaustivos de palavras-chave de tipo de logradouro
  const typeKeywordRegex = /\b(RUA|R\.|R\b|AVENIDA|AV\.|AV\b|TRAVESSA|TV\.|TV\b|ESTRADA|RODOVIA|ALAMEDA|PRACA|PRAÇA|LARGO|LARGO|VILA|SITIO|SÍTIO|VALE|SERPA|SERRADA|SERRA|MONTE|MORRO|CAMINHO|PASSAGEM|BECO|PATIO|PÁTIO|TRAV\.?|TRAD\.?|PRAIA|ENCRUZILHADA)\b/i;
  
  // Caracteres que indicam endereço mal formatado
  const addressMarkerRegex = /(\d+|CEP|LOCALIZ|PROP|USUARIO|USUÁRIO|ENDERECO|ENDEREÇO|RES\.|RESID|LOCA|LOC|MUN|MUNICIPIO|MUNICÍPIO|BAIRRO|CIDADE)/i;

  const scored = candidatesPool
    .map((line) => {
      let score = 0;
      const normalizedLine = normalizeAddress(line);
      const lineTokens = tokenizeAddress(line);
      
      // Tipo de logradouro = +5
      if (typeKeywordRegex.test(line)) score += 5;
      
      // Número = +3
      if (/\d/.test(line)) score += 3;

      // Linha com conteúdo textual relevante de endereço (+2)
      if (lineTokens.length >= 2) score += 2;

      // Possui separadores típicos de endereço (+1)
      if (/[,\-\/]/.test(line)) score += 1;
      
      // Marcadores de endereço = +2
      if (addressMarkerRegex.test(line)) score += 2;
      
      // Comprimento razoável = +1 (20-150 chars)
      if (line.length >= 20 && line.length <= 150) score += 1;

      // Cidade/UF/CEP costuma aparecer em comprovantes (+1)
      if (/\b(CEP|SC|SANTA CATARINA|BRUSQUE|CIDADE|MUNICIPIO|MUNICIPIO)\b/i.test(normalizedLine)) score += 1;
      
      // Se tem poucas palavras (2-4), é provavelmente só um label = -5
      const wordCount = line.split(/\s+/).length;
      if (wordCount < 2 || wordCount > 20) score -= 3;

      // Linha muito curta sem tipo/número tende a ser ruído
      if (line.length < 12 && !typeKeywordRegex.test(line) && !/\d/.test(line)) score -= 2;
      
      return { line, score };
    })
    .sort((a, b) => b.score - a.score);

  // Retorna os 20 melhores candidatos (score >= 1)
  const candidates: string[] = [];
  for (let i = 0; i < Math.min(20, scored.length); i++) {
    const candidate = scored[i];
    if (candidate && candidate.score >= 1) {
      const compact = candidate.line.replace(/\s+/g, " ").trim();
      if (compact.length >= 6 && !candidates.includes(compact)) {
        candidates.push(compact);
      }
    }
  }

  return candidates;
}

/**
 * Tenta encontrar o endereço extraído que melhor corresponde ao endereço declarado.
 * Testa cada candidato e retorna o primeiro que tem correspondência >= 0.5 ou o melhor score.
 */
export function findBestMatchingAddress(
  enderecoDeclarado: string,
  enderecos: string[]
): AddressValidationResult | null {
  if (!enderecoDeclarado || enderecos.length === 0) {
    return null;
  }

  // Testa cada endereço extraído contra o endereço declarado
  const results = enderecos
    .map((endereco) => validateDeclaredAddress(enderecoDeclarado, endereco))
    .sort((a, b) => b.scoreCorrespondencia - a.scoreCorrespondencia);

  // Retorna o primeiro que corresponde ou o com melhor score
  if (results.length > 0) {
    // Prioriza correspondências exatas (score >= 0.5)
    const goodMatch = results.find((r) => r.corresponde || r.scoreCorrespondencia >= 0.5);
    if (goodMatch) return goodMatch;

    // Fallback: alguns OCRs quebram o endereço em linhas diferentes.
    // Combina os melhores candidatos e testa novamente.
    const combined = enderecos.slice(0, 10).join(" ").replace(/\s+/g, " ").trim();
    if (combined.length > 0) {
      const combinedResult = validateDeclaredAddress(enderecoDeclarado, combined);
      if (combinedResult.corresponde || combinedResult.scoreCorrespondencia >= 0.5) {
        return combinedResult;
      }
    }

    return results[0];
  }

  return null;
}

export function validateDeclaredAddress(
  enderecoDeclarado: string,
  enderecoExtraido: string,
): AddressValidationResult {
  const declaredNorm = normalizeAddress(enderecoDeclarado);
  const extractedNorm = normalizeAddress(enderecoExtraido);

  if (!declaredNorm || !extractedNorm) {
    return {
      enderecoExtraido,
      enderecoNormalizadoDeclarado: declaredNorm,
      enderecoNormalizadoExtraido: extractedNorm,
      scoreCorrespondencia: 0,
      corresponde: false,
    };
  }

  if (declaredNorm.includes(extractedNorm) || extractedNorm.includes(declaredNorm)) {
    return {
      enderecoExtraido,
      enderecoNormalizadoDeclarado: declaredNorm,
      enderecoNormalizadoExtraido: extractedNorm,
      scoreCorrespondencia: 1,
      corresponde: true,
    };
  }

  const declaredTokens = tokenizeAddress(enderecoDeclarado);
  const extractedTokens = tokenizeAddress(enderecoExtraido);

  if (declaredTokens.length === 0 || extractedTokens.length === 0) {
    return {
      enderecoExtraido,
      enderecoNormalizadoDeclarado: declaredNorm,
      enderecoNormalizadoExtraido: extractedNorm,
      scoreCorrespondencia: 0,
      corresponde: false,
    };
  }

  const exactOverlap = declaredTokens.filter((token) => extractedTokens.includes(token)).length;
  const fuzzyOverlap = tokensFuzzyOverlap(declaredTokens, extractedTokens);
  const overlapCount = Math.max(exactOverlap, fuzzyOverlap);
  const declaredCoverage = overlapCount / declaredTokens.length;
  const extractedCoverage = overlapCount / extractedTokens.length;
  const score = declaredCoverage;

  const declaredNumbers = (declaredNorm.match(/\b\d{1,6}\b/g) ?? []).filter((n) => n.length <= 6);
  const extractedNumbers = (extractedNorm.match(/\b\d{1,6}\b/g) ?? []).filter((n) => n.length <= 6);
  const extractedNumbersSet = new Set(extractedNumbers);
  const hasExactNumberMatch = declaredNumbers.some((n) => extractedNumbersSet.has(n));
  const hasFuzzyNumberMatch = declaredNumbers.some((declaredNum) =>
    extractedNumbers.some((extractedNum) => isLikelySameHouseNumber(declaredNum, extractedNum))
  );
  const hasNumberMatch = hasExactNumberMatch || hasFuzzyNumberMatch;
  const hasStrongTokenMatch = hasLongTokenMatch(declaredTokens, extractedTokens);

  const corresponde =
    (overlapCount >= 2 && declaredCoverage >= 0.5) ||
    (hasNumberMatch && overlapCount >= 1 && declaredCoverage >= 0.35) ||
    (hasNumberMatch && overlapCount >= 2 && extractedCoverage >= 0.2) ||
    (hasNumberMatch && hasStrongTokenMatch && declaredCoverage >= 0.2);

  return {
    enderecoExtraido,
    enderecoNormalizadoDeclarado: declaredNorm,
    enderecoNormalizadoExtraido: extractedNorm,
    scoreCorrespondencia: Number(score.toFixed(2)),
    corresponde,
  };
}
