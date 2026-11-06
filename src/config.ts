import dotenv from 'dotenv';
import path from 'path';
dotenv.config();

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function chanceFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : fallback;
}

function parseTextPool(value: string | undefined, fallback: string[]): string[] {
  const parsed = (value ?? '')
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['true', '1', 'yes', 'si', 'sí', 'on'].includes(value.trim().toLowerCase());
}

function durationFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const config = {
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
  deepseekMaxTokens: numberFromEnv(process.env.DEEPSEEK_MAX_TOKENS, 800),
  replyQuote: boolFromEnv(process.env.REPLY_QUOTE, true),
  triggerPrefix: process.env.TRIGGER_PREFIX || '!',
  respondToAll: process.env.RESPOND_TO_ALL === 'true',
  targetPhone: process.env.TARGET_PHONE || '59170000000',
  botNicknames: parseTextPool(process.env.BOT_NICKNAMES, [
    'nicol',
    'nicole',
    'nicoll',
    'nikol',
    'nikole',
    'nico',
    'val',
    'vale',
    'flaca',
    'chica melon',
    'melon',
  ]),

  creatorName: process.env.CREATOR_NAME || 'Luis',
  creatorPhone: process.env.CREATOR_PHONE || '+34 600 00 00 01',
  clanName: process.env.CLAN_NAME || '•NOYSYBO•',
  clanLeader: process.env.CLAN_LEADER || 'Alejandro',

  dataDir: process.env.DATA_DIR || path.join(process.cwd(), 'data'),
  memoryEnabled: boolFromEnv(process.env.MEMORY_ENABLED, true),
  memoryFile: process.env.MEMORY_FILE || '',

  timezone: process.env.TIMEZONE || 'America/La_Paz',

  typingSimulationEnabled: boolFromEnv(process.env.TYPING_SIMULATION, true),
  typingMsPerChar: durationFromEnv(process.env.TYPING_MS_PER_CHAR, 24),
  typingMinMs: durationFromEnv(process.env.TYPING_MIN_MS, 300),
  typingMaxMs: durationFromEnv(process.env.TYPING_MAX_MS, 3500),
  typingThinkMinMs: durationFromEnv(process.env.TYPING_THINK_MIN_MS, 120),
  typingThinkMaxMs: durationFromEnv(process.env.TYPING_THINK_MAX_MS, 400),
  bubbleGapMinMs: durationFromEnv(process.env.BUBBLE_GAP_MIN_MS, 150),
  bubbleGapMaxMs: durationFromEnv(process.env.BUBBLE_GAP_MAX_MS, 450),

  burstEnabled: boolFromEnv(process.env.BURST_MESSAGES, true),
  burstMaxMessages: numberFromEnv(process.env.BURST_MAX_MESSAGES, 4),
  burstMergeChance: chanceFromEnv(process.env.BURST_MERGE_CHANCE, 0.55),

  messageDebounceMs: durationFromEnv(process.env.MESSAGE_DEBOUNCE_MS, 900),
  queueGapMs: durationFromEnv(process.env.QUEUE_GAP_MS, 250),
  queueDeferMaxAttempts: numberFromEnv(process.env.QUEUE_DEFER_MAX_ATTEMPTS, 3),
  groupMemberSync: boolFromEnv(process.env.GROUP_MEMBER_SYNC, true),

  stickerTargetRate: numberFromEnv(process.env.STICKER_TARGET_RATE, 0),
  stickerBudgetWindow: numberFromEnv(process.env.STICKER_BUDGET_WINDOW, 6),
  stickerFallbackTexts: parseTextPool(process.env.STICKER_FALLBACK_TEXT, [
    'toma',
    'che',
    'mira',
    'ahi va',
    'mira eso',
  ]),
  stickerPauseMinMs: durationFromEnv(process.env.STICKER_PAUSE_MIN_MS, 250),
  stickerPauseMaxMs: durationFromEnv(process.env.STICKER_PAUSE_MAX_MS, 700),

  moodTtlTurns: numberFromEnv(process.env.MOOD_TTL_TURNS, 6),
  moodTtlMinutes: numberFromEnv(process.env.MOOD_TTL_MINUTES, 45),
  moodEnabled: boolFromEnv(process.env.MOOD_ENABLED, true),

  ambientWindow: numberFromEnv(process.env.AMBIENT_WINDOW, 12),
  ambientEnabled: boolFromEnv(process.env.AMBIENT_ENABLED, true),

  rateLimitPerMinute: numberFromEnv(process.env.RATE_LIMIT_PER_MINUTE, 60),
  rateLimitPerHour: numberFromEnv(process.env.RATE_LIMIT_PER_HOUR, 10000),
  rateLimitGlobalPerMinute: numberFromEnv(process.env.RATE_LIMIT_GLOBAL_PER_MINUTE, 120),
  rateLimitMinGapMs: durationFromEnv(process.env.RATE_LIMIT_MIN_GAP_MS, 300),
  rateLimitMaxWaitMs: durationFromEnv(process.env.RATE_LIMIT_MAX_WAIT_MS, 4000),

  styleMaxLaughRate: numberFromEnv(process.env.STYLE_MAX_LAUGH_RATE, 0.35),
  styleRepetitionThreshold: numberFromEnv(process.env.STYLE_REPETITION_THRESHOLD, 0.7),
  styleMaxAggressionRate: numberFromEnv(process.env.STYLE_MAX_AGGRESSION_RATE, 0.85),
  styleMaxRephrases: durationFromEnv(process.env.STYLE_MAX_REPHRASES, 1),

  rapportEnabled: boolFromEnv(process.env.RAPPORT_ENABLED, true),
  rapportCloseScore: numberFromEnv(process.env.RAPPORT_CLOSE_SCORE, 2),
  rapportTenseScore: numberFromEnv(process.env.RAPPORT_TENSE_SCORE, 2),
  rapportHalfLifeMinutes: numberFromEnv(process.env.RAPPORT_HALF_LIFE_MINUTES, 720),
};
