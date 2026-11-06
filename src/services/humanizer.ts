import { config } from '../config.js';

export interface HumanizerOptions {
  msPerChar?: number;
  jitter?: number;
  minTypingMs?: number;
  maxTypingMs?: number;
  minThinkMs?: number;
  maxThinkMs?: number;
  minBubbleGapMs?: number;
  maxBubbleGapMs?: number;
  minStickerPauseMs?: number;
  maxStickerPauseMs?: number;
  maxBubbles?: number;
  longBubbleChars?: number;
  mergeChance?: number;
  rng?: () => number;
  sleep?: (ms: number) => Promise<void>;
  instant?: boolean;
}

export interface DeliveryPlan {
  bubbles: string[];
  thinkMs: number;
  typingMs: number[];
  gapMs: number[];
}

export interface DeliveryResult extends DeliveryPlan {
  totalMs: number;
  composedMs: number;
  sentBubbles: number;
}

export interface DeliveryAdapter {
  sendPresence(state: 'composing' | 'paused'): Promise<void>;
  sendText(text: string, opts: { first: boolean }): Promise<void>;
}

interface ResolvedOptions {
  msPerChar: number;
  jitter: number;
  minTypingMs: number;
  maxTypingMs: number;
  minThinkMs: number;
  maxThinkMs: number;
  minBubbleGapMs: number;
  maxBubbleGapMs: number;
  minStickerPauseMs: number;
  maxStickerPauseMs: number;
  maxBubbles: number;
  longBubbleChars: number;
  mergeChance: number;
  instant: boolean;
  rng: () => number;
  sleep: (ms: number) => Promise<void>;
}

const DEFAULTS = {
  msPerChar: 24,
  jitter: 0.3,
  minTypingMs: 300,
  maxTypingMs: 3500,
  minThinkMs: 120,
  maxThinkMs: 400,
  minBubbleGapMs: 150,
  maxBubbleGapMs: 450,
  minStickerPauseMs: 250,
  maxStickerPauseMs: 700,
  maxBubbles: 4,
  longBubbleChars: 110,
  mergeChance: 0,
};

