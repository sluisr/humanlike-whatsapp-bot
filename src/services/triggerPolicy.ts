export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildNicknamePattern(nicknames: string[]): RegExp | null {
  const aliases = nicknames
    .map((name) => normalizeForMatch(name.trim()))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (aliases.length === 0) return null;

  const alternation = aliases.map(escapeRegex).join('|');
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${alternation})($|[^\\p{L}\\p{N}])`, 'iu');
}

export function mentionsBotName(text: string, nicknames: string[]): boolean {
  const pattern = buildNicknamePattern(nicknames);
  if (!pattern) return false;
  return pattern.test(normalizeForMatch(text));
}

export type ResponseReason =
  | 'privado'
  | 'responder-a-todos'
  | 'prefijo'
  | 'mencion-directa'
  | 'nombre'
  | 'cita'
  | 'no-va-dirigido';

export interface TriggerInput {
  isGroup: boolean;
  text: string;
  hasPrefix: boolean;
  isBotMentioned: boolean;
  isBotQuoted: boolean;
  respondToAll: boolean;
  nicknames: string[];
}

export interface TriggerDecision {
  respond: boolean;
  reason: ResponseReason;
}

export function decideResponse(input: TriggerInput): TriggerDecision {
  if (!input.isGroup) return { respond: true, reason: 'privado' };
  if (input.respondToAll) return { respond: true, reason: 'responder-a-todos' };
  if (input.hasPrefix) return { respond: true, reason: 'prefijo' };
  if (input.isBotMentioned) return { respond: true, reason: 'mencion-directa' };
  if (mentionsBotName(input.text, input.nicknames)) return { respond: true, reason: 'nombre' };
  if (input.isBotQuoted) return { respond: true, reason: 'cita' };
  return { respond: false, reason: 'no-va-dirigido' };
}
