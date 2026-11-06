import { config } from '../config.js';
import { getAmbient } from './memoryStore.js';
import { relativeTimeLabel } from './clock.js';

const MAX_TEXT_LENGTH = 220;

export function buildGroupAmbientPrompt(
  chatId: string,
  options: { limit?: number; excludeText?: string } = {}
): string {
  if (!config.ambientEnabled) return '';

  const limit = options.limit ?? config.ambientWindow;
  const exclude = (options.excludeText ?? '').trim().toLowerCase();

  const entries = getAmbient(chatId, limit).filter((entry) => {
    if (!exclude) return true;
    return entry.text.trim().toLowerCase() !== exclude;
  });

  if (entries.length === 0) return '';

  const lines = entries.map((entry) => {
    const text = entry.text.replace(/\s+/g, ' ').slice(0, MAX_TEXT_LENGTH);
    const when = relativeTimeLabel(entry.ts);
    return `- ${entry.senderName} (${when}): ${text}`;
  });

  return [
    '[LO QUE SE VIENE HABLANDO EN EL GRUPO]',
    'Mensajes que NO eran para vos, pero te sirven de contexto para no quedar perdida:',
    ...lines,
    'Usalo solo para entender el tema y el chisme. NO respondas a estos mensajes ni los cites: contestá únicamente lo último que te dijeron a vos.',
  ].join('\n');
}
