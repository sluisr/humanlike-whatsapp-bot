import { config } from '../config.js';

const LAUGH_LETTERS = /^[aeijousxdklh]+$/i;

export function isLaughWord(word: string): boolean {
  const token = (word ?? '').replace(/[^\p{L}]/gu, '');
  if (token.length < 2 || !LAUGH_LETTERS.test(token)) return false;

  const jCount = (token.match(/j/gi) ?? []).length;
  if (jCount >= 2) return true;
  if (/js/i.test(token)) return true;
  if (/^x+d+$/i.test(token)) return true;
  if (/^(?:lol|haha+)$/i.test(token)) return true;
  if (/^k{3,}$/i.test(token)) return true;

  return false;
}

const STOP_WORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'que', 'qe', 'es',
  'a', 'en', 'con', 'por', 'para', 'sin', 'mi', 'tu', 'su', 'me', 'te', 'se', 'lo', 'al',
  'no', 'si', 'ya', 'mas', 'más', 'pero', 'como', 'muy', 'todo', 'toda', 'eso', 'esto',
]);

export interface StylePolicy {
  maxLaughRate: number;
  repetitionThreshold: number;
  window: number;
  maxAggressionRate: number;
}

export interface LaughStripResult {
  text: string;
  removed: number;
}

export interface RepetitionMatch {
  previous: string;
  score: number;
}

export interface StyleReport {
  text: string;
  laughRate: number;
  laughsRemoved: number;
  repetition?: RepetitionMatch;
  aggressionRate: number;
  toneBroke: boolean;
  echo?: { userText: string };
  needsRephrase: boolean;
}

export function resolveStylePolicy(options: Partial<StylePolicy> = {}): StylePolicy {
  return {
    maxLaughRate: options.maxLaughRate ?? config.styleMaxLaughRate,
    repetitionThreshold: options.repetitionThreshold ?? config.styleRepetitionThreshold,
    window: options.window ?? 5,
    maxAggressionRate: options.maxAggressionRate ?? config.styleMaxAggressionRate,
  };
}

export function hasLaugh(text: string): boolean {
  return countLaughs(text) > 0;
}

export function countLaughs(text: string): number {
  return (text ?? '')
    .split(/\s+/)
    .filter((word) => isLaughWord(word))
    .length;
}

