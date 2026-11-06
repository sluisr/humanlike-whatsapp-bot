import { getPersona } from './personas.js';

export interface SanitizeContext {
  isGroup: boolean;
  isCreatorSpeaking: boolean;
  userText: string;
  personaId?: string;
}

export interface SanitizeResult {
  text: string;
  stickerTag?: string;
}

export function extractInlineSticker(text: string): { text: string; stickerTag?: string } {
  const match = text.match(/\[sticker:\s*([a-zA-Z0-9_-]+)\]/i);
  if (!match) return { text };

  return {
    text: text.replace(/\[sticker:\s*[a-zA-Z0-9_-]+\]/gi, '').trim(),
    stickerTag: match[1].toLowerCase(),
  };
}

export function stripRolePrefixes(text: string): string {
  return text
    .replace(/^\[.*?\]:\s*/gm, '')
    .replace(/^\(.*?\):\s*/gm, '')
    .trim();
}

export function stripWrongLuisMentions(reply: string): string {
  return reply
    .replace(/\b(uyy?|ps|nom[aá]s|oye)\s+luis\b/gi, '$1')
    .replace(/\bluis,\s*/gi, '')
    .replace(/,\s*luis\b/gi, '')
    .replace(/\bluis\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,\s.]+/, '')
    .trim();
}

export function resolveReplyText(botReply: string, fallbackText: string): string {
  const text = (botReply ?? '').trim();
  return text || fallbackText.trim() || 'que';
}

export function pickFallbackText(
  pool: string[],
  recent: string[] = [],
  rng: () => number = Math.random
): string {
  const candidates = (pool ?? []).map((text) => text.trim()).filter(Boolean);
  if (candidates.length === 0) return 'que';

  const normalize = (text: string) => text.trim().toLowerCase();
  const used = new Set((recent ?? []).map(normalize));
  const fresh = candidates.filter((text) => !used.has(normalize(text)));
  const usable = fresh.length > 0 ? fresh : candidates;

  const index = Math.min(usable.length - 1, Math.floor(rng() * usable.length));
  return usable[index];
}

const REFUSAL_PATTERNS = [
  /no puedo (seguir|continuar|escribir|generar|cumplir|participar)/i,
  /contenido sexual|edad escolar|asistente de ia|pol[ií]ticas de seguridad|directrices de contenido/i,
  /como modelo de lenguaje|no voy a escribir/i,
];

export function isCorporateRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(text));
}

export function sanitizePersonaReply(rawReply: string, context: SanitizeContext): SanitizeResult {
  const { text: withoutSticker, stickerTag } = extractInlineSticker(rawReply ?? '');
  let text = stripRolePrefixes(withoutSticker);

  if (isCorporateRefusal(text)) {
    const persona = getPersona(context.personaId);
    const deflections = persona.inCharacterDeflections;
    text = deflections[Math.floor(Math.random() * deflections.length)];
  }

  if (context.isGroup && !context.isCreatorSpeaking) {
    const userMentionedLuis = /\bluis\b/i.test(context.userText);
    if (!userMentionedLuis) {
      text = stripWrongLuisMentions(text);
    }
  }

  return { text, stickerTag };
}
