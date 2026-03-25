import { readFileSync } from "fs";
import sharp from "sharp";
import Tesseract from "tesseract.js";

const imagePath = process.argv[2] ?? "/tmp/residence-teste.jpg";
const declared = process.argv[3] ?? "RUA ELISÁRIO SANTANA PEIXOTO 345 BRUSQUE";

const raw = readFileSync(imagePath);

const normalize = (s) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stopwords = new Set([
  "RUA", "R", "AV", "AVENIDA", "TRAVESSA", "TV", "ESTRADA", "RODOVIA", "ALAMEDA", "PRACA", "PRAÇA",
  "NUM", "NUMERO", "N", "NO", "NRO", "BAIRRO", "CEP", "BRASIL", "UF", "AP", "APTO", "BLOCO", "CASA",
  "LOTE", "QD", "QUADRA", "KM", "SN", "S",
]);

const tokenize = (s) =>
  normalize(s)
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stopwords.has(t));

const declaredTokens = tokenize(declared);

async function run(label, buf, psm) {
  const { data } = await Tesseract.recognize(buf, "por", {
    logger: () => {},
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: "1",
  });

  const normalizedText = normalize(data.text);
  const tokenHits = declaredTokens.filter((t) => normalizedText.includes(t));
  const declaredNumbers = normalize(declared).match(/\b\d{1,6}\b/g) ?? [];
  const numberHits = declaredNumbers.filter((n) => new RegExp(`\\b${n}\\b`).test(normalizedText));

  return {
    label,
    psm,
    confidence: Number(data.confidence.toFixed(1)),
    length: data.text.length,
    tokenHits,
    numberHits,
    preview: data.text.slice(0, 700).replace(/\n/g, " | "),
  };
}

const enhanced = await sharp(raw)
  .rotate()
  .greyscale()
  .clahe({ width: 8, height: 8, maxSlope: 4 })
  .sharpen({ sigma: 1.0, m1: 1.0, m2: 5 })
  .png()
  .toBuffer();

const baseline = await sharp(raw)
  .rotate()
  .png()
  .toBuffer();

const results = [];
for (const psm of [6, 4, 11]) {
  results.push(await run("enhanced", enhanced, psm));
  results.push(await run("baseline", baseline, psm));
}

console.log(JSON.stringify({
  imagePath,
  declared,
  declaredTokens,
  results,
}, null, 2));