export function stripLaughs(text: string): LaughStripResult {
  const original = text ?? '';
  const removed = countLaughs(original);
  if (removed === 0) return { text: original, removed: 0 };

  const cleaned = original
    .split(/\s+/)
    .filter((word) => !isLaughWord(word))
    .join(' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/([,.;!?])\s*(?=[,.;!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^\s*[,.;!?]+\s*/, '')
    .replace(/\s+$/gm, '')
    .trim();

  if (!cleaned) return { text: original.trim().length > 0 ? 'je' : '', removed };

  return { text: cleaned, removed };
}

export function laughRate(messages: string[]): number {
  if (messages.length === 0) return 0;
  const withLaughs = messages.filter((message) => hasLaugh(message)).length;
  return withLaughs / messages.length;
}

const AGGRESSION_PATTERNS: RegExp[] = [
  /\b(?:puta|perra|mierda|carajo|verga|pendej[oa]|cabr[oó]n|malcriad[oa]|maleducad[oa]|idiota|imb[eé]cil|tarad[oa]|est[uú]pid[oa]|pelotud[oa]|bolud[oa]|infeliz|ch[uú]pamela|ch[uú]pame)\b/i,
  /\bte\s+(?:gano|golpeo|aplasto|destruyo|humillo|rompo|vuelo|callo)\b/i,
  /\b(?:paliza|aplastad[oa]|humillad[oa]|manco)\b/i,
  /\baprend[eé] a jugar\b/i,
  /\bno\s+te\s+da\b/i,
  /\bte\s+dejo\s+sin\b/i,
  /\bc[aá]llate\b|\bcallate\b/i,
  /\b(?:qui[eé]n\s+sos|no\s+te\s+conozco)\b/i,
];

export function hasAggression(text: string): boolean {
  const value = text ?? '';
  return AGGRESSION_PATTERNS.some((pattern) => pattern.test(value));
}

export function aggressionRate(messages: string[]): number {
  if (messages.length === 0) return 0;
  const withEdge = messages.filter((message) => hasAggression(message)).length;
  return withEdge / messages.length;
}

export function normalizeEchoText(text: string): string {
  return (text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ECHO_ALLOWED = new Set([
  'hola', 'holaa', 'buenas', 'buenos', 'buen', 'dia', 'dias', 'tarde', 'tardes', 'noche', 'noches',
  'gracias', 'jaja', 'jeje', 'ok', 'oka', 'dale', 'si', 'no', 'ya', 'oe', 'bien', 'todo', 'aca',
]);

export function isEcho(botText: string, userText: string): boolean {
  const bot = normalizeEchoText(botText);
  const user = normalizeEchoText(userText);
  if (!bot || !user) return false;

  if (bot === user) {
    const words = bot.split(' ');
    if (words.length <= 2 && words.every((word) => ECHO_ALLOWED.has(word))) return false;
    return true;
  }

  const botTokens = tokenize(botText);
  const userTokens = tokenize(userText);
  if (botTokens.length === 0 || userTokens.length === 0) return false;
  if (botTokens.length <= 2 && botTokens.every((token) => ECHO_ALLOWED.has(token))) return false;

  const userSet = new Set(userTokens);
  const shared = botTokens.filter((token) => userSet.has(token)).length;
  return shared / botTokens.length >= 0.8 && shared / userSet.size >= 0.8;
}

export function tokenize(text: string): string[] {
  return (text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function similarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));

  if (setA.size === 0 && setB.size === 0) return a.trim() === b.trim() ? 1 : 0;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function findRepetition(
  text: string,
  previousMessages: string[],
  threshold = config.styleRepetitionThreshold
): RepetitionMatch | undefined {
  let best: RepetitionMatch | undefined;

  for (const previous of previousMessages) {
    if (!previous?.trim()) continue;
    const score = similarity(text, previous);
    if (score >= threshold && (!best || score > best.score)) {
      best = { previous, score };
    }
  }

  return best;
}

export interface ApplyStyleGuardInput {
  text: string;
  botHistory: string[];
  userText?: string;
  policy?: Partial<StylePolicy>;
}

export function applyStyleGuard(input: ApplyStyleGuardInput): StyleReport {
  const policy = resolveStylePolicy(input.policy);
  const history = input.botHistory.slice(-policy.window);
  const rate = laughRate(history);

  let text = input.text ?? '';
  let laughsRemoved = 0;

  const laughLimitReached = history.length >= 2 && rate >= policy.maxLaughRate;
  const userLaughed = input.userText ? hasLaugh(input.userText) : false;

  if (laughLimitReached && !userLaughed && hasLaugh(text)) {
    const stripped = stripLaughs(text);
    text = stripped.text;
    laughsRemoved = stripped.removed;
  }

  const repetition = findRepetition(text, history, policy.repetitionThreshold);

  const toneRate = aggressionRate(history);
  const toneBroke = history.length >= 3 && toneRate >= policy.maxAggressionRate && hasAggression(text);

  const echo = input.userText && isEcho(text, input.userText) ? { userText: input.userText } : undefined;

  return {
    text,
    laughRate: rate,
    laughsRemoved,
    repetition,
    aggressionRate: toneRate,
    toneBroke,
    echo,
    needsRephrase: !!repetition || toneBroke || !!echo,
  };
}

export function buildRephraseInstruction(report: StyleReport): string {
  const lines = ['Ojo: eso ya lo dijiste casi igual antes. Reformulalo, no repitas la misma frase.'];
  if (report.repetition) {
    lines.push(`Frases que YA usaste y no podés volver a escribir: "${report.repetition.previous.trim()}".`);
  }
  if (report.laughsRemoved > 0) {
    lines.push('Y bajá las risas: vos ya venís usando "jaja" demasiado seguido, esta vez sin risa.');
  }
  if (report.toneBroke) {
    lines.push(
      'Y cambiá de recurso: venís bardeaando con las mismas palabras en todos los mensajes. El filo está bien, NO lo bajes, pero tirá OTRO insulto u otra salida (o un desplante seco sin insulto). Repetir la misma grosería es lo único que suena a bot.'
    );
  }
  if (report.echo) {
    lines.push(
      `Y no repitas lo que te escribieron ("${report.echo.userText.trim()}"): devolver las mismas palabras es un eco y delata al toque. Contestá con una idea distinta y tuya, aunque sea corta.`
    );
  }
  lines.push('Decilo con otras palabras, más corto y más natural.');
  return lines.join('\n');
}