export function resolveHumanizerOptions(options: HumanizerOptions = {}): ResolvedOptions {
  const maxBubbles = options.maxBubbles ?? (config.burstEnabled ? config.burstMaxMessages : 1);

  return {
    msPerChar: options.msPerChar ?? config.typingMsPerChar ?? DEFAULTS.msPerChar,
    jitter: options.jitter ?? DEFAULTS.jitter,
    minTypingMs: options.minTypingMs ?? config.typingMinMs ?? DEFAULTS.minTypingMs,
    maxTypingMs: options.maxTypingMs ?? config.typingMaxMs ?? DEFAULTS.maxTypingMs,
    minThinkMs: options.minThinkMs ?? config.typingThinkMinMs ?? DEFAULTS.minThinkMs,
    maxThinkMs: options.maxThinkMs ?? config.typingThinkMaxMs ?? DEFAULTS.maxThinkMs,
    minBubbleGapMs: options.minBubbleGapMs ?? config.bubbleGapMinMs ?? DEFAULTS.minBubbleGapMs,
    maxBubbleGapMs: options.maxBubbleGapMs ?? config.bubbleGapMaxMs ?? DEFAULTS.maxBubbleGapMs,
    minStickerPauseMs: options.minStickerPauseMs ?? config.stickerPauseMinMs ?? DEFAULTS.minStickerPauseMs,
    maxStickerPauseMs: options.maxStickerPauseMs ?? config.stickerPauseMaxMs ?? DEFAULTS.maxStickerPauseMs,
    maxBubbles: Math.max(1, maxBubbles),
    longBubbleChars: options.longBubbleChars ?? DEFAULTS.longBubbleChars,
    mergeChance: clamp(options.mergeChance ?? DEFAULTS.mergeChance, 0, 1),
    instant: options.instant ?? !config.typingSimulationEnabled,
    rng: options.rng ?? Math.random,
    sleep: options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function randomBetween(min: number, max: number, rng: () => number = Math.random): number {
  if (max <= min) return min;
  return min + rng() * (max - min);
}

export function typingDelayMs(text: string, options: HumanizerOptions = {}): number {
  const opts = resolveHumanizerOptions(options);
  const chars = countTypingChars(text);
  if (chars === 0) return 0;

  const factor = 1 + randomBetween(-opts.jitter, opts.jitter, opts.rng);
  const base = chars * opts.msPerChar * factor;
  return Math.round(clamp(base, opts.minTypingMs, opts.maxTypingMs));
}

export function stickerPauseMs(options: HumanizerOptions = {}): number {
  const opts = resolveHumanizerOptions(options);
  return Math.round(randomBetween(opts.minStickerPauseMs, opts.maxStickerPauseMs, opts.rng));
}

export function countTypingChars(text: string): number {
  return text.replace(/\s+/g, ' ').trim().length;
}

function splitLongPiece(piece: string, maxChars: number): string[] {
  if (piece.length <= maxChars) return [piece];

  const window = piece.slice(0, Math.max(1, Math.floor(piece.length * 0.6)));
  const boundaries = ['. ', '! ', '? ', '... ', ', ', '; ', ' '];
  let cut = -1;

  for (const boundary of boundaries) {
    const idx = window.lastIndexOf(boundary);
    if (idx > cut) cut = idx + boundary.length - 1;
  }

  if (cut <= 0) {
    const spaceIdx = piece.lastIndexOf(' ', maxChars);
    cut = spaceIdx > 0 ? spaceIdx : maxChars;
  }

  const head = piece.slice(0, cut + 1).trim();
  const tail = piece.slice(cut + 1).trim();
  if (!head || !tail) return [piece.trim()];

  return [head, ...splitLongPiece(tail, maxChars)];
}

function distributeEvenly(text: string, parts: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (parts <= 1) return [words.join(' ')];

  const targetLength = Math.ceil(text.trim().length / parts);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > targetLength && chunks.length < parts - 1) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

export function splitIntoBubbles(text: string, options: HumanizerOptions = {}): string[] {
  const opts = resolveHumanizerOptions(options);
  const normalized = (text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  if (opts.maxBubbles === 1) return [normalized];

  const lines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const pieces: string[] = [];
  for (const line of lines) {
    for (const piece of splitLongPiece(line, opts.longBubbleChars)) {
      const trimmed = piece.trim();
      if (trimmed) pieces.push(trimmed);
    }
  }

  if (pieces.length === 0) return [];
  if (pieces.length <= opts.maxBubbles) return pieces;

  return distributeEvenly(pieces.join(' '), opts.maxBubbles);
}

export function mergeRandomly(bubbles: string[], chance: number, rng: () => number = Math.random): string[] {
  if (bubbles.length <= 1 || chance <= 0) return bubbles;

  const merged: string[] = [];
  for (const bubble of bubbles) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && rng() < chance) {
      merged[merged.length - 1] = `${previous} ${bubble}`.trim();
    } else {
      merged.push(bubble);
    }
  }
  return merged;
}

export function buildDeliveryPlan(text: string, options: HumanizerOptions = {}): DeliveryPlan {
  const opts = resolveHumanizerOptions(options);
  const bubbles = mergeRandomly(splitIntoBubbles(text, options), opts.mergeChance, opts.rng);

  if (opts.instant) {
    return {
      bubbles,
      thinkMs: 0,
      typingMs: bubbles.map(() => 0),
      gapMs: bubbles.slice(0, -1).map(() => 0),
    };
  }

  const typingMs = bubbles.map((bubble) => typingDelayMs(bubble, options));
  const gapMs = bubbles.slice(0, -1).map(() =>
    Math.round(randomBetween(opts.minBubbleGapMs, opts.maxBubbleGapMs, opts.rng))
  );
  const thinkMs = Math.round(randomBetween(opts.minThinkMs, opts.maxThinkMs, opts.rng));

  return { bubbles, thinkMs, typingMs, gapMs };
}

export async function deliverHumanized(
  adapter: DeliveryAdapter,
  text: string,
  options: HumanizerOptions = {}
): Promise<DeliveryResult> {
  const opts = resolveHumanizerOptions(options);
  const plan = buildDeliveryPlan(text, options);

  if (plan.bubbles.length === 0) {
    return { ...plan, totalMs: 0, composedMs: 0, sentBubbles: 0 };
  }

  await opts.sleep(plan.thinkMs);

  let composedMs = 0;
  let totalMs = plan.thinkMs;

  for (let i = 0; i < plan.bubbles.length; i++) {
    const typing = plan.typingMs[i] ?? 0;

    if (!opts.instant) {
      await adapter.sendPresence('composing');
      await opts.sleep(typing);
      await adapter.sendPresence('paused');
    }

    composedMs += typing;
    totalMs += typing;

    await adapter.sendText(plan.bubbles[i], { first: i === 0 });

    if (i < plan.bubbles.length - 1) {
      const gap = plan.gapMs[i] ?? 0;
      await opts.sleep(gap);
      totalMs += gap;
    }
  }

  return {
    ...plan,
    totalMs,
    composedMs,
    sentBubbles: plan.bubbles.length,
  };
}
