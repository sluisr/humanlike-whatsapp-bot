export interface FactPattern {
  id: string;
  test: RegExp;
  build: (match: RegExpMatchArray) => string;
  skipWhenNegated?: boolean;
}

const MAX_FACT_LENGTH = 60;

const NEGATION_BEFORE = /(?:\bno|\bnunca|\bni|\btampoco)\s*$/i;

const STOPWORDS = new Set([
  'una', 'uno', 'unos', 'unas', 'de', 'del', 'muy', 'todo', 'toda', 'mas', 'más',
  'bien', 'mal', 're', 'que', 'el', 'la', 'los', 'las', 'un', 'mi', 'tu', 'su',
  'tan', 'asi', 'así', 'aqui', 'aquí', 'alla', 'allá', 'medio', 'pura', 'puro',
]);

function cleanCapture(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .trim()
    .toLowerCase();

  if (!cleaned || cleaned.length < 2 || cleaned.length > MAX_FACT_LENGTH) return undefined;
  if (/^(eso|esto|aquel|algo|nada|que|el|la|los|las|un|una|mi|tu|su)$/i.test(cleaned)) return undefined;
  return cleaned;
}

export const FACT_PATTERNS: FactPattern[] = [
  {
    id: 'gusto',
    test: /(?:\bme gusta\b|\bme encanta\b|\bamo\b|\bme fascina\b)\s+(?:el|la|los|las)?\s*([^.,;!?\n]{3,50})/iu,
    build: (m) => `le gusta ${m[1]}`,
    skipWhenNegated: true,
  },
  {
    id: 'disgusto',
    test: /(?:\bno me gusta\b|\bodio\b|\bdetesto\b|\bme da asco\b)\s+(?:el|la|los|las)?\s*([^.,;!?\n]{3,50})/iu,
    build: (m) => `no le gusta ${m[1]}`,
  },
  {
    id: 'edad',
    test: /(?:\btengo\b|\bya tengo\b|\bcumpli\b|\bcumplí\b)\s+(\d{1,2})\s*(?:años|añitos)?/iu,
    build: (m) => `tiene ${m[1]} años`,
  },
  {
    id: 'juego',
    test: /(?:\bjuego\b|\bando jugando\b|\bestoy jugando\b|\bvicio\b)\s+(?:al|a|en)?\s*([\p{L}\p{N}\s]{3,30})/iu,
    build: (m) => `juega ${m[1]}`,
  },
  {
    id: 'origen',
    test: /(?:\bsoy de\b|\bvivo en\b|\bvivo ac[aá] en\b|\bnaci en\b|\bnac[ií] en\b)\s+([\p{L}\s]{3,35})/iu,
    build: (m) => `es de ${m[1]}`,
  },
  {
    id: 'colegio',
    test: /(?:\bestudio en\b|\bvoy al?\b|\bme toca en\b)\s+(colegio|escuela|instituto|universidad|uni|u)\s*([\p{L}\p{N}\s]{0,30})/iu,
    build: (m) => {
      const lugar = cleanCapture(`${m[1]} ${m[2] ?? ''}`) ?? m[1].toLowerCase();
      return `estudia en ${lugar}`;
    },
  },
  {
    id: 'nombre',
    test: /(?:\bme llamo\b|\bmi nombre es\b|\bsoy\b)\s+([\p{L}]{3,20})(?:\s|$|,|\.)/iu,
    build: (m) => {
      const candidato = cleanCapture(m[1]);
      if (!candidato || STOPWORDS.has(candidato)) return '';
      return `se llama ${candidato}`;
    },
  },
  {
    id: 'mascota',
    test: /\btengo\s+(?:un|una)\s+(perr[oa]|gat[oa]|conejo|lora|loro|cuy|hamster)(?:\s+(?:que se llama|llamad[oa]))?\s*([\p{L}]{0,20})/iu,
    build: (m) => {
      const nombre = cleanCapture(m[2]);
      return nombre ? `tiene ${m[1]} llamado ${nombre}` : `tiene ${m[1]}`;
    },
  },
  {
    id: 'equipo',
    test: /\b(?:mi clan es|juego en el clan|pertenezco al clan|soy del clan)\b\s+([\p{L}\p{N}•_\-]{2,25})/iu,
    build: (m) => `es del clan ${m[1]}`,
  },
  {
    id: 'horario',
    test: /\b(?:entr[oe] al colegio|salgo del colegio|mi horario es|estudio de)\b\s+([^.,;!?\n]{4,40})/iu,
    build: (m) => `horario: ${m[1]}`,
  },
];

export function extractFacts(text: string, max = 3): string[] {
  if (!text || text.trim().length < 6) return [];

  const facts: string[] = [];
  const seen = new Set<string>();

  for (const pattern of FACT_PATTERNS) {
    const match = text.match(pattern.test);
    if (!match) continue;

    if (pattern.skipWhenNegated) {
      const before = text.slice(0, match.index ?? 0);
      if (NEGATION_BEFORE.test(before)) continue;
    }

    const fact = pattern.build(match).trim();
    if (!fact) continue;

    const key = normalizeFact(fact);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    facts.push(fact);
    if (facts.length >= max) break;
  }

  return facts;
}

export function normalizeFact(fact: string): string {
  return fact
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
