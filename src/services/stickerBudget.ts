import { config } from '../config.js';
import { logger } from './logger.js';
import { getChatRecord } from './memoryStore.js';
import {
  findAlternativeSticker,
  getMandatoryMomentFor,
  getStickerPolicy,
  isMandatoryTag,
  resolveStickerFile,
} from './stickerCatalog.js';

export type StickerDirective = 'must' | 'encouraged' | 'neutral' | 'restrained' | 'veto';

export interface StickerBudget {
  window: number;
  sent: number;
  total: number;
  rate: number;
  target: number;
  directive: StickerDirective;
  lastStickerTag?: string;
  consecutiveWithSticker: number;
}

export interface StickerBudgetOptions {
  window?: number;
  targetRate?: number;
}

const STICKER_IN_HISTORY = /\[sticker:\s*([a-z0-9_\-]+)\]/i;

export function extractStickerTag(content: string): string | undefined {
  const match = (content ?? '').match(STICKER_IN_HISTORY);
  return match ? match[1].toLowerCase() : undefined;
}

export function resolveTargetRate(explicit?: number, personaIdOrDir?: string): number {
  if (typeof explicit === 'number' && explicit > 0) return explicit;
  if (config.stickerTargetRate > 0) return config.stickerTargetRate;
  return getStickerPolicy(personaIdOrDir).targetRate;
}

export function decideStickerDirective(input: {
  sent: number;
  total: number;
  rate: number;
  target: number;
  consecutiveWithSticker: number;
}): StickerDirective {
  const { sent, total, rate, target, consecutiveWithSticker } = input;

  if (total === 0) return 'neutral';
  if (consecutiveWithSticker >= 2) return 'veto';
  if (consecutiveWithSticker === 1) return rate < target - 0.15 ? 'encouraged' : 'restrained';
  if (sent === 0 && total >= 3) return 'must';
  if (rate < target - 0.2) return 'must';
  if (rate < target - 0.05) return 'encouraged';
  if (rate > target + 0.25) return 'restrained';
  return 'neutral';
}

export function evaluateStickerBudget(
  chatId: string,
  options: StickerBudgetOptions = {},
  personaIdOrDir?: string
): StickerBudget {
  const window = options.window && options.window > 0 ? options.window : config.stickerBudgetWindow;
  const target = resolveTargetRate(options.targetRate, personaIdOrDir);

  const messages = getChatRecord(chatId)?.messages ?? [];
  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  const recent = assistantMessages.slice(-window);

  const tags = recent.map((message) => extractStickerTag(message.content));
  const sent = tags.filter(Boolean).length;
  const total = recent.length;
  const rate = total === 0 ? 0 : sent / total;

  let consecutiveWithSticker = 0;
  for (let i = assistantMessages.length - 1; i >= 0; i--) {
    if (!extractStickerTag(assistantMessages[i].content)) break;
    consecutiveWithSticker++;
  }

  let lastStickerTag: string | undefined;
  for (let i = assistantMessages.length - 1; i >= 0; i--) {
    const tag = extractStickerTag(assistantMessages[i].content);
    if (tag) {
      lastStickerTag = tag;
      break;
    }
  }

  const directive = decideStickerDirective({ sent, total, rate, target, consecutiveWithSticker });

  return { window, sent, total, rate, target, directive, lastStickerTag, consecutiveWithSticker };
}

const DIRECTIVE_LINES: Record<StickerDirective, string> = {
  must: 'Vas MUY por debajo de tu estilo: en este turno acompañá tu texto con un sticker de la emoción que corresponda.',
  encouraged: 'Vas algo por debajo: aprovechá a mandar sticker si el momento pega.',
  neutral: 'Vas en tu ritmo normal: mandá sticker solo si el momento realmente lo amerita.',
  restrained: 'Vas por encima o mandaste recién: este turno respondé SOLO con texto, salvo que sea un momento SÍ O SÍ.',
  veto: 'PROHIBIDO mandar sticker en este turno (ya mandaste en tus últimos 2 mensajes): respondé solo con texto.',
};

