import { WAMessage } from '@whiskeysockets/baileys';
import { logger } from './logger.js';
import { config } from '../config.js';

export interface SenderMetadata {
  phoneNumber?: string;
  name?: string;
  isCreator: boolean;
  isGroup: boolean;
}

export interface IncomingMessageItem {
  chatId: string;
  senderKey: string;
  sender: SenderMetadata;
  text: string;
  imageBase64?: string;
  originalMsg: WAMessage;
}

export interface AggregatedMessage {
  chatId: string;
  senderKey: string;
  sender: SenderMetadata;
  fullText: string;
  imageBase64?: string;
  originalMsg: WAMessage;
  deferCount?: number;
}

interface PendingDebounce {
  timer: NodeJS.Timeout;
  chatId: string;
  senderKey: string;
  sender: SenderMetadata;
  texts: string[];
  imageBase64?: string;
  originalMsg: WAMessage;
}

export class MessageQueueService {
  private debounceMap = new Map<string, PendingDebounce>();
  private chatQueues = new Map<string, AggregatedMessage[]>();
  private isProcessing = new Map<string, boolean>();
  private notBefore = new Map<string, number>();
  private processHandler: ((item: AggregatedMessage) => Promise<void>) | null = null;

  private readonly DEBOUNCE_MS = config.messageDebounceMs;

  public registerHandler(handler: (item: AggregatedMessage) => Promise<void>) {
    this.processHandler = handler;
  }

  public enqueue(item: IncomingMessageItem) {
    const key = `${item.chatId}:${item.senderKey}`;

    const existing = this.debounceMap.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      if (item.text.trim()) {
        existing.texts.push(item.text.trim());
      }
      if (item.imageBase64) {
        existing.imageBase64 = item.imageBase64;
      }
      existing.originalMsg = item.originalMsg;
      existing.sender = item.sender;

      logger.info(
        `[Debounce] Acumulando mensaje de ${item.sender.name || item.senderKey} en ${item.chatId} (${existing.texts.length} líneas en buffer)`
      );

      existing.timer = setTimeout(() => {
        this.flushDebounce(key);
      }, this.DEBOUNCE_MS);
    } else {
      logger.info(
        `[Debounce] Esperando ${this.DEBOUNCE_MS}ms para posibles mensajes adicionales de ${item.sender.name || item.senderKey}...`
      );

      const pending: PendingDebounce = {
        chatId: item.chatId,
        senderKey: item.senderKey,
        sender: item.sender,
        texts: item.text.trim() ? [item.text.trim()] : [],
        imageBase64: item.imageBase64,
        originalMsg: item.originalMsg,
        timer: setTimeout(() => {
          this.flushDebounce(key);
        }, this.DEBOUNCE_MS),
      };

      this.debounceMap.set(key, pending);
    }
  }

  private flushDebounce(key: string) {
    const pending = this.debounceMap.get(key);
    if (!pending) return;
    this.debounceMap.delete(key);

    const fullText = pending.texts.join('\n');
    if (!fullText && !pending.imageBase64) return;

    const aggregated: AggregatedMessage = {
      chatId: pending.chatId,
      senderKey: pending.senderKey,
      sender: pending.sender,
      fullText,
      imageBase64: pending.imageBase64,
      originalMsg: pending.originalMsg,
    };

    if (!this.chatQueues.has(pending.chatId)) {
      this.chatQueues.set(pending.chatId, []);
    }

    const queue = this.chatQueues.get(pending.chatId)!;
    queue.push(aggregated);

    logger.info(
      `[Queue] Mensaje agregado a la cola de ${pending.chatId} (En cola: ${queue.length}). Texto combinado:\n"${fullText}"`
    );

    this.processNext(pending.chatId).catch((err) => {
      logger.error(`Error en cola de procesamiento para ${pending.chatId}:`, err);
    });
  }

  public defer(item: AggregatedMessage, delayMs: number): boolean {
    const queue = this.chatQueues.get(item.chatId) ?? [];
    const last = queue[queue.length - 1];
    const previous = Math.max(item.deferCount ?? 0, last?.deferCount ?? 0);
    const attempted = previous + 1;

    if (attempted > config.queueDeferMaxAttempts) {
      logger.warn(
        `[Queue] Se descarta el mensaje de ${item.chatId}: ${previous} reprogramaciones sin cupo disponible.`
      );
      return false;
    }

    if (last && !last.imageBase64 && item.fullText) {
      last.fullText = `${last.fullText}\n${item.fullText}`.trim();
      last.originalMsg = item.originalMsg;
      last.sender = item.sender;
      last.deferCount = attempted;
    } else {
      queue.push({ ...item, deferCount: attempted });
    }
    this.chatQueues.set(item.chatId, queue);

    const waitMs = Math.min(Math.max(0, delayMs), 15_000);
    this.notBefore.set(item.chatId, Date.now() + waitMs);

    logger.info(
      `[Queue] Anti-baneo: se reprograma la respuesta de ${item.chatId} en ${Math.round(waitMs / 1000)}s (intento ${attempted}/${config.queueDeferMaxAttempts}).`
    );

    setTimeout(() => {
      this.processNext(item.chatId).catch(() => {});
    }, waitMs + 50);

    return true;
  }

  private async processNext(chatId: string) {
    if (this.isProcessing.get(chatId)) {
      return;
    }

    const queue = this.chatQueues.get(chatId);
    if (!queue || queue.length === 0) {
      return;
    }

    const waitForCupo = (this.notBefore.get(chatId) ?? 0) - Date.now();
    if (waitForCupo > 0) {
      setTimeout(() => {
        this.processNext(chatId).catch(() => {});
      }, waitForCupo);
      return;
    }

    this.isProcessing.set(chatId, true);

    try {
      while (queue.length > 0) {
        const pendingWait = (this.notBefore.get(chatId) ?? 0) - Date.now();
        if (pendingWait > 0) {
          await new Promise((resolve) => setTimeout(resolve, pendingWait));
        }

        const item = queue.shift()!;
        if (this.processHandler) {
          logger.info(`[Queue] Procesando mensaje en ${chatId} de ${item.sender.name || item.senderKey}`);
          await this.processHandler(item);
        }
        if (queue.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, config.queueGapMs));
        }
      }
    } catch (error) {
      logger.error(`Error procesando elemento de cola en ${chatId}:`, error);
    } finally {
      this.isProcessing.set(chatId, false);
      if (queue && queue.length > 0) {
        this.processNext(chatId).catch(() => {});
      }
    }
  }

  public clearChat(chatId: string) {
    for (const [key, pending] of this.debounceMap.entries()) {
      if (pending.chatId === chatId) {
        clearTimeout(pending.timer);
        this.debounceMap.delete(key);
      }
    }
    this.chatQueues.delete(chatId);
    this.notBefore.delete(chatId);
    this.isProcessing.set(chatId, false);
    logger.info(`[Queue] Cola y timers cancelados para ${chatId}`);
  }
}

export const messageQueue = new MessageQueueService();
