import { config } from '../config.js';
import { logger } from './logger.js';

export type RateLimitReason = 'gap' | 'minuto' | 'hora' | 'global';

export interface RateLimitVerdict {
  allowed: boolean;
  waitMs: number;
  reason?: RateLimitReason;
}

export interface RateLimiterOptions {
  perMinute: number;
  perHour: number;
  globalPerMinute: number;
  minGapMs: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

function prune(timestamps: number[], windowMs: number, now: number): number[] {
  const cutoff = now - windowMs;
  let index = 0;
  while (index < timestamps.length && timestamps[index] <= cutoff) index += 1;
  return index === 0 ? timestamps : timestamps.slice(index);
}

export class OutboundRateLimiter {
  private perChat = new Map<string, number[]>();
  private global: number[] = [];

  constructor(private readonly options: RateLimiterOptions) {}

  check(chatId: string, now: number = Date.now()): RateLimitVerdict {
    const history = this.perChat.get(chatId) ?? [];
    const recentMinute = prune(history, MINUTE_MS, now);
    const recentHour = prune(history, HOUR_MS, now);
    const recentGlobal = prune(this.global, MINUTE_MS, now);

    const last = history[history.length - 1];
    if (last !== undefined) {
      const gapLeft = this.options.minGapMs - (now - last);
      if (gapLeft > 0) return { allowed: false, waitMs: gapLeft, reason: 'gap' };
    }

    if (recentGlobal.length >= this.options.globalPerMinute) {
      const oldest = recentGlobal[0];
      return { allowed: false, waitMs: Math.max(0, oldest + MINUTE_MS - now), reason: 'global' };
    }

    if (recentMinute.length >= this.options.perMinute) {
      const oldest = recentMinute[0];
      return { allowed: false, waitMs: Math.max(0, oldest + MINUTE_MS - now), reason: 'minuto' };
    }

    if (recentHour.length >= this.options.perHour) {
      const oldest = recentHour[0];
      return { allowed: false, waitMs: Math.max(0, oldest + HOUR_MS - now), reason: 'hora' };
    }

    return { allowed: true, waitMs: 0 };
  }

  record(chatId: string, now: number = Date.now()): void {
    const history = prune(this.perChat.get(chatId) ?? [], HOUR_MS, now);
    history.push(now);
    this.perChat.set(chatId, history);
    this.global = prune(this.global, MINUTE_MS, now);
    this.global.push(now);
  }

  async acquire(chatId: string, maxWaitMs = config.rateLimitMaxWaitMs, now: () => number = Date.now): Promise<boolean> {
    const verdict = this.check(chatId, now());

    if (verdict.allowed) return true;

    if (verdict.waitMs > maxWaitMs) {
      logger.warn(
        `Anti-baneo: se descarta la respuesta en ${chatId} (límite "${verdict.reason}", espera ${verdict.waitMs}ms > ${maxWaitMs}ms)`
      );
      return false;
    }

    logger.debug(`Anti-baneo: esperando ${verdict.waitMs}ms en ${chatId} (${verdict.reason})`);
    await new Promise((resolve) => setTimeout(resolve, verdict.waitMs));
    const recheck = this.check(chatId, now());
    return recheck.allowed;
  }

  snapshot(chatId: string, now: number = Date.now()): { perMinute: number; perHour: number; globalPerMinute: number } {
    const history = this.perChat.get(chatId) ?? [];
    return {
      perMinute: prune(history, MINUTE_MS, now).length,
      perHour: prune(history, HOUR_MS, now).length,
      globalPerMinute: prune(this.global, MINUTE_MS, now).length,
    };
  }

  reset(): void {
    this.perChat.clear();
    this.global = [];
  }
}

export const outboundLimiter = new OutboundRateLimiter({
  perMinute: config.rateLimitPerMinute,
  perHour: config.rateLimitPerHour,
  globalPerMinute: config.rateLimitGlobalPerMinute,
  minGapMs: config.rateLimitMinGapMs,
});