export function formatStickerStatePrompt(budget: StickerBudget): string {
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const lines: string[] = [
    '[TU CONCIENCIA DE STICKERS — DATO REAL, NO LO IGNORES]',
    `De tus últimos ${budget.total} mensaje${budget.total === 1 ? '' : 's'} en este chat, ${budget.sent} llev${budget.sent === 1 ? 'ó' : 'aron'} sticker (${percent(budget.rate)}). Tu estilo natural es alrededor del ${percent(budget.target)}: NO mandás sticker en todos los mensajes.`,
  ];

  if (budget.lastStickerTag) {
    lines.push(`El último sticker que mandaste fue "${budget.lastStickerTag}": no repitas ese ahora.`);
  }
  if (budget.consecutiveWithSticker > 0) {
    lines.push(`Llevás ${budget.consecutiveWithSticker} mensaje${budget.consecutiveWithSticker === 1 ? '' : 's'} seguido${budget.consecutiveWithSticker === 1 ? '' : 's'} con sticker.`);
  }

  lines.push(`ESTADO DE ESTE TURNO: ${DIRECTIVE_LINES[budget.directive]}`);
  if (budget.directive === 'must' || budget.directive === 'encouraged') {
    lines.push(
      'Acá no te me escapés: elegí el sticker que pegue con lo que está pasando y mandalo junto a tu texto (tool call). Que el mensaje sea simple NO es excusa para saltearlo.'
    );
  } else {
    lines.push('Si no hay emoción real (mensaje simple o neutral), NO mandes sticker: una persona no manda sticker en cada mensaje.');
  }

  return lines.join('\n');
}

export interface StickerDecisionInput {
  rawTag?: string;
  budget: StickerBudget;
}

export interface StickerDecision {
  tag?: string;
  file?: string;
  emotion?: string;
  mandatory?: boolean;
  swappedFrom?: string;
  skippedReason?: string;
}

export function applyStickerPolicy(input: StickerDecisionInput, personaIdOrDir?: string): StickerDecision {
  const rawTag = (input.rawTag ?? '').trim();
  if (!rawTag) return { skippedReason: 'el modelo no pidió sticker' };

  const resolution = resolveStickerFile(rawTag, personaIdOrDir);
  if (!resolution) {
    logger.warn(`Sticker descartado: el modelo pidió un tag inexistente "${rawTag}"`);
    return { skippedReason: `tag inexistente "${rawTag}"` };
  }

  const mandatory = isMandatoryTag(resolution.tag, personaIdOrDir) || !!getMandatoryMomentFor(resolution.tag, personaIdOrDir);
  const { consecutiveWithSticker, lastStickerTag } = input.budget;

  if (consecutiveWithSticker >= 3) {
    logger.info(`Sticker bloqueado: ${consecutiveWithSticker} mensajes seguidos con sticker`);
    return { skippedReason: `${consecutiveWithSticker} stickers seguidos (demasiado)` };
  }

  if (consecutiveWithSticker === 2 && !mandatory) {
    logger.info(`Sticker bloqueado: ya mandó sticker en los 2 mensajes previos`);
    return { skippedReason: 'ya mandó sticker en los 2 mensajes previos' };
  }

  if (lastStickerTag === resolution.tag) {
    const alternative = findAlternativeSticker(resolution.tag, resolution.emotion, personaIdOrDir);
    if (alternative) {
      logger.info(`Sticker repetido "${resolution.tag}": se cambia por "${alternative.tag}"`);
      return {
        tag: alternative.tag,
        file: alternative.file,
        emotion: alternative.emotion,
        mandatory,
        swappedFrom: resolution.tag,
      };
    }
    if (!mandatory) return { skippedReason: `repetiría el sticker "${resolution.tag}"` };
  }

  return {
    tag: resolution.tag,
    file: resolution.file,
    emotion: resolution.emotion,
    mandatory,
  };
}

const SAFE_COMBO_MOMENTS = ['alegria_amable', 'saludo', 'risa_real'];

export function comboStickerCandidates(personaIdOrDir?: string): string[] {
  const policy = getStickerPolicy(personaIdOrDir);
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const momentId of SAFE_COMBO_MOMENTS) {
    const moment = policy.moments.find((item) => item.id === momentId);
    if (!moment) continue;

    for (const rawTag of moment.tags) {
      const resolution = resolveStickerFile(rawTag, personaIdOrDir);
      if (!resolution || seen.has(resolution.tag)) continue;
      seen.add(resolution.tag);
      candidates.push(resolution.tag);
    }
  }

  if (candidates.length === 0) {
    for (const moment of policy.moments) {
      for (const rawTag of moment.tags) {
        const resolution = resolveStickerFile(rawTag, personaIdOrDir);
        if (!resolution || seen.has(resolution.tag)) continue;
        seen.add(resolution.tag);
        candidates.push(resolution.tag);
      }
    }
  }

  return candidates;
}

export function resolveForcedStickerTag(budget: StickerBudget, personaIdOrDir?: string): string | undefined {
  if (budget.directive !== 'must') return undefined;

  const candidates = comboStickerCandidates(personaIdOrDir);
  if (candidates.length === 0) return undefined;

  const start = budget.total % candidates.length;
  for (let offset = 0; offset < candidates.length; offset++) {
    const tag = candidates[(start + offset) % candidates.length];
    if (tag !== budget.lastStickerTag) return tag;
  }

  return undefined;
}
